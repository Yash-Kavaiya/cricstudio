/** Camera frames over the program (1920×1080). Shared by the server sanitiser and the compositor. */

export const PROGRAM_W = 1920;
export const PROGRAM_H = 1080;

export type CamBubbleCorner = 'br' | 'bl' | 'tr' | 'tl';

export const CAM_BUBBLE_SHAPES = [
  { id: 'ball', name: 'Cricket ball', blurb: 'Round leather ball' },
  { id: 'square', name: 'Square', blurb: 'Sharp square frame' },
  { id: 'rounded', name: 'Rounded square', blurb: 'Soft square tile' },
  { id: 'stumps', name: 'Stumps', blurb: 'Tall wicket frame' },
  { id: 'wide', name: 'Wide', blurb: '16:9 broadcast tile' },
  { id: 'oval', name: 'Oval', blurb: 'Portrait oval' },
  { id: 'diamond', name: 'Diamond', blurb: 'Diamond tile' },
  { id: 'shield', name: 'Shield', blurb: 'Crest shield' },
] as const;

export type CamBubbleShape = (typeof CAM_BUBBLE_SHAPES)[number]['id'];

/** A person's frame. Missing x/y means "pack into the chosen corner". */
export interface CamBubbleSlot {
  x?: number;
  y?: number;
  shape?: CamBubbleShape;
}

export interface BubbleBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: CamBubbleShape;
  /** true when this box came from a saved x,y rather than the corner row */
  placed: boolean;
}

export interface BubblePatch {
  x?: number;
  y?: number;
  /** null clears a per-person shape and follows the show shape */
  shape?: CamBubbleShape | null;
  /** forget x,y and return this person to the corner row */
  clearPosition?: boolean;
  /** forget this person's slot entirely */
  clear?: boolean;
}

const MARGIN = 36;
const GAP = 22;
const CORNERS: CamBubbleCorner[] = ['br', 'bl', 'tr', 'tl'];
const MAX_SLOTS = 12;

export function isCamBubbleShape(v: unknown): v is CamBubbleShape {
  return typeof v === 'string' && CAM_BUBBLE_SHAPES.some((s) => s.id === v);
}

export function shapeSize(size: number, shape: CamBubbleShape): { w: number; h: number } {
  switch (shape) {
    case 'stumps':
      return { w: size * 0.78, h: size * 1.22 };
    case 'wide':
      return { w: size * 1.55, h: size * 0.88 };
    case 'oval':
      return { w: size * 0.92, h: size * 1.18 };
    default:
      return { w: size, h: size };
  }
}

export function bubbleNameHeight(w: number, h: number): number {
  return Math.max(28, Math.min(w, h) * 0.16);
}

/** How far corner-packed frames sit above the bottom edge (scorebug or ticker). */
export function bubbleInset(barOn: boolean, tickerOn: boolean): number {
  return barOn ? 230 : tickerOn ? 56 : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(hi, Math.max(lo, v));
}

/** Keep a frame, including its name pill, inside the program picture. */
export function clampBubbleOrigin(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const nameH = bubbleNameHeight(w, h);
  return {
    x: clamp(x, 12, PROGRAM_W - w - 12),
    y: clamp(y, 12, PROGRAM_H - h - nameH - 10),
  };
}

interface Person {
  id: string;
  role?: string;
  onStage?: boolean;
  joinedAt?: number;
}

/** Host first, then guests in the order they joined. Program outputs are not on stage. */
export function onStagePeople<T extends Person>(participants: T[]): T[] {
  return participants
    .filter((p) => p.onStage && p.role !== 'program')
    .sort((a, b) => (a.role === 'host' ? -1 : b.role === 'host' ? 1 : (a.joinedAt ?? 0) - (b.joinedAt ?? 0)));
}

interface LayoutBrand {
  camBubbleCorner?: CamBubbleCorner;
  camBubbleSize?: number;
  camBubbleShape?: CamBubbleShape;
  camBubbleSlots?: Record<string, CamBubbleSlot>;
}

/**
 * Where each on-stage person is drawn.
 * People with a saved x,y stay there. Everyone else packs into the corner, right-to-left
 * or left-to-right, same geometry the round bubbles used before frames could be placed.
 */
