// Insights pack: 10 extra analytical scenes built from ESPN data.
import type { Ball, BatterLine, Innings, MatchDetail, SceneId } from '@cricstudio/shared';
import {
  COL,
  H,
  W,
  background,
  ballChip,
  card,
  clamp,
  easeOut,
  enter,
  fmtOvers,
  fx,
  headshot,
  hexA,
  measure,
  rr,
  sceneTitle,
  teamBadge,
  teamColor,
  text,
  type RenderCtx,
} from './draw';

type SceneFn = (rc: RenderCtx) => void;

const cur = (m: MatchDetail | null): Innings | undefined => (m ? m.innings.find((i) => i.number === m.currentInnings) ?? m.innings.at(-1) : undefined);
const ballsOf = (o: number) => Math.floor(o) * 6 + Math.round((o % 1) * 10);

function empty(rc: RenderCtx, msg: string) {
  card(rc.ctx, W / 2 - 520, H / 2 - 90, 1040, 180, { fill: COL.card });
  text(rc.ctx, msg, W / 2, H / 2 + 14, { size: 38, weight: 600, align: 'center', color: COL.sub, max: 980 });
}

/* ---------------- models ---------------- */

/** Simple, explainable win model: chase pressure vs resources left (or projection vs par). */
export function winProbability(m: MatchDetail): { batting: number; factors: [string, string][] } | null {
  const inn = cur(m);
  if (!inn) return null;
  const limit = inn.ballLimit || 120;
  const used = ballsOf(inn.overs);
  const wktsLeft = 10 - inn.wickets;
  const last18 = m.recentBalls.filter((b) => b.innings === inn.number).slice(-18);
  const momentum = last18.reduce((a, b) => a + b.runs, 0) / Math.max(1, last18.length / 6);
  if (m.need && inn.target) {
    const { runs, balls } = m.need;
    if (runs <= 0) return { batting: 99, factors: [['Target', 'reached']] };
    if (balls <= 0 || wktsLeft <= 0) return { batting: 1, factors: [['Balls left', '0']] };
    const rrr = (runs / balls) * 6;
    const capacity = 7.5 + wktsLeft * 0.45 + (momentum - 7.5) * 0.25;
    const x = (capacity - rrr) * 0.55 + (wktsLeft - 5) * 0.18 - (balls < 18 ? (rrr > 12 ? 0.8 : 0) : 0);
    const p = 1 / (1 + Math.exp(-x));
    return {
      batting: Math.round(clamp(p, 0.02, 0.98) * 100),
      factors: [
        ['Need', `${runs} off ${balls}`],
        ['Required rate', rrr.toFixed(2)],
        ['Wickets in hand', String(wktsLeft)],
        ['Last 3 overs', `${Math.round(momentum)} rpo`],
      ],
    };
  }
  if (used < 6) return null;
  const par = limit <= 120 ? 175 : limit <= 300 ? 290 : 0;
  if (!par) return null;
  const proj = (inn.runs / used) * limit * (0.92 + wktsLeft * 0.012);
  const x = ((proj - par) / par) * 4.2;
  return {
    batting: Math.round(clamp(1 / (1 + Math.exp(-x)), 0.05, 0.95) * 100),
    factors: [
      ['Projected', String(Math.round(proj))],
      ['Par score', String(par)],
      ['Wickets lost', String(inn.wickets)],
      ['Run rate', m.crr.toFixed(2)],
    ],
  };
}

function phases(inn: Innings): { name: string; overs: string; runs: number; wkts: number; balls: number }[] {
  const limit = (inn.ballLimit || 120) / 6;
  const pp = limit <= 20 ? 6 : 10;
  const death = limit <= 20 ? limit - 4 : limit - 10;
  const defs = [
    { name: 'Powerplay', from: 1, to: pp },
    { name: 'Middle overs', from: pp + 1, to: death },
    { name: 'Death overs', from: death + 1, to: limit },
  ];
  return defs.map((d) => {
    const os = inn.overSummaries.filter((o) => o.over >= d.from && o.over <= d.to);
    return { name: d.name, overs: `${d.from}–${d.to}`, runs: os.reduce((a, o) => a + o.runs, 0), wkts: os.reduce((a, o) => a + o.wickets, 0), balls: os.length * 6 };
  });
}

