import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { loadFrames, DEVICE_PALETTE } from '../src/config.js';
import { buildPaletteModel } from '../src/color.js';
import { Manager } from '../src/manager/index.js';
import { ManagerStore } from '../src/manager/store.js';
import { Secrets } from '../src/manager/secrets.js';
import { cadenceClock, cadenceFromCron } from '../src/manager/clock.js';
import { tcpProbe } from '../src/manager/runtime.js';
import { normalize, undecodable, MAX_FILE, MIN_FREE } from '../src/manager/media.js';
import { batteryEstimate } from '../src/manager/status.js';
import { Immich } from '../src/manager/integrations.js';
import { createServer } from '../src/server.js';
import { startFakeEmdx } from './helpers/fakeEmdx.js';

const H = 3600000,
  DAY = 24 * H;
const stamp = (v) => Date.parse(v);
async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function setup(t, { fake, count = 12, live = false } = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-test-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const photos = path.join(data, 'photos');
  fs.mkdirSync(photos);
  let original;
  const livePath = new URL('../.design/live-data/state.json', import.meta.url);
  if (live && fs.existsSync(livePath))
    original = JSON.parse(fs.readFileSync(livePath, 'utf8'));
  const names = original
    ? original.library.items.map((p) => path.basename(p.path))
    : Array.from({ length: count }, (_, i) => `photo-${i}.jpg`);
  for (let i = 0; i < names.length; i++)
    await sharp({
      create: {
        width: 72,
        height: 128,
        channels: 3,
        background: { r: 20 + i * 6, g: 30 + i * 2, b: 130 - i * 3 },
      },
    })
      .jpeg()
      .toFile(path.join(photos, names[i]));
  if (original) {
    fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify(original));
    for (const slot of original.playlist.slots) {
      const dir = path.join(data, 'playlist', slot.dir);
      fs.mkdirSync(dir, { recursive: true });
      await sharp(path.join(photos, names[0]))
        .png()
        .toFile(path.join(dir, 'device.png'));
      await sharp(path.join(photos, names[0]))
        .jpeg()
        .toFile(path.join(dir, 'thumb.jpg'));
    }
    fs.mkdirSync(path.join(data, 'current'), { recursive: true });
    await sharp(path.join(photos, names[0]))
      .png()
      .toFile(path.join(data, 'current', 'device.png'));
  }
  const env = {
    DATA_DIR: data,
    PHOTO_DIR: photos,
    SERVER_HOST: '127.0.0.1',
    HTTP_PORT: String(await freePort()),
    EMDX_HOST: fake ? '127.0.0.1' : '',
    EMDX_PORT: String(fake?.port || 1515),
    EMDX_PIN: '123456',
    SLEEP_MODE: 'deep',
    UPDATE_MODE: 'playlist',
    PLAYLIST_DAYS: '3',
    SCHEDULE: '0 0,6-23 * * *',
    TZ: 'Europe/Berlin',
    ORIENTATION: 'portrait',
    PANEL_WIDTH: '72',
    PANEL_HEIGHT: '128',
    FACES: 'off',
    RUN_ON_START: 'false',
    WAKE_WAIT_SEC: '0',
  };
  const seeds = loadFrames(env);
  const model = buildPaletteModel(
    seeds[0].cfg.image.measuredPalette,
    DEVICE_PALETTE,
  );
  const manager = new Manager(seeds, model, { env });
  await manager.initialize();
  const frame = manager.frame('main');
  return { manager, frame, data, photos, env, original, seeds, model };
}

test('release #1: adoption preserves real paths, skips bad/hidden files, serves health before decoding and blocks actions', async (t) => {
  const { seeds, model, env, data, photos } = await setup(t, { count: 0 });
  const nested = path.join(photos, '2024', 'IMG.jpg');
  const art = path.join(data, 'artworks', 'kept.jpg');
  for (const file of [nested, art, path.join(photos, '.hidden.jpg'), path.join(photos, '@eaDir', 'cache.jpg')]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await sharp({ create: { width: 120, height: 80, channels: 3, background: '#ac7020' } }).jpeg().toFile(file);
  }
  fs.writeFileSync(path.join(photos, 'corrupt.jpg'), 'not pixels');
  const oversized = path.join(photos, 'oversized.jpg');
  fs.closeSync(fs.openSync(oversized, 'w'));
  fs.truncateSync(oversized, MAX_FILE + 1);
  const legacy = { version: 1, current: { ids: ['file:missing.jpg'], since: Date.now() }, excluded: {}, history: [], batteryLog: [], library: { items: [
    { id: 'file:2024/IMG.jpg', path: nested },
    { id: 'art:kept', path: art, album: 'Kunst' },
    { id: 'file:missing.jpg', path: path.join(photos, 'missing.jpg') },
  ] } };
  fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify(legacy));
  const manager = new Manager(seeds, model, { env, root: path.join(data, 'adoption') });
  const server = createServer(manager.base, [], { manager });
  manager.server = server;
  await server.listen();
  t.after(() => server.close());
  let release, entered;
  const blocked = new Promise((r) => { release = r; });
  const started = new Promise((r) => { entered = r; });
  const ingest = manager.ingest.bind(manager);
  manager.ingest = async (...args) => { entered(); await blocked; return ingest(...args); };
  const adopting = manager.initialize();
  await Promise.race([started, adopting]);
  try {
    assert.equal((await fetch(`${server.baseUrl}/healthz`)).status, 200);
    for (const route of ['/api/v1/call/testConnection', '/api/action', '/alt'])
      assert.equal((await fetch(`${server.baseUrl}${route}`, { method: 'POST' })).status, 503);
  } finally { release(); }
  await adopting;
  assert.equal(manager.ready, true);
  assert.equal(manager.frame('main').current.pictureId, null);
  assert.deepEqual(manager.s.pictures.map((p) => p.id).sort(), ['art:kept', 'file:2024/IMG.jpg']);
  assert.equal(manager.s.history.filter((h) => /übersprungen/.test(h.text)).length, 3);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'state.json'))), legacy);
  await manager.initialize();
  assert.equal(manager.s.pictures.length, 2);
  assert.equal((await fetch(`${server.baseUrl}/api/v1/bootstrap`)).status, 200);
});

