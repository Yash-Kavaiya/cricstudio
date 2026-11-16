import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DemoReplay } from '../src/espn/demo';
import { rateLimiter } from '../src/socket';
import { createSqliteRepo, setClause, type StudioRecord } from '../src/store/repo';

const dir = mkdtempSync(join(tmpdir(), 'cs-repo-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const studio = (id: string, settings = '{}'): StudioRecord => ({
  id,
  name: `Show ${id}`,
  matchKey: null,
  hostTokenHash: 'h',
  guestTokenHash: 'g',
  programTokenHash: 'p',
  guestTokenEnc: 'e',
  settings,
  createdAt: Date.now(),
});

describe('sqlite repo', () => {
  it('partial updates touch only the given columns and keep the live index in sync', async () => {
    const repo = await createSqliteRepo(join(dir, 'a.db'));
    await repo.createStudio(studio('a'));
    await repo.createStudio(studio('b', '{"wantLive":true}'));
    expect(await repo.listLiveStudios()).toEqual(['b']);

    await repo.updateStudio('a', { settings: '{"wantLive":true,"scene":"panel"}' });
    expect((await repo.listLiveStudios()).sort()).toEqual(['a', 'b']);
    const a = await repo.getStudio('a');
    expect(a?.name).toBe('Show a'); // untouched
    expect(a?.settings).toContain('panel');

    await repo.updateStudio('b', { matchKey: '1:2' }); // no settings → live flag unchanged
    expect((await repo.listLiveStudios()).sort()).toEqual(['a', 'b']);
    await repo.updateStudio('b', { settings: '{"wantLive":false}' });
    expect(await repo.listLiveStudios()).toEqual(['a']);
    expect((await repo.getStudio('b'))?.matchKey).toBe('1:2');
    await repo.updateStudio('missing', { name: 'x' }); // no-op, no throw
    await repo.close();
  });

  it('destination updates are scoped to the owning studio', async () => {
    const repo = await createSqliteRepo(join(dir, 'b.db'));
    await repo.createStudio(studio('s1'));
    await repo.createStudio(studio('s2'));
    await repo.addDestination({ id: 'd1', studioId: 's1', platform: 'youtube', name: 'YT', url: 'rtmp://x', keyEnc: 'k', enabled: true, createdAt: 1 });
    await repo.updateDestination('d1', 's2', { name: 'hijack' });
    await repo.updateDestination('d1', 's1', { enabled: false });
    const [d] = await repo.listDestinations('s1');
    expect(d.name).toBe('YT');
    expect(d.enabled).toBe(false);
    await repo.close();
  });

  it('migrates an old database: adds the live flag and backfills it', async () => {
    const file = join(dir, 'old.db');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE studios (id TEXT PRIMARY KEY, name TEXT NOT NULL, match_key TEXT, host_token_hash TEXT NOT NULL,
      guest_token_hash TEXT NOT NULL, program_token_hash TEXT NOT NULL, guest_token_enc TEXT NOT NULL,
      settings TEXT NOT NULL DEFAULT '{}', created_at BIGINT NOT NULL)`);
    db.exec(`INSERT INTO studios VALUES ('old','Old',NULL,'h','g','p','e','{"wantLive":true}',0), ('idle','Idle',NULL,'h','g','p','e','{}',0)`);
    db.close();
    const repo = await createSqliteRepo(file);
    expect(await repo.listLiveStudios()).toEqual(['old']);
    await repo.close();
  });

  it('setClause numbers placeholders for postgres', () => {
    const { sql, args } = setClause({ name: 'n', settings: '{"wantLive":true}' }, { name: 'name', settings: 'settings' }, (i) => `$${i}`);
    expect(sql).toBe('name=$1, settings=$2, want_live=$3');
    expect(args).toEqual(['n', '{"wantLive":true}', 1]);
  });
});

describe('socket rate limiter', () => {
  it('allows a burst, then refills at the given rate', () => {
    let t = 0;
    const allow = rateLimiter(2, 3, () => t);
    expect([allow(), allow(), allow(), allow()]).toEqual([true, true, true, false]);
    t = 499;
    expect(allow()).toBe(false);
    t = 500;
    expect(allow()).toBe(true);
    t = 60_000;
    expect([allow(), allow(), allow(), allow()]).toEqual([true, true, true, false]); // capped at burst
  });
});

describe('demo replay', () => {
  it('reuses the built detail until the replay advances', () => {
    const d = new DemoReplay(40);
    const a = d.detail();
    const b = d.detail();
    expect(b.innings).toBe(a.innings); // cached build
    expect(b).not.toBe(a); // fresh wrapper with its own lastUpdated
    d.step();
    const c = d.detail();
    expect(c.innings).not.toBe(a.innings);
    expect(new DemoReplay(40).total).toBe(d.total);
  });
});

describe('studio room persistence', () => {
  it('skips unchanged saves and never persists live-status ticks', async () => {
    const { StudioRoom } = await import('../src/studio/room');
    const { InMemoryBus } = await import('../src/bus');
    const writes: unknown[] = [];
    const repo = { updateStudio: async (_id: string, p: unknown) => void writes.push(p) } as any;
    const io = { to: () => ({ emit: () => undefined }) } as any;
    const hub = { subscribe: () => () => undefined } as any;
    const room = new StudioRoom(studio('p'), io, hub, repo, new InMemoryBus());
    try {
      await room.persist();
      await room.persist();
      expect(writes.length).toBe(1); // second save had nothing new
      room.state.brand = { ...room.state.brand, ticker: 'changed' };
      await room.persist();
      expect(writes.length).toBe(2);
      room.state.live = { ...room.state.live, state: 'live' }; // not a persisted field
      room.commit({ persist: false });
      await room.persist();
      expect(writes.length).toBe(2);
    } finally {
      room.dispose();
    }
  });
});
