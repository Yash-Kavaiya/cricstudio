import { useEffect, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useParams, useSearchParams } from 'react-router-dom';
import { StudioClient } from '../lib/studioClient';
import { useClient } from '../lib/useClient';

/**
 * Clean 1920x1080 program output — the target for LiveKit Web Egress and OBS/vMix browser sources.
 * Joins as a receive-only participant and mixes all on-stage voices + music + sfx to the speakers.
 */
export function Program() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const [client, setClient] = useState<StudioClient | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  useClient(client);

  useEffect(() => {
    const producer = sp.get('producer') === '1';
    const c = new StudioClient({ studioId: id, token: sp.get('k') ?? '', role: 'program', name: producer ? 'Cloud producer' : 'Program', producer, apiBase: sp.get('api') ?? undefined });
    void c.start();
    setClient(c);
    // headless egress Chrome allows autoplay; regular browsers may need one click
    const t = setTimeout(() => setNeedsGesture(c.audio.ctx.state !== 'running'), 1500);
    document.body.style.background = '#000';
    return () => {
      clearTimeout(t);
      c.dispose();
    };
  }, [id, sp]);

  useEffect(() => {
    if (!client) return;
    const c = client.renderer.canvas;
    c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;background:#000';
    document.body.appendChild(c);
    return () => c.remove();
  }, [client]);

  if (client?.error)
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', color: '#fff' }}>
        <Typography>{client.error}</Typography>
      </Stack>
    );

  return needsGesture ? (
    <Box sx={{ position: 'fixed', right: 16, bottom: 16, zIndex: 10 }}>
      <Button
        variant="contained"
        onClick={() => {
          void client?.audio.resume();
          setNeedsGesture(false);
        }}
      >
        Enable program audio
      </Button>
    </Box>
  ) : null;
}