/* ---------------- scenes ---------------- */

const winPredictor: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  if (!m) return empty(rc, 'Select a match to see the win predictor');
  sceneTitle(rc, 'Win Predictor', 'CricStudio model · live');
  const wp = winProbability(m);
  const inn = cur(m);
  if (!wp || !inn) return empty(rc, 'Win predictor kicks in after the first few overs');
  const bat = m.teams.find((t) => t.id === inn.teamId) ?? m.teams[0];
  const bowl = m.teams.find((t) => t.id !== bat?.id) ?? m.teams[1];
  const p = easeOut((age - 300) / 1400);
  const shownBat = Math.round(50 + (wp.batting - 50) * p);
  fx(ctx, enter(age, 1), () => {
    card(ctx, 140, 220, W - 280, 380, { fill: COL.card, r: 36 });
    teamBadge(rc, bat, 300, 360, 90);
    teamBadge(rc, bowl, W - 300, 360, 90);
    text(ctx, `${shownBat}%`, 440, 400, { size: 130, weight: 800, font: 'cond', color: teamColor(bat) });
    text(ctx, `${100 - shownBat}%`, W - 440, 400, { size: 130, weight: 800, font: 'cond', align: 'right', color: teamColor(bowl) });
    text(ctx, bat?.name ?? '', 440, 460, { size: 32, weight: 600, max: 480 });
    text(ctx, bowl?.name ?? '', W - 440, 460, { size: 32, weight: 600, align: 'right', max: 480 });
    // tug-of-war bar
    const bx = 220,
      bw = W - 440,
      by = 510;
    rr(ctx, bx, by, bw, 46, 23);
    ctx.fillStyle = hexA(teamColor(bowl), 0.85);
    ctx.fill();
    ctx.save();
    rr(ctx, bx, by, bw, 46, 23);
    ctx.clip();
    ctx.fillStyle = teamColor(bat);
    ctx.fillRect(bx, by, (bw * shownBat) / 100, 46);
    ctx.restore();
    const kx = bx + (bw * shownBat) / 100;
    ctx.beginPath();
    ctx.arc(kx, by + 23, 34, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ballChip(ctx, '🏏', kx, by + 23, 28);
  });
  wp.factors.forEach(([k, v], i) =>
    fx(ctx, enter(age, 3 + i), () => {
      const x = 140 + i * ((W - 280) / 4);
      card(ctx, x + 10, 650, (W - 280) / 4 - 20, 200, { fill: COL.card, r: 24 });
      text(ctx, k.toUpperCase(), x + 40, 710, { size: 22, weight: 700, color: COL.sub, spacing: 2 });
      text(ctx, v, x + 40, 800, { size: 56, weight: 800, font: 'cond', max: (W - 280) / 4 - 70 });
    }),
  );
  fx(ctx, enter(age, 8), () => text(ctx, 'Model blends required rate, wickets in hand and recent momentum. For entertainment.', W / 2, 920, { size: 22, color: COL.dim, align: 'center' }));
};

