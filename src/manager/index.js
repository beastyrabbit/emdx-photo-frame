import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import sharp from 'sharp';
import { FrameApp } from '../app.js';
import { Store } from '../state.js';
import { ManagerStore, fail, id } from './store.js';
import { Secrets } from './secrets.js';
import { Media, autoCrop, validateCrop } from './media.js';
import { Decks } from './decks.js';
import { Pending } from './pending.js';
import { Runtime } from './runtime.js';
import { Integrations } from './integrations.js';
import { Events } from './events.js';
import { Status } from './status.js';
import {
  cadenceFromCron,
  cadenceClock,
  validateCadence,
  validTime,
} from './clock.js';

export class Manager {
  constructor(seeds, model, { env = process.env, root } = {}) {
    this.seeds = seeds;
    this.base = seeds[0].cfg;
    this.root =
      root ||
      path.join(
        env.DATA_DIR ||
          (seeds.length > 1
            ? path.dirname(path.dirname(this.base.dataDir))
            : this.base.dataDir),
        'manager',
      );
    this.store = new ManagerStore(this.root);
    this.s = this.store.state;
    this.secrets = new Secrets(this.root, env);
    this.env = env;
    this.model = model;
    this.apps = new Map();
    this.workChain = Promise.resolve();
    this.ready = false;
    this.preparations = new Map();
    this.timers = new Map();
    this.artCache = new Map();
  }
  save() {
    this.store.save();
  }
  frame(frameId, includeRemoved = false) {
    const f = this.s.frames.find(
      (f) => f.id === frameId && (includeRemoved || !f.removed),
    );
    if (!f) throw fail('Rahmen nicht gefunden', 404);
    return f;
  }
  picture(pid) {
    const p = this.s.pictures.find((p) => p.id === pid);
    if (!p) throw fail('Bild nicht gefunden', 404);
    return p;
  }
  group(gid) {
    const g = this.s.groups.find((g) => g.id === gid);
    if (!g) throw fail('Gruppe nicht gefunden', 404);
    return g;
  }
  record(entry) {
    this.s.history.unshift({
      id: id(),
      at: Date.now(),
      frameId: null,
      ok: true,
      ...entry,
    });
    this.s.history.length = Math.min(2000, this.s.history.length);
  }
  immediate(f) {
    return (
      f.power === 'dauerstrom' ||
      !!this.apps.get(f.id)?.state.battery?.pluggedIn
    );
  }
  clock(f, desired = false) {
    return cadenceClock(
      desired ? f.cadence : f.activeCadence || f.cadence,
      f.timezone,
      f.anchorAt,
    );
  }
  nextOnline(f) {
    const now = Date.now();
    return this.immediate(f) && !this.guarded(f)
      ? now
      : this.clock(f).next(now);
  }

