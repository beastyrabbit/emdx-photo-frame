// Public-domain art (the page's "Art" tab): searching the paperlesspaper art catalogue, keeping
// the artworks that were chosen on the NAS, showing one on the frame as a one-off, keeping it in
// the rotation with the album's photos, and (ART_EVERY) letting the frame bring one of the
// catalogue's top picks by itself every so many photos. Methods of FrameApp (see app.js).
//
// An artwork is never cropped: it is shown whole, on white, with its title and artist under it
// (render.js, the "artwork" layout).
//
// State (state.artworks):
//   items     the artworks on the NAS, newest first: [{ id (the catalogue's, "wikimedia:123"),
//             dir, title, artist, date, license, sourceUrl, source, width, height, file, keep,
//             auto (the frame brought it), savedAt }]; the files are in <DATA_DIR>/artworks/<dir>/
//             (the picture as the catalogue sent it, and previews rendered for this frame)
//   banned    { id: 1 }: "never show again" (the frame doesn't bring these by itself)
//   bag       ART_EVERY: the top picks still to come this round, shuffled
//   since     ART_EVERY: photos prepared since the last artwork
//   lastError the last thing that went wrong: { at, message }
// <DATA_DIR>/artworks/pool.json: the catalogue's top picks, read once a week.
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { log } from './log.js';
import { shuffle } from './selector.js';
import { cropLoss, artworkLayout } from './render.js';
import { searchArt, topPicks, getArt, downloadArt, ART_ID } from './sources/artCatalogue.js';

const DAY = 24 * 3600 * 1000;
const SHELF = { url: 'art', title: 'Art' };
const FORMATS = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const libId = (id) => `art:${id}`;
const fail = (status, message) => Object.assign(new Error(message), { status });

// "Starry Night, Vincent van Gogh": an artwork in a line of the page or the log.
export const artLabel = (it) => [it.title || 'Untitled', it.artist].filter(Boolean).join(', ');

export class Artworks {
  get aw() {
    const a = (this.state.artworks ||= {});
    a.items ||= [];
    a.banned ||= {};
    a.bag ||= [];
    return a;
  }

  awDir(item, ...parts) {
    return this.store.path('artworks', item.dir, ...parts);
  }

  findArtwork(id) {
    const item = this.aw.items.find((it) => it.id === id);
    if (!item) throw fail(404, 'That artwork is not on the NAS (any more)');
    return item;
  }

  // ---------- the catalogue ----------
  // A page of search results for the Art tab (no words: the catalogue's top picks), each with
  // how it suits this frame and whether it is on the NAS already.
  async searchArtworks({ q = '', offset = 0 } = {}) {
    const a = this.cfg.art;
    const page = await searchArt({ baseUrl: a.baseUrl, q: String(q ?? ''), offset: Math.max(0, Math.floor(Number(offset)) || 0), limit: 60, timeoutMs: a.timeoutSec * 1000 });
    return {
      total: page.total,
      next: page.next,
      items: page.items.map(({ image, ...e }) => ({ ...e, fit: this.artworkFit(e) })),
    };
  }

  // How an artwork suits this frame: 'ok', 'shape' (it would be small: a wide work on a tall
  // frame) or 'small' (too few pixels: it would be enlarged a lot).
  artworkFit(e) {
    const a = this.cfg.art;
    const { width, height } = this.cfg.panel;
    if (1 - cropLoss(e.width / e.height, width / height) < a.minFill) return 'shape';
    const { rect } = artworkLayout(this.cfg, a.caption);
    return Math.min(rect.w / e.width, rect.h / e.height) > a.maxEnlarge ? 'small' : 'ok';
  }

  // ---------- the artworks on the NAS ----------
  // Make sure an artwork is on the NAS: look it up in the catalogue (unless `entry` is its
  // listing already), download its picture and render the previews. Returns the saved item.
  // It doesn't take the frame's lock.
  saveArtwork(id, { entry = null, auto = false } = {}) {
    const have = this.aw.items.find((it) => it.id === id);
    if (have && fs.existsSync(this.awDir(have, have.file))) return Promise.resolve(have);
    this.artSaving ||= new Map();
    if (!this.artSaving.has(id)) {
      this.artSaving.set(id, this.fetchArtwork(id, entry, auto).finally(() => this.artSaving.delete(id)));
    }
    return this.artSaving.get(id);
  }