const projectedScore: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  const inn = cur(m);
  if (!m || !inn) return empty(rc, 'Projected scores appear once the innings is under way');
  sceneTitle(rc, 'Projected Score', `${inn.teamName} ${inn.runs}/${inn.wickets} (${fmtOvers(inn.overs)})`);
  const limitBalls = inn.ballLimit || 120;
  const used = ballsOf(inn.overs);
  const left = Math.max(0, limitBalls - used);
  if (!used) return empty(rc, 'Waiting for the first over');
  const crr = (inn.runs / used) * 6;
  const rates = [
    ['Current rate', crr],
    ['6 per over', 6],
    ['8 per over', 8],
    ['10 per over', 10],
    ['12 per over', 12],
  ] as const;
  const proj = rates.map(([k, r]) => [k, Math.round(inn.runs + (left / 6) * r)] as const);
  const max = Math.max(...proj.map(([, v]) => v), inn.target || 0) * 1.08;
  const x0 = 520,
    bw = W - x0 - 220;
  proj.forEach(([k, v], i) =>
    fx(ctx, enter(age, 1 + i, 90), () => {
      const y = 240 + i * 128;
      text(ctx, k, 160, y + 62, { size: 34, weight: i === 0 ? 800 : 500, color: i === 0 ? rc.accent : COL.text });
      rr(ctx, x0, y + 20, bw, 64, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fill();
      const w = (bw * v) / max * easeOut((age - 300 - i * 90) / 900);
      rr(ctx, x0, y + 20, Math.max(36, w), 64, 18);
      const g = ctx.createLinearGradient(x0, 0, x0 + bw, 0);
      g.addColorStop(0, hexA(i === 0 ? rc.accent : '#34a853', 0.65));
      g.addColorStop(1, i === 0 ? rc.accent : '#34a853');
      ctx.fillStyle = g;
      ctx.fill();
      text(ctx, String(v), x0 + Math.max(36, w) + 20, y + 68, { size: 44, weight: 800, font: 'cond' });
    }, 0, -40),
  );
  if (inn.target) {
    const tx = x0 + (bw * inn.target) / max;
    fx(ctx, enter(age, 7), () => {
      ctx.strokeStyle = COL.yellow;
      ctx.setLineDash([14, 10]);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(tx, 230);
      ctx.lineTo(tx, 880);
      ctx.stroke();
      ctx.setLineDash([]);
      text(ctx, `TARGET ${inn.target}`, tx, 915, { size: 26, weight: 800, align: 'center', color: COL.yellow });
    });
  }
  fx(ctx, enter(age, 8), () => text(ctx, `${Math.floor(left / 6)}.${left % 6} overs remaining`, 160, 930, { size: 26, color: COL.sub }));
};

const phaseAnalysis: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  if (!m || !m.innings.length) return empty(rc, 'Phase analysis appears once overs are bowled');
  sceneTitle(rc, 'Phase Analysis', 'powerplay · middle · death');
  const inns = m.innings.slice(-2);
  inns.forEach((inn, ii) => {
    const team = m.teams.find((t) => t.id === inn.teamId);
    const col = teamColor(team);
    const y0 = 220 + ii * 380;
    fx(ctx, enter(age, 1 + ii * 4), () => {
      teamBadge(rc, team, 190, y0 + 60, 40);
      text(ctx, `${inn.teamName} · ${inn.runs}/${inn.wickets}`, 250, y0 + 72, { size: 34, weight: 700, max: 900 });
    });
    phases(inn).forEach((ph, i) =>
      fx(ctx, enter(age, 2 + ii * 4 + i, 90), () => {
        const x = 140 + i * 560;
        const y = y0 + 110;
        card(ctx, x, y, 530, 230, { fill: hexA(col, 0.14), r: 26, stroke: hexA(col, 0.4) });
        text(ctx, ph.name.toUpperCase(), x + 30, y + 50, { size: 22, weight: 800, color: COL.sub, spacing: 2 });
        text(ctx, `ov ${ph.overs}`, x + 500, y + 50, { size: 22, color: COL.dim, align: 'right' });
        text(ctx, `${ph.runs}/${ph.wkts}`, x + 30, y + 140, { size: 80, weight: 800, font: 'cond' });
        const rr6 = ph.balls ? (ph.runs / ph.balls) * 6 : 0;
        text(ctx, ph.balls ? `RR ${rr6.toFixed(2)}` : 'yet to come', x + 30, y + 196, { size: 28, weight: 600, color: ph.balls ? col : COL.dim });
        const bw = 200;
        rr(ctx, x + 300, y + 170, bw, 16, 8);
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fill();
        rr(ctx, x + 300, y + 170, (bw * clamp(rr6 / 14)) * easeOut((age - 500) / 900), 16, 8);
        ctx.fillStyle = col;
        ctx.fill();
      }),
    );
  });
};