  async initialize() {
    if (!this.s.migrated) {
      if (!this.s.groups.some((g) => g.id === 'default'))
        this.s.groups.push({
          id: 'default',
          name: 'Zuhause',
          albums: ['Folder'],
          art: { every: 0, from: 'bibliothek' },
        });
      for (const seed of this.seeds) {
        const cfg = seed.cfg;
        const st = new Store(cfg.dataDir).state;
        const cleaning =
          st.cleaning?.hour != null
            ? `${String(st.cleaning.hour).padStart(2, '0')}:${String(st.cleaning.minute).padStart(2, '0')}`
            : cfg.display.cleaningTime
              ? `${String(cfg.display.cleaningTime.hour).padStart(2, '0')}:${String(cfg.display.cleaningTime.minute).padStart(2, '0')}`
              : '05:50';
        const cadence = cadenceFromCron(cfg.schedule);
        const f = {
          id: seed.id,
          name: seed.name,
          device: st.displayCheck?.name || seed.name,
          ip: cfg.display.host || '',
          mac: cfg.display.mac || '',
          port: cfg.display.port,
          orientation: cfg.panel.orientation === 'portrait' ? 'hoch' : 'quer',
          upsideDown: cfg.panel.rotate === 180,
          groupId: 'default',
          tags: [],
          power: cfg.sleep.mode === 'deep' ? 'akku' : 'dauerstrom',
          cadence,
          activeCadence: cadence,
          cleaning,
          buffer: Math.min(5, cfg.update.days),
          dataDir: cfg.dataDir,
          photoDir: cfg.photoDir || null,
          timezone: cfg.timezone,
          anchorAt: st.playlist?.batch?.builtAt || Date.now(),
          pinSource: 'env',
          plan: [],
          delivered: null,
          current: null,
          guard: null,
          dirty: true,
          adopted: true,
        };
        if (!this.s.frames.some((x) => x.id === f.id)) this.s.frames.push(f);
      }
      // Migration is resumable. The original state/current/playlist trees remain in place.
      for (const f of this.s.frames) {
        const st = new Store(f.dataDir).state;
        const existing = st.library?.items || [];
        const listed = new Map(existing.map((p) => [p.id, p]));
        const skipped = (name) => name.split(/[\\/]/).some((part) => /^[.@]/.test(part));
        const reject = (name, err) => this.record({
          frameId: f.id, kind: 'problem', ok: false,
          text: `${name}: bei Übernahme übersprungen. ${err.status ? err.message : 'Datei nicht lesbar oder ungültig.'}`,
        });
        const walk = (dir) => {
          try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              if (skipped(entry.name)) continue;
              const file = path.join(dir, entry.name);
              if (entry.isDirectory()) walk(file);
              else if (entry.isFile() && /\.(jpe?g|png|webp|heic|heif|avif|tiff?|gif)$/i.test(entry.name)) {
                const fileId = `file:${path.relative(f.photoDir, file)}`;
                listed.set(fileId, { album: 'Folder', ...listed.get(fileId), id: fileId, path: file });
              }
            }
          } catch (err) { reject(path.basename(dir), err); }
        };
        if (f.photoDir) walk(f.photoDir);
        for (const item of listed.values()) {
          if (this.s.pictures.some((p) => p.id === item.id)) continue;
          if (skipped(item.id.replace(/^file:/, '')) || (item.path && skipped(path.basename(item.path)))) continue;
          const file = item.path || (item.id.startsWith('file:') && f.photoDir
            ? path.join(f.photoDir, item.id.slice(5)) : null);
          try {
            if (!file) throw fail('Dateipfad fehlt');
            const p = await this.ingest(file, {
              assetId: item.id,
              title: path.basename(file),
              accepted: true,
              albums: [item.album || 'Folder'],
              sourceNote: 'Bestehender Fotoordner',
            });
            p.takenAt = item.takenAt || p.takenAt;
          } catch (err) { reject(path.basename(file || item.id), err); }
        }
        const convert = (slot) => {
          if (!slot?.ids?.length) return null;
          const slotDir = slot.dir || slot.slotDir;
          let pictureId = slot.ids[0];
          if (slot.ids.length > 1) {
            pictureId = `legacy-${slotDir || slot.ids.join('-')}`;
            if (!this.s.pictures.some((p) => p.id === pictureId)) {
              const member = this.s.pictures.find((p) => p.id === slot.ids[0]);
              if (member && slot.ids.every((pid) => this.s.pictures.some((p) => p.id === pid)))
                this.s.pictures.push({
                  ...structuredClone(member),
                  id: pictureId,
                  identity: pictureId,
                  title: 'Übernommenes kombiniertes Bild',
                  orientation: f.orientation,
                  combo: {
                    layout:
                      f.orientation === 'hoch'
                        ? '2-uebereinander'
                        : '2-nebeneinander',
                    memberIds: slot.ids,
                  },
                  file: slotDir
                    ? path.join(f.dataDir, 'playlist', slotDir, 'device.png')
                    : path.join(f.dataDir, 'current', 'device.png'),
                  thumb: slotDir
                    ? path.join(f.dataDir, 'playlist', slotDir, 'thumb.jpg')
                    : path.join(f.dataDir, 'current', 'thumb.jpg'),
                });
            }
          }
          return {
            // Keep the rendered legacy file even if its source could not be adopted.
            pictureId: this.s.pictures.some((p) => p.id === pictureId) ? pictureId : null,
            at: slot.at || slot.since || Date.now(),
            file: slotDir
              ? path.join(f.dataDir, 'playlist', slotDir, 'device.png')
              : path.join(f.dataDir, 'current', 'device.png'),
            durationMs: slot.durationMs,
            legacy: true,
          };
        };
        const batch = st.playlist?.batch;
        const entries = batch?.items.map(convert).filter(Boolean) || [];
        if (batch)
          f.delivered = {
            id: `legacy-${f.id}`,
            entries,
            sentAt: batch.sentAt,
            builtAt: batch.builtAt,
            endsAt: batch.endsAt,
            legacy: true,
          };
        f.current = st.current?.ids?.length
          ? {
              pictureId: convert(st.current)?.pictureId,
              since: st.current.since || st.current.pushedAt || Date.now(),
              unsure: true,
              card: null,
            }
          : null;
        f.plan = (st.playlist?.slots || []).map(convert).filter(Boolean);
        for (const pid of [
          ...entries.map((e) => e.pictureId),
          ...f.plan.map((e) => e.pictureId),
          f.current?.pictureId,
        ].filter(Boolean))
          this.reserve(pid, f.id, true);
        // Guard the last possibly delivered program, including after a restart during the same wake.
        if (batch?.sentAt)
          f.guard = {
            at: batch.sentAt,
            until: this.clock(f).next(batch.sentAt),
            reason: 'adopted-delivery',
          };
        for (const h of st.history || [])
          if (
            !this.s.history.some(
              (e) => e.frameId === f.id && e.at === h.at && e.legacy,
            )
          )
            this.s.history.push({
              id: id(),
              at: h.at,
              frameId: f.id,
              kind: h.error ? 'problem' : 'wechsel',
              text: h.error || h.kind || 'Übernommener Verlauf',
              ok: h.ok !== false,
              battery: h.battery,
              legacy: true,
            });
      }
      this.s.migrated = true;
      this.syncDecks();
      this.save();
    }
    for (const f of this.s.frames.filter((f) => !f.removed)) this.attach(f);
    for (const p of this.s.pending)
      if (p.applying) {
        delete p.applying;
      }
    this.save();
    this.ready = true;
    return [...this.apps.values()];
  }

  configure(f) {
    const app = this.apps.get(f.id);
    if (!app) return;
    app.cfg.frame = { id: f.id, name: f.name };
    app.cfg.display.host = f.ip;
    app.cfg.display.pin =
      this.secrets.get(`pin:${f.id}`) ||
      this.seeds.find((seed) => seed.id === f.id)?.cfg.display.pin ||
      this.base.display.pin;
    app.cfg.panel.orientation =
      f.orientation === 'hoch' ? 'portrait' : 'landscape';
    const long = Math.max(this.base.panel.width, this.base.panel.height);
    const short = Math.min(this.base.panel.width, this.base.panel.height);
    Object.assign(app.cfg.panel, {
      width: f.orientation === 'hoch' ? short : long,
      height: f.orientation === 'hoch' ? long : short,
      rotate: f.upsideDown ? 180 : 0,
    });
  }
  attach(f) {
    const cfg = structuredClone(
      this.seeds.find((seed) => seed.id === f.id)?.cfg || this.base,
    );
    cfg.dataDir = f.dataDir;
    cfg.display = {
      ...cfg.display,
      host: f.ip,
      port: f.port || 1515,
      mac: f.mac,
      connectAttempts: 1,
    };
    cfg.update.mode = 'playlist';
    const store = new Store(f.dataDir);
    const save = store.save.bind(store);
    // Legacy bookkeeping must share the reserve used for durable wake guards.
    store.save = () => this.store.withReserve(save);
    const app = new FrameApp(cfg, store, this.model);
    this.apps.set(f.id, app);
    this.configure(f);
    cfg.transportGuard = {
      assert: () => {
        if (this.guarded(f))
          throw fail(
            'Rahmen gerade aktualisiert. Wartet auf den nächsten sicheren Wechsel.',
            409,
          );
      },
      beforeContent: () => this.markUpdated(f),
    };
    app.manager = this;
    for (const [method, action] of Object.entries({
      next: 'neu-senden',
      resend: 'neu-senden',
      testPattern: 'testbild',
      displayInfo: 'pruefen',
      deepSleep: 'tiefschlaf',
      sleepRightAway: 'tiefschlaf',
    }))
      app[method] = async () => this.frameAction(f.id, action);
    // The fallback page must not bypass the shared ownership ledger or wake guard.
    for (const method of ['showArt', 'startShowArtwork', 'startGenerate'])
      app[method] = async () => {
        throw fail('Bitte die neue Oberfläche benutzen.', 409);
      };
    if (this.server) {
      app.server = this.server;
      this.server.addApp?.(app);
      app.daily?.serveAgain();
    }
    return app;
  }
  addFrame(input) {
    if (
      !input ||
      !net.isIP(input.ip) ||
      !input.name?.trim() ||
      !input.device?.trim() ||
      !['hoch', 'quer'].includes(input.orientation) ||
      !['akku', 'dauerstrom'].includes(input.power) ||
      !validTime(input.cleaning) ||
      !Number.isInteger(input.buffer) ||
      input.buffer < 1 ||
      input.buffer > 5 ||
      input.name.length > 100 ||
      input.device.length > 100
    )
      throw fail('Rahmenangaben prüfen');
    validateCadence(input.cadence);
    this.group(input.groupId);
    if (this.s.frames.some((f) => !f.removed && f.ip === input.ip))
      throw fail('Diese IP gehört schon einem Rahmen.', 409);
    const frameId = id();
    if (input.pin !== null && !/^\d{6}$/.test(input.pin))
      throw fail('Die PIN braucht sechs Ziffern');
    if (input.pin) this.secrets.set(`pin:${frameId}`, input.pin);
    else {
      const inherited = this.s.frames.find((f) => !f.removed);
      this.secrets.set(
        `pin:${frameId}`,
        inherited
          ? this.secrets.get(`pin:${inherited.id}`) ||
              this.apps.get(inherited.id)?.cfg.display.pin
          : this.base.display.pin,
      );
    }
    const f = {
      ...input,
      pin: undefined,
      id: frameId,
      tags: [],
      dataDir: path.join(this.root, 'frames', frameId),
      port: 1515,
      cadence: validateCadence(input.cadence),
      activeCadence: validateCadence(input.cadence),
      timezone: this.base.timezone,
      anchorAt: Date.now(),
      pinSource: 'stored',
      plan: [],
      delivered: null,
      current: null,
      dirty: true,
    };
    f.setupTest = this.connectionTests?.get(f.ip) || null;
    this.s.frames.push(f);
    this.attach(f);
    this.queue(
      f,
      'reinigung',
      'Reinigungszeit',
      { value: f.cleaning },
      { to: f.cleaning, before: f.cleaning },
    );
    this.queue(f, 'erkennungsbild', 'Erkennungsbild', {
      action: 'erkennungsbild',
    });
    this.syncDecks();
    this.save();
    if (this.running) this.startFrame(f);
    this.requestPrepare(f);
    return { id: f.id };
  }
  removeFrame(frameId) {
    const f = this.frame(frameId);
    f.removed = true;
    clearTimeout(this.timers.get(f.id));
    this.timers.delete(f.id);
    // Removal is the owner's explicit release. Programs/files remain for audit and downloads.
    for (const owners of Object.values(this.s.claims)) delete owners[f.id];
    this.record({
      frameId,
      kind: 'aenderung',
      text: `${f.name} entfernt; seine Bildsperren wurden freigegeben.`,
    });
    this.save();
  }
  listGroups() {
    return this.s.groups.map((g) => ({
      ...g,
      frameIds: this.s.frames
        .filter((f) => !f.removed && f.groupId === g.id)
        .map((f) => f.id),
    }));
  }
  saveGroup(input) {
    if (
      !input?.name?.trim() ||
      !Array.isArray(input.albums) ||
      input.albums.some((a) => typeof a !== 'string' || a.length > 200) ||
      ![0, 3, 5, 10].includes(input.art?.every) ||
      !['bibliothek', 'katalog'].includes(input.art?.from)
    )
      throw fail('Gruppe prüfen');
    const group = input.id ? this.group(input.id) : { id: id() };
    Object.assign(group, {
      name: input.name.slice(0, 100),
      albums: input.albums,
      art: input.art,
    });
    if (!input.id) this.s.groups.push(group);
    this.syncDecks();
    for (const f of this.s.frames.filter(
      (f) => !f.removed && f.groupId === group.id,
    )) {
      this.queue(f, 'reihenfolge', 'Thema der Gruppe geändert');
      this.requestPrepare(f);
    }
    this.save();
    return { id: group.id };
  }
  publicPicture(p) {
    const {
      file,
      thumb,
      sha,
      pixelHash,
      identity,
      status,
      ref,
      revision,
      lastShown,
      ...publicFields
    } = p;
    return {
      ...publicFields,
      art: {
        motif: 'real',
        variant: 0,
        url: `/api/v1/media/${encodeURIComponent(p.id)}/thumb?v=${revision}`,
        originalUrl: `/api/v1/media/${encodeURIComponent(p.id)}/image?v=${revision}`,
      },
      groupIds: this.s.groups
        .filter(
          (g) =>
            p.albums.some((a) => g.albums.includes(a)) ||
            (p.source === 'kunst' && g.art.every),
        )
        .map((g) => g.id),
      where: this.where(p),
    };
  }
  listPictures() {
    return this.s.pictures
      .filter((p) => p.status === 'accepted')
      .map((p) => this.publicPicture(p));
  }
  getPicture(pid) {
    return this.publicPicture(this.picture(pid));
  }
  listAlbums() {
    const counts = new Map();
    for (const p of this.s.pictures.filter((p) => p.status !== 'deleted'))
      for (const a of p.albums) counts.set(a, (counts.get(a) || 0) + 1);
    return [...counts].map(([name, count]) => ({ name, count }));
  }
  updatePicture(pid, patch) {
    const p = this.picture(pid);
    if (
      !patch ||
      typeof patch !== 'object' ||
      Array.isArray(patch) ||
      Object.keys(patch).some(
        (k) =>
          ![
            'title',
            'albums',
            'paused',
            'orientation',
            'alsoOther',
            'crop',
          ].includes(k),
      )
    )
      throw fail('Bildangaben prüfen');
    for (const key of ['paused', 'alsoOther'])
      if (patch[key] !== undefined && typeof patch[key] !== 'boolean')
        throw fail('Bildangaben prüfen');
    if (
      patch.orientation !== undefined &&
      !['hoch', 'quer'].includes(patch.orientation)
    )
      throw fail('Ungültiges Format');
    if (
      patch.albums &&
      (!Array.isArray(patch.albums) ||
        patch.albums.some((a) => typeof a !== 'string' || a.length > 200))
    )
      throw fail('Ungültige Alben');
    if (
      patch.title !== undefined &&
      (typeof patch.title !== 'string' ||
        patch.title.length > 200 ||
        !patch.title.trim())
    )
      throw fail('Titel fehlt');
    if (patch.crop) {
      if (!['hoch', 'quer'].includes(patch.crop.orientation))
        throw fail('Ungültiges Format');
      p.crops[patch.crop.orientation] = validateCrop(patch.crop.crop);
    }
    for (const key of ['title', 'albums', 'paused', 'orientation', 'alsoOther'])
      if (patch[key] !== undefined) p[key] = patch[key];
    p.revision++;
    for (const f of this.s.frames.filter(
      (f) => !f.removed && this.owners(pid).includes(f.id),
    )) {
      this.queue(f, 'zuschnitt', `${p.title} bearbeitet`, { pictureId: pid });
      this.requestPrepare(f);
    }
    this.syncDecks();
    this.save();
  }
  deletePicture(pid) {
    const p = this.picture(pid);
    p.status = 'deleted';
    this.syncDecks();
    for (const f of this.s.frames.filter(
      (f) => !f.removed && this.owners(pid).includes(f.id),
    )) {
      this.queue(f, 'reihenfolge', `${p.title} gelöscht`);
      this.requestPrepare(f);
    }
    this.collectGarbage();
  }
  async createCombo(layout, memberIds) {
    const count = {
      '2-nebeneinander': 2,
      '3-nebeneinander': 3,
      '2-uebereinander': 2,
      '2x2': 4,
    }[layout];
    if (
      !count ||
      !Array.isArray(memberIds) ||
      memberIds.length !== count ||
      new Set(memberIds).size !== count
    )
      throw fail('Bilder für das Layout wählen');
    const members = memberIds.map((pid) => this.picture(pid));
    if (members.some((p) => p.combo || p.status !== 'accepted'))
      throw fail('Nur einzelne Bibliotheksbilder kombinieren');
    const pictureId = id();
    const orientation = layout === '2-uebereinander' ? 'hoch' : 'quer';
    const p = {
      ...structuredClone(members[0]),
      id: pictureId,
      title: 'Kombiniertes Bild',
      identity: pictureId,
      width: orientation === 'hoch' ? 1440 : 2560,
      height: orientation === 'hoch' ? 2560 : 1440,
      orientation,
      detected: orientation,
      alsoOther: false,
      crops: { hoch: autoCrop(), quer: autoCrop() },
      combo: { layout, memberIds },
      status: 'accepted',
      lastShown: null,
      sha: null,
      pixelHash: null,
      addedAt: Date.now(),
    };
    const dir = path.join(this.root, 'media', pictureId);
    fs.mkdirSync(dir, { recursive: true });
    p.file = path.join(dir, 'image.png');
    p.thumb = path.join(dir, 'thumb.jpg');
    try {
      const cfg = structuredClone(this.base);
      cfg.panel = {
        ...cfg.panel,
        width: orientation === 'hoch' ? 720 : 1280,
        height: orientation === 'hoch' ? 1280 : 720,
        orientation: orientation === 'hoch' ? 'portrait' : 'landscape',
        rotate: 0,
      };
      await this.renderPicture(p, cfg, p.file);
      await sharp(p.file)
        .resize(600, 600, { fit: 'inside' })
        .jpeg()
        .toFile(p.thumb);
      const meta = await sharp(p.file).metadata();
      p.width = meta.width;
      p.height = meta.height;
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw err;
    }
    this.s.pictures.push(p);
    this.syncDecks();
    this.save();
    return { id: pictureId };
  }
  listInbox() {
    return this.s.pictures
      .filter((p) => p.status === 'inbox')
      .map((p) => this.publicPicture(p));
  }
  acceptInbox(ids, edits = {}) {
    let withoutGroup = 0;
    const items = ids.map((pid) => this.picture(pid));
    for (const p of items) if (edits[p.id]) validateCrop(edits[p.id].crop);
    for (const p of items) {
      if (p.status !== 'inbox') continue;
      const edit = edits[p.id];
      if (edit) {
        if (!['hoch', 'quer'].includes(edit.orientation))
          throw fail('Ungültiges Format');
        p.orientation = edit.orientation;
        p.crops[edit.orientation] = edit.crop;
      }
      p.status = 'accepted';
      if (!this.publicPicture(p).groupIds.length) withoutGroup++;
    }
    this.syncDecks();
    this.save();
    return { withoutGroup };
  }
  discardInbox(ids) {
    for (const pid of ids) {
      const p = this.picture(pid);
      if (p.status !== 'inbox') throw fail('Bild nicht im Eingang', 409);
      p.status = 'discarded';
      p.discardedAt = Date.now();
      p.keptUntil = Date.now() + 30 * 86400000;
    }
    this.save();
  }
  listDiscarded() {
    return this.s.pictures
      .filter((p) => p.status === 'discarded' && p.keptUntil > Date.now())
      .map((p) => this.publicPicture(p));
  }
  restoreInbox(ids) {
    for (const pid of ids) {
      const p = this.picture(pid);
      if (p.status !== 'discarded' || p.keptUntil <= Date.now())
        throw fail('Aufbewahrung abgelaufen', 409);
      p.status = 'inbox';
    }
    this.save();
  }
  getSettings() {
    return {
      ...this.s.settings,
      localSecretsKey: this.secrets.localKey,
      immichUrl:
        this.env.IMMICH_URL ||
        this.s.settings.immichUrl ||
        'http://immich-server.photos.svc.cluster.local:2283/api',
      immichUrlLocked: !!(this.env.IMMICH_URL || this.secrets.external('immich')),
    };
  }
  updateSettings(patch) {
    if (patch.immichUrl !== undefined) {
      if (this.env.IMMICH_URL || this.secrets.external('immich'))
        throw fail('Immich-Adresse kommt aus der Server-Einrichtung.', 409);
      let url;
      try {
        url = new URL(patch.immichUrl);
      } catch {
        throw fail('Ungültige Immich-Adresse');
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw fail('Ungültige Immich-Adresse');
      const destination = url.href.replace(/\/+$/, '');
      if (destination !== this.getSettings().immichUrl.replace(/\/+$/, '')) {
        this.secrets.set('immich', null);
        delete this.s.keyTests.immich;
      }
      this.s.settings.immichUrl = destination;
    }
    if (patch.autoAccept !== undefined) {
      if (typeof patch.autoAccept !== 'boolean')
        throw fail('Ungültige Einstellung');
      this.s.settings.autoAccept = patch.autoAccept;
    }
    if (patch.extras)
      this.s.settings.extras = {
        generate: false,
        art: patch.extras.art === true,
      };
    this.save();
  }
  listHistory(frameId) {
    return this.s.history
      .filter((h) => !frameId || h.frameId === frameId)
      .sort((a, b) => b.at - a.at);
  }
}

for (const part of [
  Media,
  Decks,
  Pending,
  Runtime,
  Integrations,
  Events,
  Status,
])
  for (const name of Object.getOwnPropertyNames(part.prototype))
    if (name !== 'constructor')
      Object.defineProperty(
        Manager.prototype,
        name,
        Object.getOwnPropertyDescriptor(part.prototype, name),
      );
