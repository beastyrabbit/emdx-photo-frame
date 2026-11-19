import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const id = () => crypto.randomUUID();
export const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });

// The ownership ledger must never silently fall back to an older, less restrictive copy.
export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${id()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.renameSync(tmp, file);
    const dir = fs.openSync(path.dirname(file), 'r');
    try {
      fs.fsyncSync(dir);
    } finally {
      fs.closeSync(dir);
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export class ManagerStore {
  constructor(root) {
    this.root = root;
    this.file = path.join(root, 'state.json');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.file)) {
      try {
        this.state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      } catch {
        throw new Error(
          'Manager state unreadable; restore and reconcile ownership before starting',
        );
      }
      if (
        this.state.schema !== 1 ||
        !Array.isArray(this.state.frames) ||
        !this.state.pictures ||
        !this.state.claims
      )
        throw new Error('Unsupported manager state');
    } else {
      if (fs.existsSync(`${this.file}.bak`))
        throw new Error(
          'Manager primary missing; reconcile backup before starting',
        );
      this.state = {
        schema: 1,
        revision: 0,
        frames: [],
        groups: [],
        pictures: [],
        decks: {},
        claims: {},
        pending: [],
        history: [],
        events: [],
        programs: [],
        settings: {
          autoAccept: false,
          extras: { generate: false, art: false },
        },
        subscriptions: {},
        imported: {},
        keyTests: {},
      };
    }
  }
  save() {
    this.state.revision++;
    atomicJson(this.file, this.state);
  }
}
