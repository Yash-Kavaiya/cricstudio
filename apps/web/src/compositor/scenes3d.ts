// Scenes rendered on the shared 3D stadium (stage3d.ts) with 2D labels and cards on top.
import type { BatterLine, Innings, MatchDetail, SceneId } from '@cricstudio/shared';
import { background, card, clamp, COL, easeOut, enter, fx, headshot, hexA, rr, sceneTitle, teamColor, text, W, H, type RenderCtx } from './draw';
import type { Shot } from './stage3d';

type SceneFn = (rc: RenderCtx) => void;

const ZONES = ['Fine leg', 'Square leg', 'Mid-wicket', 'Long-on', 'Long-off', 'Cover', 'Point', 'Third man'];
/** where the 3D picture sits so the info card on the right doesn't hide the ground */
const OX = -230;
const OY = 30;

const cur = (m: MatchDetail | null): Innings | undefined => (m ? (m.innings.find((i) => i.number === m.currentInnings) ?? m.innings.at(-1)) : undefined);

function message(rc: RenderCtx, title: string, sub: string) {
  const { ctx } = rc;
  card(ctx, W / 2 - 520, H / 2 - 110, 1040, 220, { fill: COL.card });
  text(ctx, title, W / 2, H / 2 - 10, { size: 46, weight: 700, align: 'center' });
  text(ctx, sub, W / 2, H / 2 + 50, { size: 28, color: COL.sub, align: 'center' });
}

/**
 * Where a stroke went, read from the commentary ("flicks this out to long leg"). The last fielding
 * position named wins ("past point to third man" → third man). Zones as the wagon wheel:
 * 0 fine leg · 1 square leg · 2 mid-wicket · 3 long-on · 4 long-off · 5 cover · 6 point · 7 third man.
 */
const POSITIONS: [RegExp, number][] = [
  [/third man|slips?\b|keeper|over the cordon/g, 7],
  [/fine leg|long leg|leg slip|scoop|\blap/g, 0],
  [/square leg|backward square|deep square|\bpull|\bhook/g, 1],
  [/mid-?wicket|cow corner/g, 2],
  [/long-? ?on\b|mid-? ?on\b|straight|down the ground|past the bowler|sightscreen/g, 3],
  [/long-? ?off|mid-? ?off/g, 4],
  [/extra cover|covers?\b/g, 5],
  [/point|gully|\bcuts?\b/g, 6],
];

export function shotZone(text: string): number | null {
  const t = text.toLowerCase();
  let best: { at: number; zone: number } | null = null;
  for (const [re, zone] of POSITIONS) {
    re.lastIndex = 0;
    for (let m = re.exec(t); m; m = re.exec(t)) if (!best || m.index > best.at) best = { at: m.index, zone };
  }
  return best?.zone ?? null;
}

/** split per-zone wagon totals into strokes (sixes and fours first) so the 3D ground can draw arcs */
function wagonShots(b: BatterLine): Shot[] {
  const out: Shot[] = [];
  let six = b.sixes;
  let four = b.fours;
  (b.wagon ?? []).forEach((runs, zone) => {
    let left = runs;
    for (; left >= 6 && six > 0; left -= 6, six--) out.push({ zone, runs: 6 });
    for (; left >= 4 && four > 0; left -= 4, four--) out.push({ zone, runs: 4 });
    for (; left > 0; left -= 2) out.push({ zone, runs: Math.min(2, left) });
  });
  return out;
}

/** strokes from the ball-by-ball commentary, for one batter or the whole innings */
function commentaryShots(m: MatchDetail, innings: number, batterId?: string): Shot[] {
  const out: Shot[] = [];
  for (const x of m.recentBalls) {
    if (x.innings !== innings || x.batRuns <= 0 || (batterId && x.batsman?.id !== batterId)) continue;
    const zone = shotZone(x.text);
    if (zone !== null) out.push({ zone, runs: x.batRuns });
  }
  return out.slice(-60);
}

