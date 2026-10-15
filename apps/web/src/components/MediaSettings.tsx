import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Slider,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import type { StudioClient } from '../lib/studioClient';
import { VOICE_PRESETS, presetFx, voiceIsolationSupported, type CharacterId, type RoomId, type VoiceFx } from '../audio/voiceFx';
import { DEFAULT_VIDEO_FX, KEY_COLORS, VIDEO_MODES, type VideoFx } from '../rtc/videoFx';
import { VIRTUAL_BGS, backgroundThumb, setCustomBackground } from '../rtc/virtualBackgrounds';
import { Icon } from './Icon';

/* ---------------- small building blocks ---------------- */

/** Live level bar from a mic stream or an existing analyser (post-processing). */
export function MicMeter({ stream, analyser }: { stream?: MediaStream | null; analyser?: AnalyserNode | null }) {
  const bar = useRef<HTMLDivElement>(null);
  const peak = useRef<HTMLDivElement>(null);
  const track = stream?.getAudioTracks()[0];
  useEffect(() => {
    let an = analyser ?? null;
    let ctx: AudioContext | null = null;
    if (!an && track) {
      ctx = new AudioContext();
      an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(new MediaStream([track])).connect(an);
      void ctx.resume();
    }
    if (!an) return;
    const node = an;
    const buf = new Float32Array(node.fftSize);
    let raf = 0;
    let hold = 0;
    const loop = () => {
      node.getFloatTimeDomainData(buf);
      let sum = 0;
      let pk = 0;
      for (const x of buf) {
        sum += x * x;
        pk = Math.max(pk, Math.abs(x));
      }
      const pct = (v: number) => Math.max(0, Math.min(100, ((20 * Math.log10(v + 1e-6) + 60) / 60) * 100));
      hold = Math.max(pct(pk), hold - 0.8);
      if (bar.current) bar.current.style.width = `${pct(Math.sqrt(sum / buf.length))}%`;
      if (peak.current) {
        peak.current.style.left = `calc(${hold}% - 2px)`;
        peak.current.style.background = hold > 97 ? '#ea4335' : '#fff';
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      void ctx?.close();
    };
  }, [track, analyser]);
  return (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <Icon name="graphic_eq" color="var(--mui-palette-text-secondary)" />
      <Box sx={{ position: 'relative', flex: 1, height: 10, borderRadius: 5, bgcolor: 'action.hover', overflow: 'hidden' }}>
        <Box ref={bar} sx={{ height: '100%', width: 0, borderRadius: 5, background: 'linear-gradient(90deg,#34a853 0%,#34a853 65%,#fbbc04 82%,#ea4335 100%)' }} />
        <Box ref={peak} sx={{ position: 'absolute', top: 0, bottom: 0, width: 3, left: 0 }} />
      </Box>
    </Stack>
  );
}

function Section({ title, icon, children, action }: { title: string; icon: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Icon name={icon} size={20} color="var(--mui-palette-primary-main)" />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {title}
        </Typography>
        {action}
      </Stack>
      <Stack spacing={1.5}>{children}</Stack>
    </Box>
  );
}

function Knob({ label, value, min, max, step, format, onChange, disabled, hint }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void; disabled?: boolean; hint?: string }) {
  return (
    <Box sx={{ opacity: disabled ? 0.5 : 1 }}>
      <Stack direction="row" justifyContent="space-between">
        <Tooltip title={hint ?? ''} placement="top-start">
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
        </Tooltip>
        <Typography variant="body2" fontWeight={600}>
          {format(value)}
        </Typography>
      </Stack>
      <Slider size="small" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(_, v) => onChange(v as number)} />
    </Box>
  );
}

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <FormControlLabel
      sx={{ alignItems: 'flex-start', ml: 0, gap: 1 }}
      control={<Switch size="small" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />}
      label={
        <Box>
          <Typography variant="body2">{label}</Typography>
          {hint && (
            <Typography variant="caption" color="text.secondary">
              {hint}
            </Typography>
          )}
        </Box>
      }
    />
  );
}

const dB = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

function DevicePicker({ kind, label, value, devices, onChange }: { kind: MediaDeviceKind; label: string; value: string; devices: MediaDeviceInfo[]; onChange: (id: string) => void }) {
  const list = devices.filter((d) => d.kind === kind && d.deviceId);
  return (
    <TextField select fullWidth size="small" label={label} value={list.some((d) => d.deviceId === value) ? value : ''} onChange={(e) => onChange(e.target.value)} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}>
      {!list.length && <MenuItem value="">No {label.toLowerCase()} found</MenuItem>}
      {list.map((d, i) => (
        <MenuItem key={d.deviceId} value={d.deviceId}>
          {d.label || `${label} ${i + 1}`}
        </MenuItem>
      ))}
    </TextField>
  );
}

