// Pictures from a text prompt, made by Google's image model (the Gemini API's "Nano Banana"
// family) with an API key from Google AI Studio. One request, one picture: nothing is retried,
// as every request is paid for.
//
// The API (the Interactions API, as documented in November 2026): POST <base>/v1beta/interactions
// with { model, input, response_format: { type: 'image', aspect_ratio, image_size } }; the answer
// is { status, steps: [{ type: 'model_output', content: [{ type: 'image', data: <base64> }] }] }.
// `store: false` asks Google not to keep the prompt and the picture (by default it does, for
// weeks).
export const GEMINI_URL = 'https://generativelanguage.googleapis.com';
const API_REVISION = '2026-05-20';

// The shapes the model can draw, as width:height.
export const ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

// The shape closest to the frame's.
export function nearestAspect(width, height) {
  const want = Math.log(width / height);
  let best = ASPECT_RATIOS[0];
  let bestDiff = Infinity;
  for (const r of ASPECT_RATIOS) {
    const [w, h] = r.split(':').map(Number);
    const diff = Math.abs(Math.log(w / h) - want);
    if (diff < bestDiff) { bestDiff = diff; best = r; }
  }
  return best;
}

// Why Google sent no picture, in plain words.
const BLOCKED = {
  image_safety: 'its safety filter stopped the picture',
  safety: 'its safety filter stopped the prompt',
  image_prohibited_content: 'the prompt asks for something it does not draw',
  image_recitation: 'the picture would have copied an existing work too closely',
  recitation: 'the picture would have copied an existing work too closely',
  no_image: 'the model could not make a picture of this',
};

// The first image in the answer: where the documentation puts it, or wherever one turns up.
function findImage(body) {
  const blocks = [];
  for (const step of body?.steps || []) {
    if (step?.type === 'model_output') blocks.push(...(step.content || []));
  }
  const direct = blocks.findLast?.((b) => b?.type === 'image' && typeof b.data === 'string' && b.data.length > 100);
  if (direct) return direct.data;
  let found = null;
  const walk = (node, depth) => {
    if (found || !node || typeof node !== 'object' || depth > 8) return;
    if (!Array.isArray(node) && typeof node.data === 'string' && node.data.length > 100
      && (node.type === 'image' || /^image\//.test(node.mime_type || node.mimeType || ''))) { found = node.data; return; }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(body, 0);
  return found;
}

function findText(body) {
  const texts = [];
  for (const step of body?.steps || []) {
    for (const b of step?.content || []) if (b?.type === 'text' && b.text) texts.push(String(b.text).trim());
  }
  return texts.join(' ').replace(/\s+/g, ' ').slice(0, 300);
}

// Returns { image: Buffer, model }. Errors say what went wrong in words for the page; `status`
// is Google's HTTP status when there was one, and `spent` says whether the request may have been
// charged (it reached the model).
export async function generateImage({ apiKey, model, prompt, aspectRatio, size = '2K', baseUrl = GEMINI_URL, timeoutMs = 180000 }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  let res;
  let text;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1beta/interactions`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json', 'Api-Revision': API_REVISION },
      body: JSON.stringify({
        model,
        input: [{ type: 'text', text: prompt }],
        response_format: { type: 'image', aspect_ratio: aspectRatio, image_size: size },
        store: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    throw Object.assign(new Error(timedOut
      ? `Google did not answer within ${Math.round(timeoutMs / 1000)} s`
      : `Could not reach Google (${err.cause?.code || err.cause?.message || err.message})`), { spent: timedOut });
  }
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON: an error page */ }
  if (!res.ok) {
    const said = String(body?.error?.message || text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    let message;
    if (res.status === 401) message = 'Google refused the API key: check GEMINI_API_KEY';
    else if (res.status === 429) message = `Google says the key's quota is used up for now${said ? ` (${said})` : ''}`;
    else if (res.status === 404) message = `Google does not know the model "${model}" (GENERATE_MODEL)${said ? `: ${said}` : ''}`;
    else if (res.status >= 500) message = `Google's image service is having trouble (${res.status}); try again in a while`;
    else message = `Google refused the request (${res.status})${said ? `: ${said}` : ''}`;
    throw Object.assign(new Error(message), { status: res.status, spent: false });
  }
  const data = findImage(body);
  if (!data) {
    const codes = [...(body?.errors || []), body?.error].filter(Boolean).map((e) => e.code).filter(Boolean);
    const why = codes.map((c) => BLOCKED[c]).find(Boolean) || findText(body) || codes[0] || (body?.status && body.status !== 'completed' ? `status "${body.status}"` : '');
    throw Object.assign(new Error(`Google sent no picture${why ? `: ${why}` : ''}`), { spent: true });
  }
  return { image: Buffer.from(data, 'base64'), model: body.model || model };
}