export function bubbleLayout(people: { id: string }[], brand: LayoutBrand, bottomInset: number): BubbleBox[] {
  const size = clamp(brand.camBubbleSize ?? 220, 120, 400);
  const corner: CamBubbleCorner = CORNERS.includes(brand.camBubbleCorner as CamBubbleCorner) ? (brand.camBubbleCorner as CamBubbleCorner) : 'br';
  const showShape: CamBubbleShape = isCamBubbleShape(brand.camBubbleShape) ? brand.camBubbleShape : 'ball';
  const slots = brand.camBubbleSlots ?? {};
  const drafted = people.slice(0, 8).map((p) => {
    const slot = slots[p.id];
    const shape: CamBubbleShape = slot && isCamBubbleShape(slot.shape) ? slot.shape : showShape;
    const { w, h } = shapeSize(size, shape);
    const placed = !!slot && Number.isFinite(slot.x) && Number.isFinite(slot.y);
    return { id: p.id, shape, w, h, placed, x: slot?.x ?? 0, y: slot?.y ?? 0 };
  });
  const free = drafted.filter((d) => !d.placed);
  const packed = packCorner(free, corner, bottomInset);
  let i = 0;
  return drafted.map((d) => {
    if (d.placed) {
      const fit = clampBubbleOrigin(d.x, d.y, d.w, d.h);
      return { id: d.id, shape: d.shape, w: d.w, h: d.h, placed: true, x: fit.x, y: fit.y };
    }
    const p = packed[i++];
    return { id: d.id, shape: d.shape, w: p.w, h: p.h, placed: false, x: p.x, y: p.y };
  });
}

function packCorner(items: { w: number; h: number }[], corner: CamBubbleCorner, bottomInset: number): { x: number; y: number; w: number; h: number }[] {
  if (!items.length) return [];
  const widths = items.reduce((s, it) => s + it.w, 0);
  const gaps = GAP * (items.length - 1);
  const maxRow = PROGRAM_W - MARGIN * 2;
  // shrink the frames, not the gaps, so a full row lands on the margins (same as the old equal balls)
  const scale = widths + gaps > maxRow && widths > 0 ? (maxRow - gaps) / widths : 1;
  const right = corner === 'br' || corner === 'tr';
  const bottom = corner === 'br' || corner === 'bl';
  const out: { x: number; y: number; w: number; h: number }[] = [];
  let cursor = right ? PROGRAM_W - MARGIN : MARGIN;
  for (const it of items) {
    const w = it.w * scale;
    const h = it.h * scale;
    const nameH = bubbleNameHeight(w, h);
    const x = right ? cursor - w : cursor;
    const y = bottom ? PROGRAM_H - bottomInset - MARGIN - nameH - h : 104;
    out.push({ x, y, w, h });
    cursor = right ? x - GAP : x + w + GAP;
  }
  return out;
}

/** Top-most frame under a program-pixel point, or null. */
export function hitBubble(boxes: BubbleBox[], x: number, y: number): BubbleBox | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (insideShape(b, x, y)) return b;
  }
  return null;
}

function insideShape(b: BubbleBox, x: number, y: number): boolean {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = x - cx;
  const dy = y - cy;
  if (b.shape === 'ball') return dx * dx + dy * dy <= (Math.min(b.w, b.h) / 2) ** 2;
  if (b.shape === 'oval') return (dx / (b.w / 2)) ** 2 + (dy / (b.h / 2)) ** 2 <= 1;
  if (b.shape === 'diamond') return Math.abs(dx) / (b.w / 2) + Math.abs(dy) / (b.h / 2) <= 1;
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/** Host moves anyone. A guest moves only their own frame. */
export function canEditBubble(role: string | undefined, selfId: string, targetId: string): boolean {
  if (!cleanId(targetId)) return false;
  if (role === 'host') return true;
  return role === 'guest' && selfId === targetId;
}

function cleanId(id: unknown): string {
  const s = typeof id === 'string' ? id.trim() : '';
  return /^[^\s]{1,80}$/.test(s) ? s : '';
}

function num(v: unknown, lo: number, hi: number): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(hi, Math.max(lo, n));
}

