// Scene-to-scene transitions. `from`/`to` are fully rendered 1920x1080 frames; p = 0..1.
import type { TransitionId } from '@cricstudio/shared';

const W = 1920;
const H = 1080;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t: number) => 1 - (1 - clamp(t)) ** 3;

export const TRANSITION_MS: Record<TransitionId, number> = {
  fadeZoom: 750,
  slideLeft: 700,
  wipeDiagonal: 800,
  circleReveal: 850,
  blinds: 900,
  flip3d: 900,
  pushUp: 700,
  stingerBall: 1000,
  glitch: 600,
  zoomBlur: 800,
};

function ball(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#ff6b6b');
  g.addColorStop(0.5, '#c1121f');
  g.addColorStop(1, '#5c0611');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,245,230,0.9)';
  ctx.lineWidth = r * 0.05;
  for (const o of [-0.12, 0.12]) {
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.98, r * (0.32 + o), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawTransition(
  ctx: CanvasRenderingContext2D,
  id: TransitionId,
  from: HTMLCanvasElement,
  to: HTMLCanvasElement,
  pRaw: number,
  accent: string,
) {
  const p = clamp(pRaw);
  const e = easeInOut(p);
  ctx.save();
  switch (id) {
    case 'slideLeft': {
      ctx.drawImage(from, -W * e, 0);
      ctx.drawImage(to, W * (1 - e), 0);
      ctx.fillStyle = accent;
      ctx.fillRect(W * (1 - e) - 14, 0, 14, H);
      break;
    }
    case 'pushUp': {
      ctx.drawImage(from, 0, -H * e);
      ctx.drawImage(to, 0, H * (1 - e));
      break;
    }
    case 'wipeDiagonal': {
      ctx.drawImage(from, 0, 0);
      const x = -H + (W + H * 2) * e;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x - H, H);
      ctx.lineTo(-H * 2, H);
      ctx.lineTo(-H * 2, 0);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(to, 0, 0);
      ctx.restore();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 28;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x - H, H);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x + 26, 0);
      ctx.lineTo(x - H + 26, H);
      ctx.stroke();
      break;
    }
    case 'circleReveal': {
      ctx.drawImage(from, 0, 0);
      const r = Math.hypot(W, H) * 0.6 * e;
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(to, 0, 0);
      ctx.restore();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 16 * (1 - e) + 2;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'blinds': {
      ctx.drawImage(from, 0, 0);
      const n = 12;
      const bw = W / n;
      for (let i = 0; i < n; i++) {
        const local = easeOut((p - i * 0.035) / 0.55);
        if (local <= 0) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(i * bw + (bw * (1 - local)) / 2, 0, bw * local + 1, H);
        ctx.clip();
        ctx.drawImage(to, 0, 0);
        ctx.restore();
      }
      break;
    }
    case 'flip3d': {
      const first = p < 0.5;
      const k = first ? 1 - easeOut(p * 2) : easeOut((p - 0.5) * 2);
      const img = first ? from : to;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.translate(W / 2, H / 2);
      ctx.scale(Math.max(0.001, k), 1 - (1 - k) * 0.08);
      ctx.drawImage(img, -W / 2, -H / 2);
      ctx.fillStyle = `rgba(0,0,0,${(1 - k) * 0.6})`;
      ctx.fillRect(-W / 2, -H / 2, W, H);
      break;
    }
    case 'stingerBall': {
      const bx = -300 + (W + 600) * easeInOut(p);
      ctx.drawImage(from, 0, 0);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, Math.max(0, bx), H);
      ctx.clip();
      ctx.drawImage(to, 0, 0);
      ctx.restore();
      // motion trail
      const tg = ctx.createLinearGradient(bx - 900, 0, bx, 0);
      tg.addColorStop(0, 'rgba(193,18,31,0)');
      tg.addColorStop(1, 'rgba(255,255,255,0.55)');
      ctx.fillStyle = tg;
      ctx.fillRect(bx - 900, H / 2 - 150, 900, 300);
      ball(ctx, bx, H / 2 + Math.sin(p * Math.PI) * -120, 260, p * 14);
      break;
    }
    case 'glitch': {
      const src = p < 0.5 ? from : to;
      ctx.drawImage(src, 0, 0);
      const strength = Math.sin(p * Math.PI);
      for (let i = 0; i < 18; i++) {
        const y = Math.floor(Math.random() * H);
        const h = 10 + Math.random() * 70;
        const dx = (Math.random() - 0.5) * 220 * strength;
        ctx.drawImage(Math.random() < 0.5 ? from : to, 0, y, W, h, dx, y, W, h);
      }
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.35 * strength;
      ctx.drawImage(src, 12 * strength, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      break;
    }
    case 'zoomBlur': {
      ctx.drawImage(from, 0, 0);
      for (let k = 0; k < 4; k++) {
        const s = 1 + (1 - e) * (0.35 - k * 0.07);
        ctx.save();
        ctx.globalAlpha = e * (0.3 + k * 0.18);
        ctx.translate(W / 2, H / 2);
        ctx.scale(s, s);
        ctx.drawImage(to, -W / 2, -H / 2);
        ctx.restore();
      }
      ctx.globalAlpha = e;
      ctx.drawImage(to, 0, 0);
      break;
    }
    case 'fadeZoom':
    default: {
      ctx.drawImage(from, 0, 0);
      ctx.globalAlpha = e;
      const sc = 1.05 - 0.05 * e;
      ctx.translate(W / 2, H / 2);
      ctx.scale(sc, sc);
      ctx.drawImage(to, -W / 2, -H / 2);
    }
  }
  ctx.restore();
}
