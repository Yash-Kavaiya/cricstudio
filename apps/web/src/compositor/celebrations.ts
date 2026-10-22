// Celebration variants 1-4 for each event (variant 0 is the original look in fx3d.ts). The server
// rotates `overlay.variant` through a shuffled bag so the same look never plays twice running.
import * as THREE from 'three';
import type { ActiveOverlay } from '@cricstudio/shared';
import { easeOut, easeOutBack, rand, type Celebration3D, type Effect } from './fx3d';
import { addUmpire } from './umpire3d';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const additive = (color: number, opacity = 0.6) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

/* ---------------- props ---------------- */

/** glowing hologram platform the umpire / text stands on */
function holoDisc(e: Effect, x: number, y: number, r: number, color: number) {
  const disc = new THREE.CircleGeometry(r, 64);
  const edge = new THREE.TorusGeometry(r, 0.06, 8, 96);
  const inner = new THREE.TorusGeometry(r * 0.62, 0.03, 8, 96);
  const fill = additive(color, 0.22);
  const line = additive(color, 0.95);
  e.disposables.push(disc, edge, inner, fill, line);
  const g = new THREE.Group();
  g.position.set(x, y, 0);
  g.rotation.x = -Math.PI / 2.25;
  g.add(new THREE.Mesh(disc, fill), new THREE.Mesh(edge, line), new THREE.Mesh(inner, line));
  e.root.add(g);
  e.updaters.push((t) => {
    g.scale.setScalar(Math.max(0.001, easeOutBack(t / 0.5)));
    g.rotation.z = t * 0.8;
    fill.opacity = 0.18 + 0.08 * Math.sin(t * 5);
  });
  return g;
}

/** streaks rushing past the camera */
function speedLines(e: Effect, color: number, count = 70) {
  const geo = new THREE.BoxGeometry(0.035, 0.035, 5);
  const mat = additive(color, 0.75);
  e.disposables.push(geo, mat);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const lines = Array.from({ length: count }, () => {
    const a = rand(0, Math.PI * 2);
    const r = rand(3.5, 12);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6, z: rand(-60, 10), s: rand(40, 80) };
  });
  const m = new THREE.Matrix4();
  e.root.add(mesh);
  e.updaters.push((t, dt) => {
    for (let i = 0; i < count; i++) {
      const l = lines[i];
      l.z += l.s * dt;
      if (l.z > 18) l.z = -60;
      m.makeTranslation(l.x, l.y, l.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mat.opacity = 0.75 * Math.max(0, 1 - Math.max(0, t - 2.5) / 1.5);
  });
}

/** sweeping searchlight / siren beam hanging from (x, y) */
function beam(e: Effect, x: number, y: number, color: number, speed: number, phase = 0, len = 16) {
  const geo = new THREE.ConeGeometry(2.4, len, 32, 1, true);
  geo.translate(0, -len / 2, 0);
  const mat = additive(color, 0.18);
  e.disposables.push(geo, mat);
  const cone = new THREE.Mesh(geo, mat);
  cone.position.set(x, y, -3);
  e.root.add(cone);
  e.updaters.push((t) => {
    cone.rotation.z = Math.sin(t * speed + phase) * 0.7;
    cone.rotation.x = Math.cos(t * speed * 0.7 + phase) * 0.25;
    mat.opacity = 0.16 * Math.min(1, t / 0.3);
  });
}

/** a cricket bat: willow blade, black grip */
function makeBat(e: Effect) {
  const willow = new THREE.MeshStandardMaterial({ color: 0xe9cf98, roughness: 0.55 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.8 });
  const sticker = new THREE.MeshStandardMaterial({ color: 0x1a73e8, roughness: 0.4, metalness: 0.3 });
  const blade = new THREE.BoxGeometry(0.95, 3.2, 0.28);
  const handle = new THREE.CylinderGeometry(0.13, 0.15, 1.5, 16);
  const label = new THREE.BoxGeometry(0.8, 0.5, 0.02);
  e.disposables.push(willow, grip, sticker, blade, handle, label);
  const bat = new THREE.Group();
  const b = new THREE.Mesh(blade, willow);
  b.position.y = -1.6;
  const h = new THREE.Mesh(handle, grip);
  h.position.y = 0.75;
  const s = new THREE.Mesh(label, sticker);
  s.position.set(0, -0.6, 0.15);
  bat.add(b, h, s);
  e.root.add(bat);
  return bat;
}

/** five-point star outline extruded */
function starGeometry() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.22 : 0.55;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
  g.center();
  return g;
}

