// The photo library: reading the album(s), picking the next photo(s), downloading, cropping and
// rendering them. Methods of FrameApp (see app.js).
import fs from 'node:fs';
import sharp from 'sharp';
import { log } from './log.js';
import { fetchAlbum, fetchItemInfo, sizedUrl, downloadImage } from './sources/googleAlbum.js';
import { scanFolder } from './sources/folder.js';
import { syncBag, planNext } from './selector.js';
import { composeCanvas, renderCanvas, planCells } from './render.js';

const DAY = 24 * 3600 * 1000;

// What an entry of the Recent list says about the photos shown: when each was taken, and the
// title of those that have one (a picture made from a prompt, an artwork).
export function shownAs(items = []) {
  return {
    dates: items.map((i) => i.takenAt ?? null),
    ...(items.some((i) => i.title) ? { titles: items.map((i) => i.title || null) } : {}),
  };
}

export class Library {
  // ---------- photo library ----------
  refreshLibrary() {
    return this.exclusive('Reading the album', () => this.loadLibrary(0));
  }

  async loadLibrary(maxAgeMs) {
    const cfg = this.cfg;
    const cached = this.state.library;
    if (cached?.items?.length && maxAgeMs && Date.now() - cached.fetchedAt < maxAgeMs) return cached;

    const items = [];
    const albums = [];
    const errors = [];
    for (const url of cfg.albumUrls) {
      try {
        const a = await fetchAlbum(url);
        albums.push({ url, title: a.title, count: a.items.length });
        for (const it of a.items) items.push({ ...it, source: 'google', key: a.key, albumUrl: url, album: a.title });
        log.info(`Album "${a.title}": ${a.items.length} photos`);
      } catch (err) {
        errors.push(`${url}: ${err.message}`);
        log.error(`Could not read album ${url}:`, err);
        // Keep using what we knew about this album.
        const old = (cached?.items || []).filter((it) => it.albumUrl === url);
        if (old.length) {
          log.warn(`Using ${old.length} cached photos for that album`);
          items.push(...old);
          albums.push({ url, title: old[0].album || 'Shared album', count: old.length, stale: true });
        }
      }
    }
    if (cfg.photoDir) {
      const { items: files, cache } = await scanFolder(cfg.photoDir, this.state.folderCache || {});
      this.state.folderCache = cache;
      for (const it of files) items.push({ ...it, source: 'folder', album: 'Folder' });
      albums.push({ url: cfg.photoDir, title: 'Folder', count: files.length });
    }
    // Pictures made from a prompt that were kept in the rotation (art.js).
    const kept = this.keptArt?.() ?? [];
    items.push(...kept);
    if (kept.length) albums.push({ url: 'generated', title: 'Generated', count: kept.length });
    // Artworks from the catalogue that were kept in the rotation (artworks.js).
    const art = this.keptArtworks?.() ?? [];
    items.push(...art);
    if (art.length) albums.push({ url: 'art', title: 'Art', count: art.length });
    if (!items.length) {
      throw new Error(errors.length ? errors.join(' | ') : 'No photos found. Set ALBUM_URLS (and/or PHOTO_DIR), or ART_EVERY=1 for a frame of artworks.');
    }
    this.state.library = { fetchedAt: Date.now(), albums, items, errors };
    this.store.save();
    return this.state.library;
  }

  // Add an item to the photos read last, or take it out, without reading the album anew.
  // `shelf`: the "album" such items are listed under ({ url, title }).
  libraryItem(entry, keep, shelf) {
    const lib = this.state.library;
    if (!lib?.items) return;
    lib.items = lib.items.filter((it) => it.id !== entry.id);
    if (keep) lib.items.push(entry);
    const count = lib.items.filter((it) => it.source === entry.source).length;
    lib.albums = [...(lib.albums || []).filter((a) => a.url !== shelf.url), ...(count ? [{ ...shelf, count }] : [])];
  }

  // Where a picture (by its id in the library) is: 'frame' (on it), 'waiting' (goes out when the
  // display is next online) or 'planned' (for the change at `at`); null: nowhere.
  whereOn(id, now = Date.now()) {
    const c = this.state.current;
    if (c?.ids?.includes(id) && !(this.daily?.st.replaced)) return { where: c.pushed || c.dryRun ? 'frame' : 'waiting' };
    const slot = this.daily?.st.slots.find((s) => s.ids?.includes(id));
    if (!slot) return null;
    return slot.at > now ? { where: 'planned', at: slot.at, label: this.daily.label(slot.at) } : { where: 'waiting' };
  }

