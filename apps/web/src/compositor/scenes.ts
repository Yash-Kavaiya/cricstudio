// The 18 broadcast scenes. Each is a pure draw(rc) on the 1920x1080 canvas.
import { countdownTarget, type Innings, type MatchDetail, type SceneId } from '@cricstudio/shared';
import {
  background,
  ballChip,
  card,
  clamp,
  COL,
  drawImageCover,
  easeOut,
  enter,
  fmtOvers,
  fx,
  gridRects,
  H,
  headshot,
  hexA,
  ink,
  isVideoReady,
  measure,
  participantTile,
  rr,
  sceneTitle,
  teamBadge,
  teamColor,
  text,
  W,
  type RenderCtx,
} from './draw';
import { ANALYSIS_SCENES } from './analysis';
import { INSIGHT_SCENES } from './insights';

type SceneFn = (rc: RenderCtx) => void;

const curInnings = (m: MatchDetail | null): Innings | undefined =>
  m ? m.innings.find((i) => i.number === m.currentInnings) ?? m.innings.at(-1) : undefined;

function noMatch(rc: RenderCtx, what = 'Pick a match in the Match tab to light up this scene') {
  const { ctx } = rc;
  card(ctx, W / 2 - 520, H / 2 - 110, 1040, 220, { fill: COL.card });
  text(ctx, 'No live match selected', W / 2, H / 2 - 10, { size: 48, weight: 700, align: 'center' });
  text(ctx, what, W / 2, H / 2 + 50, { size: 28, color: COL.sub, align: 'center' });
}

/** Countdown / equaliser shared by show scenes */
function equaliser(rc: RenderCtx, x: number, y: number, w: number, h: number, bars = 28) {
  const { ctx, now } = rc;
  const bw = w / bars;
  for (let i = 0; i < bars; i++) {
    const v = 0.25 + 0.75 * Math.abs(Math.sin(now / 380 + i * 0.7) * Math.cos(now / 610 + i * 0.33));
    const bh = h * (rc.state.music.playing ? v : 0.08);
    ctx.fillStyle = hexA(i % 3 === 0 ? rc.accent : COL.ink, 0.55);
    rr(ctx, x + i * bw + 2, y + h - bh, bw - 4, bh, 3);
    ctx.fill();
  }
}

function matchCardBig(rc: RenderCtx, m: MatchDetail, x: number, y: number, w: number, p: number) {
  const { ctx } = rc;
  fx(ctx, p, () => {
    card(ctx, x, y, w, 300, { fill: COL.card, stroke: COL.line });
    const [a, b] = m.teams;
    teamBadge(rc, a, x + 150, y + 130, 80);
    teamBadge(rc, b, x + w - 150, y + 130, 80);
    text(ctx, a?.abbr ?? '', x + 150, y + 255, { size: 36, weight: 700, align: 'center', font: 'cond' });
    text(ctx, b?.abbr ?? '', x + w - 150, y + 255, { size: 36, weight: 700, align: 'center', font: 'cond' });
    text(ctx, 'VS', x + w / 2, y + 120, { size: 64, weight: 900, align: 'center', color: rc.accent, font: 'cond' });
    text(ctx, m.description, x + w / 2, y + 180, { size: 30, weight: 500, align: 'center', max: w - 420 });
    text(ctx, m.venue, x + w / 2, y + 222, { size: 24, color: COL.sub, align: 'center', max: w - 420 });
    text(ctx, m.series, x + w / 2, y + 258, { size: 22, color: COL.dim, align: 'center', max: w - 420 });
  });
}

