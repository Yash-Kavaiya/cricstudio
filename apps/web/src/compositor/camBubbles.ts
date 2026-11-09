// Camera frames over the program: cricket ball, square, stumps, and the other shapes.
import {
  applyBubblePatch,
  bubbleInset,
  bubbleLayout,
  bubbleNameHeight,
  onStagePeople,
  type CamBubbleShape,
  type MatchDetail,
  type SceneId,
  type StudioState,
} from '@cricstudio/shared';
import { W, avatar, clamp, drawImageCover, easeBack, isVideoReady, measure, rr, text, type RenderCtx } from './draw';
import { NO_SCOREBUG_SCENES, NO_TICKER_SCENES } from './scenes';

/** Scenes that already show the cameras full size. Frames skip these only when the host turns that off. */
export const CAMERA_SCENES: SceneId[] = ['hostSolo', 'panel', 'commentaryDesk', 'screenShare'];

export function bubblesVisible(state: StudioState): boolean {
  if (!state.brand.camBubbles) return false;
  if (state.brand.camBubblesAllScenes === false && CAMERA_SCENES.includes(state.scene)) return false;
  return onStagePeople(state.participants).length > 0;
}

/** Same bar the scorebug uses, so a dragged frame lands where it is drawn. */
function programBarOn(state: StudioState, match: MatchDetail | null): boolean {
  if (NO_SCOREBUG_SCENES.includes(state.scene)) return false;
  const banner = state.banner;
  if (banner) {
    const active = banner.kind === 'sponsor' ? !!state.brand.sponsors?.some(Boolean) : !!match;
    if (active) return true;
  }
  return !!state.brand.showScorebug && !!match?.innings.some((i) => i.number === match.currentInnings);
}

/** Boxes for the people on stage. `draft` is a frame currently being dragged, before it is saved. */
export function liveBubbleBoxes(state: StudioState, match: MatchDetail | null, draft?: { id: string; x: number; y: number }) {
  const tickerOn = !!state.brand.showTicker && !NO_TICKER_SCENES.includes(state.scene);
  const brand = draft
    ? { ...state.brand, camBubbleSlots: applyBubblePatch(state.brand.camBubbleSlots, draft.id, { x: draft.x, y: draft.y }) }
    : state.brand;
  return bubbleLayout(onStagePeople(state.participants), brand, bubbleInset(programBarOn(state, match), tickerOn));
}

/** Red leather ring with a stitched seam and a gloss highlight around a circular camera. */
function cricketBallRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const ring = Math.max(8, r * 0.13);
  const mid = r + ring / 2;

  const g = ctx.createLinearGradient(cx - mid, cy - mid, cx + mid, cy + mid);
  g.addColorStop(0, '#e63946');
  g.addColorStop(0.55, '#b5121b');
  g.addColorStop(1, '#6d070c');
  ctx.beginPath();
  ctx.arc(cx, cy, mid, 0, Math.PI * 2);
  ctx.lineWidth = ring;
  ctx.strokeStyle = g;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, mid, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.5, ring * 0.12);
  ctx.strokeStyle = 'rgba(60,0,4,0.65)';
  ctx.stroke();

  const n = Math.max(24, Math.round((mid * Math.PI * 2) / (ring * 0.62)));
  const len = ring * 0.26;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.2, ring * 0.1);
  ctx.strokeStyle = 'rgba(255,248,240,0.92)';
  for (const side of [-1, 1]) {
    const rr0 = mid + side * ring * 0.24;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const tilt = side * 0.55;
      const dx = -sa * Math.cos(tilt) + ca * Math.sin(tilt);
      const dy = ca * Math.cos(tilt) + sa * Math.sin(tilt);
      const px = cx + ca * rr0;
      const py = cy + sa * rr0;
      ctx.moveTo(px - (dx * len) / 2, py - (dy * len) / 2);
      ctx.lineTo(px + (dx * len) / 2, py + (dy * len) / 2);
    }
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, mid, Math.PI * 1.08, Math.PI * 1.42);
  ctx.lineWidth = ring * 0.32;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.stroke();
}

function traceShape(ctx: CanvasRenderingContext2D, shape: CamBubbleShape, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (shape === 'ball') ctx.arc(cx, cy, Math.min(w, h) / 2, 0, Math.PI * 2);
  else if (shape === 'square') ctx.rect(x, y, w, h);
  else if (shape === 'rounded' || shape === 'wide') ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.18);
  else if (shape === 'stumps') ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.06);
  else if (shape === 'oval') ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (shape === 'diamond') {
    ctx.moveTo(cx, y);
    ctx.lineTo(x + w, cy);
    ctx.lineTo(cx, y + h);
    ctx.lineTo(x, cy);
    ctx.closePath();
  } else {
    ctx.moveTo(x + w * 0.08, y + h * 0.06);
    ctx.lineTo(x + w * 0.92, y + h * 0.06);
    ctx.lineTo(x + w * 0.92, y + h * 0.55);
    ctx.lineTo(cx, y + h * 0.96);
    ctx.lineTo(x + w * 0.08, y + h * 0.55);
    ctx.closePath();
  }
}

