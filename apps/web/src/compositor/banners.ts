// Lower banners the host puts on air: rotating sponsor lines, or the selected match's full
// quick score. Drawn with the active design theme (cards, fonts, colours), not the dark chrome.
import { COL, W, ballChip, card, clamp, easeOut, fmtOvers, hexA, measure, rr, teamBadge, text, type RenderCtx } from './draw';

const Y = 884;
const BH = 116;
const X = 60;
const BW = W - 120;

/** slide-up entrance from the banner's on-air time */
function enterP(since: number) {
  return easeOut((Date.now() - since) / 650);
}

/** small accent label tab sitting on the banner's top edge */
function tab(rc: RenderCtx, label: string, y: number) {
  const { ctx } = rc;
  // measure() ignores letter-spacing, so add it per character
  const tw = measure(ctx, label, { size: 18, weight: 800 }) + label.length * 3 + 36;
  rr(ctx, X + 24, y - 30, tw, 34, 10);
  ctx.fillStyle = rc.accent;
  ctx.fill();
  text(ctx, label, X + 42, y - 7, { size: 18, weight: 800, spacing: 3, color: '#ffffff' });
}

export function sponsorBanner(rc: RenderCtx) {
  const { ctx, state } = rc;
  const b = state.banner;
  const lines = (state.brand.sponsors ?? []).filter(Boolean);
  if (b?.kind !== 'sponsor' || !lines.length) return;
  const p = enterP(b.since);
  const y = Y + (1 - p) * 160;
  ctx.save();
  ctx.globalAlpha *= clamp(p * 1.5);
  card(ctx, X, y, BW, BH, { fill: COL.cardSolid, r: 26 });
  tab(rc, 'IN ASSOCIATION WITH', y);
  // accent spine
  ctx.fillStyle = rc.accent;
  rr(ctx, X + 26, y + 30, 8, BH - 60, 4);
  ctx.fill();
  // one line every 6 s with a short cross-fade + rise
  const per = 6000;
  const t = Date.now() - b.since;
  const i = Math.floor(t / per) % lines.length;
  const local = (t % per) / per;
  const fade = lines.length > 1 ? Math.min(clamp(local / 0.08), clamp((1 - local) / 0.08)) : 1;
  ctx.save();
  ctx.globalAlpha *= fade;
  text(ctx, lines[i], X + 64, y + BH / 2 + 16 + (1 - fade) * 14, { size: 46, weight: 700, font: 'cond', max: BW - 240 });
  ctx.restore();
  // position dots
  if (lines.length > 1)
    lines.forEach((_, k) => {
      ctx.beginPath();
      ctx.arc(X + BW - 40 - (lines.length - 1 - k) * 22, y + BH / 2, k === i ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = k === i ? rc.accent : hexA(COL.ink, 0.25);
      ctx.fill();
    });
  ctx.restore();
}

export function quickScoreBanner(rc: RenderCtx) {
  const { ctx, state, match: m } = rc;
  const b = state.banner;
  if (b?.kind !== 'quickScore' || !m) return;
  const inn = m.innings.find((x) => x.number === m.currentInnings) ?? m.innings.at(-1);
  const bat = m.teams.find((t) => t.id === inn?.teamId) ?? m.teams[0];
  const bowl = m.teams.find((t) => t !== bat);
  const p = enterP(b.since);
  const y = Y + (1 - p) * 160;
  ctx.save();
  ctx.globalAlpha *= clamp(p * 1.5);
  card(ctx, X, y, BW, BH, { fill: COL.cardSolid, r: 26 });
  tab(rc, `QUICK SCORE · ${(m.description || m.series || 'LIVE').toUpperCase()}`, y);
  const mid = y + BH / 2;

  // 1. batting side + score
  teamBadge(rc, bat, X + 66, mid, 34);
  if (inn) {
    text(ctx, bat?.abbr ?? inn.teamAbbr, X + 116, mid - 8, { size: 26, weight: 800, color: COL.sub, font: 'cond' });
    text(ctx, `${inn.runs}/${inn.wickets}`, X + 116, mid + 38, { size: 58, weight: 800, font: 'cond' });
    const sw = measure(ctx, `${inn.runs}/${inn.wickets}`, { size: 58, weight: 800, font: 'cond' });
    text(ctx, `${fmtOvers(inn.overs)} ov`, X + 128 + sw, mid + 36, { size: 26, color: COL.sub, font: 'cond' });
  } else {
    text(ctx, `${m.teams[0]?.abbr ?? ''} v ${m.teams[1]?.abbr ?? ''}`, X + 116, mid + 16, { size: 50, weight: 800, font: 'cond' });
  }
  const div = (x: number) => {
    ctx.fillStyle = COL.line;
    ctx.fillRect(x, y + 22, 2, BH - 44);
  };
  div(X + 470);

  // 2. batters at the crease
  if (m.currentBatters.length) {
    m.currentBatters.slice(0, 2).forEach((bt, i) => {
      const ly = mid - 10 + i * 40;
      text(ctx, `${bt.name}${i === 0 ? ' *' : ''}`, X + 500, ly, { size: 27, weight: i === 0 ? 700 : 500, max: 300 });
      text(ctx, `${bt.runs}`, X + 880, ly, { size: 30, weight: 800, font: 'cond', align: 'right' });
      text(ctx, `(${bt.balls})`, X + 890, ly, { size: 22, color: COL.sub, font: 'cond' });
    });
  } else text(ctx, m.statusText || m.summary || 'Match starting soon', X + 500, mid + 10, { size: 28, weight: 600, max: 440 });
  div(X + 960);

  // 3. bowler + this over
  const bw = m.currentBowler;
  if (bw) {
    text(ctx, bw.name, X + 990, mid - 10, { size: 27, weight: 700, max: 260 });
    text(ctx, `${bw.wickets}-${bw.conceded}  (${fmtOvers(bw.overs)})`, X + 990, mid + 30, { size: 26, weight: 700, font: 'cond', color: COL.sub });
    const cur = m.recentBalls.filter((x) => x.innings === inn?.number);
    const lastOver = cur.at(-1)?.overNumber;
    cur
      .filter((x) => x.overNumber === lastOver)
      .slice(-6)
      .forEach((x, i) => ballChip(ctx, x.label, X + 1262 + i * 36, mid + 22, 15));
  } else if (bowl) text(ctx, `v ${bowl.name}`, X + 990, mid + 10, { size: 28, weight: 600, max: 420 });
  div(X + 1490);

  // 4. the equation
  const k1 = m.need ? 'NEED' : 'CRR';
  const v1 = m.need ? `${m.need.runs} off ${m.need.balls}` : m.crr ? m.crr.toFixed(2) : '–';
  const k2 = m.need ? 'RRR' : 'P’SHIP';
  const v2 = m.need ? (m.rrr?.toFixed(2) ?? '–') : m.partnership.balls ? `${m.partnership.runs} (${m.partnership.balls})` : '–';
  text(ctx, k1, X + 1515, mid - 14, { size: 17, weight: 800, color: COL.sub, spacing: 2 });
  text(ctx, v1, X + 1515, mid + 20, { size: 30, weight: 800, font: 'cond', color: rc.accent, max: 150 });
  text(ctx, k2, X + 1690, mid - 14, { size: 17, weight: 800, color: COL.sub, spacing: 2 });
  text(ctx, v2, X + 1690, mid + 20, { size: 30, weight: 800, font: 'cond', max: 100 });
  ctx.restore();
}

export function bannerActive(rc: RenderCtx) {
  const b = rc.state.banner;
  if (!b) return false;
  return b.kind === 'sponsor' ? !!rc.state.brand.sponsors?.some(Boolean) : !!rc.match;
}
