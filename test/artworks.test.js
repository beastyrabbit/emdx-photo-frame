// Public-domain art: the catalogue's listings tidied into labels, the Art tab's search and
// buttons, the layout (whole, on white, with a label), and the frame bringing artworks by itself
// (ART_EVERY).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { loadConfig, DEVICE_PALETTE } from '../src/config.js';
import { Store } from '../src/state.js';
import { buildPaletteModel } from '../src/color.js';
import { FrameApp } from '../src/app.js';
import { createServer } from '../src/server.js';
import { planNext } from '../src/selector.js';
import { clipLine, artworkLayout } from '../src/render.js';
import { tidy, tidyTitle, tidyArtist, tidyDate, searchArt, getArt, downloadArt } from '../src/sources/artCatalogue.js';
import { startMockArt } from './helpers/mockArtCatalogue.js';

const cleanups = [];
after(async () => { for (const f of cleanups.reverse()) await f(); });
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `frame-${name}-`));
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  for (const end = Date.now() + ms; !fn(); ) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${fn}`);
    await sleepMs(50);
  }
}

async function photos(dir, n, w = 300, h = 500) {
  for (let i = 0; i < n; i++) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="hsl(${i * 67},45%,40%)"/><rect x="${20 + i * 15}" y="${40 + i * 30}" width="90" height="140" fill="#fff"/></svg>`;
    fs.writeFileSync(path.join(dir, `p${String(i).padStart(2, '0')}.jpg`), await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer());
  }
}

function makeApp(env) {
  const cfg = loadConfig(env);
  const app = new FrameApp(cfg, new Store(cfg.dataDir), buildPaletteModel(cfg.image.measuredPalette, DEVICE_PALETTE));
  return { cfg, app };
}

// A 360x640 portrait frame, without a display (a dry run).
const FRAME = { SERVER_HOST: '127.0.0.1', PANEL_WIDTH: '640', PANEL_HEIGHT: '360', ORIENTATION: 'portrait' };

// What is on a rendered canvas: the box of the coloured pixels (the artwork), and how many black
// pixels (the label) lie under it.
async function look(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const box = { left: Infinity, top: Infinity, right: -1, bottom: -1 };
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const p = (y * info.width + x) * 3;
      if (Math.max(data[p], data[p + 1], data[p + 2]) - Math.min(data[p], data[p + 1], data[p + 2]) < 50) continue;
      box.left = Math.min(box.left, x); box.right = Math.max(box.right, x);
      box.top = Math.min(box.top, y); box.bottom = Math.max(box.bottom, y);
    }
  }
  let label = 0;
  let above = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const p = (y * info.width + x) * 3;
      if (data[p] + data[p + 1] + data[p + 2] > 90) continue;
      if (y > box.bottom) label++; else above++;
    }
  }
  const white = (x, y) => { const p = (y * info.width + x) * 3; return data[p] > 250 && data[p + 1] > 250 && data[p + 2] > 250; };
  return { width: info.width, height: info.height, box, w: box.right - box.left + 1, h: box.bottom - box.top + 1, label, above, white };
}

