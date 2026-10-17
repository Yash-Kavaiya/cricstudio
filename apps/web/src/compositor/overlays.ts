// Always-on layers (scorebug, ticker, captions, brand bug) and auto-triggered event overlays.
import type { ActiveOverlay } from '@cricstudio/shared';
import {
  COL,
  H,
  W,
  ballChip,
  card,
  clamp,
  easeBack,
  easeOut,
  fmtOvers,
  hexA,
  measure,
  rr,
  teamBadge,
  teamColor,
  text,
  type RenderCtx,
} from './draw';

/* ---------------- scorebug ---------------- */

export function scorebug(rc: RenderCtx, p: number) {
  const { ctx, match: m } = rc;
  if (!m || p <= 0) return;
  const inn = m.innings.find((i) => i.number === m.currentInnings);
  if (!inn) return;
  const bat = m.teams.find((t) => t.id === inn.teamId);
  const bowl = m.teams.find((t) => t.id !== inn.teamId);
  const y = 905 + (1 - easeOut(p)) * 140;
  const x = 60;
  const h = 88;
  ctx.save();
  ctx.globalAlpha *= clamp(p * 1.4);
  // team + score block
  card(ctx, x, y, 1800, h, { fill: 'rgba(12,17,36,0.92)', r: 20 });
  const tc = teamColor(bat);
  ctx.save();
  rr(ctx, x, y, 360, h, 20);
  ctx.clip();
  const g = ctx.createLinearGradient(x, 0, x + 360, 0);
  g.addColorStop(0, hexA(tc, 0.95));
  g.addColorStop(1, hexA(tc, 0.55));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, 360, h);
  ctx.restore();
  teamBadge(rc, bat, x + 46, y + h / 2, 28);
  text(ctx, bat?.abbr ?? '', x + 88, y + 57, { size: 32, weight: 800, font: 'cond' });
  text(ctx, `${inn.runs}-${inn.wickets}`, x + 340, y + 62, { size: 52, weight: 800, font: 'cond', align: 'right' });
  // overs
  text(ctx, fmtOvers(inn.overs), x + 380, y + 50, { size: 34, weight: 700, font: 'cond' });
  text(ctx, 'OVERS', x + 380, y + 74, { size: 15, weight: 700, color: COL.sub, spacing: 2 });
  // batters
  let bx = x + 500;
  m.currentBatters.slice(0, 2).forEach((b, i) => {
    const nm = `${b.name.split(' ').slice(-1)[0]}${i === 0 ? '*' : ''}`;
    text(ctx, nm, bx, y + 54, { size: 30, weight: i === 0 ? 700 : 500, max: 190 });
    const nw = Math.min(190, measure(ctx, nm, { size: 30, weight: i === 0 ? 700 : 500 }));
    text(ctx, `${b.runs}`, bx + nw + 14, y + 55, { size: 32, weight: 800, font: 'cond' });
    text(ctx, `(${b.balls})`, bx + nw + 16 + measure(ctx, `${b.runs}`, { size: 32, weight: 800, font: 'cond' }), y + 55, {
      size: 22,
      color: COL.sub,
      font: 'cond',
    });
    bx += 330;
  });
  // bowler
  const bw = m.currentBowler;
  ctx.fillStyle = COL.line;
  ctx.fillRect(x + 1160, y + 16, 2, h - 32);
  if (bw) {
    text(ctx, bw.name.split(' ').slice(-1)[0], x + 1185, y + 54, { size: 28, weight: 600, max: 160 });
    text(ctx, `${bw.wickets}-${bw.conceded}`, x + 1355, y + 54, { size: 30, weight: 800, font: 'cond' });
    text(ctx, fmtOvers(bw.overs), x + 1440, y + 54, { size: 22, color: COL.sub, font: 'cond' });
  }
  // this over chips
  const cur = m.recentBalls.filter((b) => b.innings === inn.number);
  const lastOver = cur.at(-1)?.overNumber;
  const ob = cur.filter((b) => b.overNumber === lastOver).slice(-7);
  ob.forEach((b, i) => ballChip(ctx, b.label, x + 1500 + i * 44, y + h / 2, 19));
  // context line (target / crr) as a tab above the bar
  const ctxLine = m.need
    ? `${bat?.abbr} need ${m.need.runs} off ${m.need.balls} · RRR ${m.rrr?.toFixed(2) ?? '-'}`
    : `CRR ${m.crr.toFixed(2)}${bowl ? ` · v ${bowl.abbr}` : ''} · ${m.description}`;
  const tw = measure(ctx, ctxLine, { size: 22, weight: 600 }) + 40;
  rr(ctx, x + 20, y - 38, tw, 40, 12);
  ctx.fillStyle = hexA(rc.accent, 0.95);
  ctx.fill();
  text(ctx, ctxLine, x + 40, y - 11, { size: 22, weight: 600 });
  ctx.restore();
}

