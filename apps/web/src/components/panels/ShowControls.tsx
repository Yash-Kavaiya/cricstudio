import { useEffect, useState } from 'react';
import { Box, Button, ButtonGroup, Chip, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import { countdownTarget } from '@cricstudio/shared';
import type { StudioClient } from '../../lib/studioClient';
import { Icon } from '../Icon';

const PRESETS: { title: string; text: string }[] = [
  { title: 'Rain delay', text: "Rain has stopped play. The covers are on and we'll be back as soon as the umpires restart. Stay with us!" },
  { title: 'Bad light', text: 'Play is held up for bad light. We will be right back when the umpires resume.' },
  { title: 'Drinks break', text: 'Drinks on the field. Back with the action in a couple of minutes.' },
  { title: 'Strategic timeout', text: 'Strategic timeout. The captains are talking tactics — back after this.' },
  { title: 'Technical issue', text: "We're fixing a small technical issue. Thanks for your patience — don't go anywhere!" },
];

function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Starting Soon countdown + typed Announcement (rain delay, bad light ...) for the host. */
export function ShowControls({ client }: { client: StudioClient }) {
  const st = client.state!;
  const m = client.match;
  const [mins, setMins] = useState('');
  const [title, setTitle] = useState(st.announcement?.title ?? '');
  const [msg, setMsg] = useState(st.announcement?.text ?? '');
  const [speak, setSpeak] = useState(true);
  const [, tick] = useState(0);
  const cd = countdownTarget(st, m);
  useEffect(() => {
    if (!cd) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [!!cd]);
  const left = cd ? cd.at - Date.now() : 0;
  const matchStart = m?.state === 'pre' && m.startDate ? Date.parse(m.startDate) : NaN;
  const onMsg = st.scene === 'message';

  const startCountdown = (minutes: number) => {
    void client.patch({ countdownTo: Date.now() + minutes * 60_000 });
    if (st.scene !== 'startingSoon') void client.setScene('startingSoon');
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Starting Soon countdown
          </Typography>
          {cd && left > 0 && <Chip size="small" color="primary" icon={<Icon name="timer" size={16} />} label={`${clock(left)}${cd.matchStart ? ' · match start' : ''}`} />}
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <ButtonGroup size="small">
            {[2, 5, 10, 15].map((n) => (
              <Button key={n} onClick={() => startCountdown(n)}>
                {n}m
              </Button>
            ))}
          </ButtonGroup>
          <TextField
            size="small"
            placeholder="min"
            value={mins}
            onChange={(e) => setMins(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
            onKeyDown={(e) => e.key === 'Enter' && Number(mins) > 0 && startCountdown(Number(mins))}
            sx={{ width: 70 }}
          />
          <Button size="small" disabled={!(Number(mins) > 0)} onClick={() => startCountdown(Number(mins))}>
            Set
          </Button>
          <Button size="small" color="inherit" disabled={!st.countdownTo} onClick={() => void client.patch({ countdownTo: null })}>
            Off
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
          {Number.isFinite(matchStart)
            ? `With the timer off, Starting Soon counts down to the scheduled first ball (${new Date(matchStart).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}).`
            : 'Pick an upcoming match and Starting Soon counts down to its first ball automatically.'}
        </Typography>
      </Box>

      <Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Announcement
          </Typography>
          {onMsg && <Chip size="small" color="error" label="ON AIR" />}
        </Stack>
        <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mb: 1 }}>
          {PRESETS.map((p) => (
            <Chip
              key={p.title}
              size="small"
              variant={title === p.title ? 'filled' : 'outlined'}
              label={p.title}
              onClick={() => {
                setTitle(p.title);
                setMsg(p.text);
              }}
            />
          ))}
        </Stack>
        <Stack spacing={1}>
          <TextField size="small" label="Headline" placeholder="Rain delay" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 60))} />
          <TextField size="small" label="Message" placeholder="Type what viewers should know…" multiline minRows={2} value={msg} onChange={(e) => setMsg(e.target.value.slice(0, 400))} />
          <FormControlLabel
            control={<Switch size="small" checked={speak} onChange={(e) => setSpeak(e.target.checked)} />}
            label={<Typography variant="body2">Read it out with the commentary voice</Typography>}
          />
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              startIcon={<Icon name="campaign" />}
              disabled={!title.trim() && !msg.trim()}
              onClick={() => void client.announce({ title, text: msg, speak })}
            >
              {onMsg ? 'Update on air' : 'Show on air'}
            </Button>
            {onMsg && (
              <Button onClick={() => void client.setScene(m?.state === 'in' ? 'scoreHero' : 'startingSoon')}>
                Back to {m?.state === 'in' ? 'score' : 'Starting Soon'}
              </Button>
            )}
          </Stack>
        </Stack>
      </Box>
    </Stack>
  );
}