test('the catalogue\'s listings become labels: the artist without dates, the title without file-name clutter, a date of the work', () => {
  assert.equal(tidyArtist('Aalto, Ilmari (1891 - 1934) (Finnish) Details of artist on Google Art Project'), 'Ilmari Aalto');
  assert.equal(tidyArtist('Raymond McIntyre (1879 - 1933) – artist (New Zealander)'), 'Raymond McIntyre');
  assert.equal(tidyArtist('Katsushika Hokusai, Japanese, 1760 - 1849'), 'Katsushika Hokusai');
  assert.equal(tidyArtist('歌川国芳 (Utagawa Kuniyoshi, 1798 - 1861)'), 'Utagawa Kuniyoshi');
  assert.equal(tidyArtist('Francesco Salviati (Italian, 1510 - 1563)'), 'Francesco Salviati');
  assert.equal(tidyArtist('Attributed to Kitao Shigemasa (Japan, 1739-1820)'), 'Kitao Shigemasa');
  assert.equal(tidyArtist('Vincent van Gogh'), 'Vincent van Gogh');
  // Nobody to name: unknown, or the archive the file came from.
  for (const a of ['Unknown author Unknown author', 'Anonymous artist of the Qing dynasty', 'Work Projects Administration Poster Collection', 'Public Record Office of Northern Ireland', '', undefined]) {
    assert.equal(tidyArtist(a), '', String(a));
  }

  assert.equal(tidyDate('circa 1816 date QS:P571,+1816-00-00T00:00:00Z/9,P1480,Q5727902'), 'c. 1816');
  assert.equal(tidyDate('1868 date QS:P571,+1868-00-00T00:00:00Z/9'), '1868');
  assert.equal(tidyDate('between 1830 and 1831 date QS:P571,+1830-00-00T00:00:00Z/8'), 'between 1830 and 1831');
  assert.equal(tidyDate('18 th century date QS:P,+1750-00-00T00:00:00Z/7'), '18th century');
  assert.equal(tidyDate('1888-89'), '1888–89');
  assert.equal(tidyDate('1887-08-08'), '1887');
  assert.equal(tidyDate('First publication: circa 1830 Reprint: 1930s, in the collection'), 'c. 1830');
  // The day the file was made, or the work photographed, is not the work's date.
  for (const d of ['2021-02-03 15:10:58', 'Taken on 5 April 2019', '大正9年出版', '', null]) assert.equal(tidyDate(d), '', String(d));

  const title = (t, a) => tidyTitle(t, a);
  assert.equal(title('Raymond McIntyre - Edward McKnight Kauffer - Google Art Project', 'Raymond McIntyre'), 'Edward McKnight Kauffer');
  assert.equal(title('Van Gogh - Starry Night - Google Art Project-x1-y0', 'Vincent van Gogh'), 'Starry Night');
  assert.equal(title('Ando Hiroshige - The Fifty-Three Stations of the Tokaido- Otsu - 1985.238 - Cleveland Museum of Art', 'Utagawa Hiroshige'), 'The Fifty-Three Stations of the Tokaido- Otsu');
  assert.equal(title('Jozef Israëls - Kinderen der zee - VBL-46 - Dordrechts Museum', 'Jozef Israëls'), 'Kinderen der zee');
  assert.equal(title('Camille au métier (1875) Claude Monet - The Barnes Foundation, Philadelphia (W366)', 'Claude Monet'), 'Camille au métier');
  assert.equal(title('Claude Monet, The Parc Monceau, 1878', 'Claude Monet'), 'The Parc Monceau');
  assert.equal(title('Katsushika Hokusai, Japanese - Pilgrims at Kirifuri Waterfall', 'Katsushika Hokusai'), 'Pilgrims at Kirifuri Waterfall');
  assert.equal(title('River scene by Vincent Schofield Wickham', 'Vincent Schofield Wickham'), 'River scene');
  assert.equal(title('What\'s right with America LCCN98512494', ''), 'What\'s right with America');
  assert.equal(title('1896-ad-for-the-sun-louis-rhead.jpg', 'Louis Rhead'), '1896 ad for the sun louis rhead');
  // A title that is a title stays as it is; a file name that is only the artist's leaves none.
  assert.equal(title('L\'Arlésienne: Madame Joseph-Michel Ginoux (Marie Julien, 1848–1911)', 'Vincent van Gogh'), 'L\'Arlésienne: Madame Joseph-Michel Ginoux (Marie Julien, 1848–1911)');
  assert.equal(title('Kanagawa-oki nami-ura - 2 waves or 2 Fuji', 'Katsushika Hokusai'), 'Kanagawa-oki nami-ura – 2 waves or 2 Fuji');
  assert.equal(title('Claude Monet 052', 'Claude Monet'), '');

  // One listing, as the catalogue sends it.
  const raw = {
    id: 'wikimedia:53894970', source: 'wikimedia', title: '063-Kerria japonica', artist: 'Abraham Jacobus Wendel', date: '1868 date QS:P571,+1868-00-00T00:00:00Z/9',
    isPublicDomain: true, license: 'Public domain', sourceUrl: 'https://commons.wikimedia.org/wiki/File%3A063-Kerria_japonica.tif',
    image: { width: 3840, height: 5550, url: 'https://s.example/w512.jpg', resizedUrls: { 512: 'https://s.example/w512.jpg', 1024: 'https://s.example/w1024.jpg', 3000: 'https://s.example/w3000.jpg' } },
  };
  assert.deepEqual(tidy(raw), {
    id: 'wikimedia:53894970', source: 'wikimedia', title: '063-Kerria japonica', artist: 'Abraham Jacobus Wendel', date: '1868', license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File%3A063-Kerria_japonica.tif',
    width: 2076, height: 3000, image: 'https://s.example/w3000.jpg', thumb: 'https://s.example/w512.jpg', // (the largest version: 3000 pixels at most)
  });
  // Not for a frame: an icon, a work that is not in the public domain, one without a picture, an address that is no address.
  assert.equal(tidy({ ...raw, id: 'svgrepo:1', source: 'svgrepo' }), null);
  assert.equal(tidy({ ...raw, isPublicDomain: false }), null);
  assert.equal(tidy({ ...raw, image: { width: 100, height: 100 } }), null);
  assert.equal(tidy({ ...raw, image: { ...raw.image, resizedUrls: { 3000: 'javascript:alert(1)' } } }), null);
  assert.equal(tidy({ ...raw, id: 'wikimedia:../../etc' }), null);
  assert.equal(tidy({ ...raw, sourceUrl: 'javascript:alert(1)' }).sourceUrl, null);
  // A photograph of a painting, listed under the photographer.
  assert.equal(tidy({ ...raw, date: 'Taken on 5 April 2019', artist: 'Didier Descouens' }).artist, '');
});

