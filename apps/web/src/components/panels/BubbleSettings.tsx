import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, FormControlLabel, Slider, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { CAM_BUBBLE_SHAPES, PROGRAM_H, PROGRAM_W, bubbleNameHeight, isCamBubbleShape, onStagePeople, type CamBubbleCorner, type CamBubbleShape } from '@cricstudio/shared';
import { liveBubbleBoxes } from '../../compositor/camBubbles';
import type { StudioClient } from '../../lib/studioClient';

/** Show-wide frame controls for the host, and the same shape and spot controls for one guest. */
export function BubbleSettings({ client, onlyId }: { client: StudioClient; onlyId?: string }) {
  const st = client.state!;
  const b = st.brand;
  const people = onStagePeople(st.participants).filter((p) => !onlyId || p.id === onlyId);
  const mine = onlyId ? st.participants.find((p) => p.id === onlyId) : undefined;
  const [size, setSize] = useState(b.camBubbleSize ?? 220);
  useEffect(() => setSize(b.camBubbleSize ?? 220), [b.camBubbleSize]);
  const patchBrand = (p: Partial<typeof b>) => void client.patch({ brand: { ...b, ...p } });
  const boxes = liveBubbleBoxes(st, client.match);
  const move = (id: string, x: number, y: number) => void client.setBubble(id, { x, y }).catch(() => undefined);

  if (onlyId) {
    const box = boxes.find((item) => item.id === onlyId);
    return (
      <Stack spacing={1}>
        <Typography variant="subtitle2">Your camera frame</Typography>
        {!b.camBubbles ? (
          <Typography variant="caption" color="text.secondary">
            The host turns camera frames on. Once they are on, drag yours anywhere on the preview, or type X and Y, and pick a shape here.
          </Typography>
        ) : (
          <>
            <Typography variant="caption" color="text.secondary">
              Drag your frame on the preview, or type X and Y. Numbers are pixels from the top-left of the 1920×1080 program. Reset puts it back in the corner row.
            </Typography>
            {box && <SpotFields box={box} onChange={(x, y) => move(onlyId, x, y)} />}
            <ShapePicker value={b.camBubbleSlots?.[onlyId]?.shape ?? ''} allowDefault onChange={(shape) => void client.setBubble(onlyId, { shape })} />
            <Button size="small" disabled={!mine?.onStage} onClick={() => void client.setBubble(onlyId, { clearPosition: true })} sx={{ alignSelf: 'flex-start' }}>
              Reset spot
            </Button>
          </>
        )}
      </Stack>
    );
  }

  return (
    <Box>
      <FormControlLabel
        control={<Switch checked={!!b.camBubbles} onChange={(e) => patchBrand({ camBubbles: e.target.checked })} />}
        label={
          <Box>
            <Typography variant="body2">Camera frames on every scene</Typography>
            <Typography variant="caption" color="text.secondary">
              Host and guests on stage stay on screen. Drag a frame on the preview, or type its X and Y. Each guest can move their own.
            </Typography>
          </Box>
        }
        sx={{ alignItems: 'flex-start', mx: 0 }}
      />
      {b.camBubbles && (
        <Stack spacing={1.25} sx={{ mt: 1, pl: 1 }}>
          <FormControlLabel
            control={<Switch checked={b.camBubblesAllScenes !== false} onChange={(e) => patchBrand({ camBubblesAllScenes: e.target.checked })} />}
            label={
              <Box>
                <Typography variant="body2">Also on full camera scenes</Typography>
                <Typography variant="caption" color="text.secondary">
                  On by default. Turn off to hide frames on Host, Panel, Desk and Screen Share, where the cameras are already full size.
                </Typography>
              </Box>
            }
            sx={{ alignItems: 'flex-start', mx: 0 }}
          />
          <Typography variant="caption" color="text.secondary">
            Shape for anyone who has not picked their own
          </Typography>
          <ShapePicker value={b.camBubbleShape ?? 'ball'} onChange={(shape) => shape && patchBrand({ camBubbleShape: shape })} />
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Typography variant="caption" color="text.secondary" sx={{ width: 56 }}>
              Corner
            </Typography>
            <ToggleButtonGroup size="small" exclusive value={b.camBubbleCorner ?? 'br'} onChange={(_, v: CamBubbleCorner | null) => v && patchBrand({ camBubbleCorner: v })}>
              <ToggleButton value="tl">Top left</ToggleButton>
              <ToggleButton value="tr">Top right</ToggleButton>
              <ToggleButton value="bl">Bottom left</ToggleButton>
              <ToggleButton value="br">Bottom right</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Typography variant="caption" color="text.secondary" sx={{ width: 56 }}>
              Size
            </Typography>
            <Slider
              size="small"
              min={120}
              max={400}
              step={10}
              value={size}
              valueLabelDisplay="auto"
              valueLabelFormat={(v) => `${v}px`}
              onChange={(_, v) => setSize(v as number)}
              onChangeCommitted={(_, v) => patchBrand({ camBubbleSize: v as number })}
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            People without a saved spot pack into that corner. Drag a dashed frame, or set X and Y in pixels from the top-left of the 1920×1080 program.
          </Typography>
          {people.map((p) => {
            const slot = b.camBubbleSlots?.[p.id];
            const box = boxes.find((item) => item.id === p.id);
            return (
              <Stack key={p.id} spacing={0.5}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {p.name}
                    {p.id === client.selfId ? ' (you)' : ''}
                  </Typography>
                  {slot?.x !== undefined && (
                    <Button size="small" onClick={() => void client.setBubble(p.id, { clearPosition: true })}>
                      Reset spot
                    </Button>
                  )}
                </Stack>
                {box && <SpotFields box={box} onChange={(x, y) => move(p.id, x, y)} />}
                <ShapePicker value={slot?.shape ?? ''} allowDefault onChange={(shape) => void client.setBubble(p.id, { shape })} />
              </Stack>
            );
          })}
          {!people.length && <Alert severity="info">Add the host or a guest to the stage to see the frames.</Alert>}
        </Stack>
      )}
    </Box>
  );
}

