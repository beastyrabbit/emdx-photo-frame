// Layout (smart crop / pair / fit), tone adjustment, dithering and PNG encoding.
import sharp from 'sharp';
import { toneAdjust } from './tone.js';
import { dither, indicesToRgb } from './dither.js';
import { detectFaces } from './faces.js';
import { subjects, placeWindow, cellLimits } from './crop.js';
import { log } from './log.js';

sharp.cache(false);
sharp.concurrency(2);

export function cropLoss(photoAspect, cellAspect) {
  return 1 - Math.min(photoAspect / cellAspect, cellAspect / photoAspect);
}

// Two cells that share the frame: stacked on a portrait frame, side by side on a
// landscape one. The split follows the photos' shapes so both lose about the same, and then
// moves as far as `limits` ask ([{ min, max }] per cell, along the shared side: what the faces
// in each photo need, see cellLimits), within 35-65 %.
export function pairCells(width, height, gap, aspects = [1, 1], limits = null) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const split = (avail, even) => {
    let first = even;
    if (limits) {
      const lo = Math.max(limits[0].min, avail - limits[1].max);
      const hi = Math.min(limits[0].max, avail - limits[1].min);
      first = lo <= hi ? clamp(even, lo, hi) : (lo + hi) / 2;
    }
    return clamp(Math.round(first), Math.round(avail * 0.35), Math.round(avail * 0.65));
  };
  if (width < height) {
    const avail = height - gap;
    const inv = aspects.map((a) => 1 / a);
    const h1 = split(avail, (avail * inv[0]) / (inv[0] + inv[1]));
    return [
      { x: 0, y: 0, w: width, h: h1 },
      { x: 0, y: h1 + gap, w: width, h: avail - h1 },
    ];
  }
  const avail = width - gap;
  const w1 = split(avail, (avail * aspects[0]) / (aspects[0] + aspects[1]));
  return [
    { x: 0, y: 0, w: w1, h: height },
    { x: w1 + gap, y: 0, w: avail - w1, h: height },
  ];
}

// Aspect ratio of one pair cell when split evenly (used to decide whether pairing helps).
export function pairCellAspect(width, height, gap) {
  const [c] = pairCells(width, height, gap, [1, 1]);
  return c.w / c.h;
}

// An artwork is shown whole, on white, with a label under it (its title; its artist and date):
// the room it gets, and the sizes of the label's two lines. `captioned`: leave room for the label.
export function artworkLayout(cfg, captioned = true) {
  const { width, height } = cfg.panel;
  const s = Math.min(width, height);
  const m = cfg.layout.margin;
  const title = Math.max(10, Math.round(s * 0.024));
  const by = Math.max(9, Math.round(s * 0.019));
  const gap = Math.round(s * 0.02);
  const band = captioned ? gap + Math.round(title * 1.4) + Math.round(by * 1.5) : 0;
  return { rect: { x: m, y: m, w: Math.max(1, width - 2 * m), h: Math.max(1, height - 2 * m - band) }, title, by, gap, band };
}

// The label of a plan's artwork ({ title, by }), or null: none to draw (ART_CAPTION=false, or
// the catalogue knows neither title nor artist).
function captionOf(cfg, plan) {
  const label = plan.kind === 'artwork' && cfg.art?.caption !== false ? plan.items[0]?.art : null;
  return label && (label.title || label.by) ? label : null;
}

// What the label's font (DejaVu Serif, in the container) can draw: Latin, Greek and Cyrillic.
const DRAWABLE = /^[\u0020-\u024f\u0370-\u052f\u1e00-\u1fff\u2010-\u2027\u2030-\u205e]+$/;

// Fit a line of the label into `maxWidth` pixels (by a guess at the letters' width), cutting at
// a word.
export function clipLine(text, maxWidth, size) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t || !DRAWABLE.test(t)) return '';
  const max = Math.max(8, Math.floor(maxWidth / (size * 0.56)));
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:–-]+$/, '')}…`;
}

// Draw the label under the artwork (`placed`: where the artwork went), centred, in black.
async function drawCaption(canvas, cfg, placed, label) {
  const { width, height } = cfg.panel;
  const L = artworkLayout(cfg, true);
  const top = placed.y + placed.h;
  const h = Math.min(L.band, height - top);
  if (h < L.title) return;
  const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = [];
  let y = L.gap;
  for (const [text, size, room] of [[label.title, L.title, 1.4], [label.by, L.by, 1.5]]) {
    const line = clipLine(text, L.rect.w, size);
    if (!line) continue;
    lines.push(`<text x="${width / 2}" y="${y + size}" font-size="${size}" text-anchor="middle" font-family="DejaVu Serif, Georgia, 'Times New Roman', serif">${xml(line)}</text>`);
    y += Math.round(size * room);
  }
  if (!lines.length) return;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}">${lines.join('')}</svg>`);
  const layer = await sharp(svg).ensureAlpha().raw().toBuffer();
  // Snapped to pure black, so that it stays crisp on the panel (as on the test pattern).
  for (let i = 0, p = top * width * 3; i < width * h; i++, p += 3) {
    if (layer[i * 4 + 3] > 110) { canvas[p] = 0; canvas[p + 1] = 0; canvas[p + 2] = 0; }
  }
}