test('the catalogue: top picks or a search, without icons and works that are not in the public domain; errors say what happened', async () => {
  const art = await startMockArt();
  cleanups.push(() => art.close());
  const top = await searchArt({ baseUrl: art.url });
  assert.deepEqual(top.items.map((it) => it.id), ['wikimedia:101', 'wikimedia:102', 'met:103', 'wikimedia:104', 'wikimedia:105']);
  assert.deepEqual(art.requests[0].query, { publicDomain: 'true', limit: '60', offset: '0', rating: '5' });
  assert.equal(top.next, null);
  assert.deepEqual([top.items[0].title, top.items[0].artist, top.items[0].date], ['The Great Wave', 'Katsushika Hokusai', 'c. 1831']);
  // A search looks through everything in the public domain, and goes on page by page.
  const found = await searchArt({ baseUrl: art.url, q: ' hokusai ', limit: 1 });
  assert.deepEqual([found.items.map((it) => it.id), found.next, found.total], [['wikimedia:101'], 1, 2]);
  assert.deepEqual(art.requests.at(-1).query, { publicDomain: 'true', limit: '1', offset: '0', q: 'hokusai' });
  assert.deepEqual((await searchArt({ baseUrl: art.url, q: 'hokusai', limit: 1, offset: 1 })).items.map((it) => it.title), ['Hokusai-fuji7']);

  assert.equal((await getArt({ baseUrl: art.url, id: 'met:103' })).artist, 'Vincent van Gogh');
  await assert.rejects(getArt({ baseUrl: art.url, id: 'wikimedia:999' }), (e) => e.status === 404 && e.gone);
  await assert.rejects(getArt({ baseUrl: art.url, id: 'wikimedia:107' }), /not in the public domain/);
  await assert.rejects(getArt({ baseUrl: art.url, id: 'svgrepo:108' }), (e) => e.status === 400);
  assert.equal(art.requests.at(-1).path, '/api/artworks/wikimedia%3A107', 'an icon is not asked for at all');

  const jpg = await downloadArt(top.items[0].image);
  assert.deepEqual((({ format, width, height }) => [format, width, height])(await sharp(jpg).metadata()), ['jpeg', 600, 800]);
  await assert.rejects(downloadArt(top.items[0].image, { maxBytes: 100 }), (e) => /too large/.test(e.message) && e.gone);
  art.state.gone.add('wikimedia:101');
  await assert.rejects(downloadArt(top.items[0].image), (e) => /HTTP 404/.test(e.message) && e.gone);
  await assert.rejects(downloadArt(`${art.url}/api/artworks`), (e) => /not a picture/.test(e.message) && e.gone);
  // The catalogue down: said so, and not held against the artwork.
  art.state.down = true;
  await assert.rejects(searchArt({ baseUrl: art.url }), /having trouble \(503\)/);
  await assert.rejects(downloadArt(top.items[1].image), (e) => /HTTP 503/.test(e.message) && !e.gone);
  await assert.rejects(searchArt({ baseUrl: 'http://127.0.0.1:9' }), /Could not reach the art catalogue/);
  assert.throws(() => loadConfig({ ART_API_URL: 'ftp://x' }), /ART_API_URL must be an http\(s\) address/);
  assert.throws(() => loadConfig({ ART_EVERY: '-1' }), /ART_EVERY/);
});

