// Public-domain artworks from the paperlesspaper art catalogue (art.paperlesspaper.de; the code
// behind it: github.com/paperlesspaper/paperlesspaper-art). The catalogue lists works scraped from
// Wikimedia Commons, the Metropolitan Museum and the Art Institute of Chicago, with a rating by
// its curators, and serves each as a JPEG of up to 3000 pixels. No key is needed.
//
// The API (as its README documents it, and as it answered in November 2026):
//   GET <base>/api/artworks?publicDomain=true&rating=5&q=…&limit=…&offset=…
//     -> { items: [{ id, source, title, artist, date, license, isPublicDomain, sourceUrl,
//          image: { width, height, resizedUrls: { 512, 1024, 3000 } } }], total }
//   GET <base>/api/artworks/<id>  -> { item }
// The catalogue also holds icons (source "svgrepo"), which are not for a frame, and works that are
// not in the public domain: both are left out here.
import { log } from '../log.js';

export const ART_URL = 'https://art.paperlesspaper.de';
const SOURCES = ['wikimedia', 'met', 'artic'];
export const ART_ID = /^(wikimedia|met|artic):[A-Za-z0-9._-]{1,40}$/;
const PAGE = 200; // the most the catalogue gives at once
const AGENT = 'emdx-photo-frame';

const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The catalogue's names, titles and dates come as its sources had them: often a file name from
// Wikimedia Commons ("Claude Monet - Vue d'un port - Google Art Project"), an artist with dates
// and a nationality, a date with Wikidata codes behind it. What follows turns them into what a
// label next to the work would say. Where it can't tell, it leaves the text as it is.
const NATIONS = 'American|British|English|Scottish|Welsh|Irish|French|German|Dutch|Flemish|Belgian|Italian|Spanish|Portuguese|Japanese|Chinese|Korean|Indian|Russian|Austrian|Swiss|Danish|Swedish|Norwegian|Finnish|Polish|Czech|Hungarian|Greek|Mexican|Canadian|Australian';
const latin = (s) => /^[\x20-\x7e -ɏ‐-‧]*$/.test(s);

// "Aalto, Ilmari (1891 - 1934) (Finnish) Details…" -> "Ilmari Aalto". Empty when the catalogue
// names no artist (unknown, or the archive or photographer the file came from).
export function tidyArtist(raw) {
  let a = squash(raw).replace(/\s*\[\d+\]/g, '');
  if (!a || /\b(?:unknown|anonymous|unidentified)\b/i.test(a)) return '';
  a = a.replace(/\s*Details (?:of artist )?on Google Art Project.*$/i, '');
  // "歌川国芳 (Utagawa Kuniyoshi, 1798 - 1861)", "Francesco Salviati (Italian, 1510 - 1563)"
  const dated = /^(.*?)\s*\(([^()]*?)[,\s]*(?:c\.\s*|ca\.\s*|circa\s*)?\d{3,4}\b[^()]*\).*$/.exec(a);
  if (dated) {
    const inside = dated[2].replace(/[,\s]+$/, '');
    a = !latin(dated[1]) && inside && latin(inside) && !new RegExp('^(?:' + NATIONS + ')$', 'i').test(inside) ? inside : dated[1];
  }
  a = a.split(/\s+[-–—]\s+/)[0]; // "… – artist", "… - late 1867"
  a = a.replace(new RegExp(',\\s*(?:' + NATIONS + ')\\b.*$', 'i'), ''); // "Benjamin West, English (born America)"
  a = a.replace(/[,\s]+\d{4}\s*[-–—]?\s*(?:\d{4})?\s*$/, ''); // "Amsden, Dora, 1858-"
  a = a.replace(/^Attributed to\s+/i, '').replace(/\s*\([^)]*\)\s*$/, ''); // "Giovanni di Paolo (Giovanni di Paolo di Grazia)"
  const half = a.length >> 1; // "Unknown author Unknown author"
  if (a.length > 6 && a.length % 2 === 1 && a.slice(0, half) === a.slice(half + 1)) a = a.slice(0, half);
  const m = /^([^\s,]{2,30}),\s*([^,]{2,40})$/.exec(a); // "Aalto, Ilmari"
  if (m) a = m[2] + ' ' + m[1];
  if (/\b(?:Collection|Office|Library|Museum|Archives?|Administration|Project|Corp|Company|Inc)\b/i.test(a)) return '';
  return a.length < 2 || a.length > 60 || /\d{3}/.test(a) ? '' : a;
}

