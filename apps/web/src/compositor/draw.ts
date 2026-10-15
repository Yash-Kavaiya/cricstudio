// Canvas drawing kit for the 1920x1080 program output.
import type { CaptionLine, MatchDetail, MatchListItem, Participant, StudioState, TeamInfo } from '@cricstudio/shared';

export const W = 1920;
export const H = 1080;

export const COL = {
  bg0: '#0b1020',
  bg1: '#111a33',
  card: 'rgba(255,255,255,0.06)',
  cardSolid: '#18213d',
  cardHi: 'rgba(255,255,255,0.10)',
  line: 'rgba(255,255,255,0.10)',
  text: '#ffffff',
  sub: '#aab4cf',
  dim: '#6f7a99',
  blue: '#4c8df6',
  gblue: '#1a73e8',
  red: '#ea4335',
  yellow: '#fbbc04',
  green: '#34a853',
  purple: '#a142f4',
  gold: '#f6c344',
};

export const FONT = {
  sans: 'Roboto, "Helvetica Neue", Arial, sans-serif',
  cond: '"Roboto Condensed", Roboto, Arial, sans-serif',
};

export interface VideoSource {
  cam?: HTMLVideoElement;
  screen?: HTMLVideoElement;
  mirror?: boolean;
}

export interface RenderCtx {
  ctx: CanvasRenderingContext2D;
  now: number;
  /** ms since this scene became active */
  age: number;
  state: StudioState;
  match: MatchDetail | null;
  matches: MatchListItem[];
  stage: Participant[];
  videos: Map<string, VideoSource>;
  caption: CaptionLine | null;
  img: (url?: string) => HTMLImageElement | null;
  accent: string;
  /** WebGL celebration renderer (null when unsupported) */
  fx3d?: import('./fx3d').Celebration3D | null;
}

/* ---------------- easing / animation ---------------- */

export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const easeOut = (t: number) => 1 - (1 - clamp(t)) ** 3;
export const easeInOut = (t: number) => {
  t = clamp(t);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
export const easeBack = (t: number) => {
  t = clamp(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
/** staggered entrance progress for item i */
export const enter = (age: number, i = 0, step = 70, dur = 520, delay = 120) => easeOut((age - delay - i * step) / dur);

/** run fn with fade + slide-up based on progress p */
export function fx(ctx: CanvasRenderingContext2D, p: number, fn: () => void, dy = 30, dx = 0) {
  if (p <= 0.001) return;
  ctx.save();
  ctx.globalAlpha *= clamp(p);
  ctx.translate(dx * (1 - p), dy * (1 - p));
  fn();
  ctx.restore();
}

/* ---------------- primitives ---------------- */

export function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rad);
}

export function card(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  o: { fill?: string | CanvasGradient; r?: number; stroke?: string; shadow?: boolean } = {},
) {
  ctx.save();
  if (o.shadow !== false) {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 10;
  }
  rr(ctx, x, y, w, h, o.r ?? 24);
  ctx.fillStyle = o.fill ?? COL.card;
  ctx.fill();
  ctx.restore();
  if (o.stroke) {
    ctx.save();
    rr(ctx, x, y, w, h, o.r ?? 24);
    ctx.strokeStyle = o.stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

export interface TextOpts {
  size?: number;
  weight?: number | string;
  color?: string;
  align?: CanvasTextAlign;
  base?: CanvasTextBaseline;
  font?: 'sans' | 'cond';
  max?: number;
  spacing?: number;
}

export function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, o: TextOpts = {}) {
  const size = o.size ?? 32;
  ctx.font = `${o.weight ?? 500} ${size}px ${FONT[o.font ?? 'sans']}`;
  ctx.fillStyle = o.color ?? COL.text;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.base ?? 'alphabetic';
  if ('letterSpacing' in ctx) (ctx as any).letterSpacing = `${o.spacing ?? 0}px`;
  if (o.max) {
    let str = s;
    while (str.length > 1 && ctx.measureText(str).width > o.max) str = str.slice(0, -2) + '…';
    // shrink-to-fit fallback for very long strings
    ctx.fillText(str, x, y);
  } else ctx.fillText(s, x, y);
  if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '0px';
}

export function measure(ctx: CanvasRenderingContext2D, s: string, o: TextOpts = {}) {
  ctx.font = `${o.weight ?? 500} ${o.size ?? 32}px ${FONT[o.font ?? 'sans']}`;
  return ctx.measureText(s).width;
}

export function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** ensure team colour is visible on dark backgrounds */
export function teamColor(t?: TeamInfo | { color?: string }) {
  const c = t?.color ?? COL.gblue;
  const h = c.replace('#', '');
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return COL.gblue;
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum < 60) return `rgb(${Math.min(255, r + 70)},${Math.min(255, g + 90)},${Math.min(255, b + 120)})`;
  return c.startsWith('#') ? c : `#${c}`;
}

/* ---------------- background ---------------- */

export { drawBackground as background } from './backgrounds';

/* ---------------- images / video ---------------- */

export function drawImageCover(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource & { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number },
  x: number,
  y: number,
  w: number,
  h: number,
  r = 24,
  mirror = false,
  contain = false,
) {
  const sw = (src as HTMLVideoElement).videoWidth || (src as HTMLImageElement).naturalWidth || w;
  const sh = (src as HTMLVideoElement).videoHeight || (src as HTMLImageElement).naturalHeight || h;
  if (!sw || !sh) return;
  const scale = contain ? Math.min(w / sw, h / sh) : Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.save();
  rr(ctx, x, y, w, h, r);
  ctx.clip();
  if (contain) {
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, h);
  }
  if (mirror) {
    ctx.translate(x + w / 2, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(x + w / 2), 0);
  }
  ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

const AV_COLORS = ['#1a73e8', '#ea4335', '#34a853', '#f9ab00', '#a142f4', '#12b5cb', '#e8710a'];
export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('');
}

