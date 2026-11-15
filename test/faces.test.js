import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { detectFaces, mergeBoxes, tileStarts } from '../src/faces.js';
import { subjects, faceSpan, placeWindow, cellLimits } from '../src/crop.js';
import { pairCells, faceCrop, composeCanvas } from '../src/render.js';

// The Apollo 11 crew (NASA, public domain): Armstrong left, Collins in the middle, Aldrin right.
const crew = fs.readFileSync(new URL('./fixtures/apollo11-crew.jpg', import.meta.url));
const face = (x, y = 0.3, w = 0.1, h = 0.15) => ({ x, y, w, h });

test('finds the three faces of the Apollo 11 crew, left to right', async () => {
  const faces = (await detectFaces(crew)).sort((a, b) => a.x - b.x);
  assert.equal(faces.length, 3);
  for (const f of faces) assert.ok(f.score > 0.8 && f.w > 0.05 && f.w < 0.15, JSON.stringify(f));
  assert.ok(faces[0].x < 0.3 && faces[1].x > 0.4 && faces[1].x < 0.5 && faces[2].x > 0.65);
});

test('a photo lying on its side (EXIF) gives the same faces as the upright one', async () => {
  const lying = await sharp(crew).rotate(270).withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toBuffer();
  const faces = (await detectFaces(lying)).sort((a, b) => a.x - b.x);
  const upright = (await detectFaces(crew)).sort((a, b) => a.x - b.x);
  assert.equal(faces.length, 3);
  faces.forEach((f, i) => assert.ok(Math.abs(f.x - upright[i].x) < 0.02 && Math.abs(f.y - upright[i].y) < 0.02));
});

test('no faces in a photo without people', async () => {
  const sky = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#7799cc' } }).jpeg().toBuffer();
  assert.deepEqual(await detectFaces(sky), []);
});

test('tiles cover the whole side and overlap by at least half', () => {
  assert.deepEqual(tileStarts(600), [0]);
  assert.deepEqual(tileStarts(960), [0, 320]);
  assert.deepEqual(tileStarts(1280), [0, 320, 640]);
});

test('a face seen twice, or in part, counts once', () => {
  const kept = mergeBoxes([
    { x: 0.1, y: 0.1, w: 0.1, h: 0.1, score: 0.9 },
    { x: 0.11, y: 0.1, w: 0.1, h: 0.1, score: 0.8 }, // the same face from another tile
    { x: 0.1, y: 0.1, w: 0.04, h: 0.1, score: 0.75 }, // half of it
    { x: 0.5, y: 0.1, w: 0.1, h: 0.1, score: 0.85 },
  ]);
  assert.deepEqual(kept.map((k) => k.score), [0.9, 0.85]);
});

test('passers-by in the background do not count', () => {
  const kept = subjects([face(0.2), face(0.5), { x: 0.9, y: 0.3, w: 0.02, h: 0.03 }]);
  assert.equal(kept.length, 2);
});

test('the attention crop stays when the faces are well inside it', () => {
  assert.deepEqual(placeWindow({ len: 0.6, pref: 0.2, faces: [face(0.45)], axis: 'x' }), { start: 0.2, len: 0.6 });
});

test('the crop moves to bring a face in, with room around it', () => {
  const win = placeWindow({ len: 0.6, pref: 0.4, faces: [face(0.15)], axis: 'x' });
  assert.equal(win.len, 0.6);
  assert.ok(win.start <= 0.05 + 1e-9, `starts at ${win.start}`); // a face width of room on its left
});

test('a group that just fits sits in the middle of the crop', () => {
  const faces = [face(0.1), face(0.6)];
  const span = faceSpan(faces, 'x');
  const win = placeWindow({ len: 0.7, pref: 0, faces, axis: 'x' });
  assert.ok(Math.abs((win.start + 0.35) - (span.from + span.to) / 2) < 1e-9);
});

