import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { PLATFORM_PRESETS, type DestinationPublic, type Platform } from '@cricstudio/shared';
import { api } from '../../lib/api';
import type { StudioClient } from '../../lib/studioClient';
import { Icon } from '../Icon';

export const PLATFORM_ICON: Record<Platform, string> = {
  youtube: 'smart_display',
  facebook: 'thumb_up',
  x: 'close',
  twitch: 'sports_esports',
  custom: 'settings_input_antenna',
};

export function PlatformAvatar({ p, size = 32 }: { p: Platform; size?: number }) {
  return (
    <Avatar sx={{ width: size, height: size, bgcolor: PLATFORM_PRESETS[p].color, color: '#fff' }}>
      {p === 'x' ? <b style={{ fontSize: size * 0.5 }}>𝕏</b> : <Icon name={PLATFORM_ICON[p]} size={size * 0.6} />}
    </Avatar>
  );
}

export function useDestinations(studioId: string, hostToken: string) {
  const [list, setList] = useState<DestinationPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(
    async () =>
      studioId &&
      api
        .destinations(studioId, hostToken)
        .then((d) => (setList(d), setError(null)))
        .catch((e) => setError(e.message)),
    [studioId, hostToken],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  return { list, error, reload };
}

export function DestinationsPanel({ client, hostToken, dests }: { client: StudioClient; hostToken: string; dests: ReturnType<typeof useDestinations> }) {
  const st = client.state!;
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>('youtube');
  const [url, setUrl] = useState(PLATFORM_PRESETS.youtube.url);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const live = st.live;

  const pick = (p: Platform) => {
    setPlatform(p);
    setUrl(PLATFORM_PRESETS[p].url);
  };

  const add = async () => {
    setErr(null);
    try {
      await api.addDestination(st.id, hostToken, { platform, url, key, name: name || undefined });
      setOpen(false);
      setKey('');
      setName('');
      await dests.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const statusOf = (id: string) => live.destinations.find((d) => d.id === id);

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        One encode, many platforms. Add each platform's RTMP ingest + stream key — keys are encrypted (AES-256-GCM) on the server and never shown again.
      </Typography>
      {dests.error && <Alert severity="error">{dests.error}</Alert>}
      {dests.list.map((d) => {
        const s = statusOf(d.id);
        return (
          <Stack key={d.id} direction="row" spacing={1.5} alignItems="center" sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
            <PlatformAvatar p={d.platform} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                {d.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap component="div">
                {d.url} · {d.keyMasked}
              </Typography>
              {s && live.state !== 'idle' && (
                <Chip
                  size="small"
                  sx={{ mt: 0.5 }}
                  color={s.state === 'live' ? 'success' : s.state === 'error' ? 'error' : s.state === 'retrying' ? 'warning' : 'default'}
                  label={s.state === 'error' || s.state === 'retrying' ? `${s.state === 'retrying' ? `Reconnecting (#${s.retries ?? 1})` : 'Error'}: ${s.error ?? ''}`.slice(0, 70) : s.state}
                />
              )}
            </Box>
            <Switch
              size="small"
              checked={d.enabled}
              disabled={live.state === 'live'}
              onChange={async (e) => {
                await api.updateDestination(st.id, hostToken, d.id, { enabled: e.target.checked });
                await dests.reload();
              }}
            />
            <IconButton
              size="small"
              disabled={live.state === 'live'}
              onClick={async () => {
                await api.deleteDestination(st.id, hostToken, d.id);
                await dests.reload();
              }}
            >
              <Icon name="delete" size={20} />
            </IconButton>
          </Stack>
        );
      })}
      <Button variant="outlined" startIcon={<Icon name="add_link" />} onClick={() => setOpen(true)}>
        Add destination
      </Button>
      {live.state !== 'idle' && (
        <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: 'action.hover' }}>
          <Typography variant="subtitle2">Encoder health</Typography>
          <Typography variant="body2" color="text.secondary">
            {live.mode === 'livekit' ? 'LiveKit egress' : 'FFmpeg multistream'} · {live.state}
            {live.fps ? ` · ${live.fps} fps` : ''}
            {live.bitrateKbps ? ` · ${Math.round(live.bitrateKbps)} kbps` : ''}
            {live.speed ? ` · ${live.speed}x` : ''}
          </Typography>
          {live.error && <Alert severity="error" sx={{ mt: 1 }}>{live.error}</Alert>}
          {client.streamLog.slice(-3).map((l, i) => (
            <Typography key={i} variant="caption" component="div" color="text.secondary" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {l}
            </Typography>
          ))}
        </Box>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add a destination</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <ToggleButtonGroup exclusive value={platform} onChange={(_, v) => v && pick(v)} sx={{ flexWrap: 'wrap', gap: 1, '& .MuiToggleButton-root': { border: '1px solid', borderColor: 'divider', borderRadius: '12px !important', px: 1.5 } }}>
              {(Object.keys(PLATFORM_PRESETS) as Platform[]).map((p) => (
                <ToggleButton key={p} value={p} sx={{ gap: 1 }}>
                  <PlatformAvatar p={p} size={24} />
                  {PLATFORM_PRESETS[p].label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Alert severity="info" icon={<Icon name="help" />}>
              {PLATFORM_PRESETS[platform].help}
            </Alert>
            <TextField label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} placeholder={PLATFORM_PRESETS[platform].label} />
            <TextField label="Server / ingest URL" value={url} onChange={(e) => setUrl(e.target.value)} />
            <TextField label="Stream key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
            {err && <Alert severity="error">{err}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={add} disabled={!url || (!key && platform !== 'custom')}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