/** the striker if they have a shot map, else the innings' top scorer with one */
function shotMapBatter(m: MatchDetail, inn: Innings | undefined): BatterLine | undefined {
  const s = m.currentBatters[0];
  const full = s && inn?.batting.find((b) => b.id === s.id);
  if (full?.wagon?.some((x) => x > 0)) return full;
  return inn?.batting.filter((b) => b.wagon?.some((x) => x > 0)).sort((a, b) => b.runs - a.runs)[0];
}

const ground3d: SceneFn = (rc) => {
  const { ctx, age, match: m } = rc;
  background(rc, COL.green);
  const st = rc.stage3d?.();
  if (!m) return message(rc, 'No live match selected', 'Pick a match in the Match tab to light up the 3D ground');
  if (!st) return message(rc, '3D ground unavailable', 'This browser has no WebGL; the 2D Wagon Wheel scene still works');
  const inn = cur(m);
  // ESPN's wagon zones when it sends them, else strokes read from the commentary: the striker's if
  // they have a few, else the innings' recent ones, else just the ground
  let b = shotMapBatter(m, inn);
  let shots: Shot[] = b ? wagonShots(b) : [];
  let who = 'shot map';
  if (!shots.length && inn) {
    const striker = m.currentBatters[0];
    const mine = striker ? commentaryShots(m, inn.number, striker.id) : [];
    if (mine.length >= 3) {
      b = inn.batting.find((x) => x.id === striker!.id);
      shots = mine;
      who = 'scoring shots';
    } else {
      b = undefined;
      shots = commentaryShots(m, inn.number);
      who = 'recent scoring shots';
    }
  }
  const wagon = shots.length > 0;
  const view = st.renderGround(shots, rc.accent, age);
  ctx.save();
  ctx.globalAlpha *= clamp(age / 500);
  ctx.drawImage(st.canvas, OX, OY, W, H);
  ctx.restore();

  sceneTitle(rc, '3D Ground', b && wagon ? `${b.name} · ${b.runs} (${b.balls}) · ${who}` : wagon ? `${inn?.teamAbbr ?? ''} ${who}` : m.venue || m.title);

  // run totals just beyond the rope
  if (wagon) {
    const total = Math.max(1, ...view.labels.map((l) => l.runs));
    view.labels.forEach((l, i) => {
      if (!l.runs) return;
      const p = easeOut((age - 1300 - i * 120) / 500);
      if (p <= 0) return;
      fx(ctx, p, () => {
        const x = l.x + OX;
        const y = l.y + OY;
        const hot = l.runs >= total * 0.6;
        rr(ctx, x - 62, y - 40, 124, 64, 18);
        ctx.fillStyle = hot ? hexA(COL.yellow, 0.92) : 'rgba(8,12,26,0.78)';
        ctx.fill();
        text(ctx, String(l.runs), x, y - 6, { size: 34, weight: 800, align: 'center', font: 'cond', color: hot ? '#1a1300' : '#ffffff' });
        text(ctx, ZONES[l.zone], x, y + 16, { size: 15, weight: 600, align: 'center', color: hot ? '#3a2a00' : 'rgba(255,255,255,0.75)' });
      }, 12);
    });
  } else
    fx(ctx, enter(age, 3), () => {
      rr(ctx, W / 2 + OX - 330, 900, 660, 56, 28);
      ctx.fillStyle = 'rgba(8,12,26,0.78)';
      ctx.fill();
      text(ctx, 'Shot map arrives with ball-by-ball data', W / 2 + OX, 937, { size: 26, weight: 600, align: 'center' });
    });

  // batter card on the right
  fx(ctx, enter(age, 4), () => {
    const x = 1400;
    card(ctx, x, 210, 450, 640, { fill: COL.cardSolid, r: 30 });
    if (b) {
      headshot(rc, b.name, b.headshot, x + 225, 320, 78, rc.accent);
      text(ctx, b.name, x + 225, 445, { size: 32, weight: 700, align: 'center', max: 400 });
      text(ctx, `${b.runs}`, x + 225, 520, { size: 66, weight: 800, align: 'center', font: 'cond', color: rc.accent });
      text(ctx, `off ${b.balls} balls`, x + 225, 552, { size: 22, color: COL.sub, align: 'center' });
      const top = view.labels.reduce((best, l) => (l.runs > (view.labels[best]?.runs ?? 0) ? l.zone : best), -1);
      const rows: [string, string][] = [
        ['Strike rate', b.sr.toFixed(1)],
        ['4s / 6s', `${b.fours} / ${b.sixes}`],
        ['Favourite zone', top >= 0 ? ZONES[top] : '–'],
        ['Favourite shot', b.preferredShot ?? '–'],
      ];
      rows.forEach(([k, v], i) => {
        text(ctx, k, x + 36, 625 + i * 52, { size: 24, color: COL.sub });
        text(ctx, v, x + 414, 625 + i * 52, { size: 26, weight: 700, align: 'right', max: 210 });
      });
    } else {
      const [ta, tb] = m.teams;
      text(ctx, 'THE VENUE', x + 225, 290, { size: 22, weight: 800, color: rc.accent, align: 'center', spacing: 3 });
      text(ctx, m.venue || '—', x + 225, 360, { size: 32, weight: 700, align: 'center', max: 400 });
      text(ctx, `${ta?.abbr ?? ''} v ${tb?.abbr ?? ''}`, x + 225, 470, { size: 60, weight: 800, align: 'center', font: 'cond' });
      text(ctx, m.statusText || m.summary || '', x + 225, 540, { size: 24, color: COL.sub, align: 'center', max: 400 });
      if (inn) text(ctx, `${inn.teamAbbr} ${inn.runs}/${inn.wickets}`, x + 225, 650, { size: 52, weight: 800, align: 'center', font: 'cond' });
    }
  });
};