/** soft grass patch so ground-level effects have a floor that fades at the edges */
function grassPatch(e: Effect, y: number, w = 30, d = 16) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#2f8f46' : '#287a3c';
    g.fillRect(0, i * 32, 256, 32);
  }
  const mask = g.createRadialGradient(128, 128, 40, 128, 128, 128);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = mask;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(w, d);
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.9 });
  e.disposables.push(tex, geo, mat);
  const plane = new THREE.Mesh(geo, mat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = y;
  e.root.add(plane);
  e.updaters.push((t) => (mat.opacity = Math.min(1, t / 0.35)));
}

/** particles that burst from `from` at `at`, then gather into the shape of `word` */
function particleWord(k: Celebration3D, e: Effect, word: string, from: THREE.Vector3, at: number, colors: number[], count = 1100, y = 0.6) {
  const tg = k.textGeometry(word, 7);
  if (!tg) return;
  const src = tg.getAttribute('position');
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const target: THREE.Vector3[] = [];
  const burst: THREE.Vector3[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const j = Math.floor(Math.random() * src.count);
    target.push(v(src.getX(j) * 1.0, src.getY(j) + y, src.getZ(j)));
    burst.push(v(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 9)).add(from));
    c.setHex(colors[i % colors.length]);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.13, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  e.disposables.push(geo, mat);
  const pts = new THREE.Points(geo, mat);
  e.root.add(pts);
  const p = new THREE.Vector3();
  e.updaters.push((t) => {
    const lt = t - at;
    pts.visible = lt > 0;
    if (lt <= 0) return;
    const out = easeOut(lt / 0.45);
    const gather = easeOut((lt - 0.55) / 0.7);
    for (let i = 0; i < count; i++) {
      p.copy(from).lerp(burst[i], out).lerp(target[i], gather);
      if (gather >= 1) p.y += Math.sin(t * 6 + i) * 0.02;
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
    }
    geo.attributes.position.needsUpdate = true;
    mat.size = 0.13 + (gather >= 1 ? 0.03 * Math.sin(t * 9) : 0);
  });
}

/* ---------------- FOUR ---------------- */

