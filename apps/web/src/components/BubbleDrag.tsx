import { useRef, useState, type PointerEvent } from 'react';
import { Box } from '@mui/material';
import { PROGRAM_H, PROGRAM_W, hitBubble, type CamBubbleShape } from '@cricstudio/shared';
import { bubblesVisible, liveBubbleBoxes } from '../compositor/camBubbles';
import type { StudioClient } from '../lib/studioClient';

/** Drag handles over the preview. The program output page does not mount this. */
export function BubbleDrag({ client, onlyId }: { client: StudioClient; onlyId?: string }) {
  const st = client.state;
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [spot, setSpot] = useState<{ id: string; x: number; y: number } | null>(null);
  if (!st || !bubblesVisible(st)) return null;
  const boxes = liveBubbleBoxes(st, client.match, spot ?? undefined).filter((b) => onlyId === undefined || b.id === onlyId);
  if (!boxes.length) return null;

  const point = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * PROGRAM_W,
      y: ((e.clientY - r.top) / r.height) * PROGRAM_H,
    };
  };

  return (
    <Box
      ref={ref}
      sx={{ position: 'absolute', inset: 0, zIndex: 2, touchAction: 'none' }}
      onPointerDown={(e) => {
        const p = point(e);
        const hit = hitBubble(boxes, p.x, p.y);
        if (!hit) return;
        if (onlyId !== undefined && hit.id !== onlyId) return;
        drag.current = { id: hit.id, dx: p.x - hit.x, dy: p.y - hit.y };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const held = drag.current;
        if (!held) return;
        const p = point(e);
        const x = p.x - held.dx;
        const y = p.y - held.dy;
        setSpot({ id: held.id, x, y });
        client.holdBubble(held.id, x, y);
      }}
      onPointerUp={(e) => {
        const held = drag.current;
        if (!held) return;
        const p = point(e);
        drag.current = null;
        setSpot(null);
        void client.releaseBubble(held.id, p.x - held.dx, p.y - held.dy).catch(() => undefined);
      }}
    >
      {boxes.map((b) => (
        <Box
          key={b.id}
          sx={{
            position: 'absolute',
            left: `${(b.x / PROGRAM_W) * 100}%`,
            top: `${(b.y / PROGRAM_H) * 100}%`,
            width: `${(b.w / PROGRAM_W) * 100}%`,
            height: `${(b.h / PROGRAM_H) * 100}%`,
            border: '2px dashed rgba(255,255,255,0.9)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
            pointerEvents: 'none',
            ...outlineOf(b.shape),
          }}
        />
      ))}
    </Box>
  );
}

function outlineOf(shape: CamBubbleShape): { borderRadius?: string | number; clipPath?: string } {
  if (shape === 'ball' || shape === 'oval') return { borderRadius: '50%' };
  if (shape === 'rounded' || shape === 'wide') return { borderRadius: '18%' };
  if (shape === 'stumps') return { borderRadius: 6 };
  if (shape === 'diamond') return { clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' };
  if (shape === 'shield') return { clipPath: 'polygon(8% 6%, 92% 6%, 92% 55%, 50% 96%, 8% 55%)' };
  return { borderRadius: 0 };
}
