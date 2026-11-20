// Public-domain works straight from the open-access APIs of museums and Wikimedia Commons. None of
// them needs a key. Each answers with far more works than the paperlesspaper catalogue holds for
// it, and each searches descriptions and subjects too, so "flowers" finds flower paintings and not
// only works with "flower" in their title.
//
//   Met       collectionapi.metmuseum.org/public/collection/v1.1  (search -> object IDs -> objects)
//   Cleveland openaccess-api.clevelandart.org/api/artworks         (cc0=1, has_image=1)
//   SMK       api.smk.dk/api/v1/art                                (public_domain, has_image filters)
//   Commons   commons.wikimedia.org/w/api.php                      (PD-Art files, bitmaps only)
//
// Every work comes out in the shape artCatalogue.tidy() gives: { id, source, title, artist, date,
// license, sourceUrl, width, height, image, thumb }, plus `sizeKnown` (false where the API names
// no picture size and the shape comes from the work's measurements).
import { tidyArtist, tidyDate, tidyTitle } from './artCatalogue.js';

const AGENT = 'emdx-photo-frame';
const PAGE = 24;
const MAX_ORIGINAL = 25 * 1024 * 1024; // what the import downloads at most (media.js MAX_FILE)
export const OPEN_ART_ID = /^(metmuseum|cleveland|smk|commons):[A-Za-z0-9._-]{1,60}$/;
export const COLLECTIONS = ['wikimedia', 'met', 'cleveland', 'smk'];
const NAMES = { wikimedia: 'Wikimedia Commons', met: 'Met', cleveland: 'Cleveland Museum of Art', smk: 'SMK' };

