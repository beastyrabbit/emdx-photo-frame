// Pictures from a text prompt: the request to Google's image model, the gallery, the page's
// buttons, and how a picture gets onto the frame in push mode and in playlist mode.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { loadConfig, DEVICE_PALETTE } from '../src/config.js';
import { Store } from '../src/state.js';
import { buildPaletteModel } from '../src/color.js';
import { FrameApp } from '../src/app.js';
import { createServer } from '../src/server.js';
import { generateImage, nearestAspect } from '../src/sources/gemini.js';
import { buildPrompt, STYLES } from '../src/art.js';
import { startMockGemini } from './helpers/mockGemini.js';

let hasOpenssl = true;
try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { hasOpenssl = false; }
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

test('the request to Google: key in a header, the frame\'s shape and size, nothing stored; errors say what to do', async () => {
  const gemini = await startMockGemini();
  cleanups.push(() => gemini.close());
  const ask = (over = {}) => generateImage({ apiKey: gemini.key, model: 'gemini-nano-banana-2.1', prompt: 'a heron', aspectRatio: '9:16', size: '2K', baseUrl: gemini.url, ...over });

  const made = await ask();
  const meta = await sharp(made.image).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['png', 192, 341]);
  const req = gemini.requests[0];
  assert.equal(`${req.method} ${req.path}`, 'POST /v1beta/interactions');
  assert.equal(req.headers['x-goog-api-key'], gemini.key);
  assert.ok(!req.path.includes(gemini.key), 'the key must not be in the address');
  assert.deepEqual(req.body, {
    model: 'gemini-nano-banana-2.1', input: [{ type: 'text', text: 'a heron' }],
    response_format: { type: 'image', aspect_ratio: '9:16', image_size: '2K' }, store: false,
  });

  // A wrong key, a used-up quota, a blocked prompt, an answer with only words in it.
  await assert.rejects(ask({ apiKey: 'wrong' }), (e) => /refused the API key: check GEMINI_API_KEY/.test(e.message) && e.status === 401 && e.spent === false);
  gemini.state.next = { status: 429, body: { error: { code: 'quota_exceeded', message: 'Quota exceeded for images per day.' } } };
  await assert.rejects(ask(), (e) => /quota is used up for now \(Quota exceeded for images per day\.\)/.test(e.message) && e.spent === false);
  gemini.state.next = { status: 400, body: { error: { code: 'failed_precondition', message: 'Billing is disabled for this project.' } } };
  await assert.rejects(ask(), /refused the request \(400\): Billing is disabled/);
  gemini.state.next = { answer: { status: 'failed', steps: [], errors: [{ code: 'image_safety', message: 'blocked' }] } };
  await assert.rejects(ask(), (e) => /sent no picture: its safety filter stopped the picture/.test(e.message) && e.spent === true);
  gemini.state.next = { answer: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'I can\'t draw that.' }] }] } };
  await assert.rejects(ask(), /sent no picture: I can't draw that\./);
  // A picture somewhere else in the answer than the documentation says is still found.
  const png = (await sharp({ create: { width: 90, height: 160, channels: 3, background: '#246' } }).png().toBuffer()).toString('base64');
  gemini.state.next = { answer: { status: 'completed', outputs: [{ inlineData: { mimeType: 'image/png', data: png } }] } };
  assert.equal((await sharp((await ask()).image).metadata()).width, 90);
  // Google down: said so, and not counted as paid for.
  await assert.rejects(ask({ baseUrl: 'http://127.0.0.1:9' }), (e) => /Could not reach Google/.test(e.message) && e.spent === false);

  assert.equal(nearestAspect(1440, 2560), '9:16');
  assert.equal(nearestAspect(2560, 1440), '16:9');
  assert.equal(nearestAspect(1600, 1200), '4:3');
  assert.equal(nearestAspect(1200, 1600), '3:4');
  const lino = STYLES.find((s) => s.id === 'linocut');
  assert.equal(buildPrompt({ width: 1440, height: 2560 }, ' a heron at dawn. ', lino),
    `a heron at dawn. Style: ${lino.text}. A tall, portrait picture that fills the whole image from edge to edge, with no border, frame or mat around it.`);
  assert.doesNotMatch(buildPrompt({ width: 2560, height: 1440 }, 'a heron', STYLES[0]), /Style:/);
});