/* 1 ─ Starting soon */
function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const startingSoon: SceneFn = (rc) => {
  const { ctx, age, now, state } = rc;
  background(rc);
  fx(ctx, enter(age, 0), () => {
    text(ctx, 'LIVE CRICKET', W / 2, 200, { size: 34, weight: 700, align: 'center', color: rc.accent, spacing: 10 });
    text(ctx, state.brand.title, W / 2, 300, { size: 92, weight: 900, align: 'center', max: 1600 });
  });
  if (rc.match) matchCardBig(rc, rc.match, W / 2 - 620, 380, 1240, enter(age, 1));
  const cd = countdownTarget(state, rc.match);
  const left = cd ? cd.at - Date.now() : 0;
  const y = rc.match ? 840 : 620;
  fx(ctx, enter(age, 2), () => {
    if (cd && left > 0) {
      const start = new Date(cd.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      text(ctx, cd.matchStart ? `FIRST BALL AT ${start.toUpperCase()}  ·  STARTS IN` : 'WE GO LIVE IN', W / 2, y - 112, { size: 28, weight: 700, align: 'center', color: rc.accent, spacing: 6 });
      // a gentle pulse on each second
      const pulse = 1 + 0.025 * Math.max(0, 1 - (left % 1000) / 250);
      ctx.save();
      ctx.translate(W / 2, y);
      ctx.scale(pulse, pulse);
      text(ctx, clock(left), 0, 0, { size: 130, weight: 800, align: 'center', font: 'cond' });
      ctx.restore();
      return;
    }
    const label = cd ? (cd.matchStart ? 'Toss & first ball coming up' : "We're on!") : 'Starting soon';
    text(ctx, label, W / 2, y, { size: 64, weight: 800, align: 'center', font: 'cond' });
    for (let i = 0; i < 3; i++) {
      const a = 0.3 + 0.7 * Math.abs(Math.sin(now / 400 - i * 0.6));
      ctx.beginPath();
      ctx.arc(W / 2 - 30 + i * 30, y + 46, 8, 0, Math.PI * 2);
      ctx.fillStyle = ink(a);
      ctx.fill();
    }
  });
  equaliser(rc, W / 2 - 300, rc.match ? 930 : 900, 600, rc.match ? 50 : 60);
};

/* 2 ─ Host solo */
const hostSolo: SceneFn = (rc) => {
  const { ctx, age } = rc;
  background(rc);
  const host = rc.stage.find((p) => p.role === 'host') ?? rc.stage[0];
  const s = 0.96 + 0.04 * easeOut(age / 600);
  ctx.save();
  ctx.translate(W / 2, 470);
  ctx.scale(s, s);
  ctx.translate(-W / 2, -470);
  if (host) participantTile(rc, host, 200, 60, 1520, 855, 28);
  else noMatch(rc, 'Host camera is not on stage');
  ctx.restore();
};

/* 3 ─ Expert panel (1–5 speakers) */
const panel: SceneFn = (rc) => {
  const { age } = rc;
  background(rc);
  const people = rc.stage;
  const spot = people.find((p) => p.id === rc.state.spotlightId);
  if (!people.length) return noMatch(rc, 'Add the host or guests to the stage');
  if (spot && people.length > 1) {
    const others = people.filter((p) => p !== spot);
    fx(rc.ctx, enter(age, 0), () => participantTile(rc, spot, 70, 60, 1370, 770, 28));
    const th = Math.min(250, (770 - 20 * (others.length - 1)) / others.length);
    others.forEach((p, i) =>
      fx(rc.ctx, enter(age, i + 1), () => participantTile(rc, p, 1470, 60 + i * (th + 20), th * (16 / 9) > 380 ? 380 : th * (16 / 9), th, 20), 0, 40),
    );
    return;
  }
  gridRects(people.length, 70, 50, W - 140, 800, 24).forEach((r, i) =>
    fx(rc.ctx, enter(age, i, 90), () => participantTile(rc, people[i], r.x, r.y, r.w, r.h, 26)),
  );
};

/* 4 ─ Live score hero */
const scoreHero: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc, m ? teamColor(m.teams.find((t) => t.id === m.battingTeamId)) : undefined);
  if (!m) return noMatch(rc);
  const inn = curInnings(m);
  const bat = m.teams.find((t) => t.id === inn?.teamId) ?? m.teams[0];
  const bowl = m.teams.find((t) => t.id !== bat?.id);
  fx(ctx, enter(age, 0), () => {
    text(ctx, `${m.description} · ${m.series}`, W / 2, 120, { size: 30, color: COL.sub, align: 'center', max: 1500 });
  });
  fx(ctx, enter(age, 1, 0, 600), () => {
    card(ctx, 160, 170, W - 320, 400, { fill: hexA(teamColor(bat), 0.2), stroke: hexA(teamColor(bat), 0.5), r: 36 });
    teamBadge(rc, bat, 330, 370, 110);
    text(ctx, bat?.name ?? '', 500, 290, { size: 44, weight: 600, max: 900 });
    const runs = `${inn?.runs ?? 0}/${inn?.wickets ?? 0}`;
    text(ctx, runs, 500, 455, { size: 190, weight: 800, font: 'cond' });
    const rw = measure(ctx, runs, { size: 190, weight: 800, font: 'cond' });
    text(ctx, `(${fmtOvers(inn?.overs ?? 0)} ov)`, 520 + rw, 450, { size: 54, weight: 500, color: COL.sub, font: 'cond' });
    const stats = [
      ['CRR', m.crr ? m.crr.toFixed(2) : '–'],
      ...(m.rrr !== null ? [['RRR', m.rrr.toFixed(2)]] : []),
      ...(inn?.target ? [['TARGET', String(inn.target)]] : []),
      ['P\'SHIP', `${m.partnership.runs} (${m.partnership.balls})`],
    ];
    stats.forEach(([k, v], i) => {
      const x = 500 + i * 250;
      text(ctx, k, x, 525, { size: 22, weight: 700, color: COL.sub, spacing: 2 });
      text(ctx, v, x, 560, { size: 34, weight: 700, font: 'cond' });
    });
    if (bowl) {
      const other = m.innings.filter((i) => i.teamId === bowl.id);
      teamBadge(rc, bowl, W - 330, 300, 56);
      text(ctx, bowl.abbr, W - 330, 395, { size: 30, weight: 700, align: 'center', font: 'cond' });
      text(ctx, other.map((i) => `${i.runs}/${i.wickets}`).join(' & ') || 'Yet to bat', W - 330, 440, { size: 34, weight: 600, align: 'center', font: 'cond', color: COL.sub });
    }
  });
  // chase equation bar
  if (m.need) {
    fx(ctx, enter(age, 2), () => {
      const n = m.need!;
      const total = (inn?.target ?? 1) || 1;
      card(ctx, 160, 600, W - 320, 110, { fill: COL.card, r: 24 });
      text(ctx, `${bat?.abbr} need ${n.runs} runs from ${n.balls} balls`, 200, 668, { size: 42, weight: 700 });
      const pw = 620;
      const px = W - 200 - pw;
      rr(ctx, px, 640, pw, 30, 15);
      ctx.fillStyle = ink(0.12);
      ctx.fill();
      rr(ctx, px, 640, pw * clamp(((inn?.runs ?? 0) / total) * easeOut(age / 1200)), 30, 15);
      ctx.fillStyle = COL.green;
      ctx.fill();
    });
  } else if (m.summary) {
    fx(ctx, enter(age, 2), () => {
      card(ctx, 160, 600, W - 320, 110, { fill: COL.card, r: 24 });
      text(ctx, m.summary, W / 2, 668, { size: 40, weight: 600, align: 'center', max: W - 400 });
    });
  }
  // last balls
  const recent = m.recentBalls.filter((b) => b.innings === inn?.number).slice(-12);
  fx(ctx, enter(age, 3), () => {
    text(ctx, 'RECENT', 200, 800, { size: 24, weight: 700, color: COL.sub, spacing: 3 });
    recent.forEach((b, i) => ballChip(ctx, b.label, 360 + i * 92, 790, 36, enter(age, 4 + i, 40, 400)));
  });
  // batters + bowler strip
  fx(ctx, enter(age, 4), () => {
    const y = 880;
    m.currentBatters.slice(0, 2).forEach((b, i) => {
      const x = 160 + i * 540;
      card(ctx, x, y, 520, 90, { fill: COL.card, r: 18 });
      text(ctx, `${b.name}${i === 0 ? ' *' : ''}`, x + 28, y + 56, { size: 32, weight: 600, max: 300 });
      text(ctx, `${b.runs} (${b.balls})`, x + 492, y + 58, { size: 38, weight: 800, align: 'right', font: 'cond' });
    });
    const bw = m.currentBowler;
    if (bw) {
      const x = 1240;
      card(ctx, x, y, 520, 90, { fill: COL.card, r: 18 });
      text(ctx, bw.name, x + 28, y + 56, { size: 32, weight: 600, max: 280 });
      text(ctx, `${bw.wickets}-${bw.conceded} (${fmtOvers(bw.overs)})`, x + 492, y + 58, { size: 36, weight: 800, align: 'right', font: 'cond' });
    }
  });
};

