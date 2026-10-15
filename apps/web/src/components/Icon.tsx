import type { CSSProperties } from 'react';

export function Icon({ name, size = 22, fill = false, style, color }: { name: string; size?: number; fill?: boolean; style?: CSSProperties; color?: string }) {
  return (
    <span className={`msr${fill ? ' fill' : ''}`} style={{ fontSize: size, width: size, height: size, color, ...style }} aria-hidden>
      {name}
    </span>
  );
}