function four(k: Celebration3D, e: Effect, variant: number, confetti: number[]) {
  const blue = k.metal(0x5b9bff, 0x0b3d91, 0.5);
  k.flash.color.setHex(0x4c8df6);
  switch (variant) {
    case 1: {
      // the umpire's wave on a hologram platform
      holoDisc(e, -4.8, -5.1, 3.1, 0x22d3ee);
      addUmpire(e, 'four', { x: -4.8, y: -5.1, scale: 1.3, at: 0.15, turn: 0.25 });
      k.addText(e, 'FOUR', blue, { enter: 'zoom', maxWidth: 9, x: 3.6, y: 1.2 });
      k.addText(e, 'BOUNDARY', k.metal(0xffffff, 0x223355, 0.3), { enter: 'drop', maxWidth: 6.5, x: 3.6, y: -1.8, delay: 0.5 });
      k.addConfetti(e, confetti, 160, v(4, -4, 0), 0.8, 0.4);
      return true;
    }
    case 2: {
      // ball races across the turf and thumps the rope
      e.cam = (t, cam) => {
        cam.position.set(Math.sin(t * 0.4) * 0.8, 1.6, 15.5 - Math.min(1.2, t * 0.4));
        cam.lookAt(0, -1.2, 0);
      };
      grassPatch(e, -3.75);
      const n = 70;
      const geo = new THREE.SphereGeometry(0.24, 12, 8);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.5 });
      e.disposables.push(geo, mat);
      const rope = new THREE.InstancedMesh(geo, mat, n);
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) rope.setColorAt(i, c.setHex(Math.floor(i / 4) % 2 ? 0xffffff : 0x1a73e8));
      e.root.add(rope);
      const hitX = 1.2;
      const hitAt = 0.8;
      const m = new THREE.Matrix4();
      e.updaters.push((t) => {
        const lt = t - hitAt;
        const push = lt > 0 ? Math.exp(-lt * 2.2) * Math.sin(lt * 9 + 0.6) * 1.4 : 0;
        for (let i = 0; i < n; i++) {
          const x = -14 + (i / (n - 1)) * 28;
          const z = -0.015 * x * x - Math.exp(-((x - hitX) ** 2) / 3) * push;
          m.makeTranslation(x, -3.5, z);
          rope.setMatrixAt(i, m);
        }
        rope.instanceMatrix.needsUpdate = true;
      });
      k.addBall(e, (t) => {
        if (t < 0 || t > 1.9) return null;
        if (t < hitAt) {
          const u = t / hitAt;
          return v(-3 + (hitX + 3) * u, -3.25 + Math.abs(Math.sin(u * 9)) * 0.25 * (1 - u), 11 - 11 * u);
        }
        const u = t - hitAt;
        return v(hitX + u * 0.8, -3.25 + Math.max(0, Math.sin(u * 3.2) * 1.6), 0.2 + u * 3.5);
      }, 0.32);
      k.addFirework(e, hitAt, v(hitX, -3.3, 0.2), [0xffffff, 0x8ab4f8, 0x22d3ee], 220);
      k.addText(e, 'FOUR', blue, { enter: 'drop', maxWidth: 9, y: 1.9, delay: hitAt - 0.15 });
      return true;
    }
    case 3: {
      // a neon "4" spinning in out of a speed tunnel
      speedLines(e, 0x22d3ee);
      const neon = new THREE.MeshStandardMaterial({ color: 0x9fe7ff, emissive: 0x00b7ff, emissiveIntensity: 1.6, metalness: 0.3, roughness: 0.25 });
      k.addText(e, '4', neon, { enter: 'spin', maxWidth: 4.2, y: 1.1 });
      k.addRing(e, 0x22d3ee, { y: 1.1, tilt: 0, grow: 2.2 });
      k.addText(e, 'BOUNDARY!', k.metal(0xffffff, 0x0b3d91, 0.4), { enter: 'slam', maxWidth: 9, y: -3.4, delay: 0.55 });
      return true;
    }
    case 4: {
      // four balls orbit the word, then fly out into a confetti burst; umpire jumps for joy
      k.addText(e, 'FOUR', blue, { enter: 'spin', maxWidth: 9, y: 0.9 });
      for (let i = 0; i < 4; i++) {
        const ph = (i / 4) * Math.PI * 2;
        k.addBall(e, (t) => {
          if (t > 2.4) return null;
          const a = ph + t * 3.2;
          const r = t < 1.8 ? 5.2 * easeOut(t / 0.5) : 5.2 + (t - 1.8) * 30;
          return v(Math.cos(a) * r, 0.9 + Math.sin(a) * r * 0.35, Math.sin(a) * 2.5);
        }, 0.45);
      }
      k.addConfetti(e, confetti, 260, v(0, 0.5, 0), 1.3, 1.8);
      addUmpire(e, 'excited', { x: 7.6, y: -5.7, scale: 0.95, at: 0.3, turn: -0.35 });
      return true;
    }
  }
  return false;
}

/* ---------------- SIX ---------------- */