/* 5 ─ Ball by ball */
const ballByBall: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  if (!m) return noMatch(rc);
  const inn = curInnings(m);
  sceneTitle(rc, 'Ball by Ball', inn ? `${inn.teamName} ${inn.runs}/${inn.wickets} (${fmtOvers(inn.overs)})` : '');
  const balls = m.recentBalls.filter((b) => b.innings === inn?.number);
  const overs = [...new Set(balls.map((b) => b.overNumber))].slice(-5).reverse();
  const cur = overs[0];
  const curBalls = balls.filter((b) => b.overNumber === cur);
  // this over — big chips
  fx(ctx, enter(age, 1), () => {
    card(ctx, 120, 200, 1000, 300, { fill: COL.card, r: 28 });
    text(ctx, `THIS OVER · ${cur ?? '-'}`, 160, 260, { size: 26, weight: 700, color: COL.sub, spacing: 3 });
    const bowler = curBalls.at(-1)?.bowler;
    if (bowler) text(ctx, bowler.name, 1080, 260, { size: 28, weight: 500, align: 'right', color: COL.sub, max: 400 });
    curBalls.slice(0, 10).forEach((b, i) => ballChip(ctx, b.label, 210 + i * 108, 375, 46, enter(age, 2 + i, 70, 450)));
    const runs = curBalls.reduce((a, b) => a + b.runs, 0);
    text(ctx, `${runs} run${runs === 1 ? '' : 's'}`, 160, 470, { size: 34, weight: 700, font: 'cond' });
  });
  // previous overs
  overs.slice(1).forEach((o, i) =>
    fx(ctx, enter(age, 3 + i), () => {
      const y = 530 + i * 105;
      const ob = balls.filter((b) => b.overNumber === o);
      card(ctx, 120, y, 1000, 90, { fill: ink(0.04), r: 18 });
      text(ctx, `Ov ${o}`, 150, y + 56, { size: 30, weight: 700, font: 'cond', color: COL.sub });
      ob.slice(0, 10).forEach((b, j) => ballChip(ctx, b.label, 290 + j * 70, y + 45, 26));
      text(ctx, `${ob.at(-1)?.overRuns ?? ob.reduce((a, b) => a + b.runs, 0)}`, 1085, y + 58, { size: 36, weight: 800, align: 'right', font: 'cond' });
    }),
  );
  // commentary feed
  const feed = balls.slice(-5).reverse();
  fx(ctx, enter(age, 2), () => {
    card(ctx, 1160, 200, 640, 760, { fill: COL.card, r: 28 });
    text(ctx, 'COMMENTARY', 1200, 260, { size: 26, weight: 700, color: COL.sub, spacing: 3 });
  });
  feed.forEach((b, i) =>
    fx(ctx, enter(age, 3 + i), () => {
      const y = 300 + i * 132;
      ballChip(ctx, b.label, 1225, y + 34, 26);
      text(ctx, fmtOvers(b.over), 1270, y + 24, { size: 22, weight: 700, color: COL.sub, font: 'cond' });
      text(ctx, b.short, 1270, y + 56, { size: 26, weight: 600, max: 500 });
      wrap(rc, b.text || (b.dismissalText ?? ''), 1270, y + 92, 500, 22, 2, COL.sub);
    }, 20, 30),
  );
};

function wrap(rc: RenderCtx, s: string, x: number, y: number, maxW: number, size: number, lines: number, color: string) {
  const { ctx } = rc;
  ctx.font = `400 ${size}px Roboto, sans-serif`;
  const words = s.split(/\s+/);
  let line = '';
  let n = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      text(ctx, n === lines - 1 ? `${line}…` : line, x, y + n * size * 1.3, { size, weight: 400, color });
      n++;
      line = w;
      if (n >= lines) return;
    } else line = test;
  }
  if (line && n < lines) text(ctx, line, x, y + n * size * 1.3, { size, weight: 400, color });
}

/* 6 ─ Batting scorecard */
const battingCard: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  if (!m) return noMatch(rc);
  const inn = curInnings(m);
  if (!inn) return noMatch(rc, 'Innings has not started yet');
  sceneTitle(rc, 'Batting', `${inn.teamName} · ${inn.runs}/${inn.wickets} (${fmtOvers(inn.overs)} ov)`);
  const cols = [
    ['R', 1180],
    ['B', 1300],
    ['4s', 1410],
    ['6s', 1510],
    ['SR', 1660],
  ] as const;
  fx(ctx, enter(age, 1), () => {
    card(ctx, 120, 190, W - 240, 780, { fill: COL.card, r: 28 });
    text(ctx, 'BATTER', 170, 245, { size: 22, weight: 700, color: COL.sub, spacing: 2 });
    cols.forEach(([k, x]) => text(ctx, k, x, 245, { size: 22, weight: 700, color: COL.sub, align: 'right' }));
  });
  const rows = inn.batting.slice(0, 11);
  const rh = Math.min(58, 610 / Math.max(rows.length, 1));
  rows.forEach((b, i) =>
    fx(ctx, enter(age, 2 + i, 55), () => {
      const y = 270 + i * rh;
      const live = b.notOut;
      if (live) {
        rr(ctx, 140, y, W - 280, rh - 6, 12);
        ctx.fillStyle = hexA(rc.accent, 0.18);
        ctx.fill();
      }
      text(ctx, b.name + (live ? ' *' : ''), 170, y + rh * 0.62, { size: rh * 0.5, weight: live ? 700 : 500, max: 440 });
      text(ctx, b.dismissal, 640, y + rh * 0.62, { size: rh * 0.4, weight: 400, color: live ? COL.green : COL.sub, max: 440 });
      const vals = [b.runs, b.balls, b.fours, b.sixes, b.sr.toFixed(1)];
      vals.forEach((v, j) => text(ctx, String(v), cols[j][1], y + rh * 0.64, { size: rh * 0.52, weight: j === 0 ? 800 : 500, align: 'right', font: 'cond' }));
    }, 0, -30),
  );
  fx(ctx, enter(age, 14), () => {
    const y = 905;
    ctx.fillStyle = COL.line;
    ctx.fillRect(160, y - 30, W - 320, 2);
    const e = inn.extras;
    text(ctx, `Extras ${e.total}  (wd ${e.wides}, nb ${e.noballs}, b ${e.byes}, lb ${e.legbyes})`, 170, y + 20, { size: 28, color: COL.sub });
    text(ctx, `TOTAL  ${inn.runs}/${inn.wickets}  (${fmtOvers(inn.overs)} ov)`, W - 170, y + 22, { size: 36, weight: 800, align: 'right', font: 'cond' });
  });
};

