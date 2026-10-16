import type {
  Ball,
  BallType,
  BatterLine,
  BowlerLine,
  FallOfWicket,
  Innings,
  MatchDetail,
  MatchListItem,
  MatchStateCode,
  OverSummary,
  SquadPlayer,
  TeamInfo,
} from '@cricstudio/shared';

const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : d;
};
const str = (v: unknown, d = ''): string => (v === undefined || v === null ? d : String(v));

/** Convert cricket overs (e.g. 8.2) to legal balls given balls-per-over. */
export function oversToBalls(overs: number, bpo = 6): number {
  const whole = Math.floor(overs);
  const part = Math.round((overs - whole) * 10);
  return whole * bpo + part;
}

export function ballsToOvers(balls: number, bpo = 6): number {
  return Math.floor(balls / bpo) + (balls % bpo) / 10;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  dagger: '†', // ESPN marks the wicketkeeper: "c †Samson b Singh"
  Dagger: '‡',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  times: '×',
};

/** Decode HTML entities (named, decimal and hex) that ESPN leaves in commentary and dismissal text. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e] ?? m;
  });
}

export function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** "J Andrew lbw b Patel 21 (23m 16b 2x4 1x6) SR: 131.25" -> "lbw b Patel" */
export function cleanDismissal(text: string): string {
  let t = text.replace(/\s+\d+\s*\(.*$/, '').trim();
  const m = /\b(c & b|c\s|lbw|b\s|st\s|run out|hit wicket|retired|obstructing|handled|timed out)/.exec(t);
  if (m) t = t.slice(m.index);
  return t || text;
}

const DISMISSAL_CODES: Record<string, string> = {
  c: 'caught',
  b: 'bowled',
  lbw: 'lbw',
  st: 'stumped',
  ro: 'run out',
  hw: 'hit wicket',
  rtd: 'retired',
};

/* ------------------------------------------------------------------ */
/* Scorepanel → match list                                             */
/* ------------------------------------------------------------------ */

export function normalizeScorepanel(raw: any): MatchListItem[] {
  const out: MatchListItem[] = [];
  for (const group of raw?.scores ?? []) {
    const league = group?.leagues?.[0] ?? {};
    for (const ev of group?.events ?? []) {
      const comp = ev?.competitions?.[0] ?? {};
      const state = (comp?.status?.type?.state ?? ev?.status?.type?.state ?? 'pre') as MatchStateCode;
      const summary = str(comp?.status?.summary);
      const detail = str(comp?.status?.type?.detail ?? comp?.status?.type?.description);
      out.push({
        id: str(ev.id),
        leagueId: str(league.id ?? ev.leagueId),
        leagueName: str(league.name ?? league.abbreviation),
        name: str(ev.name),
        description: str(comp.description ?? ev.description),
        state,
        statusText: summary || detail,
        startDate: str(ev.date ?? comp.date),
        teams: (comp.competitors ?? [])
          .slice()
          .sort((a: any, b: any) => num(a.order) - num(b.order))
          .map((c: any) => ({
            id: str(c.team?.id ?? c.id),
            name: str(c.team?.displayName ?? c.team?.name),
            abbr: str(c.team?.abbreviation),
            logo: c.team?.logo || c.team?.logos?.[0]?.href || undefined,
            score: str(c.score),
            winner: c.winner === true || c.winner === 'true',
          })),
      });
    }
  }
  const rank: Record<MatchStateCode, number> = { in: 0, pre: 1, post: 2 };
  return out.sort((a, b) => rank[a.state] - rank[b.state]);
}

/* ------------------------------------------------------------------ */
/* Play-by-play item → Ball                                            */
/* ------------------------------------------------------------------ */

function ballType(item: any): BallType {
  const id = str(item?.playType?.id);
  const d = str(item?.playType?.description).toLowerCase();
  if (item?.dismissal?.dismissal || id === '9' || d === 'out') return 'out';
  if (id === '4' || d === 'six') return 'six';
  if (id === '3' || d === 'four') return 'four';
  if (id === '6' || d.includes('wide')) return 'wide';
  if (id === '5' || d.includes('no ball')) return 'noball';
  if (id === '8' || d.includes('leg bye')) return 'legbye';
  if (id === '7' || d === 'bye' || d.includes('byes')) return 'bye';
  if (id === '2' || d === 'no run') return 'dot';
  return num(item?.scoreValue) > 0 ? 'run' : 'dot';
}

export function ballLabel(type: BallType, runs: number, batRuns: number): string {
  switch (type) {
    case 'dot':
      return '•';
    case 'out':
      return 'W';
    case 'four':
      return '4';
    case 'six':
      return '6';
    case 'wide':
      return runs > 1 ? `${runs}wd` : 'wd';
    case 'noball':
      return batRuns > 0 ? `${batRuns}nb` : 'nb';
    case 'legbye':
      return `${runs}lb`;
    case 'bye':
      return `${runs}b`;
    default:
      return String(runs);
  }
}

function batter(b: any) {
  if (!b?.athlete) return undefined;
  return {
    id: str(b.athlete.id),
    name: str(b.athlete.displayName ?? b.athlete.name),
    runs: num(b.totalRuns),
    balls: num(b.faced),
    fours: num(b.fours),
    sixes: num(b.sixes),
  };
}

export function normalizeBall(item: any): Ball {
  const type = ballType(item);
  const runs = num(item.scoreValue);
  const batRuns = num(item?.batsman?.runs, type === 'wide' ? 0 : runs);
  const inn = item.innings ?? {};
  const ov = item.over ?? {};
  const actual = num(ov.actual ?? ov.overs);
  const overNumber = num(ov.number, Math.floor(actual) + 1);
  const ballInOver = num(ov.ball);
  return {
    id: str(item.id),
    seq: num(item.sequence),
    innings: num(inn.number ?? item.period, 1),
    over: actual,
    overNumber,
    ballInOver,
    type,
    runs,
    batRuns,
    isWicket: type === 'out',
    label: ballLabel(type, runs, batRuns),
    short: str(item.shortText),
    text: stripHtml(str(item.text)),
    battingTeamId: str(item.team?.id),
    battingTeamAbbr: str(item.team?.abbreviation),
    inningsRuns: num(inn.runs),
    inningsWickets: num(inn.wickets),
    runRate: num(inn.runRate),
    remainingBalls: num(inn.remainingBalls),
    ballLimit: num(inn.ballLimit),
    target: num(inn.target),
    overRuns: num(ov.runs),
    overComplete: ov.complete === true || (ballInOver >= num(ov.balls, 6) && type !== 'wide' && type !== 'noball'),
    batsman: batter(item.batsman),
    nonStriker: batter(item.otherBatsman),
    bowler: item.bowler?.athlete
      ? {
          id: str(item.bowler.athlete.id),
          name: str(item.bowler.athlete.displayName),
          overs: num(item.bowler.overs),
          conceded: num(item.bowler.conceded),
          wickets: num(item.bowler.wickets),
          maidens: num(item.bowler.maidens),
        }
      : undefined,
    dismissalText: item.dismissal?.dismissal ? stripHtml(str(item.dismissal.text)) : undefined,
    dismissalType: item.dismissal?.dismissal ? str(item.dismissal.type) : undefined,
    ts: num(item.bbbTimestamp, Date.parse(str(item.date)) || 0),
  };
}

export function normalizeBalls(pbp: any): Ball[] {
  return (pbp?.commentary?.items ?? []).map(normalizeBall).sort((a: Ball, b: Ball) => a.seq - b.seq);
}

/* ------------------------------------------------------------------ */
/* Summary + balls → MatchDetail                                       */
/* ------------------------------------------------------------------ */

function statMap(stats: any): Record<string, any> {
  const m: Record<string, any> = {};
  for (const cat of stats?.categories ?? []) for (const s of cat.stats ?? []) m[s.name] = s.value ?? s.displayValue;
  return m;
}

const ROLE_NAMES: Record<string, string> = {
  WK: 'Wicketkeeper',
  WBT: 'Wicketkeeper batter',
  BT: 'Batter',
  BAT: 'Batter',
  AR: 'Allrounder',
  BL: 'Bowler',
  BOWL: 'Bowler',
};

function squadFromRoster(roster: any[]): SquadPlayer[] {
  return (roster ?? []).map((p: any) => {
    const pos = str(p.position?.abbreviation ?? p.athlete?.position?.abbreviation);
    return {
      id: str(p.athlete?.id),
      name: str(p.athlete?.displayName),
      role: ROLE_NAMES[pos] ?? str(p.athlete?.position?.name, 'Player').replace('Unknown', 'Player'),
      captain: !!p.captain,
      keeper: pos === 'WK' || pos === 'WBT',
      headshot: p.athlete?.headshot?.href,
    };
  });
}

function battingFor(roster: any[], period: number, dismissals: Map<string, string> = new Map()): BatterLine[] {
  const lines: BatterLine[] = [];
  for (const p of roster ?? []) {
    const ls = (p.linescores ?? []).find((l: any) => num(l.period) === period);
    if (!ls) continue;
    const s = statMap(ls.statistics);
    const batting = ls.linescores?.[0]?.batting;
    if (num(s.batted) !== 1 && !batting?.active) continue;
    const id = str(p.athlete?.id);
    const code = stripHtml(str(batting?.outDetails?.shortText ?? s.dismissalCard, 'not out'));
    const dismissal = num(s.outs) === 0 ? code : dismissals.get(id) ?? DISMISSAL_CODES[code] ?? code;
    lines.push({
      id: str(p.athlete?.id),
      name: str(p.athlete?.displayName),
      headshot: p.athlete?.headshot?.href,
      position: num(s.battingPosition, 99),
      runs: num(s.runs),
      balls: num(s.ballsFaced),
      fours: num(s.fours),
      sixes: num(s.sixes),
      sr: num(s.strikeRate),
      dismissal,
      notOut: num(s.outs) === 0,
      batted: true,
      wagon: Array.isArray(batting?.wagonZone) ? batting.wagonZone.map((z: any) => num(z?.runs)) : undefined,
      dotPct: batting?.dotBallPercentage !== undefined ? num(batting.dotBallPercentage) : undefined,
      control: batting?.controlPercentage !== undefined ? num(batting.controlPercentage) : undefined,
      preferredShot: batting?.preferredShot?.shotName ? str(batting.preferredShot.shotName) : undefined,
    });
  }
  return lines.sort((a, b) => a.position - b.position);
}

function bowlingFor(roster: any[], period: number): BowlerLine[] {
  const lines: (BowlerLine & { pos: number })[] = [];
  for (const p of roster ?? []) {
    const ls = (p.linescores ?? []).find((l: any) => num(l.period) === period);
    if (!ls) continue;
    const s = statMap(ls.statistics);
    if (num(s.bowled) !== 1 && num(s.balls) === 0) continue;
    lines.push({
      id: str(p.athlete?.id),
      name: str(p.athlete?.displayName),
      headshot: p.athlete?.headshot?.href,
      overs: num(s.overs),
      maidens: num(s.maidens),
      conceded: num(s.conceded),
      wickets: num(s.wickets),
      econ: num(s.economyRate),
      wides: num(s.wides),
      noballs: num(s.noballs),
      dots: num(s.dots),
      pos: num(s.bowlingPosition, 99),
    });
  }
  return lines.sort((a, b) => a.pos - b.pos).map(({ pos: _p, ...rest }) => rest);
}

/** Build per-over summaries (Manhattan / worm) and fall of wickets from ball list. */
export function buildOverSummaries(balls: Ball[], innings: number): { overs: OverSummary[]; fow: FallOfWicket[] } {
  const byOver = new Map<number, OverSummary>();
  const fow: FallOfWicket[] = [];
  const ib = balls.filter((b) => b.innings === innings).sort((a, b) => a.seq - b.seq);
  for (const b of ib) {
    let o = byOver.get(b.overNumber);
    if (!o) {
      o = { innings, over: b.overNumber, runs: 0, wickets: 0, cumulative: 0, balls: [] };
      byOver.set(b.overNumber, o);
    }
    o.runs += b.runs;
    o.balls.push(b.label);
    o.cumulative = b.inningsRuns;
    if (b.isWicket) {
      o.wickets += 1;
      fow.push({
        wicket: b.inningsWickets,
        runs: b.inningsRuns,
        over: b.over,
        batter: b.batsman?.name ?? '',
      });
    }
  }
  const overs = [...byOver.values()].sort((a, b) => a.over - b.over);
  // The over's runs from ESPN (overRuns) is authoritative when we have the whole over.
  for (const o of overs) {
    const last = ib.filter((b) => b.overNumber === o.over).at(-1);
    if (last && last.overRuns >= o.runs) o.runs = last.overRuns;
  }
  return { overs, fow };
}

export interface BuildDetailInput {
  leagueId: string;
  eventId: string;
  summary: any;
  balls: Ball[];
}

export function buildMatchDetail({ leagueId, eventId, summary, balls }: BuildDetailInput): MatchDetail {
  const header = summary?.header ?? {};
  const comp = header.competitions?.[0] ?? {};
  const status = comp.status ?? {};
  const state = (status.type?.state ?? 'pre') as MatchStateCode;
  const rosters: any[] = summary?.rosters ?? [];
  const rosterByTeam = new Map<string, any[]>();
  for (const r of rosters) rosterByTeam.set(str(r.team?.id), r.roster ?? []);

  const competitors: any[] = comp.competitors ?? [];
  const teams: TeamInfo[] = competitors
    .slice()
    .sort((a, b) => num(a.order) - num(b.order))
    .map((c) => ({
      id: str(c.team?.id ?? c.id),
      name: str(c.team?.displayName ?? c.team?.name),
      abbr: str(c.team?.abbreviation),
      logo: c.team?.logos?.[0]?.href ?? c.team?.logo,
      color: c.team?.color ? (String(c.team.color).startsWith('#') ? c.team.color : `#${c.team.color}`) : '#1a73e8',
      score: str(c.score),
      homeAway: c.homeAway === 'home' ? 'home' : 'away',
      winner: c.winner === true || c.winner === 'true',
      squad: squadFromRoster(rosterByTeam.get(str(c.team?.id ?? c.id)) ?? []),
    }));

  const dismissalMap = new Map<string, string>();
  for (const b of balls) if (b.isWicket && b.batsman && b.dismissalText) dismissalMap.set(b.batsman.id, cleanDismissal(b.dismissalText));

  // Innings: one per (period, competitor with isBatting)
  const innings: Innings[] = [];
  for (const c of competitors) {
    for (const ls of c.linescores ?? []) {
      if (!ls.isBatting) continue;
      const period = num(ls.period);
      const s = statMap(ls.statistics);
      const teamId = str(c.team?.id ?? c.id);
      const bowlingTeam = competitors.find((o) => str(o.team?.id ?? o.id) !== teamId);
      const { overs: overSummaries, fow } = buildOverSummaries(balls, period);
      const extrasTotal = num(s.extras);
      innings.push({
        number: period,
        teamId,
        teamAbbr: str(c.team?.abbreviation),
        teamName: str(c.team?.displayName),
        runs: num(ls.runs),
        wickets: num(ls.wickets),
        overs: num(ls.overs),
        target: num(ls.target),
        ballLimit: num(s.ballLimit),
        isCurrent: num(ls.isCurrent) === 1,
        description: str(ls.description),
        batting: battingFor(rosterByTeam.get(teamId) ?? [], period, dismissalMap),
        bowling: bowlingFor(rosterByTeam.get(str(bowlingTeam?.team?.id ?? bowlingTeam?.id)) ?? [], period),
        extras: {
          wides: num(s.wides),
          noballs: num(s.noballs),
          byes: num(s.byes),
          legbyes: num(s.legbyes),
          total: extrasTotal || num(s.wides) + num(s.noballs) + num(s.byes) + num(s.legbyes),
        },
        fow,
        overSummaries,
      });
    }
  }
  innings.sort((a, b) => a.number - b.number);
  const cur = innings.find((i) => i.isCurrent) ?? innings.at(-1);

  const sortedBalls = balls.slice().sort((a, b) => a.seq - b.seq);
  const lastBall = sortedBalls.at(-1);
  const curBalls = cur ? sortedBalls.filter((b) => b.innings === cur.number) : [];

  // Current batters: prefer live ball data (striker first), fallback to not-out batters in card.
  let currentBatters: BatterLine[] = [];
  if (cur) {
    const notOut = cur.batting.filter((b) => b.notOut && b.batted);
    const lastCurBall = curBalls.at(-1);
    const ids = [lastCurBall?.batsman, lastCurBall?.nonStriker].filter(Boolean).map((b) => b!.id);
    currentBatters = ids
      .map((id) => cur.batting.find((b) => b.id === id))
      .filter((b): b is BatterLine => !!b && b.notOut);
    if (currentBatters.length < 2) {
      for (const b of notOut) if (!currentBatters.some((x) => x.id === b.id)) currentBatters.push(b);
    }
    // fill from ball data when roster not yet updated
    if (currentBatters.length === 0 && lastCurBall) {
      for (const bb of [lastCurBall.batsman, lastCurBall.nonStriker]) {
        if (!bb) continue;
        currentBatters.push({
          id: bb.id,
          name: bb.name,
          position: 0,
          runs: bb.runs,
          balls: bb.balls,
          fours: bb.fours,
          sixes: bb.sixes,
          sr: bb.balls ? (bb.runs / bb.balls) * 100 : 0,
          dismissal: 'not out',
          notOut: true,
          batted: true,
        });
      }
    }
    currentBatters = currentBatters.slice(0, 2);
  }

  let currentBowler: BowlerLine | undefined;
  const lastCurBall = curBalls.at(-1);
  if (cur && lastCurBall?.bowler) {
    currentBowler =
      cur.bowling.find((b) => b.id === lastCurBall.bowler!.id) ??
      ({
        id: lastCurBall.bowler.id,
        name: lastCurBall.bowler.name,
        overs: lastCurBall.bowler.overs,
        maidens: lastCurBall.bowler.maidens,
        conceded: lastCurBall.bowler.conceded,
        wickets: lastCurBall.bowler.wickets,
        econ: lastCurBall.bowler.overs ? lastCurBall.bowler.conceded / (oversToBalls(lastCurBall.bowler.overs) / 6) : 0,
        wides: 0,
        noballs: 0,
        dots: 0,
      } as BowlerLine);
  }

  // Partnership since last wicket in the current innings
  let partnership = { runs: 0, balls: 0 };
  if (curBalls.length) {
    let lastW = -1;
    curBalls.forEach((b, i) => {
      if (b.isWicket) lastW = i;
    });
    const since = curBalls.slice(lastW + 1);
    const baseRuns = lastW >= 0 ? curBalls[lastW].inningsRuns : 0;
    partnership = {
      runs: (since.at(-1)?.inningsRuns ?? baseRuns) - baseRuns,
      balls: since.filter((b) => b.type !== 'wide' && b.type !== 'noball').length,
    };
  }

  const curStats = (() => {
    const c = competitors.find((x) => str(x.team?.id ?? x.id) === cur?.teamId);
    const ls = c?.linescores?.find((l: any) => num(l.period) === cur?.number);
    return statMap(ls?.statistics);
  })();

  const crr = num(curStats.runRate, lastBall?.runRate ?? 0);
  const target = cur?.target ?? 0;
  let need: MatchDetail['need'] = null;
  let rrr: number | null = null;
  if (cur && target > 0 && state === 'in') {
    const ballLimit = cur.ballLimit || lastBall?.ballLimit || 0;
    const ballsUsed = num(curStats.balls, oversToBalls(cur.overs));
    const remaining = ballLimit ? Math.max(0, ballLimit - ballsUsed) : 0;
    need = { runs: Math.max(0, target - cur.runs), balls: remaining };
    rrr = num(curStats.requiredRunRate, remaining ? (need.runs / remaining) * 6 : 0);
  }

  const notes: any[] = summary?.notes ?? [];
  const toss = str(notes.find((n) => n.type === 'toss')?.text);
  const venue = str(summary?.gameInfo?.venue?.fullName);

  return {
    key: `${leagueId}:${eventId}`,
    id: eventId,
    leagueId,
    title: teams.map((t) => t.name).join(' v ') || str(header.name),
    series: str(header.league?.name ?? header.leagues?.[0]?.name),
    description: str(comp.description ?? header.description),
    venue,
    toss,
    state,
    statusText: str(status.type?.description ?? status.type?.detail),
    summary: str(status.summary),
    teams,
    innings,
    currentInnings: cur?.number ?? 0,
    battingTeamId: cur?.teamId,
    recentBalls: sortedBalls.slice(-60),
    currentBatters,
    currentBowler,
    partnership,
    crr,
    rrr,
    need,
    notes: notes.filter((n) => n.type === 'matchnote').map((n) => stripHtml(str(n.text))).slice(-12),
    lastUpdated: Date.now(),
  };
}
