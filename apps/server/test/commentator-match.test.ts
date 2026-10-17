import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommentaryLine, MatchDetail } from '@cricstudio/shared';
import { Commentator, minutesToStart } from '../src/commentary/commentator';

const preMatch = (startInMin: number): MatchDetail => ({
  key: 'x:1',
  id: '1',
  leagueId: 'x',
  title: 'India v Australia',
  series: 'Border-Gavaskar T20s',
  description: '2nd T20I',
  venue: 'Wankhede Stadium, Mumbai',
  toss: '',
  startDate: new Date(Date.now() + startInMin * 60_000).toISOString(),
  state: 'pre',
  statusText: 'Scheduled',
  summary: '',
  teams: [
    { id: 'a', name: 'India', abbr: 'IND', color: '#00f', score: '', homeAway: 'home', winner: false, squad: [{ id: '1', name: 'Rohit Sharma', role: 'bat', captain: true, keeper: false }] },
    { id: 'b', name: 'Australia', abbr: 'AUS', color: '#ff0', score: '', homeAway: 'away', winner: false, squad: [{ id: '2', name: 'Mitchell Marsh', role: 'all', captain: true, keeper: false }] },
  ],
  innings: [],
  currentInnings: 0,
  recentBalls: [],
  currentBatters: [],
  partnership: { runs: 0, balls: 0 },
  crr: 0,
  rrr: null,
  need: null,
  notes: [],
  lastUpdated: Date.now(),
});

afterEach(() => vi.useRealTimers());

describe('match-only commentary', () => {
  it('counts down to the scheduled start unless a manual timer is set', () => {
    expect(minutesToStart(preMatch(42), null)).toBe(42);
    expect(minutesToStart(preMatch(42), Date.now() + 5 * 60_000)).toBe(5);
    expect(minutesToStart({ ...preMatch(42), state: 'in' }, null)).toBeNull();
  });

  it('pre-match chatter and intro talk only about the selected match', () => {
    vi.useFakeTimers();
    const lines: CommentaryLine[] = [];
    const d = preMatch(30);
    const c = new Commentator({
      enabled: () => true,
      voice: () => 'v',
      chatterSeconds: () => 1,
      match: () => d,
      poll: () => 'Who wins this match? Vote in the comments!',
      countdownTo: () => null,
      emit: (l) => lines.push(l),
    });
    c.intro(d, 'My Show');
    expect(lines[0].text).toMatch(/India against Australia/);
    expect(lines[0].text).toMatch(/30 minutes/);
    for (let i = 0; i < 40; i++) vi.advanceTimersByTime(3000);
    c.dispose();
    expect(lines.length).toBeGreaterThan(5);
    for (const l of lines.slice(1)) {
      expect(l.text).not.toMatch(/around the grounds/i);
      // every chatter line is anchored to this match: a team, a captain, the venue or the series
      expect(l.text).toMatch(/India|Australia|Rohit|Marsh|Wankhede|T20I/);
    }
  });
});