function six(k: Celebration3D, e: Effect, variant: number, confetti: number[]) {
  const gold = k.metal(0xffc83d, 0x7a4b00, 0.45);
  k.flash.color.setHex(0xb06cff);
  switch (variant) {
    case 1: {
      // both arms up
      holoDisc(e, -4.8, -5.1, 3.1, 0xb06cff);
      addUmpire(e, 'six', { x: -4.8, y: -5.1, scale: 1.3, at: 0.15, turn: 0.25 });
      k.addText(e, 'SIX', gold, { enter: 'drop', maxWidth: 6, x: 3.8, y: 1.9 });
      k.addText(e, 'MAXIMUM', k.metal(0xffffff, 0x4a2a7a, 0.4), { enter: 'zoom', maxWidth: 6.5, x: 3.8, y: -2.6, delay: 0.6 });
      k.addFirework(e, 0.8, v(3.8, 4.5, -3), [0xffd34d, 0xb06cff, 0xffffff]);
      k.addFirework(e, 1.4, v(-1, 5, -5), [0x1a73e8, 0xffffff, 0xff5ab4]);
      k.addFirework(e, 2.1, v(7, 3.5, -4), [0x34a853, 0xfbbc04, 0xffffff]);
      return true;
    }
    case 2: {
      // the ball sails away into a packed stand that erupts
      e.cam = (t, cam) => {
        cam.position.set(0, -0.5 + Math.min(1, t * 0.5), 16);
        cam.lookAt(0, 2.2, -10);
      };
      const tierGeo = new THREE.BoxGeometry(46, 1.2, 2.6);
      const tierMat = new THREE.MeshStandardMaterial({ color: 0x2b3245, roughness: 0.8 });
      const headGeo = new THREE.SphereGeometry(0.28, 8, 6);
      const headMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
      e.disposables.push(tierGeo, tierMat, headGeo, headMat);
      const tiers = 7;
      for (let i = 0; i < tiers; i++) {
        const tier = new THREE.Mesh(tierGeo, tierMat);
        tier.position.set(0, -1 + i * 1.3, -16 - i * 2.4);
        e.root.add(tier);
      }
      const perRow = 60;
      const fans = new THREE.InstancedMesh(headGeo, headMat, perRow * tiers);
      const fanCols = [0xea4335, 0xfbbc04, 0x1a73e8, 0xffffff, 0x34a853, 0xff5ab4, 0xb06cff];
      const c = new THREE.Color();
      const base: { x: number; y: number; z: number; ph: number }[] = [];
      for (let i = 0; i < tiers; i++)
        for (let j = 0; j < perRow; j++) {
          base.push({ x: -22 + (j / (perRow - 1)) * 44 + rand(-0.2, 0.2), y: -1 + i * 1.3 + 0.95, z: -16 - i * 2.4 + rand(-0.4, 0.4), ph: rand(0, 6) });
          fans.setColorAt(i * perRow + j, c.setHex(fanCols[Math.floor(Math.random() * fanCols.length)]));
        }
      e.root.add(fans);
      const landAt = 1.25;
      const m = new THREE.Matrix4();
      e.updaters.push((t) => {
        const cheer = t > landAt ? 1 : 0.15;
        base.forEach((b, i) => {
          m.makeTranslation(b.x, b.y + Math.max(0, Math.sin(t * 9 + b.ph)) * 0.45 * cheer, b.z);
          fans.setMatrixAt(i, m);
        });
        fans.instanceMatrix.needsUpdate = true;
      });
      k.addBall(e, (t) => {
        if (t < 0 || t > landAt) return null;
        const u = t / landAt;
        return v(2.5 * u, -5 + 12 * u + 7 * Math.sin(Math.PI * u), 10 - 34 * u);
      }, 0.5);
      for (let i = 0; i < 4; i++) k.addFirework(e, landAt + 0.15 + i * 0.45, v(rand(-12, 12), rand(9, 13), rand(-24, -18)), [0xffd34d, 0xb06cff, 0xffffff, 0xff5ab4], 380);
      k.addText(e, 'SIX', gold, { enter: 'slam', maxWidth: 7, y: 2.2, z: 3, delay: landAt - 0.1 });
      k.addText(e, 'INTO THE CROWD', k.metal(0xffffff, 0x4a2a7a, 0.4), { enter: 'drop', maxWidth: 8, y: -1.3, z: 3, delay: landAt + 0.4 });
      return true;
    }
    case 3: {
      // the ball smashes through a pane of glass to reveal SIX
      const breakAt = 0.55;
      const cols = 14;
      const rows = 8;
      const cw = 15 / cols;
      const ch = 8.4 / rows;
      const triA = new THREE.BufferGeometry().setFromPoints([v(-cw / 3, -ch / 3, 0), v((2 * cw) / 3, -ch / 3, 0), v(-cw / 3, (2 * ch) / 3, 0)]);
      const triB = new THREE.BufferGeometry().setFromPoints([v(cw / 3, ch / 3, 0), v(-(2 * cw) / 3, ch / 3, 0), v(cw / 3, -(2 * ch) / 3, 0)]);
      triA.computeVertexNormals();
      triB.computeVertexNormals();
      const glass = new THREE.MeshStandardMaterial({ color: 0xcfeaff, metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.38, side: THREE.DoubleSide });
      e.disposables.push(triA, triB, glass);
      const n = cols * rows;
      const meshes = [new THREE.InstancedMesh(triA, glass, n), new THREE.InstancedMesh(triB, glass, n)];
      const shards = meshes.map((_, h) =>
        Array.from({ length: n }, (_, i) => {
          const cx = -7.5 + (i % cols) * cw + (h ? (2 * cw) / 3 : cw / 3);
          const cy = -4.2 + Math.floor(i / cols) * ch + (h ? (2 * ch) / 3 : ch / 3);
          const p = v(cx, cy + 0.6, 2);
          const away = v(cx, cy, 0).normalize();
          const near = Math.max(0.25, 1.4 - Math.hypot(cx, cy) / 8);
          return { p, vel: v(away.x * rand(3, 9) * near, away.y * rand(3, 9) * near + rand(0, 3), rand(5, 14) * near), r: v(0, 0, 0), w: v(rand(-9, 9), rand(-9, 9), rand(-9, 9)) };
        }),
      );
      meshes.forEach((m) => e.root.add(m));
      const mat4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const eu = new THREE.Euler();
      const one = v(1, 1, 1);
      e.updaters.push((t, dt) => {
        meshes.forEach((mesh, h) => {
          shards[h].forEach((s, i) => {
            if (t > breakAt) {
              s.vel.y -= 9 * dt;
              s.p.addScaledVector(s.vel, dt);
              s.r.addScaledVector(s.w, dt);
            }
            mat4.compose(s.p, q.setFromEuler(eu.set(s.r.x, s.r.y, s.r.z)), one);
            mesh.setMatrixAt(i, mat4);
          });
          mesh.instanceMatrix.needsUpdate = true;
        });
        glass.opacity = t > breakAt ? Math.max(0, 0.38 * (1 - (t - breakAt) / 1.6)) : 0.38;
      });
      k.addBall(e, (t) => (t < 0 || t > 1.1 ? null : v(0.4 * t, 0.4, -26 + t * 52)), 0.6);
      k.addText(e, 'SIX', gold, { enter: 'zoom', maxWidth: 8, y: 0.6, z: -2 });
      k.addFirework(e, breakAt, v(0, 0.6, 2), [0xffffff, 0xcfeaff, 0xffd34d], 300);
      k.addConfetti(e, confetti, 200, v(0, -4, 0), 1.2, 0.9);
      return true;
    }
    case 4: {
      // rocket launch: the ball climbs, explodes, and the sparks gather into a giant 6
      const pop = 0.75;
      k.addBall(e, (t) => (t < 0 || t > pop ? null : v(Math.sin(t * 8) * 0.3, -7 + (t / pop) * 9, 1)), 0.55);
      particleWord(k, e, '6', v(0, 2, 1), pop, [0xffd34d, 0xffffff, 0xb06cff, 0xff9d2e], 1300, 0.9);
      k.addFirework(e, pop, v(0, 2, 1), [0xffd34d, 0xffffff, 0xb06cff], 500);
      k.addFirework(e, 2.2, v(-7, 4, -4), [0x1a73e8, 0xffffff, 0xea4335]);
      k.addFirework(e, 2.7, v(7, 4.5, -4), [0x34a853, 0xfbbc04, 0xffffff]);
      k.addText(e, 'MAXIMUM', gold, { enter: 'slam', maxWidth: 8, y: -3.6, delay: 1.6 });
      return true;
    }
  }
  return false;
}