/** Portrait window inside the wood. One picture, not a split between the posts. */
function stumpWindow(x: number, y: number, w: number, h: number) {
  return { x: x + w * 0.12, y: y + h * 0.14, w: w * 0.76, h: h * 0.8 };
}

function paintUnder(ctx: CanvasRenderingContext2D, shape: CamBubbleShape, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  if (shape === 'ball') {
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, (w / 2) * 1.13, 0, Math.PI * 2);
  } else traceShape(ctx, shape, x, y, w, h);
  ctx.fillStyle = '#1d2440';
  ctx.fill();
  ctx.restore();
}

function strokeShape(ctx: CanvasRenderingContext2D, shape: CamBubbleShape, x: number, y: number, w: number, h: number, width: number, color: string) {
  traceShape(ctx, shape, x, y, w, h);
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function paintStumps(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const win = stumpWindow(x, y, w, h);
  const rad = Math.min(w, h) * 0.06;
  const wood = ctx.createLinearGradient(x, y, x + w, y + h);
  wood.addColorStop(0, '#6b3e1e');
  wood.addColorStop(0.18, '#e4c392');
  wood.addColorStop(0.48, '#8d5a2b');
  wood.addColorStop(0.72, '#c9955a');
  wood.addColorStop(1, '#4e2c12');
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rad);
  ctx.roundRect(win.x, win.y, win.w, win.h, 3);
  ctx.fillStyle = wood;
  ctx.fill('evenodd');
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rad);
  ctx.roundRect(win.x, win.y, win.w, win.h, 3);
  ctx.clip('evenodd');
  ctx.strokeStyle = 'rgba(70,32,10,0.35)';
  ctx.lineWidth = 1.5;
  for (let i = 1; i < 9; i++) {
    const gx = x + (w * i) / 9;
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx + w * 0.015, y + h);
    ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(win.x, win.y, win.w, win.h, 3);
  ctx.strokeStyle = 'rgba(40,18,6,0.9)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rad);
  ctx.strokeStyle = '#3d2412';
  ctx.lineWidth = 3;
  ctx.stroke();
  const bailH = Math.max(5, h * 0.038);
  const bailY = y + h * 0.048;
  const gap = w * 0.07;
  const bailW = w * 0.32;
  const left = x + (w - bailW * 2 - gap) / 2;
  ctx.fillStyle = '#f7f4ee';
  ctx.strokeStyle = '#b7b1a4';
  ctx.lineWidth = 1;
  for (const ox of [left, left + bailW + gap]) {
    ctx.beginPath();
    ctx.roundRect(ox, bailY, bailW, bailH, bailH / 2);
    ctx.fill();
    ctx.stroke();
  }
}

function paintRing(ctx: CanvasRenderingContext2D, shape: CamBubbleShape, x: number, y: number, w: number, h: number) {
  if (shape === 'ball') {
    cricketBallRing(ctx, x + w / 2, y + h / 2, w / 2);
    return;
  }
  if (shape === 'stumps') {
    paintStumps(ctx, x, y, w, h);
    return;
  }
  const outer = shape === 'shield' ? '#e8c56b' : '#f4f7fb';
  const inner = shape === 'shield' ? '#fff6d8' : '#14182a';
  const t = Math.max(6, Math.min(w, h) * (shape === 'square' ? 0.04 : 0.045));
  strokeShape(ctx, shape, x, y, w, h, t, outer);
  const inset = t * 0.7;
  if (w > inset * 3 && h > inset * 3) strokeShape(ctx, shape, x + inset, y + inset, w - inset * 2, h - inset * 2, Math.max(2, t * 0.38), inner);
}

/**
 * Frame chrome never changes for a given shape and size, so it is drawn once into a sprite.
 * Per frame we only blit it — no shadowBlur or stitch strokes on the program canvas.
 */
type Sprite = { under: CanvasImageSource; ring: CanvasImageSource; pad: number };
const sprites = new Map<string, Sprite>();
function bubbleSprite(shape: CamBubbleShape, w: number, h: number): Sprite {
  const rw = Math.max(1, Math.round(w));
  const rh = Math.max(1, Math.round(h));
  const key = `${shape}:${rw}x${rh}`;
  const cached = sprites.get(key);
  if (cached) return cached;
  const pad = shape === 'ball' ? Math.ceil((rw / 2) * 0.13 + 48) : 48;
  const under = document.createElement('canvas');
  under.width = rw + pad * 2;
  under.height = rh + pad * 2;
  paintUnder(under.getContext('2d')!, shape, pad, pad, rw, rh);
  const ring = document.createElement('canvas');
  ring.width = under.width;
  ring.height = under.height;
  paintRing(ring.getContext('2d')!, shape, pad, pad, rw, rh);
  const made: Sprite = { under, ring, pad };
  if (typeof createImageBitmap === 'function') {
    void Promise.all([createImageBitmap(under), createImageBitmap(ring)])
      .then(([u2, r2]) => {
        made.under = u2;
        made.ring = r2;
      })
      .catch(() => undefined);
  }
  if (sprites.size > 32) sprites.delete(sprites.keys().next().value!);
  sprites.set(key, made);
  return made;
}