test('the gallery: a key and a page password are needed; a picture is kept with its prompt, shown as a one-off, kept in the rotation, deleted; a daily limit', async () => {
  const gemini = await startMockGemini();
  cleanups.push(() => gemini.close());
  const dataDir = tmp('gen');
  const photoDir = tmp('gen-photos');
  await photos(photoDir, 3);
  const env = {
    DATA_DIR: dataDir, PHOTO_DIR: photoDir, SERVER_HOST: '127.0.0.1', PANEL_WIDTH: '640', PANEL_HEIGHT: '360', ORIENTATION: 'portrait',
    GEMINI_API_URL: gemini.url, GENERATE_DAILY_MAX: '3', GENERATE_SIZE: '1k',
  };
  // No key, or a key and a page anyone can open: no pictures.
  assert.throws(() => makeApp({ ...env, DATA_DIR: tmp('gen-off') }).app.startGenerate({ prompt: 'a heron' }), (e) => e.status === 403 && /GEMINI_API_KEY/.test(e.message));
  assert.throws(() => makeApp({ ...env, DATA_DIR: tmp('gen-off'), GEMINI_API_KEY: gemini.key }).app.startGenerate({ prompt: 'a heron' }), (e) => e.status === 403 && /UI_PASSWORD/.test(e.message));
  assert.throws(() => loadConfig({ ...env, GENERATE_SIZE: '8k' }), /GENERATE_SIZE must be one of 1k, 2k, 4k/);

  const { cfg, app } = makeApp({ ...env, GEMINI_API_KEY: gemini.key, UI_PASSWORD: 'secret' });
  assert.equal(cfg.generate.size, '1K');
  assert.equal(app.artStatus().enabled, true);
  assert.throws(() => app.startGenerate({ prompt: '   ' }), (e) => e.status === 400);
  assert.throws(() => app.startGenerate({ prompt: 'x'.repeat(1501) }), (e) => e.status === 400 && /too long/.test(e.message));
  assert.throws(() => app.startGenerate({ prompt: 'a heron', style: 'cubism' }), (e) => e.status === 400);
  assert.equal(gemini.requests.length, 0);

  // One at a time; while Google draws, the frame's lock is free (the display may come online).
  gemini.state.delayMs = 300;
  const first = app.startGenerate({ prompt: 'A heron in a misty polder', style: 'woodblock' });
  assert.throws(() => app.startGenerate({ prompt: 'another' }), (e) => e.status === 409);
  assert.equal(app.artStatus().busy.prompt, 'A heron in a misty polder');
  assert.equal(app.busy, null);
  const item = await first;
  gemini.state.delayMs = 0;
  assert.equal(app.generating, null);
  const sent = gemini.requests[0].body;
  assert.match(sent.input[0].text, /^A heron in a misty polder\. Style: a Japanese woodblock print/);
  assert.deepEqual(sent.response_format, { type: 'image', aspect_ratio: '9:16', image_size: '1K' });
  // Kept as Google sent it, with previews rendered for this frame (no device.png until it is shown).
  const dir = path.join(dataDir, 'generated', item.id);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['original.png', 'preview.jpg', 'preview.png', 'source-1.jpg', 'thumb.jpg']);
  const preview = await sharp(path.join(dir, 'preview.png')).metadata();
  assert.deepEqual([preview.width, preview.height], [360, 640]);
  let st = app.artStatus();
  assert.deepEqual(st.items.map((it) => [it.prompt, it.style, it.keep, it.on]), [['A heron in a misty polder', 'Japanese woodblock', false, null]]);
  assert.deepEqual([st.usage, st.style], [{ count: 1, max: 3 }, 'woodblock']);

  // Show on the frame (push mode, no display: a dry run): it is the current photo, by its prompt.
  await app.showArt(item.id);
  assert.deepEqual(app.state.current.ids, [`gen:${item.id}`]);
  assert.equal(app.state.current.items[0].title, 'A heron in a misty polder');
  assert.equal(app.state.current.items[0].path, undefined);
  assert.equal(app.artStatus().items[0].on.where, 'frame');
  const device = await sharp(path.join(dataDir, 'current', 'device.png')).metadata();
  assert.deepEqual([device.width, device.height], [360, 640]);
  // A one-off: it is not among the photos the frame picks from.
  assert.ok(!app.state.library?.items.some((it) => it.source === 'generated'));
  await app.next('manual');
  assert.ok(app.state.current.ids.every((id) => id.startsWith('file:')));

  // Keep in rotation: it joins them, and comes up within the round like any photo.
  app.keepArt(item.id, true);
  assert.equal(app.state.library.items.filter((it) => it.id === `gen:${item.id}`).length, 1);
  const shown = [];
  for (let i = 0; i < 3; i++) shown.push(...(await app.next('manual')).ids); // (the rest of this round: two photos and the picture)
  assert.equal(shown.filter((id) => id === `gen:${item.id}`).length, 1, `shown: ${shown}`);
  assert.equal(new Set(shown).size, 3);
  await app.refreshLibrary(); // (reading the folder anew keeps it in)
  assert.ok(app.state.library.items.some((it) => it.id === `gen:${item.id}`));
  assert.ok(app.status().library.titles.includes('Generated'));
  app.keepArt(item.id, false);
  assert.ok(!app.state.library.items.some((it) => it.source === 'generated'));

  // A request that fails at Google is on the page; one that reached the model counts for the day.
  gemini.state.next = { answer: { status: 'failed', steps: [], errors: [{ code: 'no_image' }] } };
  await assert.rejects(app.startGenerate({ prompt: 'nothing' }), /could not make a picture/);
  st = app.artStatus();
  assert.match(st.error.message, /sent no picture/);
  assert.equal(st.usage.count, 2);
  gemini.state.next = { status: 503, body: {} };
  await assert.rejects(app.startGenerate({ prompt: 'nothing' }), /having trouble/);
  assert.equal(app.artStatus().usage.count, 2);
  const second = await app.startGenerate({ prompt: 'A red boat' });
  assert.equal(app.artStatus().error, null);
  assert.deepEqual(app.artStatus().items.map((it) => it.prompt), ['A red boat', 'A heron in a misty polder']);
  assert.throws(() => app.startGenerate({ prompt: 'one more' }), (e) => e.status === 429 && /picture 3 of 3 for today/.test(e.message));
  // Tomorrow the count starts over.
  app.state.generated.usage.day = '2020-01-01';
  assert.equal(app.artStatus().usage.count, 0);

  // Delete: gone from the gallery and the disk. The gallery survives a restart.
  app.deleteArt(second.id);
  assert.ok(!fs.existsSync(path.join(dataDir, 'generated', second.id)));
  assert.throws(() => app.deleteArt(second.id), (e) => e.status === 404);
  const again = new FrameApp(cfg, new Store(dataDir), app.model);
  assert.deepEqual(again.artStatus().items.map((it) => it.id), [item.id]);
  // A full gallery drops its oldest pictures, but none that is kept in the rotation.
  cfg.generate.galleryMax = 1;
  cfg.generate.dailyMax = 9;
  again.keepArt(item.id, true);
  const b = await again.startGenerate({ prompt: 'b' });
  const c = await again.startGenerate({ prompt: 'c' });
  assert.deepEqual(again.artStatus().items.map((it) => it.id), [c.id, item.id]);
  assert.ok(!fs.existsSync(path.join(dataDir, 'generated', b.id)));
});

