import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMatchDetail, cleanDismissal, normalizeBalls, oversToBalls, ballsToOvers } from '@cricstudio/cricket-engine';
import type { Ball, BatterLine, BowlerLine, MatchDetail, MatchListItem } from '@cricstudio/shared';
import { config } from '../config';

export const DEMO_KEY = 'demo:replay';

/**
 * Replays a recorded real match (IND v WI T20I) ball by ball so the whole studio —
 * scenes, automation, sfx — can be exercised when no live match is on.
 */
export class DemoReplay {
  private summary: any;
  private all: Ball[] = [];
  cursor = 0;

  constructor(startAt = 70) {
    this.summary = JSON.parse(readFileSync(resolve(config.demoDir, 'summary.json'), 'utf8'));
    for (let p = 1; p <= 8; p++) {
      try {
        this.all.push(...normalizeBalls(JSON.parse(readFileSync(resolve(config.demoDir, `pbp${p}.json`), 'utf8'))));
      } catch {
        /* optional page */
      }
    }
    this.all.sort((a, b) => a.seq - b.seq);
    this.cursor = Math.min(startAt, this.all.length);
  }

  get total() {
    return this.all.length;
  }

  /** advance one delivery; returns false when it wrapped around */
  step(): boolean {
    this.cursor++;
    if (this.cursor > this.all.length) {
      this.cursor = 1;
      return false;
    }
    return true;
  }

  balls(): Ball[] {
    return this.all.slice(0, this.cursor);
  }

  listItem(): MatchListItem {
    const d = this.detail();
    return {
      id: 'replay',
      leagueId: 'demo',
      leagueName: 'Demo replay · recorded T20I',
      name: d.title,
      description: `${d.description} (replay)`,
      state: 'in',
      statusText: d.summary,
      startDate: new Date().toISOString(),
      isDemo: true,
      teams: d.teams.map((t) => ({ id: t.id, name: t.name, abbr: t.abbr, logo: t.logo, score: t.score })),
    };
  }

  detail(): MatchDetail {
    const balls = this.balls();
    const base = buildMatchDetail({ leagueId: 'demo', eventId: 'replay', summary: this.summary, balls });
    const last = balls.at(-1);
    const curInn = last?.innings ?? 1;
    const innings = base.innings
      .filter((i) => i.number <= curInn)
      .map((inn) => {
        const ib = balls.filter((b) => b.innings === inn.number);
        const lb = ib.at(-1);
        const legal = ib.filter((b) => b.type !== 'wide' && b.type !== 'noball').length;
        return {
          ...inn,
          runs: lb?.inningsRuns ?? 0,
          wickets: lb?.inningsWickets ?? 0,
          overs: ballsToOvers(legal),
          isCurrent: inn.number === curInn,
          target: inn.number === 2 ? (base.innings[0]?.runs ?? 0) + 1 : 0,
          batting: battingFromBalls(ib),
          bowling: bowlingFromBalls(ib),
        };
      });
    const cur = innings.find((i) => i.isCurrent);
    const teams = base.teams.map((t) => {
      const parts = innings.filter((i) => i.teamId === t.id).map((i) => `${i.runs}/${i.wickets}${i.isCurrent ? ` (${i.overs} ov)` : ''}`);
      return { ...t, score: parts.join(' & ') };
    });
    let need: MatchDetail['need'] = null;
    let rrr: number | null = null;
    let summary = `${cur?.teamAbbr ?? ''} batting`;
    if (cur && cur.number === 2) {
      const remaining = 120 - oversToBalls(cur.overs);
      need = { runs: Math.max(0, cur.target - cur.runs), balls: remaining };
      rrr = remaining > 0 ? (need.runs / remaining) * 6 : 0;
      summary = `${cur.teamName} need ${need.runs} runs from ${need.balls} balls`;
    }
    const currentBatters = [last?.batsman, last?.nonStriker]
      .filter(Boolean)
      .map((b) => cur?.batting.find((x) => x.id === b!.id))
      .filter((b): b is BatterLine => !!b);
    const currentBowler = last?.bowler ? cur?.bowling.find((b) => b.id === last.bowler!.id) : undefined;
    return {
      ...base,
      key: DEMO_KEY,
      isDemo: true,
      state: 'in',
      statusText: 'Live (replay)',
      summary,
      teams,
      innings,
      currentInnings: curInn,
      battingTeamId: cur?.teamId,
      currentBatters,
      currentBowler,
      crr: last?.runRate ?? 0,
      need,
      rrr,
      lastUpdated: Date.now(),
    };
  }
}

function battingFromBalls(ib: Ball[]): BatterLine[] {
  const map = new Map<string, BatterLine>();
  let pos = 0;
  for (const b of ib) {
    for (const bb of [b.batsman, b.nonStriker]) {
      if (!bb) continue;
      const ex = map.get(bb.id);
      const line: BatterLine = {
        id: bb.id,
        name: bb.name,
        position: ex?.position ?? ++pos,
        runs: bb.runs,
        balls: bb.balls,
        fours: bb.fours,
        sixes: bb.sixes,
        sr: bb.balls ? Math.round((bb.runs / bb.balls) * 10000) / 100 : 0,
        dismissal: ex?.dismissal ?? 'not out',
        notOut: ex?.notOut ?? true,
        batted: true,
      };
      map.set(bb.id, line);
    }
    if (b.isWicket && b.batsman) {
      const l = map.get(b.batsman.id);
      if (l) {
        l.notOut = false;
        l.dismissal = cleanDismissal(b.dismissalText ?? 'out');
      }
    }
  }
  return [...map.values()].sort((a, b) => a.position - b.position);
}

function bowlingFromBalls(ib: Ball[]): BowlerLine[] {
  const map = new Map<string, BowlerLine & { order: number }>();
  let order = 0;
  const extras = new Map<string, { wides: number; noballs: number; dots: number }>();
  for (const b of ib) {
    if (!b.bowler) continue;
    const e = extras.get(b.bowler.id) ?? { wides: 0, noballs: 0, dots: 0 };
    if (b.type === 'wide') e.wides += b.runs;
    if (b.type === 'noball') e.noballs += 1;
    if (b.type === 'dot') e.dots += 1;
    extras.set(b.bowler.id, e);
    const ex = map.get(b.bowler.id);
    const balls = oversToBalls(b.bowler.overs);
    map.set(b.bowler.id, {
      id: b.bowler.id,
      name: b.bowler.name,
      overs: b.bowler.overs,
      maidens: b.bowler.maidens,
      conceded: b.bowler.conceded,
      wickets: b.bowler.wickets,
      econ: balls ? Math.round((b.bowler.conceded / balls) * 600) / 100 : 0,
      ...e,
      order: ex?.order ?? ++order,
    });
  }
  return [...map.values()].sort((a, b) => a.order - b.order).map(({ order: _o, ...r }) => r);
}
