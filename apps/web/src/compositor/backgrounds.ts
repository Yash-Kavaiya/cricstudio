// Animated broadcast backgrounds. Heavy static textures are rendered once into cached
// offscreen canvases; per-frame work is a handful of gradients/paths (cheap at 30fps).
import type { BackgroundId } from '@cricstudio/shared';
import type { RenderCtx } from './draw';

const W = 1920;
const H = 1080;

function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const cache = new Map<string, HTMLCanvasElement>();
function cached(key: string, w: number, h: number, paint: (g: CanvasRenderingContext2D) => void) {
  let c = cache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    paint(c.getContext('2d')!);
    cache.set(key, c);
  }
  return c;
}

/** deterministic 0..1 noise */
const rnd = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

function linear(ctx: CanvasRenderingContext2D, stops: [number, string][], x0 = 0, y0 = 0, x1 = 0, y1 = H) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, c);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function vignette(ctx: CanvasRenderingContext2D, a = 0.55) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/* ---------------- templates ---------------- */

function stadiumNight(rc: RenderCtx, accent: string) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#02040d'],
    [0.55, '#0b1633'],
    [1, '#0d2a1a'],
  ]);
  // floodlight towers with volumetric cones
  const towers = [
    [160, 60],
    [560, 20],
    [W - 560, 20],
    [W - 160, 60],
  ];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  towers.forEach(([x, y], i) => {
    const flick = 0.85 + 0.15 * Math.sin(now / 900 + i * 2.1);
    const tx = W / 2 + (x - W / 2) * 0.2;
    const g = ctx.createLinearGradient(x, y, tx, H);
    g.addColorStop(0, `rgba(220,235,255,${0.32 * flick})`);
    g.addColorStop(1, 'rgba(220,235,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 18, y);
    ctx.lineTo(x + 18, y);
    ctx.lineTo(tx + 420, H);
    ctx.lineTo(tx - 420, H);
    ctx.closePath();
    ctx.fill();
    glow(ctx, x, y, 140, `rgba(255,255,255,${0.55 * flick})`);
    // lamp grid
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
      ctx.fillStyle = `rgba(255,255,240,${0.9 * flick})`;
      ctx.fillRect(x - 30 + c * 13, y - 14 + r * 10, 9, 6);
    }
  });
  ctx.restore();
  // crowd bokeh
  const bokeh = cached('bokeh', W, 420, (g) => {
    for (let i = 0; i < 520; i++) {
      const x = rnd(i) * W;
      const y = 120 + rnd(i + 999) * 300;
      const r = 2 + rnd(i + 77) * 7;
      const hue = rnd(i + 5) > 0.7 ? '255,210,120' : rnd(i + 6) > 0.5 ? '170,200,255' : '255,255,255';
      const gr = g.createRadialGradient(x, y, 0, x, y, r * 2.2);
      gr.addColorStop(0, `rgba(${hue},0.55)`);
      gr.addColorStop(1, `rgba(${hue},0)`);
      g.fillStyle = gr;
      g.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
    }
  });
  ctx.save();
  ctx.globalAlpha = 0.55 + 0.1 * Math.sin(now / 1300);
  ctx.drawImage(bokeh, 0, H - 470);
  ctx.restore();
  // field oval
  const g = ctx.createRadialGradient(W / 2, H + 380, 100, W / 2, H + 380, 1000);
  g.addColorStop(0, 'rgba(52,168,83,0.45)');
  g.addColorStop(1, 'rgba(52,168,83,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H - 520, W, 520);
  glow(ctx, W * 0.5 + Math.sin(now / 4000) * 300, H * 0.35, 700, hexA(accent, 0.16));
  vignette(ctx, 0.5);
}