test('H2: nested adoption keeps colliding asset names distinct and existing working copies readable', async (t) => {
  const { manager, photos } = await setup(t, { count: 1 });
  const existing = manager.s.pictures[0];
  const oldDir = path.join(manager.root, 'media', existing.id.replace(/[^\w-]/g, '_'));
  fs.mkdirSync(oldDir, { recursive: true });
  for (const key of ['file', 'thumb']) {
    const destination = path.join(oldDir, path.basename(existing[key]));
    if (destination !== existing[key]) fs.renameSync(existing[key], destination);
    existing[key] = destination;
  }
  const original = fs.readFileSync(existing.file);
  for (const [name, background] of [['2024/IMG.jpg', '#ff0000'], ['2024_IMG.jpg', '#0000ff']]) {
    const file = path.join(photos, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await sharp({ create: { width: 72, height: 128, channels: 3, background } }).jpeg().toFile(file);
  }
  manager.s.migrated = false;
  await manager.initialize();
  const nested = manager.picture('file:2024/IMG.jpg');
  const flat = manager.picture('file:2024_IMG.jpg');
  assert.notEqual(nested.file, flat.file);
  assert.notEqual(nested.thumb, flat.thumb);
  for (const key of ['file', 'thumb']) {
    const red = await sharp(nested[key]).stats();
    const blue = await sharp(flat[key]).stats();
    assert.ok(red.channels[0].mean > 240 && red.channels[2].mean < 10);
    assert.ok(blue.channels[2].mean > 240 && blue.channels[0].mean < 10);
  }
  const reloaded = new ManagerStore(manager.root).state;
  assert.equal(reloaded.pictures.find((p) => p.id === existing.id).file, existing.file);
  assert.deepEqual(fs.readFileSync(existing.file), original);
});

test('H1: tick releases the shared reserve for legacy state before delivering prepared content', async (t) => {
  const fake = await startFakeEmdx();
  t.after(() => fake.close());
  const { manager, frame } = await setup(t, { fake, count: 4 });
  const server = createServer(manager.base, [...manager.apps.values()], { manager });
  await server.listen();
  t.after(() => server.close());
  manager.server = server;
  manager.quiet = () => false;
  await manager.prepare(frame);
  // Exercise the scheduled-change save as well as the save after a successful probe.
  frame.lastDue = 0;
  const write = fs.writeSync;
  let failures = 0;
  t.mock.method(fs, 'writeSync', (...args) => {
    if (fs.existsSync(manager.store.reserve)) {
      failures++;
      throw Object.assign(new Error('PVC full'), { code: 'ENOSPC' });
    }
    return write(...args);
  });
  await manager.tick(frame);
  assert.equal(failures, 1);
  assert.equal(fs.existsSync(manager.store.reserve), false);
  const legacy = JSON.parse(fs.readFileSync(manager.apps.get(frame.id).store.file));
  assert.equal(legacy.current.pushed, true);
  assert.ok(legacy.playlist.changes.some((change) => change.online));
  assert.equal(frame.delivered.state, 'downloaded');
  assert.equal(manager.guarded(frame), true);
  assert.ok(JSON.parse(fs.readFileSync(manager.store.file)).frames[0].guard);
  assert.equal(fake.events.filter((e) => e.startsWith('cmd:')).at(-1), 'cmd:c7');
});

test('H1: tick delivers the existing prepared program when rebuilding runs out of space after reserve release', async (t) => {
  const fake = await startFakeEmdx();
  t.after(() => fake.close());
  const { manager, frame } = await setup(t, { fake, count: 4 });
  const server = createServer(manager.base, [...manager.apps.values()], { manager });
  await server.listen();
  t.after(() => server.close());
  manager.server = server;
  manager.quiet = () => false;
  await manager.prepare(frame);
  const prepared = frame.prepared;
  const images = new Map(prepared.entries.map((entry) => [entry.file, fs.readFileSync(entry.file)]));
  frame.lastDue = 0;
  const write = fs.writeSync;
  let failures = 0;
  t.mock.method(fs, 'writeSync', (...args) => {
    if (fs.existsSync(manager.store.reserve)) {
      failures++;
      throw Object.assign(new Error('PVC full'), { code: 'ENOSPC' });
    }
    return write(...args);
  });
  const render = t.mock.method(manager, 'renderPicture', async () => {
    assert.equal(fs.existsSync(manager.store.reserve), false);
    assert.equal(frame.dirty, true);
    assert.equal(frame.prepared, prepared);
    throw Object.assign(new Error('Render failed: PVC full'), { code: 'ENOSPC' });
  });
  await manager.tick(frame);
  assert.equal(failures, 1);
  assert.equal(render.mock.callCount(), 1);
  assert.equal(frame.delivered.id, prepared.id);
  assert.equal(frame.delivered.state, 'downloaded');
  assert.equal(frame.dirty, true);
  assert.equal(frame.preparing, null);
  const persisted = JSON.parse(fs.readFileSync(manager.store.file)).frames[0];
  assert.ok(persisted.guard);
  assert.equal(persisted.prepareError, frame.prepareError);
  assert.equal(manager.getFrame(frame.id).health.level, 'warn');
  assert.match(manager.getFrame(frame.id).health.text, /vorbereitet/);
  assert.equal(fake.received.length, 1);
  for (const [i, entry] of frame.delivered.entries.entries())
    assert.deepEqual(fake.received[0].images[i], images.get(entry.file));
  const commands = fake.events.filter((e) => e.startsWith('cmd:'));
  assert.equal(commands.filter((e) => e === 'cmd:c7').length, 1);
  assert.equal(commands.at(-1), 'cmd:c7');
  await manager.tick(frame);
  assert.deepEqual(fake.events.filter((e) => e.startsWith('cmd:')), commands);
  render.mock.restore();
  await manager.prepare(frame);
  assert.equal(frame.prepareError, null);
  assert.equal(frame.dirty, false);
});

for (const change of ['deleted', 'paused', 'reserved elsewhere']) {
  test(`K1: tick refuses an ENOSPC fallback containing a picture ${change} after preparation`, async (t) => {
    const fake = await startFakeEmdx();
    t.after(() => fake.close());
    const { manager, frame } = await setup(t, { fake, count: 8 });
    await serving(t, manager);
    manager.quiet = () => false;
    await manager.prepare(frame);
    assert.equal(await manager.deliver(frame), true);
    frame.guard = null;
    await manager.prepare(frame);
    const prepared = frame.prepared;
    const pid = prepared.entries[1].pictureId;
    assert.ok(prepared.entries[1].at > Date.now());
    frame.lastDue = 0;
    if (change === 'deleted') manager.deletePicture(pid);
    else if (change === 'paused') manager.updatePicture(pid, { paused: true });
    else {
      manager.reserve(pid, 'another-frame', true);
      manager.requestPrepare(frame);
    }
    const delivered = frame.delivered;
    const playing = fake.state.playing;
    const commands = fake.events.filter((e) => e.startsWith('cmd:'));
    const render = t.mock.method(manager, 'renderPicture', async () => {
      throw Object.assign(new Error('Render failed: PVC full'), { code: 'ENOSPC' });
    });
    await manager.tick(frame);
    assert.equal(render.mock.callCount(), 1);
    assert.equal(frame.prepared, prepared);
    assert.equal(frame.delivered, delivered);
    assert.equal(fake.state.playing, playing);
    assert.equal(fake.received.length, 1);
    assert.deepEqual(fake.events.filter((e) => e.startsWith('cmd:')), commands);
    assert.equal(frame.guard, null);
    assert.equal(frame.dirty, true);
    assert.equal(frame.preparing, null);
    assert.ok(frame.prepareError);
    const persisted = JSON.parse(fs.readFileSync(manager.store.file)).frames[0];
    assert.equal(persisted.prepareError, frame.prepareError);
    assert.equal(persisted.delivered.id, delivered.id);
    assert.equal(manager.getFrame(frame.id).health.level, 'warn');
    assert.match(manager.getFrame(frame.id).health.text, /vorbereitet/);
  });
}

for (const change of ['deleted', 'paused']) {
  for (const count of [8, 2]) {
    test(`L1: scheduled tick replaces a ${change} current picture with ${count - 1} usable alternative${count === 2 ? '' : 's'}`, async (t) => {
      const fake = await startFakeEmdx();
      t.after(() => fake.close());
      const initialNow = stamp('2026-11-19T12:30:00Z');
      let now = initialNow;
      t.mock.method(Date, 'now', () => now);
      const { manager, frame } = await setup(t, { fake, count });
      await serving(t, manager);
      await manager.prepare(frame);
      assert.equal(await manager.deliver(frame), true);
      const delivered = frame.delivered;
      const pid = delivered.entries[1].pictureId;
      const replacement = delivered.entries.find((e) => e.at > delivered.entries[1].at && e.pictureId !== pid)
        || delivered.entries[0];
      assert.notEqual(pid, delivered.entries[0].pictureId);
      frame.lastDue = manager.clock(frame).prev(initialNow);
      if (change === 'deleted') manager.deletePicture(pid);
      else manager.updatePicture(pid, { paused: true });
      // Rebuild while asleep, before the rejected buffered picture becomes current.
      await manager.prepare(frame);
      assert.equal(frame.prepared.entries[0].pictureId, delivered.entries[0].pictureId);
      const before = fake.events.length;
      now = delivered.entries[1].at + 1;
      assert.equal(fake.showing().index, 1);
      await manager.tick(frame);
      assert.notEqual(frame.delivered.id, delivered.id);
      assert.equal(frame.delivered.state, 'downloaded');
      assert.equal(frame.current.pictureId, replacement.pictureId);
      assert.ok(frame.delivered.entries.every((e) => e.pictureId !== pid));
      assert.equal(fake.received.length, 2);
      assert.deepEqual(fake.received[1].image, fs.readFileSync(frame.delivered.entries[0].file));
      const commands = fake.events.slice(before).filter((e) => e.startsWith('cmd:'));
      assert.equal(commands.filter((e) => e === 'cmd:c7').length, 1);
      assert.equal(commands.at(-1), 'cmd:c7');
      assert.equal(manager.guarded(frame), true);
      frame.lastProbe = null;
      await manager.tick(frame);
      assert.deepEqual(fake.events.slice(before).filter((e) => e.startsWith('cmd:')), commands);
    });
  }
  test(`K1: delivery rechecks a picture ${change} during settings before sending content`, async (t) => {
    const fake = await startFakeEmdx();
    t.after(() => fake.close());
    const { manager, frame } = await setup(t, { fake, count: 4 });
    await serving(t, manager);
    await manager.prepare(frame);
    const pid = frame.prepared.entries[1].pictureId;
    const app = manager.apps.get(frame.id);
    const note = app.noteCleaning.bind(app);
    app.noteCleaning = (...args) => {
      note(...args);
      if (change === 'deleted') manager.deletePicture(pid);
      else manager.updatePicture(pid, { paused: true });
    };
    assert.equal(await manager.deliver(frame), false);
    assert.equal(fake.received.length, 0);
    assert.ok(!fake.events.includes('cmd:c7'));
    assert.equal(manager.guarded(frame), false);
  });
}

test('release #2: bounded JPEGs and subscription batches, low-space refusal, and prepared delivery survives ENOSPC', async (t) => {
  const fake = await startFakeEmdx();
  t.after(() => fake.close());
  const { manager, frame, data } = await setup(t, { fake, count: 4 });
  const file = path.join(data, 'large.jpg');
  await sharp({ create: { width: 1000, height: 800, channels: 3, background: '#309030' } }).jpeg().toFile(file);
  const picture = await manager.ingest(file);
  const meta = await sharp(picture.file).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 256);
  assert.equal(meta.height, picture.height);
  manager.s.subscriptions.album = { on: true, name: 'Album' };
  const ids = Array.from({ length: 35 }, (_, i) => ({ id: `asset-${i}` }));
  manager.immichClient = () => ({ version: async () => '3.4.2', search: async () => ({ items: ids, nextCursor: null }) });
  const imported = [];
  manager.importFromImmich = async (batch) => {
    for (const id of batch) { manager.s.imported[id] = id; imported.push(id); }
  };
  await manager.pollSubscriptions();
  assert.equal(imported.length, 10);
  await manager.pollSubscriptions();
  assert.equal(imported.length, 20);
  assert.equal(new Set(imported).size, 20);
  const statfs = t.mock.method(fs, 'statfsSync', () => ({ bavail: MIN_FREE - 1, bsize: 1 }));
  await assert.rejects(manager.ingest(file), /256 MiB/);
  await assert.rejects(manager.upload({}), /256 MiB/);
  await assert.rejects(manager.pollSubscriptions(), /256 MiB/);
  assert.match(manager.s.history[0].text, /256 MiB/);
  statfs.mock.restore();
  const server = createServer(manager.base, [...manager.apps.values()], { manager });
  await server.listen();
  t.after(() => server.close());
  manager.server = server;
  await manager.prepare(frame);
  const write = fs.writeFileSync;
  let retried = false;
  t.mock.method(fs, 'writeFileSync', (...args) => {
    if (typeof args[0] === 'number' && fs.existsSync(manager.store.reserve)) {
      retried = true;
      throw Object.assign(new Error('PVC full'), { code: 'ENOSPC' });
    }
    return write(...args);
  });
  assert.equal(await manager.deliver(frame), true);
  assert.equal(retried, true);
  assert.equal(manager.guarded(frame), true);
  assert.ok(JSON.parse(fs.readFileSync(manager.store.file)).frames[0].guard);
  assert.equal(fs.readdirSync(manager.root).some((f) => f.endsWith('.tmp')), false);
  assert.equal(fake.events.filter((e) => e.startsWith('cmd:')).at(-1), 'cmd:c7');
});