/* ---------------- WICKET ---------------- */

function wicket(k: Celebration3D, e: Effect, variant: number) {
  const red = k.metal(0xff3b3b, 0x6b0000, 0.6);
  k.flash.color.setHex(0xff2a2a);
  switch (variant) {
    case 1: {
      // the slow finger, camera pushing in under a red spotlight
      e.cam = (t, cam) => {
        const p = easeOut(t / 2.5);
        cam.position.set(-1.2 * p, 0.2 * p, 16 - 3.5 * p);
        cam.lookAt(-1.2 * p, 0, 0);
      };
      beam(e, -4, 9, 0xff2a2a, 0.6, 0, 18);
      holoDisc(e, -4, -5.2, 2.8, 0xff3b3b);
      addUmpire(e, 'out', { x: -4, y: -5.2, scale: 1.35, at: 0.1, turn: 0.2 });
      k.addText(e, 'OUT!', red, { enter: 'slam', maxWidth: 7, x: 3.6, y: 0.8, delay: 1.0 });
      return true;
    }
    case 2: {
      // slow-motion bowled: the camera circles the stumps as the bails fly
      e.cam = (t, cam) => {
        const a = -0.7 + t * 0.32;
        cam.position.set(Math.sin(a) * 11, 0.8, Math.cos(a) * 11);
        cam.lookAt(0, -0.6, 0);
      };
      grassPatch(e, -3.2, 18, 18);
      k.addStumps(e, 0.9);
      k.addBall(e, (t) => (t < 0 || t > 0.95 ? null : v(0.25 - t * 0.25, -2 + Math.abs(Math.sin(t * 3.5)) * 0.6, 10 - (t / 0.9) * 10)), 0.42);
      k.addRing(e, 0xff3b3b, { y: -3.1, tilt: Math.PI / 2, grow: 1.2 });
      k.addText(e, 'BOWLED!', red, { enter: 'drop', maxWidth: 9, y: 3.4, delay: 1.1 });
      return true;
    }
    case 3: {
      // sirens, shake and an umpire who has no doubt at all
      beam(e, -9, 7, 0xff1a1a, 4.5, 0);
      beam(e, 9, 7, 0xff1a1a, 4.5, Math.PI);
      e.shakeUntil = 1.2;
      k.addText(e, 'HOWZAT!', red, { enter: 'slam', maxWidth: 12, x: 1.8, y: 2 });
      addUmpire(e, 'out', { x: -6.3, y: -5.6, scale: 1.15, at: 0.35, turn: 0.3 });
      k.addFirework(e, 0.3, v(1.8, 2, 0), [0xff3b3b, 0xffffff, 0x220000], 320);
      return true;
    }
    case 4: {
      // the bat drops: it tumbles out of the sky and lands in the dust
      grassPatch(e, -3.75);
      const bat = makeBat(e);
      const landAt = 1.05;
      e.updaters.push((t) => {
        if (t < landAt) {
          const u = t / landAt;
          bat.position.set(3 - 2 * u, 9 - 12.4 * u * u, -1);
          bat.rotation.set(t * 2, 0, t * 9);
        } else {
          const lt = t - landAt;
          const bounce = Math.max(0, Math.sin(lt * 9) * Math.exp(-lt * 5)) * 0.6;
          bat.position.set(1, -3.45 + bounce, -1);
          bat.rotation.set(-Math.PI / 2, 0, Math.PI / 2 + 0.25);
        }
      });
      k.addFirework(e, landAt, v(0.5, -3.4, -1), [0xc8a96a, 0xe0c9a0, 0xffffff], 300);
      k.addText(e, 'WICKET!', red, { enter: 'slam', maxWidth: 12, y: 2.4, delay: landAt - 0.1 });
      e.shakeUntil = 0;
      e.updaters.push((t) => {
        if (t > landAt && t < landAt + 0.05) e.shakeUntil = landAt + 0.5;
      });
      return true;
    }
  }
  return false;
}

