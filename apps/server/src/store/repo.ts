import { resolve } from 'node:path';
import type { Platform } from '@cricstudio/shared';
import { config } from '../config';

export interface StudioRecord {
  id: string;
  name: string;
  matchKey: string | null;
  hostTokenHash: string;
  guestTokenHash: string;
  programTokenHash: string;
  /** guest invite token is stored encrypted so the host can re-copy the invite link */
  guestTokenEnc: string;
  settings: string; // JSON blob of persisted studio settings
  createdAt: number;
}

export interface DestinationRecord {
  id: string;
  studioId: string;
  platform: Platform;
  name: string;
  url: string;
  keyEnc: string;
  enabled: boolean;
  createdAt: number;
}

export interface Repo {
  createStudio(s: StudioRecord): Promise<void>;
  getStudio(id: string): Promise<StudioRecord | null>;
  /** ids of studios that asked to stay live (24/7 resume after restarts) */
  listLiveStudios(): Promise<string[]>;
  updateStudio(id: string, patch: Partial<Pick<StudioRecord, 'name' | 'matchKey' | 'settings'>>): Promise<void>;
  listDestinations(studioId: string): Promise<DestinationRecord[]>;
  addDestination(d: DestinationRecord): Promise<void>;
  updateDestination(id: string, studioId: string, patch: Partial<Pick<DestinationRecord, 'name' | 'url' | 'keyEnc' | 'enabled'>>): Promise<void>;
  deleteDestination(id: string, studioId: string): Promise<void>;
  close(): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS studios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  match_key TEXT,
  host_token_hash TEXT NOT NULL,
  guest_token_hash TEXT NOT NULL,
  program_token_hash TEXT NOT NULL,
  guest_token_enc TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS destinations (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  key_enc TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS destinations_studio ON destinations(studio_id);
`;

const studioFromRow = (r: any): StudioRecord => ({
  id: r.id,
  name: r.name,
  matchKey: r.match_key ?? null,
  hostTokenHash: r.host_token_hash,
  guestTokenHash: r.guest_token_hash,
  programTokenHash: r.program_token_hash,
  guestTokenEnc: r.guest_token_enc,
  settings: r.settings ?? '{}',
  createdAt: Number(r.created_at),
});

const destFromRow = (r: any): DestinationRecord => ({
  id: r.id,
  studioId: r.studio_id,
  platform: r.platform,
  name: r.name,
  url: r.url,
  keyEnc: r.key_enc,
  enabled: !!Number(r.enabled),
  createdAt: Number(r.created_at),
});

/** Zero-dependency default store using Node's built-in SQLite (node >= 22.13). */
export async function createSqliteRepo(file = resolve(config.dataDir, 'cricstudio.db')): Promise<Repo> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  return {
    async createStudio(s) {
      db.prepare(
        `INSERT INTO studios (id,name,match_key,host_token_hash,guest_token_hash,program_token_hash,guest_token_enc,settings,created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(s.id, s.name, s.matchKey, s.hostTokenHash, s.guestTokenHash, s.programTokenHash, s.guestTokenEnc, s.settings, s.createdAt);
    },
    async getStudio(id) {
      const r = db.prepare('SELECT * FROM studios WHERE id = ?').get(id);
      return r ? studioFromRow(r) : null;
    },
    async listLiveStudios() {
      return db
        .prepare(`SELECT id FROM studios WHERE settings LIKE '%"wantLive":true%'`)
        .all()
        .map((r: any) => String(r.id));
    },
    async updateStudio(id, patch) {
      const cur = db.prepare('SELECT * FROM studios WHERE id = ?').get(id);
      if (!cur) return;
      const s = { ...studioFromRow(cur), ...patch };
      db.prepare('UPDATE studios SET name=?, match_key=?, settings=? WHERE id=?').run(s.name, s.matchKey, s.settings, id);
    },
    async listDestinations(studioId) {
      return db.prepare('SELECT * FROM destinations WHERE studio_id = ? ORDER BY created_at').all(studioId).map(destFromRow);
    },
    async addDestination(d) {
      db.prepare(
        'INSERT INTO destinations (id,studio_id,platform,name,url,key_enc,enabled,created_at) VALUES (?,?,?,?,?,?,?,?)',
      ).run(d.id, d.studioId, d.platform, d.name, d.url, d.keyEnc, d.enabled ? 1 : 0, d.createdAt);
    },
    async updateDestination(id, studioId, patch) {
      const cur = db.prepare('SELECT * FROM destinations WHERE id = ? AND studio_id = ?').get(id, studioId);
      if (!cur) return;
      const d = { ...destFromRow(cur), ...patch };
      db.prepare('UPDATE destinations SET name=?, url=?, key_enc=?, enabled=? WHERE id=?').run(d.name, d.url, d.keyEnc, d.enabled ? 1 : 0, id);
    },
    async deleteDestination(id, studioId) {
      db.prepare('DELETE FROM destinations WHERE id = ? AND studio_id = ?').run(id, studioId);
    },
    async close() {
      db.close();
    },
  };
}

