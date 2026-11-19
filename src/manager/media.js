import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import Busboy from '@fastify/busboy';
import sharp from 'sharp';
import { composeCanvas, renderCanvas } from '../render.js';
import { fail, id } from './store.js';

sharp.cache({ memory: 32, files: 16, items: 64 });
sharp.concurrency(1);
const exec = promisify(execFile);
export const MAX_FILE = 25 * 1024 * 1024;
export const MIN_FREE = 256 * 1024 * 1024;
const MAX_PIXELS = 80e6;
export const autoCrop = () => ({ x: 50, y: 50, zoom: 1, auto: true });
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');

export function validateCrop(c) {
  if (
    !c ||
    ![c.x, c.y, c.zoom].every(Number.isFinite) ||
    c.zoom < 1 ||
    c.zoom > 3 ||
    Math.abs(c.x) > 1000 ||
    Math.abs(c.y) > 1000 ||
    typeof c.auto !== 'boolean'
  )
    throw fail('Ungültiger Zuschnitt');
  if (c.rect) {
    const { x, y, width, height } = c.rect;
    if (
      ![x, y, width, height].every(Number.isFinite) ||
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x + width > 1.000001 ||
      y + height > 1.000001
    )
      throw fail('Ungültiges Zuschnittfenster');
  }
  return structuredClone(c);
}

