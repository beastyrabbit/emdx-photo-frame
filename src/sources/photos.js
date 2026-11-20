// Photos from the WordPress Photo Directory (wordpress.org/photos): moderated photos under CC0,
// originals of 2000 to 7500 pixels, no key, no attribution or hotlinking rules. Its own search
// ranks loosely (a dog in a flower bed comes before flowers), so a search goes through Openverse
// (api.openverse.org, also without a key), limited to this directory, and the directory's own API
// then names the files. When Openverse is not available (it allows 20 anonymous requests a
// minute and 200 a day), the directory's own search answers instead. Without a search the
// directory shows its newest photos.
import { getJson, stripHtml } from './openArt.js';

const WP = 'https://wordpress.org/photos/wp-json/wp/v2/photos';
const OPENVERSE = 'https://api.openverse.org/v1/images/';
const PAGE = 24;
const NAME = 'Das WordPress-Fotoverzeichnis';
export const PHOTO_ID = /^wpphoto:[a-z0-9]{6,32}$/;
const SLUG = /\/photos\/photo\/([a-z0-9]{6,32})\/?$/;

export function tidyPhoto(p) {
  const media = p?._embedded?.['wp:featuredmedia']?.[0];
  const md = media?.media_details;
  if (!PHOTO_ID.test(`wpphoto:${p?.slug}`) || !/^https:\/\//.test(media?.source_url || '') || !(md?.width > 0 && md?.height > 0)) return null;
  const sizes = md.sizes || {};
  const text = stripHtml(p.content?.rendered);
  return {
    id: `wpphoto:${p.slug}`,
    source: 'wordpress',
    // The directory's photos have no titles, only a description.
    title: (text.length > 90 ? `${text.slice(0, 88).replace(/\s+\S*$/, '')} …` : text) || 'Foto',
    artist: stripHtml(p._embedded?.author?.[0]?.name).slice(0, 60),
    date: String(p.date || '').slice(0, 4),
    license: 'CC0',
    sourceUrl: /^https:\/\//.test(p.link || '') ? p.link : null,
    width: md.width,
    height: md.height,
    sizeKnown: true,
    image: media.source_url,
    thumb: (sizes.medium_large || sizes.large || sizes.medium)?.source_url || media.source_url,
  };
}

const embed = '_embed=wp:featuredmedia,author';

async function bySlugs(slugs, opts) {
  if (!slugs.length) return [];
  const { body } = await getJson(`${WP}?slug=${slugs.join(',')}&per_page=${slugs.length}&${embed}`, NAME, opts);
  const found = new Map((Array.isArray(body) ? body : []).map((p) => [p.slug, tidyPhoto(p)]));
  return slugs.map((s) => found.get(s)).filter(Boolean);
}

async function directory({ q, page }, opts) {
  const params = new URLSearchParams({ per_page: String(PAGE), page: String(page) });
  if (q) {
    params.set('search', q);
    params.set('orderby', 'relevance');
  }
  const { body, headers } = await getJson(`${WP}?${params}&${embed}`, NAME, opts);
  const pages = Number(headers.get('x-wp-totalpages')) || 0;
  return { items: (Array.isArray(body) ? body : []).map(tidyPhoto).filter(Boolean), next: page < pages ? `wp:${page + 1}` : null, failed: [] };
}

async function openverse({ q, page }, opts) {
  // Openverse gives anonymous callers at most 20 a page.
  const params = new URLSearchParams({ q, source: 'wordpress', license: 'cc0', page_size: '20', page: String(page) });
  const { body } = await getJson(`${OPENVERSE}?${params}`, 'Openverse', opts);
  const slugs = (body?.results || []).map((r) => SLUG.exec(r.foreign_landing_url || '')?.[1]).filter(Boolean);
  return { items: await bySlugs([...new Set(slugs)], opts), next: page < (Number(body?.page_count) || 0) ? `ov:${page + 1}` : null, failed: [] };
}

/**
 * One page of photos. `cursor` is the `next` of the page before: "ov:2" or "wp:2", so a search
 * stays with the source it started with (they order and page differently).
 */
export async function searchPhotos({ q = '', cursor = null } = {}, opts = {}) {
  const words = String(q ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const [, via, n] = /^(ov|wp):(\d{1,4})$/.exec(String(cursor ?? '')) || [];
  const page = Math.max(1, Number(n) || 1);
  if (!words || via === 'wp') return directory({ q: words, page }, opts);
  if (via === 'ov') return openverse({ q: words, page }, opts);
  try {
    return await openverse({ q: words, page: 1 }, opts);
  } catch (err) {
    // Openverse is a help for the order, not a must: the directory's own search still finds them.
    if (err.message.startsWith(NAME)) throw err;
    return directory({ q: words, page: 1 }, opts);
  }
}

export async function getPhoto(id, opts = {}) {
  if (!PHOTO_ID.test(String(id))) throw Object.assign(new Error('Das ist kein Foto aus dem Verzeichnis'), { status: 400 });
  const [item] = await bySlugs([String(id).slice('wpphoto:'.length)], opts);
  if (!item) throw Object.assign(new Error('Das Foto gibt es nicht mehr'), { status: 404, gone: true });
  return item;
}