const boundaryTracker: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  const inn = cur(m);
  if (!m || !inn) return empty(rc, 'Boundary tracker appears once the innings starts');
  sceneTitle(rc, 'Boundary Tracker', inn.teamName);
  const fours = inn.batting.reduce((a, b) => a + b.fours, 0);
  const sixes = inn.batting.reduce((a, b) => a + b.sixes, 0);
  const bRuns = fours * 4 + sixes * 6;
  const pct = inn.runs ? Math.round((bRuns / inn.runs) * 100) : 0;
  const balls = m.recentBalls.filter((b) => b.innings === inn.number);
  const legal = balls.filter((b) => b.type !== 'wide' && b.type !== 'noball');
  const dots = legal.filter((b) => b.type === 'dot').length;
  const dotPct = legal.length ? Math.round((dots / legal.length) * 100) : 0;
  const count = (v: number) => Math.round(v * easeOut((age - 200) / 1200));
  const tiles: [string, string, string][] = [
    ['FOURS', String(count(fours)), COL.gblue],
    ['SIXES', String(count(sixes)), COL.purple],
    ['BOUNDARY RUNS', `${count(bRuns)}`, COL.green],
    ['DOT BALLS (recent)', `${count(dotPct)}%`, '#e37400'],
  ];
  tiles.forEach(([k, v, c], i) =>
    fx(ctx, enter(age, 1 + i, 90), () => {
      const x = 140 + i * 420;
      card(ctx, x, 220, 390, 270, { fill: hexA(c, 0.16), r: 30, stroke: hexA(c, 0.5) });
      text(ctx, k, x + 34, 280, { size: 22, weight: 800, color: COL.sub, spacing: 2 });
      text(ctx, v, x + 34, 420, { size: 120, weight: 800, font: 'cond', color: '#fff' });
    }),
  );
  fx(ctx, enter(age, 6), () => {
    card(ctx, 140, 540, W - 280, 160, { fill: COL.card, r: 28 });
    text(ctx, 'RUNS FROM BOUNDARIES', 180, 600, { size: 22, weight: 800, color: COL.sub, spacing: 2 });
    const bw = W - 360;
    rr(ctx, 180, 625, bw, 44, 22);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fill();
    rr(ctx, 180, 625, (bw * pct) / 100 * easeOut((age - 500) / 1000), 44, 22);
    ctx.fillStyle = COL.green;
    ctx.fill();
    text(ctx, `${pct}% of ${inn.runs}`, W - 180, 600, { size: 30, weight: 800, align: 'right' });
  });
  const recent = balls.filter((b) => b.type === 'four' || b.type === 'six').slice(-9);
  fx(ctx, enter(age, 7), () => {
    text(ctx, 'LATEST BOUNDARIES', 160, 780, { size: 22, weight: 800, color: COL.sub, spacing: 2 });
    recent.forEach((b, i) => {
      ballChip(ctx, b.label, 200 + i * 190, 850, 34);
      text(ctx, (b.batsman?.name ?? '').split(' ').at(-1) ?? '', 245 + i * 190, 860, { size: 22, weight: 600, max: 130 });
    });
    if (!recent.length) text(ctx, 'None in the recent overs', 160, 860, { size: 28, color: COL.dim });
  });
};