export function Preview({ stream, mirror = true }: { stream: MediaStream | null; mirror?: boolean }) {
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (v.current && v.current.srcObject !== stream) v.current.srcObject = stream;
  }, [stream]);
  const hasVideo = !!stream?.getVideoTracks().length;
  return (
    <Box sx={{ position: 'relative', aspectRatio: '16/9', borderRadius: 1.5, overflow: 'hidden', bgcolor: '#202124' }}>
      <video ref={v} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: mirror ? 'scaleX(-1)' : undefined }} />
      {!hasVideo && (
        <Stack alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0, color: '#fff' }}>
          <Icon name="videocam_off" size={36} />
        </Stack>
      )}
    </Box>
  );
}

/* ---------------- video effects ---------------- */

/** Off / blur / virtual background / green screen, with backgrounds, keyer and colour controls. */
export function VideoEffectsEditor({ fx, onChange, loading, onAutoKey, compact }: { fx: VideoFx; onChange: (fx: VideoFx) => void; loading?: boolean; onAutoKey?: () => string | null; compact?: boolean }) {
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const showBgs = fx.mode === 'image' || fx.mode === 'chroma';
  useEffect(() => {
    if (!showBgs) return;
    // paint thumbnails after the dialog opens (each background is drawn once, then cached)
    const id = window.setTimeout(() => setThumbs(Object.fromEntries([...VIRTUAL_BGS.map((b) => b.id), 'custom'].map((b) => [b, backgroundThumb(b)]))), 30);
    return () => window.clearTimeout(id);
  }, [showBgs]);
  const set = (p: Partial<VideoFx>) => onChange({ ...fx, ...p });
  const setKey = (p: Partial<VideoFx['chroma']>) => onChange({ ...fx, chroma: { ...fx.chroma, ...p } });
  const upload = async (f: File) => {
    await setCustomBackground(f);
    setThumbs((t) => ({ ...t, custom: backgroundThumb('custom') }));
    set({ bg: 'custom' });
  };

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
        {VIDEO_MODES.map((m) => {
          const on = m.id === fx.mode;
          return (
            <ButtonBase
              key={m.id}
              aria-pressed={on}
              onClick={() => set({ mode: m.id })}
              sx={{ flexDirection: 'column', gap: 0.5, py: 1.25, borderRadius: 1.5, border: 2, borderColor: on ? 'primary.main' : 'divider', bgcolor: on ? 'action.selected' : 'transparent', color: on ? 'primary.main' : 'text.primary' }}
            >
              {on && loading && m.id !== 'none' ? <CircularProgress size={22} /> : <Icon name={m.icon} size={24} />}
              <Typography variant="caption" fontWeight={600}>
                {m.label}
              </Typography>
            </ButtonBase>
          );
        })}
      </Box>

      {fx.mode === 'blur' && <Knob label="Blur strength" value={fx.blur} min={4} max={30} step={1} format={(v) => `${v}px`} onChange={(blur) => set({ blur })} />}

      {showBgs && (
        <Box>
          <Typography variant="caption" color="text.secondary">
            {fx.mode === 'chroma' ? 'Replace the green/blue screen with' : 'Virtual background (AI cut-out, no green screen needed)'}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))', gap: 1, mt: 0.75 }}>
            {VIRTUAL_BGS.map((b) => (
              <BgTile key={b.id} label={b.label} src={thumbs[b.id]} on={fx.bg === b.id} onClick={() => set({ bg: b.id })} />
            ))}
            <BgTile label={thumbs.custom ? 'Your image' : 'Upload image'} src={thumbs.custom} on={fx.bg === 'custom'} icon="add_photo_alternate" onClick={() => (thumbs.custom && fx.bg !== 'custom' ? set({ bg: 'custom' }) : fileRef.current?.click())} />
          </Box>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          {thumbs.custom && (
            <Button size="small" startIcon={<Icon name="upload" />} onClick={() => fileRef.current?.click()} sx={{ mt: 0.5 }}>
              Replace your image
            </Button>
          )}
        </Box>
      )}

      {fx.mode === 'chroma' && (
        <Section title="Chroma key" icon="colorize">
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            {KEY_COLORS.map((k) => (
              <Chip key={k.color} label={k.label} onClick={() => setKey({ color: k.color })} variant={fx.chroma.color === k.color ? 'filled' : 'outlined'} avatar={<Box sx={{ bgcolor: k.color, borderRadius: '50%' }} />} />
            ))}
            <Tooltip title="Pick any key colour">
              <Box component="input" type="color" value={fx.chroma.color} onChange={(e) => setKey({ color: (e.target as HTMLInputElement).value })} sx={{ width: 40, height: 32, border: 0, p: 0, bgcolor: 'transparent', cursor: 'pointer' }} />
            </Tooltip>
            {onAutoKey && (
              <Button size="small" variant="outlined" startIcon={<Icon name="auto_fix_high" />} onClick={() => {
                const c = onAutoKey();
                if (c) setKey({ color: c });
              }}>
                Auto-detect
              </Button>
            )}
          </Stack>
          {!compact && (
            <>
              <Knob label="Similarity" hint="How much of the screen colour is removed. Raise until the screen disappears." value={fx.chroma.similarity} min={0.01} max={0.4} step={0.005} format={pct} onChange={(similarity) => setKey({ similarity })} />
              <Knob label="Edge smoothness" hint="Softens the cut-out edge (hair, shoulders)." value={fx.chroma.smoothness} min={0.01} max={0.3} step={0.005} format={pct} onChange={(smoothness) => setKey({ smoothness })} />
              <Knob label="Spill suppression" hint="Removes green/blue tint reflected onto you." value={fx.chroma.spill} min={0.01} max={0.5} step={0.005} format={pct} onChange={(spill) => setKey({ spill })} />
              <Typography variant="caption" color="text.secondary">
                Tip: light the screen evenly, keep 1–2 m between you and it, and avoid clothes in the key colour.
              </Typography>
            </>
          )}
        </Section>
      )}

      {!compact && (
        <Section
          title="Colour & light"
          icon="tune"
          action={
            <Button size="small" onClick={() => set({ brightness: 1, contrast: 1, saturation: 1 })}>
              Reset
            </Button>
          }
        >
          <Knob label="Brightness" value={fx.brightness} min={0.6} max={1.6} step={0.01} format={pct} onChange={(brightness) => set({ brightness })} />
          <Knob label="Contrast" value={fx.contrast} min={0.6} max={1.6} step={0.01} format={pct} onChange={(contrast) => set({ contrast })} />
          <Knob label="Saturation" value={fx.saturation} min={0} max={2} step={0.01} format={pct} onChange={(saturation) => set({ saturation })} />
        </Section>
      )}
    </Stack>
  );
}