// Plan -> list of cells: { rect, fit: 'cover' | 'contain' }. `looks`: what was found in each
// photo ({ aspect, faces }, see lookAt), once they are downloaded.
export function planCells(cfg, plan, looks = null) {
  const { width, height } = cfg.panel;
  if (plan.kind === 'pair') {
    const aspects = plan.items.map((it, i) => looks?.[i]?.aspect || (it.width && it.height ? it.width / it.height : 1));
    const stacked = width < height;
    const limits = looks?.some((l) => l?.faces.length)
      ? aspects.map((a, i) => cellLimits(a, looks[i]?.faces || [], stacked, stacked ? width : height))
      : null;
    const rects = pairCells(width, height, cfg.layout.gap, aspects, limits);
    return rects.map((rect) => ({ rect, fit: 'cover' }));
  }
  if (plan.kind === 'artwork') return [{ rect: artworkLayout(cfg, !!captionOf(cfg, plan)).rect, fit: 'contain' }];
  if (plan.kind === 'fit') {
    const m = cfg.layout.margin;
    return [{ rect: { x: m, y: m, w: width - 2 * m, h: height - 2 * m }, fit: 'contain' }];
  }
  return [{ rect: { x: 0, y: 0, w: width, h: height }, fit: 'cover' }];
}

// The upright photo's shape and the faces in it that matter.
async function lookAt(input) {
  const meta = await sharp(input, { failOn: 'none' }).metadata();
  const turned = meta.orientation >= 5;
  const width = meta.autoOrient?.width ?? (turned ? meta.height : meta.width);
  const height = meta.autoOrient?.height ?? (turned ? meta.width : meta.height);
  const found = await detectFaces(input);
  return { width, height, aspect: width / height, found: found.length, faces: subjects(found, width / height) };
}

// Where to cut a photo for a cell it should fill, given its faces and where the attention crop
// (`offset`, in pixels of the photo scaled to cover the cell) put it. Null: the attention crop
// is fine. Otherwise the piece to cut (in the upright photo's pixels) and the size to draw it
// at, which is smaller than the cell when the faces need more than the cell's shape has.
export function faceCrop(look, w, h, offset, mode) {
  const scale = Math.max(w / look.width, h / look.height);
  const rw = look.width * scale;
  const rh = look.height * scale;
  const axis = rw - w > rh - h ? 'x' : 'y';
  const full = axis === 'x' ? rw : rh;
  const len = (axis === 'x' ? w : h) / full;
  if (len > 0.999) return null;
  const pref = offset[axis] / full;
  const win = placeWindow({ len, pref, faces: look.faces, axis, mode });
  if (win.len === len && Math.abs(win.start - pref) * full < 1) return null;
  const side = axis === 'x' ? look.width : look.height;
  const size = Math.min(side, Math.max(1, Math.round(win.len * side)));
  const from = Math.max(0, Math.min(side - size, Math.round(win.start * side)));
  const cut = axis === 'x'
    ? { left: from, top: 0, width: size, height: look.height }
    : { left: 0, top: from, width: look.width, height: size };
  const fit = win.len === len ? null : Math.min(w / cut.width, h / cut.height);
  return {
    cut,
    width: fit ? Math.min(w, Math.round(cut.width * fit)) : w,
    height: fit ? Math.min(h, Math.round(cut.height * fit)) : h,
    filled: !fit,
    moved: Math.round((win.start - pref) * full),
  };
}