/** X and Y of the frame's top-left, in program pixels. Typing either axis keeps the other. */
function SpotFields({ box, onChange }: { box: { x: number; y: number; w: number; h: number }; onChange: (x: number, y: number) => void }) {
  const nameH = bubbleNameHeight(box.w, box.h);
  const minX = 12;
  const maxX = Math.max(minX, Math.round(PROGRAM_W - box.w - 12));
  const minY = 12;
  const maxY = Math.max(minY, Math.round(PROGRAM_H - box.h - nameH - 10));
  const spot = useRef({ x: Math.round(box.x), y: Math.round(box.y) });
  useEffect(() => {
    spot.current = { x: Math.round(box.x), y: Math.round(box.y) };
  }, [box.x, box.y]);
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <CoordField
        label="X"
        value={box.x}
        min={minX}
        max={maxX}
        onCommit={(x) => {
          const y = spot.current.y;
          spot.current = { x, y };
          onChange(x, y);
        }}
      />
      <CoordField
        label="Y"
        value={box.y}
        min={minY}
        max={maxY}
        onCommit={(y) => {
          const x = spot.current.x;
          spot.current = { x, y };
          onChange(x, y);
        }}
      />
    </Stack>
  );
}

function CoordField({ label, value, min, max, onCommit }: { label: string; value: number; min: number; max: number; onCommit: (n: number) => void }) {
  const shown = Math.round(value);
  const [text, setText] = useState(String(shown));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(shown));
  }, [shown]);
  const commit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setText(String(shown));
      return;
    }
    const next = Math.round(Math.min(max, Math.max(min, n)));
    setText(String(next));
    if (next !== shown) onCommit(next);
  };
  return (
    <TextField
      size="small"
      type="number"
      label={label}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        commit(text);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const n = Number(raw);
        // the stepper moves one pixel at a time; a typed number is applied on blur or Enter
        if (Number.isFinite(n) && Math.abs(Math.round(n) - shown) === 1) commit(raw);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      slotProps={{ htmlInput: { min, max, step: 1, 'aria-label': `${label} position in pixels` } }}
      sx={{ width: 108 }}
    />
  );
}

function ShapePicker({
  value,
  onChange,
  allowDefault = false,
}: {
  value: string;
  onChange: (shape: CamBubbleShape | null) => void;
  allowDefault?: boolean;
}) {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      onChange={(_, v: string | null) => {
        if (v === null) return;
        if (v === '') onChange(null);
        else if (isCamBubbleShape(v)) onChange(v);
      }}
      sx={{ flexWrap: 'wrap' }}
    >
      {allowDefault && <ToggleButton value="">Show default</ToggleButton>}
      {CAM_BUBBLE_SHAPES.map((s) => (
        <ToggleButton key={s.id} value={s.id} title={s.blurb}>
          {s.name}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