/* ---------------- ticker ---------------- */

export function ticker(rc: RenderCtx, p: number) {
  const { ctx, now, state } = rc;
  if (p <= 0 || !state.brand.showTicker) return;
  const h = 56;
  const y = H - h + (1 - easeOut(p)) * h;
  ctx.save();
  ctx.fillStyle = 'rgba(8,12,26,0.95)';
  ctx.fillRect(0, y, W, h);
  ctx.fillStyle = rc.accent;
  ctx.fillRect(0, y, 230, h);
  text(ctx, 'LIVE · CRICKET', 115, y + 37, { size: 22, weight: 800, align: 'center', spacing: 2 });
  // only the selected match: its score, the equation and the latest match notes
  const m = rc.match;
  const inn = m?.innings.find((i) => i.number === m.currentInnings);
  const score = m && inn ? `${m.title}: ${inn.teamAbbr} ${inn.runs}/${inn.wickets} (${fmtOvers(inn.overs)} ov)` : m ? `${m.title} · ${m.statusText}` : '';
  const need = m?.need ? `${inn?.teamAbbr ?? ''} need ${m.need.runs} from ${m.need.balls} balls` : '';
  const notes = m?.notes.slice(-2) ?? [];
  const items = [state.brand.ticker, score, need, ...notes].filter(Boolean);
  const msg = items.join('     ●     ') + '     ●     ';
  ctx.beginPath();
  ctx.rect(240, y, W - 240, h);
  ctx.clip();
  const mw = measure(ctx, msg, { size: 26, weight: 500 });
  const speed = 0.11; // px per ms
  const off = (now * speed) % Math.max(mw, 1);
  for (let x = 250 - off; x < W; x += mw) text(ctx, msg, x, y + 37, { size: 26, weight: 500 });
  ctx.restore();
}

/* ---------------- captions ---------------- */

export function captions(rc: RenderCtx) {
  const c = rc.caption;
  if (!c || !rc.state.brand.captions) return;
  const age = rc.now - c.ts;
  if (age > 4500) return;
  const a = 1 - clamp((age - 3800) / 700);
  const { ctx } = rc;
  const s = `${c.from}: ${c.text}`.slice(-110);
  const w = Math.min(1500, measure(ctx, s, { size: 34, weight: 500 }) + 60);
  ctx.save();
  ctx.globalAlpha *= a;
  rr(ctx, (W - w) / 2, 800, w, 64, 14);
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fill();
  text(ctx, s, W / 2, 843, { size: 34, weight: 500, align: 'center', max: 1440 });
  ctx.restore();
}

/* ---------------- brand bug ---------------- */

export function brandBug(rc: RenderCtx) {
  const { ctx, state, now } = rc;
  if (state.scene === 'startingSoon' || state.scene === 'result') return;
  const title = state.brand.title;
  const w = measure(ctx, title, { size: 24, weight: 700 }) + 90;
  ctx.save();
  rr(ctx, W - w - 40, 28, w, 48, 24);
  ctx.fillStyle = 'rgba(8,12,26,0.7)';
  ctx.fill();
  if (state.live.state === 'live') {
    const a = 0.55 + 0.45 * Math.sin(now / 350);
    ctx.beginPath();
    ctx.arc(W - w - 40 + 30, 52, 9, 0, Math.PI * 2);
    ctx.fillStyle = hexA(COL.red, a);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(W - w - 40 + 30, 52, 9, 0, Math.PI * 2);
    ctx.fillStyle = rc.accent;
    ctx.fill();
  }
  text(ctx, title, W - w - 40 + 52, 61, { size: 24, weight: 700 });
  ctx.restore();
}

/* ---------------- event overlays ---------------- */