test('release #3: an import waits for an active render on the shared decoder queue', async (t) => {
  const { manager, frame, photos, data } = await setup(t, { count: 1 });
  const p = manager.s.pictures[0];
  p.crops.hoch.auto = false;
  let entered, release;
  const started = new Promise((r) => { entered = r; });
  const gate = new Promise((r) => { release = r; });
  const crop = manager.cropImage.bind(manager);
  manager.cropImage = async (...args) => { entered(); await gate; return crop(...args); };
  const render = manager.renderPicture(p, manager.apps.get(frame.id).cfg, path.join(data, 'render.png'));
  await started;
  let imported = false;
  const ingest = manager.ingest(path.join(photos, 'photo-0.jpg')).then(() => { imported = true; });
  try {
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(imported, false);
    assert.equal(manager.s.pictures.length, 1);
  } finally { release(); }
  await Promise.all([render, ingest]);
  assert.equal(imported, true);
  assert.equal(manager.s.pictures.length, 2);
});

test('release #4: untrusted Host cannot bootstrap, mutate or read media; IP, SSO and display routes work', async (t) => {
  const { manager } = await setup(t, { count: 1 });
  manager.env.UI_HOSTS = 'frame.example, second.example';
  const server = createServer(manager.base, [...manager.apps.values()], { manager });
  await server.listen();
  t.after(() => server.close());
  const request = (route, host, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request(`${server.baseUrl}${route}`, { method, headers: { Host: host, Origin: `http://${host}`, 'X-Forwarded-Host': 'frame.example' } }, (res) => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.end();
  });
  for (const route of ['/', '/alt', '/api/v1/bootstrap', '/api/v1/call/listPictures', `/api/v1/media/${encodeURIComponent(manager.s.pictures[0].id)}/image`])
    assert.equal(await request(route, 'rebind.attacker.example'), 403, route);
  assert.equal(await request('/api/v1/call/frameAction', 'rebind.attacker.example', 'POST'), 403);
  for (const host of ['127.0.0.1:8321', '[::1]:8321', 'localhost:8321', 'frame.example', 'second.example:443'])
    assert.equal(await request('/api/v1/bootstrap', host), 200, host);
  assert.equal(await request('/healthz', 'rebind.attacker.example'), 200);
  assert.equal(await request('/emdx/00000000-0000-0000-0000-000000000000/content.json', 'rebind.attacker.example'), 404);
  assert.notEqual(await request('/content-transfer-progress', 'rebind.attacker.example', 'POST'), 403);
});

test('calendar cadence crosses months, years and DST; live hourly window includes midnight', () => {
  const c = cadenceClock(
    { everyMin: 2880, at: '06:00' },
    'Europe/Berlin',
    stamp('2026-01-30T10:00:00Z'),
  );
  assert.equal(
    new Date(c.next(stamp('2026-01-30T06:00:00Z'))).toISOString(),
    '2026-02-01T05:00:00.000Z',
  );
  const daily = cadenceClock(
    { everyMin: 1440, at: '06:00' },
    'Europe/Berlin',
    stamp('2026-01-01T00:00:00Z'),
  );
  assert.equal(
    daily.next(stamp('2026-03-28T05:00:00Z')) - stamp('2026-03-28T05:00:00Z'),
    23 * H,
  );
  assert.equal(
    daily.next(stamp('2026-10-24T04:00:00Z')) - stamp('2026-10-24T04:00:00Z'),
    25 * H,
  );
  const elapsed = cadenceClock(
    { everyMin: 120, at: '06:00' },
    'Europe/Berlin',
    stamp('2026-03-28T05:00:00Z'),
  );
  assert.equal(
    elapsed.next(stamp('2026-03-29T00:00:00Z')) -
      elapsed.prev(stamp('2026-03-29T00:00:00Z')),
    2 * H,
  );
  const window = cadenceClock(
    cadenceFromCron('0 0,6-23 * * *'),
    'Europe/Berlin',
  );
  assert.equal(
    new Date(window.next(stamp('2026-11-19T23:00:00Z'))).toISOString(),
    '2026-11-20T05:00:00.000Z',
  );
  assert.equal(
    new Date(window.prev(stamp('2026-11-19T23:01:00Z'))).toISOString(),
    '2026-11-19T23:00:00.000Z',
  );
  assert.equal(window.upcoming(19, stamp('2026-11-19T04:59:00Z')).length, 19);
});

test('manager primary corruption fails closed; secret encryption and permissions', async (t) => {
  const { manager, data } = await setup(t);
  const secrets = new Secrets(manager.root, {});
  secrets.set('immich', 'fixture-private-value');
  assert.equal(secrets.get('immich'), 'fixture-private-value');
  assert.ok(
    !fs.readFileSync(secrets.file, 'utf8').includes('fixture-private-value'),
  );
  assert.equal(fs.statSync(secrets.file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(manager.root, 'key')).mode & 0o777, 0o600);
  const external = new Secrets(manager.root, {
    IMMICH_API_KEY: 'fixture-env-value',
  });
  assert.equal(external.get('immich'), 'fixture-env-value');
  assert.throws(() => external.set('immich', 'different'), /gesperrt/);
  fs.writeFileSync(path.join(data, 'manager', 'state.json'), '{broken');
  assert.throws(() => new ManagerStore(manager.root), /unreadable/);
});

test('live-shaped migration preserves current, delivered playlist, history, battery and wake data; accepts all 26 photos', async (t) => {
  const { manager, frame, original, data } = await setup(t, {
    live: true,
    count: 26,
  });
  assert.equal(manager.listInbox().length, 0);
  assert.ok(manager.listPictures().length >= 26);
  assert.deepEqual(frame.cadence, {
    everyMin: 60,
    at: '06:00',
    until: '00:00',
  });
  if (original) {
    const state = manager.apps.get(frame.id).state;
    for (const key of [
      'current',
      'batteryLog',
      'history',
      'cleaning',
      'playlist',
    ])
      assert.deepEqual(state[key], original[key], key);
    assert.equal(state.wakeEvents.length, original.wakeEvents.length);
    assert.equal(frame.current.pictureId, original.current.ids[0]);
    assert.equal(
      frame.delivered.entries.length,
      original.playlist.batch.items.length,
    );
    assert.equal(frame.delivered.sentAt, original.playlist.batch.sentAt);
    assert.ok(manager.owners(original.current.ids[0]).includes(frame.id));
    assert.ok(
      fs.existsSync(
        path.join(
          data,
          'playlist',
          original.playlist.slots[0].dir,
          'device.png',
        ),
      ),
    );
  }
  const before = manager.s.pictures.length;
  await manager.initialize();
  assert.equal(manager.s.pictures.length, before);
});

test('decks lock across groups, dead frames and combined pictures; only an actual replacement releases old cards', async (t) => {
  const { manager, frame } = await setup(t);
  const p = manager.listPictures()[0];
  const other = manager.addFrame({
    name: 'Zweiter',
    device: 'Frame 2',
    ip: '127.0.0.2',
    orientation: 'hoch',
    upsideDown: false,
    power: 'akku',
    cadence: { everyMin: 1440, at: '06:00' },
    cleaning: '05:50',
    buffer: 3,
    groupId: 'default',
    pin: null,
  });
  const g = manager.saveGroup({
    name: 'Andere Gruppe',
    albums: ['Folder'],
    art: { every: 0, from: 'bibliothek' },
  });
  assert.ok(
    manager.s.pending.some(
      (p) =>
        p.frameId === other.id &&
        p.kind === 'reinigung' &&
        p.payload.value === '05:50',
    ),
  );
  manager.updateFrame(other.id, { groupId: g.id });
  manager.reserve(p.id, frame.id);
  assert.throws(() => manager.reserve(p.id, other.id), /anderen Rahmen/);
  frame.lastOnline = Date.now() - 100 * DAY;
  assert.throws(() => manager.reserve(p.id, other.id), /anderen Rahmen/);
  const combo = await manager.createCombo(
    '2-uebereinander',
    manager
      .listPictures()
      .slice(0, 2)
      .map((p) => p.id),
  );
  const combined = manager.picture(combo.id);
  assert.notEqual(combined.file, p.file);
  assert.equal((await sharp(combined.file).metadata()).width, 720);
  assert.ok(fs.existsSync(combined.thumb));
  assert.throws(() => manager.reserve(combo.id, other.id), /anderen Rahmen/);
  manager.releaseUnused(frame, []);
  manager.reserve(combo.id, other.id);
  assert.throws(() => manager.reserve(p.id, frame.id), /anderen Rahmen/);
  const deck = manager.getDeck('default', 'hoch');
  assert.equal(
    deck.cards.find((c) => c.pictureId === p.id).state,
    'vorgemerkt',
  );
  manager.noteShown(p.id, other.id, Date.now());
  manager.releaseUnused(manager.frame(other.id), []);
  assert.equal(manager.where(manager.picture(p.id)).justShown, true);
});

