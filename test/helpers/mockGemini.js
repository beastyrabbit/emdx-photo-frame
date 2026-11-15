// A stand-in for Google's image model (the Gemini API's Interactions endpoint): answers a prompt
// with a picture of the shape asked for. `next` sets what the following request gets instead:
// { status, body } for an HTTP error, { answer } for another 200 answer.
import http from 'node:http';
import sharp from 'sharp';

const SIZES = { '1K': 768, '2K': 1536, '4K': 3072 }; // (the short side at 9:16)

export async function startMockGemini({ key = 'test-key', delayMs = 0 } = {}) {
  const requests = [];
  const state = { next: null, delayMs };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; }).on('end', async () => {
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ method: req.method, path: req.url, headers: req.headers, body });
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      if (req.headers['x-goog-api-key'] !== key) return send(401, { error: { code: 'authentication', message: 'The API key is missing, invalid, or expired.' } });
      const next = state.next;
      state.next = null;
      if (next?.status) return send(next.status, next.body);
      if (next?.answer) return send(200, next.answer);
      const [w, h] = body.response_format.aspect_ratio.split(':').map(Number);
      const short = SIZES[body.response_format.image_size] / 8; // (small, to keep the tests quick)
      const width = Math.round(w < h ? short : (short * w) / h);
      const height = Math.round(w < h ? (short * h) / w : short);
      const n = requests.length;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <rect width="100%" height="100%" fill="hsl(${(n * 97) % 360},60%,45%)"/>
        <circle cx="${width / 2}" cy="${height / 3}" r="${width / 4}" fill="hsl(${(n * 97 + 180) % 360},80%,60%)"/></svg>`;
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      return send(200, {
        id: `v1_${n}`, object: 'interaction', status: 'completed', model: body.model,
        steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Here is your picture.' }, { type: 'image', mime_type: 'image/png', data: png.toString('base64') }] }],
      });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    key, requests, state,
    close: () => new Promise((r) => server.close(r)),
  };
}