test('the page: the Generate tab\'s buttons need the password, take JSON, and refuse other sites', async () => {
  const gemini = await startMockGemini();
  const dataDir = tmp('gen-http');
  const photoDir = tmp('gen-http-photos');
  await photos(photoDir, 2);
  const { cfg, app } = makeApp({
    DATA_DIR: dataDir, PHOTO_DIR: photoDir, SERVER_HOST: '127.0.0.1', HTTP_PORT: '18481', PANEL_WIDTH: '640', PANEL_HEIGHT: '360', ORIENTATION: 'portrait',
    GEMINI_API_URL: gemini.url, GEMINI_API_KEY: gemini.key, UI_PASSWORD: 'secret',
  });
  const server = createServer(cfg, app);
  app.server = server;
  await server.listen();
  cleanups.push(async () => { await server.close(); await gemini.close(); });
  const base = 'http://127.0.0.1:18481';
  const auth = { Authorization: `Basic ${Buffer.from('me:secret').toString('base64')}` };
  const post = async (p, body, headers = auth) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    return [r.status, await r.json().catch(() => null)];
  };
  const status = async () => (await (await fetch(`${base}/api/status`, { headers: auth })).json()).generate;

  assert.equal((await post('/api/generate', { prompt: 'a heron' }, {}))[0], 401);
  assert.equal((await post('/api/generate', { prompt: 'a heron' }, { ...auth, Origin: 'http://evil.example' }))[0], 403);
  assert.equal((await post('/api/generate', '{not json'))[0], 400);
  assert.deepEqual(await post('/api/generate', { prompt: '' }), [400, { error: 'Describe the picture first' }]);
  assert.equal(gemini.requests.length, 0);
  assert.match(await (await fetch(base, { headers: auth })).text(), /data-view="generate"/);

  assert.deepEqual(await post('/api/generate', { prompt: 'A heron', style: 'ink' }), [202, { ok: true }]);
  await until(() => !app.generating);
  const g = await status();
  assert.equal(g.items.length, 1);
  assert.ok(!JSON.stringify(g).includes(gemini.key), 'the key must not be in the status');
  const { id } = g.items[0];
  const thumb = await fetch(`${base}/img/art/${id}/thumb.jpg`, { headers: auth });
  assert.deepEqual([thumb.status, thumb.headers.get('content-type')], [200, 'image/jpeg']);
  assert.equal((await fetch(`${base}/img/art/${id}/thumb.jpg`)).status, 401);
  assert.equal((await fetch(`${base}/img/art/${id}/original.png`, { headers: auth })).status, 404);

  assert.deepEqual(await post('/api/art/keep', { id, keep: true }), [200, { ok: true }]);
  assert.equal((await status()).items[0].keep, true);
  assert.deepEqual(await post('/api/art/show', { id }), [202, { ok: true }]);
  await until(() => !app.busy);
  assert.equal((await status()).items[0].on.where, 'frame');
  assert.equal((await post('/api/art/show', { id: 'nope' }))[0], 404);
  assert.deepEqual(await post('/api/art/delete', { id }), [200, { ok: true }]);
  assert.deepEqual((await status()).items, []);
  assert.equal((await post('/api/art/delete', { id }))[0], 404);
});