const matchup: SceneFn = (rc) => {
  const { ctx, age, match: m, now } = rc;
  background(rc, COL.red);
  const striker = m?.currentBatters[0];
  const bowler = m?.currentBowler;
  if (!m || !striker || !bowler) return empty(rc, 'Waiting for the next delivery');
  sceneTitle(rc, 'Batter vs Bowler', 'head to head in this match');
  const faced: Ball[] = m.recentBalls.filter((b) => b.batsman?.id === striker.id && b.bowler?.id === bowler.id);
  const legal = faced.filter((b) => b.type !== 'wide' && b.type !== 'noball');
  const runs = faced.reduce((a, b) => a + b.batRuns, 0);
  const stats: [string, string][] = [
    ['Balls', String(legal.length)],
    ['Runs', String(runs)],
    ['Dots', String(legal.filter((b) => b.type === 'dot').length)],
    ['4s / 6s', `${faced.filter((b) => b.type === 'four').length} / ${faced.filter((b) => b.type === 'six').length}`],
  ];
  fx(ctx, enter(age, 1, 0, 600), () => {
    card(ctx, 140, 220, 620, 640, { fill: hexA(COL.gblue, 0.16), r: 32 });
    headshot(rc, striker.name, striker.headshot, 450, 380, 120, COL.gblue);
    text(ctx, striker.name, 450, 560, { size: 42, weight: 700, align: 'center', max: 560 });
    text(ctx, `${striker.runs} (${striker.balls})`, 450, 660, { size: 90, weight: 800, align: 'center', font: 'cond' });
    text(ctx, `SR ${striker.sr.toFixed(1)}`, 450, 720, { size: 30, color: COL.sub, align: 'center' });
  }, 0, -80);
  fx(ctx, enter(age, 2, 0, 600), () => {
    card(ctx, W - 760, 220, 620, 640, { fill: hexA(COL.purple, 0.16), r: 32 });
    headshot(rc, bowler.name, bowler.headshot, W - 450, 380, 120, COL.purple);
    text(ctx, bowler.name, W - 450, 560, { size: 42, weight: 700, align: 'center', max: 560 });
    text(ctx, `${bowler.wickets}-${bowler.conceded}`, W - 450, 660, { size: 90, weight: 800, align: 'center', font: 'cond' });
    text(ctx, `${fmtOvers(bowler.overs)} ov · econ ${bowler.econ.toFixed(2)}`, W - 450, 720, { size: 30, color: COL.sub, align: 'center' });
  }, 0, 80);
  // VS with lightning pulse
  fx(ctx, enter(age, 3), () => {
    const pulse = 1 + 0.06 * Math.sin(now / 180);
    ctx.save();
    ctx.translate(W / 2, 420);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = COL.yellow;
    ctx.shadowBlur = 50;
    text(ctx, 'VS', 0, 40, { size: 130, weight: 900, align: 'center', font: 'cond', color: COL.yellow });
    ctx.restore();
    stats.forEach(([k, v], i) => {
      const y = 560 + i * 78;
      text(ctx, v, W / 2, y + 20, { size: 48, weight: 800, align: 'center', font: 'cond' });
      text(ctx, k.toUpperCase(), W / 2, y + 48, { size: 18, weight: 700, color: COL.sub, align: 'center', spacing: 2 });
    });
  });
};