const intro3d: SceneFn = (rc) => {
  const { ctx, age, match: m, state } = rc;
  background(rc);
  const st = rc.stage3d?.();
  if (!m) return message(rc, 'No match selected', 'Pick a match to play its 3D intro');
  const [ta, tb] = m.teams;
  if (st) {
    st.renderIntro({ abbr: ta?.abbr ?? 'TBA', color: teamColor(ta) }, { abbr: tb?.abbr ?? 'TBA', color: teamColor(tb) }, age);
    ctx.save();
    ctx.globalAlpha *= clamp(age / 600);
    ctx.drawImage(st.canvas, 0, 0, W, H);
    ctx.restore();
  }
  // cinematic letterbox bars
  const bar = 90 * (1 - easeOut((age - 3600) / 900));
  if (bar > 0.5) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, bar);
    ctx.fillRect(0, H - bar, W, bar);
  }
  fx(ctx, enter(age, 0, 0, 600, 500), () => {
    text(ctx, (m.series || state.brand.title).toUpperCase(), W / 2, 150, { size: 30, weight: 800, align: 'center', color: rc.accent, spacing: 8, max: 1500 });
    text(ctx, m.description || m.title, W / 2, 205, { size: 40, weight: 700, align: 'center', max: 1500 });
  });
  fx(ctx, enter(age, 0, 0, 700, 2600), () => {
    card(ctx, W / 2 - 560, 780, 1120, 150, { fill: COL.cardSolid, r: 30 });
    text(ctx, m.venue || 'Venue to be confirmed', W / 2, 840, { size: 34, weight: 700, align: 'center', max: 1040 });
    text(ctx, m.statusText || m.summary || 'Coming up next', W / 2, 892, { size: 26, color: COL.sub, align: 'center', max: 1040 });
  });
};

export const SCENES_3D: Partial<Record<SceneId, SceneFn>> = { ground3d, intro3d };