// "circa 1816 date QS:P571,+1816-00-00T00:00:00Z/9,P1480,Q5727" -> "c. 1816". Empty when the date
// is that of the file or of a photograph of the work ("2021-02-03 15:10:58", "Taken on …").
export function tidyDate(raw) {
  let d = squash(raw).replace(/\s*\bdate QS:.*$/i, '').replace(/\s*QS:P\d*.*$/i, '');
  if (!d || /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(d) || /^taken\b/i.test(d)) return '';
  const day = /^(\d{4})-\d{2}-\d{2}$/.exec(d); // "1887-08-08"
  if (day) return day[1];
  d = d.replace(/^(?:circa|ca\.?|c\.)\s*/i, 'c. ').replace(/(\d)\s+(st|nd|rd|th)\b/g, '$1$2').replace(/\s*[-–—]\s*/g, '–');
  if (d.length <= 28 && latin(d) && /\d/.test(d)) return d;
  // Something longer ("First publication: circa 1830 …"): the year in it.
  const year = /\b(1[0-9]{3}|20[0-2][0-9])\b/.exec(d);
  return year ? (/\b(?:circa|ca\.|c\.)\s*$/i.test(d.slice(0, year.index)) ? 'c. ' : '') + year[1] : '';
}

const HOUSES = /\b(?:Museum|Mus[ée]e|Museo|Museu|Gallery|Galleri[ae]?|Galerie|Foundation|Collection|Institute|Library|Rijksmuseum|Mauritshuis|Louvre|Prado|Uffizi|Hermitage|Pinakothek|Kunsthalle|Kunsthaus|Nationalmuseum)\b/i;
const CODE = /^(?:[A-Z]{1,6}[-.\s]?)?\d[\d./a-z-]*$/i; // an accession number: "1985.238", "VBL-46"

// "Raymond McIntyre - Edward McKnight Kauffer - Google Art Project" -> "Edward McKnight Kauffer".
// Empty when nothing but the artist's name and a number is left ("Claude Monet 052").
export function tidyTitle(raw, artist = '') {
  let t = squash(raw).replace(/_/g, ' ').replace(/\.(?:jpe?g|png|tiff?|webp)$/i, '');
  t = t.replace(/\s*[-–—,]?\s*Google Art Project.*$/i, '');
  t = t.replace(/\s*\((?:cropped|edited|retouched|restored)[^)]*\)/gi, '');
  t = t.replace(/\s+LCCN\s?\d+$/i, '').replace(/\s+LACMA\s+\S+$/i, '').replace(/\s*\(\d{6,}\)$/, '').replace(/\s*\(W\s?\d+\)$/i, '');
  const words = artist.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 4);
  const hasArtist = (part) => words.some((w) => part.toLowerCase().split(/[^\p{L}]+/u).includes(w));
  if (artist) {
    // "Camille au métier (1875) Claude Monet - The Barnes Foundation, Philadelphia"
    t = t.replace(new RegExp('\\s*\\(\\d{4}\\)\\s*' + escapeRe(artist) + '\\b.*$', 'i'), '');
    t = t.replace(new RegExp('\\s+by\\s+' + escapeRe(artist) + '$', 'i'), '');
  }
  // "Artist - Title - number - Museum": the parts around the title go.
  const parts = t.split(/\s+[-–—]\s+/).filter(Boolean);
  if (parts.length > 1 && hasArtist(parts[0])) parts.shift();
  while (parts.length > 1 && (HOUSES.test(parts.at(-1)) || CODE.test(parts.at(-1)))) parts.pop();
  t = parts.join(' – ');
  if (artist) t = t.replace(new RegExp('^' + escapeRe(artist) + ',\\s+', 'i'), ''); // "Claude Monet, The Parc Monceau, 1878"
  t = t.replace(/,\s*(?:1[0-9]{3}|20[0-2][0-9])$/, '').replace(/^[-–—\s]+|[-–—,\s]+$/g, '');
  if (t && /^[a-z0-9-]+$/.test(t) && t.includes('-')) t = t.replace(/-/g, ' '); // "1896-ad-for-the-sun"
  // Nothing of a title left: "Claude Monet 052".
  const rest = t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !/^\d+$/.test(w) && !words.includes(w) && w.length > 2);
  return rest.length ? t : '';
}

