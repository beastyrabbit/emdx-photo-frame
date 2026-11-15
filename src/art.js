// Pictures made from a text prompt (the page's "Generate" tab): asking Google's image model for
// one, keeping it in a small gallery, showing it on the frame as a one-off, and keeping it in
// the rotation with the album's photos. Methods of FrameApp (see app.js).
//
// State (state.generated):
//   items     the gallery, newest first: [{ id, prompt, style, model, createdAt, width, height,
//             file, keep }]; the files are in <DATA_DIR>/generated/<id>/ (the picture as Google
//             sent it, and previews rendered for this frame)
//   usage     { day, count }: requests sent to Google today (GENERATE_DAILY_MAX)
//   lastError the last request that failed: { at, message, prompt }
//   style     the style used last
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { log } from './log.js';
import { generateImage, nearestAspect } from './sources/gemini.js';

// Styles that suit six inks: bold shapes and flat colour dither better than soft photographs.
export const STYLES = [
  { id: 'none', name: 'No style', text: '' },
  { id: 'linocut', name: 'Linocut', text: 'a hand-printed linocut, with bold carved black lines and two or three flat colours on white paper' },
  { id: 'poster', name: 'Travel poster', text: 'a vintage travel poster, with large flat shapes of strong colour and a simple composition, without lettering' },
  { id: 'woodblock', name: 'Japanese woodblock', text: 'a Japanese woodblock print (ukiyo-e), with fine black outlines, flat planes of colour and deep blues' },
  { id: 'watercolour', name: 'Watercolour', text: 'a loose watercolour painting, with saturated washes and white paper left showing' },
  { id: 'gouache', name: 'Gouache', text: 'a gouache illustration, with opaque matte colours, simple shapes and strong light and shadow' },
  { id: 'ink', name: 'Ink drawing', text: 'a brush-and-ink drawing, with confident black lines on white paper and a single accent colour' },
  { id: 'papercut', name: 'Paper cut-out', text: 'a collage of cut paper, with flat solid colours, crisp edges and a few layered shapes' },
  { id: 'botanical', name: 'Botanical plate', text: 'an antique botanical plate, with precise ink outlines and hand-coloured washes on white paper' },
  { id: 'photo', name: 'Photograph', text: 'a photograph in natural light, with strong contrast and rich colour' },
];

export const MAX_PROMPT = 1500;
const artId = (id) => `gen:${id}`;
const short = (text, n = 80) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
const fail = (status, message) => Object.assign(new Error(message), { status });

// What goes to the model: the prompt, the style, and the frame's shape. (Without the last line
// the model likes to draw a picture hanging on a wall, or a white margin around it.)
export function buildPrompt(panel, prompt, style) {
  const shape = panel.width < panel.height ? 'tall, portrait' : panel.width > panel.height ? 'wide, landscape' : 'square';
  return [
    `${prompt.trim().replace(/[\s.]+$/, '')}.`,
    style?.text ? `Style: ${style.text}.` : '',
    `A ${shape} picture that fills the whole image from edge to edge, with no border, frame or mat around it.`,
  ].filter(Boolean).join(' ');
}

export class Art {
  get art() {
    const g = (this.state.generated ||= {});
    g.items ||= [];
    return g;
  }

  artDir(id, ...parts) {
    return this.store.path('generated', id, ...parts);
  }

  findArt(id) {
    const item = this.art.items.find((it) => it.id === id);
    if (!item) throw fail(404, 'That picture is no longer in the gallery');
    return item;
  }

  // Why pictures can't be made (a line for the page), or null.
  artOff() {
    if (!this.cfg.generate?.apiKey) return 'To make pictures from a prompt, set GEMINI_API_KEY in .env (an API key from Google AI Studio) and UI_PASSWORD, then restart.';
    if (!this.cfg.server?.uiPassword) return 'Set UI_PASSWORD in .env as well, then restart: every picture costs a little, so the page asks for a password before it makes any.';
    return null;
  }

