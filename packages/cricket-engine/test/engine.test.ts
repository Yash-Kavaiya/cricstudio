import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Ball } from '@cricstudio/shared';
import { BallStore, EventDetector, buildMatchDetail, normalizeBalls, normalizeScorepanel, oversToBalls } from '../src';

const fx = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
const allBalls = (): Ball[] => {
  const out: Ball[] = [];
  for (let p = 1; p <= 8; p++) out.push(...normalizeBalls(fx(`pbp${p}.json`)));
  return out.sort((a, b) => a.seq - b.seq);
};

describe('normalizeScorepanel', () => {
  it('lists matches with live first', () => {
    const list = normalizeScorepanel(fx('scorepanel.json'));
    expect(list.length).toBeGreaterThan(5);
    expect(list[0].state).toBe('in');
    const indWi = list.find((m) => m.id === '1529233')!;
    expect(indWi.leagueId).toBe('24289');
    expect(indWi.teams.map((t) => t.abbr).sort()).toEqual(['IND', 'WI']);
  });
});

describe('normalizeBall', () => {
  const balls = allBalls();
  it('maps play types to chip labels', () => {
    const types = new Set(balls.map((b) => b.type));
    expect(types.has('four')).toBe(true);
    expect(types.has('six')).toBe(true);
    expect(types.has('out')).toBe(true);
    expect(types.has('wide')).toBe(true);
    const w = balls.find((b) => b.type === 'out')!;
    expect(w.label).toBe('W');
    expect(w.isWicket).toBe(true);
    expect(w.dismissalText).toMatch(/lbw|c |b /);
    expect(balls.find((b) => b.type === 'six')!.label).toBe('6');
    expect(balls.find((b) => b.type === 'dot')!.label).toBe('•');
  });
  it('carries innings context', () => {
    const b = balls.at(-1)!;
    expect(b.innings).toBe(2);
    expect(b.ballLimit).toBe(120);
    expect(b.bowler?.name).toBeTruthy();
  });
  it('overs maths', () => {
    expect(oversToBalls(8.2)).toBe(50);
    expect(oversToBalls(20)).toBe(120);
  });
});

describe('buildMatchDetail', () => {
  const d = buildMatchDetail({ leagueId: '24289', eventId: '1529233', summary: fx('summary.json'), balls: allBalls() });
  it('builds both innings with cards', () => {
    expect(d.teams).toHaveLength(2);
    expect(d.innings.length).toBe(2);
    const first = d.innings[0];
    expect(first.teamAbbr).toBe('WI');
    expect(first.runs).toBe(247);
    expect(first.batting.length).toBeGreaterThan(2);
    expect(first.bowling.length).toBeGreaterThan(3);
    expect(first.overSummaries.length).toBe(20);
    expect(first.overSummaries.at(-1)!.cumulative).toBe(247);
  });
  it('computes chase equation', () => {
    expect(d.state).toBe('in');
    expect(d.need).not.toBeNull();
    expect(d.need!.runs).toBeGreaterThan(0);
    expect(d.currentBatters.length).toBeGreaterThan(0);
    expect(d.toss).toMatch(/India/);
    expect(d.venue).toMatch(/Hyderabad/);
  });
});

describe('EventDetector', () => {
  it('emits nothing on prime, then events for new balls', () => {
    const balls = allBalls();
    const det = new EventDetector('24289:1529233');
    const firstInnings = balls.filter((b) => b.innings === 1);
    expect(det.process(firstInnings.slice(0, 10), 'in')).toEqual([]);
    const events = det.process(balls, 'in');
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'BALL').length).toBe(balls.length - 10);
    expect(types).toContain('FOUR');
    expect(types).toContain('SIX');
    expect(types).toContain('WICKET');
    expect(types).toContain('OVER_END');
    expect(types).toContain('INNINGS_END');
    expect(types).toContain('PARTNERSHIP');
    const ms = events.filter((e) => e.type === 'MILESTONE_BAT');
    expect(ms.map((e) => e.value)).toEqual(expect.arrayContaining([50, 100]));
    expect(ms.find((e) => e.value === 100)!.player).toMatch(/Hope/);
    // idempotent
    expect(det.process(balls, 'in')).toEqual([]);
  });
  it('emits MATCH_END on state change', () => {
    const det = new EventDetector('x');
    det.prime([], 'in');
    expect(det.process([], 'post').map((e) => e.type)).toEqual(['MATCH_END']);
  });
});

describe('BallStore', () => {
  it('syncs pages incrementally', async () => {
    const calls: number[] = [];
    const client = {
      playByPlay: async (_l: string, _e: string, page: number) => {
        calls.push(page);
        return fx(`pbp${page}.json`);
      },
    };
    const store = new BallStore(client as any, '24289', '1529233');
    const balls = await store.sync();
    expect(balls.length).toBe(allBalls().length);
    calls.length = 0;
    await store.sync();
    expect(calls).toEqual([8]);
  });
});

describe('cleanDismissal', () => {
  it('strips batter name and stats', async () => {
    const { cleanDismissal } = await import('../src');
    expect(cleanDismissal('J Andrew lbw b Patel 21 (23m 16b 2x4 1x6) SR: 131.25')).toBe('lbw b Patel');
    expect(cleanDismissal('SV Samson c Hope b Motie 56 (30m 23b 3x4 5x6) SR: 243.47')).toBe('c Hope b Motie');
    expect(cleanDismissal('Ishan Kishan run out (Powell) 6 (5m 3b) SR: 200')).toBe('run out (Powell)');
  });
});
