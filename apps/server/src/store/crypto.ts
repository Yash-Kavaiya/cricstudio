import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config';

let key: Buffer | null = null;

function getKey(): Buffer {
  if (key) return key;
  let secret = config.streamKeySecret;
  if (!secret) {
    // Dev convenience: persist a generated secret next to the database.
    const f = resolve(config.dataDir, 'secret.key');
    if (existsSync(f)) secret = readFileSync(f, 'utf8').trim();
    else {
      secret = randomBytes(32).toString('hex');
      writeFileSync(f, secret, { mode: 0o600 });
    }
  }
  key = scryptSync(secret, 'cricstudio-stream-keys', 32);
  return key;
}

/** AES-256-GCM; output = base64(iv[12] | tag[16] | ciphertext) */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function decrypt(enc: string): string {
  const buf = Buffer.from(enc, 'base64');
  const d = createDecipheriv('aes-256-gcm', getKey(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

export const newToken = () => randomBytes(18).toString('base64url');
export const newId = () => randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').toLowerCase();
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export function tokenMatches(token: string | undefined, hash: string): boolean {
  if (!token) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function maskKey(k: string): string {
  if (k.length <= 6) return '••••';
  return `${k.slice(0, 3)}••••••${k.slice(-3)}`;
}
