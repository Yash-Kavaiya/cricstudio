// A real-time 3D cricket ground (three.js) for the "3D Ground · Wagon Wheel" and "Match Intro 3D"
// scenes. The stadium is built once; the shot arcs and team names are rebuilt only when the data
// changes, and nothing renders unless one of those scenes is on air.
import * as THREE from 'three';
import opentype from 'opentype.js';
import { buildTextGeometry, loadFont } from './fx3d';

const RW = 1280;
const RH = 720;
const FIELD_R = 10;

export interface Shot {
  /** 0..7, clockwise from fine leg (same zones as the 2D wagon wheel) */
  zone: number;
  /** runs off the bat for this one stroke (6 sails into the stands, 4 runs to the rope) */
  runs: number;
}

export interface GroundView {
  /** screen position (1920x1080) and run total for each zone label */
  labels: { x: number; y: number; runs: number; zone: number }[];
}

const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
const easeOutBack = (t: number) => {
  t = Math.min(1, Math.max(0, t));
  return 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
};

/** zone centre angle in ground space (matches the 2D wheel: screen-up is away from the camera) */
const zoneAngle = (zone: number) => Math.PI / 2 + (zone + 0.5) * (Math.PI / 4);

function fieldTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d')!;
  // mowing stripes
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? '#2e8b43' : '#267a3a';
    g.fillRect(0, i * 64, 1024, 64);
  }
  // inner circle (30 yards), dashed
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 4;
  g.setLineDash([18, 16]);
  g.beginPath();
  g.arc(512, 512, 512 * 0.55, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Stage3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, RW / RH, 0.1, 400);
  private font: opentype.Font | null = null;
  private arcs = new THREE.Group();
  private arcKey = '';
  private arcParts: { mesh: THREE.Mesh; count: number; delay: number; tip: THREE.Mesh }[] = [];
  private names = new THREE.Group();
  private nameKey = '';
  private nameParts: { mesh: THREE.Mesh; delay: number }[] = [];
  private crowd: THREE.InstancedMesh;
  private crowdBase: { x: number; y: number; z: number; ph: number }[] = [];
  private beams: THREE.Mesh[] = [];
  private disposables: { dispose(): void }[] = [];

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
    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1d3b22, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(8, 20, 10);
    this.scene.add(sun);
    this.crowd = this.buildStadium();
    this.scene.add(this.arcs, this.names);
    void loadFont().then((f) => (this.font = f));
  }

  private keep<T extends { dispose(): void }>(x: T) {
    this.disposables.push(x);
    return x;
  }

  private buildStadium() {
    const s = this.scene;
    // outfield (slightly oval) with the rope
    const field = new THREE.Mesh(this.keep(new THREE.CircleGeometry(FIELD_R, 96)), this.keep(new THREE.MeshStandardMaterial({ map: this.keep(fieldTexture()), roughness: 0.95 })));
    field.rotation.x = -Math.PI / 2;
    field.scale.set(1.08, 1, 1);
    s.add(field);
    const rope = new THREE.Mesh(this.keep(new THREE.TorusGeometry(FIELD_R - 0.15, 0.06, 8, 160)), this.keep(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x3355ff, emissiveIntensity: 0.4 })));
    rope.rotation.x = -Math.PI / 2;
    rope.scale.set(1.08, 1, 1);
    rope.position.y = 0.06;
    s.add(rope);
    // pitch, creases and stumps
    const pitch = new THREE.Mesh(this.keep(new THREE.BoxGeometry(0.6, 0.04, 4)), this.keep(new THREE.MeshStandardMaterial({ color: 0xd8c08a, roughness: 0.9 })));
    pitch.position.y = 0.02;
    s.add(pitch);
    const white = this.keep(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const crease = this.keep(new THREE.BoxGeometry(0.9, 0.02, 0.03));
    const stump = this.keep(new THREE.CylinderGeometry(0.018, 0.018, 0.36, 8));
    const wood = this.keep(new THREE.MeshStandardMaterial({ color: 0xf2dfb4 }));
    for (const z of [-1.75, 1.75]) {
      for (const dz of [0, z > 0 ? -0.3 : 0.3]) {
        const c = new THREE.Mesh(crease, white);
        c.position.set(0, 0.05, z + dz);
        s.add(c);
      }
      for (const x of [-0.05, 0, 0.05]) {
        const st = new THREE.Mesh(stump, wood);
        st.position.set(x, 0.2, z);
        s.add(st);
      }
    }
    // the bowl: three tiers of stands
    const standMat = this.keep(new THREE.MeshStandardMaterial({ color: 0x2a3142, roughness: 0.85, side: THREE.DoubleSide }));
    const roofMat = this.keep(new THREE.MeshStandardMaterial({ color: 0xdfe3ea, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide }));
    const pts = [new THREE.Vector2(FIELD_R + 1, 0), new THREE.Vector2(FIELD_R + 1, 0.8), new THREE.Vector2(FIELD_R + 6.5, 4.6), new THREE.Vector2(FIELD_R + 6.5, 5.2)];
    const bowl = new THREE.Mesh(this.keep(new THREE.LatheGeometry(pts, 96)), standMat);
    bowl.scale.set(1.08, 1, 1);
    s.add(bowl);
    const roof = new THREE.Mesh(this.keep(new THREE.LatheGeometry([new THREE.Vector2(FIELD_R + 4.8, 6.6), new THREE.Vector2(FIELD_R + 7.2, 6.2)], 96)), roofMat);
    roof.scale.set(1.08, 1, 1);
    s.add(roof);
    // crowd: little coloured heads on the terraces
    const rows = 6;
    const perRow = 150;
    const head = this.keep(new THREE.SphereGeometry(0.13, 6, 5));
    const crowd = new THREE.InstancedMesh(head, this.keep(new THREE.MeshStandardMaterial({ roughness: 0.7 })), rows * perRow);
    const cols = [0xea4335, 0xfbbc04, 0x1a73e8, 0xffffff, 0x34a853, 0xff7ab4, 0xf28b30, 0x9aa0a6];
    const col = new THREE.Color();
    for (let r = 0; r < rows; r++)
      for (let i = 0; i < perRow; i++) {
        const a = (i / perRow) * Math.PI * 2 + r * 0.01;
        const u = (r + 0.5) / rows;
        const rad = FIELD_R + 1.4 + u * 4.8;
        this.crowdBase.push({ x: Math.cos(a) * rad * 1.08, y: 1.05 + u * 3.4, z: Math.sin(a) * rad, ph: Math.random() * 6 });
        crowd.setColorAt(r * perRow + i, col.setHex(cols[Math.floor(Math.random() * cols.length)]));
      }
    s.add(crowd);
    // four floodlight towers with glowing heads and faint beams
    const mast = this.keep(new THREE.CylinderGeometry(0.12, 0.2, 12, 8));
    const lamp = this.keep(new THREE.BoxGeometry(1.8, 1.1, 0.3));
    const steel = this.keep(new THREE.MeshStandardMaterial({ color: 0x8a919e, metalness: 0.7, roughness: 0.4 }));
    const glow = this.keep(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6d8, emissiveIntensity: 2.2 }));
    const beamGeo = this.keep(new THREE.ConeGeometry(4, 18, 24, 1, true));
    beamGeo.translate(0, -9, 0);
    const beamMat = this.keep(new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const x = Math.cos(a) * (FIELD_R + 8) * 1.08;
      const z = Math.sin(a) * (FIELD_R + 8);
      const m = new THREE.Mesh(mast, steel);
      m.position.set(x, 6, z);
      const l = new THREE.Mesh(lamp, glow);
      l.position.set(x, 12.2, z);
      l.lookAt(0, 0, 0);
      const b = new THREE.Mesh(beamGeo, beamMat);
      b.position.set(x, 12.2, z);
      b.lookAt(0, 0, 0);
      b.rotateX(-Math.PI / 2);
      s.add(m, l, b);
      this.beams.push(b);
    }
    return crowd;
  }

  /* ---------------- wagon wheel arcs ---------------- */

  private clearGroup(g: THREE.Group) {
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    g.clear();
  }

  private buildArcs(shots: Shot[], accent: string) {
    this.clearGroup(this.arcs);
    this.arcParts = [];
    const acc = new THREE.Color(accent);
    const gold = new THREE.Color(0xffd34d);
    const white = new THREE.Color(0xffffff);
    const perZone = new Map<number, number>();
    shots.forEach((s, i) => {
      // fan strokes in the same zone out across it, deterministically so arcs don't jump between frames
      const k = perZone.get(s.zone) ?? 0;
      perZone.set(s.zone, k + 1);
      const spread = (((k * 0.618034) % 1) - 0.5) * (Math.PI / 4) * 0.85;
      const ang = zoneAngle(s.zone) + spread;
      const six = s.runs >= 6;
      const len = six ? FIELD_R * 1.32 : s.runs >= 4 ? FIELD_R - 0.25 : FIELD_R * (0.28 + 0.2 * Math.min(3, s.runs));
      const end = new THREE.Vector3(Math.cos(ang) * len * 1.08, six ? 3.2 : 0.08, -Math.sin(ang) * len);
      const lift = six ? 7.5 : s.runs >= 4 ? 0.6 : 0.3;
      const mid = end.clone().multiplyScalar(0.5).setY(lift);
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.15, 1.5), mid, end);
      const geo = new THREE.TubeGeometry(curve, 48, six ? 0.08 : 0.055, 8, false);
      const color = six ? gold : s.runs >= 4 ? acc : white;
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.4 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.geometry.setDrawRange(0, 0);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(six ? 0.22 : 0.15, 12, 8), new THREE.MeshStandardMaterial({ color: 0xd61f26, emissive: 0x550000, roughness: 0.35 }));
      tip.position.copy(end);
      tip.visible = false;
      this.arcs.add(mesh, tip);
      this.arcParts.push({ mesh, count: geo.index!.count, delay: 0.9 + i * (1.6 / Math.max(1, shots.length)), tip });
    });
  }

  /* ---------------- intro team names ---------------- */

  private buildNames(a: { abbr: string; color: string }, b: { abbr: string; color: string }) {
    this.clearGroup(this.names);
    this.nameParts = [];
    if (!this.font) return;
    const mk = (text: string, color: string, x: number, delay: number, w: number) => {
      const geo = buildTextGeometry(this.font!, text, w);
      const c = new THREE.Color(color);
      const mat = new THREE.MeshStandardMaterial({ color: c, metalness: 0.75, roughness: 0.25, emissive: c, emissiveIntensity: 0.35 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 3.2, 0);
      this.names.add(mesh);
      this.nameParts.push({ mesh, delay });
    };
    mk(a.abbr, a.color, -5.2, 1.4, 5.5);
    mk('VS', '#ffffff', 0, 2.1, 2.2);
    mk(b.abbr, b.color, 5.2, 1.75, 5.5);
  }

  /* ---------------- render ---------------- */

  private bobMatrix = new THREE.Matrix4();
  private lastBob = -1;

  private bobCrowd(t: number, energy: number) {
    // the crowd is tiny on screen: 15 updates a second is plenty
    if (Math.abs(t - this.lastBob) < 1 / 15) return;
    this.lastBob = t;
    const m = this.bobMatrix;
    this.crowdBase.forEach((b, i) => {
      m.makeTranslation(b.x, b.y + Math.max(0, Math.sin(t * 7 + b.ph)) * 0.12 * energy, b.z);
      this.crowd.setMatrixAt(i, m);
    });
    this.crowd.instanceMatrix.needsUpdate = true;
  }

  /** Wagon wheel on the 3D ground; `age` is ms since the scene went on air. */
  renderGround(shots: Shot[], accent: string, age: number): GroundView {
    const t = age / 1000;
    const key = `${accent}|${shots.map((s) => `${s.zone}:${s.runs}`).join(',')}`;
    if (key !== this.arcKey) {
      this.arcKey = key;
      this.buildArcs(shots, accent);
    }
    this.arcs.visible = true;
    this.names.visible = false;
    for (const p of this.arcParts) {
      const k = easeOut((t - p.delay) / 0.9);
      p.mesh.geometry.setDrawRange(0, Math.floor((p.count * k) / 3) * 3);
      p.tip.visible = k >= 1;
    }
    this.bobCrowd(t, 0.4);
    // fly in from high above, then a slow orbit
    const fly = easeOut(t / 2.2);
    const a = Math.sin(t * 0.12) * 0.45;
    const r = 34 - 15 * fly;
    this.camera.position.set(Math.sin(a) * r, 26 - 11 * fly, Math.cos(a) * r);
    this.camera.lookAt(0, 0, -0.8);
    this.renderer.render(this.scene, this.camera);
    // zone totals, anchored just beyond the rope
    const totals = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const s of shots) totals[s.zone] += s.runs;
    const labels = totals.map((runs, zone) => {
      const ang = zoneAngle(zone);
      const p = new THREE.Vector3(Math.cos(ang) * (FIELD_R + 0.4) * 1.08, 0.3, -Math.sin(ang) * (FIELD_R + 0.4)).project(this.camera);
      return { x: (p.x * 0.5 + 0.5) * 1920, y: (-p.y * 0.5 + 0.5) * 1080, runs, zone };
    });
    return { labels };
  }

  /** Cinematic match intro: aerial sweep down to the pitch, team names rise in 3D. */
  renderIntro(a: { abbr: string; color: string }, b: { abbr: string; color: string }, age: number) {
    const t = age / 1000;
    const key = `${a.abbr}|${a.color}|${b.abbr}|${b.color}|${this.font ? 1 : 0}`;
    if (key !== this.nameKey) {
      this.nameKey = key;
      this.buildNames(a, b);
    }
    this.arcs.visible = false;
    this.names.visible = true;
    for (const p of this.nameParts) {
      const k = easeOutBack((t - p.delay) / 0.7);
      p.mesh.visible = t > p.delay;
      p.mesh.scale.setScalar(Math.max(0.001, k));
      p.mesh.quaternion.copy(this.camera.quaternion);
      p.mesh.position.y = 3.2 + Math.sin(t * 1.5 + p.delay) * 0.12;
    }
    this.bobCrowd(t, 1);
    for (const bm of this.beams) (bm.material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.03 * Math.sin(t * 3);
    const p = easeOut(t / 3.2);
    const ang = -1.4 + p * 1.4 + Math.sin(t * 0.2) * 0.08;
    const r = 40 - 22 * p;
    this.camera.position.set(Math.sin(ang) * r, 28 - 21 * p, Math.cos(ang) * r);
    this.camera.lookAt(0, 1.6 * p, 0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.clearGroup(this.arcs);
    this.clearGroup(this.names);
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
  }
}
