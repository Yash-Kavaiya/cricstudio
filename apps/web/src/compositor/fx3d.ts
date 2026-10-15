// Real-time 3D celebrations (three.js) composited into the 2D program canvas.
// Every effect builds its own objects and disposes them when finished → flat memory for 24/7 runs.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import opentype from 'opentype.js';
import type { ActiveOverlay } from '@cricstudio/shared';

const RW = 1280;
const RH = 720;

type Updater = (t: number, dt: number) => void;

interface Effect {
  seq: number;
  start: number;
  last: number;
  root: THREE.Group;
  updaters: Updater[];
  disposables: { dispose(): void }[];
  shakeUntil: number;
}

let fontPromise: Promise<opentype.Font | null> | null = null;
function loadFont() {
  fontPromise ??= fetch('/fonts/Anton-Regular.ttf')
    .then((r) => r.arrayBuffer())
    .then((b) => opentype.parse(b))
    .catch(() => null);
  return fontPromise;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  t = Math.min(1, Math.max(0, t));
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

export class Celebration3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, RW / RH, 0.1, 200);
  private font: opentype.Font | null = null;
  private textCache = new Map<string, THREE.BufferGeometry>();
  private ballTexture: THREE.Texture;
  private effect: Effect | null = null;
  private flash: THREE.PointLight;

  static supported(): boolean {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  }

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = RW;
    this.canvas.height = RH;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(RW, RH, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(4, 6, 10);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 1.6);
    rim.position.set(-8, -2, -6);
    this.scene.add(rim);
    this.flash = new THREE.PointLight(0xffffff, 0, 40);
    this.flash.position.set(0, 0, 6);
    this.scene.add(this.flash);
    this.camera.position.set(0, 0, 16);
    this.ballTexture = this.makeBallTexture();
    void loadFont().then((f) => (this.font = f));
  }

  get ready() {
    return !!this.font;
  }

  /* ---------------- assets ---------------- */

  private makeBallTexture() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#d61f26');
    grad.addColorStop(0.5, '#a30f16');
    grad.addColorStop(1, '#6a070c');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
      g.fillRect(Math.random() * 512, Math.random() * 256, 2, 2);
    }
    // seam around the equator + stitches
    g.fillStyle = '#f3ead8';
    g.fillRect(0, 120, 512, 16);
    g.strokeStyle = '#f3ead8';
    g.lineWidth = 3;
    for (let x = 0; x < 512; x += 10) {
      for (const y of [112, 144]) {
        g.beginPath();
        g.moveTo(x, y - 6);
        g.lineTo(x + 5, y + 6);
        g.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private textGeometry(text: string, maxWidth = 12): THREE.BufferGeometry | null {
    if (!this.font) return null;
    const key = `${text}|${maxWidth}`;
    const hit = this.textCache.get(key);
    if (hit) return hit;
    const path = this.font.getPath(text, 0, 0, 100);
    const sp = new THREE.ShapePath();
    for (const c of path.commands as any[]) {
      if (c.type === 'M') sp.moveTo(c.x, -c.y);
      else if (c.type === 'L') sp.lineTo(c.x, -c.y);
      else if (c.type === 'Q') sp.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
      else if (c.type === 'C') sp.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
    }
    const shapes = sp.toShapes();
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: 22, bevelEnabled: true, bevelThickness: 4, bevelSize: 2.5, bevelSegments: 3, curveSegments: 6 });
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    geo.translate(-(bb.max.x + bb.min.x) / 2, -(bb.max.y + bb.min.y) / 2, -(bb.max.z + bb.min.z) / 2);
    const w = bb.max.x - bb.min.x;
    const s = Math.min(0.05, maxWidth / w);
    geo.scale(s, s, s);
    if (this.textCache.size > 24) {
      const [k, g] = this.textCache.entries().next().value as [string, THREE.BufferGeometry];
      g.dispose();
      this.textCache.delete(k);
    }
    this.textCache.set(key, geo);
    return geo;
  }

  /* ---------------- effect building blocks ---------------- */

  private metal(color: number, emissive = 0x000000, ei = 0.25) {
    return new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.22, emissive, emissiveIntensity: ei });
  }

  private addText(e: Effect, text: string, mat: THREE.Material, opts: { maxWidth?: number; y?: number; enter: 'zoom' | 'drop' | 'slam' | 'spin' }) {
    const geo = this.textGeometry(text, opts.maxWidth ?? 12);
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, mat);
    e.disposables.push(mat);
    mesh.position.y = opts.y ?? 0.6;
    e.root.add(mesh);
    const y0 = mesh.position.y;
    e.updaters.push((t) => {
      const k = easeOutBack(t / 0.7);
      switch (opts.enter) {
        case 'zoom':
          mesh.position.z = -40 * (1 - easeOut(t / 0.7));
          mesh.rotation.y = (1 - easeOut(t / 0.9)) * Math.PI * 2;
          break;
        case 'drop':
          mesh.position.y = y0 + 12 * (1 - k);
          mesh.rotation.x = (1 - easeOut(t / 0.8)) * -Math.PI;
          break;
        case 'slam': {
          const s = 1 + 3 * (1 - easeOut(t / 0.35));
          mesh.scale.setScalar(s);
          if (t < 0.35) mesh.position.z = 8 * (1 - t / 0.35);
          break;
        }
        case 'spin':
          mesh.rotation.y = (1 - easeOut(t / 1.1)) * Math.PI * 4;
          mesh.scale.setScalar(Math.max(0.01, k));
      }
      // idle sway once settled
      if (t > 1) {
        mesh.rotation.y = Math.sin((t - 1) * 1.6) * 0.18;
        mesh.rotation.x = Math.sin((t - 1) * 1.1) * 0.06;
      }
    });
    return mesh;
  }

  private addBall(e: Effect, path: (t: number) => THREE.Vector3 | null, r = 0.7) {
    const geo = new THREE.SphereGeometry(r, 48, 32);
    const mat = new THREE.MeshStandardMaterial({ map: this.ballTexture, roughness: 0.35, metalness: 0.1 });
    e.disposables.push(geo, mat);
    const ball = new THREE.Mesh(geo, mat);
    e.root.add(ball);
    const ghosts: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const gm = new THREE.MeshBasicMaterial({ color: 0xff5544, transparent: true, opacity: 0.18 - i * 0.025, depthWrite: false });
      e.disposables.push(gm);
      const g = new THREE.Mesh(geo, gm);
      e.root.add(g);
      ghosts.push(g);
    }
    e.updaters.push((t) => {
      const p = path(t);
      ball.visible = !!p;
      if (p) ball.position.copy(p);
      ball.rotation.x = t * 22;
      ball.rotation.z = t * 6;
      ghosts.forEach((g, i) => {
        const q = path(t - (i + 1) * 0.035);
        g.visible = !!q && !!p;
        if (q) g.position.copy(q);
      });
    });
    return ball;
  }

  private addConfetti(e: Effect, colors: number[], count = 260, origin = new THREE.Vector3(0, -2, 0), spread = 1) {
    const geo = new THREE.PlaneGeometry(0.16, 0.28);
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, metalness: 0.4, roughness: 0.4 });
    e.disposables.push(geo, mat);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const parts = Array.from({ length: count }, () => ({
      p: origin.clone().add(new THREE.Vector3(rand(-1, 1), rand(-0.5, 0.5), rand(-1, 1))),
      v: new THREE.Vector3(rand(-6, 6) * spread, rand(7, 15), rand(-4, 4)),
      r: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)),
      w: new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)),
    }));
    const c = new THREE.Color();
    parts.forEach((_, i) => mesh.setColorAt(i, c.setHex(colors[i % colors.length])));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    e.root.add(mesh);
    e.updaters.push((_t, dt) => {
      for (let i = 0; i < count; i++) {
        const pt = parts[i];
        pt.v.y -= 9.8 * dt * 0.9;
        pt.v.multiplyScalar(1 - 0.9 * dt);
        pt.p.addScaledVector(pt.v, dt);
        pt.r.x += pt.w.x * dt;
        pt.r.y += pt.w.y * dt;
        pt.r.z += pt.w.z * dt;
        m.compose(pt.p, q.setFromEuler(pt.r), one);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  private addFirework(e: Effect, at: number, pos: THREE.Vector3, colors: number[], count = 420) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const cols = new Float32Array(count * 3);
    const vel: THREE.Vector3[] = [];
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 8));
      vel.push(dir);
      c.setHex(colors[i % colors.length]);
      cols.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mat = new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    e.disposables.push(geo, mat);
    const pts = new THREE.Points(geo, mat);
    pts.visible = false;
    e.root.add(pts);
    e.updaters.push((t) => {
      const lt = t - at;
      pts.visible = lt > 0 && lt < 2.2;
      if (!pts.visible) return;
      const drag = (1 - Math.exp(-lt * 2.2)) / 2.2;
      for (let i = 0; i < count; i++) {
        const v = vel[i];
        positions[i * 3] = pos.x + v.x * drag;
        positions[i * 3 + 1] = pos.y + v.y * drag - 1.4 * lt * lt;
        positions[i * 3 + 2] = pos.z + v.z * drag;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = Math.max(0, 1 - lt / 2.2);
    });
  }

  private addRing(e: Effect, color: number, opts: { y?: number; tilt?: number; grow?: number } = {}) {
    const geo = new THREE.TorusGeometry(5, 0.07, 12, 120);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    e.disposables.push(geo, mat);
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = opts.tilt ?? Math.PI / 2.4;
    ring.position.y = opts.y ?? -1.5;
    e.root.add(ring);
    e.updaters.push((t) => {
      const k = (t % 1.6) / 1.6;
      ring.scale.setScalar(0.4 + k * (opts.grow ?? 1.5));
      mat.opacity = 0.9 * (1 - k);
    });
  }

  private addStumps(e: Effect, hitAt: number) {
    const wood = new THREE.MeshStandardMaterial({ color: 0xf2dfb4, roughness: 0.55, metalness: 0.05 });
    const stumpGeo = new THREE.CylinderGeometry(0.11, 0.11, 3.6, 24);
    const bailGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.62, 12);
    e.disposables.push(wood, stumpGeo, bailGeo);
    const base = -3.2;
    const stumps = [-0.42, 0, 0.42].map((x, i) => {
      const s = new THREE.Mesh(stumpGeo, wood);
      s.position.set(x, base + 1.8, 0);
      e.root.add(s);
      return { m: s, x, w: new THREE.Vector3(rand(-2, -6), rand(-3, 3), rand(-2, 2)), v: new THREE.Vector3((i - 1) * 1.5, rand(2, 5), rand(-6, -10)), hit: i !== 0 };
    });
    const bails = [-0.21, 0.21].map((x) => {
      const b = new THREE.Mesh(bailGeo, wood);
      b.rotation.z = Math.PI / 2;
      b.position.set(x, base + 3.65, 0);
      e.root.add(b);
      return { m: b, v: new THREE.Vector3(rand(-4, 4), rand(6, 10), rand(2, 6)), w: new THREE.Vector3(rand(-14, 14), rand(-14, 14), rand(-14, 14)) };
    });
    e.updaters.push((t, dt) => {
      if (t < hitAt) return;
      for (const s of stumps) {
        if (!s.hit) continue;
        s.v.y -= 12 * dt;
        s.m.position.addScaledVector(s.v, dt * 0.55);
        s.m.rotation.x += s.w.x * dt * 0.6;
        s.m.rotation.z += s.w.z * dt * 0.6;
      }
      for (const b of bails) {
        b.v.y -= 12 * dt;
        b.m.position.addScaledVector(b.v, dt);
        b.m.rotation.x += b.w.x * dt;
        b.m.rotation.y += b.w.y * dt;
      }
    });
    // dust burst on impact
    this.addFirework(e, hitAt, new THREE.Vector3(0, base + 2.6, 0.2), [0xc8a96a, 0xffffff, 0xe0c9a0], 260);
  }

  /* ---------------- public ---------------- */

  /** Build the 3D scene for an overlay. Returns false if this overlay has no 3D treatment. */
  play(o: ActiveOverlay, accent: string): boolean {
    if (!this.font) return false;
    if (this.effect?.seq === o.seq) return true;
    this.clear();
    const e: Effect = { seq: o.seq, start: o.startedAt, last: 0, root: new THREE.Group(), updaters: [], disposables: [], shakeUntil: 0 };
    this.effect = e;
    this.scene.add(e.root);
    const acc = new THREE.Color(accent).getHex();
    const confettiCols = [0x1a73e8, 0xea4335, 0xfbbc04, 0x34a853, 0xffffff, acc];
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    switch (o.id) {
      case 'four': {
        this.flash.color.setHex(0x4c8df6);
        this.addRing(e, 0x22d3ee);
        this.addText(e, 'FOUR', this.metal(0x5b9bff, 0x0b3d91, 0.5), { enter: 'zoom', maxWidth: 10 });
        this.addBall(e, (t) => (t < 0 || t > 1.3 ? null : v(-14 + t * 22, -4 + Math.sin(t * 2.4) * 2.5, 4 - t * 6)));
        this.addConfetti(e, confettiCols, 220, v(0, -3, 0), 1);
        break;
      }
      case 'six': {
        this.flash.color.setHex(0xb06cff);
        this.addText(e, 'SIX', this.metal(0xffc83d, 0x7a4b00, 0.45), { enter: 'drop', maxWidth: 9, y: 0.8 });
        this.addBall(e, (t) => (t < 0 || t > 0.95 ? null : v(Math.sin(t * 3) * 2, -7 + t * 15, -18 + t * 22)), 0.8);
        this.addFirework(e, 0.95, v(0, 5, 2), [0xffd34d, 0xb06cff, 0xffffff]);
        this.addFirework(e, 1.5, v(-6, 3, -2), [0x1a73e8, 0xffffff, 0xea4335]);
        this.addFirework(e, 2.0, v(6, 4, -3), [0x34a853, 0xfbbc04, 0xffffff]);
        this.addFirework(e, 2.6, v(-2, 5.5, -4), [0xffd34d, 0xff5ab4]);
        this.addConfetti(e, confettiCols, 320, v(0, -4, 0), 1.4);
        break;
      }
      case 'wicket': {
        this.flash.color.setHex(0xff2a2a);
        this.addStumps(e, 0.45);
        this.addBall(e, (t) => (t < 0 || t > 0.5 ? null : v(1.5 - t * 3, -1.2 - t * 1.5, 14 - t * 27)), 0.55);
        e.shakeUntil = 0.9;
        const txt = this.addText(e, 'WICKET!', this.metal(0xff3b3b, 0x6b0000, 0.6), { enter: 'slam', maxWidth: 13, y: 2.6 });
        if (txt) txt.visible = false;
        e.updaters.push((t) => {
          if (txt) txt.visible = t > 0.4;
        });
        break;
      }
      case 'milestone':
      case 'fiveWickets': {
        this.flash.color.setHex(0xffd34d);
        const word = o.id === 'fiveWickets' ? '5 WICKETS' : (o.value ?? 0) >= 100 ? 'CENTURY' : 'FIFTY';
        this.addText(e, word, this.metal(0xffd34d, 0x7a5200, 0.55), { enter: 'spin', maxWidth: 13 });
        this.addRing(e, 0xffd34d, { y: 0.6, tilt: 0, grow: 2 });
        for (let i = 0; i < 4; i++) this.addFirework(e, 0.6 + i * 0.55, v(rand(-7, 7), rand(2, 5), rand(-4, 0)), [0xffd34d, 0xffffff, 0xffa500]);
        this.addConfetti(e, [0xffd34d, 0xffffff, 0xffa500, acc], 300, v(0, -4, 0), 1.2);
        break;
      }
      case 'partnership': {
        this.flash.color.setHex(0x4c8df6);
        this.addText(e, `${o.value ?? 50} STAND`, this.metal(0x8ab4f8, 0x0b3d91, 0.5), { enter: 'zoom', maxWidth: 12 });
        this.addRing(e, 0x8ab4f8, { y: 0.6, tilt: 0 });
        this.addConfetti(e, confettiCols, 180, v(0, -4, 0));
        break;
      }
      case 'hattrick': {
        this.flash.color.setHex(0xff8a00);
        this.addText(e, 'HAT-TRICK BALL', this.metal(0xff9d2e, 0x7a2e00, 0.6), { enter: 'slam', maxWidth: 14, y: 1.6 });
        [-3, 0, 3].forEach((x, i) => this.addBall(e, (t) => (t < i * 0.25 ? null : v(x, -2.2 + Math.sin(t * 4 + i) * 0.25, 0)), 0.75));
        break;
      }
      case 'inningsEnd':
      case 'matchEnd': {
        this.flash.color.setHex(0xffffff);
        this.addText(e, o.id === 'matchEnd' ? 'MATCH OVER' : 'INNINGS BREAK', this.metal(0xe8eaed, 0x333333, 0.3), { enter: 'drop', maxWidth: 15 });
        if (o.id === 'matchEnd') for (let i = 0; i < 6; i++) this.addFirework(e, 0.4 + i * 0.5, v(rand(-8, 8), rand(1, 6), rand(-5, 0)), confettiCols);
        break;
      }
      default:
        this.clear();
        return false;
    }
    return true;
  }

  /** Advance + render. Returns the GL canvas, or null when nothing is playing. */
  render(o: ActiveOverlay | null): HTMLCanvasElement | null {
    const e = this.effect;
    if (!e || !o || o.seq !== e.seq) {
      if (e) this.clear();
      return null;
    }
    const t = (Date.now() - e.start) / 1000;
    const dt = Math.min(0.1, Math.max(0, t - e.last));
    e.last = t;
    for (const u of e.updaters) u(t, dt);
    // impact flash + camera shake
    this.flash.intensity = Math.max(0, 120 * (1 - t / 0.6));
    if (t < e.shakeUntil) {
      const k = 1 - t / e.shakeUntil;
      this.camera.position.set(Math.sin(t * 90) * 0.35 * k, Math.cos(t * 70) * 0.25 * k, 16);
    } else this.camera.position.set(Math.sin(t * 0.6) * 0.6, Math.sin(t * 0.4) * 0.25, 16 - Math.min(1.5, t * 0.3));
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
    return this.canvas;
  }

  clear() {
    const e = this.effect;
    if (!e) return;
    this.scene.remove(e.root);
    for (const d of e.disposables) d.dispose();
    this.effect = null;
    this.renderer.clear();
  }

  dispose() {
    this.clear();
    this.textCache.forEach((g) => g.dispose());
    this.textCache.clear();
    this.ballTexture.dispose();
    this.renderer.dispose();
  }
}