  // Requests sent to Google today (the day in the frame's time zone).
  artUsage() {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: this.cfg.timezone }).format(new Date());
    if (this.art.usage?.day !== day) this.art.usage = { day, count: 0 };
    return this.art.usage;
  }

  // "Generate": checks the request (and throws with a `status` for the page), then asks Google
  // in the background. Returns a promise of the new gallery item. It doesn't take the frame's
  // lock: the display must not find the NAS busy for the half minute Google takes.
  startGenerate({ prompt, style: styleId } = {}) {
    const off = this.artOff();
    if (off) throw fail(403, off);
    const text = typeof prompt === 'string' ? prompt.trim() : '';
    if (!text) throw fail(400, 'Describe the picture first');
    if (text.length > MAX_PROMPT) throw fail(400, `The description is too long (${text.length} characters; ${MAX_PROMPT} at most)`);
    const style = STYLES.find((s) => s.id === (styleId || 'none'));
    if (!style) throw fail(400, `There is no style called "${styleId}"`);
    if (this.generating) throw fail(409, 'A picture is being made already');
    const { dailyMax } = this.cfg.generate;
    if (this.artUsage().count >= dailyMax) throw fail(429, `That was picture ${dailyMax} of ${dailyMax} for today (GENERATE_DAILY_MAX)`);

    this.generating = { what: 'Asking Google for the picture', since: Date.now(), prompt: text };
    this.art.lastError = null;
    this.art.style = style.id;
    return this.makeArt(text, style).catch((err) => {
      this.art.lastError = { at: Date.now(), message: err.message, prompt: text };
      this.store.save();
      log.warn(`Generate: ${err.message}`);
      throw err;
    }).finally(() => { this.generating = null; });
  }

  async makeArt(prompt, style) {
    const g = this.cfg.generate;
    const { panel } = this.cfg;
    const usage = this.artUsage();
    log.info(`Generate: asking ${g.model} for “${short(prompt, 120)}”${style.text ? ` (${style.name})` : ''}…`);
    let made;
    try {
      made = await generateImage({
        apiKey: g.apiKey, model: g.model, baseUrl: g.baseUrl, size: g.size, timeoutMs: g.timeoutSec * 1000,
        prompt: buildPrompt(panel, prompt, style), aspectRatio: nearestAspect(panel.width, panel.height),
      });
    } catch (err) {
      if (err.spent !== false) { usage.count++; this.store.save(); } // (it may have been charged)
      throw err;
    }
    usage.count++;
    this.store.save();
    this.generating.what = 'Preparing the preview';
    let meta;
    try {
      meta = await sharp(made.image).metadata();
    } catch (err) {
      throw new Error(`Google sent something that is not a picture (${err.message})`);
    }
    const id = crypto.randomBytes(6).toString('hex');
    const file = `original.${meta.format === 'jpeg' ? 'jpg' : meta.format}`;
    fs.mkdirSync(this.artDir(id), { recursive: true });
    fs.writeFileSync(this.artDir(id, file), made.image);
    const item = { id, prompt, style: style.id, model: made.model, createdAt: Date.now(), width: meta.width, height: meta.height, file, keep: false };
    try {
      await this.writeRender(this.artDir(id), { kind: 'cover', items: [item] }, [made.image], { device: false });
    } catch (err) {
      fs.rmSync(this.artDir(id), { recursive: true, force: true });
      throw err;
    }
    this.art.items.unshift(item);
    this.trimArt();
    this.store.save();
    log.info(`Generate: got a ${meta.width}×${meta.height} picture after ${Math.round((Date.now() - this.generating.since) / 1000)} s (${usage.count} of ${g.dailyMax} today).`);
    return item;
  }

  // The gallery holds a hundred pictures (generate.galleryMax) besides those kept in the rotation:
  // beyond that the oldest go.
  trimArt() {
    for (const it of this.art.items.filter((x) => !x.keep).slice(this.cfg.generate.galleryMax)) this.removeArt(it);
  }

  removeArt(item) {
    this.art.items = this.art.items.filter((it) => it !== item);
    this.syncLibrary(item, false);
    fs.rmSync(this.artDir(item.id), { recursive: true, force: true });
  }

  // A gallery picture as the photo library and the playlist know it.
  artItem(item) {
    return {
      id: artId(item.id), source: 'generated', album: 'Generated', path: this.artDir(item.id, item.file),
      width: item.width, height: item.height, takenAt: item.createdAt, title: short(item.prompt),
    };
  }

  // The pictures kept in the rotation, for the photo library (library.js).
  keptArt() {
    return this.art.items.filter((it) => it.keep && fs.existsSync(this.artDir(it.id, it.file))).map((it) => this.artItem(it));
  }

  // Add a picture to the photos read last, or take it out, without reading the album anew.
  syncLibrary(item, keep) {
    this.libraryItem(this.artItem(item), keep, { url: 'generated', title: 'Generated' });
  }

  // "Keep in rotation": the picture joins the album's photos and comes up once per round.
  keepArt(id, keep) {
    const item = this.findArt(id);
    item.keep = !!keep;
    this.syncLibrary(item, item.keep);
    this.store.save();
    log.info(`Generate: “${short(item.prompt)}” is ${item.keep ? 'kept in the rotation' : 'out of the rotation'}.`);
    return item;
  }

  deleteArt(id) {
    const item = this.findArt(id);
    this.removeArt(item);
    this.store.save();
    log.info(`Generate: deleted “${short(item.prompt)}”.`);
  }

  // "Show on the frame": the picture as a one-off. Push mode: it goes to the display now (or,
  // like any photo, when the NAS next finds the display awake). Playlist mode: see
  // DailyPlaylist.showPicture().
  showArt(id) {
    const item = this.findArt(id);
    return this.run('Putting the picture on the frame', async () => {
      const input = fs.readFileSync(this.artDir(item.id, item.file));
      // Rendered anew, with the settings of today (ROTATE, DITHER, tone).
      const render = async (dir) => {
        const out = await this.writeRender(dir, { kind: 'cover', items: [item] }, [input]);
        return { renderedAt: Date.now(), kind: 'generated picture', ids: [artId(item.id)], items: [(({ path, width, height, ...ref }) => ref)(this.artItem(item))], inkShare: out.inkShare };
      };
      log.info(`Generate: putting “${short(item.prompt)}” on the frame.`);
      if (this.daily) return this.daily.showPicture(render, [artId(item.id)]);
      this.state.current = { ...await render(this.store.path('current')), pushed: false };
      this.store.save();
      return this.push(this.state.current, { reason: 'manual' });
    });
  }

  // Where a gallery picture is: 'frame' (on it), 'waiting' (goes out when the display is next
  // online) or 'planned' (for the change at `at`); null: nowhere.
  artOn(item, now = Date.now()) {
    return this.whereOn(artId(item.id), now);
  }

  artStatus() {
    const g = this.cfg.generate || {};
    const off = this.artOff();
    const name = (id) => STYLES.find((s) => s.id === id)?.name ?? id;
    return {
      enabled: !off,
      why: off,
      busy: this.generating || null,
      error: this.art.lastError || null,
      usage: { count: this.artUsage().count, max: g.dailyMax },
      model: g.model,
      style: this.art.style || 'none',
      styles: STYLES.map(({ id, name: n }) => ({ id, name: n })),
      items: this.art.items.map((it) => ({
        id: it.id, prompt: it.prompt, style: it.style === 'none' ? null : name(it.style), createdAt: it.createdAt, keep: !!it.keep, on: this.artOn(it),
      })),
    };
  }
}