/* 7 ─ Bowling figures */
const bowlingCard: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  if (!m) return noMatch(rc);
  const inn = curInnings(m);
  if (!inn) return noMatch(rc, 'Innings has not started yet');
  const bowlTeam = m.teams.find((t) => t.id !== inn.teamId);
  sceneTitle(rc, 'Bowling', `${bowlTeam?.name ?? ''} in the field`);
  const cols = [
    ['O', 1000],
    ['M', 1120],
    ['R', 1240],
    ['W', 1360],
    ['ECON', 1520],
    ['WD/NB', 1700],
  ] as const;
  fx(ctx, enter(age, 1), () => {
    card(ctx, 120, 190, W - 240, 780, { fill: COL.card, r: 28 });
    text(ctx, 'BOWLER', 170, 245, { size: 22, weight: 700, color: COL.sub, spacing: 2 });
    cols.forEach(([k, x]) => text(ctx, k, x, 245, { size: 22, weight: 700, color: COL.sub, align: 'right' }));
  });
  const curId = m.currentBowler?.id;
  inn.bowling.slice(0, 10).forEach((b, i) =>
    fx(ctx, enter(age, 2 + i, 60), () => {
      const y = 275 + i * 66;
      if (b.id === curId) {
        rr(ctx, 140, y, W - 280, 58, 12);
        ctx.fillStyle = hexA(rc.accent, 0.18);
        ctx.fill();
      }
      headshot(rc, b.name, b.headshot, 200, y + 29, 24);
      text(ctx, b.name, 245, y + 40, { size: 32, weight: b.id === curId ? 700 : 500, max: 600 });
      const vals = [fmtOvers(b.overs), b.maidens, b.conceded, b.wickets, b.econ.toFixed(2), `${b.wides}/${b.noballs}`];
      vals.forEach((v, j) =>
        text(ctx, String(v), cols[j][1], y + 41, { size: 34, weight: j === 3 ? 800 : 500, align: 'right', font: 'cond', color: j === 3 && b.wickets > 0 ? COL.gold : COL.text }),
      );
    }, 0, -30),
  );
};

/* 8 ─ At the crease / partnership */
const batters: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  if (!m) return noMatch(rc);
  const inn = curInnings(m);
  sceneTitle(rc, 'At the Crease', inn ? `${inn.teamName} ${inn.runs}/${inn.wickets}` : '');
  const bs = m.currentBatters.slice(0, 2);
  bs.forEach((b, i) =>
    fx(ctx, enter(age, 1 + i, 120, 600), () => {
      const x = i === 0 ? 140 : W - 140 - 720;
      card(ctx, x, 200, 720, 560, { fill: COL.card, r: 32, stroke: i === 0 ? hexA(rc.accent, 0.6) : undefined });
      headshot(rc, b.name, b.headshot, x + 360, 340, 100, i === 0 ? rc.accent : ink(0.2));
      text(ctx, b.name + (i === 0 ? ' *' : ''), x + 360, 505, { size: 44, weight: 700, align: 'center', max: 660 });
      text(ctx, String(b.runs), x + 360, 625, { size: 120, weight: 800, align: 'center', font: 'cond' });
      text(ctx, `${b.balls} balls`, x + 360, 670, { size: 28, color: COL.sub, align: 'center' });
      const st = [
        ['4s', b.fours],
        ['6s', b.sixes],
        ['SR', b.sr.toFixed(1)],
      ];
      st.forEach(([k, v], j) => {
        const sx = x + 160 + j * 200;
        text(ctx, String(v), sx, 730, { size: 36, weight: 700, align: 'center', font: 'cond' });
        text(ctx, String(k), sx, 752, { size: 18, weight: 700, color: COL.sub, align: 'center' });
      });
    }, 30, i === 0 ? -60 : 60),
  );
  fx(ctx, enter(age, 3), () => {
    const p = m.partnership;
    card(ctx, W / 2 - 300, 800, 600, 150, { fill: hexA(rc.accent, 0.25), r: 28, stroke: hexA(rc.accent, 0.6) });
    text(ctx, 'PARTNERSHIP', W / 2, 850, { size: 24, weight: 700, color: COL.sub, align: 'center', spacing: 3 });
    text(ctx, `${p.runs} runs · ${p.balls} balls`, W / 2, 912, { size: 52, weight: 800, align: 'center', font: 'cond' });
  });
  if (!bs.length) noMatch(rc, 'Waiting for batters');
};

/* 9 ─ Bowler spotlight */
const bowlerSpotlight: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc, COL.purple);
  if (!m) return noMatch(rc);
  const b = m.currentBowler;
  if (!b) return noMatch(rc, 'Waiting for the bowler');
  sceneTitle(rc, 'Bowler Spotlight');
  fx(ctx, enter(age, 1, 0, 600), () => {
    card(ctx, 140, 200, 700, 760, { fill: COL.card, r: 32 });
    headshot(rc, b.name, b.headshot, 490, 400, 140, COL.purple);
    text(ctx, b.name, 490, 610, { size: 50, weight: 700, align: 'center', max: 640 });
    const team = m.teams.find((t) => t.id !== m.battingTeamId);
    text(ctx, team?.name ?? '', 490, 660, { size: 28, color: COL.sub, align: 'center' });
    text(ctx, `${b.wickets}-${b.conceded}`, 490, 830, { size: 150, weight: 800, align: 'center', font: 'cond' });
    text(ctx, `${fmtOvers(b.overs)} overs`, 490, 890, { size: 32, color: COL.sub, align: 'center' });
  }, 0, -60);
  const stats = [
    ['Economy', b.econ.toFixed(2)],
    ['Maidens', String(b.maidens)],
    ['Dot balls', String(b.dots)],
    ['Wides / No-balls', `${b.wides} / ${b.noballs}`],
  ];
  stats.forEach(([k, v], i) =>
    fx(ctx, enter(age, 2 + i), () => {
      const x = 900 + (i % 2) * 440;
      const y = 200 + Math.floor(i / 2) * 200;
      card(ctx, x, y, 410, 170, { fill: COL.card, r: 24 });
      text(ctx, k.toUpperCase(), x + 32, y + 56, { size: 22, weight: 700, color: COL.sub, spacing: 2 });
      text(ctx, v, x + 32, y + 136, { size: 70, weight: 800, font: 'cond' });
    }),
  );
  const inn = curInnings(m);
  const mine = m.recentBalls.filter((x) => x.innings === inn?.number && x.bowler?.id === b.id);
  const lastOver = mine.at(-1)?.overNumber;
  const ob = mine.filter((x) => x.overNumber === lastOver);
  fx(ctx, enter(age, 6), () => {
    card(ctx, 900, 600, 850, 360, { fill: COL.card, r: 24 });
    text(ctx, `CURRENT / LAST OVER${lastOver ? ` (${lastOver})` : ''}`, 940, 660, { size: 22, weight: 700, color: COL.sub, spacing: 2 });
    ob.slice(0, 8).forEach((x, i) => ballChip(ctx, x.label, 980 + i * 98, 760, 40, enter(age, 7 + i, 60, 400)));
    const wk = mine.filter((x) => x.isWicket).slice(-2);
    wk.forEach((x, i) => text(ctx, `W · ${x.dismissalText ?? x.short}`, 940, 870 + i * 40, { size: 24, color: COL.sub, max: 780 }));
  });
};