  async fetchArtwork(id, entry, auto) {
    const a = this.cfg.art;
    const e = entry || await getArt({ baseUrl: a.baseUrl, id, timeoutMs: a.timeoutSec * 1000 });
    log.info(`Art: downloading “${artLabel(e)}”…`);
    const image = await downloadArt(e.image, { maxBytes: a.maxBytes, timeoutMs: 2 * a.timeoutSec * 1000 });
    let meta;
    try {
      meta = await sharp(image, { failOn: 'none' }).metadata();
    } catch (err) {
      throw Object.assign(new Error(`The catalogue sent something that is not a picture (${err.message})`), { gone: true });
    }
    if (!FORMATS[meta.format] || !meta.width || !meta.height) throw Object.assign(new Error(`The catalogue sent a ${meta.format || 'file'} the frame can't use`), { gone: true });
    const turned = meta.orientation >= 5;
    const item = {
      id, dir: crypto.createHash('sha256').update(id).digest('hex').slice(0, 12),
      title: e.title, artist: e.artist, date: e.date, license: e.license, sourceUrl: e.sourceUrl, source: e.source,
      width: turned ? meta.height : meta.width, height: turned ? meta.width : meta.height,
      // (One whose file was lost stays in the rotation when it is fetched again.)
      file: `original.${FORMATS[meta.format]}`, keep: !!this.aw.items.find((it) => it.id === id)?.keep, auto: !!auto, savedAt: Date.now(),
    };
    fs.rmSync(this.awDir(item), { recursive: true, force: true });
    fs.mkdirSync(this.awDir(item), { recursive: true });
    fs.writeFileSync(this.awDir(item, item.file), image);
    try {
      await this.writeRender(this.awDir(item), { kind: 'artwork', items: [this.artworkItem(item)] }, [image], { device: false });
    } catch (err) {
      fs.rmSync(this.awDir(item), { recursive: true, force: true });
      throw err;
    }
    this.aw.items = [item, ...this.aw.items.filter((it) => it.id !== id)];
    this.trimArtworks();
    this.store.save();
    return item;
  }

  // The NAS keeps a hundred artworks (art.galleryMax) besides those kept in the rotation: beyond
  // that the oldest go.
  trimArtworks() {
    for (const it of this.aw.items.filter((x) => !x.keep).slice(this.cfg.art.galleryMax)) this.dropArtwork(it);
  }

  dropArtwork(item) {
    this.aw.items = this.aw.items.filter((it) => it !== item);
    this.libraryItem(this.artworkItem(item), false, SHELF);
    fs.rmSync(this.awDir(item), { recursive: true, force: true });
  }

  // An artwork as the photo library and the playlist know it. `art`: the label under it.
  artworkItem(item) {
    return {
      id: libId(item.id), source: 'art', album: SHELF.title, path: this.awDir(item, item.file),
      width: item.width, height: item.height, takenAt: null, title: artLabel(item),
      art: { title: item.title || '', by: [item.artist, item.date].filter(Boolean).join(', ') },
    };
  }

  // The artworks kept in the rotation, for the photo library (library.js).
  keptArtworks() {
    return this.aw.items.filter((it) => it.keep && fs.existsSync(this.awDir(it, it.file))).map((it) => this.artworkItem(it));
  }

  // Render a saved artwork into `dir`, with the settings of today (ROTATE, DITHER, tone,
  // ART_CAPTION). Returns what a rendered photo is known by (see Library.renderPhoto).
  async renderSaved(dir, item) {
    const input = fs.readFileSync(this.awDir(item, item.file));
    const lib = this.artworkItem(item);
    const out = await this.writeRender(dir, { kind: 'artwork', items: [lib] }, [input]);
    return { renderedAt: Date.now(), kind: 'artwork', ids: [lib.id], items: [(({ path, width, height, art, ...ref }) => ref)(lib)], inkShare: out.inkShare };
  }