/* ---------------- milestones & other big moments ---------------- */

function festive(k: Celebration3D, e: Effect, variant: number, word: string, color: number, emissive: number, bat: 'bat' | 'ball', acc: number) {
  const mat = k.metal(color, emissive, 0.55);
  const confetti = [color, 0xffffff, 0xffa500, acc];
  k.flash.color.setHex(color);
  switch (variant) {
    case 1: {
      // the umpire can't help applauding
      k.addText(e, word, mat, { enter: 'spin', maxWidth: 11, x: -2.2, y: 0.9 });
      holoDisc(e, 6.2, -5.2, 2.4, color);
      addUmpire(e, 'clap', { x: 6.2, y: -5.2, scale: 1.2, at: 0.3, turn: -0.4 });
      k.addConfetti(e, confetti, 280, v(-2, -4, 0), 1.2);
      for (let i = 0; i < 3; i++) k.addFirework(e, 0.7 + i * 0.6, v(rand(-8, 4), rand(2.5, 5), rand(-4, -1)), [color, 0xffffff, 0xffa500]);
      return true;
    }
    case 2: {
      // the bat (or ball, for bowlers) raised to the crowd inside a halo
      k.addRing(e, color, { y: -0.4, tilt: 0, grow: 1.6 });
      if (bat === 'bat') {
        const b = makeBat(e);
        e.updaters.push((t) => {
          const p = easeOutBack(t / 0.9);
          b.position.set(0, -9 + 10.6 * p, 0);
          b.rotation.set(0, t * 1.4, Math.sin(t * 2) * 0.12);
        });
      } else {
        k.addBall(e, (t) => v(0, -9 + 8.6 * easeOutBack(t / 0.9), 0), 1.5);
      }
      k.addFirework(e, 0.9, v(0, 0.5, -1), [color, 0xffffff, 0xffa500], 520);
      k.addText(e, word, mat, { enter: 'drop', maxWidth: 11, y: 4, delay: 0.5 });
      return true;
    }
    case 3: {
      // a crown of gold stars orbits the word, then bursts outward
      k.addText(e, word, mat, { enter: 'zoom', maxWidth: 12, y: 0.6 });
      const geo = starGeometry();
      e.disposables.push(geo);
      const sm = k.metal(color, emissive, 0.7);
      for (let i = 0; i < 14; i++) {
        const s = new THREE.Mesh(geo, sm);
        const ph = (i / 14) * Math.PI * 2;
        e.root.add(s);
        e.updaters.push((t) => {
          const a = ph + t * 1.6;
          const r = (t < 2.2 ? 6.2 * easeOutBack(t / 0.8) : 6.2 + (t - 2.2) * 14) * (1 + 0.05 * Math.sin(t * 5 + i));
          s.position.set(Math.cos(a) * r, 0.6 + Math.sin(a) * r * 0.45, Math.sin(a) * 1.5);
          s.rotation.set(t * 2 + i, t * 3, 0);
          s.scale.setScalar(Math.max(0.001, easeOutBack((t - i * 0.04) / 0.5)));
        });
      }
      k.addConfetti(e, confetti, 220, v(0, 0.6, 0), 1.4, 2.2);
      return true;
    }
    case 4: {
      // spotlight stage: searchlights sweep as the word rises off a glowing platform
      holoDisc(e, 0, -4.4, 5, color);
      beam(e, -8, 9, color, 1.2, 0, 18);
      beam(e, 8, 9, color, 1.2, Math.PI, 18);
      beam(e, 0, 10, 0xffffff, 0.9, 1.5, 18);
      const txt = k.addText(e, word, mat, { enter: 'spin', maxWidth: 12, y: 0.4 });
      if (txt) e.updaters.push((t) => (txt.position.y = -3.6 + 4 * easeOut(t / 1)));
      for (let i = 0; i < 4; i++) k.addFirework(e, 1 + i * 0.5, v(rand(-8, 8), rand(3, 5.5), rand(-5, -2)), [color, 0xffffff, acc]);
      return true;
    }
  }
  return false;
}