/* 10 ─ Manhattan */
const manhattan: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  if (!m) return noMatch(rc);
  const inn = curInnings(m);
  sceneTitle(rc, 'Manhattan', inn ? `${inn.teamName} · runs per over` : '');
  const series = m.innings.filter((i) => i.overSummaries.length);
  const maxOver = Math.max(20, ...series.flatMap((i) => i.overSummaries.map((o) => o.over)));
  const maxRuns = Math.max(12, ...series.flatMap((i) => i.overSummaries.map((o) => o.runs)));
  const x0 = 200,
    y0 = 900,
    cw = W - 360,
    ch = 640;
  fx(ctx, enter(age, 1), () => {
    card(ctx, 120, 190, W - 240, 790, { fill: COL.card, r: 28 });
    for (let r = 0; r <= maxRuns; r += maxRuns > 20 ? 5 : 4) {
      const y = y0 - (r / maxRuns) * ch;
      ctx.fillStyle = COL.line;
      ctx.fillRect(x0, y, cw, 1);
      text(ctx, String(r), x0 - 16, y + 8, { size: 20, color: COL.dim, align: 'right' });
    }
  });
  const groups = series.slice(-2);
  const slot = cw / maxOver;
  const bw = (slot * 0.8) / groups.length;
  groups.forEach((inn2, gi) => {
    const team = m.teams.find((t) => t.id === inn2.teamId);
    const col = gi === groups.length - 1 ? rc.accent : teamColor(team);
    inn2.overSummaries.forEach((o) => {
      const p = enter(age, o.over, 25, 500, 300);
      const h = (o.runs / maxRuns) * ch * p;
      const x = x0 + (o.over - 1) * slot + slot * 0.1 + gi * bw;
      rr(ctx, x, y0 - h, bw - 3, h, 6);
      ctx.fillStyle = gi === groups.length - 1 ? col : hexA(col, 0.45);
      ctx.fill();
      for (let w = 0; w < o.wickets; w++) {
        ctx.beginPath();
        ctx.arc(x + (bw - 3) / 2, y0 - h - 16 - w * 26, 10, 0, Math.PI * 2);
        ctx.fillStyle = COL.red;
        ctx.fill();
      }
    });
    text(ctx, `${team?.abbr ?? ''} ${inn2.runs}/${inn2.wickets}`, x0 + 20 + gi * 260, 250, { size: 28, weight: 700, color: col });
  });
  for (let o = 1; o <= maxOver; o += maxOver > 30 ? 5 : 1) text(ctx, String(o), x0 + (o - 0.5) * slot, y0 + 34, { size: 20, color: COL.dim, align: 'center' });
};

/* 11 ─ Worm */
const worm: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  if (!m) return noMatch(rc);
  sceneTitle(rc, 'Worm', 'cumulative runs by over');
  const series = m.innings.filter((i) => i.overSummaries.length).slice(-2);
  const maxOver = Math.max(20, ...series.flatMap((i) => i.overSummaries.map((o) => o.over)));
  const maxRuns = Math.max(100, ...series.flatMap((i) => i.overSummaries.map((o) => o.cumulative)), ...series.map((i) => i.target));
  const x0 = 220,
    y0 = 900,
    cw = W - 380,
    ch = 620;
  fx(ctx, enter(age, 1), () => {
    card(ctx, 120, 190, W - 240, 790, { fill: COL.card, r: 28 });
    const step = maxRuns > 300 ? 100 : 50;
    for (let r = 0; r <= maxRuns; r += step) {
      const y = y0 - (r / maxRuns) * ch;
      ctx.fillStyle = COL.line;
      ctx.fillRect(x0, y, cw, 1);
      text(ctx, String(r), x0 - 16, y + 8, { size: 20, color: COL.dim, align: 'right' });
    }
  });
  const p = easeOut((age - 300) / 1600);
  series.forEach((inn, gi) => {
    const team = m.teams.find((t) => t.id === inn.teamId);
    const col = gi === series.length - 1 ? rc.accent : teamColor(team);
    const pts = [{ x: x0, y: y0 }, ...inn.overSummaries.map((o) => ({ x: x0 + (o.over / maxOver) * cw, y: y0 - (o.cumulative / maxRuns) * ch }))];
    const n = Math.max(2, Math.ceil(pts.length * p));
    ctx.save();
    ctx.beginPath();
    pts.slice(0, n).forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.strokeStyle = col;
    ctx.lineWidth = 7;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
    inn.overSummaries.slice(0, n - 1).forEach((o) => {
      if (!o.wickets) return;
      const x = x0 + (o.over / maxOver) * cw;
      const y = y0 - (o.cumulative / maxRuns) * ch;
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fillStyle = COL.red;
      ctx.fill();
    });
    text(ctx, `${team?.abbr ?? ''} ${inn.runs}/${inn.wickets}`, x0 + 20 + gi * 260, 250, { size: 28, weight: 700, color: col });
  });
};