const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', '#39': "'", '#039': "'" };
export const stripHtml = (html) =>
  squash(String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&(amp|quot|apos|lt|gt|nbsp|#0?39);/g, (_, e) => ENTITIES[e]));

export async function getJson(url, name, { timeoutMs = 20000, fetcher = fetch } = {}) {
  let res;
  try {
    res = await fetcher(url, { headers: { 'User-Agent': AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    throw new Error(timedOut ? `${name} hat nicht rechtzeitig geantwortet` : `${name} ist gerade nicht erreichbar`);
  }
  if (res.status === 404) throw Object.assign(new Error(`${name} hat dieses Werk nicht (mehr)`), { status: 404, gone: true });
  if (res.status === 429 || res.status === 403) throw Object.assign(new Error(`${name} bittet um eine Pause, bitte gleich noch einmal`), { status: 429 });
  if (!res.ok) throw new Error(`${name} hat gerade Probleme (${res.status})`);
  try {
    return { body: await res.json(), headers: res.headers };
  } catch {
    throw new Error(`${name} hat keine gültige Antwort geschickt`);
  }
}

const work = (fields) => {
  const artist = tidyArtist(fields.artist);
  return {
    id: fields.id,
    source: fields.source,
    title: tidyTitle(fields.title, artist || squash(fields.artist)).slice(0, 200) || squash(fields.title).slice(0, 200),
    artist,
    date: tidyDate(fields.date),
    license: squash(fields.license).slice(0, 60) || 'Public domain',
    sourceUrl: /^https?:\/\//i.test(fields.sourceUrl || '') ? String(fields.sourceUrl) : null,
    width: Math.round(fields.width),
    height: Math.round(fields.height),
    sizeKnown: fields.sizeKnown !== false,
    image: fields.image,
    thumb: fields.thumb || fields.image,
  };
};
const usable = (w) => w.width > 0 && w.height > 0 && /^https?:\/\//i.test(w.image || '');

// --- Met: the search gives object IDs only, each object is one more request ---------------------

const MET = 'https://collectionapi.metmuseum.org/public/collection';
const metSearches = new Map(); // query -> { ids, at }: the ID list of a search, for "load more"
const MET_BATCH = 6;
const metObjects = new Map(); // object ID -> its JSON: browsing back and forth asks the Met once

async function metObject(id, opts) {
  if (metObjects.has(id)) return metObjects.get(id);
  const { body } = await getJson(`${MET}/v1/objects/${id}`, NAMES.met, opts);
  metObjects.set(id, body);
  if (metObjects.size > 1000) metObjects.delete(metObjects.keys().next().value);
  return body;
}

async function metIds(params, opts) {
  const key = params.toString();
  const hit = metSearches.get(key);
  if (hit && Date.now() - hit.at < 30 * 60000) return hit.ids;
  const { body } = await getJson(`${MET}/v1.1/search?${key}`, NAMES.met, opts);
  const ids = Array.isArray(body?.objectIDs) ? body.objectIDs.filter(Number.isInteger) : [];
  metSearches.set(key, { ids, at: Date.now() });
  if (metSearches.size > 30) metSearches.delete(metSearches.keys().next().value);
  return ids;
}

// The Met names no picture size; the work's own measurements give its shape.
function metShape(o) {
  const all = (o.measurements || []).map((m) => m?.elementMeasurements).filter((m) => m?.Height > 0 && m?.Width > 0);
  return all[0] ? { width: all[0].Width, height: all[0].Height } : null;
}

export function tidyMet(o) {
  if (!o || o.isPublicDomain !== true || !o.primaryImage) return null;
  const shape = metShape(o);
  if (!shape) return null;
  const k = 1000 / Math.max(shape.width, shape.height);
  const w = work({
    id: `metmuseum:${o.objectID}`, source: 'met', title: o.title, artist: o.artistDisplayName, date: o.objectDate,
    license: 'Public domain', sourceUrl: o.objectURL, width: shape.width * k, height: shape.height * k, sizeKnown: false,
    image: o.primaryImage, thumb: o.primaryImageSmall,
  });
  return usable(w) ? w : null;
}

const met = {
  async page({ q, cursor = 0 }, opts) {
    // Paintings only: a search over everything finds dresses and hats with flowers on them.
    const params = new URLSearchParams({ hasImages: 'true', medium: 'Paintings', q: q || '*' });
    if (!q) params.set('isHighlight', 'true');
    const ids = await metIds(params, opts);
    // The Met shuts out an address for a while after a burst of requests (403), well below its
    // documented 80 a second: a few objects at a time, and on a refusal keep what came so far.
    const items = [];
    let at = cursor;
    for (; at < Math.min(cursor + PAGE, ids.length); at += MET_BATCH) {
      const batch = ids.slice(at, Math.min(at + MET_BATCH, cursor + PAGE));
      const got = await Promise.allSettled(batch.map((id) => metObject(id, opts)));
      const refused = got.find((r) => r.status === 'rejected' && r.reason.status !== 404);
      if (refused) {
        if (!items.length) throw refused.reason;
        // What came is shown; the Met is still named as not answering, and "load more" goes on here.
        return { items: items.filter(Boolean), next: at, refused: true };
      }
      for (const r of got) if (r.status === 'fulfilled') items.push(tidyMet(r.value));
    }
    return { items: items.filter(Boolean), next: at < ids.length ? at : null };
  },
  async get(key, opts) {
    if (!/^\d{1,10}$/.test(key)) return null;
    return tidyMet(await metObject(Number(key), opts));
  },
};

// --- Cleveland ----------------------------------------------------------------------------------

const CMA = 'https://openaccess-api.clevelandart.org/api/artworks';

export function tidyCleveland(r) {
  if (!r || r.share_license_status !== 'CC0') return null;
  const big = r.images?.print || r.images?.web; // the print JPEG; the full TIFF can be 500 MB
  if (!big?.url) return null;
  const w = work({
    id: `cleveland:${r.id}`, source: 'cleveland', title: r.title, artist: r.creators?.[0]?.description, date: r.creation_date,
    license: 'CC0', sourceUrl: r.url, width: Number(big.width), height: Number(big.height), image: big.url, thumb: r.images?.web?.url,
  });
  return usable(w) ? w : null;
}

const cleveland = {
  async page({ q, cursor = 0 }, opts) {
    const params = new URLSearchParams({ cc0: '1', has_image: '1', limit: String(PAGE), skip: String(cursor) });
    if (q) params.set('q', q);
    else params.set('type', 'Painting');
    const { body } = await getJson(`${CMA}/?${params}`, NAMES.cleveland, opts);
    const got = Array.isArray(body?.data) ? body.data : [];
    const end = cursor + got.length;
    return { items: got.map(tidyCleveland).filter(Boolean), next: got.length && end < (Number(body?.info?.total) || 0) ? end : null };
  },
  async get(key, opts) {
    return tidyCleveland((await getJson(`${CMA}/${encodeURIComponent(key)}`, NAMES.cleveland, opts)).body?.data);
  },
};

// --- SMK, the National Gallery of Denmark --------------------------------------------------------

const SMK = 'https://api.smk.dk/api/v1/art';
const SMK_ID = /^[A-Za-z0-9._-]{1,60}$/;

export function tidySmk(r) {
  if (!r || r.public_domain !== true || !r.image_iiif_id || !SMK_ID.test(r.object_number || '')) return null;
  const width = Number(r.image_width);
  const height = Number(r.image_height);
  // The IIIF service gives the picture at most 3000 pixels long; the native file can be very large.
  // "!3000,3000" alone would also enlarge a smaller picture (IIIF 2 does that), so "max" for those.
  const k = Math.min(1, 3000 / Math.max(width, height));
  const size = k < 1 ? '!3000,3000' : 'max';
  const w = work({
    id: `smk:${r.object_number}`, source: 'smk', title: r.titles?.[0]?.title,
    // "Jerichau Baumann, Elisabeth": SMK also gives the name in parts, so it can be put the right way round.
    artist: [r.production?.[0]?.creator_forename, r.production?.[0]?.creator_surname].filter(Boolean).join(' ') || r.production?.[0]?.creator,
    date: r.production_date?.[0]?.period, license: 'Public domain', sourceUrl: r.frontend_url,
    width: width * k, height: height * k, image: `${r.image_iiif_id}/full/${size}/0/default.jpg`, thumb: r.image_thumbnail,
  });
  return usable(w) ? w : null;
}

const smk = {
  async page({ q, cursor = 0 }, opts) {
    const filters = ['[public_domain:true]', '[has_image:true]', ...(q ? [] : ['[object_names:painting]'])].join(',');
    const params = new URLSearchParams({ keys: q || '*', lang: 'en', offset: String(cursor), rows: String(PAGE), filters });
    const { body } = await getJson(`${SMK}/search/?${params}`, NAMES.smk, opts);
    const got = Array.isArray(body?.items) ? body.items : [];
    const end = cursor + got.length;
    return { items: got.map(tidySmk).filter(Boolean), next: got.length && end < (Number(body?.found) || 0) ? end : null };
  },
  async get(key, opts) {
    const params = new URLSearchParams({ object_number: key, lang: 'en' });
    return tidySmk((await getJson(`${SMK}/?${params}`, NAMES.smk, opts)).body?.items?.[0]);
  },
};

// --- Wikimedia Commons: public-domain reproductions of art (template PD-Art) ---------------------

const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const commonsParams = () =>
  new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata', iiurlwidth: '500',
    iiextmetadatafilter: 'ObjectName|Artist|DateTimeOriginal|LicenseShortName',
  });

export function tidyCommons(p) {
  const ii = p?.imageinfo?.[0];
  if (!ii || !['image/jpeg', 'image/png'].includes(ii.mime) || !(ii.size <= MAX_ORIGINAL)) return null;
  const md = (k) => stripHtml(ii.extmetadata?.[k]?.value);
  const license = md('LicenseShortName');
  if (!/public domain|^pd\b|cc0/i.test(license)) return null;
  const w = work({
    // Wikidata labels can follow the name: "Maidens picking Flowers label QS:Len,\"…\" label QS:Lde,…".
    id: `commons:${p.pageid}`, source: 'wikimedia', title: md('ObjectName').replace(/\s*\blabel QS:.*$/s, '') || String(p.title || '').replace(/^File:/, ''),
    artist: md('Artist'), date: md('DateTimeOriginal'), license, sourceUrl: ii.descriptionurl,
    width: ii.width, height: ii.height, image: ii.url, thumb: ii.thumburl,
  });
  return usable(w) ? w : null;
}

const commons = {
  async page({ q, cursor = 0 }, opts) {
    const params = commonsParams();
    params.set('generator', 'search');
    params.set('gsrnamespace', '6');
    params.set('gsrsearch', `${q} filetype:bitmap hastemplate:PD-Art`);
    params.set('gsrlimit', String(PAGE));
    params.set('gsroffset', String(cursor));
    const { body } = await getJson(`${COMMONS}?${params}`, NAMES.wikimedia, opts);
    const pages = [...(body?.query?.pages || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const next = Number(body?.continue?.gsroffset);
    return { items: pages.map(tidyCommons).filter(Boolean), next: Number.isInteger(next) && next > cursor ? next : null };
  },
  async get(key, opts) {
    const params = commonsParams();
    params.set('pageids', key);
    return tidyCommons((await getJson(`${COMMONS}?${params}`, NAMES.wikimedia, opts)).body?.query?.pages?.[0]);
  },
};

const ADAPTERS = { met, cleveland, smk, wikimedia: commons };
const BY_PREFIX = { metmuseum: met, cleveland, smk, commons };

/**
 * One page of works from one collection, or with no `source` from all of them, taking turns.
 * `cursor` is what the previous page returned as `next` (an opaque string). A collection that
 * fails is left out and named in `failed`; only when all fail does the search fail.
 * `q` empty: Commons has nothing to browse (the catalogue's top picks cover it), the museums show
 * their paintings (the Met its highlights).
 */
export async function searchOpenArt({ source, q = '', cursor = null } = {}, opts = {}) {
  const words = squash(q).slice(0, 100);
  const names = source ? [source] : COLLECTIONS;
  if (names.some((n) => !ADAPTERS[n])) throw Object.assign(new Error('Unbekannte Sammlung'), { status: 400 });
  let at = {};
  try {
    at = cursor ? JSON.parse(cursor) : {};
  } catch {
    throw Object.assign(new Error('Ungültige Seite'), { status: 400 });
  }
  const asked = names.filter((n) => at[n] !== null && (words || n !== 'wikimedia'));
  const results = await Promise.allSettled(
    asked.map((n) => ADAPTERS[n].page({ q: words, cursor: Math.max(0, Math.floor(Number(at[n])) || 0) }, opts)),
  );
  const failed = asked.filter((_, i) => results[i].status === 'rejected' || results[i].value.refused);
  if (asked.length && results.every((r) => r.status === 'rejected')) throw results[0].reason;
  const pages = results.map((r) => (r.status === 'fulfilled' ? r.value : { items: [], next: null }));
  const next = { ...at };
  asked.forEach((n, i) => {
    // A failed collection keeps its place, so "load more" tries it again.
    if (results[i].status === 'fulfilled') next[n] = pages[i].next;
  });
  const items = [];
  for (let i = 0; pages.some((p) => i < p.items.length); i++) for (const p of pages) if (p.items[i]) items.push(p.items[i]);
  const more = names.some((n) => next[n] !== null && (words || n !== 'wikimedia'));
  return { items, next: more ? JSON.stringify(next) : null, failed: failed.map((n) => NAMES[n]) };
}

/** One work by its ID ("metmuseum:436535", "cleveland:130391", "smk:KMS1029", "commons:123"). */
export async function getOpenArt(id, opts = {}) {
  if (!OPEN_ART_ID.test(String(id))) throw Object.assign(new Error('Das ist kein Werk einer Sammlung'), { status: 400 });
  const [prefix, key] = String(id).split(/:(.*)/s);
  const item = await BY_PREFIX[prefix].get(key, opts);
  if (!item || item.id !== id) throw Object.assign(new Error('Das Werk ist nicht gemeinfrei oder hat kein Bild'), { status: 404, gone: true });
  return item;
}