/** deterministic pseudo-random so particles are stable frame to frame */
const rnd = (seed: number) => {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

function burst(rc: RenderCtx, o: ActiveOverlay, age: number, color: string, count = 90) {
  const { ctx } = rc;
  for (let i = 0; i < count; i++) {
    const ang = rnd(o.seq * 100 + i) * Math.PI * 2;
    const sp = 0.4 + rnd(o.seq * 300 + i) * 1.1;
    const d = age * sp * 0.9;
    const x = W / 2 + Math.cos(ang) * d;
    const y = H / 2 - 40 + Math.sin(ang) * d + (age / 1000) ** 2 * 160;
    const a = clamp(1 - age / 2200);
    if (a <= 0) continue;
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.translate(x, y);
    ctx.rotate(ang + age / 300);
    ctx.fillStyle = i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? color : COL.yellow;
    ctx.fillRect(-7, -3, 14, 6);
    ctx.restore();
  }
}

function rays(rc: RenderCtx, color: string, age: number, a: number) {
  const { ctx } = rc;
  ctx.save();
  ctx.globalAlpha *= a * 0.35;
  ctx.translate(W / 2, H / 2 - 40);
  ctx.rotate(age / 2500);
  for (let i = 0; i < 18; i++) {
    ctx.rotate((Math.PI * 2) / 18);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(1400, -70);
    ctx.lineTo(1400, 70);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? color : 'rgba(255,255,255,0.4)';
    ctx.fill();
  }
  ctx.restore();
}

function bigWord(rc: RenderCtx, word: string, color: string, age: number, sub?: string) {
  const { ctx } = rc;
  const p = easeBack(age / 520);
  ctx.save();
  ctx.translate(W / 2, H / 2 - 40);
  ctx.scale(0.4 + 0.6 * p, 0.4 + 0.6 * p);
  ctx.shadowColor = hexA(color, 0.9);
  ctx.shadowBlur = 60;
  text(ctx, word, 0, 70, { size: 260, weight: 900, align: 'center', font: 'cond', color: '#fff' });
  ctx.restore();
  if (sub) {
    const a = easeOut((age - 350) / 400);
    ctx.save();
    ctx.globalAlpha *= a;
    const w = Math.min(1500, measure(ctx, sub, { size: 40, weight: 600 }) + 80);
    rr(ctx, (W - w) / 2, H / 2 + 110, w, 76, 38);
    ctx.fillStyle = hexA(color, 0.92);
    ctx.fill();
    text(ctx, sub, W / 2, H / 2 + 162, { size: 40, weight: 600, align: 'center', max: 1440 });
    ctx.restore();
  }
}

function band(rc: RenderCtx, color: string, title: string, sub: string | undefined, age: number, icon?: string) {
  const { ctx } = rc;
  const p = easeOut(age / 450);
  const y = 330;
  ctx.save();
  // sweeping band
  ctx.beginPath();
  ctx.rect(0, y, W * p, 300);
  ctx.clip();
  const g = ctx.createLinearGradient(0, y, W, y + 300);
  g.addColorStop(0, hexA(color, 0.97));
  g.addColorStop(1, hexA(color, 0.8));
  ctx.fillStyle = g;
  ctx.fillRect(0, y, W, 300);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  for (let i = 0; i < 12; i++) ctx.fillRect(((age / 3 + i * 200) % (W + 200)) - 200, y, 60, 300);
  ctx.restore();
  const tp = easeOut((age - 250) / 450);
  ctx.save();
  ctx.globalAlpha *= tp;
  ctx.translate((1 - tp) * -80, 0);
  if (icon) text(ctx, icon, 200, y + 190, { size: 140, align: 'center' });
  text(ctx, title, icon ? 320 : W / 2, y + 165, { size: 120, weight: 900, font: 'cond', align: icon ? 'left' : 'center', max: icon ? 1450 : 1750 });
  if (sub) text(ctx, sub, icon ? 324 : W / 2, y + 240, { size: 40, weight: 500, align: icon ? 'left' : 'center', max: icon ? 1450 : 1700 });
  ctx.restore();
}

function overSummary(rc: RenderCtx, o: ActiveOverlay, age: number) {
  const { ctx, match: m } = rc;
  const p = easeOut(age / 450);
  const x = W - 760;
  const y = 120;
  ctx.save();
  ctx.globalAlpha *= p;
  ctx.translate((1 - p) * 200, 0);
  card(ctx, x, y, 700, 300, { fill: 'rgba(12,17,36,0.94)', r: 28, stroke: hexA(rc.accent, 0.6) });
  text(ctx, o.title.toUpperCase(), x + 40, y + 70, { size: 34, weight: 800, font: 'cond', color: rc.accent });
  if (o.subtitle) text(ctx, o.subtitle, x + 40, y + 115, { size: 28, weight: 500, max: 620 });
  const inn = m?.innings.find((i) => i.number === m.currentInnings);
  const over = o.value ?? m?.recentBalls.at(-1)?.overNumber;
  const balls = (m?.recentBalls ?? []).filter((b) => b.innings === inn?.number && b.overNumber === over);
  balls.slice(0, 9).forEach((b, i) => ballChip(ctx, b.label, x + 70 + i * 72, y + 200, 30, easeOut((age - 200 - i * 80) / 350)));
  const bw = balls.at(-1)?.bowler;
  if (bw) text(ctx, `${bw.name}  ${bw.wickets}-${bw.conceded} (${fmtOvers(bw.overs)})`, x + 40, y + 272, { size: 24, color: COL.sub, max: 620 });
  ctx.restore();
}

function fullCard(rc: RenderCtx, o: ActiveOverlay, age: number, color: string) {
  const { ctx } = rc;
  const a = easeOut(age / 500);
  ctx.save();
  ctx.globalAlpha *= a * 0.75;
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha *= a;
  const s = 0.9 + 0.1 * easeBack(age / 600);
  ctx.translate(W / 2, H / 2);
  ctx.scale(s, s);
  text(ctx, o.title.toUpperCase(), 0, -10, { size: 130, weight: 900, font: 'cond', align: 'center', color: '#fff' });
  if (o.subtitle) text(ctx, o.subtitle, 0, 70, { size: 40, align: 'center', color: COL.sub, max: 1600 });
  ctx.fillStyle = color;
  rr(ctx, -160, 110, 320, 10, 5);
  ctx.fill();
  ctx.restore();
}

function lowerThird(rc: RenderCtx, o: ActiveOverlay, age: number) {
  const { ctx } = rc;
  const p = easeOut(age / 450);
  const w = Math.max(700, measure(ctx, o.title, { size: 46, weight: 700 }) + 120);
  ctx.save();
  ctx.globalAlpha *= p;
  ctx.translate((1 - p) * -200, 0);
  card(ctx, 80, 740, w, o.subtitle ? 140 : 96, { fill: 'rgba(12,17,36,0.94)', r: 20 });
  ctx.fillStyle = rc.accent;
  rr(ctx, 80, 740, 14, o.subtitle ? 140 : 96, 7);
  ctx.fill();
  text(ctx, o.title, 130, 803, { size: 46, weight: 700, max: w - 80 });
  if (o.subtitle) text(ctx, o.subtitle, 130, 852, { size: 30, color: COL.sub, max: w - 80 });
  ctx.restore();
}

/** shockwave rings + lens flare that sit under the 3D layer */
function impact(rc: RenderCtx, color: string, age: number) {
  const { ctx } = rc;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 3; k++) {
    const t = (age - k * 180) / 900;
    if (t < 0 || t > 1) continue;
    ctx.strokeStyle = hexA(color, 0.6 * (1 - t));
    ctx.lineWidth = 30 * (1 - t) + 2;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2 - 40, 120 + t * 900, 0, Math.PI * 2);
    ctx.stroke();
  }
  const f = clamp(1 - age / 700);
  if (f > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2 - 40, 0, W / 2, H / 2 - 40, 900);
    g.addColorStop(0, `rgba(255,255,255,${0.55 * f})`);
    g.addColorStop(0.3, hexA(color, 0.35 * f));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

