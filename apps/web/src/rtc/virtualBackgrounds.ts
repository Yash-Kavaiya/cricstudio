// Cricket virtual backgrounds, painted procedurally (original artwork, no assets, no licensing).
import { prefs } from '../lib/storage';

export const VB_W = 1280;
export const VB_H = 720;

export interface VirtualBg {
  id: string;
  label: string;
}

export const VIRTUAL_BGS: VirtualBg[] = [
  { id: 'stadium', label: 'Stadium night' },
  { id: 'commentary', label: 'Commentary box' },
  { id: 'pitch', label: 'Pitch view' },
  { id: 'pavilion', label: 'Pavilion day' },
  { id: 'studio', label: 'Broadcast studio' },
  { id: 'scoreboard', label: 'Scoreboard wall' },
];

const cache = new Map<string, HTMLCanvasElement>();

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function canvas() {
  const c = document.createElement('canvas');
  c.width = VB_W;
  c.height = VB_H;
  return c;
}

function glow(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, color);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

/** crowd stand: rows of tiny coloured heads, with perspective */
function crowd(g: CanvasRenderingContext2D, r: () => number, y0: number, y1: number, light: number) {
  const palette = ['#1a73e8', '#ea4335', '#fbbc04', '#34a853', '#ffffff', '#ff6d00', '#a142f4', '#00bcd4'];
  for (let y = y0; y < y1; y += 5) {
    const s = 1.2 + ((y - y0) / (y1 - y0)) * 2.2;
    for (let x = 0; x < VB_W; x += s * 2.4) {
      g.globalAlpha = (0.25 + r() * 0.55) * light;
      g.fillStyle = palette[Math.floor(r() * palette.length)];
      g.fillRect(x + r() * 2, y + r() * 2, s, s);
    }
  }
  g.globalAlpha = 1;
}

function floodlight(g: CanvasRenderingContext2D, x: number, y: number) {
  g.fillStyle = '#20263a';
  g.fillRect(x - 3, y, 6, 220);
  g.fillStyle = '#2b3350';
  g.fillRect(x - 34, y - 26, 68, 30);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
    g.fillStyle = '#fffbe6';
    g.fillRect(x - 30 + i * 16, y - 22 + j * 13, 12, 9);
  }
  glow(g, x, y - 10, 180, 'rgba(255,250,220,0.55)');
}