/** Merge one person's frame edit into the slot map. Drops junk. Caps the map. */
export function applyBubblePatch(slots: Record<string, CamBubbleSlot> | undefined, participantId: string, patch: BubblePatch): Record<string, CamBubbleSlot> {
  const id = cleanId(participantId);
  const next: Record<string, CamBubbleSlot> = {};
  for (const [k, v] of Object.entries(slots ?? {})) {
    const key = cleanId(k);
    if (key) next[key] = { ...v };
  }
  if (!id) return capSlots(next);
  if (patch.clear) {
    delete next[id];
    return capSlots(next);
  }
  const prev = next[id] ?? {};
  const slot: CamBubbleSlot = {};
  if (!patch.clearPosition) {
    const x = patch.x !== undefined || patch.y !== undefined ? num(patch.x, -400, PROGRAM_W + 400) : num(prev.x, -400, PROGRAM_W + 400);
    const y = patch.x !== undefined || patch.y !== undefined ? num(patch.y, -400, PROGRAM_H + 400) : num(prev.y, -400, PROGRAM_H + 400);
    if (x !== undefined && y !== undefined) {
      slot.x = x;
      slot.y = y;
    }
  }
  let shape = prev.shape;
  if (patch.shape === null) shape = undefined;
  else if (isCamBubbleShape(patch.shape)) shape = patch.shape;
  if (isCamBubbleShape(shape)) slot.shape = shape;
  if (slot.shape || (slot.x !== undefined && slot.y !== undefined)) next[id] = slot;
  else delete next[id];
  return capSlots(next);
}

function capSlots(slots: Record<string, CamBubbleSlot>): Record<string, CamBubbleSlot> {
  const keys = Object.keys(slots);
  if (keys.length <= MAX_SLOTS) return slots;
  const keep = keys.slice(keys.length - MAX_SLOTS);
  const out: Record<string, CamBubbleSlot> = {};
  for (const k of keep) out[k] = slots[k];
  return out;
}

export interface BubbleBrandFields {
  camBubbles: boolean;
  camBubblesAllScenes: boolean;
  camBubbleCorner: CamBubbleCorner;
  camBubbleSize: number;
  camBubbleShape: CamBubbleShape;
  camBubbleSlots: Record<string, CamBubbleSlot>;
}

/** Clean the frame fields of a brand patch. Unknown values fall back to what is already saved. */
export function sanitizeBubbleFields(next: Partial<BubbleBrandFields>, prev: BubbleBrandFields): BubbleBrandFields {
  const corner = CORNERS.includes(next.camBubbleCorner as CamBubbleCorner) ? (next.camBubbleCorner as CamBubbleCorner) : prev.camBubbleCorner;
  const shape = isCamBubbleShape(next.camBubbleShape) ? next.camBubbleShape : prev.camBubbleShape;
  const size = num(next.camBubbleSize, 120, 400) ?? prev.camBubbleSize;
  let slots = prev.camBubbleSlots;
  if (next.camBubbleSlots && typeof next.camBubbleSlots === 'object') {
    // a brand patch carries the whole map, so slots that were removed do not come back
    slots = {};
    for (const [id, raw] of Object.entries(next.camBubbleSlots).slice(0, MAX_SLOTS)) {
      if (!raw || typeof raw !== 'object') continue;
      const shape = (raw as CamBubbleSlot).shape;
      slots = applyBubblePatch(slots, id, {
        x: (raw as CamBubbleSlot).x,
        y: (raw as CamBubbleSlot).y,
        shape: isCamBubbleShape(shape) ? shape : null,
      });
    }
  }
  return {
    camBubbles: typeof next.camBubbles === 'boolean' ? next.camBubbles : prev.camBubbles,
    camBubblesAllScenes: typeof next.camBubblesAllScenes === 'boolean' ? next.camBubblesAllScenes : prev.camBubblesAllScenes,
    camBubbleCorner: corner,
    camBubbleSize: Math.round(size),
    camBubbleShape: shape,
    camBubbleSlots: slots,
  };
}
