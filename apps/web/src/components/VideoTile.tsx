import { useEffect, useRef } from 'react';
import { Avatar, Box, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import type { Participant } from '@cricstudio/shared';
import { Icon } from './Icon';

export function VideoTile({
  p,
  stream,
  self,
  hostControls,
  onStage,
  onKick,
  onMute,
  onSpotlight,
  spotlit,
  connState,
}: {
  p: Participant;
  stream: MediaStream | null;
  self?: boolean;
  hostControls?: boolean;
  onStage?: (v: boolean) => void;
  onKick?: () => void;
  onMute?: () => void;
  onSpotlight?: () => void;
  spotlit?: boolean;
  connState?: RTCPeerConnectionState;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
      void ref.current.play().catch(() => undefined);
    }
  }, [stream]);
  const hasVideo = !!stream?.getVideoTracks().length && !p.camOff;
  return (
    <Box
      sx={{
        position: 'relative',
        width: 200,
        flex: '0 0 auto',
        aspectRatio: '16/9',
        borderRadius: 1.5,
        overflow: 'hidden',
        bgcolor: '#202124',
        outline: p.onStage ? '3px solid' : '1px solid',
        outlineColor: p.onStage ? 'primary.main' : 'divider',
        '&:hover .tile-actions': { opacity: 1 },
      }}
    >
      <video ref={ref} muted playsInline autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover', transform: self ? 'scaleX(-1)' : undefined, display: hasVideo ? 'block' : 'none' }} />
      {!hasVideo && (
        <Stack alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0 }}>
          <Avatar sx={{ bgcolor: 'primary.main', width: 48, height: 48 }}>{p.name.slice(0, 1).toUpperCase()}</Avatar>
        </Stack>
      )}
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ position: 'absolute', left: 6, bottom: 6, right: 6 }}>
        <Chip
          size="small"
          label={`${p.name}${self ? ' (you)' : ''}`}
          icon={p.muted ? <Icon name="mic_off" size={16} color="#f28b82" /> : <Icon name="mic" size={16} color="#fff" />}
          sx={{ bgcolor: 'rgba(0,0,0,.65)', color: '#fff', maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
        />
        {p.role === 'host' && <Chip size="small" label="Host" color="primary" sx={{ height: 20, fontSize: 11 }} />}
      </Stack>
      {connState && connState !== 'connected' && !self && (
        <Typography variant="caption" sx={{ position: 'absolute', top: 6, left: 8, color: '#fdd663' }}>
          {connState}…
        </Typography>
      )}
      {hostControls && (
        <Stack direction="row" className="tile-actions" sx={{ position: 'absolute', top: 4, right: 4, opacity: 0.0, transition: 'opacity .2s', bgcolor: 'rgba(0,0,0,.6)', borderRadius: 99 }}>
          <Tooltip title={p.onStage ? 'Remove from stage' : 'Add to stage'}>
            <IconButton size="small" sx={{ color: '#fff' }} onClick={() => onStage?.(!p.onStage)}>
              <Icon name={p.onStage ? 'remove_from_queue' : 'add_to_queue'} size={18} />
            </IconButton>
          </Tooltip>
          <Tooltip title={spotlit ? 'Remove spotlight' : 'Spotlight in panel'}>
            <IconButton size="small" sx={{ color: spotlit ? '#fdd663' : '#fff' }} onClick={onSpotlight}>
              <Icon name="star" size={18} fill={spotlit} />
            </IconButton>
          </Tooltip>
          {!self && (
            <>
              <Tooltip title="Ask to mute">
                <IconButton size="small" sx={{ color: '#fff' }} onClick={onMute}>
                  <Icon name="mic_off" size={18} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Remove from studio">
                <IconButton size="small" sx={{ color: '#f28b82' }} onClick={onKick}>
                  <Icon name="person_remove" size={18} />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Stack>
      )}
    </Box>
  );
}