test('pending changes withdraw, correct, keep desired/applied separate and survive restart', async (t) => {
  const { manager, frame, seeds, model, env } = await setup(t);
  manager.updateFrame(frame.id, {
    cleaning: '06:40',
    cadence: { everyMin: 2880, at: '07:00' },
  });
  const cleaning = manager.s.pending.find((p) => p.kind === 'reinigung');
  assert.equal(cleaning.state, 'eingestellt');
  assert.equal(frame.activeCadence.everyMin, 60);
  manager.withdrawPending(cleaning.id);
  assert.equal(frame.cleaning, '05:50');
  const cadence = manager.s.pending.find((p) => p.kind === 'rhythmus');
  manager.stage(cadence, 'uebertragen', { sentAt: Date.now() });
  manager.save();
  assert.throws(() => manager.withdrawPending(cadence.id), /korrigieren/);
  manager.updateFrame(frame.id, { cadence: { everyMin: 1440, at: '08:00' } });
  assert.equal(
    manager.s.pending.filter((p) => p.kind === 'rhythmus').length,
    2,
  );
  const restarted = new Manager(seeds, model, { env });
  await restarted.initialize();
  assert.equal(restarted.frame(frame.id).cadence.at, '08:00');
  assert.equal(
    restarted.listPending(frame.id).find((p) => p.id === cadence.id).state,
    'uebertragen',
  );
});

test('TCP watcher sends no data; guard survives restart and clears only on EHOSTUNREACH or next change', async (t) => {
  let bytes = 0;
  const server = net.createServer((socket) =>
    socket.on('data', (data) => {
      bytes += data.length;
    }),
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  assert.equal(
    (await tcpProbe('127.0.0.1', server.address().port)).awake,
    true,
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(bytes, 0);
  const { manager, frame, seeds, model, env } = await setup(t);
  manager.markUpdated(frame);
  const until = frame.guard.until;
  manager.observeProbe(frame, { code: 'ECONNREFUSED' });
  assert.equal(manager.guarded(frame), true);
  manager.observeProbe(frame, { code: 'ETIMEDOUT' });
  assert.equal(manager.guarded(frame), true);
  const restarted = new Manager(seeds, model, { env });
  await restarted.initialize();
  assert.equal(restarted.guarded(restarted.frame(frame.id)), true);
  assert.equal(manager.guarded(frame, until), false);
  manager.observeProbe(frame, { code: 'EHOSTUNREACH' });
  assert.equal(frame.guard, null);
  const before = stamp('2026-11-19T04:45:00Z'); // 05:45, cleaning 05:50
  assert.equal(manager.quiet(frame, before), true);
  assert.equal(manager.quiet(frame, stamp('2026-11-19T12:30:00Z')), false);
});

test('wake: reads, setting write and read-back, content last; second action and late failure cannot reconnect', async (t) => {
  const fake = await startFakeEmdx();
  t.after(() => fake.close());
  const { manager, frame } = await setup(t, { fake });
  const server = createServer(manager.base, [...manager.apps.values()], {
    manager,
  });
  await server.listen();
  t.after(() => server.close());
  manager.server = server;
  const app = manager.apps.get(frame.id);
  app.server = server;
  manager.updateFrame(frame.id, { cleaning: '06:40' });
  await manager.prepare(frame);
  assert.equal(await manager.deliver(frame), true);
  assert.equal(
    manager.s.pending.find((p) => p.kind === 'reinigung').state,
    'bestaetigt',
  );
  const commands = fake.events.filter((event) => event.startsWith('cmd:'));
  assert.ok(commands.some((c) => c === 'cmd:1b:176,128,2,6,40'));
  assert.equal(commands.at(-1), 'cmd:c7');
  const sessions = fake.events.filter((e) => e === 'auth').length;
  manager.frameAction(frame.id, 'pruefen');
  await manager.prepare(frame);
  assert.equal(await manager.deliver(frame), false);
  assert.equal(fake.events.filter((e) => e === 'auth').length, sessions);
  await assert.rejects(
    () => app.look({ battery: true }),
    /gerade aktualisiert/,
  );
  assert.equal(fake.events.filter((e) => e === 'auth').length, sessions);
});

test('ambiguous content download never retries MDC and pins the possible program through restart', async (t) => {
  const fake = await startFakeEmdx({ fetchImage: false });
  t.after(() => fake.close());
  const { manager, frame, seeds, model, env } = await setup(t, { fake });
  const server = createServer(manager.base, [...manager.apps.values()], {
    manager,
  });
  await server.listen();
  t.after(() => server.close());
  manager.server = server;
  const app = manager.apps.get(frame.id);
  app.server = server;
  app.cfg.display.fetchTimeoutSec = 0.05;
  app.cfg.display.pushAttempts = 4;
  manager.frameAction(frame.id, 'neu-senden');
  await manager.prepare(frame);
  assert.equal(await manager.deliver(frame), false);
  assert.equal(fake.events.filter((e) => e === 'cmd:c7').length, 1);
  assert.equal(manager.s.programs.at(-1).state, 'uncertain');
  assert.equal(manager.guarded(frame), true);
  const copy = new Manager(seeds, model, { env });
  await copy.initialize();
  assert.equal(copy.guarded(copy.frame(frame.id)), true);
  assert.ok(copy.s.programs.at(-1).content.json);
});

test('Event encodes start, ordered repeats and normal fallback without replacing normal cadence', async (t) => {
  const { manager, frame } = await setup(t);
  const pictures = manager
    .listPictures()
    .slice(0, 3)
    .map((p) => p.id);
  const now = Date.now();
  const draft = {
    name: 'Geburtstag',
    start: now + H,
    end: now + 4 * H,
    frameIds: [frame.id],
    pictureIds: pictures,
    everyMin: 60,
    sameOnAll: false,
  };
  const result = manager.saveEvent(draft);
  const estimate = manager.estimateEvent({ ...draft, id: result.id });
  assert.equal(estimate.perFrame[0].missingFormat, false);
  const cadence = structuredClone(frame.cadence);
  await manager.prepare(frame);
  const event = frame.prepared.entries.filter((e) => e.eventId === result.id);
  assert.deepEqual(
    event.map((e) => e.pictureId),
    pictures,
  );
  assert.ok(
    frame.prepared.entries.some((e) => e.at === draft.end && !e.eventId),
  );
  assert.deepEqual(frame.cadence, cadence);
  assert.throws(
    () => manager.saveEvent({ ...draft, id: undefined }),
    /überschneidet/,
  );
  manager.endEvent(result.id);
  assert.ok(manager.s.pending.some((p) => p.title.includes('beenden')));
  assert.equal(manager.listEvents()[0].state, 'vorbei');
});

test('a distant Event preserves every normal change before its start', async (t) => {
  const { manager, frame } = await setup(t);
  const clock = manager.clock(frame, true);
  const start = clock.next(Date.now() + 3 * DAY);
  manager.saveEvent({
    name: 'Am Wochenende',
    start,
    end: start + 2 * H,
    frameIds: [frame.id],
    pictureIds: manager
      .listPictures()
      .slice(0, 2)
      .map((p) => p.id),
    everyMin: 60,
    sameOnAll: false,
  });
  await manager.prepare(frame);
  for (
    let at = clock.next(frame.prepared.preparedAt);
    at < start;
    at = clock.next(at)
  )
    assert.ok(frame.prepared.entries.some((e) => e.at === at && !e.eventId));
  const eventPictures = manager.s.events[0].pictureIds;
  assert.ok(
    frame.prepared.entries
      .filter((e) => e.at >= start + 2 * H)
      .every((e) => !eventPictures.includes(e.pictureId)),
  );
});

test('upload decodes raster pixels, EXIF orientation, strips metadata, restores discarded items and rejects SVG', async (t) => {
  const { manager, data } = await setup(t);
  const oriented = path.join(data, 'oriented.jpg');
  await sharp({
    create: { width: 160, height: 90, channels: 3, background: '#aabbaa' },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toFile(oriented);
  const p = await manager.ingest(oriented, { title: 'Gedreht' });
  assert.equal(p.width, 90);
  assert.equal(p.height, 160);
  const meta = await sharp(p.file).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(meta.orientation, undefined);
  manager.discardInbox([p.id]);
  assert.equal(manager.listDiscarded().length, 1);
  manager.restoreInbox([p.id]);
  assert.ok(manager.listInbox().some((x) => x.id === p.id));
  manager.acceptInbox([p.id]);
  assert.equal(manager.picture(p.id).status, 'accepted');
  const svg = path.join(data, 'fake.jpg');
  fs.writeFileSync(
    svg,
    '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"/>',
  );
  await assert.rejects(() => normalize(svg), /Rasterbilder/);
  const twin = await manager.ingest(oriented);
  assert.equal(twin.identity, p.identity);
  assert.ok(twin.hints.includes('doppelt'));
});

test('real HEVC fixture decodes pixels with the installed libheif converter', async () => {
  // Original geometric fixture encoded with libheif/heif-enc (HEVC, lossless).
  execFileSync('heif-convert', ['--version'], { stdio: 'ignore' });
  const image = await normalize(
    new URL('./fixtures/example.heic', import.meta.url),
  );
  assert.equal(image.width, 128);
  assert.equal(image.height, 192);
  const pixels = await sharp(image.image)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.ok(pixels.data[0] < 70 && pixels.data[2] > 140);
  const center = (96 * 128 + 64) * pixels.info.channels;
  assert.ok(pixels.data[center] > 180 && pixels.data[center + 2] < 80);
});

test('Immich 3.4.2 metadata/smart cursor API, optional people, edited import and proxy keep keys server-side', async (t) => {
  const requests = [];
  const image = await sharp({
    create: { width: 140, height: 200, channels: 3, background: '#bcacac' },
  })
    .jpeg()
    .toBuffer();
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    requests.push({ url: req.url, body, key: req.headers['x-api-key'] });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/server/version')
      res.end(JSON.stringify({ major: 3, minor: 4, patch: 2 }));
    else if (req.url === '/api/albums')
      res.end(
        JSON.stringify([
          { id: 'album-1', albumName: 'Familie', assetCount: 2 },
        ]),
      );
    else if (req.url.startsWith('/api/people'))
      res.end(
        JSON.stringify({
          people: [{ id: 'person-1', name: 'Person', faceCount: 2 }],
          hasNextPage: false,
        }),
      );
    else if (req.url.startsWith('/api/search/'))
      res.end(
        JSON.stringify({
          assets: {
            items: [
              {
                id: body.cursor ? 'asset-2' : 'asset-1',
                type: 'IMAGE',
                originalFileName: 'Bild.jpg',
                fileCreatedAt: '2026-01-01T00:00:00Z',
              },
            ],
            nextCursor: body.cursor ? null : 'opaque-cursor',
          },
        }),
      );
    else if (req.url.includes('/original?edited=true')) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.end(image);
    } else if (req.url.startsWith('/api/assets/'))
      res.end(
        JSON.stringify({
          type: 'IMAGE',
          originalFileName: 'Bild.jpg',
          fileCreatedAt: '2026-01-01T00:00:00Z',
        }),
      );
    else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/api`;
  const client = new Immich(url, 'fixture-key');
  assert.equal(await client.version(), '3.4.2');
  const first = await client.search({
    albumId: 'album-1',
    favorites: true,
    personIds: ['person-1'],
  });
  await client.search({ albumId: 'album-1' }, first.nextCursor);
  await client.search({ text: 'Katze' });
  const search = requests.find((r) => r.url === '/api/search/metadata').body;
  assert.deepEqual(search.filter.albumIds, { any: ['album-1'] });
  assert.equal(search.page, undefined);
  assert.equal(search.albumIds, undefined);
  assert.ok(requests.some((r) => r.body?.cursor === 'opaque-cursor'));
  assert.ok(
    requests.some(
      (r) => r.url === '/api/search/smart' && r.body.query === 'Katze',
    ),
  );
  const { manager } = await setup(t);
  manager.updateSettings({ immichUrl: url });
  manager.saveKey('immich', 'fixture-key');
  const status = await manager.getImmich();
  assert.equal(status.connected, true);
  await manager.importFromImmich(['asset-1']);
  assert.equal(
    manager.listInbox().filter((p) => p.source === 'immich').length,
    1,
  );
  await manager.importFromImmich(['asset-1']);
  assert.equal(
    manager.listInbox().filter((p) => p.source === 'immich').length,
    1,
  );
  assert.ok(requests.some((r) => r.url.endsWith('/original?edited=true')));
  assert.ok(
    !JSON.stringify([
      manager.getSettings(),
      manager.listKeys(),
      manager.getOverview(),
    ]).includes('fixture-key'),
  );
});

test('only corrupt input counts as undecodable; memory pressure and system errors retry', () => {
  assert.equal(undecodable(new Error('Input buffer has corrupt header: VipsJpeg: premature end of JPEG image')), true);
  assert.equal(undecodable(new Error('Input buffer has corrupt header:')), true);
  assert.equal(undecodable(new Error('tiff2vips: Quantization table 0x00 was not defined\ntiff2vips: read error')), true);
  assert.equal(undecodable(new Error('Could not allocate enough memory for raw output')), false);
  assert.equal(undecodable(Object.assign(new Error('no space left'), { code: 'ENOSPC' })), false);
  assert.equal(undecodable(Object.assign(new Error('x'), { status: 507 })), false);
  assert.equal(undecodable(new Error('something unexpected')), false);
});

test('a truncated TIFF is undecodable, not retried forever', async (t) => {
  const tiff = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#bcacac' } })
    .tiff({ compression: 'jpeg' })
    .toBuffer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emdx-tiff-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'cut.tif');
  fs.writeFileSync(file, tiff.subarray(0, tiff.length - 20));
  await assert.rejects(normalize(file), (err) => err.status === 415);
});

test('an album subscription skips a picture it cannot take and imports the rest', async (t) => {
  const image = await sharp({
    create: { width: 140, height: 200, channels: 3, background: '#bcacac' },
  })
    .jpeg()
    .toBuffer();
  const immich = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/server/version')
      res.end(JSON.stringify({ major: 3, minor: 4, patch: 2 }));
    else if (req.url.startsWith('/api/search/'))
      res.end(JSON.stringify({ assets: { items: [{ id: 'huge', type: 'IMAGE' }, { id: 'bad', type: 'IMAGE' }, { id: 'truncated', type: 'IMAGE' }, { id: 'good', type: 'IMAGE' }], nextCursor: null } }));
    else if (req.url.includes('/original')) {
      res.setHeader('Content-Type', 'image/jpeg');
      if (req.url.includes('/huge/')) res.end(Buffer.alloc(26 * 1024 * 1024));
      else if (req.url.includes('/truncated/')) res.end(image.subarray(0, Math.floor(image.length / 2)));
      else res.end(req.url.includes('/bad/') ? Buffer.from('not a picture') : image);
    } else if (req.url.startsWith('/api/assets/'))
      res.end(JSON.stringify({ type: 'IMAGE', originalFileName: req.url.includes('/bad') ? 'kaputt.jpg' : 'gut.jpg', fileCreatedAt: '2026-01-01T00:00:00Z' }));
    else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise((r) => immich.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => immich.close(r)));
  const { manager } = await setup(t);
  manager.updateSettings({ immichUrl: `http://127.0.0.1:${immich.address().port}/api` });
  manager.saveKey('immich', 'fixture-key');
  manager.s.subscriptions['album-1'] = { on: true, name: 'Familie' };
  await manager.pollSubscriptions();
  assert.ok(manager.s.imported.good);
  assert.ok(manager.s.importSkipped.bad);
  assert.ok(manager.s.importSkipped.huge);
  assert.ok(manager.s.importSkipped.truncated);
  await manager.pollSubscriptions();
  assert.equal(manager.listInbox().filter((p) => p.source === 'immich').length, 1);
});

test('Immich thumbnail proxy serves only raster images, never upstream HTML', async (t) => {
  const image = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#bcacac' },
  })
    .jpeg()
    .toBuffer();
  const immich = http.createServer((req, res) => {
    if (req.url.startsWith('/api/assets/good/thumbnail')) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.end(image);
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end('<script>alert(1)</script>');
    }
  });
  await new Promise((r) => immich.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => immich.close(r)));
  const { manager } = await setup(t);
  manager.updateSettings({
    immichUrl: `http://127.0.0.1:${immich.address().port}/api`,
  });
  manager.saveKey('immich', 'fixture-key');
  const server = createServer(manager.base, [...manager.apps.values()], {
    manager,
  });
  await server.listen();
  t.after(() => server.close());
  const good = await fetch(`${server.baseUrl}/api/v1/immich/thumbnail/good`);
  assert.equal(good.status, 200);
  assert.equal(good.headers.get('content-type'), 'image/jpeg');
  assert.match(good.headers.get('content-security-policy'), /sandbox/);
  const evil = await fetch(`${server.baseUrl}/api/v1/immich/thumbnail/evil`);
  assert.notEqual(evil.status, 200);
  assert.ok(!(await evil.text()).includes('<script>'));
});