async function prepareCell(input, cell, cfg, look) {
  const imageCfg = cfg.image;
  const { w, h } = cell.rect;
  const upright = () => sharp(input, { failOn: 'none' })
    .rotate() // honour EXIF orientation
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb');
  const finish = (img) => {
    if (imageCfg.sharpen > 0) img = img.sharpen({ sigma: imageCfg.sharpen });
    return img.removeAlpha().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  };
  let { data, info } = await finish(cell.fit === 'cover'
    ? upright().resize(w, h, { fit: 'cover', position: sharp.strategy.attention, kernel: 'lanczos3' })
    : upright().resize(w, h, { fit: 'inside', kernel: 'lanczos3' }));
  let note = null;
  if (cell.fit === 'cover' && look?.faces.length) {
    const offset = { x: -(info.cropOffsetLeft || 0), y: -(info.cropOffsetTop || 0) };
    const crop = faceCrop(look, w, h, offset, cfg.layout.faces ?? 'keep');
    if (crop) {
      ({ data, info } = await finish(upright().extract(crop.cut).resize(crop.width, crop.height, { fit: 'fill', kernel: 'lanczos3' })));
      note = crop.filled ? `crop moved ${Math.abs(crop.moved)} px to keep them in` : 'cropped less, with a white band, to keep them all in';
    }
  }
  if (look?.found) log.info(`${look.found} face${look.found > 1 ? 's' : ''} in the photo${note ? `: ${note}` : ''}`);
  if (info.channels !== 3) throw new Error(`Unexpected channel count ${info.channels}`);
  const toned = toneAdjust(data, info.width, info.height, {
    saturation: imageCfg.saturation,
    contrast: imageCfg.contrast,
    autoLevels: imageCfg.autoLevels,
    gamma: imageCfg.gamma ?? 1,
  });
  return { data: toned, width: info.width, height: info.height };
}

// Compose the photos onto a paper-white canvas (sRGB, 3 channels).
export async function composeCanvas(cfg, plan, inputs) {
  const { width, height } = cfg.panel;
  const canvas = Buffer.alloc(width * height * 3, 255);
  // Look for faces first: in a pair they also decide how the two photos share the frame.
  const looks = [];
  if ((cfg.layout.faces ?? 'keep') !== 'off' && plan.kind !== 'fit' && plan.kind !== 'artwork') {
    for (const input of inputs) looks.push(await lookAt(input));
  }
  const cells = planCells(cfg, plan, looks.length ? looks : null);
  const placed = [];
  for (let c = 0; c < cells.length; c++) {
    const cell = cells[c];
    const img = await prepareCell(inputs[c], cell, cfg, looks[c]);
    const ox = cell.rect.x + Math.floor((cell.rect.w - img.width) / 2);
    const oy = cell.rect.y + Math.floor((cell.rect.h - img.height) / 2);
    placed.push({ x: ox, y: oy, w: img.width, h: img.height });
    for (let y = 0; y < img.height; y++) {
      const cy = oy + y;
      if (cy < 0 || cy >= height) continue;
      const src = y * img.width * 3;
      const dst = (cy * width + ox) * 3;
      img.data.copy(canvas, dst, src, src + img.width * 3);
    }
  }
  const label = captionOf(cfg, plan);
  if (label) await drawCaption(canvas, cfg, placed[0], label);
  return canvas;
}

async function encodePng(rgb, width, height, rotate = 0) {
  let img = sharp(rgb, { raw: { width, height, channels: 3 } });
  if (rotate) img = img.rotate(rotate);
  return img.png({ compressionLevel: 9, effort: 4 }).toBuffer();
}

// Full pipeline for a composed canvas -> files for the display and the web UI.
export async function renderCanvas(cfg, model, canvas) {
  const { width, height, rotate } = cfg.panel;
  const t0 = Date.now();
  if (cfg.image.dither === 'device') {
    // Let the display do its own colour processing: send the toned photo as-is.
    const devicePng = await encodePng(canvas, width, height, rotate);
    const previewPng = rotate ? await encodePng(canvas, width, height, 0) : devicePng;
    const previewJpg = await sharp(canvas, { raw: { width, height, channels: 3 } })
      .resize(Math.round(width / 2), Math.round(height / 2)).jpeg({ quality: 85 }).toBuffer();
    return { devicePng, previewPng, previewJpg, ms: Date.now() - t0, inkShare: null };
  }
  const indices = dither(canvas, width, height, model, {
    method: cfg.image.method,
    kernel: cfg.image.kernel,
  });
  const deviceColors = model.inks.map((k) => (cfg.image.outputColors === 'measured' ? k.measured : k.device));
  const previewColors = model.inks.map((k) => k.preview);
  const deviceRgb = indicesToRgb(indices, deviceColors);
  const previewRgb = indicesToRgb(indices, previewColors);
  const [devicePng, previewPng, previewJpg] = await Promise.all([
    encodePng(deviceRgb, width, height, rotate),
    encodePng(previewRgb, width, height, 0),
    // Half-size preview: averaging the dots approximates how it looks from across the room.
    sharp(previewRgb, { raw: { width, height, channels: 3 } })
      .resize(Math.round(width / 2), Math.round(height / 2), { kernel: 'cubic' })
      .jpeg({ quality: 88 }).toBuffer(),
  ]);
  const counts = new Array(model.inks.length).fill(0);
  for (let i = 0; i < indices.length; i++) counts[indices[i]]++;
  const inkShare = Object.fromEntries(model.inks.map((k, i) => [k.name, +(counts[i] / indices.length).toFixed(3)]));
  return { devicePng, previewPng, previewJpg, ms: Date.now() - t0, inkShare };
}