test('a group wider than the crop: `keep` widens it, `prefer` takes the most face', () => {
  const faces = [face(0.02), face(0.3), { x: 0.75, y: 0.2, w: 0.2, h: 0.3 }];
  const keep = placeWindow({ len: 0.5, pref: 0, faces, axis: 'x', mode: 'keep' });
  const span = faceSpan(faces, 'x');
  assert.deepEqual(keep, { start: span.from, len: span.to - span.from });
  const prefer = placeWindow({ len: 0.5, pref: 0, faces, axis: 'x', mode: 'prefer' });
  assert.equal(prefer.len, 0.5);
  assert.equal(prefer.start, 0.5); // the large face on the right outweighs the two small ones
});

test('heads are not cut off at the top', () => {
  const win = placeWindow({ len: 0.5, pref: 0.4, faces: [face(0.4, 0.2)], axis: 'y' });
  assert.ok(win.start <= 0.2 - 0.5 * 0.15 + 1e-9);
});

test('a pair gives the group photo the shape its faces need', () => {
  // Portrait frame, two 4:3 photos; the first has faces from edge to edge.
  const wide = [face(0.02), face(0.88)];
  const limits = [cellLimits(4 / 3, wide, true, 1440), cellLimits(4 / 3, [], true, 1440)];
  const even = pairCells(1440, 2560, 20, [4 / 3, 4 / 3]);
  const [a, b] = pairCells(1440, 2560, 20, [4 / 3, 4 / 3], limits);
  assert.equal(even[0].h, 1270);
  assert.ok(a.h < even[0].h && a.h >= Math.round(2540 * 0.35));
  assert.ok(a.h <= limits[0].max + 1);
  assert.equal(a.h + b.h + 20, 2560);
});

test('faceCrop: nothing to do when the attention crop already holds the faces', () => {
  const look = { width: 1600, height: 1200, faces: [face(0.45)] };
  assert.equal(faceCrop(look, 800, 1200, { x: 400, y: 0 }, 'keep'), null);
});

test('faceCrop: a group that needs the whole width is drawn smaller than its cell', () => {
  const look = { width: 1600, height: 1200, faces: [face(0.05), face(0.85)] };
  const crop = faceCrop(look, 800, 1200, { x: 400, y: 0 }, 'keep');
  assert.equal(crop.filled, false);
  assert.equal(crop.width, 800);
  assert.ok(crop.height < 1200);
  assert.ok(crop.cut.left <= 0.05 * 1600 && crop.cut.left + crop.cut.width >= 0.95 * 1600);
  const filled = faceCrop(look, 800, 1200, { x: 400, y: 0 }, 'prefer');
  assert.deepEqual([filled.width, filled.height, filled.cut.width], [800, 1200, 800]);
});

// How much of the canvas' columns [x0, x1) is paper white, top band excluded or not.
const whiteRows = (canvas, width, height) => {
  let n = 0;
  for (let y = 0; y < height; y++) {
    let white = true;
    for (let x = 0; x < width && white; x += 7) {
      const i = (y * width + x) * 3;
      white = canvas[i] > 250 && canvas[i + 1] > 250 && canvas[i + 2] > 250;
    }
    if (white) n++;
  }
  return n;
};

test('on a portrait frame the crew is kept whole with `keep`, fills the frame with `prefer` and `off`', async () => {
  const cfg = (faces) => ({
    panel: { width: 360, height: 640 },
    layout: { faces, gap: 6, margin: 12 },
    image: { sharpen: 0, saturation: 1, contrast: 0, autoLevels: false },
  });
  const plan = { kind: 'cover', items: [{ width: 800, height: 629 }] };
  const keep = await composeCanvas(cfg('keep'), plan, [crew]);
  const bands = whiteRows(keep, 360, 640);
  assert.ok(bands > 100 && bands < 300, `white bands above and below, got ${bands} rows`);
  for (const mode of ['prefer', 'off']) {
    assert.equal(whiteRows(await composeCanvas(cfg(mode), plan, [crew]), 360, 640), 0, mode);
  }
});