function BgTile({ label, src, on, icon, onClick }: { label: string; src?: string | null; on: boolean; icon?: string; onClick: () => void }) {
  return (
    <ButtonBase onClick={onClick} aria-pressed={on} sx={{ flexDirection: 'column', borderRadius: 2, overflow: 'hidden', border: 2, borderColor: on ? 'primary.main' : 'transparent', bgcolor: 'action.hover' }}>
      <Box sx={{ width: '100%', aspectRatio: '16/9', backgroundImage: src ? `url(${src})` : undefined, backgroundSize: 'cover', display: 'grid', placeItems: 'center' }}>{!src && <Icon name={icon ?? 'image'} />}</Box>
      <Typography variant="caption" sx={{ py: 0.5, px: 0.5, fontWeight: on ? 700 : 500 }} noWrap>
        {label}
      </Typography>
    </ButtonBase>
  );
}

/* ---------------- voice ---------------- */

export function VoicePresetPicker({ value, onPick, dense }: { value: string; onPick: (id: string) => void; dense?: boolean }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: dense ? '1fr 1fr' : 'repeat(auto-fill, minmax(180px, 1fr))', gap: 1 }}>
      {VOICE_PRESETS.map((p) => {
        const on = p.id === value;
        return (
          <ButtonBase
            key={p.id}
            aria-pressed={on}
            onClick={() => onPick(p.id)}
            sx={{ justifyContent: 'flex-start', textAlign: 'left', gap: 1.25, p: 1.25, borderRadius: 1.5, border: 2, borderColor: on ? 'primary.main' : 'divider', bgcolor: on ? 'action.selected' : 'transparent' }}
          >
            <Icon name={p.icon} color={on ? 'var(--mui-palette-primary-main)' : undefined} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600} noWrap>
                {p.label}
              </Typography>
              {!dense && (
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {p.hint}
                </Typography>
              )}
            </Box>
          </ButtonBase>
        );
      })}
    </Box>
  );
}

