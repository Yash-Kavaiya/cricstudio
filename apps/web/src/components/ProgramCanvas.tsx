import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import type { ProgramRenderer } from '../compositor/renderer';

/** Mounts the renderer's 1920x1080 canvas, scaled responsively at 16:9. */
export function ProgramCanvas({ renderer, rounded = true, live = false }: { renderer: ProgramRenderer; rounded?: boolean; live?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const c = renderer.canvas;
    c.style.width = '100%';
    c.style.height = '100%';
    c.style.display = 'block';
    el.appendChild(c);
    return () => {
      if (c.parentElement === el) el.removeChild(c);
    };
  }, [renderer]);
  return (
    <Box
      ref={ref}
      sx={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        bgcolor: '#000',
        borderRadius: rounded ? 1.5 : 0,
        overflow: 'hidden',
        boxShadow: live ? '0 0 0 3px #ea4335' : rounded ? 3 : 0,
        transition: 'box-shadow .3s',
      }}
    />
  );
}