/** Decode actual pixels, not just metadata. HEVC uses Debian's libde265-backed converter. */
export async function normalize(file, maxSide = 5120) {
  if (file instanceof URL) file = fileURLToPath(file);
  if (fs.statSync(file).size > MAX_FILE)
    throw fail('Bild ist größer als 25 MiB', 413);
  const input = fs.readFileSync(file);
  const head = input.subarray(0, 64);
  const heic =
    head.toString('ascii', 4, 8) === 'ftyp' &&
    /heic|heix|hevc|hevx|mif1|msf1/.test(head.toString('ascii', 8));
  const raster =
    (head[0] === 0xff && head[1] === 0xd8) ||
    head
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (head.toString('ascii', 0, 4) === 'RIFF' &&
      head.toString('ascii', 8, 12) === 'WEBP') ||
    /^GIF8[79]a/.test(head.toString('ascii')) ||
    head.subarray(0, 4).equals(Buffer.from([73, 73, 42, 0])) ||
    head.subarray(0, 4).equals(Buffer.from([77, 77, 0, 42])) ||
    (head.toString('ascii', 4, 8) === 'ftyp' &&
      /avif|avis/.test(head.toString('ascii', 8)));
  if (!heic && !raster)
    throw fail('Nur Rasterbilder sind erlaubt, kein SVG oder Video.', 415);
  let tmp;
  try {
    const meta = await sharp(input, {
      limitInputPixels: MAX_PIXELS,
    }).metadata();
    if (
      !meta.width ||
      !meta.height ||
      meta.width > 10000 ||
      meta.height > 10000 ||
      meta.width * meta.height * (meta.pages || 1) > MAX_PIXELS ||
      (meta.pages || 1) > 4
    )
      throw fail('Bild hat zu viele Pixel oder Einzelbilder', 413);
    let source = input;
    if (heic) {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emdx-heic-'));
      const output = path.join(tmp, 'image.png');
      try {
        await exec(
          'prlimit',
          [
            // Address space, not memory in use: 384 MiB rejected 24 and 48 MP phone HEICs.
            '--as=805306368',
            '--fsize=335544320',
            '--cpu=25',
            '--',
            'heif-convert',
            file,
            output,
          ],
          {
            timeout: 30000,
            maxBuffer: 64 * 1024,
            env: { ...process.env, OMP_NUM_THREADS: '1' },
          },
        );
      } catch {
        throw fail('HEIC konnte nicht dekodiert werden.', 415);
      }
      // A multi-image HEIF can produce image-1.png etc.; only accept the primary still.
      const chosen = fs.existsSync(output)
        ? output
        : path.join(tmp, 'image-1.png');
      if (!fs.existsSync(chosen) || fs.statSync(chosen).size > 320e6)
        throw fail('Ungültiges HEIC', 415);
      source = chosen;
    }
    const { data, info } = await sharp(source, {
      limitInputPixels: MAX_PIXELS,
      page: 0,
    })
      .autoOrient()
      .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const image = await sharp(data, { raw: info })
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
    return {
      image,
      width: info.width,
      height: info.height,
      sha: hash(input),
      pixelHash: hash(data),
    };
  } catch (err) {
    // A decoder error (corrupt or truncated file) means the picture can never be taken;
    // system errors (with a code, such as ENOSPC) stay as they are so the caller retries.
    if (err.status || err.code) throw err;
    throw fail('Bild konnte nicht dekodiert werden.', 415);
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export class Media {
  // Imports and complete render jobs share one decoder budget across all frames.
  work(job) {
    const result = this.workChain.then(job);
    this.workChain = result.catch(() => {});
    return result;
  }

  requireImportSpace() {
    const space = fs.statfsSync(this.root);
    if (space.bavail * space.bsize < MIN_FREE)
      throw fail('Zu wenig Speicherplatz. Import pausiert; mindestens 256 MiB freigeben.', 507);
  }

  async ingest(
    file,
    {
      title = 'Bild',
      source = 'upload',
      albums = [],
      sourceNote = 'Hochgeladen',
      ref = null,
      accepted = false,
      assetId,
      artwork = null,
    } = {},
  ) {
    return this.work(async () => {
      this.requireImportSpace();
      const n = await normalize(file, 2 * Math.max(this.base.panel.width, this.base.panel.height));
      const twin = this.s.pictures.find(
        (p) => p.pixelHash === n.pixelHash || p.sha === n.sha,
      );
      const pictureId = assetId || id();
      const dir = path.join(
        this.root,
        'media',
        hash(pictureId),
      );
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(dir, 'image.jpg'), n.image, { mode: 0o600 });
      await sharp(n.image)
        .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toFile(path.join(dir, 'thumb.jpg'));
      const orientation = n.height > n.width ? 'hoch' : 'quer';
      const hints = [
        ...(Math.min(n.width, n.height) < 1000 ? ['zu-klein'] : []),
        ...(twin ? ['doppelt'] : []),
      ];
      const p = {
        id: pictureId,
        title: String(title).slice(0, 200),
        width: n.width,
        height: n.height,
        orientation,
        detected: orientation,
        alsoOther: false,
        crops: { hoch: autoCrop(), quer: autoCrop() },
        source,
        sourceNote,
        albums,
        addedAt: Date.now(),
        takenAt: Date.now(),
        receivedAt: Date.now(),
        paused: false,
        combo: null,
        artwork,
        hints,
        duplicateOf: twin?.id ?? null,
        identity: twin?.identity || twin?.id || pictureId,
        pixelHash: n.pixelHash,
        sha: n.sha,
        file: path.join(dir, 'image.jpg'),
        thumb: path.join(dir, 'thumb.jpg'),
        status:
          accepted || (this.s.settings.autoAccept && !hints.length)
            ? 'accepted'
            : 'inbox',
        ref,
        revision: 1,
      };
      this.s.pictures.push(p);
      this.record({
        kind: 'eingang',
        text: `${p.title}: ${p.status === 'accepted' ? 'in Bibliothek übernommen' : 'im Eingang'}`,
        inbox: 'neu',
        pictureId: p.id,
      });
      this.syncDecks();
      this.save();
      return p;
    });
  }

  async upload(req) {
    this.requireImportSpace();
    const dir = fs.mkdtempSync(path.join(this.root, 'upload-'));
    const files = [];
    const writes = [];
    const albums = [];
    let problem;
    let bytes = 0;
    try {
      await new Promise((resolve, reject) => {
        let parser;
        try {
          parser = new Busboy({
            headers: req.headers,
            limits: {
              fileSize: MAX_FILE,
              files: 10,
              fields: 5,
              fieldSize: 200,
              parts: 15,
            },
          });
        } catch {
          reject(fail('Multipart-Upload erwartet'));
          return;
        }
        const stop = (e) => {
          problem ||= e;
        };
        req.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > 100 * 1024 * 1024) {
            stop(fail('Upload größer als 100 MiB', 413));
            req.unpipe(parser);
            parser.destroy(problem);
            req.resume();
          }
        });
        parser.on('file', (_field, stream, filename) => {
          const item = {
            path: path.join(dir, id()),
            title: path.basename(filename || 'Bild'),
          };
          files.push(item);
          stream.on('limit', () => {
            item.error = 'Bild ist größer als 25 MiB';
          });
          writes.push(
            pipeline(
              stream,
              fs.createWriteStream(item.path, { mode: 0o600 }),
            ).catch(() => {
              item.error = 'Upload unterbrochen';
            }),
          );
        });
        parser.on('field', (key, value) => {
          if (key === 'album' && value.trim()) albums.push(value.trim());
        });
        parser.on('filesLimit', () =>
          stop(fail('Höchstens 10 Bilder pro Upload', 413)),
        );
        parser.on('partsLimit', () => stop(fail('Zu viele Upload-Teile', 413)));
        parser.on('error', reject);
        parser.on('finish', resolve);
        req.once('aborted', () => reject(fail('Upload unterbrochen')));
        req.pipe(parser);
      });
      await Promise.all(writes);
      if (problem) throw problem;
      const results = [];
      for (const f of files) {
        if (f.error) results.push({ name: f.title, error: f.error });
        else {
          try {
            const p = await this.ingest(f.path, { title: f.title, albums });
            results.push({ name: f.title, id: p.id });
          } catch (err) {
            results.push({
              name: f.title,
              error: err.status
                ? err.message
                : 'Bild konnte nicht gelesen werden',
            });
          }
        }
      }
      return { results };
    } finally {
      await Promise.allSettled(writes);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  async renderPicture(p, cfg, target) {
    return this.work(() => this.renderPictureLocked(p, cfg, target));
  }

  async renderPictureLocked(p, cfg, target) {
    const width = cfg.panel.width;
    const height = cfg.panel.height;
    let png;
    if (p.combo) {
      const members = p.combo.memberIds.map((pid) => this.picture(pid));
      const columns = {
        '2-nebeneinander': 2,
        '3-nebeneinander': 3,
        '2-uebereinander': 1,
        '2x2': 2,
      }[p.combo.layout];
      const rows = Math.ceil(members.length / columns);
      const cellW = Math.floor(width / columns);
      const cellH = Math.floor(height / rows);
      const layers = [];
      for (let i = 0; i < members.length; i++)
        layers.push({
          input: await this.cropImage(
            members[i],
            cfg.panel.orientation === 'portrait' ? 'hoch' : 'quer',
            cellW,
            cellH,
          ),
          left: (i % columns) * cellW,
          top: Math.floor(i / columns) * cellH,
        });
      png = await sharp({
        create: { width, height, channels: 3, background: 'white' },
      })
        .composite(layers)
        .png()
        .toBuffer();
    } else {
      const orientation =
        cfg.panel.orientation === 'portrait' ? 'hoch' : 'quer';
      if (p.crops[orientation].auto) {
        const canvas = await composeCanvas(
          cfg,
          { kind: 'cover', items: [{ width: p.width, height: p.height }] },
          [fs.readFileSync(p.file)],
        );
        const result = await renderCanvas(cfg, this.model, canvas);
        fs.writeFileSync(target, result.devicePng);
        return;
      }
      png = await this.cropImage(p, orientation, width, height);
    }
    let image = sharp(png).removeAlpha().toColourspace('srgb');
    if (cfg.panel.rotate) image = image.rotate(cfg.panel.rotate);
    await image.png().toFile(target);
  }

  async cropImage(p, orientation, width, height) {
    const crop = p.crops[orientation];
    let image = sharp(p.file, { limitInputPixels: MAX_PIXELS });
    if (crop.rect && !crop.auto) {
      const r = crop.rect;
      const left = Math.floor(r.x * p.width);
      const top = Math.floor(r.y * p.height);
      image = image.extract({
        left,
        top,
        width: Math.min(
          p.width - left,
          Math.max(1, Math.round(r.width * p.width)),
        ),
        height: Math.min(
          p.height - top,
          Math.max(1, Math.round(r.height * p.height)),
        ),
      });
    } else if (!crop.auto) {
      const ratio = width / height;
      const w = Math.min(p.width, p.height * ratio) / crop.zoom;
      const h = w / ratio;
      image = image.extract({
        left: Math.round(
          Math.max(
            0,
            Math.min(p.width - w, (p.width - w) * (1 - crop.x / 100)),
          ),
        ),
        top: Math.round(
          Math.max(
            0,
            Math.min(p.height - h, (p.height - h) * (1 - crop.y / 100)),
          ),
        ),
        width: Math.max(1, Math.floor(w)),
        height: Math.max(1, Math.floor(h)),
      });
    }
    return image
      .resize(width, height, { fit: 'cover', position: 'attention' })
      .png()
      .toBuffer();
  }

  mediaPath(pictureId, variant) {
    const p = this.picture(pictureId);
    if (p.status === 'deleted') throw fail('Bild nicht gefunden', 404);
    return variant === 'thumb' ? p.thumb : variant === 'image' ? p.file : null;
  }
}