/* 12 ─ Fall of wickets */
const fallOfWickets: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc, COL.red);
  if (!m) return noMatch(rc);
  const inn = curInnings(m);
  if (!inn) return noMatch(rc);
  sceneTitle(rc, 'Fall of Wickets', `${inn.teamName} ${inn.runs}/${inn.wickets}`);
  const fow = inn.fow;
  fx(ctx, enter(age, 1), () => {
    card(ctx, 120, 200, W - 240, 340, { fill: COL.card, r: 28 });
    const x0 = 200,
      x1 = W - 200,
      y = 380;
    ctx.fillStyle = ink(0.15);
    rr(ctx, x0, y - 6, x1 - x0, 12, 6);
    ctx.fill();
    const total = Math.max(inn.runs, 1);
    rr(ctx, x0, y - 6, (x1 - x0) * easeOut(age / 1200), 12, 6);
    ctx.fillStyle = hexA(rc.accent, 0.8);
    ctx.fill();
    fow.forEach((f, i) => {
      const x = x0 + (f.runs / total) * (x1 - x0);
      const p = enter(age, 2 + i, 90, 450);
      ballChip(ctx, String(f.wicket), x, y, 30, p);
      fx(ctx, p, () => {
        text(ctx, `${f.runs}`, x, i % 2 ? y + 80 : y - 60, { size: 30, weight: 800, align: 'center', font: 'cond' });
        text(ctx, f.batter.split(' ').at(-1) ?? '', x, i % 2 ? y + 112 : y - 92, { size: 22, color: COL.sub, align: 'center' });
      });
    });
    if (!fow.length) text(ctx, 'No wickets yet', W / 2, 300, { size: 36, color: COL.sub, align: 'center' });
  });
  fow.slice(-6).forEach((f, i) =>
    fx(ctx, enter(age, 4 + i), () => {
      const x = 120 + (i % 3) * 570;
      const y = 580 + Math.floor(i / 3) * 170;
      card(ctx, x, y, 540, 150, { fill: COL.card, r: 22 });
      text(ctx, `${f.wicket}-${f.runs}`, x + 32, y + 82, { size: 56, weight: 800, font: 'cond', color: COL.red });
      text(ctx, f.batter, x + 200, y + 66, { size: 30, weight: 600, max: 320 });
      text(ctx, `${fmtOvers(f.over)} ov`, x + 200, y + 108, { size: 24, color: COL.sub });
    }),
  );
  fx(ctx, enter(age, 10), () => {
    const e = inn.extras;
    text(ctx, `Extras: ${e.total} · wides ${e.wides} · no-balls ${e.noballs} · byes ${e.byes} · leg-byes ${e.legbyes}`, W / 2, 955, {
      size: 28,
      color: COL.sub,
      align: 'center',
    });
  });
};

/* 13 ─ Playing XIs + toss */
const playingXI: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  if (!m) return noMatch(rc);
  sceneTitle(rc, 'Playing XIs', m.toss ? `Toss: ${m.toss}` : m.description);
  m.teams.slice(0, 2).forEach((t, ti) => {
    const x = ti === 0 ? 120 : W / 2 + 20;
    const w = W / 2 - 140;
    fx(ctx, enter(age, 1 + ti, 120), () => {
      card(ctx, x, 190, w, 790, { fill: hexA(teamColor(t), 0.12), r: 28, stroke: hexA(teamColor(t), 0.4) });
      teamBadge(rc, t, x + 70, 260, 40);
      text(ctx, t.name, x + 130, 275, { size: 40, weight: 700, max: w - 160 });
    }, 30, ti ? 50 : -50);
    t.squad.slice(0, 11).forEach((p, i) =>
      fx(ctx, enter(age, 3 + i, 45), () => {
        const y = 340 + i * 57;
        text(ctx, String(i + 1), x + 60, y + 10, { size: 26, weight: 700, color: COL.dim, align: 'right', font: 'cond' });
        text(ctx, p.name + (p.captain ? ' (c)' : '') + (p.keeper ? ' †' : ''), x + 90, y + 10, { size: 32, weight: p.captain ? 700 : 500, max: w - 380 });
        text(ctx, p.role, x + w - 40, y + 10, { size: 22, color: COL.sub, align: 'right', max: 260 });
      }, 0, 20),
    );
    if (!t.squad.length) text(ctx, 'Squad to be announced', x + w / 2, 520, { size: 30, color: COL.sub, align: 'center' });
  });
};

/* 14 ─ Around the grounds */
const aroundGrounds: SceneFn = (rc) => {
  const { ctx, age, now } = rc;
  background(rc, COL.green);
  const list = rc.matches.filter((x) => !x.isDemo);
  const live = list.filter((x) => x.state === 'in');
  const pool = (live.length >= 4 ? live : list).slice(0, 24);
  const pages = Math.max(1, Math.ceil(pool.length / 6));
  const page = Math.floor(age / 9000) % pages;
  sceneTitle(rc, 'Around the Grounds', `${live.length} live · page ${page + 1}/${pages}`);
  const items = pool.slice(page * 6, page * 6 + 6);
  const pageAge = age % 9000;
  items.forEach((mm, i) => {
    const x = 120 + (i % 2) * 850;
    const y = 200 + Math.floor(i / 2) * 260;
    fx(ctx, enter(pageAge, i, 80) * (1 - easeOut((pageAge - 8500) / 400)), () => {
      card(ctx, x, y, 830, 240, { fill: COL.card, r: 24 });
      text(ctx, mm.leagueName, x + 30, y + 46, { size: 22, weight: 600, color: COL.sub, max: 560 });
      if (mm.state === 'in') {
        const pulse = 0.5 + 0.5 * Math.sin(now / 300);
        rr(ctx, x + 720, y + 22, 84, 34, 17);
        ctx.fillStyle = hexA(COL.red, 0.75 + 0.25 * pulse);
        ctx.fill();
        text(ctx, 'LIVE', x + 762, y + 46, { size: 20, weight: 800, align: 'center' });
      }
      mm.teams.slice(0, 2).forEach((t, ti) => {
        const ty = y + 100 + ti * 56;
        teamBadge(rc, { abbr: t.abbr, logo: t.logo }, x + 56, ty - 10, 22);
        text(ctx, t.name, x + 92, ty, { size: 30, weight: t.winner ? 700 : 500, max: 400 });
        text(ctx, t.score || '–', x + 800, ty, { size: 30, weight: 700, align: 'right', font: 'cond', max: 300 });
      });
      text(ctx, mm.statusText || mm.description, x + 30, y + 218, { size: 22, color: COL.sub, max: 770 });
    });
  });
  if (!items.length) noMatch(rc, 'No matches available from ESPN right now');
};