test('an artwork is shown whole, on white, with its title and artist under it; never cropped, never paired', async () => {
  const art = await startMockArt();
  cleanups.push(() => art.close());
  const dataDir = tmp('art');
  const photoDir = tmp('art-photos');
  await photos(photoDir, 4, 500, 300); // (landscape photos: on this frame they are shown in pairs)
  const env = { ...FRAME, DATA_DIR: dataDir, PHOTO_DIR: photoDir, ART_API_URL: art.url };
  const { cfg, app } = makeApp(env);

  // The search, as the page gets it: with how each suits this frame.
  const found = await app.searchArtworks({});
  assert.deepEqual(found.items.map((it) => [it.id, it.fit]), [['wikimedia:101', 'ok'], ['wikimedia:102', 'ok'], ['met:103', 'ok'], ['wikimedia:104', 'shape'], ['wikimedia:105', 'small']]);
  assert.ok(found.items.every((it) => it.thumb.startsWith(art.url) && !('image' in it)));
  assert.deepEqual((await app.searchArtworks({ q: 'monet', offset: 'x' })).items.map((it) => it.title), ['Poppies']);

  // Show on the frame (push mode, no display: a dry run).
  assert.throws(() => app.startShowArtwork('wikimedia:../x'), (e) => e.status === 400);
  assert.throws(() => app.startShowArtwork('svgrepo:108'), (e) => e.status === 400);
  const showing = app.startShowArtwork('wikimedia:101');
  assert.throws(() => app.startShowArtwork('wikimedia:102'), (e) => e.status === 409);
  assert.equal(app.artworksStatus().busy.what, 'Putting the artwork on the frame');
  await showing;
  assert.equal(app.artBusy, null);
  assert.deepEqual(app.state.current.ids, ['art:wikimedia:101']);
  assert.equal(app.state.current.kind, 'artwork');
  assert.deepEqual(app.state.current.items, [{ id: 'art:wikimedia:101', source: 'art', album: 'Art', takenAt: null, title: 'The Great Wave, Katsushika Hokusai' }]);
  assert.deepEqual(app.state.history[0].titles, ['The Great Wave, Katsushika Hokusai']);
  // On the NAS: the picture as the catalogue sent it, and previews (no device.png until it is shown).
  const saved = app.artworksStatus().items;
  assert.deepEqual(saved.map((it) => [it.id, it.title, it.artist, it.date, it.license, it.keep, it.auto, it.on]),
    [['wikimedia:101', 'The Great Wave', 'Katsushika Hokusai', 'c. 1831', 'Public domain', false, false, { where: 'frame' }]]);
  assert.match(saved[0].dir, /^[0-9a-f]{12}$/);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'artworks', saved[0].dir)).sort(), ['original.jpg', 'preview.jpg', 'preview.png', 'source-1.jpg', 'thumb.jpg']);

  // Whole (600x800 keeps its shape), inside the margins, centred, with the label under it.
  const shown = await look(path.join(dataDir, 'current', 'device.png'));
  assert.deepEqual([shown.width, shown.height], [360, 640]);
  assert.ok(Math.abs(shown.w / shown.h - 600 / 800) < 0.02, `shape ${shown.w}x${shown.h}`);
  assert.ok(shown.box.left >= 48 && shown.box.right < 360 - 48 && shown.box.top >= 48, JSON.stringify(shown.box));
  assert.ok(Math.abs(shown.box.left - (359 - shown.box.right)) <= 1);
  assert.ok(shown.white(2, 2) && shown.white(357, 637) && shown.white(180, 20));
  assert.ok(shown.label > 40 && shown.above === 0, `label ${shown.label}, above ${shown.above}`);
  const { band } = artworkLayout(cfg, true);
  assert.ok(shown.box.bottom + band <= 640 - 48, 'the label stays inside the margin');

  // A wide artwork on a tall frame: still whole, with white above and below.
  await app.startShowArtwork('wikimedia:104');
  const wide = await look(path.join(dataDir, 'current', 'device.png'));
  assert.ok(Math.abs(wide.w / wide.h - 900 / 500) < 0.03, `shape ${wide.w}x${wide.h}`);
  assert.ok(wide.w <= 264 && wide.label > 40);

  // ART_CAPTION=false: no label, and the artwork gets its room.
  const plain = makeApp({ ...env, DATA_DIR: tmp('art-plain'), ART_CAPTION: 'false' });
  await plain.app.startShowArtwork('wikimedia:101');
  const bare = await look(path.join(plain.cfg.dataDir, 'current', 'device.png'));
  assert.equal(bare.label, 0);
  assert.ok(Math.abs((bare.box.top + bare.box.bottom) / 2 - 320) <= 1, 'centred on the frame');

  // Keep in rotation: it joins the photos, comes up once per round, by itself.
  await app.startKeepArtwork('wikimedia:104');
  assert.equal(app.artworksStatus().items.find((it) => it.id === 'wikimedia:104').keep, true);
  const lib = await app.loadLibrary(0);
  assert.equal(lib.items.filter((it) => it.source === 'art').length, 1);
  assert.ok(app.status().library.titles.includes('Art'));
  const kinds = [];
  const ids = [];
  for (let i = 0; i < 3; i++) { const c = await app.next('manual'); kinds.push(c.kind); ids.push(...c.ids); } // (a round: two pairs of photos and the artwork)
  assert.deepEqual(kinds.slice().sort(), ['artwork', 'pair', 'pair']);
  assert.equal(ids.filter((id) => id === 'art:wikimedia:104').length, 1);
  // (The wide artwork is as "odd" as the photos, and would make a pair with one: it never does.)
  const byId = new Map(lib.items.map((it) => [it.id, it]));
  const artFirst = { bag: ['art:wikimedia:104', ...lib.items.filter((it) => it.source !== 'art').map((it) => it.id)], excluded: {} };
  assert.deepEqual(planNext(cfg, artFirst, byId), { kind: 'artwork', items: [byId.get('art:wikimedia:104')] });
  const photoFirst = { bag: [...artFirst.bag.slice(1, 2), 'art:wikimedia:104', ...artFirst.bag.slice(2)], excluded: {} };
  assert.ok(planNext(cfg, photoFirst, byId).items.every((it) => it.source === 'folder'));
  // Keeping one straight from the search downloads it first; unticking takes it out again.
  await app.startKeepArtwork('met:103');
  assert.deepEqual(app.state.library.items.filter((it) => it.source === 'art').map((it) => it.id).sort(), ['art:met:103', 'art:wikimedia:104']);
  await app.startKeepArtwork('met:103', false);
  assert.deepEqual(app.state.library.items.filter((it) => it.source === 'art').map((it) => it.id), ['art:wikimedia:104']);
  assert.throws(() => app.startKeepArtwork('wikimedia:102', false), (e) => e.status === 404);

  // What goes wrong is on the tab: an artwork the catalogue doesn't have, a picture that is gone.
  await assert.rejects(app.startShowArtwork('wikimedia:999'), /does not have that artwork/);
  assert.match(app.artworksStatus().error.message, /does not have that artwork/);
  art.state.gone.add('wikimedia:102');
  await assert.rejects(app.startKeepArtwork('wikimedia:102'), /Could not download the artwork \(HTTP 404\)/);
  assert.ok(!app.artworksStatus().items.some((it) => it.id === 'wikimedia:102'));
  await app.startKeepArtwork('met:103');
  assert.equal(app.artworksStatus().error, null);

  // Remove: off the NAS and out of the rotation. What is on the NAS survives a restart.
  app.removeArtwork('wikimedia:104');
  assert.ok(!app.state.library.items.some((it) => it.id === 'art:wikimedia:104'));
  assert.throws(() => app.removeArtwork('wikimedia:104'), (e) => e.status === 404);
  const again = new FrameApp(cfg, new Store(dataDir), app.model);
  assert.deepEqual(again.artworksStatus().items.map((it) => [it.id, it.keep]), [['met:103', true], ['wikimedia:101', false]]);
  assert.deepEqual((await again.loadLibrary(0)).items.filter((it) => it.source === 'art').map((it) => it.id), ['art:met:103']);
  // The NAS keeps so many artworks, and all that are in the rotation.
  cfg.art.galleryMax = 1;
  await again.startShowArtwork('wikimedia:104');
  assert.deepEqual(again.artworksStatus().items.map((it) => it.id), ['wikimedia:104', 'met:103']);
  assert.ok(!fs.existsSync(path.join(dataDir, 'artworks', saved[0].dir)));

  // The label's lines: cut at a word when too long, left out when the font can't draw them.
  assert.equal(clipLine('Short title', 264, 10), 'Short title');
  assert.equal(clipLine('The Fifty-Three Stations of the Tokaido: the bridge at Otsu in the rain', 264, 10), 'The Fifty-Three Stations of the Tokaido: the…');
  assert.equal(clipLine('神奈川沖浪裏', 264, 10), '');
});