const wagonWheel: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc, COL.green);
  const inn = cur(m);
  const pickBatter = (): BatterLine | undefined => {
    const s = m?.currentBatters[0];
    const full = s && inn?.batting.find((b) => b.id === s.id);
    if (full?.wagon?.some((x) => x > 0)) return full;
    return inn?.batting.filter((b) => b.wagon?.some((x) => x > 0)).sort((a, b) => b.runs - a.runs)[0];
  };
  const b = pickBatter();
  if (!m || !b || !b.wagon) return empty(rc, 'Wagon wheel data not available for this match yet');
  sceneTitle(rc, 'Wagon Wheel', `${b.name} · ${b.runs} (${b.balls})`);
  const cx = 700,
    cy = 590,
    R = 360;
  fx(ctx, enter(age, 1, 0, 600), () => {
    // field
    const g = ctx.createRadialGradient(cx, cy, 40, cx, cy, R + 40);
    g.addColorStop(0, '#2f8f46');
    g.addColorStop(1, '#14532d');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R + 30, R, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 0.55, R * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#d6c08c';
    ctx.fillRect(cx - 14, cy - 60, 28, 120);
  });
  const total = Math.max(1, ...b.wagon);
  const labels = ['Fine leg', 'Square leg', 'Mid-wicket', 'Long-on', 'Long-off', 'Cover', 'Point', 'Third man'];
  b.wagon.forEach((runs, i) => {
    // zone 0 = fine leg (behind square on leg side), clockwise for a right-hander
    const ang = Math.PI / 2 + (i + 0.5) * (Math.PI / 4);
    const p = easeOut((age - 400 - i * 120) / 700);
    const len = (0.25 + 0.75 * (runs / total)) * R * p;
    fx(ctx, p, () => {
      ctx.strokeStyle = runs >= total * 0.6 ? COL.yellow : runs ? '#fff' : 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 3 + (runs / total) * 12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * len * 1.08, cy - Math.sin(ang) * len);
      ctx.stroke();
      const lx = cx + Math.cos(ang) * (R + 80);
      const ly = cy - Math.sin(ang) * (R + 50);
      text(ctx, String(runs), lx, ly, { size: 36, weight: 800, align: 'center', font: 'cond' });
      text(ctx, labels[i], lx, ly + 28, { size: 18, color: COL.sub, align: 'center' });
    }, 0);
  });
  fx(ctx, enter(age, 4), () => {
    const x = 1240;
    card(ctx, x, 230, 540, 640, { fill: COL.card, r: 30 });
    headshot(rc, b.name, b.headshot, x + 270, 360, 90, rc.accent);
    text(ctx, b.name, x + 270, 500, { size: 36, weight: 700, align: 'center', max: 480 });
    const rows: [string, string][] = [
      ['Strike rate', b.sr.toFixed(1)],
      ['4s / 6s', `${b.fours} / ${b.sixes}`],
      ['Dot-ball %', b.dotPct !== undefined ? `${b.dotPct}%` : '–'],
      ['Control %', b.control !== undefined ? `${b.control}%` : '–'],
      ['Favourite shot', b.preferredShot ?? '–'],
    ];
    rows.forEach(([k, v], i) => {
      text(ctx, k, x + 40, 570 + i * 58, { size: 26, color: COL.sub });
      text(ctx, v, x + 500, 570 + i * 58, { size: 28, weight: 700, align: 'right', max: 240 });
    });
  });
};

