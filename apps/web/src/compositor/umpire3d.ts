// A simple 3D umpire (white coat, black trousers, wide-brim hat, shades) built from primitives,
// with the real on-field signals. Feet sit at the group's origin; the figure is ~3.9 units tall.
import * as THREE from 'three';
import { easeOut, easeOutBack, type Effect } from './fx3d';

export type UmpireSignal = 'four' | 'six' | 'out' | 'clap' | 'excited';

const SKIN = 0xc98d66;

export function addUmpire(
  e: Effect,
  signal: UmpireSignal,
  opts: { x?: number; y?: number; z?: number; scale?: number; at?: number; turn?: number } = {},
) {
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.75 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1b1d24, roughness: 0.6 });
  const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.6 });
  const shadesMat = new THREE.MeshStandardMaterial({ color: 0x050505, metalness: 0.9, roughness: 0.15 });
  const limb = new THREE.CapsuleGeometry(0.15, 0.62, 6, 12);
  const leg = new THREE.CapsuleGeometry(0.19, 1.05, 6, 12);
  const coat = new THREE.CylinderGeometry(0.46, 0.58, 1.75, 24);
  const shoulders = new THREE.SphereGeometry(0.47, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const head = new THREE.SphereGeometry(0.34, 24, 16);
  const brim = new THREE.CylinderGeometry(0.68, 0.68, 0.05, 32);
  const crown = new THREE.CylinderGeometry(0.33, 0.36, 0.3, 24);
  const hand = new THREE.SphereGeometry(0.14, 12, 8);
  const finger = new THREE.CapsuleGeometry(0.045, 0.24, 4, 8);
  const shoe = new THREE.BoxGeometry(0.32, 0.18, 0.55);
  const shades = new THREE.BoxGeometry(0.5, 0.11, 0.1);
  const tie = new THREE.BoxGeometry(0.12, 0.55, 0.05);
  e.disposables.push(white, black, skin, shadesMat, limb, leg, coat, shoulders, head, brim, crown, hand, finger, shoe, shades, tie);

  const root = new THREE.Group();
  root.position.set(opts.x ?? 0, opts.y ?? -5.2, opts.z ?? 0);
  const scale = opts.scale ?? 1.3;
  root.rotation.y = opts.turn ?? 0;
  const body = new THREE.Group();
  root.add(body);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z = 0, parent: THREE.Object3D = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  for (const sx of [-0.22, 0.22]) {
    add(leg, black, sx, 0.75);
    add(shoe, black, sx, 0.09, 0.1);
  }
  add(coat, white, 0, 2.05);
  add(shoulders, white, 0, 2.9).scale.set(1.25, 0.45, 0.9);
  add(tie, black, 0, 2.55, 0.5);
  const headGroup = new THREE.Group();
  headGroup.position.y = 3.3;
  body.add(headGroup);
  add(head, skin, 0, 0, 0, headGroup);
  add(shades, shadesMat, 0, 0.05, 0.29, headGroup);
  add(brim, white, 0, 0.27, 0, headGroup);
  add(crown, white, 0, 0.43, 0, headGroup);

  /** shoulder joint: `swing` turns around y, `raise` lifts the arm (z = sideways, x = forwards) */
  const arm = (side: 1 | -1) => {
    const swing = new THREE.Group();
    swing.position.set(side * 0.6, 2.85, 0);
    body.add(swing);
    const raise = new THREE.Group();
    swing.add(raise);
    add(limb, white, 0, -0.46, 0, raise);
    add(hand, skin, 0, -1.0, 0, raise);
    return { swing, raise };
  };
  const R = arm(1);
  const L = arm(-1);
  if (signal === 'out') add(finger, skin, 0, -1.2, 0, R.raise);
  e.root.add(root);

  const at = opts.at ?? 0;
  const PI = Math.PI;
  e.updaters.push((t) => {
    const lt = t - at;
    root.visible = lt >= 0;
    if (lt < 0) return;
    // pops up into frame
    const k = easeOutBack(lt / 0.5);
    root.scale.setScalar(Math.max(0.001, scale * k));
    body.rotation.y = Math.sin(lt * 1.3) * 0.08;
    headGroup.rotation.z = Math.sin(lt * 2.1) * 0.05;
    const up = easeOut((lt - 0.2) / 0.45);
    // relaxed arms hang slightly away from the coat
    R.raise.rotation.set(0, 0, 0.12);
    L.raise.rotation.set(0, 0, -0.12);
    R.swing.rotation.set(0, 0, 0);
    L.swing.rotation.set(0, 0, 0);
    body.position.y = 0;
    switch (signal) {
      case 'four': {
        // arm out in front, waved side to side across the body
        R.raise.rotation.x = (-PI / 2) * up;
        R.swing.rotation.y = Math.sin(lt * 7) * 0.85 * up;
        break;
      }
      case 'six': {
        // both arms straight up, with a little pump
        const pump = lt > 0.7 ? Math.sin(lt * 6) * 0.07 : 0;
        R.raise.rotation.z = (PI * 0.88 + pump) * up;
        L.raise.rotation.z = -(PI * 0.88 + pump) * up;
        break;
      }
      case 'out': {
        // the slow, dramatic finger
        const lift = easeOutBack((lt - 0.35) / 0.7);
        R.raise.rotation.z = 0.12 + (PI * 0.96 - 0.12) * Math.max(0, lift);
        R.raise.rotation.x = -0.15 * Math.max(0, lift);
        body.rotation.x = -0.05 * Math.max(0, lift);
        break;
      }
      case 'clap': {
        // arms forward, hands meeting in front of the chest
        const c = (Math.sin(lt * 15) + 1) / 2;
        R.raise.rotation.x = (-PI / 2.3) * up;
        L.raise.rotation.x = (-PI / 2.3) * up;
        R.swing.rotation.y = -(0.25 + 0.3 * c) * up;
        L.swing.rotation.y = (0.25 + 0.3 * c) * up;
        body.position.y = Math.abs(Math.sin(lt * 4)) * 0.12;
        break;
      }
      case 'excited': {
        // jumping, fists pumping alternately
        body.position.y = Math.abs(Math.sin(lt * 7)) * 0.55;
        R.raise.rotation.z = PI * (0.62 + 0.3 * Math.sin(lt * 7)) * up;
        L.raise.rotation.z = -PI * (0.62 + 0.3 * Math.sin(lt * 7 + PI)) * up;
        headGroup.rotation.z = Math.sin(lt * 7) * 0.12;
        break;
      }
    }
  });
  return root;
}
