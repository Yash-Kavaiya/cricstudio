// Analysis pack: 12 in-depth score & match analysis scenes built from ESPN ball-by-ball data.
import type { BatterLine, Innings, MatchDetail, OverSummary, SceneId, TeamInfo } from '@cricstudio/shared';
import { background, ballChip, card, clamp, COL, easeOut, enter, fmtOvers, fx, H, hexA, ink, measure, rr, sceneTitle, teamBadge, teamColor, text, W, type RenderCtx } from './draw';
import { winProbability } from './insights';

type SceneFn = (rc: RenderCtx) => void;

/* ---------------- helpers ---------------- */

const cur = (m: MatchDetail | null): Innings | undefined => (m ? m.innings.find((i) => i.number === m.currentInnings) ?? m.innings.at(-1) : undefined);
const ballsOf = (o: number) => Math.floor(o) * 6 + Math.round((o % 1) * 10);
const teamOf = (m: MatchDetail, inn: Innings): TeamInfo | undefined => m.teams.find((t) => t.id === inn.teamId);
const surname = (n: string) => n.split(' ').at(-1) ?? n;
const played = (m: MatchDetail) => m.innings.filter((i) => i.overSummaries.length || i.runs);
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

function empty(rc: RenderCtx, msg: string) {
  card(rc.ctx, W / 2 - 560, H / 2 - 90, 1120, 180, { fill: COL.card });
  text(rc.ctx, msg, W / 2, H / 2 + 14, { size: 36, weight: 600, align: 'center', color: COL.sub, max: 1060 });
}

/** classify an over-summary chip label */
function kindOf(label: string): 'dot' | 'run' | 'four' | 'six' | 'wicket' | 'extra' {
  if (label === '•') return 'dot';
  if (label === 'W') return 'wicket';
  if (label === '4') return 'four';
  if (label === '6') return 'six';
  if (/wd|nb|lb|b$/.test(label)) return 'extra';
  return 'run';
}

function ballStats(overs: OverSummary[]) {
  const s = { balls: 0, legal: 0, dots: 0, ones: 0, twos: 0, threes: 0, fours: 0, sixes: 0, wickets: 0, extras: 0, extraRuns: 0 };
  for (const o of overs)
    for (const l of o.balls) {
      s.balls++;
      const k = kindOf(l);
      if (!/wd|nb/.test(l)) s.legal++;
      if (k === 'dot') s.dots++;
      else if (k === 'four') s.fours++;
      else if (k === 'six') s.sixes++;
      else if (k === 'wicket') s.wickets++;
      else if (k === 'extra') {
        s.extras++;
        s.extraRuns += parseInt(l, 10) || 1;
      } else if (l === '1') s.ones++;
      else if (l === '2') s.twos++;
      else if (l === '3' || l === '5') s.threes++;
    }
  return s;
}

/** progress-animated donut; returns nothing, draws segments clockwise from 12 o'clock */
function donut(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, thick: number, segs: { v: number; color: string }[], p: number) {
  const total = segs.reduce((a, s) => a + s.v, 0);
  ctx.save();
  ctx.lineWidth = thick;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = ink(0.07);
  ctx.stroke();
  if (total > 0) {
    let a = -Math.PI / 2;
    const span = Math.PI * 2 * easeOut(p);
    for (const s of segs) {
      if (!s.v) continue;
      const da = (s.v / total) * span;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a + 0.012, a + da - 0.012);
      ctx.strokeStyle = s.color;
      ctx.stroke();
      a += da;
    }
  }
  ctx.restore();
}