  // Pick the next photo(s) from the album, download, crop and render them into `dir`
  // (device.png for the display, previews, a thumbnail and the originals for the page).
  // Returns what was rendered; marking it as shown is up to the caller. `fresh`: read the
  // album anew. `say`: reports progress (default: the busy label).
  async renderPhoto(dir, { fresh = false, say = (what) => this.setBusy(what) } = {}) {
    const st = this.state;
    // ART_EVERY: every so often an artwork from the catalogue takes the photo's turn.
    if (this.artworkTurn?.()) {
      try {
        const meta = await this.renderArtwork(dir, { say });
        // (The album is still read anew, so that new photos join the round today.)
        if (fresh && (this.cfg.albumUrls.length || this.cfg.photoDir)) await this.loadLibrary(0).catch((err) => log.warn(`Could not read the album: ${err.message}`));
        return meta;
      } catch (err) {
        if (!this.hasPhotos()) throw err;
        this.aw.lastError = { at: Date.now(), message: err.message };
        log.warn(`Art: ${err.message}. A photo takes the turn; the artwork comes next time.`);
      }
    }
    const lib = await this.loadLibrary(fresh ? 0 : 30 * 60 * 1000);
    const byId = new Map(lib.items.map((it) => [it.id, it]));
    const ids = lib.items.map((it) => it.id);
    const avoid = this.daily?.plannedIds() ?? []; // a new round shouldn't open with these
    const sync = () => syncBag(st, ids, undefined, undefined, avoid);
    sync();

    let plan = null;
    let inputs = null;
    for (let attempt = 0; attempt < 10 && !inputs; attempt++) {
      plan = planNext(this.cfg, st, byId);
      if (!plan) throw new Error('No usable photos in the album');
      if (await this.skipVideos(plan)) { sync(); continue; }
      try {
        say('Downloading');
        inputs = await this.download(plan);
      } catch (err) {
        // A network or Google outage isn't the photo's fault: stop here and try again at the next
        // chance (benching photo after photo for a week would empty a small album).
        if (!err.photoProblem) throw new Error(`Could not download the photo: ${err.message}`);
        log.warn(`Skipping ${err.itemId} for a week: ${err.message}`);
        st.excluded[err.itemId] = { reason: 'download failed', until: Date.now() + 7 * DAY };
        sync();
      }
    }
    if (!inputs) throw new Error('Could not download any photo (see log)');

    say('Cropping and dithering');
    const out = await this.writeRender(dir, plan, inputs);
    log.info(`Rendered ${plan.kind} (${plan.items.length} photo${plan.items.length > 1 ? 's' : ''}) in ${out.ms} ms`);
    this.notePhoto?.();
    return {
      renderedAt: Date.now(),
      kind: plan.kind,
      ids: plan.items.map((it) => it.id),
      items: plan.items.map((it) => ({ id: it.id, takenAt: it.takenAt, source: it.source, album: it.album, ...(it.title ? { title: it.title } : {}) })),
      inkShare: out.inkShare,
    };
  }

  // Crop, tone and (with DITHER=local) dither the photos of a plan, and write the files into
  // `dir`: device.png for the display (not with `device: false`), previews, a thumbnail and the
  // originals for the page.
  async writeRender(dir, plan, inputs, { device = true } = {}) {
    const canvas = await composeCanvas(this.cfg, plan, inputs);
    const out = await renderCanvas(this.cfg, this.model, canvas);
    fs.mkdirSync(dir, { recursive: true });
    if (device) fs.writeFileSync(`${dir}/device.png`, out.devicePng);
    fs.writeFileSync(`${dir}/preview.png`, out.previewPng);
    fs.writeFileSync(`${dir}/preview.jpg`, out.previewJpg);
    fs.writeFileSync(`${dir}/thumb.jpg`, await sharp(out.previewJpg).resize(240).jpeg({ quality: 80 }).toBuffer());
    fs.rmSync(`${dir}/source-2.jpg`, { force: true });
    for (let i = 0; i < inputs.length; i++) {
      const thumb = await sharp(inputs[i], { failOn: 'none' }).rotate().resize(900, 900, { fit: 'inside' }).jpeg({ quality: 82 }).toBuffer();
      fs.writeFileSync(`${dir}/source-${i + 1}.jpg`, thumb);
    }
    return out;
  }

  // Videos in the album: look up file names and skip them (best effort).
  async skipVideos(plan) {
    const byKey = new Map();
    for (const it of plan.items) {
      if (it.source !== 'google' || this.state.checked?.[it.id]) continue;
      if (!byKey.has(it.key)) byKey.set(it.key, []);
      byKey.get(it.key).push(it.id);
    }
    let skipped = false;
    for (const [key, ids] of byKey) {
      try {
        const info = await fetchItemInfo(key, ids);
        this.state.checked ||= {};
        for (const id of ids) {
          const i = info.get(id);
          if (!i) continue;
          this.state.checked[id] = 1;
          if (i.isVideo) {
            log.info(`Skipping video ${i.filename}`);
            this.state.excluded[id] = { reason: 'video', until: null };
            skipped = true;
          }
        }
      } catch (err) {
        log.debug(`Video check unavailable: ${err.message}`);
      }
    }
    return skipped;
  }

  async download(plan) {
    const cells = planCells(this.cfg, plan);
    const inputs = [];
    for (let i = 0; i < plan.items.length; i++) {
      const it = plan.items[i];
      const { w, h } = cells[i].rect;
      try {
        inputs.push(it.path ? fs.readFileSync(it.path) : await downloadImage(sizedUrl(it, w, h)));
      } catch (err) {
        err.itemId = it.id;
        if (it.path) err.photoProblem = true; // (a file that is gone or unreadable)
        throw err;
      }
    }
    return inputs;
  }
}