function subtitlePill(rc: RenderCtx, text: string | undefined, color: string, age: number, y = H - 250) {
  if (!text) return;
  const { ctx } = rc;
  const a = easeOut((age - 450) / 400);
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha *= a;
  const w = Math.min(1500, measure(ctx, text, { size: 42, weight: 700 }) + 110);
  const x = (W - w) / 2 + (1 - a) * 60;
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, hexA(color, 0.96));
  g.addColorStop(1, hexA(color, 0.78));
  ctx.shadowColor = hexA(color, 0.8);
  ctx.shadowBlur = 40;
  rr(ctx, x, y, w, 84, 42);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  // glossy top highlight
  rr(ctx, x + 6, y + 5, w - 12, 34, 30);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fill();
  text2(ctx, text, W / 2 + (1 - a) * 60, y + 56, w - 80);
  ctx.restore();
}

function text2(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, max: number) {
  text(ctx, s, x, y, { size: 42, weight: 700, align: 'center', max });
}

function draw3d(rc: RenderCtx, o: ActiveOverlay): boolean {
  const fx = rc.fx3d;
  if (!fx || !rc.state.brand.fx3d) return false;
  if (!fx.play(o, rc.accent)) return false;
  const c = fx.render(o);
  if (!c) return false;
  rc.ctx.drawImage(c, 0, 0, W, H);
  return true;
}