function VoiceEditor({ fx, onChange }: { fx: VoiceFx; onChange: (fx: VoiceFx) => void }) {
  const set = (p: Partial<VoiceFx>) => onChange({ ...fx, ...p, preset: 'custom' });
  const isolation = voiceIsolationSupported();
  return (
    <Stack spacing={2}>
      <Section title="Clean-up" icon="cleaning_services">
        <Toggle label="AI noise suppression" hint="Removes fans, keyboard, crowd hiss and traffic (browser AI)." checked={fx.noiseSuppression} onChange={(noiseSuppression) => set({ noiseSuppression })} />
        <Toggle label="Echo cancellation" hint="Stops guests hearing themselves from your speakers. Keep on unless you wear headphones." checked={fx.echoCancellation} onChange={(echoCancellation) => set({ echoCancellation })} />
        <Toggle label="Auto gain" hint="Browser levels your volume. Off is better with the compressor below." checked={fx.autoGainControl} onChange={(autoGainControl) => set({ autoGainControl })} />
        <Toggle label="Voice isolation" hint={isolation ? 'Keeps only your voice — great at noisy grounds.' : 'Not supported in this browser.'} checked={fx.voiceIsolation && isolation} disabled={!isolation} onChange={(voiceIsolation) => set({ voiceIsolation })} />
        <Knob label="Low-cut (rumble filter)" hint="Removes wind, handling and AC rumble below this frequency." value={fx.highpass} min={0} max={300} step={5} format={(v) => (v ? `${v} Hz` : 'Off')} onChange={(highpass) => set({ highpass })} />
        <Toggle label="Noise gate" hint="Silences the mic between sentences." checked={fx.gate} onChange={(gate) => set({ gate })} />
        <Knob label="Gate threshold" disabled={!fx.gate} hint="Raise if background noise still leaks through; lower if words get cut." value={fx.gateThreshold} min={-80} max={-20} step={1} format={(v) => `${v} dB`} onChange={(gateThreshold) => set({ gateThreshold })} />
      </Section>
      <Section title="Tone (EQ)" icon="equalizer">
        <Knob label="Bass · 120 Hz" value={fx.eqLow} min={-12} max={12} step={0.5} format={dB} onChange={(eqLow) => set({ eqLow })} />
        <Knob label="Mud · 350 Hz" hint="Cut to remove boxy, muffled room sound." value={fx.eqMud} min={-12} max={12} step={0.5} format={dB} onChange={(eqMud) => set({ eqMud })} />
        <Knob label="Presence · 3.2 kHz" hint="Boost for clarity over music and crowd." value={fx.eqPresence} min={-12} max={12} step={0.5} format={dB} onChange={(eqPresence) => set({ eqPresence })} />
        <Knob label="Air · 10 kHz" value={fx.eqAir} min={-12} max={12} step={0.5} format={dB} onChange={(eqAir) => set({ eqAir })} />
      </Section>
      <Section title="Dynamics" icon="compress">
        <Knob label="Compressor" hint="Evens out loud appeals and quiet analysis." value={fx.compress} min={0} max={1} step={0.01} format={pct} onChange={(compress) => set({ compress })} />
        <Knob label="De-esser" hint="Tames sharp 's' and 'sh' sounds." value={fx.deEss} min={0} max={1} step={0.01} format={pct} onChange={(deEss) => set({ deEss })} />
        <Knob label="Output gain" value={fx.gain} min={-12} max={12} step={0.5} format={dB} onChange={(gain) => set({ gain })} />
        <Typography variant="caption" color="text.secondary">
          A brick-wall limiter at −1.5 dB always protects the stream from clipping.
        </Typography>
      </Section>
      <Section title="Character & room" icon="spatial_audio">
        <Stack direction="row" spacing={1.5}>
          <TextField select size="small" fullWidth label="Character" value={fx.character} onChange={(e) => set({ character: e.target.value as CharacterId })}>
            <MenuItem value="clean">Clean</MenuItem>
            <MenuItem value="warm">Warm (tape saturation)</MenuItem>
            <MenuItem value="radio">Radio commentary</MenuItem>
          </TextField>
          <TextField select size="small" fullWidth label="Room" value={fx.room} onChange={(e) => set({ room: e.target.value as RoomId, roomMix: fx.roomMix || 0.2 })}>
            <MenuItem value="none">Dry (no room)</MenuItem>
            <MenuItem value="box">Commentary box</MenuItem>
            <MenuItem value="studio">TV studio</MenuItem>
            <MenuItem value="stadium">Stadium PA</MenuItem>
          </TextField>
        </Stack>
        <Knob label="Room amount" disabled={fx.room === 'none'} value={fx.roomMix} min={0} max={0.8} step={0.01} format={pct} onChange={(roomMix) => set({ roomMix })} />
      </Section>
    </Stack>
  );
}

