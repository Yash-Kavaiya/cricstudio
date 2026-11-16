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

/** studios with `wantLive` get an indexed flag so the 24/7 resume loop never scans settings JSON */
const wantsLive = (settings: string) => (settings.includes('"wantLive":true') ? 1 : 0);
const LIVE_SQL = 'SELECT id FROM studios WHERE want_live = 1';
const LIVE_INDEX = 'CREATE INDEX IF NOT EXISTS studios_want_live ON studios(want_live) WHERE want_live = 1';
const BACKFILL_LIVE = `UPDATE studios SET want_live = 1 WHERE settings LIKE '%"wantLive":true%'`;

const STUDIO_COLS = { name: 'name', matchKey: 'match_key', settings: 'settings' } as const;
const DEST_COLS = { name: 'name', url: 'url', keyEnc: 'key_enc', enabled: 'enabled' } as const;

/** `a=?, b=?` for just the fields present in `patch` — one UPDATE, no read-modify-write round trip. */
export function setClause(patch: object, cols: Record<string, string>, ph: (i: number) => string) {
  const p = patch as Record<string, unknown>;
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  const add = (col: string, v: unknown) => {
    args.push(typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number | null));
    sets.push(`${col}=${ph(args.length)}`);
  };
  for (const [k, col] of Object.entries(cols)) if (p[k] !== undefined) add(col, p[k]);
  if ('settings' in cols && typeof p.settings === 'string') add('want_live', wantsLive(p.settings));
  return { sql: sets.join(', '), args };
}

/** Zero-dependency default store using Node's built-in SQLite (node >= 22.13). */
export async function createSqliteRepo(file = resolve(config.dataDir, 'cricstudio.db')): Promise<Repo> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  const cols = db.prepare('PRAGMA table_info(studios)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'want_live')) {
    db.exec('ALTER TABLE studios ADD COLUMN want_live INTEGER NOT NULL DEFAULT 0');
    db.exec(BACKFILL_LIVE);
  }
  db.exec(LIVE_INDEX);

  // prepared once and reused — db.prepare() parses and plans the SQL on every call otherwise
  const stmts = new Map<string, ReturnType<typeof db.prepare>>();
  const q = (sql: string) => {
    let st = stmts.get(sql);
    if (!st) stmts.set(sql, (st = db.prepare(sql)));
    return st;
  };

  return {
    async createStudio(s) {
      q(
        `INSERT INTO studios (id,name,match_key,host_token_hash,guest_token_hash,program_token_hash,guest_token_enc,settings,created_at,want_live)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(s.id, s.name, s.matchKey, s.hostTokenHash, s.guestTokenHash, s.programTokenHash, s.guestTokenEnc, s.settings, s.createdAt, wantsLive(s.settings));
    },
    async getStudio(id) {
      const r = q('SELECT * FROM studios WHERE id = ?').get(id);
      return r ? studioFromRow(r) : null;
    },
    async listLiveStudios() {
      return q(LIVE_SQL)
        .all()
        .map((r: any) => String(r.id));
    },
    async updateStudio(id, patch) {
      const { sql, args } = setClause(patch, STUDIO_COLS, () => '?');
      if (sql) q(`UPDATE studios SET ${sql} WHERE id=?`).run(...args, id);
    },
    async listDestinations(studioId) {
      return q('SELECT * FROM destinations WHERE studio_id = ? ORDER BY created_at').all(studioId).map(destFromRow);
    },
    async addDestination(d) {
      q('INSERT INTO destinations (id,studio_id,platform,name,url,key_enc,enabled,created_at) VALUES (?,?,?,?,?,?,?,?)').run(
        d.id,
        d.studioId,
        d.platform,
        d.name,
        d.url,
        d.keyEnc,
        d.enabled ? 1 : 0,
        d.createdAt,
      );
    },
    async updateDestination(id, studioId, patch) {
      const { sql, args } = setClause(patch, DEST_COLS, () => '?');
      if (sql) q(`UPDATE destinations SET ${sql} WHERE id=? AND studio_id=?`).run(...args, id, studioId);
    },
    async deleteDestination(id, studioId) {
      q('DELETE FROM destinations WHERE id = ? AND studio_id = ?').run(id, studioId);
    },
    async close() {
      stmts.clear();
      db.close();
    },
  };
}

/** Postgres store for multi-instance deployments (DATABASE_URL=postgres://...). */
export async function createPgRepo(url: string): Promise<Repo> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX) || 10, idleTimeoutMillis: 30_000 });
  // an idle client dropped by the database or a proxy must not crash the whole process
  pool.on('error', (e) => console.warn('[pg] idle client error:', e.message));
  await pool.query(SCHEMA);
  const { rows } = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'studios' AND column_name = 'want_live'`);
  if (!rows.length) {
    await pool.query('ALTER TABLE studios ADD COLUMN IF NOT EXISTS want_live INTEGER NOT NULL DEFAULT 0');
    await pool.query(BACKFILL_LIVE);
  }
  await pool.query(LIVE_INDEX);
  const one = async (sql: string, args: unknown[]) => (await pool.query(sql, args)).rows[0];
  const ph = (i: number) => `$${i}`;

  return {
    async createStudio(s) {
      await pool.query(
        `INSERT INTO studios (id,name,match_key,host_token_hash,guest_token_hash,program_token_hash,guest_token_enc,settings,created_at,want_live)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [s.id, s.name, s.matchKey, s.hostTokenHash, s.guestTokenHash, s.programTokenHash, s.guestTokenEnc, s.settings, s.createdAt, wantsLive(s.settings)],
      );
    },
    async getStudio(id) {
      const r = await one('SELECT * FROM studios WHERE id = $1', [id]);
      return r ? studioFromRow(r) : null;
    },
    async listLiveStudios() {
      return (await pool.query(LIVE_SQL)).rows.map((r: any) => String(r.id));
    },
    async updateStudio(id, patch) {
      const { sql, args } = setClause(patch, STUDIO_COLS, ph);
      if (sql) await pool.query(`UPDATE studios SET ${sql} WHERE id=$${args.length + 1}`, [...args, id]);
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
      const { sql, args } = setClause(patch, DEST_COLS, ph);
      if (sql) await pool.query(`UPDATE destinations SET ${sql} WHERE id=$${args.length + 1} AND studio_id=$${args.length + 2}`, [...args, id, studioId]);
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