function pitchGreen(rc: RenderCtx) {
  const { ctx, now } = rc;
  const grass = cached('grass', W, H, (g) => {
    const vp = { x: W / 2, y: -900 };
    for (let i = -14; i < 14; i++) {
      g.beginPath();
      g.moveTo(vp.x, vp.y);
      g.lineTo(W / 2 + i * 260, H);
      g.lineTo(W / 2 + (i + 1) * 260, H);
      g.closePath();
      g.fillStyle = i % 2 ? '#14532d' : '#166534';
      g.fill();
    }
    // texture specks
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(0,0,0,${rnd(i) * 0.12})`;
      g.fillRect(rnd(i + 1) * W, rnd(i + 2) * H, 2, 2);
    }
    // pitch strip + creases
    g.save();
    g.translate(W / 2, H);
    const strip = g.createLinearGradient(0, -H, 0, 0);
    strip.addColorStop(0, 'rgba(214,192,140,0)');
    strip.addColorStop(1, 'rgba(214,192,140,0.55)');
    g.fillStyle = strip;
    g.beginPath();
    g.moveTo(-60, -H * 0.85);
    g.lineTo(60, -H * 0.85);
    g.lineTo(260, 0);
    g.lineTo(-260, 0);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(-330, -140);
    g.lineTo(330, -140);
    g.moveTo(-90, -H * 0.72);
    g.lineTo(90, -H * 0.72);
    g.stroke();
    g.restore();
  });
  ctx.drawImage(grass, 0, 0);
  linear(ctx, [
    [0, 'rgba(2,8,4,0.92)'],
    [0.45, 'rgba(2,8,4,0.55)'],
    [1, 'rgba(2,8,4,0.25)'],
  ]);
  // moving sunlight sweep
  const x = ((now / 12) % (W + 1200)) - 600;
  const sw = ctx.createLinearGradient(x - 300, 0, x + 300, 0);
  sw.addColorStop(0, 'rgba(255,255,255,0)');
  sw.addColorStop(0.5, 'rgba(255,255,220,0.07)');
  sw.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sw;
  ctx.fillRect(0, 0, W, H);
  vignette(ctx, 0.6);
}

function aurora(rc: RenderCtx, accent: string) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#030712'],
    [1, '#0b1026'],
  ]);
  const stars = cached('stars', W, H, (g) => {
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + rnd(i) * 0.7})`;
      const s = rnd(i + 3) * 2 + 0.5;
      g.fillRect(rnd(i + 1) * W, rnd(i + 2) * H * 0.7, s, s);
    }
  });
  ctx.drawImage(stars, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const ribbons = [accent, '#34d399', '#a78bfa', '#22d3ee'];
  ribbons.forEach((c, k) => {
    const t = now / (5200 + k * 900);
    ctx.beginPath();
    const base = 300 + k * 140;
    ctx.moveTo(-100, base);
    for (let x = -100; x <= W + 100; x += 60) {
      const y = base + Math.sin(x / 260 + t * 2 + k) * 90 + Math.sin(x / 120 - t * 3) * 25;
      ctx.lineTo(x, y);
    }
    for (let x = W + 100; x >= -100; x -= 60) {
      const y = base + 260 + Math.sin(x / 300 + t * 1.6 + k * 2) * 70;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(0, base - 100, 0, base + 320);
    g.addColorStop(0, hexA(c, 0));
    g.addColorStop(0.35, hexA(c, 0.28));
    g.addColorStop(1, hexA(c, 0));
    ctx.fillStyle = g;
    ctx.fill();
  });
  ctx.restore();
  vignette(ctx, 0.45);
}

function neonGrid(rc: RenderCtx, accent: string) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#0d0221'],
    [0.55, '#2a0845'],
    [0.62, '#190633'],
    [1, '#0d0221'],
  ]);
  const hy = H * 0.58;
  // sun
  ctx.save();
  ctx.beginPath();
  ctx.arc(W / 2, hy, 230, Math.PI, 0);
  ctx.clip();
  const sg = ctx.createLinearGradient(0, hy - 230, 0, hy);
  sg.addColorStop(0, '#ffd166');
  sg.addColorStop(1, '#ff2ea6');
  ctx.fillStyle = sg;
  ctx.fillRect(W / 2 - 240, hy - 240, 480, 240);
  ctx.fillStyle = '#190633';
  for (let i = 0; i < 7; i++) ctx.fillRect(W / 2 - 240, hy - 20 - i * 28, 480, 4 + i * 1.5);
  ctx.restore();
  glow(ctx, W / 2, hy, 520, 'rgba(255,46,166,0.25)');
  // perspective floor grid
  ctx.save();
  ctx.strokeStyle = hexA(accent === '#1a73e8' ? '#22d3ee' : accent, 0.75);
  ctx.shadowColor = '#22d3ee';
  ctx.shadowBlur = 12;
  ctx.lineWidth = 2;
  for (let i = -24; i <= 24; i++) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + i * 22, hy);
    ctx.lineTo(W / 2 + i * 170, H);
    ctx.stroke();
  }
  const scroll = (now / 900) % 1;
  for (let k = 0; k < 14; k++) {
    const z = (k + scroll) / 14;
    const y = hy + (H - hy) * z * z;
    ctx.globalAlpha = 0.25 + 0.75 * z;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.restore();
  vignette(ctx, 0.4);
}