function legendRow(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, label: string, value: string, w = 420) {
  rr(ctx, x, y - 20, 22, 22, 6);
  ctx.fillStyle = color;
  ctx.fill();
  text(ctx, label, x + 38, y, { size: 28, weight: 500, color: COL.sub });
  text(ctx, value, x + w, y, { size: 30, weight: 800, align: 'right', font: 'cond' });
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string | CanvasGradient) {
  rr(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = ink(0.08);
  ctx.fill();
  if (frac <= 0) return;
  rr(ctx, x, y, Math.max(h, w * clamp(frac)), h, h / 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/** heat colour for runs in an over: cool → hot */
function heat(runs: number) {
  const t = clamp(runs / 18);
  const stops = [
    [0, [52, 72, 120]],
    [0.3, [52, 168, 83]],
    [0.6, [251, 188, 4]],
    [1, [234, 67, 53]],
  ] as const;
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const [t0, c0] = stops[i];
  const [t1, c1] = stops[i + 1];
  const k = (t - t0) / (t1 - t0 || 1);
  return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k)).join(',')})`;
}

function dismissalKind(d: string): string {
  const s = d.trim().toLowerCase();
  if (s.startsWith('c & b') || s.startsWith('c&b')) return 'Caught & bowled';
  if (s.startsWith('st ')) return 'Stumped';
  if (s.startsWith('c ')) return 'Caught';
  if (s.startsWith('lbw')) return 'LBW';
  if (s.startsWith('run out') || s.startsWith('ro')) return 'Run out';
  if (s.startsWith('hit wicket') || s.startsWith('hw')) return 'Hit wicket';
  if (s.startsWith('b ') || s === 'b' || s === 'bowled') return 'Bowled';
  return 'Other';
}
const DISMISSAL_COLORS: Record<string, string> = {
  Caught: COL.gblue,
  Bowled: COL.red,
  LBW: COL.yellow,
  'Run out': COL.purple,
  Stumped: COL.green,
  'Caught & bowled': '#24c1e0',
  'Hit wicket': '#e37400',
  Other: COL.dim,
};

function partnershipsOf(m: MatchDetail, inn: Innings) {
  const out: { wkt: number; runs: number; balls: number; ended: string; live: boolean }[] = [];
  let prevRuns = 0;
  let prevBalls = 0;
  for (const f of inn.fow) {
    const b = ballsOf(f.over);
    out.push({ wkt: f.wicket, runs: f.runs - prevRuns, balls: Math.max(0, b - prevBalls), ended: f.batter, live: false });
    prevRuns = f.runs;
    prevBalls = b;
  }
  if (inn.isCurrent && m.state === 'in' && inn.wickets < 10) {
    const runs = m.partnership.runs || inn.runs - prevRuns;
    const balls = m.partnership.balls || Math.max(0, ballsOf(inn.overs) - prevBalls);
    out.push({ wkt: inn.wickets + 1, runs, balls, ended: m.currentBatters.map((b) => surname(b.name)).join(' & '), live: true });
  }
  return out;
}

/* ---------------- 1 · run-rate graph ---------------- */

const runRateGraph: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  if (!m) return empty(rc, 'Select a match to see the run-rate graph');
  const series = played(m).filter((i) => i.overSummaries.length).slice(-2);
  if (!series.length) return empty(rc, 'Run-rate graph appears after the first over');
  sceneTitle(rc, 'Run Rate Graph', 'run rate after every over');
  const limit = Math.max(...series.map((i) => (i.ballLimit || 120) / 6), ...series.flatMap((i) => i.overSummaries.map((o) => o.over)));
  const chase = series.find((i) => i.target);
  const rrrPts = chase
    ? chase.overSummaries.map((o) => ({ over: o.over, v: limit - o.over > 0 ? Math.max(0, (chase.target - o.cumulative) / (limit - o.over)) : 0 }))
    : [];
  const maxV = Math.max(12, ...series.flatMap((i) => i.overSummaries.map((o) => Math.max(o.runs, o.cumulative / o.over))), ...rrrPts.map((p) => Math.min(p.v, 24))) * 1.1;
  const x0 = 230,
    y0 = 900,
    cw = W - 400,
    ch = 600;
  const X = (o: number) => x0 + (o / limit) * cw;
  const Y = (v: number) => y0 - (Math.min(v, maxV) / maxV) * ch;
  fx(ctx, enter(age, 1), () => {
    card(ctx, 120, 190, W - 240, 800, { fill: COL.card, r: 28 });
    for (let v = 0; v <= maxV; v += maxV > 18 ? 4 : 2) {
      ctx.fillStyle = COL.line;
      ctx.fillRect(x0, Y(v), cw, 1);
      text(ctx, String(v), x0 - 18, Y(v) + 8, { size: 20, color: COL.dim, align: 'right' });
    }
    const step = limit > 20 ? 5 : 2;
    for (let o = 0; o <= limit; o += step) text(ctx, String(o), X(o), y0 + 40, { size: 20, color: COL.dim, align: 'center' });
    text(ctx, 'OVERS', x0 + cw / 2, y0 + 76, { size: 18, weight: 700, color: COL.dim, align: 'center', spacing: 3 });
  });
  const p = easeOut((age - 300) / 1600);
  // current innings per-over runs as faint bars
  const last = series.at(-1)!;
  const bw = Math.max(6, (cw / limit) * 0.55);
  fx(ctx, enter(age, 2), () => {
    last.overSummaries.forEach((o) => {
      const h = (Math.min(o.runs, maxV) / maxV) * ch * p;
      rr(ctx, X(o.over - 0.5) - bw / 2, y0 - h, bw, h, 4);
      ctx.fillStyle = hexA(rc.accent, 0.18);
      ctx.fill();
    });
  });
  const line = (pts: { x: number; y: number }[], col: string, width: number, dash?: number[]) => {
    const n = Math.max(2, Math.ceil(pts.length * p));
    ctx.save();
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    pts.slice(0, n).forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.strokeStyle = col;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  };
  series.forEach((inn, gi) => {
    const team = teamOf(m, inn);
    const col = gi === series.length - 1 ? rc.accent : teamColor(team);
    line(inn.overSummaries.map((o) => ({ x: X(o.over), y: Y(o.cumulative / o.over) })), col, 7);
    const lastO = inn.overSummaries.at(-1)!;
    fx(ctx, enter(age, 4 + gi), () => {
      legendRow(ctx, 260 + gi * 520, 250, col, `${team?.abbr ?? inn.teamAbbr} run rate`, (lastO.cumulative / lastO.over).toFixed(2), 440);
    });
  });
  if (rrrPts.length) {
    line(rrrPts.map((q) => ({ x: X(q.over), y: Y(q.v) })), COL.yellow, 5, [16, 10]);
    fx(ctx, enter(age, 6), () => legendRow(ctx, 1300, 250, COL.yellow, 'Required rate', (rrrPts.at(-1)?.v ?? 0).toFixed(2), 380));
  }
};

/* ---------------- 2 · over heatmap ---------------- */

const overHeatmap: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  if (!m) return empty(rc, 'Select a match to see the over heatmap');
  const inns = played(m).filter((i) => i.overSummaries.length);
  if (!inns.length) return empty(rc, 'Heatmap fills in as overs are bowled');
  const t20 = inns.every((i) => (i.ballLimit || 120) <= 120);
  const show = t20 ? inns.slice(-2) : inns.slice(-1);
  sceneTitle(rc, 'Over-by-Over Heatmap', 'hotter = more runs · red dot = wicket');
  const cols = 10;
  const gap = 12;
  const tw = (W - 240 - gap * (cols - 1)) / cols;
  let y = 210;
  show.forEach((inn, ii) => {
    const team = teamOf(m, inn);
    const limit = Math.ceil((inn.ballLimit || 120) / 6);
    const rows = Math.ceil(limit / cols);
    const th = Math.min(150, (show.length > 1 ? 330 : 700) / rows - gap);
    fx(ctx, enter(age, 1 + ii * 3), () => {
      teamBadge(rc, team, 146, y + 4, 22);
      text(ctx, `${inn.teamName} · ${inn.runs}/${inn.wickets} (${fmtOvers(inn.overs)})`, 182, y + 14, { size: 30, weight: 700, max: 1200 });
    });
    y += 44;
    for (let o = 1; o <= limit; o++) {
      const os = inn.overSummaries.find((s) => s.over === o);
      const cx = 120 + ((o - 1) % cols) * (tw + gap);
      const cy = y + Math.floor((o - 1) / cols) * (th + gap);
      const p = enter(age, 2 + ii * 3 + o * 0.35, 40);
      fx(ctx, p, () => {
        if (!os) {
          rr(ctx, cx, cy, tw, th, 16);
          ctx.strokeStyle = COL.line;
          ctx.lineWidth = 2;
          ctx.stroke();
          text(ctx, String(o), cx + 14, cy + 30, { size: 20, color: COL.dim });
          return;
        }
        rr(ctx, cx, cy, tw, th, 16);
        const g = ctx.createLinearGradient(0, cy, 0, cy + th);
        g.addColorStop(0, heat(os.runs));
        g.addColorStop(1, hexA('#000000', 0.25));
        ctx.fillStyle = heat(os.runs);
        ctx.fill();
        ctx.fillStyle = g;
        ctx.globalAlpha *= 0.4;
        ctx.fill();
        ctx.globalAlpha /= 0.4;
        text(ctx, String(o), cx + 14, cy + 30, { size: 20, weight: 700, color: ink(0.75) });
        text(ctx, String(os.runs), cx + tw / 2, cy + th / 2 + (th > 110 ? 12 : 18), { size: th > 110 ? 60 : 44, weight: 800, align: 'center', font: 'cond' });
        for (let w = 0; w < os.wickets; w++) {
          ctx.beginPath();
          ctx.arc(cx + tw - 20 - w * 22, cy + 22, 8, 0, Math.PI * 2);
          ctx.fillStyle = COL.red;
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (th > 110) {
          const chips = os.balls.slice(0, 8);
          const sp = Math.min(19, (tw - 20) / chips.length);
          chips.forEach((l, i) => ballChip(ctx, l === '•' ? '·' : l.replace(/wd|nb|lb|b/, (x) => x[0]), cx + tw / 2 + (i - (chips.length - 1) / 2) * sp, cy + th - 22, 8));
        }
      }, 16);
    }
    y += rows * (th + gap) + 30;
  });
  // legend
  fx(ctx, enter(age, 12), () => {
    const lx = W - 120 - 520;
    text(ctx, 'RUNS IN OVER', lx, 1010, { size: 18, weight: 700, color: COL.sub, spacing: 2 });
    [0, 4, 8, 12, 16, 20].forEach((r, i) => {
      rr(ctx, lx + 190 + i * 55, 990, 48, 28, 8);
      ctx.fillStyle = heat(r);
      ctx.fill();
      text(ctx, String(r), lx + 214 + i * 55, 1010, { size: 18, weight: 700, align: 'center' });
    });
  });
};

/* ---------------- 3 · scoring breakdown ---------------- */

const scoringBreakdown: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  const inn = cur(m);
  if (!m || !inn || !inn.overSummaries.length) return empty(rc, 'Scoring breakdown appears once the innings is under way');
  sceneTitle(rc, 'Scoring Breakdown', `${inn.teamName} ${inn.runs}/${inn.wickets}`);
  const s = ballStats(inn.overSummaries);
  const runSegs = [
    { label: 'Singles', v: s.ones, color: '#2b8a4b' },
    { label: 'Twos & threes', v: s.twos * 2 + s.threes * 3, color: '#24c1e0' },
    { label: 'Fours', v: s.fours * 4, color: COL.gblue },
    { label: 'Sixes', v: s.sixes * 6, color: COL.purple },
    { label: 'Extras', v: s.extraRuns, color: '#e37400' },
  ];
  const total = runSegs.reduce((a, r) => a + r.v, 0) || 1;
  const p = (age - 300) / 1400;
  fx(ctx, enter(age, 1), () => {
    card(ctx, 120, 200, 860, 780, { fill: COL.card, r: 30 });
    text(ctx, 'WHERE THE RUNS CAME FROM', 170, 262, { size: 22, weight: 800, color: COL.sub, spacing: 2 });
    donut(ctx, 380, 560, 170, 64, runSegs, p);
    text(ctx, String(inn.runs), 380, 575, { size: 84, weight: 800, align: 'center', font: 'cond' });
    text(ctx, 'RUNS', 380, 615, { size: 20, weight: 700, color: COL.sub, align: 'center', spacing: 3 });
    runSegs.forEach((r, i) => legendRow(ctx, 600, 420 + i * 66, r.color, r.label, `${Math.round((r.v / total) * 100)}%`, 330));
    text(ctx, `Boundaries: ${Math.round(((s.fours * 4 + s.sixes * 6) / total) * 100)}% of runs`, 170, 930, { size: 28, weight: 600, color: COL.text });
  });
  const kinds = [
    { label: 'Dot balls', v: s.dots, color: '#5f6b8f' },
    { label: 'Singles', v: s.ones, color: '#2b8a4b' },
    { label: '2s & 3s', v: s.twos + s.threes, color: '#24c1e0' },
    { label: 'Fours', v: s.fours, color: COL.gblue },
    { label: 'Sixes', v: s.sixes, color: COL.purple },
    { label: 'Wickets', v: s.wickets, color: COL.red },
    { label: 'Extras', v: s.extras, color: '#e37400' },
  ];
  const maxK = Math.max(1, ...kinds.map((k) => k.v));
  fx(ctx, enter(age, 2), () => {
    card(ctx, 1010, 200, W - 1130, 780, { fill: COL.card, r: 30 });
    text(ctx, 'BALL BY BALL OUTCOMES', 1060, 262, { size: 22, weight: 800, color: COL.sub, spacing: 2 });
  });
  kinds.forEach((k, i) =>
    fx(ctx, enter(age, 3 + i, 70), () => {
      const y = 320 + i * 74;
      text(ctx, k.label, 1060, y + 30, { size: 28, color: COL.sub });
      bar(ctx, 1260, y + 8, 380, 30, (k.v / maxK) * easeOut((age - 400 - i * 70) / 900), k.color);
      text(ctx, String(k.v), W - 170, y + 34, { size: 34, weight: 800, align: 'right', font: 'cond' });
    }),
  );
  const boundaries = s.fours + s.sixes;
  fx(ctx, enter(age, 11), () => {
    const stats: [string, string][] = [
      ['Dot %', s.legal ? `${Math.round((s.dots / s.legal) * 100)}%` : '–'],
      ['Balls / boundary', boundaries ? (s.legal / boundaries).toFixed(1) : '–'],
      ['Strike rotation', s.legal ? `${Math.round(((s.ones + s.twos + s.threes) / s.legal) * 100)}%` : '–'],
    ];
    stats.forEach(([k, v], i) => {
      const x = 1060 + i * 240;
      text(ctx, v, x, 900, { size: 54, weight: 800, font: 'cond', color: rc.accent });
      text(ctx, k.toUpperCase(), x, 935, { size: 17, weight: 700, color: COL.sub, spacing: 1.5 });
    });
  });
};

/* ---------------- 4 · partnerships ---------------- */

const partnerships: SceneFn = (rc) => {
  const { ctx, age, match: m, now } = rc;
  background(rc);
  const inn = cur(m);
  if (!m || !inn) return empty(rc, 'Partnerships appear once the innings starts');
  const ps = partnershipsOf(m, inn);
  if (!ps.length) return empty(rc, 'Waiting for the first partnership');
  sceneTitle(rc, 'Partnerships', `${inn.teamName} ${inn.runs}/${inn.wickets}`);
  const max = Math.max(30, ...ps.map((q) => q.runs));
  const best = ps.reduce((a, q) => (q.runs > a.runs ? q : a), ps[0]);
  const rows = ps.slice(-10);
  const rh = Math.min(72, 640 / rows.length);
  fx(ctx, enter(age, 1), () => card(ctx, 120, 200, W - 240, 700, { fill: COL.card, r: 30 }));
  rows.forEach((q, i) =>
    fx(ctx, enter(age, 2 + i, 70), () => {
      const y = 240 + i * rh;
      text(ctx, `${ordinal(q.wkt)} wkt`, 170, y + rh / 2 + 10, { size: 28, weight: 700, color: q.live ? rc.accent : COL.sub });
      const col = q.live ? rc.accent : q === best ? COL.gold : COL.green;
      const g = ctx.createLinearGradient(330, 0, 1300, 0);
      g.addColorStop(0, hexA(col, 0.5));
      g.addColorStop(1, col);
      bar(ctx, 330, y + rh / 2 - 16, 960, 32, (q.runs / max) * easeOut((age - 300 - i * 70) / 900), g);
      if (q.live) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 250);
        ctx.beginPath();
        ctx.arc(330 + 960 * clamp(q.runs / max) * easeOut((age - 300) / 900), y + rh / 2, 10 + pulse * 6, 0, Math.PI * 2);
        ctx.fillStyle = hexA(col, 0.5);
        ctx.fill();
      }
      text(ctx, `${q.runs}${q.live ? '*' : ''}`, 1330, y + rh / 2 + 12, { size: 38, weight: 800, font: 'cond' });
      text(ctx, `${q.balls}b · RR ${q.balls ? ((q.runs / q.balls) * 6).toFixed(1) : '–'}`, 1430, y + rh / 2 + 10, { size: 24, color: COL.sub });
      text(ctx, q.live ? `${q.ended} (unbeaten)` : `${surname(q.ended)} out`, W - 170, y + rh / 2 + 10, { size: 24, color: q.live ? rc.accent : COL.dim, align: 'right', max: 220 });
    }),
  );
  fx(ctx, enter(age, 14), () => {
    card(ctx, 120, 920, W - 240, 80, { fill: hexA(COL.gold, 0.14), r: 22, stroke: hexA(COL.gold, 0.5) });
    text(ctx, `Best stand: ${best.runs}${best.live ? '*' : ''} for the ${ordinal(best.wkt)} wicket off ${best.balls} balls`, W / 2, 972, { size: 30, weight: 700, align: 'center', color: COL.gold });
  });
};

/* ---------------- 5 · batting impact (bubble chart) ---------------- */

const battingImpact: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  if (!m) return empty(rc, 'Select a match to see batting impact');
  const pts: { b: BatterLine; team?: TeamInfo }[] = [];
  for (const inn of played(m)) for (const b of inn.batting) if (b.batted && b.balls > 0) pts.push({ b, team: teamOf(m, inn) });
  if (!pts.length) return empty(rc, 'Batting impact appears once batters have faced a few balls');
  sceneTitle(rc, 'Batting Impact', 'balls faced vs strike rate · bubble = runs');
  const maxB = Math.max(30, ...pts.map((p) => p.b.balls)) * 1.1;
  const maxSR = Math.max(200, ...pts.map((p) => p.b.sr)) * 1.05;
  const maxR = Math.max(...pts.map((p) => p.b.runs), 1);
  const x0 = 240,
    y0 = 900,
    cw = W - 420,
    ch = 640;
  const X = (v: number) => x0 + (v / maxB) * cw;
  const Y = (v: number) => y0 - (Math.min(v, maxSR) / maxSR) * ch;
  const totalRuns = pts.reduce((a, p) => a + p.b.runs, 0);
  const totalBalls = pts.reduce((a, p) => a + p.b.balls, 0);
  const avgSR = totalBalls ? (totalRuns / totalBalls) * 100 : 120;
  const midB = maxB / 2.6;
  fx(ctx, enter(age, 1), () => {
    card(ctx, 120, 190, W - 240, 820, { fill: COL.card, r: 28 });
    ctx.save();
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = ink(0.22);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, Y(avgSR));
    ctx.lineTo(x0 + cw, Y(avgSR));
    ctx.moveTo(X(midB), y0);
    ctx.lineTo(X(midB), y0 - ch);
    ctx.stroke();
    ctx.restore();
    for (let v = 0; v <= maxSR; v += 50) text(ctx, String(v), x0 - 18, Y(v) + 8, { size: 20, color: COL.dim, align: 'right' });
    for (let v = 0; v <= maxB; v += maxB > 80 ? 20 : 10) text(ctx, String(v), X(v), y0 + 36, { size: 20, color: COL.dim, align: 'center' });
    text(ctx, 'BALLS FACED', x0 + cw / 2, y0 + 72, { size: 18, weight: 700, color: COL.dim, align: 'center', spacing: 3 });
    text(ctx, `avg SR ${avgSR.toFixed(0)}`, x0 + cw - 10, Y(avgSR) - 12, { size: 20, color: COL.sub, align: 'right' });
    const q = (s: string, x: number, y: number, al: CanvasTextAlign) => text(ctx, s, x, y, { size: 22, weight: 800, color: ink(0.28), align: al, spacing: 3 });
    q('CAMEOS', x0 + 20, y0 - ch + 30, 'left');
    q('MATCH-WINNERS', x0 + cw - 20, y0 - ch + 30, 'right');
    q('STRUGGLED', x0 + 20, y0 - 20, 'left');
    q('ANCHORS', x0 + cw - 20, y0 - 20, 'right');
  });
  const sorted = [...pts].sort((a, b) => b.b.runs - a.b.runs);
  sorted.forEach(({ b, team }, i) => {
    const p = enter(age, 3 + i * 0.6, 60, 700);
    if (p <= 0) return;
    const col = teamColor(team);
    const r = (14 + Math.sqrt(b.runs / maxR) * 46) * easeOut(p);
    const x = X(b.balls);
    const y = Y(b.sr);
    ctx.save();
    ctx.globalAlpha *= clamp(p);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = hexA(col, 0.55);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = col;
    ctx.stroke();
    if (i < 12) {
      text(ctx, surname(b.name), x, y - r - 10, { size: 22, weight: 700, align: 'center' });
      text(ctx, `${b.runs}${b.notOut ? '*' : ''}`, x, y + 9, { size: Math.max(18, r * 0.6), weight: 800, align: 'center', font: 'cond' });
    }
    ctx.restore();
  });
};

/* ---------------- 6 · bowling analysis ---------------- */

const bowlingAnalysis: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc, COL.purple);
  const inn = cur(m);
  if (!m || !inn || !inn.bowling.length) return empty(rc, 'Bowling analysis appears once overs are bowled');
  const bowlTeam = m.teams.find((t) => t.id !== inn.teamId);
  sceneTitle(rc, 'Bowling Analysis', `${bowlTeam?.name ?? 'Bowling'} vs ${inn.teamAbbr}`);
  const rows = [...inn.bowling].filter((b) => b.overs > 0).sort((a, b) => b.wickets - a.wickets || a.econ - b.econ).slice(0, 8);
  const teamEcon = (inn.runs / Math.max(1, ballsOf(inn.overs))) * 6;
  const maxEcon = Math.max(12, ...rows.map((b) => b.econ));
  fx(ctx, enter(age, 1), () => {
    card(ctx, 120, 200, W - 240, 800, { fill: COL.card, r: 30 });
    const hy = 250;
    [['BOWLER', 170, 'left'], ['O', 640, 'center'], ['W', 730, 'center'], ['ECONOMY', 860, 'left'], ['DOT BALL %', 1360, 'left']].forEach(([l, x, a]) =>
      text(ctx, l as string, x as number, hy, { size: 20, weight: 800, color: COL.sub, align: a as CanvasTextAlign, spacing: 2 }),
    );
    // team economy marker
    const ex = 860 + 440 * (teamEcon / maxEcon);
    ctx.save();
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = hexA(COL.yellow, 0.7);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ex, 270);
    ctx.lineTo(ex, 270 + rows.length * 82);
    ctx.stroke();
    ctx.restore();
    text(ctx, `team ${teamEcon.toFixed(2)}`, ex, 285 + rows.length * 82, { size: 18, color: COL.yellow, align: 'center' });
  });
  rows.forEach((b, i) =>
    fx(ctx, enter(age, 2 + i, 70), () => {
      const y = 280 + i * 82;
      const pr = easeOut((age - 300 - i * 70) / 900);
      if (i % 2 === 0) {
        rr(ctx, 150, y, W - 300, 74, 16);
        ctx.fillStyle = ink(0.03);
        ctx.fill();
      }
      text(ctx, b.name, 170, y + 48, { size: 30, weight: 600, max: 420 });
      text(ctx, fmtOvers(b.overs), 640, y + 48, { size: 32, weight: 700, align: 'center', font: 'cond' });
      text(ctx, String(b.wickets), 730, y + 48, { size: 38, weight: 800, align: 'center', font: 'cond', color: b.wickets ? COL.gold : COL.text });
      const good = b.econ <= teamEcon;
      bar(ctx, 860, y + 24, 440, 26, (b.econ / maxEcon) * pr, good ? COL.green : COL.red);
      text(ctx, b.econ.toFixed(2), 1320, y + 46, { size: 26, weight: 700, color: good ? COL.green : '#ff8a80' });
      const balls = ballsOf(b.overs);
      const dp = balls ? b.dots / balls : 0;
      bar(ctx, 1460, y + 24, 230, 26, dp * pr, COL.gblue);
      text(ctx, `${Math.round(dp * 100)}%`, W - 160, y + 46, { size: 26, weight: 700, align: 'right' });
    }),
  );
};

/* ---------------- 7 · how wickets fell ---------------- */

const dismissalAnalysis: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc, COL.red);
  if (!m) return empty(rc, 'Select a match to see how wickets fell');
  const inns = played(m).slice(-2);
  const outs = inns.map((inn) => inn.batting.filter((b) => b.batted && !b.notOut && b.dismissal && !/not out|retired|dnb/i.test(b.dismissal)));
  if (!outs.some((o) => o.length)) return empty(rc, 'No wickets yet — the bowlers are waiting');
  sceneTitle(rc, 'How Wickets Fell', 'dismissal types by innings');
  const colW = (W - 240 - 40) / inns.length;
  inns.forEach((inn, ii) => {
    const x = 120 + ii * (colW + 40);
    const team = teamOf(m, inn);
    const counts = new Map<string, number>();
    for (const b of outs[ii]) counts.set(dismissalKind(b.dismissal), (counts.get(dismissalKind(b.dismissal)) ?? 0) + 1);
    const segs = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, v, color: DISMISSAL_COLORS[k] }));
    fx(ctx, enter(age, 1 + ii * 2), () => {
      card(ctx, x, 200, colW, 800, { fill: COL.card, r: 30 });
      teamBadge(rc, team, x + 60, 262, 28);
      text(ctx, `${inn.teamName} · ${inn.wickets} down`, x + 104, 274, { size: 30, weight: 700, max: colW - 140 });
      const single = inns.length === 1;
      const cx = single ? x + 330 : x + colW / 2;
      const cy = single ? 600 : 470;
      donut(ctx, cx, cy, 130, 54, segs, (age - 400 - ii * 200) / 1300);
      text(ctx, String(outs[ii].length), cx, cy + 22, { size: 72, weight: 800, align: 'center', font: 'cond' });
      const lx = single ? x + 620 : x + 60;
      const ly = single ? 400 : 680;
      segs.slice(0, single ? 7 : 4).forEach((s, i) => legendRow(ctx, lx, ly + i * 58, s.color, s.label, String(s.v), single ? colW - 700 : colW - 120));
    });
    // single innings: who took them
    if (inns.length > 1) return;
    const takers = new Map<string, number>();
    for (const b of outs[ii]) {
      const mm = b.dismissal.match(/(?:^|\s)b\s+(.+)$/);
      if (mm) takers.set(mm[1].trim(), (takers.get(mm[1].trim()) ?? 0) + 1);
    }
    const top = [...takers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    fx(ctx, enter(age, 6), () => {
      if (!top.length) return;
      text(ctx, 'WICKET TAKERS', x + 60, 860, { size: 20, weight: 800, color: COL.sub, spacing: 2 });
      top.forEach(([n, c], i) => text(ctx, `${n} · ${c}`, x + 60 + i * 520, 920, { size: 30, weight: 700, max: 480 }));
    });
  });
};

/* ---------------- 8 · extras & discipline ---------------- */

const extrasDiscipline: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  if (!m) return empty(rc, 'Select a match to see extras');
  const inns = played(m).slice(-2);
  if (!inns.length) return empty(rc, 'Extras appear once the innings starts');
  sceneTitle(rc, 'Extras & Discipline', 'runs given away by the bowling side');
  const colW = (W - 240 - 40) / inns.length;
  inns.forEach((inn, ii) => {
    const x = 120 + ii * (colW + 40);
    const bowlTeam = m.teams.find((t) => t.id !== inn.teamId);
    const e = inn.extras;
    const items: [string, number, string][] = [
      ['Wides', e.wides, '#e37400'],
      ['No-balls', e.noballs, COL.red],
      ['Leg byes', e.legbyes, '#24c1e0'],
      ['Byes', e.byes, COL.purple],
    ];
    const maxE = Math.max(5, ...items.map((i) => i[1]));
    const worst = [...inn.bowling].filter((b) => b.wides + b.noballs > 0).sort((a, b) => b.wides + b.noballs - (a.wides + a.noballs)).slice(0, 3);
    fx(ctx, enter(age, 1 + ii * 3), () => {
      card(ctx, x, 200, colW, 800, { fill: COL.card, r: 30 });
      teamBadge(rc, bowlTeam, x + 60, 262, 28);
      text(ctx, `${bowlTeam?.name ?? ''} bowling`, x + 104, 274, { size: 30, weight: 700, max: colW - 140 });
      text(ctx, String(e.total), x + 60, 430, { size: 140, weight: 800, font: 'cond', color: e.total > 15 ? '#ff8a80' : COL.text });
      text(ctx, 'EXTRAS', x + 66, 470, { size: 22, weight: 800, color: COL.sub, spacing: 3 });
      const pct = inn.runs ? Math.round((e.total / inn.runs) * 100) : 0;
      const free = e.wides + e.noballs;
      text(ctx, `${pct}% of the total`, x + colW - 60, 380, { size: 30, weight: 700, align: 'right' });
      text(ctx, `${free} extra ball${free === 1 ? '' : 's'} bowled`, x + colW - 60, 425, { size: 26, color: COL.sub, align: 'right' });
    });
    items.forEach(([k, v, c], i) =>
      fx(ctx, enter(age, 2 + ii * 3 + i * 0.5, 70), () => {
        const y = 520 + i * 70;
        text(ctx, k, x + 60, y + 30, { size: 28, color: COL.sub });
        bar(ctx, x + 260, y + 8, colW - 420, 28, (v / maxE) * easeOut((age - 400 - i * 70) / 900), c);
        text(ctx, String(v), x + colW - 60, y + 34, { size: 34, weight: 800, align: 'right', font: 'cond' });
      }),
    );
    fx(ctx, enter(age, 6 + ii * 3), () => {
      text(ctx, worst.length ? 'MOST WIDES + NO-BALLS' : 'NO WIDES OR NO-BALLS — DISCIPLINED!', x + 60, 845, { size: 20, weight: 800, color: worst.length ? COL.sub : COL.green, spacing: 2 });
      worst.forEach((b, i) => text(ctx, `${b.name} · ${b.wides} wd, ${b.noballs} nb`, x + 60, 890 + i * 38, { size: 26, weight: 600, max: colW - 120 }));
    });
  });
};

/* ---------------- 9 · momentum swing ---------------- */

const momentum: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  const inn = cur(m);
  if (!m || !inn || inn.overSummaries.length < 3) return empty(rc, 'Momentum needs at least three overs');
  const team = teamOf(m, inn);
  sceneTitle(rc, 'Momentum Swing', `${inn.teamName} · runs vs innings average`);
  const os = inn.overSummaries.slice(-15);
  const avg = inn.runs / Math.max(1, inn.overSummaries.length);
  const maxD = Math.max(8, ...os.map((o) => Math.abs(o.runs - avg)));
  const last3 = inn.overSummaries.slice(-3);
  const last3RR = last3.reduce((a, o) => a + o.runs, 0) / last3.length;
  const wk3 = last3.reduce((a, o) => a + o.wickets, 0);
  // momentum index −100 (bowlers) … +100 (batters)
  const idx = Math.round(clamp(((last3RR - avg) / Math.max(avg, 4)) * 120 - wk3 * 28, -100, 100));
  const x0 = 200,
    cw = 1100,
    cy = 590,
    ch = 300;
  const bw = cw / os.length;
  fx(ctx, enter(age, 1), () => {
    card(ctx, 120, 200, 1260, 800, { fill: COL.card, r: 30 });
    ctx.fillStyle = ink(0.25);
    ctx.fillRect(x0, cy, cw, 2);
    text(ctx, `avg ${avg.toFixed(1)}`, x0 + cw + 14, cy + 8, { size: 22, weight: 700, color: COL.sub });
    text(ctx, 'ABOVE AVERAGE', x0, 260, { size: 20, weight: 800, color: COL.green, spacing: 2 });
    text(ctx, 'BELOW AVERAGE', x0, 960, { size: 20, weight: 800, color: '#ff8a80', spacing: 2 });
  });
  os.forEach((o, i) =>
    fx(ctx, enter(age, 2 + i * 0.4, 60), () => {
      const d = o.runs - avg;
      const h = (Math.abs(d) / maxD) * ch * easeOut((age - 300 - i * 50) / 800);
      const x = x0 + i * bw + bw * 0.15;
      const up = d >= 0;
      rr(ctx, x, up ? cy - h : cy + 2, bw * 0.7, Math.max(4, h), 8);
      ctx.fillStyle = up ? COL.green : COL.red;
      ctx.fill();
      text(ctx, String(o.runs), x + bw * 0.35, up ? cy - h - 12 : cy + h + 32, { size: 22, weight: 700, align: 'center' });
      text(ctx, String(o.over), x + bw * 0.35, up ? cy + 30 : cy - 14, { size: 17, color: COL.dim, align: 'center' });
      if (o.wickets) ballChip(ctx, 'W', x + bw * 0.35, up ? cy - h - 50 : cy + h + 66, 16);
    }),
  );
  // gauge
  fx(ctx, enter(age, 6), () => {
    card(ctx, 1410, 200, W - 1530, 800, { fill: COL.card, r: 30 });
    const gx = 1410 + (W - 1530) / 2;
    const gy = 560;
    const r = 150;
    ctx.save();
    ctx.lineWidth = 34;
    ctx.lineCap = 'round';
    const g = ctx.createLinearGradient(gx - r, 0, gx + r, 0);
    g.addColorStop(0, COL.red);
    g.addColorStop(0.5, COL.yellow);
    g.addColorStop(1, COL.green);
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.arc(gx, gy, r, Math.PI, 0);
    ctx.stroke();
    const shown = idx * easeOut((age - 700) / 1200);
    const a = Math.PI + ((shown + 100) / 200) * Math.PI;
    ctx.strokeStyle = COL.text;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + Math.cos(a) * (r - 10), gy + Math.sin(a) * (r - 10));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(gx, gy, 16, 0, Math.PI * 2);
    ctx.fillStyle = COL.text;
    ctx.fill();
    ctx.restore();
    text(ctx, 'MOMENTUM', gx, 300, { size: 22, weight: 800, color: COL.sub, align: 'center', spacing: 3 });
    text(ctx, 'BOWL', gx - r, gy + 50, { size: 18, weight: 800, color: COL.red, align: 'center' });
    text(ctx, 'BAT', gx + r, gy + 50, { size: 18, weight: 800, color: COL.green, align: 'center' });
    const who = idx > 15 ? `${team?.abbr ?? inn.teamAbbr} on top` : idx < -15 ? 'Bowlers on top' : 'Evenly poised';
    text(ctx, who, gx, gy + 130, { size: 40, weight: 800, align: 'center', color: idx > 15 ? COL.green : idx < -15 ? '#ff8a80' : COL.yellow, max: W - 1600 });
    text(ctx, `Last 3 overs: ${Math.round(last3RR * 3)}/${wk3}`, gx, gy + 190, { size: 28, color: COL.sub, align: 'center' });
    text(ctx, `${last3RR.toFixed(1)} rpo vs ${avg.toFixed(1)}`, gx, gy + 232, { size: 28, color: COL.sub, align: 'center' });
  });
};

/* ---------------- 10 · at this stage ---------------- */

const inningsComparison: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  if (!m) return empty(rc, 'Select a match to compare innings');
  const inns = played(m).filter((i) => i.overSummaries.length);
  if (inns.length < 2) return empty(rc, '“At this stage” comparison appears in the second innings');
  const [a, b] = inns.slice(-2);
  const stage = b.overSummaries.at(-1)!.over;
  const upto = (inn: Innings) => inn.overSummaries.filter((o) => o.over <= stage);
  const snap = (inn: Innings) => {
    const os = upto(inn);
    const s = ballStats(os);
    const last5 = os.slice(-5);
    return {
      runs: os.at(-1)?.cumulative ?? 0,
      wkts: os.reduce((x, o) => x + o.wickets, 0),
      boundaries: s.fours + s.sixes,
      dots: s.dots,
      last5: last5.reduce((x, o) => x + o.runs, 0),
    };
  };
  const A = snap(a);
  const B = snap(b);
  sceneTitle(rc, 'At This Stage', `after ${stage} over${stage === 1 ? '' : 's'}`);
  const ta = teamOf(m, a);
  const tb = teamOf(m, b);
  const diff = B.runs - A.runs;
  [
    [a, A, ta, 120],
    [b, B, tb, W / 2 + 40],
  ].forEach(([inn, S, t, x], i) =>
    fx(ctx, enter(age, 1 + i, 120), () => {
      const col = teamColor(t as TeamInfo);
      card(ctx, x as number, 200, W / 2 - 160, 330, { fill: hexA(col, 0.16), r: 32, stroke: hexA(col, 0.5) });
      teamBadge(rc, t as TeamInfo, (x as number) + 90, 290, 46);
      text(ctx, (inn as Innings).teamName, (x as number) + 160, 305, { size: 36, weight: 700, max: W / 2 - 360 });
      text(ctx, `${(S as typeof A).runs}/${(S as typeof A).wkts}`, (x as number) + 60, 470, { size: 130, weight: 800, font: 'cond' });
      text(ctx, `${ordinal((inn as Innings).number)} innings`, W / 2 - 160 + (x as number) - 50, 470, { size: 28, color: COL.sub, align: 'right' });
    }, 0, i ? 60 : -60),
  );
  fx(ctx, enter(age, 4), () => {
    const ahead = diff > 0;
    const msg = diff === 0 ? 'Level on runs' : `${tb?.abbr ?? b.teamAbbr} ${Math.abs(diff)} run${Math.abs(diff) === 1 ? '' : 's'} ${ahead ? 'ahead' : 'behind'}`;
    const wd = B.wkts - A.wkts;
    const sub = wd === 0 ? 'same wickets down' : `${Math.abs(wd)} wicket${Math.abs(wd) === 1 ? '' : 's'} ${wd > 0 ? 'more' : 'fewer'} down`;
    const c = diff >= 0 ? COL.green : COL.red;
    card(ctx, W / 2 - 640, 560, 1280, 110, { fill: hexA(c, 0.2), r: 55, stroke: hexA(c, 0.6) });
    text(ctx, `${msg} · ${sub}`, W / 2, 630, { size: 36, weight: 800, align: 'center', color: COL.text, max: 1220 });
  });
  const rows: [string, number, number, boolean][] = [
    ['Runs', A.runs, B.runs, true],
    ['Wickets', A.wkts, B.wkts, false],
    ['Boundaries', A.boundaries, B.boundaries, true],
    ['Dot balls', A.dots, B.dots, false],
    ['Last 5 overs', A.last5, B.last5, true],
  ];
  rows.forEach(([k, va, vb, higherBetter], i) =>
    fx(ctx, enter(age, 5 + i, 70), () => {
      const y = 710 + i * 58;
      text(ctx, String(va), W / 2 - 300, y + 30, { size: 38, weight: 800, align: 'right', font: 'cond' });
      text(ctx, k.toUpperCase(), W / 2, y + 26, { size: 20, weight: 700, align: 'center', color: COL.sub, spacing: 2 });
      text(ctx, String(vb), W / 2 + 300, y + 30, { size: 38, weight: 800, font: 'cond' });
      if (va !== vb) {
        const bBetter = higherBetter ? vb > va : vb < va;
        text(ctx, bBetter ? '▲' : '▼', W / 2 + 420, y + 30, { size: 30, weight: 800, align: 'center', color: bBetter ? COL.green : COL.red });
      }
    }),
  );
};

/* ---------------- 11 · chase calculator ---------------- */

const chaseCalculator: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc, COL.yellow);
  const inn = cur(m);
  if (!m || !inn || !inn.target || inn.runs >= inn.target) return empty(rc, 'Chase calculator appears during a run chase');
  // ESPN usually supplies the equation; derive it from the target when it doesn't
  const { runs, balls } = m.need ?? { runs: inn.target - inn.runs, balls: Math.max(0, (inn.ballLimit || 120) - ballsOf(inn.overs)) };
  sceneTitle(rc, 'Chase Calculator', `${inn.teamName} chasing ${inn.target}`);
  const rrr = balls ? (runs / balls) * 6 : 0;
  const done = clamp(inn.runs / inn.target);
  fx(ctx, enter(age, 1), () => {
    card(ctx, 120, 200, W - 240, 250, { fill: COL.card, r: 32 });
    text(ctx, 'NEED', 180, 280, { size: 24, weight: 800, color: COL.sub, spacing: 3 });
    text(ctx, `${runs}`, 180, 410, { size: 140, weight: 800, font: 'cond', color: rc.accent });
    text(ctx, `off ${balls} balls`, 180 + 30 + measure(ctx, String(runs), { size: 140, weight: 800, font: 'cond' }), 400, { size: 52, weight: 700 });
    text(ctx, 'REQUIRED RATE', W - 600, 280, { size: 24, weight: 800, color: COL.sub, spacing: 3 });
    text(ctx, rrr.toFixed(2), W - 600, 395, { size: 110, weight: 800, font: 'cond', color: rrr > 12 ? '#ff8a80' : rrr > 9 ? COL.yellow : COL.green });
    text(ctx, `current rate ${m.crr.toFixed(2)}`, W - 600, 438, { size: 26, weight: 600, color: COL.sub });
  });
  fx(ctx, enter(age, 2), () => {
    text(ctx, `${inn.runs} / ${inn.target}`, 140, 510, { size: 26, weight: 700, color: COL.sub });
    bar(ctx, 320, 488, W - 460, 30, done * easeOut((age - 400) / 1000), rc.accent);
    text(ctx, `${10 - inn.wickets} wickets in hand`, W - 140, 560, { size: 26, weight: 700, align: 'right', color: COL.sub });
  });
  // scenarios for the next 2 overs
  const scen = [4, 8, 12, 16, 20].map((r2) => {
    const nb = Math.max(0, balls - 12);
    const nr = Math.max(0, runs - r2);
    return { r2, rrr: nb ? (nr / nb) * 6 : nr > 0 ? Infinity : 0 };
  });
  fx(ctx, enter(age, 3), () => {
    card(ctx, 120, 600, 1000, 390, { fill: COL.card, r: 30 });
    text(ctx, 'IF THEY SCORE IN THE NEXT 2 OVERS…', 170, 660, { size: 22, weight: 800, color: COL.sub, spacing: 2 });
  });
  scen.forEach((s, i) =>
    fx(ctx, enter(age, 4 + i, 70), () => {
      const y = 690 + i * 58;
      text(ctx, `${s.r2} runs`, 170, y + 36, { size: 30, weight: 700 });
      const label = !Number.isFinite(s.rrr) ? 'out of balls' : s.rrr === 0 ? 'target reached' : `required rate becomes ${s.rrr.toFixed(2)}`;
      const c = !Number.isFinite(s.rrr) || s.rrr > 12 ? '#ff8a80' : s.rrr > 9 ? COL.yellow : COL.green;
      text(ctx, label, 400, y + 36, { size: 30, weight: 600, color: c });
    }),
  );
  // boundary maths + win probability
  const wp = winProbability(m);
  const boundariesNeeded = Math.max(0, Math.ceil((runs - balls) / 3));
  fx(ctx, enter(age, 9), () => {
    card(ctx, 1150, 600, W - 1270, 390, { fill: COL.card, r: 30 });
    text(ctx, 'BOUNDARY MATHS', 1200, 660, { size: 22, weight: 800, color: COL.sub, spacing: 2 });
    text(ctx, boundariesNeeded ? `${boundariesNeeded} four${boundariesNeeded === 1 ? '' : 's'}` : 'Singles will do', 1200, 750, { size: 60, weight: 800, font: 'cond' });
    text(ctx, boundariesNeeded ? 'needed if every other ball is a single' : 'one run a ball gets them home', 1200, 795, { size: 24, color: COL.sub, max: W - 1370 });
    if (wp) {
      text(ctx, 'WIN CHANCE', 1200, 880, { size: 22, weight: 800, color: COL.sub, spacing: 2 });
      text(ctx, `${wp.batting}%`, 1200, 950, { size: 60, weight: 800, font: 'cond', color: wp.batting >= 50 ? COL.green : '#ff8a80' });
    }
  });
};

/* ---------------- 12 · match report ---------------- */

const matchReport: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc, COL.gold);
  if (!m) return empty(rc, 'Select a match to see the match report');
  const inns = played(m).slice(-2);
  if (!inns.length) return empty(rc, 'Match report appears once play begins');
  sceneTitle(rc, 'Match Report', m.description || m.series);
  fx(ctx, enter(age, 1), () => {
    card(ctx, 120, 190, W - 240, 90, { fill: hexA(COL.gold, 0.16), r: 24, stroke: hexA(COL.gold, 0.5) });
    text(ctx, m.summary || m.statusText, W / 2, 248, { size: 34, weight: 700, align: 'center', color: COL.gold, max: W - 320 });
  });
  const colW = (W - 240 - 40) / inns.length;
  inns.forEach((inn, ii) => {
    const x = 120 + ii * (colW + 40);
    const team = teamOf(m, inn);
    const col = teamColor(team);
    const bats = [...inn.batting].filter((b) => b.batted).sort((a, b) => b.runs - a.runs).slice(0, 3);
    const bowlers = [...inn.bowling].filter((b) => b.overs > 0).sort((a, b) => b.wickets - a.wickets || a.econ - b.econ).slice(0, 3);
    fx(ctx, enter(age, 2 + ii * 2), () => {
      card(ctx, x, 300, colW, 530, { fill: COL.card, r: 30 });
      rr(ctx, x, 300, colW, 8, 4);
      ctx.fillStyle = col;
      ctx.fill();
      teamBadge(rc, team, x + 60, 362, 30);
      text(ctx, inn.teamName, x + 106, 375, { size: 32, weight: 700, max: colW - 380 });
      text(ctx, `${inn.runs}/${inn.wickets}`, x + colW - 150, 382, { size: 56, weight: 800, font: 'cond', align: 'right' });
      text(ctx, `(${fmtOvers(inn.overs)})`, x + colW - 40, 380, { size: 26, color: COL.sub, align: 'right' });
      text(ctx, 'TOP BATTERS', x + 50, 440, { size: 20, weight: 800, color: COL.sub, spacing: 2 });
      bats.forEach((b, i) => {
        const y = 490 + i * 50;
        text(ctx, b.name, x + 50, y, { size: 28, weight: 600, max: colW - 300 });
        text(ctx, `${b.runs}${b.notOut ? '*' : ''}`, x + colW - 150, y, { size: 34, weight: 800, font: 'cond', align: 'right', color: i === 0 ? COL.gold : COL.text });
        text(ctx, `(${b.balls})`, x + colW - 50, y, { size: 24, color: COL.sub, align: 'right' });
      });
      text(ctx, 'TOP BOWLERS', x + 50, 660, { size: 20, weight: 800, color: COL.sub, spacing: 2 });
      bowlers.forEach((b, i) => {
        const y = 710 + i * 50;
        text(ctx, b.name, x + 50, y, { size: 28, weight: 600, max: colW - 300 });
        text(ctx, `${b.wickets}-${b.conceded}`, x + colW - 150, y, { size: 34, weight: 800, font: 'cond', align: 'right', color: i === 0 ? COL.gold : COL.text });
        text(ctx, `(${fmtOvers(b.overs)})`, x + colW - 50, y, { size: 24, color: COL.sub, align: 'right' });
      });
    });
  });
  // quick facts across the match
  const allBat = inns.flatMap((i) => i.batting);
  const sixes = allBat.reduce((a, b) => a + b.sixes, 0);
  const fours = allBat.reduce((a, b) => a + b.fours, 0);
  const sixHitter = [...allBat].sort((a, b) => b.sixes - a.sixes)[0];
  const allP = inns.flatMap((i) => partnershipsOf(m, i));
  const bestP = allP.reduce((a, p) => (!a || p.runs > a.runs ? p : a), allP[0] as (typeof allP)[number] | undefined);
  const econ = inns.flatMap((i) => i.bowling).filter((b) => b.overs >= 2).sort((a, b) => a.econ - b.econ)[0];
  const facts: [string, string][] = [
    ['Boundaries', `${fours} × 4 · ${sixes} × 6`],
    ['Most sixes', sixHitter?.sixes ? `${surname(sixHitter.name)} (${sixHitter.sixes})` : '–'],
    ['Best stand', bestP ? `${bestP.runs}${bestP.live ? '*' : ''} (${ordinal(bestP.wkt)} wkt)` : '–'],
    ['Best economy', econ ? `${surname(econ.name)} ${econ.econ.toFixed(2)}` : '–'],
  ];
  facts.forEach(([k, v], i) =>
    fx(ctx, enter(age, 7 + i, 80), () => {
      const fw = (W - 240 - 60) / 4;
      const x = 120 + i * (fw + 20);
      card(ctx, x, 860, fw, 130, { fill: COL.card, r: 24 });
      text(ctx, k.toUpperCase(), x + 30, 905, { size: 18, weight: 800, color: COL.sub, spacing: 2 });
      text(ctx, v, x + 30, 962, { size: 34, weight: 800, font: 'cond', max: fw - 60 });
    }),
  );
};

export const ANALYSIS_SCENES: Partial<Record<SceneId, SceneFn>> = {
  runRateGraph,
  overHeatmap,
  scoringBreakdown,
  partnerships,
  battingImpact,
  bowlingAnalysis,
  dismissalAnalysis,
  extrasDiscipline,
  momentum,
  inningsComparison,
  chaseCalculator,
  matchReport,
};
