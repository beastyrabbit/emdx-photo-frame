// A stand-in for the paperlesspaper art catalogue (art.paperlesspaper.de): the search and detail
// endpoints, and the pictures. `works`: what it lists ({ id, title, artist, date, w, h, rating,
// pd, colour }); a picture is a plain rectangle of the work's shape and colour. `state.down`:
// every request fails (503); `state.gone`: ids whose picture is gone (404).
import http from 'node:http';
import sharp from 'sharp';

export const WORKS = [
  { id: 'wikimedia:101', title: 'Katsushika Hokusai - The Great Wave - Google Art Project', artist: 'Katsushika Hokusai (1760 - 1849)', date: 'circa 1831 date QS:P571,+1831-00-00T00:00:00Z/9,P1480,Q5727020', w: 600, h: 800, rating: 5, colour: '#c0392b' },
  { id: 'wikimedia:102', title: 'Claude Monet - Poppies', artist: 'Claude Monet', date: '1873', w: 600, h: 840, rating: 5, colour: '#2e86c1' },
  { id: 'met:103', title: 'Irises', artist: 'Vincent van Gogh', date: '1890', w: 560, h: 800, rating: 5, colour: '#27ae60' },
  { id: 'wikimedia:104', title: 'Wheat Field', artist: 'Vincent van Gogh', date: '1888', w: 900, h: 500, rating: 5, colour: '#d4ac0d' }, // wide
  { id: 'wikimedia:105', title: 'A stamp', artist: 'Unknown author', date: '2021-02-03 15:10:58', w: 100, h: 140, rating: 5, colour: '#8e44ad' }, // few pixels
  { id: 'wikimedia:106', title: 'Hokusai-fuji7', artist: 'Katsushika Hokusai', date: '1830', w: 600, h: 800, rating: 3, colour: '#16a085' }, // not a top pick
  { id: 'wikimedia:107', title: 'A modern poster', artist: 'Somebody', date: '1999', w: 600, h: 800, rating: 5, pd: false, colour: '#555555' }, // not in the public domain
  { id: 'svgrepo:108', title: 'Bell SVG Vector', artist: 'Icons', w: 800, h: 800, rating: 5, colour: '#000000' }, // an icon
];

export async function startMockArt({ works = WORKS } = {}) {
  const requests = [];
  const state = { down: false, gone: new Set() };
  let base = '';
  const entry = (w) => {
    const [source, sourceId] = w.id.split(':');
    const sized = Object.fromEntries([512, 1024, 3000].map((k) => [k, `${base}/images/${source}/${sourceId}/w${k}.jpg`]));
    return {
      id: w.id, source, sourceId, title: w.title, artist: w.artist, date: w.date,
      isPublicDomain: w.pd !== false, license: w.pd === false ? 'CC BY' : 'Public domain',
      sourceUrl: `https://commons.wikimedia.org/wiki/File:${sourceId}`, selected: false, highlighted: false, rating: w.rating,
      image: { width: w.w, height: w.h, originalUrl: `${base}/original/${sourceId}`, url: sized[512], resizedUrls: sized, localResizedPaths: sized },
    };
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers });
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (state.down) return send(503, { error: 'down' });
    const picture = /^\/images\/(\w+)\/(\w+)\/w(\d+)\.jpg$/.exec(url.pathname);
    if (picture) {
      const w = works.find((x) => x.id === `${picture[1]}:${picture[2]}`);
      if (!w || state.gone.has(w.id)) { res.writeHead(404, { 'Content-Type': 'application/xml' }); res.end('<Error/>'); return; }
      const k = Math.min(1, Number(picture[3]) / Math.max(w.w, w.h));
      const jpg = await sharp({ create: { width: Math.round(w.w * k), height: Math.round(w.h * k), channels: 3, background: w.colour } }).jpeg({ quality: 90 }).toBuffer();
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': jpg.length });
      res.end(jpg);
      return;
    }
    if (url.pathname === '/api/artworks') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const rating = url.searchParams.get('rating');
      let hits = works.filter((w) => (url.searchParams.get('publicDomain') !== 'true' || w.pd !== false)
        && (!rating || String(w.rating) === rating)
        && (!q || `${w.title} ${w.artist}`.toLowerCase().includes(q)));
      const total = hits.length;
      const offset = Number(url.searchParams.get('offset') || 0);
      hits = hits.slice(offset, offset + Number(url.searchParams.get('limit') || 100));
      return send(200, { items: hits.map(entry), total, limit: hits.length, offset, meta: {} });
    }
    const one = /^\/api\/artworks\/(.+)$/.exec(url.pathname);
    if (one) {
      const w = works.find((x) => x.id === decodeURIComponent(one[1]));
      return w ? send(200, { item: entry(w) }) : send(404, { error: 'Not found' });
    }
    return send(404, { error: 'Not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return { url: base, requests, state, works, close: () => new Promise((r) => { server.close(r); server.closeAllConnections?.(); }) };
}