export function avatar(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, r: number) {
  const c = AV_COLORS[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AV_COLORS.length];
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = c;
  ctx.fill();
  text(ctx, initials(name) || '?', cx, cy + r * 0.02, { size: r * 0.8, weight: 500, align: 'center', base: 'middle' });
}

export function isVideoReady(v?: HTMLVideoElement) {
  return !!v && v.readyState >= 2 && v.videoWidth > 0;
}

/** A participant tile: video (or avatar), name tag, mic state. */
export function participantTile(rc: RenderCtx, p: Participant, x: number, y: number, w: number, h: number, r = 24) {
  const { ctx } = rc;
  const src = rc.videos.get(p.id);
  card(ctx, x, y, w, h, { fill: '#1d2440', r });
  if (!p.camOff && isVideoReady(src?.cam)) drawImageCover(ctx, src!.cam!, x, y, w, h, r, !!src!.mirror);
  else avatar(ctx, p.name, x + w / 2, y + h / 2, Math.min(w, h) * 0.17);
  // speaking ring is drawn by renderer via level map; name tag
  const tagH = Math.max(36, Math.min(54, h * 0.09));
  const fs = tagH * 0.5;
  const tw = measure(ctx, p.name, { size: fs, weight: 500 }) + tagH * 1.1 + (p.muted ? tagH : 0);
  ctx.save();
  rr(ctx, x + 16, y + h - tagH - 16, tw, tagH, 10);
  ctx.fillStyle = 'rgba(10,14,30,0.78)';
  ctx.fill();
  ctx.fillStyle = rc.accent;
  rr(ctx, x + 16, y + h - tagH - 16, 6, tagH, 3);
  ctx.fill();
  ctx.restore();
  text(ctx, p.name, x + 16 + tagH * 0.55, y + h - 16 - tagH / 2 + 1, { size: fs, weight: 500, base: 'middle' });
  if (p.muted) {
    const mx = x + 16 + tw - tagH * 0.7;
    const my = y + h - 16 - tagH / 2;
    ctx.beginPath();
    ctx.arc(mx, my, tagH * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = COL.red;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(mx - tagH * 0.13, my - tagH * 0.13);
    ctx.lineTo(mx + tagH * 0.13, my + tagH * 0.13);
    ctx.stroke();
  }
}

/** Grid layout rectangles for n tiles in a box. */
export function gridRects(n: number, x: number, y: number, w: number, h: number, gap = 24) {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  if (n <= 0) return rects;
  const rowsSpec = n === 1 ? [1] : n === 2 ? [2] : n === 3 ? [3] : n === 4 ? [2, 2] : n === 5 ? [3, 2] : [3, 3];
  const rows = rowsSpec.length;
  const rh = (h - gap * (rows - 1)) / rows;
  let idx = 0;
  rowsSpec.forEach((cols, ri) => {
    let cw = (w - gap * (cols - 1)) / cols;
    let th = rh;
    // keep tiles 16:9-ish
    if (cw / th > 16 / 9) cw = th * (16 / 9);
    else th = cw / (16 / 9);
    const rowW = cw * cols + gap * (cols - 1);
    const ox = x + (w - rowW) / 2;
    const oy = y + ri * (rh + gap) + (rh - th) / 2;
    for (let c = 0; c < cols && idx < n; c++, idx++) rects.push({ x: ox + c * (cw + gap), y: oy, w: cw, h: th });
  });
  return rects;
}

/* ---------------- cricket widgets ---------------- */

export function chipColor(label: string) {
  if (label === 'W') return COL.red;
  if (label === '6') return COL.purple;
  if (label === '4') return COL.gblue;
  if (/wd|nb|lb|b$/.test(label)) return '#e37400';
  if (label === '•') return '#3c4566';
  return '#2b8a4b';
}

export function ballChip(ctx: CanvasRenderingContext2D, label: string, cx: number, cy: number, r: number, p = 1) {
  if (p <= 0) return;
  ctx.save();
  ctx.translate(cx, cy);
  const s = easeBack(p);
  ctx.scale(s, s);
  ctx.globalAlpha *= clamp(p * 1.5);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = chipColor(label);
  ctx.fill();
  if (label === '4' || label === '6' || label === 'W') {
    ctx.lineWidth = r * 0.12;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.stroke();
  }
  const fs = label.length > 2 ? r * 0.62 : label.length > 1 ? r * 0.78 : r * 0.95;
  text(ctx, label, 0, r * 0.04, { size: fs, weight: 700, align: 'center', base: 'middle', font: 'cond' });
  ctx.restore();
}

export function teamBadge(rc: RenderCtx, team: { abbr: string; logo?: string; color?: string } | undefined, cx: number, cy: number, r: number) {
  const { ctx } = rc;
  if (!team) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  const img = rc.img(team.logo);
  if (img) {
    ctx.clip();
    const s = r * 1.55;
    ctx.drawImage(img, cx - s / 2, cy - s / 2, s, s);
  } else {
    ctx.fillStyle = teamColor(team as TeamInfo);
    ctx.fill();
    text(ctx, team.abbr.slice(0, 4), cx, cy + 1, { size: r * (team.abbr.length > 3 ? 0.55 : 0.7), weight: 800, align: 'center', base: 'middle', font: 'cond' });
  }
  ctx.restore();
}

export function headshot(rc: RenderCtx, name: string, url: string | undefined, cx: number, cy: number, r: number, ring?: string) {
  const { ctx } = rc;
  const img = rc.img(url);
  ctx.save();
  if (ring) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.fillStyle = ring;
    ctx.fill();
  }
  if (img) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e8eaed';
    ctx.fill();
    ctx.clip();
    const s = r * 2.1;
    ctx.drawImage(img, cx - s / 2, cy - r * 0.95, s, s);
  } else avatar(ctx, name, cx, cy, r);
  ctx.restore();
}