  // ---------- the Art tab's buttons ----------
  // A button that may have to download the artwork first: it answers at once (or throws, with a
  // `status` for the page) and goes on in the background; what goes wrong then is on the tab.
  artworkJob(id, what, fn) {
    if (!ART_ID.test(String(id))) throw fail(400, 'That is not an artwork of the catalogue');
    if (this.artBusy) throw fail(409, `Busy: ${this.artBusy.what.toLowerCase()}`);
    this.artBusy = { id, what, since: Date.now() };
    this.aw.lastError = null;
    return fn().catch((err) => {
      this.aw.lastError = { at: Date.now(), message: err.message };
      this.store.save();
      log.warn(`Art: ${err.message}`);
      throw err;
    }).finally(() => { this.artBusy = null; });
  }

  // "Show on the frame": the artwork as a one-off, for one day. Push mode: it goes to the display
  // now (or, like any photo, when the NAS next finds the display awake). Playlist mode: see
  // DailyPlaylist.showPicture().
  startShowArtwork(id) {
    if (this.busy && !this.busy.probe) throw fail(409, `Busy: ${this.busy.what}`);
    return this.artworkJob(id, 'Putting the artwork on the frame', async () => {
      const item = await this.saveArtwork(id);
      delete this.aw.banned[id];
      return this.run('Putting the artwork on the frame', async () => {
        const render = (dir) => this.renderSaved(dir, item);
        log.info(`Art: putting “${artLabel(item)}” on the frame.`);
        if (this.daily) return this.daily.showPicture(render, [libId(id)]);
        this.state.current = { ...await render(this.store.path('current')), pushed: false };
        this.store.save();
        return this.push(this.state.current, { reason: 'manual' });
      });
    });
  }

  // "Keep in rotation": the artwork joins the album's photos and comes up once per round.
  startKeepArtwork(id, keep = true) {
    if (!keep) return Promise.resolve(this.keepArtwork(id, false));
    return this.artworkJob(id, 'Fetching the artwork', async () => {
      await this.saveArtwork(id);
      return this.keepArtwork(id, true);
    });
  }

  keepArtwork(id, keep) {
    const item = this.findArtwork(id);
    item.keep = !!keep;
    if (keep) delete this.aw.banned[id];
    this.libraryItem(this.artworkItem(item), item.keep, SHELF);
    this.store.save();
    log.info(`Art: “${artLabel(item)}” is ${item.keep ? 'kept in the rotation' : 'out of the rotation'}.`);
    return item;
  }

  // "Remove": off the NAS. `never` ("Never show again"): the frame won't bring it by itself
  // either.
  removeArtwork(id, { never = false } = {}) {
    const item = this.findArtwork(id);
    this.dropArtwork(item);
    if (never) {
      this.aw.banned[id] = 1;
      this.aw.bag = this.aw.bag.filter((x) => x !== id);
    }
    this.store.save();
    log.info(`Art: removed “${artLabel(item)}”${never ? '; the frame will not bring it again' : ''}.`);
  }

  // ---------- ART_EVERY: the frame brings artworks by itself ----------
  // Is there anything else to show than the catalogue's artworks?
  hasPhotos() {
    return !!(this.cfg.albumUrls.length || this.cfg.photoDir || this.aw.items.some((it) => it.keep) || this.keptArt().length);
  }

  // Whether the next photo to prepare is an artwork: every ART_EVERY-th one, and every one on a
  // frame without photos.
  artworkTurn() {
    const { every } = this.cfg.art;
    if (!every) return false;
    return (this.aw.since ?? 0) >= every - 1 || !this.hasPhotos();
  }

  notePhoto() {
    if (this.cfg.art.every) this.aw.since = (this.aw.since ?? 0) + 1;
  }

  // The catalogue's top picks, read anew once a week; when the catalogue can't be reached, the
  // list read last serves (and the next try is some hours off).
  async artworkPool() {
    const a = this.cfg.art;
    const file = this.store.path('artworks', 'pool.json');
    if (this.artPool === undefined) {
      try { this.artPool = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.artPool = null; }
      if (!Array.isArray(this.artPool?.items) || this.artPool.baseUrl !== a.baseUrl) this.artPool = null;
    }
    const pool = this.artPool;
    if (pool?.items.length && Date.now() < Math.max(pool.fetchedAt + a.poolDays * DAY, pool.retryAt || 0)) return pool;
    try {
      const items = await topPicks({ baseUrl: a.baseUrl, timeoutMs: a.timeoutSec * 1000 });
      if (!items.length) throw new Error('The art catalogue lists no top picks');
      this.artPool = { fetchedAt: Date.now(), baseUrl: a.baseUrl, items };
      fs.mkdirSync(this.store.path('artworks'), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(this.artPool));
      log.info(`Art: the catalogue has ${items.length} top picks in the public domain.`);
    } catch (err) {
      if (!pool?.items.length) throw err;
      pool.retryAt = Date.now() + DAY / 4;
      log.warn(`Art: ${err.message}. Using the list read on ${new Date(pool.fetchedAt).toISOString().slice(0, 10)}.`);
    }
    return this.artPool;
  }

