import { fail, id } from './store.js';
import { validateCadence, validTime } from './clock.js';
import { fits } from './decks.js';

export const unsent = (p) =>
  ['eingestellt', 'wartet'].includes(p.state) && !p.applying;
export class Pending {
  queue(f, kind, title, payload = {}, extra = {}) {
    const p = {
      id: id(),
      frameId: f.id,
      kind,
      title,
      payload,
      state: 'eingestellt',
      setAt: Date.now(),
      extraRedraw: ['zeigen-jetzt', 'erkennungsbild', 'testbild'].includes(
        kind,
      ),
      ...extra,
    };
    this.s.pending.push(p);
    if (!f.watch || f.watch.until < Date.now())
      f.watch = { startedAt: Date.now(), until: Date.now() + 12 * 3600000 };
    this.record({
      frameId: f.id,
      kind: 'aenderung',
      text: [title, p.from && `von ${p.from}`, p.to && `auf ${p.to}`]
        .filter(Boolean)
        .join(' '),
      change: { id: p.id, state: p.state },
    });
    f.dirty = true;
    return p;
  }
  stage(p, state, extra = {}) {
    Object.assign(p, { state }, extra);
    this.record({
      frameId: p.frameId,
      kind: state === 'uebertragen' ? 'uebertragung' : 'aenderung',
      text: `${p.title}${p.to ? `: ${p.to}` : ''}`,
      change: { id: p.id, state },
      ok: state !== 'abweichend',
    });
  }
  publicPending(p) {
    const { payload, applying, before, withdrawn, ...visible } = p;
    return visible;
  }
  listPending(frameId) {
    return this.s.pending
      .filter((p) => !p.withdrawn && (!frameId || p.frameId === frameId))
      .map((p) => this.publicPending(p));
  }
  withdrawPending(changeId) {
    const p = this.s.pending.find((p) => p.id === changeId && !p.withdrawn);
    if (!p) throw fail('Änderung nicht gefunden', 404);
    if (!unsent(p))
      throw fail('Schon übertragen. Bitte als neue Änderung korrigieren.', 409);
    if (p.kind === 'event') {
      const siblings = this.s.pending.filter(
        (x) => x.eventChangeId === p.eventChangeId,
      );
      if (siblings.some((x) => !x.withdrawn && !unsent(x)))
        throw fail(
          'Event wurde schon an einen Rahmen übertragen. Bitte neu bearbeiten.',
          409,
        );
      for (const x of siblings) {
        x.withdrawn = true;
        this.frame(x.frameId).dirty = true;
      }
      const newer = this.s.pending.some(
        (x) =>
          x.kind === 'event' &&
          x.payload.eventId === p.payload.eventId &&
          x.setAt > p.setAt &&
          !x.withdrawn,
      );
      if (!newer) {
        const first = this.s.pending.find(
          (x) => x.kind === 'event' && x.payload.eventId === p.payload.eventId,
        );
        const previous = this.s.pending
          .filter(
            (x) =>
              x.kind === 'event' &&
              x.payload.eventId === p.payload.eventId &&
              !x.withdrawn,
          )
          .at(-1);
        const restore = previous?.payload.snapshot ?? first?.before ?? null;
        const index = this.s.events.findIndex(
          (e) => e.id === p.payload.eventId,
        );
        if (restore) this.s.events[index] = structuredClone(restore);
        else if (index >= 0) this.s.events.splice(index, 1);
      }
    }
    p.withdrawn = true;
    const f = this.frame(p.frameId);
    const field = {
      rhythmus: 'cadence',
      reinigung: 'cleaning',
      vorrat: 'buffer',
    }[p.kind];
    if (field) {
      const last = this.s.pending
        .filter(
          (x) =>
            x.frameId === f.id &&
            x.kind === p.kind &&
            !x.withdrawn &&
            x.id !== p.id,
        )
        .at(-1);
      const first = this.s.pending.find(
        (x) => x.frameId === f.id && x.kind === p.kind,
      );
      f[field] = last?.payload.value ?? first.before;
    }
    for (const key of ['groupId', 'power', 'upsideDown'])
      if (p.payload[key] !== undefined) {
        const changes = this.s.pending.filter(
          (x) => x.frameId === f.id && x.payload[key] !== undefined,
        );
        f[key] =
          changes.filter((x) => !x.withdrawn).at(-1)?.payload[key] ??
          changes[0].before;
      }
    this.configure(f);
    this.syncDecks();
    f.dirty = true;
    this.record({
      frameId: f.id,
      kind: 'aenderung',
      text: `${p.title}: zurückgenommen`,
      change: { id: p.id, state: 'zurueckgenommen' },
    });
    this.save();
  }
  resolvePending(changeId, keep) {
    const p = this.s.pending.find((p) => p.id === changeId && !p.withdrawn);
    if (!p || p.state !== 'abweichend')
      throw fail('Keine abweichende Änderung', 409);
    const f = this.frame(p.frameId);
    if (keep === 'rahmen') {
      f.cleaning = p.deviceValue;
      this.stage(p, 'bestaetigt', {
        confirmedAt: Date.now(),
        to: p.deviceValue,
      });
    } else if (keep === 'unser')
      this.queue(f, p.kind, p.title, p.payload, {
        from: p.deviceValue,
        to: p.to,
        supersedes: p.id,
      });
    else throw fail('Ungültige Auswahl');
    this.save();
  }
  updateFrame(frameId, patch) {
    const f = this.frame(frameId);
    if (!patch || typeof patch !== 'object')
      throw fail('Einstellungen erwartet');
    const fields = [
      'name',
      'groupId',
      'tags',
      'power',
      'cadence',
      'cleaning',
      'buffer',
      'upsideDown',
      'pin',
    ];
    if (Object.keys(patch).some((k) => !fields.includes(k)))
      throw fail('Unbekannte Rahmeneinstellung');
    if (
      patch.name !== undefined &&
      (typeof patch.name !== 'string' ||
        !patch.name.trim() ||
        patch.name.length > 100)
    )
      throw fail('Name fehlt');
    if (patch.groupId !== undefined) this.group(patch.groupId);
    if (
      patch.power !== undefined &&
      !['akku', 'dauerstrom'].includes(patch.power)
    )
      throw fail('Ungültige Stromversorgung');
    if (
      patch.tags !== undefined &&
      (!Array.isArray(patch.tags) ||
        patch.tags.some((x) => typeof x !== 'string' || x.length > 100))
    )
      throw fail('Ungültige Tags');
    if (patch.upsideDown !== undefined && typeof patch.upsideDown !== 'boolean')
      throw fail('Ungültige Ausrichtung');
    if (patch.cadence !== undefined) validateCadence(patch.cadence);
    if (patch.cleaning !== undefined && !validTime(patch.cleaning))
      throw fail('Ungültige Reinigungszeit');
    if (
      patch.buffer !== undefined &&
      (!Number.isInteger(patch.buffer) || patch.buffer < 1 || patch.buffer > 5)
    )
      throw fail('Vorrat muss 1 bis 5 sein');
    if (patch.pin !== undefined && !/^\d{6}$/.test(patch.pin))
      throw fail('Die PIN braucht sechs Ziffern');
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'pin') {
        this.secrets.set(`pin:${f.id}`, value);
        f.pinSource = 'stored';
        continue;
      }
      if (JSON.stringify(f[key]) === JSON.stringify(value)) continue;
      const kind = {
        cadence: 'rhythmus',
        cleaning: 'reinigung',
        buffer: 'vorrat',
      }[key];
      if (kind)
        this.queue(
          f,
          kind,
          {
            cadence: 'Wechselrhythmus',
            cleaning: 'Reinigungszeit',
            buffer: 'Vorrat',
          }[key],
          { value },
          {
            from:
              typeof f[key] === 'object'
                ? JSON.stringify(f[key])
                : String(f[key]),
            to:
              typeof value === 'object' ? JSON.stringify(value) : String(value),
            before: structuredClone(f[key]),
          },
        );
      else if (['groupId', 'power', 'upsideDown'].includes(key))
        this.queue(
          f,
          'reihenfolge',
          'Rahmen eingerichtet',
          { [key]: value },
          { before: structuredClone(f[key]) },
        );
      f[key] = structuredClone(value);
    }
    this.configure(f);
    this.syncDecks();
    this.save();
    this.requestPrepare(f);
  }
  frameAction(frameId, action) {
    const f = this.frame(frameId);
    if (
      ![
        'erkennungsbild',
        'testbild',
        'pruefen',
        'tiefschlaf',
        'neu-senden',
      ].includes(action)
    )
      throw fail('Unbekannte Aktion');
    const kind = ['erkennungsbild', 'testbild'].includes(action)
      ? action
      : 'reihenfolge';
    this.queue(
      f,
      kind,
      {
        pruefen: 'Rahmen prüfen',
        tiefschlaf: 'Tiefschlaf',
        'neu-senden': 'Vorrat erneut übertragen',
        erkennungsbild: 'Erkennungsbild',
        testbild: 'Testbild',
      }[action],
      { action },
    );
    this.save();
    this.requestPrepare(f);
  }
  planShow(request) {
    if (
      !request ||
      !Array.isArray(request.pictureIds) ||
      !request.pictureIds.length ||
      request.pictureIds.length > 100 ||
      !['jetzt', 'naechstes'].includes(request.when)
    )
      throw fail('Bilder und Zeitpunkt wählen');
    const pictures = request.pictureIds.map((pid) => this.picture(pid));
    if (pictures.some((p) => p.status !== 'accepted'))
      throw fail('Bilder erst übernehmen');
    const warnings = pictures.flatMap((p) => {
      const where = this.where(p);
      // One reason per picture, with the current panel taking priority over reservations.
      if (where.hangs)
        return [
          {
            pictureId: p.id,
            reason: 'haengt',
            frameId: where.hangs.frameId,
            at: null,
          },
        ];
      if (where.reserved)
        return [
          {
            pictureId: p.id,
            reason: 'vorgemerkt',
            frameId: where.reserved.frameId,
            at: where.reserved.at,
          },
        ];
      if (where.justShown && where.lastShown)
        return [{ pictureId: p.id, reason: 'eben', ...where.lastShown }];
      return [];
    });
    const warned = new Set(warnings.map((w) => w.pictureId));
    const frames =
      request.scope === 'haus'
        ? this.s.frames
            .filter((f) => !f.removed)
            .sort((a, b) => this.nextOnline(a) - this.nextOnline(b))
        : [this.frame(request.scope?.frameId)];
    const assigned = new Set();
    const lines = [];
    for (const f of frames) {
      const chosen = pictures
        .filter(
          (p) =>
            fits(p, f.orientation) &&
            (request.force === true || !warned.has(p.id)) &&
            (request.scope !== 'haus' || !assigned.has(p.id)),
        )
        .slice(0, request.scope === 'haus' ? 1 : 100);
      if (!chosen.length) continue;
      const immediate = this.immediate(f) && !this.guarded(f);
      const transferAt = this.nextOnline(f);
      const clock = this.clock(f, true);
      let at = request.when === 'jetzt' ? transferAt : clock.next(transferAt);
      const items = chosen.map((p) => {
        assigned.add(p.id);
        const item = { pictureId: p.id, at };
        at = clock.next(at);
        return item;
      });
      lines.push({
        frameId: f.id,
        pictureIds: chosen.map((p) => p.id),
        items,
        transferAt,
        at: items[0].at,
        uncertain: this.publicFrame(f).nextOnline.uncertain,
        immediate,
        extraRedraw: request.when === 'jetzt' && !this.immediate(f),
      });
    }
    return {
      lines,
      warnings,
      unplaced: request.pictureIds.filter(
        (pid) => !assigned.has(pid) && !warned.has(pid),
      ),
    };
  }
  show(request) {
    const plan = this.planShow(request);
    for (const line of plan.lines) {
      const f = this.frame(line.frameId);
      for (const pid of line.pictureIds)
        this.reserve(pid, f.id, request.force === true);
      this.queue(
        f,
        request.when === 'jetzt' ? 'zeigen-jetzt' : 'zeigen-naechstes',
        `${line.pictureIds.map((pid) => this.picture(pid).title).join(', ')} zeigen`,
        { pictureIds: line.pictureIds, force: request.force === true },
        {
          pictureIds: line.pictureIds,
          to: request.when === 'jetzt' ? 'Jetzt' : 'Als Nächstes',
        },
      );
    }
    this.save();
    for (const line of plan.lines)
      this.requestPrepare(this.frame(line.frameId));
    return plan;
  }
}