function constellation(rc: RenderCtx, accent: string) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#020617'],
    [1, '#0b1a3f'],
  ]);
  glow(ctx, W * 0.3, H * 0.3, 800, hexA(accent, 0.18));
  const n = 85;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const sp = 0.004 + rnd(i) * 0.012;
    const x = (rnd(i + 11) * W + Math.sin(now * sp * 0.05 + i) * 120 + now * sp * 2) % W;
    const y = (rnd(i + 23) * H + Math.cos(now * sp * 0.04 + i * 2) * 90) % H;
    pts.push([x, y]);
  }
  ctx.save();
  ctx.lineWidth = 1.2;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = pts[i][0] - pts[j][0];
      const dy = pts[i][1] - pts[j][1];
      const d2 = dx * dx + dy * dy;
      if (d2 < 220 * 220) {
        ctx.strokeStyle = `rgba(147,197,253,${0.28 * (1 - Math.sqrt(d2) / 220)})`;
        ctx.beginPath();
        ctx.moveTo(pts[i][0], pts[i][1]);
        ctx.lineTo(pts[j][0], pts[j][1]);
        ctx.stroke();
      }
    }
  }
  for (const [x, y] of pts) {
    ctx.fillStyle = 'rgba(219,234,254,0.85)';
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  vignette(ctx, 0.45);
}

function hexTech(rc: RenderCtx, accent: string) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#03121c'],
    [1, '#062a3a'],
  ]);
  const R = 46;
  const hw = Math.sqrt(3) * R;
  const grid = cached('hex', W, H, (g) => {
    g.strokeStyle = 'rgba(103,232,249,0.13)';
    g.lineWidth = 1.5;
    for (let row = -1; row < H / (R * 1.5) + 1; row++) {
      for (let col = -1; col < W / hw + 1; col++) {
        const cx = col * hw + (row % 2 ? hw / 2 : 0);
        const cy = row * R * 1.5;
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + (k * Math.PI) / 3;
          const x = cx + R * Math.cos(a);
          const y = cy + R * Math.sin(a);
          if (k) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.closePath();
        g.stroke();
      }
    }
  });
  ctx.drawImage(grid, 0, 0);
  // glowing cells
  const t = Math.floor(now / 140);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    const seed = i * 97 + Math.floor((t + i * 7) / 18);
    const row = Math.floor(rnd(seed) * (H / (R * 1.5)));
    const col = Math.floor(rnd(seed + 1) * (W / hw));
    const phase = ((t + i * 7) % 18) / 18;
    const a = Math.sin(phase * Math.PI) * 0.5;
    const cx = col * hw + (row % 2 ? hw / 2 : 0);
    const cy = row * R * 1.5;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const ang = Math.PI / 6 + (k * Math.PI) / 3;
      ctx.lineTo(cx + (R - 3) * Math.cos(ang), cy + (R - 3) * Math.sin(ang));
    }
    ctx.closePath();
    ctx.fillStyle = hexA(i % 3 ? '#22d3ee' : accent, a);
    ctx.fill();
  }
  ctx.restore();
  // scan line
  const sy = (now / 6) % (H + 200) - 100;
  const sg = ctx.createLinearGradient(0, sy - 80, 0, sy + 80);
  sg.addColorStop(0, 'rgba(34,211,238,0)');
  sg.addColorStop(0.5, 'rgba(34,211,238,0.10)');
  sg.addColorStop(1, 'rgba(34,211,238,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, sy - 80, W, 160);
  vignette(ctx, 0.55);
}

