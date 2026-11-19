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
import { normalize } from '../src/manager/media.js';
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
  const pixels = await sharp(image.png)
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

test('manual show-now is applied once at contact; long selections keep a bounded buffer and backlog', async (t) => {
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
  frame.guard = null;
  await manager.prepare(frame);
  assert.equal(await manager.deliver(frame), true);
  assert.deepEqual(
    frame.delivered.entries
      .filter((e) => !e.tail)
      .slice(1)
      .map((e) => e.pictureId),
    ids.slice(4),
  );
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