/* ---------------- dialog ---------------- */

/** Studio "Settings" dialog: Audio (mic + voice chain) and Video (camera + effects). */
export function MediaSettingsDialog({ client, open, onClose }: { client: StudioClient; open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'audio' | 'video'>('audio');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const load = () => void navigator.mediaDevices.enumerateDevices().then(setDevices);
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => navigator.mediaDevices.removeEventListener('devicechange', load);
  }, [open]);

  const curA = client.devices.audioId ?? '';
  const curV = client.devices.videoId ?? devices.find((d) => d.kind === 'videoinput')?.deviceId ?? '';
  const pick = async (d: { audioId?: string; videoId?: string }) => {
    setBusy(true);
    await client.openMedia(d);
    setBusy(false);
  };
  const voice = client.voiceFx;
  const presetLabel = useMemo(() => VOICE_PRESETS.find((p) => p.id === voice.preset)?.label ?? 'Custom', [voice.preset]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" PaperProps={{ sx: { height: 'min(92vh, 900px)' } }}>
      <DialogTitle sx={{ pb: 0 }}>Settings</DialogTitle>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="audio" label="Audio" icon={<Icon name="mic" />} iconPosition="start" sx={{ minHeight: 56 }} />
        <Tab value="video" label="Video" icon={<Icon name="videocam" />} iconPosition="start" sx={{ minHeight: 56 }} />
      </Tabs>
      <DialogContent>
        {tab === 'audio' ? (
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <DevicePicker kind="audioinput" label="Microphone" value={curA} devices={devices} onChange={(id) => void pick({ audioId: id })} />
            <Box>
              <Typography variant="caption" color="text.secondary">
                Output level (what viewers hear) — speak to test
              </Typography>
              <MicMeter analyser={client.voiceAnalyser} stream={client.voiceAnalyser ? null : client.localStream} />
              {client.isMicMuted() && (
                <Typography variant="caption" color="warning.main">
                  Your mic is muted.
                </Typography>
              )}
            </Box>
            <Toggle label="Hear yourself" hint="Monitor the processed voice — use headphones to avoid feedback." checked={voice.monitor} onChange={(monitor) => client.setVoiceFx({ ...voice, monitor })} />
            <Box>
              <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle2" sx={{ flex: 1 }}>
                  Voice preset · <Box component="span" sx={{ color: 'primary.main' }}>{voice.preset === 'custom' ? 'Custom' : presetLabel}</Box>
                </Typography>
              </Stack>
              <VoicePresetPicker value={voice.preset} onPick={(id) => client.setVoiceFx({ ...presetFx(id, voice), monitor: voice.monitor })} />
            </Box>
            <VoiceEditor fx={voice} onChange={(fx) => client.setVoiceFx(fx)} />
          </Stack>
        ) : (
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.1fr 1fr' }, gap: 2.5, alignItems: 'start' }}>
              <Stack spacing={2} sx={{ position: { md: 'sticky' }, top: 0 }}>
                <Preview stream={client.localStream} />
                <DevicePicker kind="videoinput" label="Camera" value={curV} devices={devices} onChange={(id) => void pick({ videoId: id })} />
                <Typography variant="caption" color="text.secondary">
                  Effects run on this device (GPU when available). Guests, the program and your live stream all see the result.
                </Typography>
                <Button size="small" onClick={() => client.setVideoFx(DEFAULT_VIDEO_FX)} startIcon={<Icon name="restart_alt" />} sx={{ alignSelf: 'flex-start' }}>
                  Reset video effects
                </Button>
              </Stack>
              <VideoEffectsEditor fx={client.videoFx} onChange={(fx) => client.setVideoFx(fx)} loading={client.videoStatus === 'loading'} onAutoKey={() => client.sampleKeyColor()} />
            </Box>
          </Stack>
        )}
        {busy && <CircularProgress size={20} sx={{ mt: 2 }} />}
        {client.mediaError && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {client.mediaError}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