/** Plays variant 1-4 for the overlay; false means "use the original look" (variant 0 / unknown). */
export function playVariant(k: Celebration3D, e: Effect, o: ActiveOverlay, accent: string): boolean {
  const variant = o.variant ?? 0;
  if (variant <= 0) return false;
  const acc = new THREE.Color(accent).getHex();
  const confetti = [0x1a73e8, 0xea4335, 0xfbbc04, 0x34a853, 0xffffff, acc];
  switch (o.id) {
    case 'four':
      return four(k, e, variant, confetti);
    case 'six':
      return six(k, e, variant, confetti);
    case 'wicket':
      return wicket(k, e, variant);
    case 'milestone': {
      const word = (o.value ?? 0) >= 100 ? 'CENTURY' : 'FIFTY';
      return festive(k, e, variant, word, 0xffd34d, 0x7a5200, 'bat', acc);
    }
    case 'fiveWickets':
      return festive(k, e, variant, '5 WICKETS', 0xffd34d, 0x7a5200, 'ball', acc);
    case 'partnership':
      return festive(k, e, variant, `${o.value ?? 50} STAND`, 0x8ab4f8, 0x0b3d91, 'bat', acc);
    case 'hattrick':
      return festive(k, e, variant, 'HAT-TRICK BALL', 0xff9d2e, 0x7a2e00, 'ball', acc);
    case 'inningsEnd':
    case 'matchEnd': {
      if (variant % 2 === 0) return false;
      const word = o.id === 'matchEnd' ? 'MATCH OVER' : 'INNINGS BREAK';
      return festive(k, e, 1, word, 0xe8eaed, 0x333333, 'bat', acc);
    }
  }
  return false;
}
