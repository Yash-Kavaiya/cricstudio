import { useState } from 'react';
import { Alert, Button, Chip, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import { api, type CloudSttProvider } from '../../lib/api';
import type { StudioClient } from '../../lib/studioClient';

export const KEY_INFO: Record<CloudSttProvider, { label: string; help: string; url: string }> = {
  gnani: { label: 'Gnani API key', help: 'app.gnani.ai → Voice → API keys', url: 'https://app.gnani.ai/voice/' },
  google: {
    label: 'Google Cloud API key',
    help: 'Cloud Console → Credentials (enable "Cloud Speech-to-Text API")',
    url: 'https://console.cloud.google.com/apis/library/speech.googleapis.com',
  },
  gemini: { label: 'Google AI Studio API key', help: 'aistudio.google.com → Get API key', url: 'https://aistudio.google.com/apikey' },
};

/**
 * Write-only API key input. One key per provider per studio, shared by captions (speech-to-text)
 * and the AI commentator. The key is verified, then stored encrypted on the server.
 */
export function ApiKeyField({ client, hostToken, provider }: { client: StudioClient; hostToken: string; provider: CloudSttProvider }) {
  const st = client.state!;
  const info = KEY_INFO[provider];
  const configured = st.stt.configured[provider];
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setBusy('save');
    setMsg(null);
    const r = await api.testStt(st.id, hostToken, provider, key).catch((e: Error) => ({ ok: false, error: e.message, ms: 0 }));
    if (r.ok) {
      try {
        await api.saveStt(st.id, hostToken, { keys: { [provider]: key } });
        setKey('');
        setMsg({ ok: true, text: `Key works (${r.ms} ms) — saved encrypted on the server.` });
      } catch (e) {
        setMsg({ ok: false, text: (e as Error).message });
      }
    } else setMsg({ ok: false, text: `Key check failed: ${r.error}` });
    setBusy(null);
  };

  const test = async () => {
    setBusy('test');
    const r = await api.testStt(st.id, hostToken, provider).catch((e: Error) => ({ ok: false, error: e.message, ms: 0 }));
    setMsg({ ok: r.ok, text: r.ok ? `Connected · ${r.ms} ms round trip` : `Failed: ${r.error}` });
    setBusy(null);
  };

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1}>
        <TextField
          fullWidth
          type="password"
          autoComplete="off"
          label={configured ? `${info.label} (saved — paste to replace)` : info.label}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <Button variant="contained" disabled={!key.trim() || !!busy} onClick={() => void save()} sx={{ flexShrink: 0 }}>
          {busy === 'save' ? <CircularProgress size={18} color="inherit" /> : 'Save'}
        </Button>
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center">
        {configured ? <Chip size="small" color="success" label="Key saved" sx={{ height: 20 }} /> : <Chip size="small" label="No key yet" sx={{ height: 20 }} />}
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {info.help} ·{' '}
          <a href={info.url} target="_blank" rel="noreferrer">
            open
          </a>
        </Typography>
        {configured && (
          <>
            <Button size="small" disabled={!!busy} onClick={() => void test()}>
              {busy === 'test' ? <CircularProgress size={16} /> : 'Test'}
            </Button>
            <Button size="small" color="error" disabled={!!busy} onClick={() => void api.saveStt(st.id, hostToken, { keys: { [provider]: null } })}>
              Remove
            </Button>
          </>
        )}
      </Stack>
      {msg && <Alert severity={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
    </Stack>
  );
}