test('ART_EVERY: one in so many photos is one of the catalogue\'s top picks that suit the frame, each once per round; a photo steps in when the catalogue is down', async () => {
  const art = await startMockArt();
  cleanups.push(() => art.close());
  const dataDir = tmp('art-every');
  const photoDir = tmp('art-every-photos');
  await photos(photoDir, 5);
  const env = { ...FRAME, DATA_DIR: dataDir, PHOTO_DIR: photoDir, ART_API_URL: art.url, ART_EVERY: '3' };
  const { cfg, app } = makeApp(env);
  assert.equal(cfg.art.every, 3);
  const next = async (a = app) => { const c = await a.next('manual'); return c.kind === 'artwork' ? c.ids[0] : 'photo'; };

  // Two photos, then an artwork.
  const seen = [];
  for (let i = 0; i < 9; i++) seen.push(await next());
  assert.deepEqual(seen.map((x) => (x === 'photo' ? 'p' : 'A')).join(''), 'ppAppAppA');
  // Of the top picks, only those in the public domain that suit the frame: not the wide one, the
  // small one, the one rated lower, the icon. Each once per round.
  const artworks = seen.filter((x) => x !== 'photo');
  assert.deepEqual(artworks.slice().sort(), ['art:met:103', 'art:wikimedia:101', 'art:wikimedia:102']);
  assert.ok(app.artworksStatus().items.every((it) => it.auto && !it.keep));
  assert.equal(app.state.current.items[0].source, 'art');
  // The list of top picks is read once (and kept on the NAS), not at every artwork.
  assert.equal(art.requests.filter((r) => r.path === '/api/artworks').length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'artworks', 'pool.json'), 'utf8')).items.length, 5);
  // The photos' round goes on as before: all five were shown before one came again.
  const photosShown = app.state.history.filter((h) => !h.titles).slice(-5).flatMap((h) => h.ids);
  assert.equal(new Set(photosShown).size, 5);

  // "Never show again": the frame doesn't bring that one any more. One kept in the rotation
  // comes with the photos instead.
  app.removeArtwork('wikimedia:101', { never: true });
  await app.startKeepArtwork('met:103');
  const round2 = [];
  for (let i = 0; i < 9; i++) round2.push(await next());
  assert.deepEqual([...new Set(round2.filter((x, i) => x !== 'photo' && i % 3 === 2))], ['art:wikimedia:102']);
  assert.equal(app.state.artworks.banned['wikimedia:101'], 1);
  // (Showing it by hand lifts the ban.)
  await app.startShowArtwork('wikimedia:101');
  assert.equal(app.state.artworks.banned['wikimedia:101'], undefined);

  // The catalogue down: the list read before serves, and artworks on the NAS need no download.
  art.state.down = true;
  app.artPool.fetchedAt = 0;
  app.state.artworks.since = 2;
  assert.match(await next(), /^art:wikimedia:10[12]$/);
  // An artwork whose picture can't be downloaded now: a photo takes the turn, and the artwork the next.
  app.removeArtwork('wikimedia:101');
  app.removeArtwork('wikimedia:102');
  app.state.artworks.since = 2;
  assert.equal(await next(), 'photo');
  assert.match(app.artworksStatus().error.message, /Could not download the artwork/);
  art.state.down = false;
  assert.match(await next(), /^art:wikimedia:10[12]$/);

  // A picture that is gone from the catalogue is passed over for the next one.
  const fresh = makeApp({ ...env, DATA_DIR: tmp('art-gone'), ART_EVERY: '1' });
  art.state.gone.add('wikimedia:101').add('met:103');
  assert.deepEqual([await next(fresh.app), await next(fresh.app)], ['art:wikimedia:102', 'art:wikimedia:102'], 'the only one left, round after round');
  art.state.gone.clear();

  // ART_EVERY=1 on a frame without photos: artworks only; without the catalogue, nothing to show.
  const only = makeApp({ ...FRAME, DATA_DIR: tmp('art-only'), ART_API_URL: art.url, ART_EVERY: '1' });
  const three = [await next(only.app), await next(only.app), await next(only.app)];
  assert.deepEqual(three.slice().sort(), ['art:met:103', 'art:wikimedia:101', 'art:wikimedia:102']);
  const none = makeApp({ ...FRAME, DATA_DIR: tmp('art-none'), ART_API_URL: 'http://127.0.0.1:9', ART_EVERY: '2' });
  await assert.rejects(none.app.next('manual'), /Could not reach the art catalogue/);
  // Without ART_EVERY the frame asks the catalogue nothing by itself.
  const quiet = makeApp({ ...FRAME, DATA_DIR: tmp('art-quiet'), PHOTO_DIR: photoDir, ART_API_URL: 'http://127.0.0.1:9' });
  assert.equal((await quiet.app.next('manual')).kind, 'cover');
});

