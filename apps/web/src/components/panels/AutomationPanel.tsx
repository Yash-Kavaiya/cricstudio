import { Box, Button, Chip, Divider, FormControlLabel, Stack, Switch, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import type { AutomationRules, CricketEvent } from '@cricstudio/shared';
import type { StudioClient } from '../../lib/studioClient';
import { Icon } from '../Icon';

const SIMS: { type: CricketEvent['type']; label: string; color?: 'primary' | 'error' | 'secondary' | 'warning' }[] = [
  { type: 'FOUR', label: 'Four', color: 'primary' },
  { type: 'SIX', label: 'Six', color: 'secondary' },
  { type: 'WICKET', label: 'Wicket', color: 'error' },
  { type: 'MILESTONE_BAT', label: '50 / 100' },
  { type: 'MILESTONE_BOWL', label: '5-for' },
  { type: 'PARTNERSHIP', label: 'Partnership' },
  { type: 'HATTRICK_WATCH', label: 'Hat-trick', color: 'warning' },
  { type: 'OVER_END', label: 'Over end' },
  { type: 'INNINGS_END', label: 'Innings end' },
  { type: 'MATCH_END', label: 'Match end' },
];

const RULES: { key: keyof AutomationRules; label: string; hint: string }[] = [
  { key: 'wicket', label: 'Wickets', hint: 'Wicket alert + stumps sound (→ batting card in Auto Live)' },
  { key: 'boundary', label: 'Boundaries', hint: 'FOUR / SIX celebration with crowd + horn' },
  { key: 'overEnd', label: 'End of over', hint: 'Over summary, Manhattan every 5 overs' },
  { key: 'milestones', label: 'Milestones', hint: '50s, 100s, 5-fors and partnerships' },
  { key: 'inningsBreak', label: 'Innings / result', hint: 'Innings and result alerts (Auto Live also switches to Break / Result)' },
];

const EV_ICON: Partial<Record<CricketEvent['type'], string>> = {
  FOUR: '4️⃣',
  SIX: '6️⃣',
  WICKET: '🔴',
  OVER_END: '⏱️',
  MILESTONE_BAT: '⭐',
  MILESTONE_BOWL: '🎯',
  PARTNERSHIP: '🤝',
  INNINGS_END: '☕',
  MATCH_END: '🏆',
  HATTRICK_WATCH: '🔥',
};

export function AutomationPanel({ client }: { client: StudioClient }) {
  const st = client.state!;
  const notable = client.events.filter((e) => e.type !== 'BALL').slice(0, 12);
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Director mode
        </Typography>
        <ToggleButtonGroup fullWidth exclusive size="small" value={st.automation} onChange={(_, v) => v && void client.patch({ automation: v })}>
          <ToggleButton value="auto">
            <Icon name="auto_awesome" size={18} style={{ marginRight: 6 }} />
            Auto
          </ToggleButton>
          <ToggleButton value="assist">
            <Icon name="assistant" size={18} style={{ marginRight: 6 }} />
            Assist
          </ToggleButton>
          <ToggleButton value="manual">
            <Icon name="pan_tool" size={18} style={{ marginRight: 6 }} />
            Manual
          </ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary">
          {st.automation === 'auto'
            ? 'Overlays and sound effects follow the live match automatically. Scenes only change when you cut — or when Auto Live is on.'
            : st.automation === 'assist'
              ? 'Automation suggests — you approve with one click.'
              : 'Nothing happens automatically.'}
        </Typography>
      </Box>

      <AnimatePresence>
        {client.suggestions.map((s) => (
          <motion.div key={s.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {s.reason}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button size="small" variant="contained" color="inherit" sx={{ color: 'primary.main' }} onClick={() => void client.acceptSuggestion(s)}>
                  Show it
                </Button>
                <Button size="small" color="inherit" onClick={() => client.dismissSuggestion(s.id)}>
                  Skip
                </Button>
              </Stack>
            </Box>
          </motion.div>
        ))}
      </AnimatePresence>

      <Box>
        <Typography variant="subtitle2">Rules</Typography>
        {RULES.map((r) => (
          <FormControlLabel
            key={r.key}
            sx={{ display: 'flex', alignItems: 'flex-start', mx: 0, mt: 0.5 }}
            control={<Switch size="small" checked={!!st.rules[r.key]} onChange={(e) => void client.patch({ rules: { ...st.rules, [r.key]: e.target.checked } })} />}
            label={
              <Box sx={{ ml: 1 }}>
                <Typography variant="body2">{r.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {r.hint}
                </Typography>
              </Box>
            }
          />
        ))}
      </Box>

      <Divider />
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Fire a moment
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={1}>
          {SIMS.map((s) => (
            <Chip key={s.type} label={s.label} color={s.color} variant={s.color ? 'filled' : 'outlined'} onClick={() => void client.simulate(s.type)} />
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Triggers the full overlay + sound + scene sequence on air (great for rehearsals or when the API lags).
        </Typography>
      </Box>

      <Divider />
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Live event feed
        </Typography>
        {notable.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Waiting for the next big moment…
          </Typography>
        )}
        {notable.map((e, i) => (
          <Stack key={`${e.ts}-${i}`} direction="row" spacing={1} sx={{ py: 0.6 }}>
            <span>{EV_ICON[e.type] ?? '•'}</span>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                {e.title}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap component="div">
                {e.subtitle}
              </Typography>
            </Box>
          </Stack>
        ))}
      </Box>
    </Stack>
  );
}
