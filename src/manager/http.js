import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fail } from './store.js';
import { downloadArt } from '../sources/artCatalogue.js';

const reads = new Set([
  'getOverview',
  'getFrame',
  'listPending',
  'listGroups',
  'getDeck',
  'getTimeline',
  'listPictures',
  'getPicture',
  'listAlbums',
  'listInbox',
  'listDiscarded',
  'listEvents',
  'estimateEvent',
  'planShow',
  'getImmich',
  'searchImmich',
  'searchArt',
  'getSettings',
  'listKeys',
  'listHistory',
]);
const writes = new Set([
  'updateFrame',
  'frameAction',
  'addFrame',
  'testConnection',
  'removeFrame',
  'withdrawPending',
  'resolvePending',
  'saveGroup',
  'moveDeckCard',
  'moveTimelineItem',
  'updatePicture',
  'deletePicture',
  'createCombo',
  'show',
  'acceptInbox',
  'discardInbox',
  'restoreInbox',
  'saveEvent',
  'endEvent',
  'deleteEvent',
  'importFromImmich',
  'subscribeAlbum',
  'importArt',
  'updateSettings',
  'saveKey',
  'removeKey',
  'testKey',
]);
const json = (res, status, value) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value ?? null));
};
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1024 * 1024) throw fail('Anfrage zu groß', 413);
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '[]');
  } catch {
    throw fail('Ungültiges JSON');
  }
}
function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  try {
    return !origin || new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
function sendFile(res, file, type) {
  if (!file || !fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': fs.statSync(file).size,
    'Cache-Control': type.startsWith('text/html')
      ? 'no-store'
      : 'private, max-age=60',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}

export function managerHttp(
  manager,
  { dist = fileURLToPath(new URL('../../web/dist/', import.meta.url)) } = {},
) {
  const csrf = crypto.randomBytes(32).toString('hex');
  return async (req, res, url) => {
    const p = url.pathname;
    if (p === '/api/v1/bootstrap' && req.method === 'GET') {
      json(res, 200, { csrf });
      return true;
    }
    if (p.startsWith('/api/v1/')) {
      try {
        if (req.method !== 'GET' && !sameOrigin(req))
          throw fail('Anfrage von fremder Seite abgelehnt', 403);
        if (req.method !== 'GET' && req.headers['x-csrf-token'] !== csrf) {
          json(res, 403, { error: 'Sitzung erneuern', code: 'csrf' });
          return true;
        }
        if (p === '/api/v1/uploads' && req.method === 'POST') {
          json(res, 200, await manager.upload(req));
          return true;
        }
        const media = /^\/api\/v1\/media\/([^/]+)\/(thumb|image)$/.exec(p);
        if (media && req.method === 'GET') {
          sendFile(
            res,
            manager.mediaPath(decodeURIComponent(media[1]), media[2]),
            media[2] === 'thumb' ? 'image/jpeg' : 'image/png',
          );
          return true;
        }
        const thumb = /^\/api\/v1\/(immich|art)\/thumbnail\/([^/]+)$/.exec(p);
        if (thumb && req.method === 'GET') {
          const assetId = decodeURIComponent(thumb[2]);
          if (thumb[1] === 'immich') {
            if (!/^[\w-]{1,100}$/.test(assetId))
              throw fail('Ungültige Bildkennung');
            const data = await manager
              .immichClient()
              .request(
                `/assets/${encodeURIComponent(assetId)}/thumbnail?size=thumbnail&edited=true`,
                null,
                true,
              );
            // Serve only raster image types from Immich, never its HTML or SVG on our origin.
            const type = String(data.type).split(';')[0].trim().toLowerCase();
            if (!['image/jpeg', 'image/webp', 'image/png'].includes(type))
              throw fail('Ungültiges Vorschaubild', 502);
            res
              .writeHead(200, {
                'Content-Type': type,
                'Cache-Control': 'private, max-age=300',
                'X-Content-Type-Options': 'nosniff',
                'Content-Security-Policy': "sandbox; default-src 'none'",
              })
              .end(data.bytes);
          } else {
            const art = manager.artCache.get(assetId);
            if (!art) throw fail('Kunstwerk neu suchen', 404);
            const bytes = await downloadArt(art.thumb, { maxBytes: 5e6 });
            res
              .writeHead(200, {
                'Content-Type': 'image/jpeg',
                'Cache-Control': 'private, max-age=300',
                'X-Content-Type-Options': 'nosniff',
              })
              .end(bytes);
          }
          return true;
        }
        const call = /^\/api\/v1\/call\/([A-Za-z]+)$/.exec(p);
        if (!call) throw fail('Endpunkt nicht gefunden', 404);
        const method = call[1];
        if (
          req.method === 'GET'
            ? !reads.has(method)
            : req.method !== 'POST' || !writes.has(method)
        )
          throw fail('Methode nicht erlaubt', 405);
        let args;
        if (req.method === 'GET') {
          try {
            args = JSON.parse(url.searchParams.get('args') || '[]');
          } catch {
            throw fail('Ungültige Argumente');
          }
        } else args = await body(req);
        if (!Array.isArray(args) || args.length > 6)
          throw fail('Argumentliste erwartet');
        const result = await (method === 'getTimeline'
          ? manager.timeline(manager.frame(args[0]))
          : manager[method](...args));
        json(res, 200, result);
      } catch (err) {
        json(res, err.status || 500, {
          error: err.status
            ? err.message
            : 'Anfrage fehlgeschlagen. Gespeicherte Bilder und Änderungen bleiben erhalten.',
        });
      }
      return true;
    }
    if (
      req.method !== 'GET' ||
      p === '/alt' ||
      p.startsWith('/api/') ||
      p.startsWith('/img/') ||
      p.startsWith('/emdx/')
    )
      return false;
    const requested = path.resolve(dist, `.${p}`);
    if (
      !requested.startsWith(`${path.resolve(dist)}${path.sep}`) &&
      requested !== path.resolve(dist)
    )
      return false;
    const file =
      fs.existsSync(requested) && fs.statSync(requested).isFile()
        ? requested
        : path.join(dist, 'index.html');
    if (p.startsWith('/assets/') && file !== requested) {
      res.writeHead(404).end();
      return true;
    }
    if (!fs.existsSync(file)) {
      res
        .writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end(
          'Web-Oberfläche noch nicht gebaut. npm --prefix web run build. Bisherige Seite: /alt',
        );
      return true;
    }
    const type =
      {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.woff2': 'font/woff2',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
      }[path.extname(file)] || 'application/octet-stream';
    sendFile(res, file, type);
    return true;
  };
}
