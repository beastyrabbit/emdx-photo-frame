import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  pushContent,
  readCleaning,
  writeCleaning,
  readDisplayInfo,
  withDisplay,
  deepSleepNow,
} from '../display.js';
import { positionAt } from '../playlist.js';
import { unsent } from './pending.js';
import { id, fail } from './store.js';

const DAY = 86400000;
/** Reachability only. Never sends TLS, a PIN, WOL, or an MDC command. */
export function tcpProbe(host, port = 1515, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => finish({ awake: true, code: null }));
    socket.once('error', (err) => finish({ awake: false, code: err.code }));
    socket.setTimeout(timeoutMs, () =>
      finish({ awake: false, code: 'ETIMEDOUT' }),
    );
  });
}

const escape = (text) =>
  String(text).replace(
    /[<>&"']/g,
    (c) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[c],
  );
export class Runtime {
  guarded(f, now = Date.now()) {
    return !!f.guard && now < f.guard.until;
  }
  markUpdated(f) {
    const now = Date.now();
    const entries = f.sending?.entries || f.plan || [];
    f.guard = {
      at: now,
      until: entries.find((e) => e.at > now)?.at || this.clock(f).next(now),
      reason: 'content-command',
    };
    this.save();
  }
  observeProbe(f, result) {
    if (result.code === 'EHOSTUNREACH' && f.guard) {
      f.guard = null;
      this.save();
    }
  }
  quiet(f, now = Date.now()) {
    const app = this.apps.get(f.id);
    const clock = this.clock(f);
    const next = clock.next(now),
      prev = clock.prev(now);
    const margin = Math.min(app.cfg.update.quietSec * 1000, (next - prev) / 4);
    if (next - now < margin || now - prev < margin) return true;
    // Protect both old and desired cleaning windows until read-back agrees.
    const times = [f.cleaning, f.observedCleaning?.value].filter(Boolean);
    return times.some((time) => {
      const [hour, minute] = time.split(':').map(Number);
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: f.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(now);
      const mins =
        Number(parts.find((p) => p.type === 'hour').value) * 60 +
        Number(parts.find((p) => p.type === 'minute').value);
      const delta = ((mins - hour * 60 - minute + 1440 + 720) % 1440) - 720;
      return delta >= -15 && delta <= 30;
    });
  }
  requestPrepare(f) {
    f.dirty = true;
    if (!this.running) return;
    this.prepare(f).catch((err) => {
      f.prepareError = err.status
        ? err.message
        : 'Bilder konnten nicht vorbereitet werden';
      this.save();
    });
  }
  async prepare(f) {
    if (this.preparations.has(f.id)) return this.preparations.get(f.id);
    // Serialize preparation bookkeeping; pixel work shares Media.work with imports.
    const promise = (this.prepareChain || Promise.resolve())
      .then(() => this.prepareLocked(f))
      .finally(() => this.preparations.delete(f.id));
    this.prepareChain = promise.catch(() => {});
    this.preparations.set(f.id, promise);
    return promise;
  }
  async prepareLocked(f) {
    if (f.removed) return;
    try {
      await this.ensureArtMix();
    } catch {
      f.artProblem =
        'Kunstkatalog nicht erreichbar; vorhandene Bilder laufen weiter.';
    }
    const now = Date.now();
    this.advanceFrame(f, now);
    const cutoff = this.s.pending
      .filter((p) => p.frameId === f.id && !p.withdrawn && unsent(p))
      .map((p) => p.id);
    const pending = this.s.pending.filter((p) => cutoff.includes(p.id));
    const clock = this.clock(f, true);
    const app = this.apps.get(f.id);
    const cadence = structuredClone(f.cadence);
    const renderCfg = { ...app.cfg, panel: { ...app.cfg.panel } };
    const programId = id();
    const dir = path.join(this.root, 'programs', programId);
    fs.mkdirSync(dir, { recursive: true });
    const events = this.eventsFor(f.id).filter((e) => e.end > now);
    const schedule = this.programSchedule(f, events, now);
    const reorderChange = pending
      .filter((p) => p.kind === 'reihenfolge' && (p.payload.order || p.payload.deck))
      .at(-1);
    const reorder = [...(reorderChange?.payload.order || [])];
    const reorderAt = Math.max(
      reorderChange?.payload.reorderAt || clock.next(now),
      clock.next(now),
    );
    const actions = pending.filter((p) =>
      ['erkennungsbild', 'testbild'].includes(p.kind),
    );
    const taken = pending
      .filter((p) => ['zeigen-jetzt', 'zeigen-naechstes'].includes(p.kind))
      .flatMap((p) => p.payload.remaining || p.payload.pictureIds);
    const entries = [];
    f.shortage = 0;
    for (let i = 0; i < schedule.length; i++) {
      const at = schedule[i];
      const event = events.find((e) => at >= e.start && at < e.end);
      let chosen = null;
      if (!event && at >= reorderAt && reorder.length)
        chosen = { pictureId: reorder.shift() };
      if (!chosen && event) {
        const pictures = this.eventAssignments(event)[f.id] || [];
        const n = Math.floor(
          (Math.max(at, event.start) - event.start) / (event.everyMin * 60000),
        );
        const pid = pictures[n % pictures.length];
        if (
          pid &&
          (event.sameOnAll || !this.owners(pid).some((owner) => owner !== f.id))
        )
          chosen = { pictureId: pid, force: event.sameOnAll };
      }
      if (!chosen && i === 0 && f.current?.pictureId)
        chosen = { pictureId: f.current.pictureId, preserve: true, force: f.current.force };
      if (!chosen && !event) {
        // Downloaded manual slots remain in order until their actual display time.
        const old = (f.delivered?.entries || []).find(
          (e) => e.at === at && e.at > now && e.changeId && !e.tail,
        );
        if (
          old && this.s.pictures.some(
            (p) => p.id === old.pictureId && p.status === 'accepted' && !p.paused,
          )
        ) chosen = old;
      }
      if (!chosen) {
        const old = (f.plan || []).find((e) => e.at === at && !e.changeId);
        if (
          old &&
          // A deck reorder reallocates once; repeated preparation keeps that request's slots.
          (!(reorderChange?.payload.deck && at >= reorderAt) ||
            old.reorderId === reorderChange.id) &&
          this.s.pictures.some(
            (p) =>
              p.id === old.pictureId && p.status === 'accepted' && !p.paused,
          ) &&
          !taken.includes(old.pictureId) &&
          !this.owners(old.pictureId).some((owner) => owner !== f.id)
        )
          chosen = old;
      }
      if (!chosen) {
        const pid = this.draw(f, taken, !!reorderChange?.payload.deck && at >= reorderAt);
        if (pid) chosen = { pictureId: pid };
      }
      if (!chosen && !entries.length) {
        const change = pending.find((p) =>
          ['zeigen-jetzt', 'zeigen-naechstes'].includes(p.kind),
        );
        const pid = change?.payload.pictureIds[0];
        if (pid) chosen = { pictureId: pid, preserve: true, force: change.payload.force === true };
      }
      if (!chosen && entries.length) {
        f.shortage++;
        const fallback = event
          ? entries.at(-1)
          : entries.findLast((e) => !e.eventId && e.pictureId);
        const source = fallback?.pictureId ? fallback
          : f.current?.pictureId ? f.current : entries.at(-1);
        chosen = {
          pictureId: source.pictureId,
          force: source.force,
          preserve: true,
        };
      }
      if (!chosen && actions.length) chosen = { pictureId: null };
      if (!chosen) continue;
      if (chosen.pictureId) {
        this.reserve(chosen.pictureId, f.id, chosen.force || chosen.preserve);
        taken.push(chosen.pictureId);
      }
      entries.push({
        pictureId: chosen.pictureId,
        at,
        eventId: event?.id || null,
        changeId: chosen.changeId || null,
        reorderId: !event && reorderChange?.payload.deck && at >= reorderAt
          ? reorderChange.id : null,
        force: !!chosen.force,
        pinned: !!chosen.changeId,
        file: path.join(dir, `${entries.length}.png`),
      });
    }
    if (!entries.length) {
      f.prepareError =
        'Noch keine passenden Bilder. Der Rahmen behält sein Bild.';
      f.prepared = { id: programId, entries, manual: [], cutoff, cadence, preparedAt: now };
      f.dirty = false;
      this.save();
      return;
    }
    // Claims and preparation identity are durable before expensive renders yield control.
    f.preparing = { id: programId, entries, cutoff };
    this.save();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const action = i === 0 || !entry.pictureId ? actions.at(-1) : null;
      if (action) {
        entry.pictureId = null;
        entry.card = action.kind;
        await this.renderCard(f, action.kind, entry.file);
      } else if (entry.pictureId) {
        entry.renderKey = this.renderKey(entry.pictureId, renderCfg);
        const cached = (f.delivered?.entries || []).find(
          (e) => e.pictureId === entry.pictureId &&
            e.renderKey === entry.renderKey && fs.existsSync(e.file),
        );
        if (cached) fs.copyFileSync(cached.file, entry.file);
        else await this.renderPicture(this.picture(entry.pictureId), renderCfg, entry.file);
      }
    }
    // Manual intents are relative to the actual next contact, even if that contact is late.
    const manual = [];
    for (const change of pending.filter((p) =>
      ['zeigen-jetzt', 'zeigen-naechstes'].includes(p.kind),
    ))
      for (const pictureId of change.payload.remaining ||
        change.payload.pictureIds) {
        if (manual.length >= f.buffer + 1) break;
        const file = path.join(dir, `manual-${manual.length}.png`);
        await this.renderPicture(this.picture(pictureId), renderCfg, file);
        manual.push({
          pictureId,
          file,
          renderKey: this.renderKey(pictureId, renderCfg),
          force: change.payload.force === true,
          when: change.kind,
          changeId: change.id,
        });
      }
    f.plan = entries;
    f.prepared = {
      id: programId,
      entries,
      manual,
      cutoff,
      cadence,
      preparedAt: now,
    };
    f.preparing = null;
    f.prepareError = null;
    f.dirty = this.s.pending.some(
      (p) =>
        p.frameId === f.id &&
        unsent(p) &&
        !p.withdrawn &&
        !cutoff.includes(p.id),
    );
    this.save();
  }
  renderKey(pid, cfg) {
    const p = this.picture(pid);
    return JSON.stringify([
      cfg.panel, cfg.image, p.revision,
      ...(p.combo?.memberIds.map((id) => this.picture(id).revision) || []),
    ]);
  }
  programSchedule(f, events, now = Date.now()) {
    const clock = this.clock(f, true);
    const normalTimes = [
      clock.prev(now) || now,
      ...clock.upcoming(f.buffer, now),
    ];
    const times = new Set(normalTimes);
    const horizon = Math.max(now, ...events.map((e) => e.end));
    // A future Event must not stretch the last normal slot across all the intervening days.
    for (let t = clock.next(now); t <= horizon; t = clock.next(t)) {
      times.add(t);
      if (times.size > 500)
        throw fail(
          'Event liegt zu weit voraus für einen endlichen Vorrat. Näher am Beginn einstellen.',
          422,
        );
    }
    for (const event of events) {
      times.add(Math.max(now, event.start));
      for (
        let t = event.start + event.everyMin * 60000;
        t < event.end;
        t += event.everyMin * 60000
      )
        if (t > now) times.add(t);
      times.add(event.end);
      for (const t of clock.upcoming(f.buffer, event.end)) times.add(t);
    }
    const schedule = [...times]
      .sort((a, b) => a - b)
      .filter(
        (t) =>
          !events.some(
            (e) =>
              t > e.start &&
              t < e.end &&
              (t - e.start) % (e.everyMin * 60000) !== 0,
          ),
      );
    if (schedule.length > 250)
      throw fail(
        'Event enthält zu viele Wechsel. Kürzer oder langsamer einstellen.',
        422,
      );
    return schedule;
  }
  async renderCard(f, kind, file) {
    return this.work(() => this.renderCardLocked(f, kind, file));
  }

  async renderCardLocked(f, kind, file) {
    const cfg = this.apps.get(f.id).cfg;
    const { width, height } = cfg.panel;
    const lines = [
      '▲ OBEN',
      kind === 'testbild'
        ? 'Testbild: Ausrichtung, Farben und Schärfe'
        : 'Erkennungsbild',
      f.name,
      `${f.device} · ${f.ip}`,
      `Gruppe: ${this.group(f.groupId).name}`,
      new Date().toLocaleString('de-DE', {
        timeZone: f.timezone,
        hour12: false,
      }),
      `Nächster Wechsel: ${new Date(this.clock(f).next(Date.now())).toLocaleString('de-DE', { timeZone: f.timezone, hour12: false })}`,
    ];
    const font = Math.max(16, Math.round(width / 28));
    const bands = ['#fff', '#111', '#b5302a', '#24509a', '#2f7a4c', '#e3b400']
      .map(
        (fill, i) =>
          `<rect x="${(i * width) / 6}" y="${height * 0.7}" width="${width / 6}" height="${height * 0.2}" fill="${fill}"/>`,
      )
      .join('');
    let image = sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f2f2ee"/>${lines.map((line, i) => `<text x="5%" y="${font * 2 + i * font * 2}" font-size="${font}" font-family="DejaVu Sans">${escape(line)}</text>`).join('')}${kind === 'testbild' ? bands : ''}</svg>`,
      ),
    );
    if (f.upsideDown) image = image.rotate(180);
    await image.png().toFile(file);
  }

  advanceFrame(f, now = Date.now()) {
    const program = f.delivered;
    if (!program?.entries?.length) return false;
    let entry;
    let since;
    if (program.legacy) {
      const batch = this.apps.get(f.id).state.playlist?.batch;
      if (!batch?.items?.length) return false;
      const pos = positionAt(batch, now);
      entry = program.entries.find((e) => e.at === pos.item.at);
      since = pos.since;
    } else {
      const total = program.entries.reduce((n, e) => n + e.durationMs, 0);
      let elapsed = Math.max(0, now - program.builtAt);
      if (total > 0) elapsed %= total;
      let offset = 0;
      for (const e of program.entries) {
        entry = e;
        if (elapsed < offset + e.durationMs) break;
        offset += e.durationMs;
      }
      since = now - (elapsed - offset);
    }
    if (
      !entry ||
      (f.current?.entryFile === entry.file &&
        f.current?.pictureId === entry.pictureId)
    )
      return false;
    if (f.current?.pictureId) this.noteShown(f.current.pictureId, f.id, now);
    f.current = {
      pictureId: entry.pictureId,
      since,
      unsure: true,
      card: entry.card
        ? { kind: entry.card, until: this.clock(f).next(now) }
        : null,
      entryFile: entry.file,
      force: !!entry.force,
    };
    if (entry.pictureId) this.noteShown(entry.pictureId, f.id, since);
    this.record({
      frameId: f.id,
      pictureId: entry.pictureId || undefined,
      kind: 'wechsel',
      text: entry.pictureId
        ? `${this.picture(entry.pictureId).title}: Wechsel laut übertragenem Zeitplan`
        : `${entry.card || 'Übernommenes Bild'}: laut übertragenem Zeitplan`,
    });
    return true;
  }

  async applySettings(f, selected, device, battery) {
    const app = this.apps.get(f.id);
    app.noteBattery(battery);
    if (battery)
      this.record({
        frameId: f.id,
        kind: 'uebertragung',
        text: `Akku gelesen: ${battery.batteryPercent}%${battery.pluggedIn ? ', lädt gerade' : ''}`,
        battery: battery.batteryPercent,
      });
    const cleaning = await readCleaning(device);
    app.noteCleaning(cleaning);
    if (cleaning?.hour !== undefined)
      f.observedCleaning = {
        value: `${String(cleaning.hour).padStart(2, '0')}:${String(cleaning.minute).padStart(2, '0')}`,
        at: Date.now(),
      };
    if (selected.some((p) => p.payload.action === 'pruefen')) {
      const info = await readDisplayInfo(app.cfg, { device });
      app.state.displayCheck = { ...info, at: Date.now() };
      app.noteBattery(info.battery);
      app.noteCleaning(info.cleaning);
    }
    // All settings and read-backs finish before the sole content command.
    const cleaningChanges = selected.filter(
      (p) => p.kind === 'reinigung',
    );
    const writes = cleaningChanges.slice(-1);
    for (const p of cleaningChanges.slice(0, -1)) {
      p.withdrawn = true;
      this.record({
        frameId: f.id,
        kind: 'aenderung',
        text: `${p.title}: durch neueren Wert ersetzt`,
        change: { id: p.id, state: 'zurueckgenommen' },
      });
    }
    for (const p of writes) {
      const [hour, minute] = p.payload.value.split(':').map(Number);
      try {
        const read = await writeCleaning(device, hour, minute);
        if (read.value?.hour !== undefined) {
          app.noteCleaning(read.value);
          f.observedCleaning = {
            value: `${String(read.value.hour).padStart(2, '0')}:${String(read.value.minute).padStart(2, '0')}`,
            at: Date.now(),
          };
        }
        this.stage(p, read.matches ? 'bestaetigt' : 'abweichend', {
          sentAt: Date.now(),
          ...(read.matches
            ? { confirmedAt: Date.now() }
            : {
                deviceValue:
                  f.observedCleaning?.value || 'nicht lesbar',
              }),
        });
      } catch {
        this.stage(p, 'uebertragen', {
          sentAt: Date.now(),
          verification: 'Reinigungszeit nicht zurückgemeldet',
        });
      }
    }
    for (const p of this.s.pending.filter(
      (p) =>
        p.frameId === f.id &&
        p.kind === 'reinigung' &&
        p.state === 'uebertragen' &&
        !writes.includes(p),
    ))
      if (f.observedCleaning)
        this.stage(
          p,
          f.observedCleaning.value === p.payload.value
            ? 'bestaetigt'
            : 'abweichend',
          f.observedCleaning.value === p.payload.value
            ? { confirmedAt: Date.now() }
            : { deviceValue: f.observedCleaning.value },
        );
    this.save();
  }
  async deliver(f) {
    const app = this.apps.get(f.id);
    if (this.guarded(f) || !f.prepared || app.busy || f.removed) return false;
    return app.exclusive('Änderungen am Rahmen übernehmen', async () => {
      if (this.guarded(f)) return false;
      this.advanceFrame(f);
      const prepared = f.prepared;
      const now = Date.now();
      const selected = this.s.pending.filter(
        (p) => prepared.cutoff.includes(p.id) && !p.withdrawn && unsent(p),
      );
      if (!prepared.entries.length) {
        const settings = selected.filter((p) =>
          p.kind === 'reinigung' || p.payload.action === 'pruefen',
        );
        if (!settings.length) return false;
        for (const p of settings) p.applying = true;
        this.save();
        try {
          await withDisplay(app.cfg, { wol: false }, async (device) => {
            await this.applySettings(f, settings, device, null);
          });
          for (const p of settings.filter((p) => p.payload.action === 'pruefen'))
            this.stage(p, 'bestaetigt', { confirmedAt: Date.now() });
          f.lastOnline = Date.now();
          f.prepared = null;
          return true;
        } catch {
          return false;
        } finally {
          for (const p of settings) delete p.applying;
          f.dirty = true;
          this.save();
        }
      }
      let entries = prepared.entries.filter((e) => e.at > now);
      const first = prepared.entries.filter((e) => e.at <= now).at(-1);
      if (!first || !fs.existsSync(first.file)) return false;
      entries = [{ ...first, at: now }, ...entries];
      // Prepared normal slots never contain manual intents; apply those once at real contact.
      const clock = this.clock(f, true);
      const manual = prepared.manual || [];
      const nowItems = manual.filter((e) => e.when === 'zeigen-jetzt');
      const nextItems = manual.filter((e) => e.when === 'zeigen-naechstes');
      const appliedManual = [];
      if (nowItems.length || nextItems.length) {
        const forced = [...nowItems, ...nextItems];
        const start = nowItems.length ? 0 : 1;
        // Preserve all explicitly selected pictures in order, even beyond the normal horizon.
        let n = 0;
        for (let i = start; i < entries.length && n < forced.length; i++) {
          if (i > 0 && (entries[i].changeId || entries[i].eventId)) continue;
          const item = forced[n++];
          appliedManual.push(item);
          entries[i] = {
            ...item,
            at: i === 0 ? now : entries[i].at,
            pinned: true,
            eventId: null,
          };
        }
      }
      entries = entries.map((e, i) => ({
        ...e,
        durationMs: Math.max(
          1000,
          (entries[i + 1]?.at || clock.next(e.at)) - e.at,
        ),
      }));
      // Align the repeated program with regular changes, as upstream buildBatch does.
      const end = entries.at(-1).at + entries.at(-1).durationMs;
      const tailMs =
        clock.next(end + entries[0].durationMs - 1) -
        end -
        entries[0].durationMs;
      if (tailMs >= app.cfg.update.minTailSec * 1000)
        entries.push({
          ...entries[0],
          at: end,
          durationMs: tailMs,
          changeId: null,
          tail: true,
        });
      // A failed rebuild can leave prepared files for pictures that are no longer allowed.
      const eligible = () => entries.every((entry) => {
        if (!entry.pictureId) return true;
        const picture = this.s.pictures.find((p) => p.id === entry.pictureId);
        return picture?.status === 'accepted' && !picture.paused &&
          (entry.force || !this.owners(entry.pictureId).some((owner) => owner !== f.id));
      });
      if (
        !eligible() ||
        prepared.cutoff.some(
          (pid) => this.s.pending.find((p) => p.id === pid)?.withdrawn,
        )
      ) {
        f.dirty = true;
        return false;
      }
      if (
        selected.length &&
        selected.every((p) => p.payload.action === 'tiefschlaf')
      ) {
        const result = await deepSleepNow(app.cfg, { connect: { wol: false } });
        app.noteBattery(result.battery);
        for (const p of selected)
          this.stage(p, 'uebertragen', {
            sentAt: Date.now(),
            verification:
              'Schlafbefehl quittiert; Tiefschlaf nicht durch MDC nachgeprüft',
          });
        f.guard = {
          at: Date.now(),
          until: this.clock(f).next(Date.now()),
          reason: 'sleep-command',
        };
        f.prepared = null;
        f.watch = null;
        this.save();
        return true;
      }
      const program = {
        id: prepared.id,
        frameId: f.id,
        entries,
        builtAt: now,
        endsAt: now + entries.reduce((n, e) => n + e.durationMs, 0),
        cutoff: selected.map((p) => p.id),
        state: 'preflight',
        previous: f.delivered?.id || null,
      };
      f.sending = program;
      this.s.programs.push(program);
      for (const p of selected) p.applying = true;
      this.save();
      let commanded = false;
      try {
        const result = await pushContent(
          app.cfg,
          this.server,
          {
            items: entries.map((e) => ({
              file: e.file,
              durationMs: e.durationMs,
            })),
            contentType: 'PlaylistContent',
            name: f.name,
          },
          {
            networkStandby: f.power === 'dauerstrom',
            connect: { wol: false },
            onRegistered: (manifest) => {
              program.content = {
                ...manifest,
                files: manifest.files.map((file, i) => ({
                  ...file,
                  file: entries[i].file,
                })),
              };
              program.state = 'registered';
              this.save();
            },
            beforeSend: async (device, battery) => {
              await this.applySettings(f, selected, device, battery);
              if (!eligible()) throw fail('Bilder sind nicht mehr zur Übertragung freigegeben.', 409);
              for (const entry of entries)
                if (entry.pictureId) this.reserve(entry.pictureId, f.id, entry.force);
              commanded = true;
              program.state = 'sending';
              this.save();
            },
          },
        );
        program.state = 'downloaded';
        program.sentAt = Date.now();
        for (const p of selected.filter((p) => p.kind !== 'reinigung')) {
          const remaining = p.payload.remaining || p.payload.pictureIds;
          const count = appliedManual.filter((e) => e.changeId === p.id).length;
          if (remaining && count < remaining.length) continue;
          this.stage(p, 'uebertragen', {
            sentAt: program.sentAt,
            verification: 'Downloadnachweis, Bild am Rahmen nicht überprüfbar',
          });
        }
        for (const p of selected.filter((p) =>
          ['zeigen-jetzt', 'zeigen-naechstes'].includes(p.kind),
        )) {
          const count = appliedManual.filter((e) => e.changeId === p.id).length;
          p.payload.remaining = (
            p.payload.remaining || p.payload.pictureIds
          ).slice(count);
          // Continue a long selection at subsequent regular changes, without increasing the buffer.
          if (p.payload.remaining.length) p.kind = 'zeigen-naechstes';
        }
        const previousPicture = f.current?.pictureId;
        f.delivered = program;
        for (const old of this.s.programs)
          if (
            old.frameId === f.id &&
            old.id !== program.id
          ) {
            old.state = 'retired';
            this.server.releaseContent?.(old.content?.id);
          }
        if (
          JSON.stringify(f.activeCadence) !== JSON.stringify(prepared.cadence)
        )
          f.cadenceAppliedAt = Date.now();
        f.activeCadence = prepared.cadence;
        f.lastOnline = Date.now();
        f.missed = 0;
        f.prepared = null;
        this.advanceFrame(f);
        // Keep the previous panel image conservatively until a later buffer replacement.
        this.releaseUnused(
          f,
          [...entries.map((e) => e.pictureId), previousPicture].filter(Boolean),
        );
        if (
          !this.s.pending.some(
            (p) => p.frameId === f.id && unsent(p) && !p.withdrawn,
          )
        )
          f.watch = null;
        app.state.lastError = null;
        app.state.current = {
          ...(app.state.current || {}),
          ids: f.current?.pictureId ? [f.current.pictureId] : [],
          since: now,
          pushed: true,
          pushedAt: program.sentAt,
        };
        const currentDir = app.store.path('current');
        fs.copyFileSync(entries[0].file, path.join(currentDir, 'device.png'));
        await sharp(entries[0].file)
          .resize(600, 600, { fit: 'inside' })
          .jpeg()
          .toFile(path.join(currentDir, 'preview.jpg'));
        app.noteBattery(result.battery);
        app.store.save();
        this.record({
          frameId: f.id,
          kind: 'uebertragung',
          text: `${entries.length} Bilder an ${f.name} übertragen. Anzeige nicht überprüfbar.`,
        });
        this.collectGarbage();
        return true;
      } catch (err) {
        program.state = commanded || this.guarded(f) ? 'uncertain' : 'failed';
        if (program.state === 'failed') this.server.releaseContent?.(program.content?.id);
        else for (const p of selected.filter((p) => p.kind !== 'reinigung'))
          p.verification = 'Übertragung unklar; Abgleich beim nächsten sicheren Kontakt';
        f.lastProblem = {
          at: Date.now(),
          text:
            program.state === 'uncertain'
              ? 'Übertragung unklar. Bis zum nächsten Wechsel bleibt der Rahmen unberührt.'
              : 'Rahmen nicht erreichbar. Änderungen bleiben gespeichert.',
        };
        this.record({
          frameId: f.id,
          kind: 'problem',
          text: f.lastProblem.text,
          ok: false,
        });
        return false;
      } finally {
        for (const p of selected) delete p.applying;
        f.sending = null;
        f.dirty = true;
        this.save();
      }
    });
  }

  async tick(f) {
    if (f.removed || this.stopped) return;
    const now = Date.now();
    const app = this.apps.get(f.id);
    if (this.advanceFrame(f)) {
      f.dirty = true;
      this.save();
    }
    if (f.wakeUntil && now > f.wakeUntil) {
      const rec = app.state.playlist.changes.find(
        (r) => r.until === f.wakeUntil,
      );
      if (!rec?.online) f.missed = (f.missed || 0) + 1;
      f.wakeUntil = null;
      this.save();
    }
    const prev = this.clock(f).prev(now);
    const deliveredTimes =
      f.delivered?.entries.filter((e) => e.at <= now).map((e) => e.at) || [];
    const latest = Math.max(prev || 0, ...deliveredTimes);
    if (f.lastDue === undefined) f.lastDue = latest;
    if (latest > f.lastDue) {
      f.lastDue = latest;
      f.wakeUntil = now + app.cfg.sleep.wakeWindowMin * 60000;
      f.dirty = true;
      const rec = {
        at: latest,
        key: String(latest),
        until: f.wakeUntil,
        online: null,
      };
      app.state.playlist.changes.unshift(rec);
      app.state.playlist.changes.length = Math.min(
        30,
        app.state.playlist.changes.length,
      );
      app.store.save();
      this.save();
    }
    const pending = this.s.pending.filter(
      (p) => p.frameId === f.id && !p.withdrawn && unsent(p),
    );
    const guarded = this.guarded(f);
    const afterChange = f.wakeUntil > now;
    const fast =
      pending.length > 0 && f.watch?.until > now && !this.immediate(f);
    const dueProbe =
      this.immediate(f) && pending.length
        ? 1000
        : afterChange
          ? 10000
          : fast
            ? 5000
            : app.cfg.sleep.checkMin * 60000;
    // Guarded probes are slow TCP-only health observations; never a new login.
    const interval = guarded ? Math.max(30 * 60000, dueProbe) : dueProbe;
    if (
      app.busy ||
      this.preparations.has(f.id) ||
      !interval ||
      (f.lastProbe && now - f.lastProbe < interval) ||
      (!afterChange && this.quiet(f, now))
    ) {
      if (f.dirty && !this.preparations.has(f.id)) this.requestPrepare(f);
      return;
    }
    if (guarded) {
      f.lastProbe = now;
      const result = await app.exclusive('WLAN prüfen', () =>
        tcpProbe(f.ip, app.cfg.display.port, 10000),
      );
      this.observeProbe(f, result);
      return;
    }
    // Render ahead, without consuming the short wake window. Already-ready legacy slots survive migration.
    if (!f.prepared || f.dirty) {
      try {
        await this.prepare(f);
      } catch (err) {
        if (!f.prepared) throw err;
        // A failed rebuild must not waste a wake when prepared files are still available.
        f.preparing = null;
        f.dirty = true;
        f.prepareError = err.status
          ? err.message
          : 'Bilder konnten nicht neu vorbereitet werden. Vorhandener Vorrat wird weiterverwendet.';
      }
      if (!f.prepared) return;
    }
    f.lastProbe = now;
    for (const p of pending)
      if (p.state === 'eingestellt') this.stage(p, 'wartet');
    const result = await app.exclusive('Rahmen suchen', () =>
      tcpProbe(f.ip, app.cfg.display.port),
    );
    this.observeProbe(f, result);
    app.state.lastCheck = { at: now, awake: result.awake };
    if (!result.awake) {
      app.store.save();
      this.save();
      return;
    }
    f.lastOnline = Date.now();
    const rec = app.state.playlist.changes.find(
      (r) => !r.online && now >= r.at && now <= r.until,
    );
    if (rec) rec.online = now;
    app.state.wakeEvents ||= [];
    app.state.wakeEvents.unshift({
      at: now,
      charging: !!app.state.battery?.pluggedIn,
      battery: app.state.battery?.batteryPercent,
    });
    app.state.wakeEvents.length = Math.min(100, app.state.wakeEvents.length);
    app.store.save();
    const shouldSend =
      pending.length ||
      afterChange ||
      !f.delivered ||
      f.delivered.endsAt <= now;
    if (shouldSend) await this.deliver(f);
    else {
      await app.exclusive('Rahmen lesen', () =>
        withDisplay(app.cfg, { wol: false }, async (device) => {
          const battery = await device.getBatteryState();
          app.noteBattery(battery);
          app.store.save();
        }),
      );
    }
    this.save();
  }
  startFrame(f) {
    f.lastProbe =
      Date.now() -
      (this.s.pending.some(
        (p) => p.frameId === f.id && unsent(p) && !p.withdrawn,
      )
        ? 5000
        : 0);
    const stagger = [...f.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 5000;
    const loop = async () => {
      try {
        await this.tick(f);
      } catch {
        /* state and queue survive transient network/render failure */
      }
      if (!this.stopped && !f.removed) {
        const timer = setTimeout(loop, 1000);
        timer.unref?.();
        this.timers.set(f.id, timer);
      }
    };
    this.timers.set(f.id, setTimeout(loop, stagger));
  }
  start(server) {
    this.server = server;
    this.running = true;
    this.stopped = false;
    for (const app of this.apps.values()) {
      app.server = server;
      app.daily?.serveAgain();
    }
    for (const program of this.s.programs.filter(
      (p) => p.content && !['failed', 'retired'].includes(p.state),
    ))
      server.restoreContent(program.content);
    for (const f of this.s.frames.filter((f) => !f.removed)) {
      this.startFrame(f);
      this.requestPrepare(f);
    }
    this.integrationTimer = setInterval(() => {
      this.collectGarbage();
      this.pollSubscriptions().catch(() => {});
    }, 15 * 60000);
    this.integrationTimer.unref?.();
  }
  stop() {
    this.stopped = true;
    this.running = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    clearInterval(this.integrationTimer);
  }
  collectGarbage() {
    const now = Date.now();
    const keep = new Set(
      this.s.frames
        .flatMap((f) => [
          f.delivered?.id,
          f.prepared?.id,
          f.preparing?.id,
          f.sending?.id,
        ])
        .filter(Boolean),
    );
    for (const program of this.s.programs)
      if (!['failed', 'retired'].includes(program.state)) keep.add(program.id);
      else this.server?.releaseContent?.(program.content?.id);
    const root = path.join(this.root, 'programs');
    if (fs.existsSync(root))
      for (const dir of fs.readdirSync(root)) {
        const file = path.join(root, dir);
        if (!keep.has(dir) && now - fs.statSync(file).mtimeMs > 3600000)
          fs.rmSync(file, { recursive: true, force: true });
      }
    this.s.programs = this.s.programs.filter(
      (p) => keep.has(p.id) || now - p.builtAt < DAY,
    );
    const needed = new Set();
    const retain = (pid) => {
      if (!pid || needed.has(pid)) return;
      needed.add(pid);
      const p = this.s.pictures.find((p) => p.id === pid);
      for (const member of p?.combo?.memberIds || []) retain(member);
    };
    for (const p of this.s.pictures)
      if (p.status !== 'deleted' && !(p.status === 'discarded' && p.keptUntil <= now))
        retain(p.id);
    for (const f of this.s.frames.filter((f) => !f.removed)) {
      retain(f.current?.pictureId);
      for (const program of [f.delivered, f.prepared, f.preparing, f.sending])
        for (const e of program?.entries || []) retain(e.pictureId);
    }
    for (const program of this.s.programs.filter((p) => !['failed', 'retired'].includes(p.state)))
      for (const e of program.entries) retain(e.pictureId);
    for (const p of this.s.pictures)
      if (p.status === 'deleted' || (p.status === 'discarded' && p.keptUntil <= now)) {
        p.status = 'deleted';
        if (!needed.has(p.id) && !this.owners(p.id).length &&
          p.file?.startsWith(path.join(this.root, 'media') + path.sep))
          fs.rmSync(path.dirname(p.file), { recursive: true, force: true });
      }
    this.save();
  }
  async testConnection(ip, power, pin = null) {
    if (!net.isIP(ip)) throw fail('Feste IP-Adresse erwartet');
    if (pin !== null && !/^\d{6}$/.test(pin))
      throw fail('Die PIN braucht sechs Ziffern');
    const f = this.s.frames.find((f) => !f.removed && f.ip === ip);
    if (f && this.guarded(f))
      return {
        ok: false,
        steps: [
          {
            label: 'Rahmen gerade aktualisiert',
            ok: false,
            note: 'Bis zum nächsten Wechsel keine MDC-Verbindung.',
          },
        ],
        awakeUntil: null,
      };
    const run = async () => {
      const probe = await tcpProbe(ip, f?.port || 1515);
      const steps = [
        {
          label: 'TCP-Verbindung auf Port 1515',
          ok: probe.awake,
          note: probe.awake
            ? 'Erreichbar'
            : 'Knopf drücken und UniFi-Freigabe prüfen.',
        },
      ];
      let ok = probe.awake;
      if (ok) {
        const cfg = f ? this.apps.get(f.id).cfg : structuredClone(this.base);
        if (!f) {
          cfg.display.host = ip;
          cfg.display.port = 1515;
          cfg.display.connectAttempts = 1;
          cfg.display.pin =
            pin ||
            this.apps.values().next().value?.cfg.display.pin ||
            cfg.display.pin;
        }
        try {
          const info = await withDisplay(cfg, { wol: false }, (device) =>
            readDisplayInfo(cfg, { device }),
          );
          steps.push({
            label: 'Geräte-PIN und Einstellungen',
            ok: true,
            note: `${info.name || 'Rahmen'} · ${info.software || ''}`,
          });
        } catch {
          ok = false;
          steps.push({
            label: 'Geräte-PIN',
            ok: false,
            note: 'PIN und MDC-Freigabe prüfen. Abweichende PIN beim Hinzufügen eintragen.',
          });
        }
      }
      return {
        ok,
        steps,
        awakeUntil: power === 'akku' && ok ? Date.now() + 90000 : null,
      };
    };
    const result = f
      ? await this.apps.get(f.id).exclusive('Verbindung prüfen', run)
      : await run();
    this.connectionTests ||= new Map();
    this.connectionTests.set(ip, { at: Date.now(), steps: result.steps });
    return result;
  }
}