const starPerformer: SceneFn = (rc) => {
  const { ctx, age, match: m, now } = rc;
  background(rc, COL.gold);
  if (!m) return empty(rc, 'Select a match');
  const bats = m.innings.flatMap((i) => i.batting.map((b) => ({ b, team: m.teams.find((t) => t.id === i.teamId) })));
  const bowls = m.innings.flatMap((i) => i.bowling.map((b) => ({ b, team: m.teams.find((t) => t.id !== i.teamId) })));
  const topBat = bats.sort((a, b) => b.b.runs + b.b.sr / 10 - (a.b.runs + a.b.sr / 10))[0];
  const topBowl = bowls.sort((a, b) => b.b.wickets * 25 - b.b.econ - (a.b.wickets * 25 - a.b.econ))[0];
  const batScore = topBat ? topBat.b.runs + topBat.b.sr / 10 : 0;
  const bowlScore = topBowl ? topBowl.b.wickets * 25 - topBowl.b.econ : 0;
  if (!topBat && !topBowl) return empty(rc, 'Star performer appears once play is under way');
  sceneTitle(rc, 'Star Performer', 'standout player of the match so far');
  const isBat = batScore >= bowlScore;
  const name = isBat ? topBat!.b.name : topBowl!.b.name;
  const shot = isBat ? topBat!.b.headshot : topBowl!.b.headshot;
  const team = isBat ? topBat!.team : topBowl!.team;
  fx(ctx, enter(age, 1, 0, 700), () => {
    // rotating golden halo
    ctx.save();
    ctx.translate(560, 560);
    ctx.rotate(now / 3000);
    for (let i = 0; i < 16; i++) {
      ctx.rotate((Math.PI * 2) / 16);
      ctx.fillStyle = hexA(COL.gold, i % 2 ? 0.12 : 0.05);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(420, -40);
      ctx.lineTo(420, 40);
      ctx.fill();
    }
    ctx.restore();
    headshot(rc, name, shot, 560, 560, 210, COL.gold);
    teamBadge(rc, team, 720, 720, 50);
  }, 0, 0);
  fx(ctx, enter(age, 2, 0, 600), () => {
    text(ctx, name, 920, 360, { size: 72, weight: 800, max: 900 });
    text(ctx, team?.name ?? '', 920, 410, { size: 32, color: COL.sub });
    if (isBat) {
      const b = topBat!.b;
      text(ctx, `${b.runs}`, 920, 580, { size: 180, weight: 800, font: 'cond', color: COL.gold });
      text(ctx, `off ${b.balls} balls`, 920 + measure(ctx, `${b.runs}`, { size: 180, weight: 800, font: 'cond' }) + 20, 580, { size: 40, color: COL.sub });
      const rows: [string, string][] = [
        ['Strike rate', b.sr.toFixed(1)],
        ['Fours', String(b.fours)],
        ['Sixes', String(b.sixes)],
      ];
      rows.forEach(([k, v], i) => {
        card(ctx, 920 + i * 290, 650, 270, 160, { fill: COL.card, r: 22 });
        text(ctx, k.toUpperCase(), 950 + i * 290, 700, { size: 20, weight: 700, color: COL.sub, spacing: 2 });
        text(ctx, v, 950 + i * 290, 780, { size: 64, weight: 800, font: 'cond' });
      });
    } else {
      const b = topBowl!.b;
      text(ctx, `${b.wickets}/${b.conceded}`, 920, 580, { size: 180, weight: 800, font: 'cond', color: COL.gold });
      const rows: [string, string][] = [
        ['Overs', fmtOvers(b.overs)],
        ['Economy', b.econ.toFixed(2)],
        ['Dots', String(b.dots)],
      ];
      rows.forEach(([k, v], i) => {
        card(ctx, 920 + i * 290, 650, 270, 160, { fill: COL.card, r: 22 });
        text(ctx, k.toUpperCase(), 950 + i * 290, 700, { size: 20, weight: 700, color: COL.sub, spacing: 2 });
        text(ctx, v, 950 + i * 290, 780, { size: 64, weight: 800, font: 'cond' });
      });
    }
  }, 0, 60);
};

const keyMoments: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  if (!m) return empty(rc, 'Select a match');
  sceneTitle(rc, 'Key Moments', 'the big plays so far');
  const moments = m.recentBalls.filter((b) => b.isWicket || b.type === 'six' || b.type === 'four').slice(-8).reverse();
  if (!moments.length) return empty(rc, 'No big moments yet — stay tuned!');
  fx(ctx, enter(age, 1), () => {
    ctx.fillStyle = hexA(rc.accent, 0.5);
    rr(ctx, 246, 220, 6, 740 * easeOut((age - 200) / 1000), 3);
    ctx.fill();
  });
  moments.forEach((b, i) =>
    fx(ctx, enter(age, 2 + i, 90), () => {
      const y = 230 + i * 92;
      ballChip(ctx, b.label, 249, y + 38, 30);
      card(ctx, 310, y, W - 450, 78, { fill: b.isWicket ? hexA(COL.red, 0.18) : COL.card, r: 18 });
      text(ctx, `${fmtOvers(b.over)}`, 340, y + 50, { size: 28, weight: 800, font: 'cond', color: COL.sub });
      text(ctx, b.isWicket ? `WICKET — ${b.dismissalText ?? b.short}` : b.short, 440, y + 50, { size: 30, weight: 600, max: W - 760 });
      text(ctx, `${b.battingTeamAbbr} ${b.inningsRuns}/${b.inningsWickets}`, W - 170, y + 50, { size: 28, weight: 700, align: 'right', font: 'cond' });
    }, 0, 30),
  );
};