function liquidWaves(rc: RenderCtx, accent: string) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#050b1f'],
    [1, '#0b1f4a'],
  ]);
  glow(ctx, W * 0.75, H * 0.2, 700, hexA(accent, 0.22));
  const layers = [
    ['#1e3a8a', 0.55, 0.62],
    [accent, 0.35, 0.7],
    ['#0ea5e9', 0.3, 0.78],
    ['#1d4ed8', 0.6, 0.86],
  ] as const;
  layers.forEach(([c, a, yf], k) => {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 30) {
      const y = H * yf + Math.sin(x / (220 + k * 40) + now / (1600 - k * 200)) * (40 + k * 8) + Math.sin(x / 90 + now / 700 + k) * 8;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, H * yf - 60, 0, H);
    g.addColorStop(0, hexA(c, a));
    g.addColorStop(1, hexA('#020617', 0.9));
    ctx.fillStyle = g;
    ctx.fill();
  });
  vignette(ctx, 0.35);
}

function prism(rc: RenderCtx, accent: string) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#0f0a1f'],
    [1, '#1a1033'],
  ]);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const cols = [accent, '#ea4335', '#fbbc04', '#34a853', '#a142f4'];
  for (let i = 0; i < 9; i++) {
    const t = now / (9000 + i * 1300);
    const cx = W * rnd(i + 3) + Math.sin(t + i) * 160;
    const cy = H * rnd(i + 9) + Math.cos(t * 1.3 + i) * 120;
    const r = 260 + rnd(i) * 320;
    const rot = t * (i % 2 ? 1 : -1);
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = rot + (k * Math.PI * 2) / 3;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, hexA(cols[i % cols.length], 0.22));
    g.addColorStop(1, hexA(cols[(i + 2) % cols.length], 0.03));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.stroke();
  }
  ctx.restore();
  vignette(ctx, 0.5);
}

function teamClash(rc: RenderCtx) {
  const { ctx, now, match } = rc;
  const a = match?.teams[0]?.color ?? '#1a73e8';
  const b = match?.teams[1]?.color ?? '#ea4335';
  const lift = (c: string) => {
    const n = parseInt(c.replace('#', '').slice(0, 6), 16);
    if (!Number.isFinite(n)) return c;
    const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    return lum < 50 ? '#3b5bdb' : c;
  };
  const ca = lift(a);
  const cb = lift(b);
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, W, H);
  const off = Math.sin(now / 2600) * 60;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W * 0.56 + off, 0);
  ctx.lineTo(W * 0.44 + off, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.clip();
  linear(ctx, [
    [0, hexA(ca, 0.55)],
    [1, hexA(ca, 0.12)],
  ], 0, 0, W, 0);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(W * 0.56 + off, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, H);
  ctx.lineTo(W * 0.44 + off, H);
  ctx.closePath();
  ctx.clip();
  linear(ctx, [
    [0, hexA(cb, 0.12)],
    [1, hexA(cb, 0.55)],
  ], 0, 0, W, 0);
  ctx.restore();
  // glowing seam
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 30;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(W * 0.56 + off, 0);
  ctx.lineTo(W * 0.44 + off, H);
  ctx.stroke();
  ctx.restore();
  // watermark abbreviations
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = '#fff';
  ctx.font = '900 360px "Roboto Condensed", Roboto, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(match?.teams[0]?.abbr ?? 'HOME', W * 0.24, H * 0.55);
  ctx.fillText(match?.teams[1]?.abbr ?? 'AWAY', W * 0.76, H * 0.55);
  ctx.restore();
  vignette(ctx, 0.5);
}