/** Postgres store for multi-instance deployments (DATABASE_URL=postgres://...). */
export async function createPgRepo(url: string): Promise<Repo> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  await pool.query(SCHEMA);
  const one = async (sql: string, args: unknown[]) => (await pool.query(sql, args)).rows[0];

  return {
    async createStudio(s) {
      await pool.query(
        `INSERT INTO studios (id,name,match_key,host_token_hash,guest_token_hash,program_token_hash,guest_token_enc,settings,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [s.id, s.name, s.matchKey, s.hostTokenHash, s.guestTokenHash, s.programTokenHash, s.guestTokenEnc, s.settings, s.createdAt],
      );
    },
    async getStudio(id) {
      const r = await one('SELECT * FROM studios WHERE id = $1', [id]);
      return r ? studioFromRow(r) : null;
    },
    async listLiveStudios() {
      return (await pool.query(`SELECT id FROM studios WHERE settings LIKE '%"wantLive":true%'`)).rows.map((r: any) => String(r.id));
    },
    async updateStudio(id, patch) {
      const cur = await one('SELECT * FROM studios WHERE id = $1', [id]);
      if (!cur) return;
      const s = { ...studioFromRow(cur), ...patch };
      await pool.query('UPDATE studios SET name=$1, match_key=$2, settings=$3 WHERE id=$4', [s.name, s.matchKey, s.settings, id]);
    },
    async listDestinations(studioId) {
      return (await pool.query('SELECT * FROM destinations WHERE studio_id = $1 ORDER BY created_at', [studioId])).rows.map(destFromRow);
    },
    async addDestination(d) {
      await pool.query(
        'INSERT INTO destinations (id,studio_id,platform,name,url,key_enc,enabled,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [d.id, d.studioId, d.platform, d.name, d.url, d.keyEnc, d.enabled ? 1 : 0, d.createdAt],
      );
    },
    async updateDestination(id, studioId, patch) {
      const cur = await one('SELECT * FROM destinations WHERE id = $1 AND studio_id = $2', [id, studioId]);
      if (!cur) return;
      const d = { ...destFromRow(cur), ...patch };
      await pool.query('UPDATE destinations SET name=$1, url=$2, key_enc=$3, enabled=$4 WHERE id=$5', [d.name, d.url, d.keyEnc, d.enabled ? 1 : 0, id]);
    },
    async deleteDestination(id, studioId) {
      await pool.query('DELETE FROM destinations WHERE id = $1 AND studio_id = $2', [id, studioId]);
    },
    async close() {
      await pool.end();
    },
  };
}

/** Redis store (e.g. Upstash on Vercel) — no SQL database needed; shared by every instance. */
export async function createRedisRepo(url: string): Promise<Repo> {
  const { default: Redis } = await import('ioredis');
  const r = new Redis(url, { maxRetriesPerRequest: 3 });
  const sKey = (id: string) => `cs:studio:${id}`;
  const dKey = (studioId: string) => `cs:dests:${studioId}`;
  const LIVE = 'cs:studios:live';
  const getS = async (id: string) => {
    const raw = await r.get(sKey(id));
    return raw ? (JSON.parse(raw) as StudioRecord) : null;
  };
  const getD = async (id: string, studioId: string) => {
    const raw = await r.hget(dKey(studioId), id);
    return raw ? (JSON.parse(raw) as DestinationRecord) : null;
  };
  const syncLive = (s: StudioRecord) => (s.settings.includes('"wantLive":true') ? r.sadd(LIVE, s.id) : r.srem(LIVE, s.id));

  return {
    async createStudio(s) {
      await r.set(sKey(s.id), JSON.stringify(s));
      await syncLive(s);
    },
    getStudio: getS,
    async listLiveStudios() {
      return r.smembers(LIVE);
    },
    async updateStudio(id, patch) {
      const cur = await getS(id);
      if (!cur) return;
      const s = { ...cur, ...patch };
      await r.set(sKey(id), JSON.stringify(s));
      await syncLive(s);
    },
    async listDestinations(studioId) {
      const all = Object.values(await r.hgetall(dKey(studioId))).map((v) => JSON.parse(v) as DestinationRecord);
      return all.sort((a, b) => a.createdAt - b.createdAt);
    },
    async addDestination(d) {
      await r.hset(dKey(d.studioId), d.id, JSON.stringify(d));
    },
    async updateDestination(id, studioId, patch) {
      const cur = await getD(id, studioId);
      if (!cur) return;
      await r.hset(dKey(studioId), id, JSON.stringify({ ...cur, ...patch }));
    },
    async deleteDestination(id, studioId) {
      await r.hdel(dKey(studioId), id);
    },
    async close() {
      r.disconnect();
    },
  };
}

export function createRepo(): Promise<Repo> {
  if (config.databaseUrl) return createPgRepo(config.databaseUrl);
  if (config.redisUrl) return createRedisRepo(config.redisUrl);
  return createSqliteRepo();
}