  // The next of the top picks: each comes once per round, in a shuffled order. Only those that
  // suit the frame (its shape, enough pixels), and none that was banned or is in the rotation
  // already.
  async pickArtwork() {
    const aw = this.aw;
    const pool = await this.artworkPool();
    const byId = new Map(pool.items.map((e) => [e.id, e]));
    const kept = new Set(aw.items.filter((it) => it.keep).map((it) => it.id));
    const usable = (id) => byId.has(id) && !aw.banned[id] && !kept.has(id) && this.artworkFit(byId.get(id)) === 'ok';
    aw.bag = aw.bag.filter(usable);
    if (!aw.bag.length) {
      const all = pool.items.map((e) => e.id).filter(usable);
      if (!all.length) throw new Error('None of the catalogue\'s top picks suits this frame');
      // A new round doesn't open with what is planned, or on the frame now.
      const recent = new Set([...(this.daily?.plannedIds() ?? []), ...(this.state.current?.ids ?? [])]);
      aw.bag = shuffle(all).sort((x, y) => (recent.has(libId(x)) ? 1 : 0) - (recent.has(libId(y)) ? 1 : 0));
      aw.round = (aw.round || 0) + 1;
    }
    return byId.get(aw.bag[0]);
  }

  // Render the next of the catalogue's top picks into `dir`, in a photo's place (see
  // Library.renderPhoto). An artwork that is gone from the catalogue is passed over.
  async renderArtwork(dir, { say = (what) => this.setBusy(what) } = {}) {
    const aw = this.aw;
    for (let attempt = 0; attempt < 5; attempt++) {
      const entry = await this.pickArtwork();
      let item;
      try {
        say('Downloading the artwork');
        item = await this.saveArtwork(entry.id, { entry, auto: true });
      } catch (err) {
        if (!err.gone) throw err;
        log.warn(`Art: passing over “${artLabel(entry)}”: ${err.message}`);
        aw.bag = aw.bag.filter((id) => id !== entry.id);
        continue;
      }
      say('Rendering the artwork');
      const meta = await this.renderSaved(dir, item);
      aw.bag = aw.bag.filter((id) => id !== entry.id);
      aw.since = 0;
      this.store.save();
      log.info(`Art: “${artLabel(item)}” takes a photo's turn (ART_EVERY=${this.cfg.art.every}).`);
      return meta;
    }
    throw new Error('Could not download any artwork (see log)');
  }

  // A planned artwork lost its day (to a one-off): one the frame brought by itself is the next
  // artwork again, and comes at the next turn.
  unplanArtworks(ids = []) {
    const aw = this.aw;
    for (const id of ids.filter((x) => String(x).startsWith('art:')).map((x) => x.slice(4))) {
      const item = aw.items.find((it) => it.id === id);
      if (!item?.auto || item.keep || !this.cfg.art.every) continue;
      aw.bag = [id, ...aw.bag.filter((x) => x !== id)];
      aw.since = this.cfg.art.every;
    }
  }

  artworksStatus() {
    const a = this.cfg.art;
    const aw = this.aw;
    return {
      every: a.every,
      caption: a.caption,
      busy: this.artBusy || null,
      error: aw.lastError || null,
      items: aw.items.map((it) => ({
        id: it.id, dir: it.dir, title: it.title, artist: it.artist, date: it.date, license: it.license, sourceUrl: it.sourceUrl,
        keep: !!it.keep, auto: !!it.auto, savedAt: it.savedAt, on: this.whereOn(libId(it.id)),
      })),
    };
  }
}