function seamLines(rc: RenderCtx) {
  const { ctx, now } = rc;
  const leather = cached('leather', W, H, (g) => {
    const gr = g.createRadialGradient(W * 0.4, H * 0.35, 50, W / 2, H / 2, W * 0.8);
    gr.addColorStop(0, '#7f1d1d');
    gr.addColorStop(1, '#1c0404');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 26000; i++) {
      g.fillStyle = `rgba(0,0,0,${rnd(i) * 0.18})`;
      g.fillRect(rnd(i + 1) * W, rnd(i + 2) * H, 2, 2);
      if (i % 4 === 0) {
        g.fillStyle = `rgba(255,200,200,${rnd(i + 5) * 0.05})`;
        g.fillRect(rnd(i + 3) * W, rnd(i + 4) * H, 1.5, 1.5);
      }
    }
  });
  ctx.drawImage(leather, 0, 0);
  // giant rotating seam
  ctx.save();
  ctx.translate(W * 0.62, H * 0.5);
  ctx.rotate(-0.35 + Math.sin(now / 7000) * 0.08);
  const r = 900;
  for (const off of [-26, 26]) {
    ctx.strokeStyle = 'rgba(245,235,220,0.55)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, r * 0.9, r + off, Math.PI * 1.18, Math.PI * 1.82);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(245,235,220,0.7)';
  ctx.lineWidth = 4;
  const shift = (now / 3000) % 1;
  for (let k = 0; k < 60; k++) {
    const a = Math.PI * 1.18 + ((k + shift) / 60) * Math.PI * 0.64;
    const x1 = Math.cos(a) * (r - 40);
    const y1 = r * 0.9 + Math.sin(a) * (r - 40);
    const x2 = Math.cos(a + 0.01) * (r + 40);
    const y2 = r * 0.9 + Math.sin(a + 0.01) * (r + 40);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();
  // specular shine
  glow(ctx, W * 0.3 + Math.sin(now / 5000) * 200, H * 0.25, 600, 'rgba(255,255,255,0.08)');
  vignette(ctx, 0.6);
}

function classic(rc: RenderCtx, accent: string) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#0b1020'],
    [1, '#111a33'],
  ], 0, 0, W, H);
  const t = now / 9000;
  glow(ctx, W * (0.2 + 0.08 * Math.sin(t)), H * (0.25 + 0.06 * Math.cos(t * 1.3)), 900, hexA(accent, 0.28));
  glow(ctx, W * (0.85 + 0.05 * Math.cos(t * 0.8)), H * (0.85 + 0.05 * Math.sin(t)), 800, 'rgba(52,168,83,0.18)');
  ctx.save();
  ctx.globalAlpha = 0.035;
  ctx.fillStyle = '#ffffff';
  const off = (now / 60) % 160;
  for (let x = -H; x < W + H; x += 160) {
    ctx.beginPath();
    ctx.moveTo(x + off, 0);
    ctx.lineTo(x + off + 60, 0);
    ctx.lineTo(x + off + 60 - H * 0.4, H);
    ctx.lineTo(x + off - H * 0.4, H);
    ctx.fill();
  }
  ctx.restore();
}

const DRAW: Record<BackgroundId, (rc: RenderCtx, accent: string) => void> = {
  stadiumNight,
  pitchGreen,
  aurora,
  neonGrid,
  constellation,
  hexTech,
  liquidWaves,
  prism,
  teamClash,
  seamLines,
  classic,
};

/** Draw the studio's chosen animated background. `tint` lets a scene nudge the accent glow. */
export function drawBackground(rc: RenderCtx, tint?: string) {
  const id = rc.state.brand.background ?? 'stadiumNight';
  (DRAW[id] ?? stadiumNight)(rc, tint ?? rc.accent);
}