test('real HTTP API: CSRF, streaming multipart partial failures, secret write-only, protected media and SPA', async (t) => {
  const { manager } = await setup(t);
  const server = createServer(manager.base, [...manager.apps.values()], {
    manager,
  });
  await server.listen();
  t.after(() => server.close());
  const base = server.baseUrl;
  const csrf = (await (await fetch(`${base}/api/v1/bootstrap`)).json()).csrf;
  const request = (method, args, headers = {}) =>
    fetch(`${base}/api/v1/call/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
        ...headers,
      },
      body: JSON.stringify(args),
    });
  assert.equal(
    (
      await request('saveKey', ['immich', 'fixture-write-only'], {
        Origin: 'https://wrong.example',
      })
    ).status,
    403,
  );
  assert.equal(
    (await request('saveKey', ['immich', 'fixture-write-only'])).status,
    200,
  );
  const keys = await (await fetch(`${base}/api/v1/call/listKeys`)).text();
  assert.ok(!keys.includes('fixture-write-only'));
  const form = new FormData();
  form.append(
    'files',
    new Blob([
      await sharp({
        create: { width: 150, height: 200, channels: 3, background: '#ffbb00' },
      })
        .png()
        .toBuffer(),
    ]),
    'good.png',
  );
  form.append('files', new Blob(['<svg/>']), 'bad.png');
  const response = await fetch(`${base}/api/v1/uploads`, {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrf },
    body: form,
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.results[0].id);
  assert.ok(result.results[1].error);
  const image = await fetch(
    `${base}/api/v1/media/${encodeURIComponent(result.results[0].id)}/thumb`,
  );
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(`${base}/alt`)).status, 200);
  assert.equal((await fetch(`${base}/api/v1/call/getOverview`)).status, 200);
  assert.equal((await fetch(`${base}/assets/old-build.js`)).status, 404);
  const page = await fetch(`${base}/einstellungen`);
  if (page.status === 200)
    assert.equal(page.headers.get('cache-control'), 'no-store');
});

test('battery forecast excludes charges, incidents, short and stale samples', () => {
  const now = Date.now(),
    cadence = { everyMin: 1440, at: '06:00' };
  const log = Array.from({ length: 5 }, (_, i) => ({
    at: now - (4 - i) * DAY,
    percent: 90 - i * 2,
    charging: false,
  }));
  assert.ok(batteryEstimate(log, cadence, now).until > now);
  assert.equal(batteryEstimate(log, cadence, now, true), null);
  assert.equal(batteryEstimate(log.slice(-2), cadence, now), null);
  assert.equal(
    batteryEstimate(
      [...log, { at: now, percent: 100, charging: true }],
      cadence,
      now,
    ),
    null,
  );
  assert.equal(batteryEstimate(log, cadence, now + 3 * DAY), null);
});

test('withdrawn settings restore the original value through a chain; an undelivered Event is removed', async (t) => {
  const { manager, frame } = await setup(t);
  manager.updateFrame(frame.id, { cleaning: '06:10' });
  manager.updateFrame(frame.id, { cleaning: '06:20' });
  const changes = manager.s.pending.filter((p) => p.kind === 'reinigung');
  manager.withdrawPending(changes[0].id);
  assert.equal(frame.cleaning, '06:20');
  manager.withdrawPending(changes[1].id);
  assert.equal(frame.cleaning, '05:50');
  const e = manager.saveEvent({
    name: 'Zurücknehmen',
    start: Date.now() + H,
    end: Date.now() + 2 * H,
    everyMin: 60,
    frameIds: [frame.id],
    pictureIds: [manager.listPictures()[0].id],
    sameOnAll: false,
  });
  manager.withdrawPending(
    manager.s.pending.find((p) => p.payload.eventId === e.id).id,
  );
  assert.equal(manager.s.events.length, 0);
});

test('dealt cards leave the round before they are shown; unshown releases return to its front', async (t) => {
  const { manager, frame } = await setup(t, { count: 6 });
  const cards = Array.from({ length: 6 }, () => manager.draw(frame));
  assert.equal(new Set(cards).size, 6);
  assert.ok(cards.every(Boolean));
  manager.noteShown(cards[0], frame.id, Date.now());
  manager.releaseUnused(frame, [cards[0]]);
  const deck = manager.s.decks['default:hoch'];
  assert.ok(!deck.shown.includes(cards[1]));
  assert.ok(!deck.dealt.includes(cards[1]));
  assert.ok(deck.order.indexOf(cards[1]) < deck.order.indexOf(cards[0]));
});

test('fast watcher expires after twelve hours; probes obey the frame lock and send no payload', async (t) => {
  let connections = 0,
    bytes = 0;
  const probe = net.createServer((socket) => {
    connections++;
    socket.on('data', (b) => (bytes += b.length));
  });
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => probe.close(r)));
  const { manager, frame } = await setup(t);
  const app = manager.apps.get(frame.id);
  frame.ip = '127.0.0.1';
  app.cfg.display.port = probe.address().port;
  manager.quiet = () => false;
  manager.frameAction(frame.id, 'pruefen');
  await manager.prepare(frame);
  manager.deliver = async () => true;
  frame.lastProbe = Date.now() - 6000;
  await manager.tick(frame);
  await new Promise((r) => setImmediate(r));
  assert.equal(connections, 1);
  assert.equal(bytes, 0);
  frame.watch.until = Date.now() - 1;
  frame.lastProbe = Date.now() - 6000;
  await manager.tick(frame);
  assert.equal(connections, 1);
  frame.watch.until = Date.now() + H;
  frame.lastProbe = Date.now() - 6000;
  app.busy = { what: 'fixture' };
  await manager.tick(frame);
  assert.equal(connections, 1);
  app.busy = null;
});

test('optional UI_PASSWORD protects manager reads, uploads and fallback page', async (t) => {
  const { manager } = await setup(t);
  manager.base.server.uiPassword = 'fixture-ui';
  const server = createServer(manager.base, [...manager.apps.values()], {
    manager,
  });
  await server.listen();
  t.after(() => server.close());
  for (const p of [
    '/api/v1/bootstrap',
    '/api/v1/call/listKeys',
    '/api/v1/uploads',
    '/alt',
  ])
    assert.equal((await fetch(server.baseUrl + p)).status, 401);
  const response = await fetch(server.baseUrl + '/api/v1/call/listKeys', {
    headers: {
      Authorization: `Basic ${Buffer.from('user:fixture-ui').toString('base64')}`,
    },
  });
  assert.equal(response.status, 200);
});

test('S2 manual show-now is applied once at contact; long selections keep a bounded buffer and backlog', async (t) => {
  const fake = await startFakeEmdx();
  t.after(() => fake.close());
  const { manager, frame } = await setup(t, { fake });
  const server = createServer(manager.base, [...manager.apps.values()], {
    manager,
  });
  await server.listen();
  t.after(() => server.close());
  manager.server = server;
  const ids = manager
    .listPictures()
    .slice(0, 7)
    .map((p) => p.id);
  manager.show({
    pictureIds: ids,
    scope: { frameId: frame.id },
    when: 'jetzt',
    force: true,
  });
  await manager.prepare(frame);
  assert.ok(frame.prepared.manual.length <= frame.buffer + 1);
  assert.equal(await manager.deliver(frame), true);
  assert.deepEqual(
    frame.delivered.entries.filter((e) => !e.tail).map((e) => e.pictureId),
    ids.slice(0, 4),
  );
  const change = manager.s.pending.find((p) => p.payload.pictureIds);
  assert.deepEqual(change.payload.remaining, ids.slice(4));
  assert.equal(change.state, 'eingestellt');
  assert.equal(change.kind, 'zeigen-naechstes');
  let now = frame.delivered.entries[1].at + 1;
  t.mock.method(Date, 'now', () => now);
  frame.guard = null;
  await manager.prepare(frame);
  assert.equal(await manager.deliver(frame), true);
  assert.deepEqual(
    frame.delivered.entries
      .filter((e) => !e.tail)
      .map((e) => e.pictureId),
    ids.slice(1, 5),
  );
  assert.deepEqual(change.payload.remaining, ids.slice(5));
  for (let i = 2; i <= 3; i++) {
    now = frame.delivered.entries[1].at + 1;
    await manager.prepare(frame);
    assert.equal(await manager.deliver(frame), true);
    assert.deepEqual(frame.delivered.entries.filter((e) => !e.tail).map((e) => e.pictureId), ids.slice(i, i + 4));
  }
  assert.equal(change.state, 'uebertragen');
});

test('showing an already buffered picture now does not repeat it at the following change', async (t) => {
  const { manager, frame } = await setup(t);
  await manager.prepare(frame);
  const pid = frame.prepared.entries[1].pictureId;
  manager.show({
    pictureIds: [pid],
    scope: { frameId: frame.id },
    when: 'jetzt',
    force: true,
  });
  await manager.prepare(frame);
  assert.equal(frame.prepared.manual[0].pictureId, pid);
  assert.ok(frame.prepared.entries.slice(1).every((e) => e.pictureId !== pid));
});

test('show warnings offer a forced plan and apply only the safe subset without force', async (t) => {
  const { manager, frame } = await setup(t);
  const [blocked, safe] = manager.listPictures();
  frame.current = { pictureId: blocked.id, since: Date.now() };
  manager.reserve(blocked.id, frame.id);
  frame.plan = [{ pictureId: blocked.id, at: Date.now() + H }];
  const request = {
    pictureIds: [blocked.id, safe.id],
    scope: { frameId: frame.id },
    when: 'jetzt',
    force: false,
  };
  const plan = manager.planShow(request);
  assert.equal(plan.warnings.length, 1);
  assert.equal(plan.warnings[0].reason, 'haengt');
  assert.deepEqual(plan.lines[0].pictureIds, [safe.id]);
  assert.deepEqual(plan.unplaced, []);
  assert.deepEqual(
    manager.planShow({ ...request, force: true }).lines[0].pictureIds,
    request.pictureIds,
  );
  manager.show(request);
  assert.deepEqual(manager.s.pending.at(-1).payload.pictureIds, [safe.id]);
});

test('a new frame with no free pictures can receive and hold its identification card', async (t) => {
  const fake = await startFakeEmdx();
  t.after(() => fake.close());
  const { manager, frame } = await setup(t, { fake, count: 0 });
  const server = createServer(manager.base, [...manager.apps.values()], {
    manager,
  });
  await server.listen();
  t.after(() => server.close());
  manager.server = server;
  manager.updateFrame(frame.id, { cleaning: '06:41' });
  manager.frameAction(frame.id, 'erkennungsbild');
  await manager.prepare(frame);
  assert.ok(
    frame.prepared.entries.every(
      (e) => e.card === 'erkennungsbild' && fs.existsSync(e.file),
    ),
  );
  assert.equal(await manager.deliver(frame), true);
  assert.equal(
    manager.s.pending.find((p) => p.kind === 'reinigung').state,
    'bestaetigt',
  );
  assert.equal(
    fake.events.filter((e) => e.startsWith('cmd:')).at(-1),
    'cmd:c7',
  );
});

async function serving(t, manager) {
  const server = createServer(manager.base, [...manager.apps.values()], { manager });
  await server.listen();
  t.after(() => server.close());
  manager.server = server;
  for (const app of manager.apps.values()) app.server = server;
  return server;
}

test('S1 refill reuses the matching delivered PNG and invalidates it on rendering changes', async (t) => {
  const { manager, frame } = await setup(t);
  await manager.prepare(frame);
  const entries = frame.prepared.entries.map((e, i, all) => ({
    ...e, durationMs: (all[i + 1]?.at || manager.clock(frame).next(e.at)) - e.at,
  }));
  frame.delivered = { id: frame.prepared.id, entries, builtAt: entries[0].at };
  frame.current = { pictureId: entries[0].pictureId, entryFile: entries[0].file };
  const currentDir = manager.apps.get(frame.id).store.path('current');
  fs.copyFileSync(entries[0].file, path.join(currentDir, 'device.png'));
  const now = entries[1].at + 1;
  t.mock.method(Date, 'now', () => now);
  manager.advanceFrame(frame);
  assert.equal(frame.current.pictureId, entries[1].pictureId);
  await manager.prepare(frame);
  assert.deepEqual(fs.readFileSync(frame.prepared.entries[0].file), fs.readFileSync(entries[1].file));
  assert.notDeepEqual(fs.readFileSync(frame.prepared.entries[0].file), fs.readFileSync(entries[0].file));
  const render = t.mock.method(manager, 'renderPicture', manager.renderPicture.bind(manager));
  manager.updatePicture(frame.current.pictureId, { crop: { orientation: 'hoch', crop: { x: 50, y: 50, zoom: 2, auto: false } } });
  await manager.prepare(frame);
  assert.ok(render.mock.calls.some((c) => c.arguments[0].id === frame.current.pictureId));
  const key = frame.prepared.entries[0].renderKey;
  manager.updateFrame(frame.id, { upsideDown: true });
  await manager.prepare(frame);
  assert.notEqual(frame.prepared.entries[0].renderKey, key);
});

test('S3 successful delivery retains manual backlog and concurrent reservations', async (t) => {
  const fake = await startFakeEmdx();
  t.after(() => fake.close());
  const { manager, frame } = await setup(t, { fake });
  await serving(t, manager);
  const ids = manager.listPictures().map((p) => p.id);
  manager.show({ pictureIds: ids.slice(0, 7), scope: { frameId: frame.id }, when: 'jetzt', force: true });
  await manager.prepare(frame);
  const app = manager.apps.get(frame.id);
  const note = app.noteCleaning.bind(app);
  let queued = false;
  app.noteCleaning = (...args) => {
    note(...args);
    if (!queued) {
      queued = true;
      manager.show({ pictureIds: [ids[7]], scope: { frameId: frame.id }, when: 'naechstes', force: true });
    }
  };
  assert.equal(await manager.deliver(frame), true);
  for (const pid of ids.slice(4, 8)) {
    assert.ok(manager.owners(pid).includes(frame.id));
    assert.throws(() => manager.reserve(pid, 'another-frame'), /anderen Rahmen/);
  }
});

test('S3 delivery revalidates manual ownership before the content command', async (t) => {
  const fake = await startFakeEmdx();
  t.after(() => fake.close());
  const { manager, frame } = await setup(t, { fake });
  await serving(t, manager);
  const pid = manager.listPictures()[0].id;
  manager.show({ pictureIds: [pid], scope: { frameId: frame.id }, when: 'jetzt', force: false });
  await manager.prepare(frame);
  const app = manager.apps.get(frame.id);
  const note = app.noteCleaning.bind(app);
  app.noteCleaning = (...args) => {
    note(...args);
    manager.reserve(pid, 'another-frame', true);
  };
  assert.equal(await manager.deliver(frame), false);
  assert.ok(!fake.events.includes('cmd:c7'));
  assert.equal(manager.s.pending.find((p) => p.payload.pictureIds).state, 'eingestellt');
  // A deliberate forced request still permits shared ownership on later refills.
  manager.s.pending.find((p) => p.payload.pictureIds).payload.force = true;
  await manager.prepare(frame);
  assert.equal(await manager.deliver(frame), true);
  const now = frame.guard.until + 1;
  t.mock.method(Date, 'now', () => now);
  // Keep this forced image current through a button wake after leaving Wi-Fi.
  frame.delivered.builtAt = now;
  frame.guard = null;
  await manager.prepare(frame);
  assert.equal(await manager.deliver(frame), true);
});

test('S4 global reorder uses the shared deck and respects another frame\'s locked cards', async (t) => {
  const { manager, frame } = await setup(t);
  await manager.prepare(frame);
  const other = manager.addFrame({
    name: 'Zweiter', device: 'Frame 2', ip: '127.0.0.2', orientation: 'hoch', upsideDown: false,
    power: 'akku', cadence: frame.cadence, cleaning: '05:50', buffer: 3, groupId: 'default', pin: null,
  });
  await manager.prepare(manager.frame(other.id));
  const movable = manager.getDeck('default', 'hoch').cards.find((c) => !c.locked && !c.frameId);
  assert.ok(movable);
  manager.moveDeckCard('default', 'hoch', movable.pictureId, 0);
  assert.ok(manager.s.pending.filter((p) => p.title === 'Reihenfolge im Stapel geändert').every((p) => !p.payload.order));
  await manager.prepare(frame);
  assert.equal(frame.prepared.entries[1].pictureId, movable.pictureId);
  await manager.prepare(manager.frame(other.id));
  for (const f of [frame, manager.frame(other.id)])
    for (const e of f.prepared.entries)
      assert.ok(manager.owners(e.pictureId).every((owner) => owner === f.id));
});

test('S5 timeline reorder cannot override Event assignments', async (t) => {
  const { manager, frame } = await setup(t);
  const clock = manager.clock(frame);
  const start = clock.next(Date.now());
  const ids = manager.listPictures().map((p) => p.id);
  const event = manager.saveEvent({ name: 'Event', start, end: start + 2 * H, everyMin: 60,
    frameIds: [frame.id], pictureIds: ids.slice(0, 2), sameOnAll: false });
  manager.queue(frame, 'reihenfolge', 'Reorder', { order: ids.slice(2, 6), reorderAt: start });
  await manager.prepare(frame);
  assert.deepEqual(frame.prepared.entries.filter((e) => e.eventId === event.id).map((e) => e.pictureId), ids.slice(0, 2));
});

test('N1 global reorder retains its allocations across preparations and the scheduled wake', async (t) => {
  const { manager, frame } = await setup(t);
  await manager.prepare(frame);
  const original = frame.prepared.entries;
  frame.current = { pictureId: original[0].pictureId, since: original[0].at };
  frame.delivered = { id: frame.prepared.id, builtAt: original[0].at, entries: original.map((e, i) => ({
    ...e, durationMs: (original[i + 1]?.at || manager.clock(frame).next(e.at)) - e.at,
  })) };
  const movable = manager.getDeck('default', 'hoch').cards.find((c) => !c.locked && !c.frameId);
  assert.ok(movable);
  manager.moveDeckCard('default', 'hoch', movable.pictureId, 0);
  await manager.prepare(frame);
  const allocated = frame.prepared.entries.slice(2).map((e) => ({ at: e.at, pictureId: e.pictureId }));
  assert.equal(allocated[0].pictureId, movable.pictureId);
  await manager.prepare(frame);
  assert.deepEqual(frame.prepared.entries.slice(2).map((e) => ({ at: e.at, pictureId: e.pictureId })), allocated);
  const now = original[1].at + 1;
  t.mock.method(Date, 'now', () => now);
  await manager.prepare(frame);
  for (const entry of allocated)
    assert.equal(frame.prepared.entries.find((e) => e.at === entry.at)?.pictureId, entry.pictureId);
  const next = manager.getDeck('default', 'hoch').cards.find((c) => !c.locked && !c.frameId);
  assert.ok(next);
  manager.moveDeckCard('default', 'hoch', next.pictureId, 0);
  await manager.prepare(frame);
  assert.equal(frame.prepared.entries[2].pictureId, next.pictureId);
});

test('N2 refill excludes deleted and paused future manual pictures', async (t) => {
  const fake = await startFakeEmdx();
  t.after(() => fake.close());
  const { manager, frame } = await setup(t, { fake });
  await serving(t, manager);
  const ids = manager.listPictures().slice(0, 4).map((p) => p.id);
  manager.show({ pictureIds: ids, scope: { frameId: frame.id }, when: 'jetzt', force: true });
  await manager.prepare(frame);
  assert.equal(await manager.deliver(frame), true);
  assert.deepEqual(frame.delivered.entries.filter((e) => !e.tail).map((e) => e.pictureId), ids);
  manager.deletePicture(ids[2]);
  manager.updatePicture(ids[3], { paused: true });
  const now = frame.delivered.entries[1].at + 1;
  t.mock.method(Date, 'now', () => now);
  await manager.prepare(frame);
  assert.equal(frame.prepared.entries[0].pictureId, ids[1]);
  assert.ok(frame.prepared.entries.slice(1).every((e) => !ids.slice(2).includes(e.pictureId)));
  assert.equal(await manager.deliver(frame), true);
  assert.ok(frame.delivered.entries.every((e) => !ids.slice(2).includes(e.pictureId)));
  assert.equal(fake.events.filter((e) => e.startsWith('cmd:')).at(-1), 'cmd:c7');
});

test('N3 forced shared picture keeps authorization through shortage fallback and refill', async (t) => {
  const fake = await startFakeEmdx();
  t.after(() => fake.close());
  const { manager, frame } = await setup(t, { fake, count: 1 });
  await serving(t, manager);
  const pid = manager.listPictures()[0].id;
  const other = manager.addFrame({
    name: 'Zweiter', device: 'Frame 2', ip: '127.0.0.2', orientation: 'hoch', upsideDown: false,
    power: 'akku', cadence: frame.cadence, cleaning: '05:50', buffer: 3, groupId: 'default', pin: null,
  });
  manager.reserve(pid, other.id);
  manager.show({ pictureIds: [pid], scope: { frameId: frame.id }, when: 'jetzt', force: true });
  await manager.prepare(frame);
  assert.equal(await manager.deliver(frame), true);
  assert.ok(frame.delivered.entries.every((e) => e.pictureId === pid && e.force));
  assert.equal(fake.events.filter((e) => e === 'cmd:c7').length, 1);
  assert.equal(fake.events.filter((e) => e.startsWith('cmd:')).at(-1), 'cmd:c7');
  assert.equal(await manager.deliver(frame), false);
  const now = frame.delivered.entries[1].at + 1;
  t.mock.method(Date, 'now', () => now);
  await manager.prepare(frame);
  assert.ok(frame.prepared.entries.every((e) => e.pictureId === pid && e.force));
  assert.equal(await manager.deliver(frame), true);
  assert.equal(fake.events.filter((e) => e === 'cmd:c7').length, 2);
  assert.equal(fake.events.filter((e) => e.startsWith('cmd:')).at(-1), 'cmd:c7');
  // Ownership checks still reject the same entries without explicit authorization.
  frame.guard = null;
  await manager.prepare(frame);
  for (const entry of frame.prepared.entries) entry.force = false;
  assert.equal(await manager.deliver(frame), false);
  assert.equal(fake.events.filter((e) => e === 'cmd:c7').length, 2);
});

test('S6 an Event outside compilation limits is rejected without blocking normal refills', async (t) => {
  const { manager, frame } = await setup(t);
  const before = structuredClone(manager.s.claims);
  const start = Date.now() + 40 * DAY;
  assert.throws(() => manager.saveEvent({ name: 'Zu weit weg', start, end: start + H, everyMin: 60,
    frameIds: [frame.id], pictureIds: [manager.listPictures()[0].id], sameOnAll: false }), /weit voraus|viele Wechsel/);
  assert.equal(manager.s.events.length, 0);
  assert.deepEqual(manager.s.claims, before);
  assert.equal(manager.s.pending.length, 0);
  await manager.prepare(frame);
  assert.equal(frame.prepared.entries.length, frame.buffer + 1);
});

test('S7 failed download retains content intent through restart and forbids a same-wake retry', async (t) => {
  const fake = await startFakeEmdx({ fetchImage: false });
  t.after(() => fake.close());
  const { manager, frame, seeds, model, env } = await setup(t, { fake });
  await serving(t, manager);
  manager.apps.get(frame.id).cfg.display.fetchTimeoutSec = 0.03;
  const pid = manager.listPictures()[0].id;
  manager.show({ pictureIds: [pid], scope: { frameId: frame.id }, when: 'jetzt', force: true });
  const change = manager.s.pending.at(-1);
  await manager.prepare(frame);
  assert.equal(await manager.deliver(frame), false);
  assert.equal(change.state, 'eingestellt');
  assert.equal(change.sentAt, undefined);
  assert.equal(change.payload.remaining, undefined);
  assert.ok(!change.verification.includes('Downloadnachweis'));
  assert.equal(await manager.deliver(frame), false);
  assert.equal(fake.events.filter((e) => e === 'cmd:c7').length, 1);
  // Also exercise a crash while applying, before a successful download was recorded.
  change.applying = true;
  manager.save();
  const restarted = new Manager(seeds, model, { env });
  await restarted.initialize();
  const restored = restarted.s.pending.find((p) => p.id === change.id);
  assert.equal(restored.state, 'eingestellt');
  assert.equal(restored.applying, undefined);
  assert.equal(restarted.guarded(restarted.frame(frame.id)), true);
  const now = frame.guard.until + 1;
  t.mock.method(Date, 'now', () => now);
  await restarted.prepare(restarted.frame(frame.id));
  assert.equal(restarted.frame(frame.id).prepared.manual[0].pictureId, pid);
});

test('S8 deleted media returns 404 and is reclaimed after delivered programs and combinations release it', async (t) => {
  const { manager, frame } = await setup(t);
  const server = await serving(t, manager);
  const [a, b, c] = manager.s.pictures;
  frame.delivered = { id: 'fixture', entries: [{ pictureId: a.id, file: a.file }] };
  manager.deletePicture(a.id);
  for (const variant of ['image', 'thumb'])
    assert.equal((await fetch(`${server.baseUrl}/api/v1/media/${encodeURIComponent(a.id)}/${variant}`)).status, 404);
  assert.ok(fs.existsSync(a.file));
  frame.delivered = null;
  manager.collectGarbage();
  assert.ok(!fs.existsSync(a.file));
  const combo = await manager.createCombo('2-uebereinander', [b.id, c.id]);
  manager.deletePicture(b.id);
  assert.ok(fs.existsSync(b.file));
  manager.deletePicture(combo.id);
  assert.ok(!fs.existsSync(b.file));
  assert.ok(!fs.existsSync(manager.picture(combo.id).file));
});

test('S9 changing Immich destination clears its write-only credential; env key locks the destination', async (t) => {
  const { manager } = await setup(t);
  manager.updateSettings({ immichUrl: 'http://127.0.0.1:1234/api' });
  manager.saveKey('immich', 'fixture-destination-key');
  manager.s.keyTests.immich = { status: 'funktioniert' };
  manager.updateSettings({ immichUrl: 'http://127.0.0.1:1234/api/' });
  assert.ok(manager.secrets.get('immich'));
  manager.updateSettings({ immichUrl: 'http://127.0.0.1:5678/api' });
  assert.equal(manager.secrets.get('immich'), null);
  assert.equal(manager.s.keyTests.immich, undefined);
  assert.throws(() => manager.immichClient(), /Schlüssel fehlt/);
  manager.env.IMMICH_API_KEY = 'fixture-env-key';
  assert.equal(manager.getSettings().immichUrlLocked, true);
  assert.throws(() => manager.updateSettings({ immichUrl: 'http://127.0.0.1:9876/api' }), /Server-Einrichtung/);
  assert.equal(manager.immichClient().base, 'http://127.0.0.1:5678/api');
});

test('S10 fallback actions keep their Promise contract and answer HTTP requests', async (t) => {
  const { manager, frame } = await setup(t);
  const server = await serving(t, manager);
  const app = manager.apps.get(frame.id);
  for (const method of ['next', 'resend', 'testPattern', 'displayInfo', 'deepSleep', 'sleepRightAway']) {
    const result = app[method]();
    assert.equal(typeof result?.then, 'function', method);
    await result;
  }
  for (const route of ['next', 'resend', 'test-pattern', 'sleep', 'deep-sleep', 'display-info']) {
    const response = await fetch(`${server.baseUrl}/api/${route}`, { method: 'POST', signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, route === 'display-info' ? 200 : 202);
  }
});

test('S11 recompiled timeline reorder retains its boundary at the scheduled wake', async (t) => {
  const { manager, frame } = await setup(t);
  await manager.prepare(frame);
  const original = frame.prepared.entries;
  frame.current = { pictureId: original[0].pictureId, since: original[0].at };
  frame.delivered = { id: frame.prepared.id, builtAt: original[0].at, entries: original.map((e, i) => ({
    ...e, durationMs: (original[i + 1]?.at || manager.clock(frame).next(e.at)) - e.at,
  })) };
  manager.moveTimelineItem(frame.id, original[3].pictureId, 0);
  await manager.prepare(frame);
  assert.equal(frame.prepared.entries[1].pictureId, original[1].pictureId);
  assert.equal(frame.prepared.entries[2].pictureId, original[3].pictureId);
  const now = original[1].at + 1;
  t.mock.method(Date, 'now', () => now);
  manager.advanceFrame(frame);
  await manager.prepare(frame);
  assert.equal(frame.prepared.entries[0].pictureId, original[1].pictureId);
  assert.equal(frame.prepared.entries[1].at, original[2].at);
  assert.equal(frame.prepared.entries[1].pictureId, original[3].pictureId);
  assert.equal(frame.prepared.entries[2].pictureId, original[2].pictureId);
});

test('S13 preflight failure releases registered URLs and retired programs release registrations', async (t) => {
  const fake = await startFakeEmdx();
  t.after(() => fake.close());
  const { manager, frame } = await setup(t, { fake });
  const server = await serving(t, manager);
  const app = manager.apps.get(frame.id);
  const note = app.noteCleaning;
  app.noteCleaning = () => { throw new Error('preflight failure'); };
  await manager.prepare(frame);
  assert.equal(await manager.deliver(frame), false);
  const failed = manager.s.programs.at(-1);
  assert.equal(failed.state, 'failed');
  assert.ok(failed.content.id);
  assert.equal((await fetch(`${server.baseUrl}/emdx/${failed.content.id}/content.json`)).status, 404);
  assert.ok(!fake.events.includes('cmd:c7'));
  // A registration restored by an earlier process is also released on retirement/GC.
  server.restoreContent(failed.content);
  failed.state = 'retired';
  manager.collectGarbage();
  assert.equal((await fetch(`${server.baseUrl}/emdx/${failed.content.id}/content.json`)).status, 404);
  app.noteCleaning = note;
  assert.equal(await manager.deliver(frame), true);
  assert.equal((await fetch(`${server.baseUrl}/emdx/${failed.content.id}/content.json`)).status, 404);
});

test('S14 settings and device checks work without pictures and still respect the content guard', async (t) => {
  const fake = await startFakeEmdx();
  t.after(() => fake.close());
  const { manager, frame } = await setup(t, { fake, count: 0 });
  manager.updateFrame(frame.id, { cleaning: '06:42' });
  manager.frameAction(frame.id, 'pruefen');
  await manager.prepare(frame);
  assert.equal(await manager.deliver(frame), true);
  assert.ok(fake.events.includes('cmd:1b:176,128,2,6,42'));
  assert.ok(!fake.events.includes('cmd:c7'));
  assert.equal(manager.s.pending.find((p) => p.kind === 'reinigung').state, 'bestaetigt');
  assert.equal(manager.s.pending.find((p) => p.payload.action === 'pruefen').state, 'bestaetigt');
  manager.markUpdated(frame);
  manager.frameAction(frame.id, 'pruefen');
  await manager.prepare(frame);
  const before = fake.events.length;
  assert.equal(await manager.deliver(frame), false);
  assert.equal(fake.events.length, before);
});
