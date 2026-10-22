// Round "cricket ball" camera bubbles: the host & guests stay on screen over every data scene.
import type { CamBubbleCorner, SceneId } from '@cricstudio/shared';
import { H, W, avatar, clamp, drawImageCover, easeBack, isVideoReady, measure, rr, text, type RenderCtx } from './draw';

/** Scenes that already show the cameras full size — no bubbles there. */
export const CAMERA_SCENES: SceneId[] = ['hostSolo', 'panel', 'commentaryDesk', 'screenShare'];

const TICKER_H = 56;
const MARGIN = 36;
const GAP = 22;

/** Red leather ring with a stitched seam and a gloss highlight around a circular camera. */
function cricketBallRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const ring = Math.max(8, r * 0.13);
  const mid = r + ring / 2;

  // leather
  const g = ctx.createLinearGradient(cx - mid, cy - mid, cx + mid, cy + mid);
  g.addColorStop(0, '#e63946');
  g.addColorStop(0.55, '#b5121b');
  g.addColorStop(1, '#6d070c');
  ctx.beginPath();
  ctx.arc(cx, cy, mid, 0, Math.PI * 2);
  ctx.lineWidth = ring;
  ctx.strokeStyle = g;
  ctx.stroke();

  // seam groove
  ctx.beginPath();
  ctx.arc(cx, cy, mid, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.5, ring * 0.12);
  ctx.strokeStyle = 'rgba(60,0,4,0.65)';
  ctx.stroke();

  // two rows of slanted stitches either side of the groove; drifts slowly like a spinning ball
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
      const tilt = side * 0.55; // stitches lean away from the seam
      const dx = -sa * Math.cos(tilt) + ca * Math.sin(tilt);
      const dy = ca * Math.cos(tilt) + sa * Math.sin(tilt);
      const px = cx + ca * rr0;
      const py = cy + sa * rr0;
      ctx.moveTo(px - (dx * len) / 2, py - (dy * len) / 2);
      ctx.lineTo(px + (dx * len) / 2, py + (dy * len) / 2);
    }
    ctx.stroke();
  }

  // gloss highlight (top-left, like a new ball)
  ctx.beginPath();
  ctx.arc(cx, cy, mid, Math.PI * 1.08, Math.PI * 1.42);
  ctx.lineWidth = ring * 0.32;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.stroke();
}

/**
 * The leather ring, seam, gloss and drop shadow never change for a given size, so they are drawn
 * once into a sprite. Per frame we only blit it — no shadowBlur or ~100 stitch strokes on the
 * program canvas, which keeps CPU free for the H.264 encoder.
 */
type Sprite = { under: CanvasImageSource; ring: CanvasImageSource; pad: number };
const sprites = new Map<number, Sprite>();
function bubbleSprite(size: number) {
  const key = Math.round(size);
  let sp = sprites.get(key);
  if (sp) return sp;
  const r = key / 2;
  const pad = Math.ceil(r * 0.13 + 48); // ring + shadow blur/offset
  const dim = key + pad * 2;
  const c = r + pad;
  // shadow + dark base under the camera
  const under = document.createElement('canvas');
  under.width = under.height = dim;
  const u = under.getContext('2d')!;
  u.shadowColor = 'rgba(0,0,0,0.5)';
  u.shadowBlur = 28;
  u.shadowOffsetY = 10;
  u.beginPath();
  u.arc(c, c, r * 1.13, 0, Math.PI * 2);
  u.fillStyle = '#1d2440';
  u.fill();
  // ring drawn over the camera
  const ring = document.createElement('canvas');
  ring.width = ring.height = dim;
  cricketBallRing(ring.getContext('2d')!, c, c, r);
  const made: Sprite = { under, ring, pad };
  sp = made;
  // immutable GPU-resident copies: blitting a bitmap avoids re-uploading the canvas every frame
  if (typeof createImageBitmap === 'function') {
    void Promise.all([createImageBitmap(under), createImageBitmap(ring)])
      .then(([u2, r2]) => {
        made.under = u2;
        made.ring = r2;
      })
      .catch(() => undefined);
  }
  if (sprites.size > 8) sprites.delete(sprites.keys().next().value!);
  sprites.set(key, sp);
  return sp;
}

