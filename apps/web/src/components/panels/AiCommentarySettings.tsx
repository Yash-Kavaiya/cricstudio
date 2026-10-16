import { useState } from 'react';
import { Alert, Box, Button, CircularProgress, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { EDGE_LANG_VOICES, GNANI_VOICES, STT_LANGUAGES, VOICES, type AutopilotSettings } from '@cricstudio/shared';
import type { StudioClient } from '../../lib/studioClient';
import { Icon } from '../Icon';
import { ApiKeyField } from './ApiKeyField';

/** Where the AI commentator gets its words (templates / Gemini) and its voice (Edge / Gnani). */
export function AiCommentarySettings({ client, hostToken }: { client: StudioClient; hostToken: string }) {
  const st = client.state!;
  const ap = st.autopilot;
  const writer = ap.writer ?? 'templates';
  const engine = ap.voiceEngine ?? 'edge';
  const lang = ap.commentaryLanguage ?? 'en-IN';
  const status = st.aiStatus;
  const [model, setModel] = useState(st.stt.geminiModel);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<Awaited<ReturnType<StudioClient['testCommentary']>> | null>(null);
  const patch = (p: Partial<AutopilotSettings>) => void client.patch({ autopilot: { ...ap, ...p } });

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    const r = await client.testCommentary();
    setTest(r);
    setTesting(false);
    // preview locally only (not on air)
    if (r.audio) {
      const url = URL.createObjectURL(new Blob([r.audio], { type: 'audio/wav' }));
      const a = new Audio(url);
      a.onended = () => URL.revokeObjectURL(url);
      void a.play().catch(() => undefined);
    }
  };

  const fellBack = status && (status.writer === 'fallback' || status.voice === 'fallback');

  return (
    <Box sx={{ mt: 1.5, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Icon name="auto_awesome" color="#1a73e8" />
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            AI commentary engine
          </Typography>
        </Stack>

        {fellBack && (
          <Alert severity="warning" sx={{ py: 0 }}>
            Using the free fallback ({status!.writer === 'fallback' ? 'templates' : 'Gemini'} · {status!.voice === 'fallback' ? 'Edge voice' : 'Gnani'}).
            {status!.error && (
              <Typography variant="caption" component="div">
                {status!.error}
              </Typography>
            )}
          </Alert>
        )}

        <TextField select label="Commentary language" value={lang} onChange={(e) => patch({ commentaryLanguage: e.target.value })}>
          {STT_LANGUAGES.map((l) => (
            <MenuItem key={l.code} value={l.code}>
              {l.label}
            </MenuItem>
          ))}
        </TextField>
        {!lang.startsWith('en') && writer === 'templates' && (
          <Typography variant="caption" color="text.secondary">
            Template lines are translated automatically (free) and spoken in a native voice. Gemini writes them natively for a more natural feel.
          </Typography>
        )}
        {!lang.startsWith('en') && !EDGE_LANG_VOICES[lang] && engine !== 'gnani' && (
          <Typography variant="caption" color="warning.main">
            Edge has no voice for this language, so the commentary is spoken in Hindi. Choose the Gnani voice to hear it in this language.
          </Typography>
        )}

        <Box>
          <Typography variant="caption" color="text.secondary">
            Who writes the lines
          </Typography>
          <ToggleButtonGroup exclusive fullWidth size="small" value={writer} onChange={(_, v) => v && patch({ writer: v })}>
            <ToggleButton value="templates">Templates · free</ToggleButton>
            <ToggleButton value="gemini">Gemini AI</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        {writer === 'gemini' && (
          <Stack spacing={1}>
            <Typography variant="caption" color="text.secondary">
              Gemini reads the live scorecard and writes a fresh line for every boundary, wicket, milestone and quiet spell — in your language, without inventing numbers.
            </Typography>
            <TextField
              label="Gemini model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => model !== st.stt.geminiModel && void client.saveStt({ geminiModel: model })}
              helperText="Shared with Gemini captions, e.g. gemini-2.5-flash"
            />
            <ApiKeyField client={client} hostToken={hostToken} provider="gemini" />
          </Stack>
        )}

        <Box>
          <Typography variant="caption" color="text.secondary">
            Who speaks them
          </Typography>
          <ToggleButtonGroup exclusive fullWidth size="small" value={engine} onChange={(_, v) => v && patch({ voiceEngine: v })}>
            <ToggleButton value="edge">Edge voices · free</ToggleButton>
            <ToggleButton value="gnani">Gnani voice</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        {engine === 'gnani' && (
          <Stack spacing={1}>
            <TextField select label="Gnani voice (speaks all 10 Indian languages)" value={ap.gnaniVoice ?? 'Shubham'} onChange={(e) => patch({ gnaniVoice: e.target.value })}>
              {GNANI_VOICES.map((v) => (
                <MenuItem key={v.id} value={v.id}>
                  {v.label}
                </MenuItem>
              ))}
            </TextField>
            <ApiKeyField client={client} hostToken={hostToken} provider="gnani" />
          </Stack>
        )}
        <TextField
          select
          label={engine === 'gnani' ? 'Edge fallback voice (English)' : 'Edge voice (English)'}
          value={ap.voice}
          onChange={(e) => patch({ voice: e.target.value })}
        >
          {VOICES.map((v) => (
            <MenuItem key={v.id} value={v.id}>
              {v.label}
            </MenuItem>
          ))}
        </TextField>

        <Stack direction="row" spacing={1} alignItems="center">
          <Button variant="outlined" startIcon={testing ? <CircularProgress size={16} /> : <Icon name="play_circle" />} disabled={testing} onClick={() => void runTest()}>
            Test commentary
          </Button>
          <Typography variant="caption" color="text.secondary">
            Plays here only — not on air
          </Typography>
        </Stack>
        {test && (
          <Alert severity={test.writerError || test.voiceError || test.error ? 'warning' : 'success'}>
            <Typography variant="body2">“{test.text}”</Typography>
            <Typography variant="caption" component="div">
              {test.error
                ? test.error
                : [
                    writer === 'gemini' ? (test.ai ? 'Written by Gemini ✓' : `Gemini failed: ${test.writerError}`) : 'Template line',
                    engine === 'gnani' ? (test.voiceOk ? 'Gnani voice ✓' : `Gnani failed: ${test.voiceError}`) : 'Edge voice on air',
                  ].join(' · ')}
            </Typography>
          </Alert>
        )}
        <Typography variant="caption" color="text.secondary">
          If Gemini or Gnani fails, the commentator instantly falls back to templates and the free Edge voice — it never goes silent.
        </Typography>
      </Stack>
    </Box>
  );
}
