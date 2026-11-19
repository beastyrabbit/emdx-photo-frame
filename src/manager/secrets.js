import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicJson, fail } from './store.js';

export class Secrets {
  constructor(root, env = process.env) {
    this.env = env;
    this.file = path.join(root, 'secrets.json');
    const keyFile = path.join(root, 'key');
    this.localKey = !env.SECRETS_KEY;
    if (env.SECRETS_KEY) {
      this.key = Buffer.from(
        env.SECRETS_KEY,
        /^[a-f\d]{64}$/i.test(env.SECRETS_KEY) ? 'hex' : 'base64',
      );
      if (this.key.length !== 32)
        throw new Error('SECRETS_KEY must encode 32 bytes');
    } else {
      if (!fs.existsSync(keyFile)) {
        if (fs.existsSync(this.file))
          throw new Error('Secret encryption key missing');
        fs.writeFileSync(keyFile, crypto.randomBytes(32), {
          flag: 'wx',
          mode: 0o600,
        });
      }
      this.key = fs.readFileSync(keyFile);
      fs.chmodSync(keyFile, 0o600);
    }
    this.values = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, 'utf8'))
      : {};
  }
  external(slot) {
    return this.env[
      { immich: 'IMMICH_API_KEY', openrouter: 'OPENROUTER_API_KEY' }[slot]
    ];
  }
  get(slot) {
    if (this.external(slot)) return this.external(slot);
    const v = this.values[slot];
    if (!v) return null;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(v.iv, 'base64'),
    );
    decipher.setAAD(Buffer.from(slot));
    decipher.setAuthTag(Buffer.from(v.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(v.data, 'base64')),
      decipher.final(),
    ]).toString();
  }
  set(slot, value) {
    if (this.external(slot))
      throw fail(
        'Dieser Schlüssel kommt aus Infisical und ist hier gesperrt.',
        409,
      );
    if (value === null) delete this.values[slot];
    else {
      if (typeof value !== 'string' || !value || value.length > 4096)
        throw fail('Ungültiger Schlüssel');
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
      cipher.setAAD(Buffer.from(slot));
      const data = Buffer.concat([cipher.update(value), cipher.final()]);
      this.values[slot] = {
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
      };
    }
    atomicJson(this.file, this.values);
  }
}