function bubbleRects(n: number, d: number, corner: CamBubbleCorner, bottomInset: number) {
  // shrink when the row would not fit across the frame
  const maxRow = W - MARGIN * 2;
  const size = Math.min(d, (maxRow - GAP * (n - 1)) / n);
  const right = corner === 'br' || corner === 'tr';
  const bottom = corner === 'br' || corner === 'bl';
  const nameH = Math.max(28, size * 0.16);
  const y = bottom ? H - bottomInset - MARGIN - nameH - size : 104; // top: below the brand bug
  return Array.from({ length: n }, (_, i) => ({
    x: right ? W - MARGIN - size - i * (size + GAP) : MARGIN + i * (size + GAP),
    y,
    size,
    nameH,
  }));
}

/** Draws the bubbles; `p` is the 0..1 entrance progress for the current scene. */
export function camBubbles(rc: RenderCtx, p: number, tickerOn: boolean, barOn = false) {
  const { ctx, state, now } = rc;
  const b = state.brand;
  if (!b.camBubbles || p <= 0 || CAMERA_SCENES.includes(state.scene)) return;
  const people = rc.stage.slice(0, 5);
  if (!people.length) return;
  const corner = b.camBubbleCorner ?? 'br';
  // sit above the scorebug / lower banner (its top tab starts at y≈862)
  const rects = bubbleRects(people.length, b.camBubbleSize ?? 220, corner, barOn ? H - 850 : tickerOn ? TICKER_H : 0);
  const right = corner === 'br' || corner === 'tr';

  people.forEach((person, i) => {
    const { x, y, size, nameH } = rects[i];
    const local = clamp(p * 1.4 - i * 0.12);
    if (local <= 0) return;
    const s = easeBack(local);
    const r = size / 2;
    const cx = x + r;
    const cy = y + r;
    ctx.save();
    ctx.globalAlpha = clamp(local * 1.6);
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.rotate((1 - local) * (right ? 1.2 : -1.2)); // rolls in like a ball
    ctx.translate(-cx, -cy);

    const sp = bubbleSprite(size);
    ctx.drawImage(sp.under, x - sp.pad, y - sp.pad);

    const src = rc.videos.get(person.id);
    if (!person.camOff && isVideoReady(src?.cam)) drawImageCover(ctx, src!.cam!, x, y, size, size, r, !!src!.mirror);
    else {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#1d2440';
      ctx.fill();
      avatar(ctx, person.name, cx, cy, r * 0.55);
    }
    // ring turns slowly like a spinning ball (rotating a cached sprite is cheap)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((now / 9000) % (Math.PI * 2));
    ctx.drawImage(sp.ring, -r - sp.pad, -r - sp.pad);
    ctx.restore();

    // name pill under the ball
    const fs = nameH * 0.52;
    const label = person.name.length > 18 ? `${person.name.slice(0, 17)}…` : person.name;
    const tw = Math.min(size * 1.25, measure(ctx, label, { size: fs, weight: 600 }) + nameH);
    const ty = y + size + r * 0.13 + 6;
    rr(ctx, cx - tw / 2, ty, tw, nameH, nameH / 2);
    ctx.fillStyle = 'rgba(8,12,26,0.82)';
    ctx.fill();
    text(ctx, label, cx, ty + nameH / 2 + 1, { size: fs, weight: 600, align: 'center', base: 'middle', max: tw - nameH * 0.6 });
    if (person.muted) {
      ctx.beginPath();
      ctx.arc(cx + r * 0.72, cy + r * 0.72, Math.max(9, r * 0.13), 0, Math.PI * 2);
      ctx.fillStyle = '#d93025';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    ctx.restore();
  });
}
