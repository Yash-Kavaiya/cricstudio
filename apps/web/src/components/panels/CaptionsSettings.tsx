import { useState } from 'react';
import { Alert, Box, Button, ButtonBase, Chip, CircularProgress, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import { STT_LANGUAGES, type SttProvider } from '@cricstudio/shared';
import { speechSupported } from '../../captions/speech';
import { api, type CloudSttProvider } from '../../lib/api';
import type { StudioClient } from '../../lib/studioClient';
import { Icon } from '../Icon';

const ENGINES: { id: SttProvider; name: string; desc: string; icon: string; keyLabel?: string; keyHelp?: string; keyUrl?: string }[] = [
  { id: 'browser', name: 'Browser speech', desc: 'Free · Chrome/Edge built-in recognition. Always used as the fallback.', icon: 'language' },
  {
    id: 'gnani',
    name: 'Gnani Prisma',
    desc: 'Indian-language specialist · English + Hinglish, Hindi and 8 more. Boosted with player names.',
    icon: 'record_voice_over',
    keyLabel: 'Gnani API key',
    keyHelp: 'Create one at app.gnani.ai → Voice → API keys',
    keyUrl: 'https://app.gnani.ai/voice/',
  },
  {
    id: 'google',
    name: 'Google Cloud Speech-to-Text',
    desc: 'Enterprise speech recognition with cricket phrase hints. Needs an API key with Speech-to-Text enabled.',
    icon: 'cloud',
    keyLabel: 'Google Cloud API key',
    keyHelp: 'Cloud Console → APIs & Services → Credentials (enable "Cloud Speech-to-Text API")',
    keyUrl: 'https://console.cloud.google.com/apis/library/speech.googleapis.com',
  },
  {
    id: 'gemini',
    name: 'Google AI Studio (Gemini)',
    desc: 'Gemini audio model transcribes each phrase, understands cricket context and names.',
    icon: 'auto_awesome',
    keyLabel: 'Google AI Studio API key',
    keyHelp: 'aistudio.google.com → Get API key',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
];

const GNANI_LANGS = new Set(['en-IN', 'hi-IN', 'bn-IN', 'gu-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'pa-IN', 'ta-IN', 'te-IN']);

/** Live-caption engine picker: browser (free) or a cloud STT with a write-only API key. */
export function CaptionsSettings({ client, hostToken }: { client: StudioClient; hostToken: string }) {
  const st = client.state!;
  const stt = st.stt;
  const status = client.captionStatus;
  const [keys, setKeys] = useState<Record<CloudSttProvider, string>>({ gnani: '', google: '', gemini: '' });
  const [model, setModel] = useState(stt.geminiModel);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ p: CloudSttProvider; ok: boolean; text: string } | null>(null);

  const save = async (body: Parameters<typeof api.saveStt>[2]) => {
    try {
      await api.saveStt(st.id, hostToken, body);
    } catch (e) {
      setMsg({ p: (body.provider as CloudSttProvider) ?? 'gnani', ok: false, text: (e as Error).message });
    }
  };

  const saveKey = async (p: CloudSttProvider) => {
    setBusy(`save-${p}`);
    setMsg(null);
    const r = await api.testStt(st.id, hostToken, p, keys[p]).catch((e: Error) => ({ ok: false, error: e.message, ms: 0 }));
    if (r.ok) {
      await save({ keys: { [p]: keys[p] }, provider: p, ...(p === 'gemini' ? { geminiModel: model } : {}) });
      setKeys((k) => ({ ...k, [p]: '' }));
      setMsg({ p, ok: true, text: `Key works (${r.ms} ms) and is saved encrypted on the server.` });
    } else setMsg({ p, ok: false, text: `Key check failed: ${r.error}` });
    setBusy(null);
  };

  const testSaved = async (p: CloudSttProvider) => {
    setBusy(`test-${p}`);
    const r = await api.testStt(st.id, hostToken, p).catch((e: Error) => ({ ok: false, error: e.message, ms: 0 }));
    setMsg({ p, ok: r.ok, text: r.ok ? `Connected · ${r.ms} ms round trip` : `Failed: ${r.error}` });
    setBusy(null);
  };

  const engineLabel = ENGINES.find((e) => e.id === status.engine)?.name ?? 'Off';
  const canCaption = speechSupported() || Object.values(stt.configured).some(Boolean);

  return (
    <Stack spacing={1.5}>
      <FormControlLabel
        control={<Switch checked={st.brand.captions} disabled={!canCaption} onChange={(e) => void client.patch({ brand: { ...st.brand, captions: e.target.checked } })} />}
        label="Live captions (speech-to-text, burned into the stream)"
      />
      {st.brand.captions && (
        <Alert
          severity={status.fallback ? 'warning' : status.error && status.engine === 'browser' ? 'info' : 'success'}
          icon={<Icon name={status.fallback ? 'sync_problem' : 'closed_caption'} />}
          sx={{ py: 0.25 }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {status.fallback ? `Cloud engine failing — using browser speech for a minute` : `Captions by ${engineLabel}`}
          </Typography>
          {status.error && <Typography variant="caption" component="div">{status.error}</Typography>}
          {status.lastText && !status.fallback && (
            <Typography variant="caption" color="text.secondary" component="div" noWrap>
              “{status.lastText}”
            </Typography>
          )}
        </Alert>
      )}

      <TextField select label="Spoken language" value={stt.language} onChange={(e) => void save({ language: e.target.value })}>
        {STT_LANGUAGES.map((l) => (
          <MenuItem key={l.code} value={l.code}>
            {l.label} · {l.code}
          </MenuItem>
        ))}
      </TextField>
      {stt.provider === 'gnani' && !GNANI_LANGS.has(stt.language) && (
        <Alert severity="warning">Gnani supports Indian languages only — pick an “-IN” language or another engine.</Alert>
      )}

      <Typography variant="subtitle2">Speech-to-text engine</Typography>
      {ENGINES.map((e) => {
        const on = stt.provider === e.id;
        const cloud = e.id !== 'browser' ? (e.id as CloudSttProvider) : null;
        const configured = cloud ? stt.configured[cloud] : true;
        return (
          <Box key={e.id} sx={{ border: 2, borderColor: on ? 'primary.main' : 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
            <ButtonBase
              onClick={() => void save({ provider: e.id })}
              sx={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', gap: 1.25, p: 1.25, bgcolor: on ? 'action.selected' : 'transparent' }}
            >
              <Icon name={e.icon} color={on ? '#1a73e8' : undefined} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {e.name}
                  </Typography>
                  {cloud && configured && <Chip size="small" color="success" label="Key saved" sx={{ height: 20 }} />}
                  {cloud && !configured && <Chip size="small" label="Needs key" sx={{ height: 20 }} />}
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {e.desc}
                </Typography>
              </Box>
              {on && <Icon name="radio_button_checked" color="#1a73e8" fill />}
            </ButtonBase>
            {cloud && on && (
              <Stack spacing={1} sx={{ p: 1.25, pt: 0.5 }}>
                {cloud === 'gemini' && (
                  <TextField
                    label="Gemini model"
                    value={model}
                    onChange={(ev) => setModel(ev.target.value)}
                    onBlur={() => model !== stt.geminiModel && void save({ geminiModel: model })}
                    helperText="Any audio-capable Gemini model id, e.g. gemini-2.5-flash"
                  />
                )}
                <Stack direction="row" spacing={1}>
                  <TextField
                    fullWidth
                    type="password"
                    autoComplete="off"
                    label={configured ? `${e.keyLabel} (saved — paste to replace)` : e.keyLabel}
                    value={keys[cloud]}
                    onChange={(ev) => setKeys((k) => ({ ...k, [cloud]: ev.target.value }))}
                  />
                  <Button variant="contained" disabled={!keys[cloud].trim() || !!busy} onClick={() => void saveKey(cloud)} sx={{ flexShrink: 0 }}>
                    {busy === `save-${cloud}` ? <CircularProgress size={18} color="inherit" /> : 'Save'}
                  </Button>
                </Stack>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                    {e.keyHelp} ·{' '}
                    <a href={e.keyUrl} target="_blank" rel="noreferrer">
                      open
                    </a>
                  </Typography>
                  {configured && (
                    <>
                      <Button size="small" disabled={!!busy} onClick={() => void testSaved(cloud)}>
                        {busy === `test-${cloud}` ? <CircularProgress size={16} /> : 'Test'}
                      </Button>
                      <Button size="small" color="error" disabled={!!busy} onClick={() => void save({ keys: { [cloud]: null } })}>
                        Remove
                      </Button>
                    </>
                  )}
                </Stack>
                {msg?.p === cloud && <Alert severity={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
              </Stack>
            )}
          </Box>
        );
      })}
      <Typography variant="caption" color="text.secondary">
        Keys are encrypted on the server and never sent back to any browser. If the chosen engine fails, CricStudio tries your other saved engines, then falls back to free
        browser speech — captions never stop.
      </Typography>
    </Stack>
  );
}