// One catalogue entry as the frame uses it, or null when it is not for a frame (an icon, a work
// that is not in the public domain, one without a picture).
export function tidy(raw) {
  if (!raw || typeof raw !== 'object' || !SOURCES.includes(raw.source)) return null;
  const id = String(raw.id || '');
  if (!ART_ID.test(id) || raw.isPublicDomain !== true) return null;
  const im = raw.image || {};
  const width = Number(im.width);
  const height = Number(im.height);
  if (!(width > 0 && height > 0)) return null;
  const sized = Object.entries(im.resizedUrls || im.localResizedPaths || {})
    .map(([k, url]) => [Number(k), String(url)])
    .filter(([k, url]) => k > 0 && /^https?:\/\//i.test(url))
    .sort((a, b) => a[0] - b[0]);
  if (!sized.length) return null;
  const [box, image] = sized.at(-1); // the largest: at most `box` pixels on its long side
  const thumb = (sized.find(([k]) => k >= 400) || sized[0])[1];
  // ("Taken on 5 April 2019": a photograph of the work, under the photographer's name.)
  const artist = /^\s*taken\b/i.test(String(raw.date ?? '')) ? '' : tidyArtist(raw.artist);
  // The picture as it downloads: the largest version is not enlarged beyond the original.
  const k = Math.min(1, box / Math.max(width, height));
  const date = tidyDate(raw.date);
  let title = tidyTitle(raw.title, artist || squash(raw.artist)).slice(0, 200);
  const year = /\d{4}/.exec(date)?.[0]; // "1665 Girl with a Pearl Earring", painted in 1665
  if (year && title.startsWith(`${year} `) && /\p{L}{3}/u.test(title.slice(5))) title = title.slice(5).replace(/^[-–—]\s*/, '');
  return {
    id, source: raw.source, title, artist, date,
    license: squash(raw.license).slice(0, 60) || 'Public domain',
    sourceUrl: /^https?:\/\//i.test(raw.sourceUrl || '') ? String(raw.sourceUrl) : null,
    width: Math.round(width * k), height: Math.round(height * k), image, thumb,
  };
}

async function getJson(url, timeoutMs) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    throw new Error(timedOut
      ? `The art catalogue did not answer within ${Math.round(timeoutMs / 1000)} s`
      : `Could not reach the art catalogue (${err.cause?.code || err.cause?.message || err.message})`);
  }
  if (res.status === 404) throw Object.assign(new Error('The art catalogue does not have that artwork (any more)'), { status: 404, gone: true });
  if (res.status === 401 || res.status === 403) throw new Error(`The art catalogue refused the request (${res.status}): it may ask for a key now`);
  if (!res.ok) throw new Error(`The art catalogue is having trouble (${res.status}); try again in a while`);
  try {
    return await res.json();
  } catch {
    throw new Error('The art catalogue sent something that is not JSON');
  }
}

const api = (baseUrl, path) => `${String(baseUrl || ART_URL).replace(/\/+$/, '')}${path}`;

// A page of public-domain artworks: the curators' top picks (rating 5), or with `q` everything
// that matches it. Returns { items, total, next }: `next` is the offset to go on from (null: that
// was all); `total` counts what the catalogue has, icons included, so it is an upper bound.
export async function searchArt({ baseUrl, q = '', offset = 0, limit = 60, timeoutMs = 30000 } = {}) {
  const params = new URLSearchParams({ publicDomain: 'true', limit: String(Math.min(PAGE, limit)), offset: String(offset) });
  const words = squash(q).slice(0, 100);
  if (words) params.set('q', words);
  else params.set('rating', '5');
  const body = await getJson(api(baseUrl, `/api/artworks?${params}`), timeoutMs);
  const got = Array.isArray(body?.items) ? body.items : [];
  const total = Number(body?.total) || 0;
  const end = offset + got.length;
  return { items: got.map(tidy).filter(Boolean), total, next: got.length && end < total ? end : null };
}

// All the top picks (a few hundred; a handful of requests).
export async function topPicks({ baseUrl, timeoutMs = 30000, max = 5000 } = {}) {
  const items = [];
  const seen = new Set();
  for (let offset = 0; offset != null && offset < max;) {
    const page = await searchArt({ baseUrl, offset, limit: PAGE, timeoutMs });
    for (const it of page.items) if (!seen.has(it.id)) { seen.add(it.id); items.push(it); }
    offset = page.next;
  }
  return items;
}

export async function getArt({ baseUrl, id, timeoutMs = 30000 }) {
  if (!ART_ID.test(String(id))) throw Object.assign(new Error('That is not an artwork of the catalogue'), { status: 400 });
  const body = await getJson(api(baseUrl, `/api/artworks/${encodeURIComponent(id)}`), timeoutMs);
  const item = tidy(body?.item);
  if (!item || item.id !== id) throw Object.assign(new Error('That artwork is not in the public domain, or has no picture'), { status: 404, gone: true });
  return item;
}

// The picture itself. `gone` on the error: the trouble is this artwork (no longer there, not a
// picture, too large), not the network or the catalogue being down.
export async function downloadArt(url, { maxBytes = 40e6, timeoutMs = 60000 } = {}) {
  if (!/^https?:\/\//i.test(String(url))) throw Object.assign(new Error('The artwork has no usable address'), { gone: true });
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw Object.assign(new Error(`HTTP ${res.status}`), { gone: res.status >= 400 && res.status < 500 && ![408, 429].includes(res.status) });
    }
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) throw Object.assign(new Error(`not a picture (${type || 'no type'})`), { gone: true });
    if (Number(res.headers.get('content-length')) > maxBytes) throw Object.assign(new Error('the file is too large'), { gone: true });
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) throw Object.assign(new Error('the file is too large'), { gone: true });
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    const why = timedOut ? `no answer within ${Math.round(timeoutMs / 1000)} s` : err.cause?.code || err.message;
    log.debug(`Artwork download failed: ${url}: ${why}`);
    throw Object.assign(new Error(`Could not download the artwork (${why})`), { gone: !!err.gone });
  }
}
