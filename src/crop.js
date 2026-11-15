// Where to crop a photo so the people in it stay in the picture. All in fractions of the
// upright photo: faces are { x, y, w, h } boxes (see faces.js), a crop window is a start and a
// length along the one side that gets cropped.

// Room around a face, in face widths (sideways) and heights (above: hair; below: chin, neck).
// TIGHT is what must stay in the picture; ROOMY is what a crop gives when there is space for it.
const TIGHT = { side: 0.3, above: 0.5, below: 0.3 };
const ROOMY = { side: 1.0, above: 1.0, below: 1.5 };
// Faces much smaller than the largest one are passers-by in the background: they don't steer
// the crop.
const BYSTANDER = 0.35;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// The faces that matter. `aspect`: the photo's width / height.
export function subjects(faces, aspect = 1) {
  const size = (f) => Math.sqrt(f.w * aspect * f.h);
  const largest = Math.max(0, ...faces.map(size));
  return faces.filter((f) => size(f) >= largest * BYSTANDER);
}

// A face with its room, along one side of the photo: [from, to].
function reach(face, axis, pad) {
  return axis === 'x'
    ? [clamp(face.x - pad.side * face.w, 0, 1), clamp(face.x + face.w + pad.side * face.w, 0, 1)]
    : [clamp(face.y - pad.above * face.h, 0, 1), clamp(face.y + face.h + pad.below * face.h, 0, 1)];
}

// From the first face to the last along one side: { from, to }, or null without faces.
export function faceSpan(faces, axis, pad = TIGHT) {
  if (!faces.length) return null;
  const all = faces.map((f) => reach(f, axis, pad));
  return { from: Math.min(...all.map((r) => r[0])), to: Math.max(...all.map((r) => r[1])) };
}

// Place a crop window of length `len` along `axis`. `pref`: where it would start without faces
// (the attention crop). Returns { start, len }; `len` comes back longer than asked when the
// faces need more than the window has and `mode` is 'keep' (the photo then no longer fills its
// cell). With 'prefer' the length stays, and the window takes the faces that count most.
export function placeWindow({ len, pref, faces, axis, mode = 'keep' }) {
  const max = 1 - len;
  const asIs = { start: clamp(pref, 0, max), len };
  if (!faces.length || len >= 1) return asIs;
  const roomy = faceSpan(faces, axis, ROOMY);
  const tight = faceSpan(faces, axis, TIGHT);
  // Room to spare: stay as close to the attention crop as the faces allow.
  if (roomy.to - roomy.from <= len) return { start: clamp(clamp(pref, roomy.to - len, roomy.from), 0, max), len };
  // They fit, without the room: the faces in the middle.
  if (tight.to - tight.from <= len) {
    return { start: clamp((tight.from + tight.to - len) / 2, Math.max(0, tight.to - len), Math.min(max, tight.from)), len };
  }
  if (mode === 'keep') return { start: tight.from, len: tight.to - tight.from };
  // Not everyone fits: the window with the most face in it, whole faces only, and of those
  // the one nearest the attention crop.
  const reaches = faces.map((f) => ({ r: reach(f, axis, TIGHT), weight: f.w * f.h }));
  const starts = [pref, ...reaches.flatMap(({ r }) => [r[0], r[1] - len])].map((s) => clamp(s, 0, max));
  let best = asIs.start, bestScore = -1;
  for (const s of starts) {
    let score = 0;
    for (const { r, weight } of reaches) if (r[0] >= s - 1e-9 && r[1] <= s + len + 1e-9) score += weight;
    if (score > bestScore + 1e-12 || (Math.abs(score - bestScore) <= 1e-12 && Math.abs(s - pref) < Math.abs(best - pref))) {
      best = s; bestScore = score;
    }
  }
  return { start: best, len };
}

// For a pair: how long this photo's cell may be along the side the two photos share out,
// before its faces stop fitting. `aspect`: the photo's width / height; `cross`: the cell's
// other side in pixels (the frame's width when stacked, its height when side by side).
export function cellLimits(aspect, faces, stacked, cross) {
  const x = faceSpan(faces, 'x');
  if (!x) return { min: 0, max: Infinity };
  const y = faceSpan(faces, 'y');
  const fx = Math.max(x.to - x.from, 1e-3);
  const fy = Math.max(y.to - y.from, 1e-3);
  return stacked
    ? { min: (fy * cross) / aspect, max: cross / (aspect * fx) }
    : { min: fx * aspect * cross, max: (aspect * cross) / fy };
}
