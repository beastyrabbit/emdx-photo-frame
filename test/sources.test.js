import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchArt } from '../src/sources/artCatalogue.js';
import { searchOpenArt, getOpenArt } from '../src/sources/openArt.js';
import { searchPhotos } from '../src/sources/photos.js';

// Answers by URL, the way the real APIs do (shapes as they answered on 19 November 2026).
function stubFetch(t, route) {
  const asked = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    asked.push(String(url));
    const hit = route(new URL(String(url)));
    if (typeof hit === 'number') return new Response('{}', { status: hit });
    return new Response(JSON.stringify(hit.body ?? hit), { status: 200, headers: hit.headers || {} });
  });
  return asked;
}

const metObject = (id, pd) => ({
  objectID: id, isPublicDomain: pd, title: 'Spring Flowers', artistDisplayName: 'Gustave Courbet', objectDate: '1855',
  objectURL: `https://www.metmuseum.org/art/collection/search/${id}`,
  primaryImage: pd ? `https://images.metmuseum.org/${id}.jpg` : '', primaryImageSmall: pd ? `https://images.metmuseum.org/${id}-small.jpg` : '',
  measurements: [{ elementName: 'Overall', elementMeasurements: { Height: 73, Width: 100 } }],
});
const cmaWork = (id) => ({
  id, title: 'Vase of Flowers', creation_date: '1660s', creators: [{ description: 'Jan Davidsz. de Heem (Dutch, 1606–1684)' }],
  url: `https://clevelandart.org/art/${id}`, share_license_status: 'CC0',
  images: { web: { url: `https://cdn/${id}_web.jpg`, width: '685', height: '900' }, print: { url: `https://cdn/${id}_print.jpg`, width: '2589', height: '3400' } },
});

test('the catalogue is asked for one collection, not filtered afterwards', async (t) => {
  const asked = stubFetch(t, () => ({ items: [], total: 0 }));
  await searchArt({ q: 'flower', source: 'met' });
  const url = new URL(asked[0]);
  assert.equal(url.searchParams.get('source'), 'met');
  assert.equal(url.searchParams.get('q'), 'flower');
  await searchArt({ q: 'flower', topPicks: true });
  assert.equal(new URL(asked[1]).searchParams.get('rating'), '5');
});

test('all collections take turns; the Met keeps only public-domain works; one failing collection is named', async (t) => {
  const asked = stubFetch(t, (u) => {
    if (u.host === 'collectionapi.metmuseum.org' && u.pathname.endsWith('/search')) return { total: 2, objectIDs: [1, 2] };
    if (u.host === 'collectionapi.metmuseum.org') return metObject(Number(u.pathname.split('/').at(-1)), u.pathname.endsWith('/2'));
    if (u.host === 'openaccess-api.clevelandart.org') return { info: { total: 30 }, data: [cmaWork(10), cmaWork(11)] };
    if (u.host === 'api.smk.dk') return 503;
    if (u.host === 'commons.wikimedia.org') return { query: { pages: [] } };
    throw new Error(`unexpected ${u}`);
  });
  const page = await searchOpenArt({ q: 'flowers' });
  assert.deepEqual(page.items.map((w) => w.id), ['metmuseum:2', 'cleveland:10', 'cleveland:11']);
  assert.deepEqual(page.failed, ['SMK']);
  const met = page.items[0];
  assert.equal(met.artist, 'Gustave Courbet');
  assert.equal(met.sizeKnown, false); // the shape comes from the painting's measurements
  assert.ok(met.width > met.height);
  const cma = page.items[1];
  assert.equal(cma.artist, 'Jan Davidsz. de Heem');
  assert.equal(cma.image, 'https://cdn/10_print.jpg');
  assert.deepEqual([cma.width, cma.height], [2589, 3400]);
  const metSearch = new URL(asked.find((a) => a.includes('/search?')));
  assert.equal(metSearch.searchParams.get('medium'), 'Paintings');
  // Cleveland goes on after its two; SMK, which failed, is asked again from the start.
  const next = JSON.parse(page.next);
  assert.equal(next.cleveland, 2);
  assert.equal(next.smk, undefined);
  assert.equal(next.met, null);
});

test('one collection only, and a work found again by its ID', async (t) => {
  stubFetch(t, (u) => {
    if (u.pathname === '/api/artworks/') return { info: { total: 2 }, data: [cmaWork(10), { ...cmaWork(12), share_license_status: 'Copyrighted' }] };
    if (u.pathname === '/api/artworks/10') return { data: cmaWork(10) };
    throw new Error(`unexpected ${u}`);
  });
  const page = await searchOpenArt({ source: 'cleveland', q: 'flowers' });
  assert.deepEqual(page.items.map((w) => w.id), ['cleveland:10']);
  assert.equal(page.next, null);
  assert.equal((await getOpenArt('cleveland:10')).title, 'Vase of Flowers');
  await assert.rejects(() => getOpenArt('cleveland:../x'), /kein Werk/);
});

test('photos: Openverse orders, the directory names the files; without Openverse the directory searches itself', async (t) => {
  const photo = (slug) => ({
    slug, link: `https://wordpress.org/photos/photo/${slug}/`, date: '2025-04-01T10:00:00',
    content: { rendered: '<p>Orange marigold flowers in the sun.</p>' },
    _embedded: {
      author: [{ name: 'Balu B' }],
      'wp:featuredmedia': [{ source_url: `https://pd.w.org/${slug}.jpg`, media_details: { width: 3000, height: 4000, sizes: { medium_large: { source_url: `https://pd.w.org/${slug}-768.jpg` } } } }],
    },
  });
  let openverse = 200;
  const asked = stubFetch(t, (u) => {
    if (u.host === 'api.openverse.org') {
      if (openverse !== 200) return openverse;
      return { page_count: 3, results: [{ foreign_landing_url: 'https://wordpress.org/photos/photo/bbbbbb2222/' }, { foreign_landing_url: 'https://wordpress.org/photos/photo/aaaaaa1111/' }] };
    }
    if (u.searchParams.get('slug')) return [photo('aaaaaa1111'), photo('bbbbbb2222')];
    if (u.searchParams.get('search')) return { body: [photo('cccccc3333')], headers: { 'x-wp-totalpages': '1' } };
    throw new Error(`unexpected ${u}`);
  });
  const page = await searchPhotos({ q: 'flowers' });
  assert.deepEqual(page.items.map((p) => p.id), ['wpphoto:bbbbbb2222', 'wpphoto:aaaaaa1111']); // Openverse's order
  assert.equal(page.next, '2');
  const p = page.items[0];
  assert.deepEqual([p.title, p.artist, p.license, p.image, p.thumb], ['Orange marigold flowers in the sun.', 'Balu B', 'CC0', 'https://pd.w.org/bbbbbb2222.jpg', 'https://pd.w.org/bbbbbb2222-768.jpg']);
  openverse = 429;
  const fallback = await searchPhotos({ q: 'flowers' });
  assert.deepEqual(fallback.items.map((x) => x.id), ['wpphoto:cccccc3333']);
  assert.equal(new URL(asked.at(-1)).searchParams.get('orderby'), 'relevance');
});