function paintFeed(
  ctx: CanvasRenderingContext2D,
  name: string,
  cam: HTMLVideoElement | undefined,
  mirror: boolean,
  shape: CamBubbleShape,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (shape === 'stumps') {
    const win = stumpWindow(x, y, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(win.x, win.y, win.w, win.h, 3);
    ctx.clip();
    if (cam) drawImageCover(ctx, cam, win.x, win.y, win.w, win.h, 0, mirror);
    else {
      ctx.fillStyle = '#1d2440';
      ctx.fillRect(win.x, win.y, win.w, win.h);
    }
    ctx.restore();
    if (!cam) avatar(ctx, name, win.x + win.w / 2, win.y + win.h / 2, Math.min(win.w, win.h) * 0.28);
    return;
  }
  if (cam && shape === 'ball') {
    drawImageCover(ctx, cam, x, y, w, h, w / 2, mirror);
    return;
  }
  if (cam) {
    ctx.save();
    traceShape(ctx, shape, x, y, w, h);
    ctx.clip();
    drawImageCover(ctx, cam, x, y, w, h, 0, mirror);
    ctx.restore();
    return;
  }
  if (shape === 'ball') {
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#1d2440';
    ctx.fill();
  }
  avatar(ctx, name, x + w / 2, y + h / 2, Math.min(w, h) * 0.275);
}

/** Draws the frames. `p` is the 0..1 entrance for the moment they first appear. */
export function camBubbles(rc: RenderCtx, p: number) {
  if (p <= 0 || !bubblesVisible(rc.state)) return;
  const { ctx, state, now } = rc;
  const boxes = liveBubbleBoxes(state, rc.match);
  const people = new Map(onStagePeople(state.participants).map((person) => [person.id, person]));

  boxes.forEach((box, i) => {
    const person = people.get(box.id);
    if (!person) return;
    const local = clamp(p * 1.4 - i * 0.12);
    if (local <= 0) return;
    const w = Math.round(box.w);
    const h = Math.round(box.h);
    const x = box.x;
    const y = box.y;
    const shape = box.shape;
    const s = easeBack(local);
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.save();
    ctx.globalAlpha = clamp(local * 1.6);
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    if (shape === 'ball') ctx.rotate((1 - local) * (cx > W / 2 ? 1.2 : -1.2));
    ctx.translate(-cx, -cy);

    const sp = bubbleSprite(shape, w, h);
    ctx.drawImage(sp.under, x - sp.pad, y - sp.pad);
    const src = rc.videos.get(person.id);
    const cam = !person.camOff && isVideoReady(src?.cam) ? src!.cam : undefined;
    paintFeed(ctx, person.name, cam, !!src?.mirror, shape, x, y, w, h);
    if (shape === 'ball') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((now / 9000) % (Math.PI * 2));
      ctx.drawImage(sp.ring, -w / 2 - sp.pad, -h / 2 - sp.pad);
      ctx.restore();
    } else ctx.drawImage(sp.ring, x - sp.pad, y - sp.pad);

    const nameH = bubbleNameHeight(w, h);
    const fs = nameH * 0.52;
    const label = person.name.length > 18 ? `${person.name.slice(0, 17)}…` : person.name;
    const tw = Math.min(w * 1.25, measure(ctx, label, { size: fs, weight: 600 }) + nameH);
    const ty = y + h + Math.min(w, h) * 0.065 + 6;
    rr(ctx, cx - tw / 2, ty, tw, nameH, nameH / 2);
    ctx.fillStyle = 'rgba(8,12,26,0.82)';
    ctx.fill();
    text(ctx, label, cx, ty + nameH / 2 + 1, { size: fs, weight: 600, align: 'center', base: 'middle', max: tw - nameH * 0.6 });
    if (person.muted) {
      const br = Math.max(9, Math.min(w, h) * 0.065);
      const mx = shape === 'ball' ? cx + (w / 2) * 0.72 : x + w - br * 1.15;
      const my = shape === 'ball' ? cy + (h / 2) * 0.72 : y + h - br * 1.15;
      ctx.beginPath();
      ctx.arc(mx, my, br, 0, Math.PI * 2);
      ctx.fillStyle = '#d93025';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    ctx.restore();
  });
}