test('playlist mode: a display in deep sleep gets the picture at its next change, for one day, and the photo it displaced comes right after; an awake display gets it at once', { skip: !hasOpenssl && 'openssl not available', timeout: 120000 }, async () => {
  const { startFakeEmdx } = await import('./helpers/fakeEmdx.js');
  const emdx = await startFakeEmdx({ pin: '515151' });
  emdx.state.wakeOnChangeMs = 4000;
  emdx.state.sleepsAfterUpdateMs = 1000;
  const gemini = await startMockGemini();
  const dataDir = tmp('gen-daily');
  const photoDir = tmp('gen-daily-photos');
  await photos(photoDir, 12);
  const { cfg, app } = makeApp({
    DATA_DIR: dataDir, PHOTO_DIR: photoDir, EMDX_HOST: '127.0.0.1', EMDX_PORT: String(emdx.port), EMDX_PIN: '515151',
    SERVER_HOST: '127.0.0.1', HTTP_PORT: '18482', PANEL_WIDTH: '640', PANEL_HEIGHT: '360', ORIENTATION: 'portrait',
    FETCH_TIMEOUT_SEC: '20', CONNECT_ATTEMPTS: '2', WAKE_WAIT_SEC: '0.1', SLEEP_MODE: 'deep', SLEEP_DELAY_SEC: '1', WAKE_WINDOW_MIN: '0.1',
    SLEEP_CHECK_MIN: '0', MISSED_CHECK_SEC: '0', UPDATE_MODE: 'playlist', PLAYLIST_DAYS: '3', SCHEDULE: '*/10 * * * * *', TZ: 'Europe/Brussels',
    GEMINI_API_URL: gemini.url, GEMINI_API_KEY: gemini.key, UI_PASSWORD: 'secret',
  });
  Object.assign(cfg.update, { minFirstSec: 1, minTailSec: 0.2, watchEverySec: 0.3, quietSec: 0.5 });
  Object.assign(cfg.sleep, { confirmSec: 2, confirmEverySec: 0.2, ownSleepSec: 0 });
  Object.assign(cfg.display, { sleepWindowSec: 1, awakeWindowSec: 1, probeTimeoutSec: 2 });
  const server = createServer(cfg, app);
  app.server = server;
  await server.listen();
  cleanups.push(async () => { app.stopMissedWatch(); app.cancelSleep(); await server.close(); await emdx.close(); await gemini.close(); });
  const clock = app.daily.clock;
  const pl = () => app.state.playlist;
  const device = (slot) => fs.readFileSync(path.join(dataDir, 'playlist', slot.dir, 'device.png'));

  // The display has its playlist and is asleep.
  await sleepMs(clock.next(Date.now()) - Date.now() + 600);
  await app.daily.startup();
  assert.equal(await app.checkAsleep(), true);
  await until(() => !emdx.state.awake && !app.busy);
  const item = await app.startGenerate({ prompt: 'A heron' });
  const gid = `gen:${item.id}`;

  // Early in a slot, so that the next change is a few seconds off.
  await sleepMs(clock.next(Date.now()) - Date.now() + 300);
  const sends = emdx.received.length;
  const nextAt = clock.next(Date.now());
  const displaced = pl().slots.find((s) => s.at === nextAt);
  const onFrame = app.state.current.ids;
  await app.showArt(item.id);
  // Nothing went to the display: the picture waits in the slot of the next change.
  assert.equal(emdx.received.length, sends);
  assert.deepEqual(pl().slots.find((s) => s.at === nextAt).ids, [gid]);
  assert.equal(pl().slots.filter((s) => s.ids.includes(gid)).length, 1);
  assert.deepEqual(app.state.current.ids, onFrame);
  assert.match(app.daily.due(), /a picture is waiting for the display/);
  assert.deepEqual(app.artStatus().items[0].on, { where: 'planned', at: nextAt, label: app.daily.label(nextAt) });
  // The photo that lost its day is the next one planned.
  assert.deepEqual(app.state.bag.slice(0, displaced.ids.length), displaced.ids);

  // The change: the display comes online and gets a playlist that starts with the picture.
  await sleepMs(nextAt - Date.now() + 100);
  await app.scheduled('schedule');
  await until(() => emdx.received.length > sends);
  const got = emdx.received.at(-1);
  const art = pl().slots.find((s) => s.ids.includes(gid));
  assert.ok(got.images[0].equals(device(art)), 'the playlist after the change starts with the picture');
  assert.deepEqual(app.state.current.ids, [gid]);
  assert.equal(app.state.current.kind, 'generated picture');
  assert.equal(app.artStatus().items[0].on.where, 'frame');
  assert.equal(app.daily.due(), null);
  assert.ok(pl().slots.some((s) => s.at > art.at && displaced.ids.every((id) => s.ids.includes(id))), 'the displaced photo is planned again');
  assert.equal(pl().slots.filter((s) => s.ids.includes(gid)).length, 1, 'a one-off');

  // An awake display (someone pressed its button): the picture replaces the photo for now.
  const second = await app.startGenerate({ prompt: 'A red boat' });
  await until(() => !app.busy && !app.daily.watch && !emdx.state.awake);
  await sleepMs(clock.next(Date.now()) - Date.now() + 1200);
  await until(() => !app.busy && !app.daily.watch);
  emdx.wake();
  const before = emdx.received.length;
  await app.showArt(second.id);
  await until(() => emdx.received.length > before);
  const now = pl().slots.find((s) => s.ids.includes(`gen:${second.id}`));
  assert.ok(now.at <= Date.now());
  assert.ok(emdx.received.at(-1).images[0].equals(device(now)));
  assert.deepEqual(app.state.current.ids, [`gen:${second.id}`]);
});