/* 15 ─ Commentary desk */
const commentaryDesk: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc);
  const people = rc.stage;
  gridRects(Math.max(people.length, 1), 60, 60, 1180, 860, 20).forEach((r, i) => {
    const p = people[i];
    if (p) fx(ctx, enter(age, i, 90), () => participantTile(rc, p, r.x, r.y, r.w, r.h, 22));
  });
  fx(ctx, enter(age, 1), () => {
    card(ctx, 1280, 60, 580, 860, { fill: COL.card, r: 28 });
    if (!m) {
      text(ctx, 'Select a match', 1570, 480, { size: 34, color: COL.sub, align: 'center' });
      return;
    }
    const inn = curInnings(m);
    const bat = m.teams.find((t) => t.id === inn?.teamId);
    teamBadge(rc, bat, 1350, 140, 40);
    text(ctx, `${inn?.runs ?? 0}/${inn?.wickets ?? 0}`, 1410, 162, { size: 72, weight: 800, font: 'cond' });
    text(ctx, `${bat?.abbr ?? ''} · ${fmtOvers(inn?.overs ?? 0)} ov · CRR ${m.crr.toFixed(2)}`, 1320, 220, { size: 26, color: COL.sub, max: 520 });
    if (m.need) text(ctx, `Need ${m.need.runs} off ${m.need.balls}`, 1320, 262, { size: 28, weight: 700, color: COL.yellow });
    const balls = m.recentBalls.filter((b) => b.innings === inn?.number).slice(-6);
    balls.forEach((b, i) => ballChip(ctx, b.label, 1345 + i * 86, 320, 30));
    m.recentBalls
      .slice(-5)
      .reverse()
      .forEach((b, i) => {
        const y = 400 + i * 102;
        ctx.fillStyle = COL.line;
        ctx.fillRect(1320, y - 20, 500, 1);
        text(ctx, `${fmtOvers(b.over)}  ${b.short}`, 1320, y + 14, { size: 24, weight: 600, max: 500 });
        wrap(rc, b.text, 1320, y + 48, 500, 20, 2, COL.sub);
      });
  }, 0, 40);
};

/* 16 ─ Screen share + PiP */
const screenShare: SceneFn = (rc) => {
  const { ctx, age } = rc;
  background(rc);
  const sharer = rc.state.participants.find((p) => p.screenSharing && isVideoReady(rc.videos.get(p.id)?.screen));
  const sv = sharer ? rc.videos.get(sharer.id)?.screen : undefined;
  fx(ctx, enter(age, 0), () => {
    card(ctx, 60, 50, 1440, 820, { fill: '#000', r: 22 });
    if (sv) drawImageCover(ctx, sv, 60, 50, 1440, 820, 22, false, true);
    else {
      text(ctx, 'Nobody is sharing a screen', 780, 450, { size: 44, weight: 600, align: 'center' });
      text(ctx, 'Click "Share screen" in the control bar (ideal for replays, analysis, polls).', 780, 510, { size: 26, color: COL.sub, align: 'center' });
    }
  });
  rc.stage.slice(0, 4).forEach((p, i) => fx(ctx, enter(age, 1 + i), () => participantTile(rc, p, 1530, 50 + i * 210, 340, 191, 18), 0, 40));
};

/* 17 ─ Break / BRB */
const breakScene: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc, COL.yellow);
  const inningsBreak = !!m && m.innings.length === 1 && m.innings[0]?.description === 'complete';
  const anyComplete = !!m && m.innings.some((i) => !i.isCurrent);
  fx(ctx, enter(age, 0), () => {
    text(ctx, anyComplete || inningsBreak ? 'INNINGS BREAK' : 'BE RIGHT BACK', W / 2, 220, { size: 100, weight: 900, align: 'center', font: 'cond', spacing: 4 });
    text(ctx, rc.state.brand.title, W / 2, 290, { size: 36, color: COL.sub, align: 'center' });
  });
  if (m) {
    m.innings.slice(-2).forEach((inn, i) =>
      fx(ctx, enter(age, 1 + i), () => {
        const x = W / 2 - 700 + i * 720;
        const team = m.teams.find((t) => t.id === inn.teamId);
        card(ctx, x, 360, 680, 420, { fill: COL.card, r: 28 });
        teamBadge(rc, team, x + 80, 440, 44);
        text(ctx, inn.teamName, x + 145, 455, { size: 36, weight: 700, max: 500 });
        text(ctx, `${inn.runs}/${inn.wickets}`, x + 40, 590, { size: 110, weight: 800, font: 'cond' });
        text(ctx, `${fmtOvers(inn.overs)} overs`, x + 40, 640, { size: 28, color: COL.sub });
        const top = inn.batting.slice().sort((a, b) => b.runs - a.runs)[0];
        const topB = inn.bowling.slice().sort((a, b) => b.wickets - a.wickets || a.conceded - b.conceded)[0];
        if (top) text(ctx, `🏏 ${top.name} ${top.runs} (${top.balls})`, x + 40, 700, { size: 28, max: 600 });
        if (topB) text(ctx, `🎯 ${topB.name} ${topB.wickets}-${topB.conceded}`, x + 40, 745, { size: 28, max: 600 });
      }),
    );
  }
  equaliser(rc, W / 2 - 300, 860, 600, 70);
};

/* Announcement: a typed full-screen message (rain delay, bad light, technical trouble ...) */
function wrapLines(ctx: CanvasRenderingContext2D, s: string, maxW: number, size: number, maxLines: number) {
  const out: string[] = [];
  for (const para of s.split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(ctx, next, { size, weight: 600 }) > maxW) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
  }
  if (out.length > maxLines) {
    out.length = maxLines;
    out[maxLines - 1] += '…';
  }
  return out;
}