const upcomingMatches: SceneFn = (rc) => {
  const { ctx, age } = rc;
  background(rc);
  const list = rc.matches.filter((x) => x.state === 'pre' && !x.isDemo).slice(0, 6);
  const fallback = list.length ? list : rc.matches.filter((x) => x.state === 'post' && !x.isDemo).slice(0, 6);
  sceneTitle(rc, list.length ? 'Coming Up' : 'Latest Results', list.length ? 'upcoming fixtures' : 'recent finishes');
  if (!fallback.length) return empty(rc, 'No fixtures available from ESPN right now');
  fallback.forEach((mm, i) =>
    fx(ctx, enter(age, 1 + i, 90), () => {
      const x = 140 + (i % 2) * 830;
      const y = 220 + Math.floor(i / 2) * 250;
      card(ctx, x, y, 800, 220, { fill: COL.card, r: 26 });
      text(ctx, mm.leagueName, x + 30, y + 46, { size: 22, weight: 600, color: COL.sub, max: 740 });
      mm.teams.slice(0, 2).forEach((t, ti) => {
        teamBadge(rc, { abbr: t.abbr, logo: t.logo }, x + 60, y + 92 + ti * 56, 22);
        text(ctx, t.name, x + 96, y + 102 + ti * 56, { size: 30, weight: 600, max: 480 });
        if (t.score) text(ctx, t.score, x + 770, y + 102 + ti * 56, { size: 28, weight: 700, align: 'right', font: 'cond', max: 220 });
      });
      const when = mm.state === 'pre' ? new Date(mm.startDate).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : mm.statusText;
      text(ctx, when, x + 30, y + 200, { size: 22, color: rc.accent, weight: 600, max: 740 });
    }),
  );
};

const fanPoll: SceneFn = (rc) => {
  const { ctx, age, match: m, now } = rc;
  background(rc, COL.purple);
  const q = rc.state.brand.pollQuestion || 'Who wins this match?';
  fx(ctx, enter(age, 0, 0, 600), () => {
    text(ctx, 'FAN POLL', W / 2, 200, { size: 34, weight: 800, align: 'center', color: rc.accent, spacing: 10 });
    text(ctx, q, W / 2, 300, { size: 64, weight: 800, align: 'center', max: 1700 });
  });
  const opts = m?.teams.length ? m.teams.slice(0, 2).map((t) => ({ label: t.name, abbr: t.abbr, logo: t.logo, color: teamColor(t) })) : [{ label: 'Option A', abbr: 'A', logo: undefined, color: COL.gblue }, { label: 'Option B', abbr: 'B', logo: undefined, color: COL.red }];
  opts.forEach((o, i) =>
    fx(ctx, enter(age, 1 + i, 140), () => {
      const x = i === 0 ? 240 : W / 2 + 60;
      const w = W / 2 - 300;
      const bob = Math.sin(now / 500 + i * 1.5) * 6;
      card(ctx, x, 400 + bob, w, 360, { fill: hexA(o.color, 0.2), r: 36, stroke: hexA(o.color, 0.7) });
      teamBadge(rc, { abbr: o.abbr, logo: o.logo }, x + w / 2, 520 + bob, 80);
      text(ctx, o.label, x + w / 2, 660 + bob, { size: 44, weight: 700, align: 'center', max: w - 60 });
      text(ctx, `Type ${i + 1} in the chat`, x + w / 2, 720 + bob, { size: 30, weight: 600, align: 'center', color: COL.sub });
    }),
  );
  fx(ctx, enter(age, 4), () => text(ctx, 'Results revealed at the end of the show!', W / 2, 860, { size: 30, color: COL.sub, align: 'center' }));
};

export const INSIGHT_SCENES: Partial<Record<SceneId, SceneFn>> = {
  winPredictor,
  projectedScore,
  phaseAnalysis,
  boundaryTracker,
  matchup,
  wagonWheel,
  starPerformer,
  keyMoments,
  upcomingMatches,
  fanPoll,
};
