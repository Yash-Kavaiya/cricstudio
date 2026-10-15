import { useEffect, useState } from 'react';
import { Alert, AppBar, Box, Button, Chip, CircularProgress, Stack, Toolbar, Typography } from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import { ControlBar } from '../components/ControlBar';
import { GreenRoom } from '../components/GreenRoom';
import { Logo } from '../components/Logo';
import { ProgramCanvas } from '../components/ProgramCanvas';
import { VideoTile } from '../components/VideoTile';
import { ChatPanel } from '../components/panels/ChatPanel';
import { api } from '../lib/api';
import { prefs } from '../lib/storage';
import { StudioClient } from '../lib/studioClient';
import { useClient } from '../lib/useClient';

/** Guest entry: /join/<studioId>.<guestToken> */
export function Join() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const dot = token.indexOf('.');
  const studioId = dot > 0 ? token.slice(0, dot) : '';
  const guestToken = dot > 0 ? token.slice(dot + 1) : '';
  const [title, setTitle] = useState<string>('');
  const [client, setClient] = useState<StudioClient | null>(null);
  useEffect(() => {
    if (studioId) void api.studio(studioId).then((s) => setTitle(s.name)).catch(() => setTitle(''));
  }, [studioId]);
  useEffect(() => () => client?.dispose(), [client]);

  if (!studioId) return <Alert severity="error">Invalid invite link.</Alert>;
  if (!client)
    return (
      <GreenRoom
        title={title ? `Join "${title}"` : 'Join the studio'}
        subtitle="You're joining as an expert guest. The host will bring you on stage."
        defaultName={prefs.get('guestName', '')}
        cta="Join studio"
        onJoin={(name, devices) => {
          prefs.set('guestName', name);
          const c = new StudioClient({ studioId, token: guestToken, role: 'guest', name: name || 'Guest' });
          void c.audio.resume();
          void c.start(devices);
          setClient(c);
        }}
      />
    );
  return <GuestRoom client={client} onLeave={() => (client.dispose(), nav('/'))} />;
}

function GuestRoom({ client: c, onLeave }: { client: StudioClient; onLeave: () => void }) {
  const client = useClient(c)!;
  const st = client.state;
  if (client.error)
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }} spacing={2}>
        <Alert severity="error">{client.error}</Alert>
        <Button onClick={onLeave}>Close</Button>
      </Stack>
    );
  if (!st)
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }} spacing={2}>
        <CircularProgress />
        <Typography color="text.secondary">Joining…</Typography>
      </Stack>
    );
  const me = client.self;
  const people = st.participants.filter((p) => p.role !== 'program');
  const live = st.live.state === 'live';
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppBar position="static" sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 2 }}>
          <Logo compact />
          <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }} noWrap>
            {st.name}
          </Typography>
          {me?.onStage ? <Chip color="primary" label="You're on stage" /> : <Chip variant="outlined" label="Backstage" />}
          {live && <Chip color="error" label="LIVE" />}
        </Toolbar>
      </AppBar>
      <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 340px' }, gap: 2, p: 2 }}>
        <Stack spacing={2} sx={{ minWidth: 0, overflow: 'auto' }}>
          <Box sx={{ maxWidth: 'calc((100vh - 330px) * 16 / 9)', width: '100%', mx: 'auto' }}>
            <ProgramCanvas renderer={client.renderer} live={live && !!me?.onStage} />
          </Box>
          <Stack direction="row" spacing={1.5} sx={{ overflowX: 'auto', justifyContent: 'center' }}>
            {people.map((p) => (
              <VideoTile key={p.id} p={p} self={p.id === client.selfId} stream={p.id === client.selfId ? client.localStream : client.remote.get(p.id)?.cam ?? null} />
            ))}
          </Stack>
          <ControlBar client={client} onLeave={onLeave} />
        </Stack>
        <Box sx={{ p: 2, bgcolor: 'background.paper', borderRadius: 2, border: 1, borderColor: 'divider', minHeight: 0 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Backstage chat
          </Typography>
          <ChatPanel client={client} height="calc(100% - 30px)" />
        </Box>
      </Box>
    </Box>
  );
}