const message: SceneFn = (rc) => {
  const { ctx, age, now, match: m, state } = rc;
  background(rc, rc.accent);
  const a = state.announcement;
  const title = (a?.title || 'Please stand by').toUpperCase();
  const body = a?.text ?? '';
  fx(ctx, enter(age, 0), () => {
    // pulsing "on air" dot + headline
    const tw = measure(ctx, title, { size: 110, weight: 900, font: 'cond' });
    const dot = 0.5 + 0.5 * Math.abs(Math.sin(now / 500));
    ctx.beginPath();
    ctx.arc(W / 2 - Math.min(tw, 1500) / 2 - 50, 228, 16, 0, Math.PI * 2);
    ctx.fillStyle = hexA(COL.red, dot);
    ctx.fill();
    text(ctx, title, W / 2, 270, { size: 110, weight: 900, align: 'center', font: 'cond', spacing: 3, max: 1500 });
    text(ctx, state.brand.title, W / 2, 330, { size: 30, color: COL.sub, align: 'center', max: 1400 });
  });
  if (body) {
    let size = 54;
    let lines = wrapLines(ctx, body, 1440, size, 5);
    if (lines.length > 3) lines = wrapLines(ctx, body, 1440, (size = 44), 6);
    const lh = size * 1.35;
    const h = lines.length * lh + 90;
    fx(ctx, enter(age, 1), () => {
      card(ctx, W / 2 - 800, 390, 1600, h, { fill: COL.card, r: 32 });
      lines.forEach((l, i) => text(ctx, l, W / 2, 390 + 45 + size + i * lh, { size, weight: 600, align: 'center' }));
    });
  }
  if (m) {
    const inn = curInnings(m);
    fx(ctx, enter(age, 2), () => {
      const y = 860;
      card(ctx, W / 2 - 520, y, 1040, 110, { fill: hexA('#000000', 0.35), r: 55 });
      const [t1, t2] = m.teams;
      teamBadge(rc, t1, W / 2 - 450, y + 55, 34);
      teamBadge(rc, t2, W / 2 + 450, y + 55, 34);
      const line = inn ? `${inn.teamAbbr} ${inn.runs}/${inn.wickets} (${fmtOvers(inn.overs)})` : `${t1?.abbr ?? ''} v ${t2?.abbr ?? ''}`;
      text(ctx, line, W / 2, y + 52, { size: 40, weight: 800, align: 'center', font: 'cond', max: 760 });
      text(ctx, m.statusText || m.description, W / 2, y + 90, { size: 22, color: COL.sub, align: 'center', max: 760 });
    });
  }
  if (a?.ts) {
    const mins = Math.floor((Date.now() - a.ts) / 60_000);
    if (mins >= 1) text(ctx, `Updated ${mins} min ago`, W - 60, H - 40, { size: 22, color: COL.dim, align: 'right' });
  }
};

/* 18 ─ Result & thanks */
const result: SceneFn = (rc) => {
  const { ctx, age, match: m, now } = rc;
  background(rc, COL.gold);
  // confetti
  for (let i = 0; i < 70; i++) {
    const x = (i * 137.5 + now / 12) % W;
    const y = ((i * 89 + now / (6 + (i % 5))) % (H + 40)) - 20;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(now / 400 + i);
    ctx.fillStyle = [COL.gblue, COL.red, COL.yellow, COL.green][i % 4];
    ctx.globalAlpha = 0.6;
    ctx.fillRect(-6, -3, 12, 6);
    ctx.restore();
  }
  const winner = m?.teams.find((t) => t.winner);
  fx(ctx, enter(age, 0, 0, 700), () => {
    text(ctx, m?.state === 'post' ? 'RESULT' : 'THANKS FOR WATCHING', W / 2, 190, { size: 40, weight: 800, align: 'center', color: COL.gold, spacing: 8 });
    text(ctx, m?.summary || (winner ? `${winner.name} win` : rc.state.brand.title), W / 2, 290, { size: 70, weight: 900, align: 'center', max: 1700 });
  });
  if (m) {
    m.teams.slice(0, 2).forEach((t, i) =>
      fx(ctx, enter(age, 1 + i), () => {
        const x = W / 2 - 620 + i * 640;
        card(ctx, x, 360, 600, 220, { fill: t.winner ? hexA(COL.gold, 0.22) : COL.card, r: 28, stroke: t.winner ? COL.gold : undefined });
        teamBadge(rc, t, x + 90, 470, 56);
        text(ctx, t.name, x + 170, 445, { size: 36, weight: 700, max: 400 });
        text(ctx, t.score || '–', x + 170, 510, { size: 44, weight: 800, font: 'cond', max: 400 });
      }),
    );
    const allBat = m.innings.flatMap((i) => i.batting).sort((a, b) => b.runs - a.runs).slice(0, 2);
    const allBowl = m.innings.flatMap((i) => i.bowling).sort((a, b) => b.wickets - a.wickets || a.conceded - b.conceded).slice(0, 2);
    fx(ctx, enter(age, 3), () => {
      card(ctx, W / 2 - 620, 620, 1240, 280, { fill: COL.card, r: 28 });
      text(ctx, 'TOP PERFORMERS', W / 2, 680, { size: 24, weight: 700, color: COL.sub, align: 'center', spacing: 3 });
      allBat.forEach((b, i) => text(ctx, `${b.name} — ${b.runs} (${b.balls})`, W / 2 - 580, 760 + i * 60, { size: 34, weight: 600, max: 560 }));
      allBowl.forEach((b, i) => text(ctx, `${b.name} — ${b.wickets}/${b.conceded}`, W / 2 + 40, 760 + i * 60, { size: 34, weight: 600, max: 560 }));
    });
  }
  fx(ctx, enter(age, 4), () => text(ctx, 'Like · Subscribe · Share your thoughts in the comments', W / 2, 965, { size: 30, color: COL.sub, align: 'center' }));
};

export const SCENE_DRAW: Record<SceneId, SceneFn> = {
  startingSoon,
  hostSolo,
  panel,
  scoreHero,
  ballByBall,
  battingCard,
  bowlingCard,
  batters,
  bowlerSpotlight,
  manhattan,
  worm,
  fallOfWickets,
  playingXI,
  aroundGrounds,
  commentaryDesk,
  screenShare,
  break: breakScene,
  message,
  result,
  ...(INSIGHT_SCENES as Record<string, SceneFn>),
  ...(ANALYSIS_SCENES as Record<string, SceneFn>),
} as Record<SceneId, SceneFn>;

/** Scenes where the persistent scorebug is shown over the picture. */
export const SCOREBUG_SCENES: SceneId[] = ['hostSolo', 'panel', 'screenShare'];
/** Scenes without the bottom ticker. */
export const NO_TICKER_SCENES: SceneId[] = ['startingSoon', 'result', 'message'];