test('playlist mode: artworks take their turn in the plan, and a one-off artwork takes the place of the photo for now', async () => {
  const art = await startMockArt();
  cleanups.push(() => art.close());
  const dataDir = tmp('art-daily');
  const photoDir = tmp('art-daily-photos');
  await photos(photoDir, 6);
  const { app } = makeApp({ ...FRAME, DATA_DIR: dataDir, PHOTO_DIR: photoDir, ART_API_URL: art.url, ART_EVERY: '2', UPDATE_MODE: 'playlist', PLAYLIST_DAYS: '5' });
  await app.daily.startup();
  const slots = () => app.state.playlist.slots;
  assert.deepEqual(slots().map((s) => s.kind), ['cover', 'artwork', 'cover', 'artwork', 'cover', 'artwork']);
  assert.equal(new Set(slots().flatMap((s) => s.ids)).size, 6);
  const planned = app.artworksStatus().items.find((it) => it.on?.where === 'planned');
  assert.ok(planned && planned.on.label, 'the tab says for which day an artwork is planned');

  // One the frame had planned loses its day to a one-off: it is the next artwork again.
  const lost = slots()[1].ids[0].slice(4);
  app.unplanArtworks([`art:${lost}`]);
  assert.equal(app.state.artworks.bag[0], lost);
  assert.equal(app.artworkTurn(), true);

  // Show on the frame (a dry run: no display to wait for): the photo for now makes way.
  await app.startShowArtwork('wikimedia:104');
  assert.deepEqual(slots()[0].ids, ['art:wikimedia:104']);
  assert.deepEqual(app.state.current.ids, ['art:wikimedia:104']);
  assert.equal(app.artworksStatus().items.find((it) => it.id === 'wikimedia:104').on.where, 'frame');
});

