import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { id, fail } from './store.js';
import { MAX_FILE } from './media.js';
import {
  searchArt,
  getArt,
  downloadArt,
  topPicks,
} from '../sources/artCatalogue.js';
import {
  searchOpenArt,
  getOpenArt,
  OPEN_ART_ID,
} from '../sources/openArt.js';
import { searchPhotos, getPhoto } from '../sources/photos.js';

// The collections the "Kunst" area can be limited to. "aic" (the catalogue's 25 Chicago works)
// is gone from the choice; works taken from it keep their credit.
const ART_SOURCES = ['wikimedia', 'met', 'cleveland', 'smk'];

export class Immich {
  constructor(url, key, fetcher = fetch) {
    const u = new URL(url);
    if (
      !['http:', 'https:'].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      throw fail('Ungültige Immich-Adresse');
    this.base = u.href.replace(/\/+$/, '');
    this.key = key;
    this.fetcher = fetcher;
  }
  async request(endpoint, body, binary = false) {
    let res;
    try {
      res = await this.fetcher(`${this.base}${endpoint}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'x-api-key': this.key,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw fail('Immich ist nicht erreichbar.', 502);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw fail(
        res.status === 401 || res.status === 403
          ? 'Immich-Schlüssel oder Leserechte prüfen.'
          : 'Immich konnte die Anfrage nicht beantworten.',
        502,
      );
    }
    if (binary) {
      if (Number(res.headers.get('content-length')) > MAX_FILE) {
        await res.body?.cancel();
        throw fail('Immich-Bild zu groß', 413);
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > MAX_FILE) {
          await res.body?.cancel().catch(() => {});
          throw fail('Immich-Bild zu groß', 413);
        }
        chunks.push(chunk);
      }
      return {
        bytes: Buffer.concat(chunks),
        type: res.headers.get('content-type') || 'image/jpeg',
      };
    }
    return res.json();
  }
  async version() {
    const v = await this.request('/server/version');
    if (v.major !== 3 || v.minor !== 4)
      throw fail('Diese Integration braucht Immich 3.4.x.', 422);
    return `${v.major}.${v.minor}.${v.patch}`;
  }
  async search(query, cursor) {
    const filter = { type: { eq: 'IMAGE' } };
    if (query.albumId) filter.albumIds = { any: [query.albumId] };
    if (query.personIds?.length) filter.personIds = { any: query.personIds };
    if (query.favorites) filter.isFavorite = { eq: true };
    if (query.from || query.to)
      filter.fileCreatedAt = {
        ...(query.from ? { gte: new Date(query.from).toISOString() } : {}),
        ...(query.to ? { lte: new Date(query.to).toISOString() } : {}),
      };
    const smart = !!query.text?.trim() || !!query.queryAssetId;
    const body = {
      filter,
      orderBy: { field: 'fileCreatedAt', direction: 'asc' },
      size: 100,
      withExif: true,
      ...(cursor ? { cursor } : {}),
      ...(smart
        ? {
            ...(query.text ? { query: query.text } : {}),
            ...(query.queryAssetId ? { queryAssetId: query.queryAssetId } : {}),
          }
        : {}),
    };
    const response = await this.request(
      smart ? '/search/smart' : '/search/metadata',
      body,
    );
    return {
      items: (response.assets?.items || []).filter(
        (p) => p.type === 'IMAGE' && !p.isTrashed && !p.isOffline,
      ),
      nextCursor: response.assets?.nextCursor || null,
    };
  }
}

export class Integrations {
  immichClient() {
    const key = this.secrets.get('immich');
    if (!key)
      throw fail('Immich-Schlüssel fehlt. Unter Zugänge eintragen.', 409);
    return new Immich(
      this.env.IMMICH_URL ||
        this.s.settings.immichUrl ||
        'http://immich-server.photos.svc.cluster.local:2283/api',
      key,
    );
  }
  listKeys() {
    return ['immich', 'openrouter'].map((key) => {
      const saved = !!this.secrets.get(key),
        test = this.s.keyTests[key];
      return {
        id: key,
        name: key === 'immich' ? 'Immich' : 'OpenRouter',
        purpose:
          key === 'immich'
            ? 'Bilder aus Immich holen'
            : 'Für spätere Bilderzeugung',
        source: this.secrets.external(key)
          ? 'infisical'
          : saved
            ? 'hier'
            : null,
        saved,
        status: saved ? test?.status || 'funktioniert-nicht' : 'fehlt',
        statusNote: saved
          ? test?.note || 'Gespeichert, noch nicht getestet'
          : 'Kein Schlüssel gespeichert',
        testedAt: test?.at || null,
        later: key === 'openrouter',
      };
    });
  }
  saveKey(key, value) {
    if (!['immich', 'openrouter'].includes(key))
      throw fail('Unbekannter Zugang');
    this.secrets.set(key, value);
    delete this.s.keyTests[key];
    this.save();
  }
  removeKey(key) {
    if (!['immich', 'openrouter'].includes(key))
      throw fail('Unbekannter Zugang');
    this.secrets.set(key, null);
    delete this.s.keyTests[key];
    this.save();
  }
  async testKey(key) {
    if (!['immich', 'openrouter'].includes(key))
      throw fail('Unbekannter Zugang');
    let status = 'funktioniert',
      note = 'Verbindung und Leserechte geprüft';
    try {
      if (key === 'immich') {
        const c = this.immichClient();
        await c.version();
        await c.request('/albums');
      } else {
        if (!this.secrets.get(key)) throw fail('Schlüssel fehlt');
        const res = await fetch('https://openrouter.ai/api/v1/key', {
          headers: { Authorization: `Bearer ${this.secrets.get(key)}` },
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw fail('Schlüssel wurde nicht angenommen');
        await res.body?.cancel();
      }
    } catch (err) {
      status = 'funktioniert-nicht';
      note = err.status
        ? err.message
        : 'Verbindung konnte nicht geprüft werden';
    }
    this.s.keyTests[key] = { status, note, at: Date.now() };
    this.save();
    return this.listKeys().find((k) => k.id === key);
  }
  async getImmich() {
    if (!this.secrets.get('immich'))
      return { connected: false, version: '', people: [], albums: [] };
    const client = this.immichClient();
    const version = await client.version();
    const albums = await client.request('/albums');
    const people = [];
    try {
      for (let page = 1; page <= 20; page++) {
        const data = await client.request(`/people?page=${page}&size=500`);
        people.push(
          ...(data.people || []).map((p) => ({
            id: p.id,
            name: p.name || 'Ohne Namen',
            count: p.faceCount || 0,
          })),
        );
        if (!data.hasNextPage) break;
      }
    } catch {
      /* person.read is optional; album browsing still works */
    }
    return {
      connected: true,
      version,
      people,
      albums: albums.map((a) => ({
        id: a.id,
        name: a.albumName,
        count: a.assetCount || 0,
        subscribed: !!this.s.subscriptions[a.id]?.on,
        lastSync: this.s.subscriptions[a.id]?.lastSync || null,
      })),
    };
  }
  async searchImmich(query) {
    const client = this.immichClient();
    await client.version();
    const page = await client.search(query, query.cursor);
    return {
      items: page.items.map((p) => ({
        id: p.id,
        title: p.originalFileName || 'Immich-Bild',
        width: p.exifInfo?.exifImageWidth || 1,
        height: p.exifInfo?.exifImageHeight || 1,
        takenAt: Date.parse(p.fileCreatedAt),
        album: query.albumId
          ? this.s.subscriptions[query.albumId]?.name || null
          : null,
        favorite: !!p.isFavorite,
        people: (p.people || []).map((p) => p.id),
        imported: !!this.s.imported[p.id],
        art: {
          motif: 'real',
          variant: 0,
          url: `/api/v1/immich/thumbnail/${encodeURIComponent(p.id)}`,
        },
      })),
      nextCursor: page.nextCursor,
    };
  }
  // `skipRejected`: an album subscription records and skips a picture the service cannot
  // take (too large, undecodable) instead of retrying it on every poll.
  async importFromImmich(assetIds, albums = [], { skipRejected = false } = {}) {
    if (!Array.isArray(assetIds) || assetIds.length > 100)
      throw fail('Höchstens 100 Bilder auswählen');
    if (
      !Array.isArray(albums) ||
      albums.some((a) => typeof a !== 'string' || a.length > 200)
    )
      throw fail('Ungültige Alben');
    const client = this.immichClient();
    await client.version();
    for (const assetId of assetIds) {
      if (typeof assetId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(assetId))
        throw fail('Ungültige Immich-Bildkennung');
      if (this.s.imported[assetId]) continue;
      this.requireImportSpace();
      const meta = await client.request(
        `/assets/${encodeURIComponent(assetId)}`,
      );
      if (meta.type !== 'IMAGE' || meta.isTrashed || meta.isOffline) continue;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emdx-import-'));
      try {
        let p;
        try {
          const { bytes } = await client.request(
            `/assets/${encodeURIComponent(assetId)}/original?edited=true`,
            null,
            true,
          );
          const file = path.join(dir, 'image');
          fs.writeFileSync(file, bytes, { mode: 0o600 });
          p = await this.ingest(file, {
            title: meta.originalFileName || 'Immich-Bild',
            source: 'immich',
            sourceNote: albums.length ? `Immich: ${albums.join(', ')}` : 'Immich',
            albums,
            ref: assetId,
          });
        } catch (err) {
          // Only a picture that can never be taken is skipped; network and disk errors retry.
          if (!skipRejected || ![413, 415].includes(err.status)) throw err;
          this.s.importSkipped = this.s.importSkipped || {};
          this.s.importSkipped[assetId] = Date.now();
          this.record({ kind: 'problem', ok: false, text: `„${meta.originalFileName || 'Immich-Bild'}“ übersprungen: ${err.message}` });
          this.save();
          continue;
        }
        p.takenAt = Date.parse(meta.fileCreatedAt) || p.takenAt;
        this.s.imported[assetId] = p.id;
        this.save();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  async subscribeAlbum(albumId, on) {
    if (typeof albumId !== 'string' || typeof on !== 'boolean')
      throw fail('Ungültiges Album');
    const status = await this.getImmich();
    const album = status.albums.find((a) => a.id === albumId);
    if (!album) throw fail('Album nicht gefunden', 404);
    this.s.subscriptions[albumId] = {
      ...this.s.subscriptions[albumId],
      on,
      name: album.name,
    };
    this.save();
    if (on) await this.pollSubscriptions();
  }
  async pollSubscriptions() {
    if (this.polling) return;
    this.polling = true;
    try {
      const subscribed = Object.entries(this.s.subscriptions).filter(
        ([, s]) => s.on,
      );
      if (!subscribed.length) return;
      const client = this.immichClient();
      await client.version();
      for (const [albumId, sub] of subscribed) {
        let cursor = sub.cursor || null;
        let remaining = 10;
        let pages = 0;
        const seen = new Set();
        do {
          this.requireImportSpace();
          const page = await client.search({ albumId }, cursor);
          const candidates = page.items.filter((a) => !this.s.imported[a.id] && !this.s.importSkipped?.[a.id]);
          const batch = candidates.slice(0, remaining);
          await this.importFromImmich(batch.map((a) => a.id), [sub.name], { skipRejected: true });
          remaining -= batch.length;
          // Revisit a partially consumed page; imported IDs make it resumable.
          if (batch.length < candidates.length) break;
          cursor = page.nextCursor;
          if (cursor && seen.has(cursor))
            throw fail('Immich hat einen Cursor wiederholt', 502);
          seen.add(cursor);
        } while (cursor && remaining > 0 && ++pages < 10);
        sub.cursor = cursor;
        sub.lastSync = Date.now();
        this.save();
      }
    } catch (err) {
      this.record({ kind: 'problem', ok: false, text: err.status ? err.message : 'Album-Import fehlgeschlagen.' });
      this.save();
      throw err;
    } finally {
      this.polling = false;
    }
  }
  // A page of works for the "Kunst" area. With a search word the museums and Commons answer
  // directly; without one, and for "Auswahl des Katalogs", the paperlesspaper catalogue's top picks.
  async searchArt(query = {}) {
    if (!this.s.settings.extras.art) return { items: [], next: null, failed: [] };
    const text = String(query.text || '').trim();
    const source = query.source || null;
    if (source && !ART_SOURCES.includes(source)) throw fail('Unbekannte Sammlung');
    const fromCatalogue = query.topPicks || (!text && (!source || source === 'wikimedia'));
    let page;
    try {
      if (fromCatalogue) {
        const offset = Math.max(0, Math.floor(Number(query.cursor)) || 0);
        const catalogueSource = source === 'met' || source === 'wikimedia' ? source : null;
        const result =
          source && !catalogueSource
            ? { items: [], next: null }
            : await searchArt({
                baseUrl: this.base.art.baseUrl,
                q: text,
                offset,
                limit: 60,
                source: catalogueSource,
                topPicks: true,
              });
        page = {
          items: result.items.map((p) => ({ ...p, topPick: true })),
          next: result.next === null ? null : String(result.next),
          failed: [],
        };
      } else
        page = await searchOpenArt({ source, q: text, cursor: query.cursor || null });
    } catch (err) {
      throw fail(err.message, err.status === 400 ? 400 : 502);
    }
    return { ...page, items: this.offerWorks(page.items, query.fits) };
  }
  async searchPhotos(query = {}) {
    if (!this.s.settings.extras.art) return { items: [], next: null, failed: [] };
    let page;
    try {
      page = await searchPhotos({ q: query.text || '', cursor: query.cursor || null });
    } catch (err) {
      throw fail(err.message, err.status === 400 ? 400 : 502);
    }
    return { ...page, items: this.offerWorks(page.items, query.fits) };
  }
  // Works and photos as the screen shows them; the cache lets the thumbnail route and the import
  // find them again without asking their source a second time.
  offerWorks(items, fits) {
    return items
      .filter((p) => !fits || (p.height > p.width ? 'hoch' : 'quer') === fits)
      .map((p) => {
        this.artCache.set(p.id, p);
        if (this.artCache.size > 2000)
          this.artCache.delete(this.artCache.keys().next().value);
        return {
          id: p.id,
          workId: p.id,
          title: p.title,
          artist: p.artist,
          date: p.date,
          source: p.source === 'artic' ? 'aic' : p.source,
          licence: p.license,
          width: p.width,
          height: p.height,
          // Too small to fill the long side of a 2560 × 1440 panel without enlarging it.
          small: p.sizeKnown !== false && Math.min(p.width, p.height) < 1440,
          topPick: !!p.topPick,
          taken: this.s.pictures.some((x) => x.ref === p.id),
          art: {
            motif: 'real',
            variant: 0,
            url: `/api/v1/art/thumbnail/${encodeURIComponent(p.id)}`,
          },
        };
      });
  }
  async importPhotos(photoIds) {
    if (!Array.isArray(photoIds) || photoIds.length > 50)
      throw fail('Höchstens 50 Fotos auswählen');
    for (const photoId of photoIds) {
      if (this.s.pictures.some((p) => p.ref === photoId)) continue;
      this.requireImportSpace();
      const photo = this.artCache.get(photoId) || (await getPhoto(photoId));
      if (photo.source !== 'wordpress') throw fail('Das ist kein Foto aus dem Verzeichnis');
      const bytes = await downloadArt(photo.image, { maxBytes: MAX_FILE });
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emdx-photo-'));
      try {
        const file = path.join(dir, id());
        fs.writeFileSync(file, bytes, { mode: 0o600 });
        await this.ingest(file, {
          title: photo.title,
          source: 'foto',
          sourceNote: `Foto${photo.artist ? ` von ${photo.artist}` : ''}, WordPress-Fotoverzeichnis (CC0)`,
          albums: ['Fotos'],
          ref: photo.id,
        });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  async importArt(workIds, accepted = false) {
    if (!Array.isArray(workIds) || workIds.length > 50)
      throw fail('Höchstens 50 Werke auswählen');
    for (const workId of workIds) {
      if (this.s.pictures.some((p) => p.ref === workId)) continue;
      this.requireImportSpace();
      const art =
        this.artCache.get(workId) ||
        (OPEN_ART_ID.test(workId)
          ? await getOpenArt(workId)
          : await getArt({ baseUrl: this.base.art.baseUrl, id: workId }));
      if (art.source === 'wordpress') throw fail('Fotos über „Fotos“ holen');
      const bytes = await downloadArt(art.image, { maxBytes: MAX_FILE });
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emdx-art-'));
      try {
        const file = path.join(dir, id());
        fs.writeFileSync(file, bytes, { mode: 0o600 });
        await this.ingest(file, {
          title: art.title,
          source: 'kunst',
          sourceNote: art.artist,
          albums: ['Kunst'],
          ref: art.id,
          accepted,
          artwork: {
            workId: art.id,
            artist: art.artist,
            date: art.date,
            source: art.source === 'artic' ? 'aic' : art.source,
            licence: art.license,
          },
        });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  async ensureArtMix() {
    if (
      !this.s.settings.extras.art ||
      !this.s.groups.some((g) => g.art.every && g.art.from === 'katalog')
    )
      return;
    if (
      this.s.pictures.filter(
        (p) => p.source === 'kunst' && p.status === 'accepted',
      ).length >= 10
    )
      return;
    const items = await topPicks({ baseUrl: this.base.art.baseUrl, max: 200 });
    for (const p of items) this.artCache.set(p.id, p);
    await this.importArt(
      items.slice(0, 10).map((p) => p.id),
      true,
    );
  }
}