export function eventOverlay(rc: RenderCtx) {
  const o = rc.state.overlay;
  if (!o || (!o.title && o.id === 'custom')) {
    rc.fx3d?.render(null);
    return;
  }
  const now = Date.now();
  const age = now - o.startedAt;
  const remain = o.until - now;
  if (remain < -400) {
    rc.fx3d?.render(null);
    return;
  }
  const out = clamp(remain / 400); // fade out over last 400ms
  const { ctx } = rc;
  ctx.save();
  ctx.globalAlpha *= out;
  switch (o.id) {
    case 'four':
      rays(rc, COL.gblue, age, clamp(age / 300) * 0.7);
      impact(rc, COL.gblue, age);
      if (draw3d(rc, o)) subtitlePill(rc, o.subtitle, COL.gblue, age);
      else {
        burst(rc, o, age, COL.gblue, 70);
        bigWord(rc, 'FOUR', COL.gblue, age, o.subtitle);
      }
      break;
    case 'six':
      rays(rc, COL.purple, age, clamp(age / 300));
      impact(rc, COL.purple, age);
      if (draw3d(rc, o)) subtitlePill(rc, o.subtitle, COL.purple, age);
      else {
        burst(rc, o, age, COL.purple, 140);
        bigWord(rc, 'SIX', COL.purple, age, o.subtitle);
      }
      break;
    case 'wicket': {
      // red vignette pulse
      const pulse = 0.35 + 0.25 * Math.sin(age / 140);
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, `rgba(200,0,0,${pulse * clamp(age / 300)})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
      if (draw3d(rc, o)) subtitlePill(rc, o.subtitle, COL.red, age, H - 230);
      else {
        const shake = age < 500 ? Math.sin(age / 18) * 14 * (1 - age / 500) : 0;
        ctx.translate(shake, 0);
        band(rc, COL.red, 'WICKET!', o.subtitle, age, '🏏');
      }
      break;
    }
    case 'milestone':
      impact(rc, COL.gold, age);
      if (draw3d(rc, o)) subtitlePill(rc, o.title.replace(/^(FIFTY|CENTURY)!\s*/, '') || o.subtitle, '#b8860b', age);
      else {
        burst(rc, o, age, COL.gold, 120);
        band(rc, '#b8860b', o.title, o.subtitle, age, '⭐');
      }
      break;
    case 'fiveWickets':
      impact(rc, COL.gold, age);
      if (draw3d(rc, o)) subtitlePill(rc, o.title.replace(/^FIVE-WICKET HAUL!\s*/, '') || o.subtitle, '#7b1fa2', age);
      else {
        burst(rc, o, age, COL.gold, 120);
        band(rc, '#7b1fa2', o.title, o.subtitle, age, '🎯');
      }
      break;
    case 'partnership':
      if (draw3d(rc, o)) subtitlePill(rc, o.subtitle, '#0b57d0', age);
      else band(rc, '#0b57d0', o.title, o.subtitle, age, '🤝');
      break;
    case 'hattrick':
      if (draw3d(rc, o)) subtitlePill(rc, o.subtitle, '#e37400', age);
      else band(rc, '#e37400', o.title, o.subtitle, age, '🔥');
      break;
    case 'overSummary':
      overSummary(rc, o, age);
      break;
    case 'inningsEnd':
    case 'matchEnd': {
      const a = easeOut(age / 500);
      ctx.save();
      ctx.globalAlpha *= a * 0.7;
      ctx.fillStyle = '#05070f';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      if (draw3d(rc, o)) subtitlePill(rc, o.subtitle, o.id === 'matchEnd' ? '#b8860b' : '#3c4566', age);
      else {
        if (o.id === 'matchEnd') burst(rc, o, age, COL.gold, 160);
        fullCard(rc, o, age, o.id === 'matchEnd' ? COL.gold : COL.yellow);
      }
      break;
    }
    default:
      lowerThird(rc, o, age);
  }
  ctx.restore();
}