test('the page: the Art tab searches through the NAS; its buttons need the password, take JSON, and refuse other sites', async () => {
  const art = await startMockArt();
  const dataDir = tmp('art-http');
  const photoDir = tmp('art-http-photos');
  await photos(photoDir, 2);
  const { cfg, app } = makeApp({ ...FRAME, DATA_DIR: dataDir, PHOTO_DIR: photoDir, HTTP_PORT: '18491', ART_API_URL: art.url, UI_PASSWORD: 'secret' });
  const server = createServer(cfg, app);
  app.server = server;
  await server.listen();
  cleanups.push(async () => { await server.close(); await art.close(); });
  const base = 'http://127.0.0.1:18491';
  const auth = { Authorization: `Basic ${Buffer.from('me:secret').toString('base64')}` };
  const post = async (p, body, headers = auth) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    return [r.status, await r.json().catch(() => null)];
  };
  const status = async () => (await (await fetch(`${base}/api/status`, { headers: auth })).json()).artworks;

  assert.match(await (await fetch(base, { headers: auth })).text(), /data-view="art"/);
  assert.equal((await fetch(`${base}/api/artworks/search`)).status, 401);
  const found = await (await fetch(`${base}/api/artworks/search?q=van%20gogh`, { headers: auth })).json();
  assert.deepEqual(found.items.map((it) => [it.id, it.title, it.fit]), [['met:103', 'Irises', 'ok'], ['wikimedia:104', 'Wheat Field', 'shape']]);
  assert.equal(art.requests.at(-1).query.q, 'van gogh');
  assert.equal(art.requests.at(-1).headers.authorization, undefined, 'the page\'s password is not passed on');

  assert.equal((await post('/api/artworks/show', { id: 'met:103' }, {}))[0], 401);
  assert.equal((await post('/api/artworks/show', { id: 'met:103' }, { ...auth, Origin: 'http://evil.example' }))[0], 403);
  assert.equal((await post('/api/artworks/show', '{not json'))[0], 400);
  assert.deepEqual(await post('/api/artworks/show', { id: 'http://127.0.0.1/x' }), [400, { error: 'That is not an artwork of the catalogue' }]);
  assert.equal((await post('/api/artworks/keep', { id: 'met:103', keep: false }))[0], 404);
  assert.equal(art.requests.filter((r) => r.path.startsWith('/images/')).length, 0);

  assert.deepEqual(await post('/api/artworks/show', { id: 'met:103' }), [202, { ok: true }]);
  await until(() => !app.artBusy && !app.busy);
  let a = await status();
  assert.deepEqual(a.items.map((it) => [it.id, it.on.where]), [['met:103', 'frame']]);
  const thumb = await fetch(`${base}/img/artwork/${a.items[0].dir}/thumb.jpg`, { headers: auth });
  assert.deepEqual([thumb.status, thumb.headers.get('content-type')], [200, 'image/jpeg']);
  assert.equal((await fetch(`${base}/img/artwork/${a.items[0].dir}/thumb.jpg`)).status, 401);
  assert.equal((await fetch(`${base}/img/artwork/${a.items[0].dir}/original.jpg`, { headers: auth })).status, 404);
  assert.equal((await fetch(`${base}/img/artwork/..%2F..%2Fstate.json/thumb.jpg`, { headers: auth })).status, 404);

  assert.deepEqual(await post('/api/artworks/keep', { id: 'wikimedia:102' }), [202, { ok: true }]);
  await until(() => !app.artBusy);
  a = await status();
  assert.deepEqual(a.items.map((it) => [it.id, it.keep]), [['wikimedia:102', true], ['met:103', false]]);
  assert.deepEqual(await post('/api/artworks/remove', { id: 'wikimedia:102' }), [200, { ok: true }]);
  assert.deepEqual(await post('/api/artworks/remove', { id: 'met:103', never: true }), [200, { ok: true }]);
  assert.deepEqual((await status()).items, []);
  assert.deepEqual(app.state.artworks.banned, { 'met:103': 1 });
  assert.equal((await post('/api/artworks/remove', { id: 'met:103' }))[0], 404);
  // The catalogue down: the search says so.
  art.state.down = true;
  const failed = await fetch(`${base}/api/artworks/search`, { headers: auth });
  assert.deepEqual([failed.status, (await failed.json()).error], [502, 'The art catalogue is having trouble (503); try again in a while']);
});