/** Section header used across data scenes */
export function sceneTitle(rc: RenderCtx, title: string, sub?: string) {
  const { ctx, age } = rc;
  fx(ctx, enter(age, 0, 0, 450, 0), () => {
    ctx.fillStyle = rc.accent;
    rr(ctx, 120, 92, 10, 64, 5);
    ctx.fill();
    text(ctx, title, 152, 142, { size: 56, weight: 700 });
    if (sub) text(ctx, sub, 152 + measure(ctx, title, { size: 56, weight: 700 }) + 28, 140, { size: 30, weight: 400, color: COL.sub, max: 900 });
  }, 0, -40);
  const m = rc.match;
  if (m) {
    fx(ctx, enter(age, 1, 0, 450, 60), () => {
      const t0 = m.teams[0];
      const t1 = m.teams[1];
      teamBadge(rc, t0, W - 290, 124, 30);
      teamBadge(rc, t1, W - 150, 124, 30);
      text(ctx, 'v', W - 220, 134, { size: 26, color: COL.sub, align: 'center' });
    });
  }
}

export function fmtOvers(o: number) {
  return Number.isInteger(o) ? String(o) : o.toFixed(1);
}

export function inningsLabel(m: MatchDetail, num: number) {
  const inn = m.innings.find((i) => i.number === num);
  return inn ? `${inn.teamName} · ${inn.runs}/${inn.wickets} (${fmtOvers(inn.overs)} ov)` : '';
}
