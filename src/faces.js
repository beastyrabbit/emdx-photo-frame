// Finding the faces in a photo, so the crop can be placed around the people in it.
// YuNet (OpenCV's face detector, models/face_detection_yunet_2023mar.onnx, MIT) run with
// ONNX Runtime's WebAssembly build: no native code, so it runs on any NAS CPU. Nothing
// leaves the machine.
import fs from 'node:fs';
import sharp from 'sharp';
import { log } from './log.js';

const MODEL = new URL('../models/face_detection_yunet_2023mar.onnx', import.meta.url);
const SIZE = 640; // the model's fixed input (square)
const STRIDES = [8, 16, 32];
const MIN_SCORE = 0.7;
// The whole photo is looked at once at 640 px, then again in overlapping 640 px tiles of a
// copy up to this size, which is what finds the small faces of a group shot.
const DETAIL = 1280;

let loading = null;
let broken = false;

async function load() {
  loading ||= (async () => {
    const ort = await import('onnxruntime-web');
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = 'error';
    const session = await ort.InferenceSession.create(fs.readFileSync(MODEL));
    return { ort, session };
  })();
  return loading;
}

// Boxes (in pixels of the 640 px input) from one run of the model.
export function decode(out, minScore = MIN_SCORE) {
  const boxes = [];
  for (const stride of STRIDES) {
    const cols = SIZE / stride;
    const cls = out[`cls_${stride}`].data;
    const obj = out[`obj_${stride}`].data;
    const bbox = out[`bbox_${stride}`].data;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
      if (score < minScore) continue;
      const cx = ((i % cols) + bbox[i * 4]) * stride;
      const cy = (Math.floor(i / cols) + bbox[i * 4 + 1]) * stride;
      const w = Math.exp(bbox[i * 4 + 2]) * stride;
      const h = Math.exp(bbox[i * 4 + 3]) * stride;
      boxes.push({ x: cx - w / 2, y: cy - h / 2, w, h, score });
    }
  }
  return boxes;
}

// Keep the best box of every face: drop boxes that overlap a better one, or lie mostly inside
// it (half a face seen at the edge of a tile).
export function mergeBoxes(boxes) {
  const kept = [];
  for (const b of boxes.slice().sort((p, q) => q.score - p.score)) {
    const dup = kept.some((k) => {
      const iw = Math.min(b.x + b.w, k.x + k.w) - Math.max(b.x, k.x);
      const ih = Math.min(b.y + b.h, k.y + k.h) - Math.max(b.y, k.y);
      if (iw <= 0 || ih <= 0) return false;
      const inter = iw * ih;
      return inter / (b.w * b.h + k.w * k.h - inter) > 0.3 || inter / Math.min(b.w * b.h, k.w * k.h) > 0.6;
    });
    if (!dup) kept.push(b);
  }
  return kept;
}

// Where 640 px tiles start along a side of `length` px: enough of them to overlap by half.
export function tileStarts(length) {
  if (length <= SIZE) return [0];
  const n = Math.ceil((length - SIZE) / (SIZE / 2)) + 1;
  return Array.from({ length: n }, (_, i) => Math.round((i * (length - SIZE)) / (n - 1)));
}

// A 640 x 640 window of an RGB image as the model wants it: BGR planes, 0..255, black outside.
function tensorData(rgb, width, height, x0, y0) {
  const plane = SIZE * SIZE;
  const data = new Float32Array(3 * plane);
  const w = Math.min(SIZE, width - x0);
  const h = Math.min(SIZE, height - y0);
  for (let y = 0; y < h; y++) {
    let src = ((y0 + y) * width + x0) * 3;
    let dst = y * SIZE;
    for (let x = 0; x < w; x++, src += 3, dst++) {
      data[dst] = rgb[src + 2];
      data[plane + dst] = rgb[src + 1];
      data[2 * plane + dst] = rgb[src];
    }
  }
  return data;
}

async function scaled(input, longSide) {
  const { data, info } = await sharp(input, { failOn: 'none' })
    .rotate() // honour EXIF orientation, as the crop does
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .resize(longSide, longSide, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`Unexpected channel count ${info.channels}`);
  return { data, width: info.width, height: info.height };
}

// The faces in a photo (a file's bytes): [{ x, y, w, h, score }] as fractions of the upright
// photo's width and height. Empty when there are none, or when the detector can't run (logged
// once; the crop then falls back to what it did without faces).
export async function detectFaces(input) {
  if (broken) return [];
  let ort, session;
  try {
    ({ ort, session } = await load());
  } catch (err) {
    broken = true;
    log.warn(`Face detection is unavailable, cropping without it: ${err.message}`);
    return [];
  }
  try {
    const run = async (img, x0, y0) => {
      const tensor = new ort.Tensor('float32', tensorData(img.data, img.width, img.height, x0, y0), [1, 3, SIZE, SIZE]);
      return decode(await session.run({ [session.inputNames[0]]: tensor }));
    };
    const whole = await scaled(input, SIZE);
    const found = (await run(whole, 0, 0)).map((b) => ({
      x: b.x / whole.width, y: b.y / whole.height, w: b.w / whole.width, h: b.h / whole.height, score: b.score,
    }));
    const detail = await scaled(input, DETAIL);
    if (Math.max(detail.width, detail.height) > SIZE * 1.25) {
      for (const y0 of tileStarts(detail.height)) {
        for (const x0 of tileStarts(detail.width)) {
          for (const b of await run(detail, x0, y0)) {
            // A box against an inner edge of the tile is a face cut in two: the next tile has it whole.
            const cut = (b.x < 2 && x0 > 0) || (b.y < 2 && y0 > 0)
              || (b.x + b.w > SIZE - 2 && x0 + SIZE < detail.width) || (b.y + b.h > SIZE - 2 && y0 + SIZE < detail.height);
            if (cut) continue;
            found.push({
              x: (b.x + x0) / detail.width, y: (b.y + y0) / detail.height, w: b.w / detail.width, h: b.h / detail.height, score: b.score,
            });
          }
        }
      }
    }
    return mergeBoxes(found).map((b) => {
      const x = Math.max(0, b.x), y = Math.max(0, b.y);
      return { x, y, w: Math.min(1, b.x + b.w) - x, h: Math.min(1, b.y + b.h) - y, score: +b.score.toFixed(3) };
    }).filter((b) => b.w > 0 && b.h > 0);
  } catch (err) {
    log.warn(`Could not look for faces in a photo, cropping without them: ${err.message}`);
    return [];
  }
}
