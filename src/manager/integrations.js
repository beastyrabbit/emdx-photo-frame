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
  async importFromImmich(assetIds, albums = []) {
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
      const meta = await client.request(
        `/assets/${encodeURIComponent(assetId)}`,
      );
      if (meta.type !== 'IMAGE' || meta.isTrashed || meta.isOffline) continue;
      const { bytes } = await client.request(
        `/assets/${encodeURIComponent(assetId)}/original?edited=true`,
        null,
        true,
      );
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emdx-import-'));
      try {
        const file = path.join(dir, 'image');
        fs.writeFileSync(file, bytes, { mode: 0o600 });
        const p = await this.ingest(file, {
          title: meta.originalFileName || 'Immich-Bild',
          source: 'immich',
          sourceNote: albums.length ? `Immich: ${albums.join(', ')}` : 'Immich',
          albums,
          ref: assetId,
        });
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
        let cursor = null;
        const seen = new Set();
        do {
          const page = await client.search({ albumId }, cursor);
          await this.importFromImmich(
            page.items.map((a) => a.id),
            [sub.name],
          );
          cursor = page.nextCursor;
          if (cursor && seen.has(cursor))
            throw fail('Immich hat einen Cursor wiederholt', 502);
          seen.add(cursor);
        } while (cursor);
        sub.lastSync = Date.now();
        this.save();
      }
    } finally {
      this.polling = false;
    }
  }
  async searchArt(query = {}) {
    if (!this.s.settings.extras.art) return [];
    const result = await searchArt({
      baseUrl: this.base.art.baseUrl,
      q: query.text || '',
      offset: query.offset || 0,
      limit: 60,
    });
    const items = result.items.filter(
      (p) =>
        (!query.source ||
          p.source === (query.source === 'aic' ? 'artic' : query.source)) &&
        (!query.fits || (p.height > p.width ? 'hoch' : 'quer') === query.fits),
    );
    for (const p of items) this.artCache.set(p.id, p);
    return items.map((p) => ({
      id: p.id,
      workId: p.id,
      title: p.title,
      artist: p.artist,
      date: p.date,
      source: p.source === 'artic' ? 'aic' : p.source,
      licence: p.license,
      width: p.width,
      height: p.height,
      topPick: true,
      taken: this.s.pictures.some((x) => x.ref === p.id),
      art: {
        motif: 'real',
        variant: 0,
        url: `/api/v1/art/thumbnail/${encodeURIComponent(p.id)}`,
      },
    }));
  }
  async importArt(workIds, accepted = false) {
    if (!Array.isArray(workIds) || workIds.length > 50)
      throw fail('Höchstens 50 Werke auswählen');
    for (const workId of workIds) {
      if (this.s.pictures.some((p) => p.ref === workId)) continue;
      const art =
        this.artCache.get(workId) ||
        (await getArt({ baseUrl: this.base.art.baseUrl, id: workId }));
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
