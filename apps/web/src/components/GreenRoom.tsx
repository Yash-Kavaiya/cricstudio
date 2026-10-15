import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Card, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { DeviceChoice } from '../lib/studioClient';
import { prefs } from '../lib/storage';
import { VOICE_PRESETS, normalizeVoiceFx, presetFx, type VoiceFx } from '../audio/voiceFx';
import { VideoProcessor, needsProcessing, normalizeVideoFx, type VideoFx } from '../rtc/videoFx';
import { Icon } from './Icon';
import { MicMeter, VideoEffectsEditor } from './MediaSettings';
import { Logo } from './Logo';

/** Pre-join screen: name + camera/mic preview + device pick (also unlocks audio with a user gesture). */
export function GreenRoom({
  title,
  subtitle,
  defaultName,
  cta,
  onJoin,
  error,
}: {
  title: string;
  subtitle?: string;
  defaultName: string;
  cta: string;
  onJoin: (name: string, devices: DeviceChoice) => void;
  error?: string | null;
}) {
  const [name, setName] = useState(defaultName);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [choice, setChoice] = useState<DeviceChoice>({});
  const [vfx, setVfx] = useState<VideoFx>(() => normalizeVideoFx(prefs.get<Partial<VideoFx> | null>('videoFx', null)));
  const [voice, setVoice] = useState<VoiceFx>(() => normalizeVoiceFx(prefs.get<Partial<VoiceFx> | null>('voiceFx', null)));
  const [perm, setPerm] = useState<string | null>(null);
  const [live, setLive] = useState<MediaStream | null>(null);
  const [vStatus, setVStatus] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const proc = useRef<VideoProcessor | null>(null);
  const vfxRef = useRef(vfx);
  vfxRef.current = vfx;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        stream.current?.getTracks().forEach((t) => t.stop());
        const s = await navigator.mediaDevices.getUserMedia({
          video: choice.videoId ? { deviceId: { exact: choice.videoId } } : true,
          audio: choice.audioId ? { deviceId: { exact: choice.audioId } } : true,
        });
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        setLive(s);
        setPerm(null);
        setDevices(await navigator.mediaDevices.enumerateDevices());
      } catch (e) {
        setPerm((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [choice.audioId, choice.videoId]);

  // preview shows the camera effect exactly as the studio will send it
  const processing = needsProcessing(vfx);
  useEffect(() => {
    proc.current?.stop();
    proc.current = null;
    if (!live || !video.current) return;
    if (!processing || !live.getVideoTracks().length) {
      video.current.srcObject = live;
      setVStatus(null);
      return;
    }
    const p = new VideoProcessor(live, vfxRef.current);
    proc.current = p;
    setVStatus(p.status);
    p.onStatus = () => setVStatus(p.status);
    video.current.srcObject = new MediaStream([p.track]);
  }, [live, processing]);
  useEffect(() => proc.current?.setFx(vfx), [vfx]);

  useEffect(
    () => () => {
      proc.current?.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const join = () => {
    proc.current?.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    onJoin(name.trim() || defaultName, { ...choice, video: vfx, voice });
  };

  return (
    <Stack alignItems="center" justifyContent="center" sx={{ minHeight: '100%', p: 3, bgcolor: 'background.default' }}>
      <Card sx={{ p: { xs: 2, md: 4 }, width: '100%', maxWidth: 980 }}>
        <Logo />
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={4} sx={{ mt: 3 }}>
          <Box sx={{ flex: 1.3, alignSelf: 'flex-start', width: '100%', position: { md: 'sticky' }, top: 24, aspectRatio: '16/9', borderRadius: 2, overflow: 'hidden', bgcolor: '#202124' }}>
            <video ref={video} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
            {perm && (
              <Stack alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0, color: '#fff', p: 3, textAlign: 'center' }} spacing={1}>
                <Icon name="videocam_off" size={40} />
                <Typography variant="body2">Camera/mic blocked or unavailable. You can still join (audio-only or score-only).</Typography>
              </Stack>
            )}
          </Box>
          <Stack spacing={2} sx={{ flex: 1 }}>
            <Typography variant="h5">{title}</Typography>
            {subtitle && <Typography color="text.secondary">{subtitle}</Typography>}
            <TextField label="Your display name" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField select SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }} label="Camera" value={choice.videoId ?? ''} onChange={(e) => setChoice({ ...choice, videoId: e.target.value || undefined })}>
              <MenuItem value="">Default camera</MenuItem>
              {devices
                .filter((d) => d.kind === 'videoinput')
                .map((d) => (
                  <MenuItem key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Camera'}
                  </MenuItem>
                ))}
            </TextField>
            <TextField select SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }} label="Microphone" value={choice.audioId ?? ''} onChange={(e) => setChoice({ ...choice, audioId: e.target.value || undefined })}>
              <MenuItem value="">Default microphone</MenuItem>
              {devices
                .filter((d) => d.kind === 'audioinput')
                .map((d) => (
                  <MenuItem key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Microphone'}
                  </MenuItem>
                ))}
            </TextField>
            <MicMeter stream={live} />
            <TextField select size="small" label="Voice" value={voice.preset} onChange={(e) => setVoice({ ...presetFx(e.target.value, voice), monitor: false })} helperText="Fine-tune noise, echo, EQ and room later in ⚙ Settings">
              {voice.preset === 'custom' && <MenuItem value="custom">Custom</MenuItem>}
              {VOICE_PRESETS.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.label}
                </MenuItem>
              ))}
            </TextField>
            {error && <Alert severity="error">{error}</Alert>}
            <Button size="large" variant="contained" onClick={join} startIcon={<Icon name="login" />}>
              {cta}
            </Button>
            <Typography variant="subtitle2" sx={{ pt: 1 }}>
              Camera effects
            </Typography>
            <VideoEffectsEditor compact fx={vfx} onChange={setVfx} loading={vStatus === 'loading'} onAutoKey={() => proc.current?.sampleKeyColor() ?? null} />
          </Stack>
        </Stack>
      </Card>
    </Stack>
  );
}