function stadium(g: CanvasRenderingContext2D) {
  const r = rng(7);
  const sky = g.createLinearGradient(0, 0, 0, VB_H);
  sky.addColorStop(0, '#050a1c');
  sky.addColorStop(0.45, '#0d1838');
  sky.addColorStop(1, '#0a1a10');
  g.fillStyle = sky;
  g.fillRect(0, 0, VB_W, VB_H);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.5})`;
    g.fillRect(r() * VB_W, r() * 180, 1.5, 1.5);
  }
  // stands
  g.fillStyle = '#121a30';
  g.beginPath();
  g.moveTo(0, 260);
  g.quadraticCurveTo(VB_W / 2, 200, VB_W, 260);
  g.lineTo(VB_W, 470);
  g.lineTo(0, 470);
  g.fill();
  crowd(g, r, 250, 455, 0.9);
  // roof line
  g.strokeStyle = 'rgba(180,200,255,0.25)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 258);
  g.quadraticCurveTo(VB_W / 2, 198, VB_W, 258);
  g.stroke();
  [120, 470, 810, 1160].forEach((x, i) => floodlight(g, x, 120 + (i % 2) * 18));
  // outfield with mowing stripes
  const field = g.createLinearGradient(0, 460, 0, VB_H);
  field.addColorStop(0, '#1f6b2c');
  field.addColorStop(1, '#0d3d17');
  g.fillStyle = field;
  g.fillRect(0, 460, VB_W, VB_H - 460);
  for (let i = 0; i < 12; i++) {
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
    g.beginPath();
    g.moveTo(VB_W / 2 + (i - 6) * 40, 460);
    g.lineTo(VB_W / 2 + (i - 5) * 40, 460);
    g.lineTo(VB_W / 2 + (i - 5) * 260, VB_H);
    g.lineTo(VB_W / 2 + (i - 6) * 260, VB_H);
    g.fill();
  }
  // boundary rope + LED boards
  g.fillStyle = '#0b0f1e';
  g.fillRect(0, 452, VB_W, 18);
  const led = g.createLinearGradient(0, 0, VB_W, 0);
  led.addColorStop(0, '#1a73e8');
  led.addColorStop(0.5, '#a142f4');
  led.addColorStop(1, '#ea4335');
  g.fillStyle = led;
  g.globalAlpha = 0.85;
  g.fillRect(0, 455, VB_W, 10);
  g.globalAlpha = 1;
}

function commentary(g: CanvasRenderingContext2D) {
  const r = rng(11);
  // room
  g.fillStyle = '#1b1f2b';
  g.fillRect(0, 0, VB_W, VB_H);
  // big window over the ground
  const wx = 90,
    wy = 70,
    ww = VB_W - 180,
    wh = 400;
  const sky = g.createLinearGradient(0, wy, 0, wy + wh);
  sky.addColorStop(0, '#7fb7f0');
  sky.addColorStop(0.35, '#cfe6fb');
  sky.addColorStop(0.36, '#2f8f3f');
  sky.addColorStop(1, '#1f6b2c');
  g.fillStyle = sky;
  g.fillRect(wx, wy, ww, wh);
  // far stands
  g.fillStyle = '#6d7a8c';
  g.fillRect(wx, wy + 110, ww, 32);
  g.save();
  g.beginPath();
  g.rect(wx, wy + 108, ww, 36);
  g.clip();
  crowd(g, r, wy + 110, wy + 142, 0.8);
  g.restore();
  // oval field + pitch
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.beginPath();
  g.ellipse(VB_W / 2, wy + 300, 520, 120, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#c9b27c';
  g.beginPath();
  g.moveTo(VB_W / 2 - 18, wy + 220);
  g.lineTo(VB_W / 2 + 18, wy + 220);
  g.lineTo(VB_W / 2 + 34, wy + 380);
  g.lineTo(VB_W / 2 - 34, wy + 380);
  g.fill();
  // window frame + mullions + glass sheen
  g.strokeStyle = '#0e1118';
  g.lineWidth = 14;
  g.strokeRect(wx, wy, ww, wh);
  g.fillStyle = '#0e1118';
  for (let i = 1; i < 4; i++) g.fillRect(wx + (ww / 4) * i - 5, wy, 10, wh);
  const sheen = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
  sheen.addColorStop(0, 'rgba(255,255,255,0.12)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.06)');
  g.fillStyle = sheen;
  g.fillRect(wx, wy, ww, wh);
  // desk
  const desk = g.createLinearGradient(0, 500, 0, VB_H);
  desk.addColorStop(0, '#5a3b22');
  desk.addColorStop(1, '#2e1d10');
  g.fillStyle = desk;
  g.fillRect(0, 520, VB_W, VB_H - 520);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(0, 520, VB_W, 4);
  // monitors on the desk edge
  [180, VB_W - 300].forEach((x) => {
    g.fillStyle = '#0b0d12';
    g.fillRect(x, 470, 120, 70);
    g.fillStyle = '#1a73e8';
    g.globalAlpha = 0.5;
    g.fillRect(x + 6, 476, 108, 58);
    g.globalAlpha = 1;
  });
}

function pitch(g: CanvasRenderingContext2D) {
  const sky = g.createLinearGradient(0, 0, 0, 260);
  sky.addColorStop(0, '#5b9be0');
  sky.addColorStop(1, '#bcd9f5');
  g.fillStyle = sky;
  g.fillRect(0, 0, VB_W, 260);
  const r = rng(3);
  g.fillStyle = '#4f5d70';
  g.fillRect(0, 200, VB_W, 60);
  crowd(g, r, 202, 258, 0.7);
  // grass
  const field = g.createLinearGradient(0, 260, 0, VB_H);
  field.addColorStop(0, '#3e9a4a');
  field.addColorStop(1, '#1f6b2c');
  g.fillStyle = field;
  g.fillRect(0, 260, VB_W, VB_H - 260);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
    g.fillRect(0, 260 + i * 58, VB_W, 58);
  }
  // pitch strip in perspective
  const cx = VB_W / 2;
  g.fillStyle = '#cdb27a';
  g.beginPath();
  g.moveTo(cx - 40, 270);
  g.lineTo(cx + 40, 270);
  g.lineTo(cx + 230, VB_H);
  g.lineTo(cx - 230, VB_H);
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 3;
  [[290, 60], [VB_H - 90, 300]].forEach(([y, w]) => {
    g.beginPath();
    g.moveTo(cx - w, y);
    g.lineTo(cx + w, y);
    g.stroke();
  });
  // stumps at both ends
  const stumps = (x: number, y: number, h: number, w: number) => {
    for (let i = -1; i <= 1; i++) {
      g.fillStyle = '#f2e6c9';
      g.fillRect(x + i * w - w * 0.18, y - h, w * 0.36, h);
    }
    g.fillStyle = '#e8d3a3';
    g.fillRect(x - w * 1.3, y - h - 3, w * 2.6, 4);
  };
  stumps(cx, 290, 26, 6);
  stumps(cx, VB_H - 92, 110, 22);
}

function pavilion(g: CanvasRenderingContext2D) {
  const sky = g.createLinearGradient(0, 0, 0, 420);
  sky.addColorStop(0, '#6aa8ea');
  sky.addColorStop(1, '#dcecfb');
  g.fillStyle = sky;
  g.fillRect(0, 0, VB_W, 420);
  // clouds
  const r = rng(5);
  for (let i = 0; i < 6; i++) {
    const x = r() * VB_W,
      y = 40 + r() * 120;
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let k = 0; k < 5; k++) {
      g.beginPath();
      g.arc(x + k * 30, y + Math.sin(k) * 8, 26 + r() * 14, 0, Math.PI * 2);
      g.fill();
    }
  }
  // pavilion building: red brick, white balconies, clock tower
  g.fillStyle = '#9c4a33';
  g.fillRect(140, 190, 1000, 240);
  g.fillStyle = '#b55a3f';
  g.fillRect(560, 110, 160, 90);
  g.beginPath();
  g.moveTo(540, 110);
  g.lineTo(640, 50);
  g.lineTo(740, 110);
  g.fillStyle = '#4a5560';
  g.fill();
  g.beginPath();
  g.arc(640, 155, 28, 0, Math.PI * 2);
  g.fillStyle = '#f7f3e8';
  g.fill();
  g.strokeStyle = '#333';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(640, 155);
  g.lineTo(640, 136);
  g.moveTo(640, 155);
  g.lineTo(654, 160);
  g.stroke();
  for (let row = 0; row < 2; row++) {
    g.fillStyle = '#f7f3e8';
    g.fillRect(140, 270 + row * 80, 1000, 10);
    for (let i = 0; i < 14; i++) {
      g.fillStyle = '#2b2f36';
      g.beginPath();
      g.roundRect(165 + i * 70, 215 + row * 80, 44, 50, [22, 22, 0, 0]);
      g.fill();
    }
  }
  // seated members in front
  g.fillStyle = '#e7e2d6';
  g.fillRect(100, 430, 1080, 20);
  crowd(g, r, 395, 430, 0.8);
  // ground
  const field = g.createLinearGradient(0, 450, 0, VB_H);
  field.addColorStop(0, '#46a352');
  field.addColorStop(1, '#246e30');
  g.fillStyle = field;
  g.fillRect(0, 450, VB_W, VB_H - 450);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 460, VB_W, 3);
}

function studio(g: CanvasRenderingContext2D) {
  const bg = g.createLinearGradient(0, 0, VB_W, VB_H);
  bg.addColorStop(0, '#071233');
  bg.addColorStop(1, '#1a0b33');
  g.fillStyle = bg;
  g.fillRect(0, 0, VB_W, VB_H);
  // LED wall grid
  for (let x = 0; x < VB_W; x += 16)
    for (let y = 0; y < 460; y += 16) {
      const d = Math.hypot(x - VB_W / 2, y - 230) / 700;
      g.fillStyle = `rgba(80,140,255,${0.18 * (1 - d)})`;
      g.fillRect(x, y, 12, 12);
    }
  glow(g, VB_W / 2, 220, 520, 'rgba(26,115,232,0.35)');
  // big ball + seam glyph
  g.save();
  g.translate(VB_W / 2, 230);
  g.beginPath();
  g.arc(0, 0, 120, 0, Math.PI * 2);
  const ball = g.createRadialGradient(-40, -40, 10, 0, 0, 120);
  ball.addColorStop(0, '#ff6b5e');
  ball.addColorStop(1, '#8e1b12');
  g.fillStyle = ball;
  g.fill();
  g.strokeStyle = '#ffe9c7';
  g.lineWidth = 4;
  g.setLineDash([8, 7]);
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(s * 18, 0, 34, 118, 0, -Math.PI / 2, Math.PI / 2, s < 0);
    g.stroke();
  }
  g.restore();
  g.setLineDash([]);
  g.font = '900 64px "Roboto Condensed", Roboto, Arial, sans-serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.fillText('CRICKET LIVE', VB_W / 2, 420);
  // floor + light stripes
  const floor = g.createLinearGradient(0, 460, 0, VB_H);
  floor.addColorStop(0, '#0b1230');
  floor.addColorStop(1, '#03060f');
  g.fillStyle = floor;
  g.fillRect(0, 460, VB_W, VB_H - 460);
  ['#1a73e8', '#a142f4', '#ea4335'].forEach((c, i) => {
    g.fillStyle = c;
    g.globalAlpha = 0.7;
    g.fillRect(0, 462 + i * 7, VB_W, 3);
  });
  g.globalAlpha = 1;
}

function scoreboard(g: CanvasRenderingContext2D) {
  g.fillStyle = '#1f3d2a';
  g.fillRect(0, 0, VB_W, VB_H);
  // wooden frame board
  g.fillStyle = '#123021';
  g.fillRect(60, 50, VB_W - 120, 560);
  g.strokeStyle = '#d9c38c';
  g.lineWidth = 8;
  g.strokeRect(60, 50, VB_W - 120, 560);
  g.fillStyle = '#d9c38c';
  g.font = '800 34px "Roboto Condensed", Roboto, Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('SCOREBOARD', VB_W / 2, 100);
  const tile = (x: number, y: number, w: number, label: string) => {
    g.fillStyle = '#0b0f0c';
    g.fillRect(x, y, w, 70);
    g.fillStyle = '#f7f3e8';
    g.font = '800 50px "Roboto Condensed", Roboto, Arial, sans-serif';
    g.fillText(label, x + w / 2, y + 54);
  };
  g.font = '700 22px Roboto, Arial, sans-serif';
  const labels: [string, number, number][] = [
    ['TOTAL', 200, 150],
    ['WKTS', 470, 150],
    ['OVERS', 700, 150],
    ['TARGET', 980, 150],
  ];
  labels.forEach(([l, x, y]) => {
    g.fillStyle = '#d9c38c';
    g.font = '700 22px Roboto, Arial, sans-serif';
    g.fillText(l, x, y);
  });
  tile(110, 170, 180, '- - -');
  tile(420, 170, 100, '-');
  tile(620, 170, 160, '- -');
  tile(890, 170, 180, '- - -');
  for (let i = 0; i < 6; i++) {
    g.fillStyle = '#d9c38c';
    g.font = '700 22px Roboto, Arial, sans-serif';
    g.textAlign = 'left';
    g.fillText(`BATTER ${i + 1}`, 130, 300 + i * 48);
    g.textAlign = 'center';
    g.fillStyle = '#0b0f0c';
    g.fillRect(420, 270 + i * 48, 120, 38);
    g.fillRect(560, 270 + i * 48, 120, 38);
  }
  // clock
  g.beginPath();
  g.arc(VB_W - 250, 410, 110, 0, Math.PI * 2);
  g.fillStyle = '#f7f3e8';
  g.fill();
  g.strokeStyle = '#d9c38c';
  g.lineWidth = 10;
  g.stroke();
  g.strokeStyle = '#111';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(VB_W - 250, 410);
  g.lineTo(VB_W - 250, 330);
  g.moveTo(VB_W - 250, 410);
  g.lineTo(VB_W - 190, 440);
  g.stroke();
  // grass
  g.fillStyle = '#2f8f3f';
  g.fillRect(0, 630, VB_W, 90);
}

const PAINTERS: Record<string, (g: CanvasRenderingContext2D) => void> = { stadium, commentary, pitch, pavilion, studio, scoreboard };

/** Built-in or uploaded background as a 1280x720 canvas (cached). */
export function virtualBackground(id: string): HTMLCanvasElement | null {
  if (id === 'custom') return customBackground();
  const hit = cache.get(id);
  if (hit) return hit;
  const paint = PAINTERS[id];
  if (!paint) return null;
  const c = canvas();
  paint(c.getContext('2d')!);
  cache.set(id, c);
  return c;
}

/* ---------------- custom upload ---------------- */

let custom: HTMLCanvasElement | null = null;
let customLoading = false;

function customBackground(): HTMLCanvasElement | null {
  if (custom || customLoading) return custom;
  const url = prefs.get<string | null>('customBg', null);
  if (!url) return null;
  customLoading = true;
  const img = new Image();
  img.onload = () => {
    custom = cover(img);
    customLoading = false;
  };
  img.onerror = () => (customLoading = false);
  img.src = url;
  return null;
}

function cover(img: HTMLImageElement | ImageBitmap) {
  const c = canvas();
  const g = c.getContext('2d')!;
  const s = Math.max(VB_W / img.width, VB_H / img.height);
  g.drawImage(img, (VB_W - img.width * s) / 2, (VB_H - img.height * s) / 2, img.width * s, img.height * s);
  return c;
}

export function hasCustomBackground() {
  return !!custom || !!prefs.get<string | null>('customBg', null);
}

/** Downscale an uploaded image to 1280x720 and remember it in this browser. */
export async function setCustomBackground(file: File) {
  const bmp = await createImageBitmap(file);
  const c = cover(bmp);
  bmp.close();
  custom = c;
  try {
    prefs.set('customBg', c.toDataURL('image/jpeg', 0.85));
  } catch {
    /* storage full: keep for this session only */
  }
}

/** Small preview data-URL for the picker. */
export function backgroundThumb(id: string): string | null {
  const c = virtualBackground(id);
  if (!c) return id === 'custom' ? prefs.get<string | null>('customBg', null) : null;
  const t = document.createElement('canvas');
  t.width = 192;
  t.height = 108;
  t.getContext('2d')!.drawImage(c, 0, 0, 192, 108);
  return t.toDataURL('image/jpeg', 0.8);
}
