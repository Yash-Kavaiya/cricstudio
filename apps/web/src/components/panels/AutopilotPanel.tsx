import { useState } from 'react';
import { Alert, Box, Button, Chip, Divider, FormControlLabel, Slider, Stack, Switch, TextField, Typography } from '@mui/material';
import type { AutopilotSettings } from '@cricstudio/shared';
import type { StudioClient } from '../../lib/studioClient';
import { Icon } from '../Icon';
import { AiCommentarySettings } from './AiCommentarySettings';

export function AutopilotPanel({ client, hostToken, onGoCloud, hasDestinations }: { client: StudioClient; hostToken: string; onGoCloud: () => void; hasDestinations: boolean }) {
  const st = client.state!;
  const ap = st.autopilot;
  const [say, setSay] = useState('');
  const patch = (p: Partial<AutopilotSettings>) => void client.patch({ autopilot: { ...ap, ...p } });
  const live = st.live.state !== 'idle';
  const cloudLive = live && st.live.broadcaster === 'cloud';

  return (
    <Stack spacing={2}>
      <Box sx={{ p: 2, borderRadius: 2, bgcolor: ap.enabled ? 'primary.main' : 'action.hover', color: ap.enabled ? 'primary.contrastText' : 'text.primary', transition: 'all .3s' }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Icon name="smart_toy" size={30} fill={ap.enabled} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Auto Live mode
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.85 }}>
              Runs the show without a host: rotating scenes, music, celebrations and an AI commentator.
            </Typography>
          </Box>
          <Switch checked={ap.enabled} onChange={(e) => patch({ enabled: e.target.checked })} color="default" />
        </Stack>
      </Box>

      <Box>
        <Typography variant="subtitle2">Scene duration · {ap.sceneSeconds}s</Typography>
        <Slider
          min={3}
          max={30}
          step={1}
          marks={[
            { value: 5, label: '5s' },
            { value: 10, label: '10s' },
            { value: 20, label: '20s' },
          ]}
          defaultValue={ap.sceneSeconds}
          onChangeCommitted={(_, v) => patch({ sceneSeconds: v as number })}
        />
        <Typography variant="caption" color="text.secondary">
          Each data scene stays on air this long, with a different transition every cut. Wickets, boundaries and milestones still interrupt instantly.
        </Typography>
      </Box>

      <Box>
        <Typography variant="subtitle2">Score focus · {Math.round((ap.scoreShare ?? 0.7) * 100)}% score / {100 - Math.round((ap.scoreShare ?? 0.7) * 100)}% other</Typography>
        <Slider
          size="small"
          min={0}
          max={100}
          step={5}
          marks={[
            { value: 50, label: '50%' },
            { value: 70, label: '70%' },
            { value: 90, label: '90%' },
          ]}
          defaultValue={Math.round((ap.scoreShare ?? 0.7) * 100)}
          onChangeCommitted={(_, v) => patch({ scoreShare: (v as number) / 100 })}
        />
        <Typography variant="caption" color="text.secondary">
          Share of cuts that go to Live Score, Ball by Ball, Batting Scorecard and Bowling Figures. The rest rotate through stats, insights, analysis and cameras.
        </Typography>
      </Box>

      <FormControlLabel
        control={<Switch checked={ap.includeCameras} onChange={(e) => patch({ includeCameras: e.target.checked })} />}
        label={
          <Box>
            <Typography variant="body2">Include host & guest camera scenes</Typography>
            <Typography variant="caption" color="text.secondary">
              Off = 100% scoreboard show (no host camera). On = cameras join the rotation when someone is on stage.
            </Typography>
          </Box>
        }
        sx={{ alignItems: 'flex-start', mx: 0 }}
      />
      <FormControlLabel
        control={<Switch checked={ap.autoMusic} onChange={(e) => patch({ autoMusic: e.target.checked })} />}
        label={
          <Box>
            <Typography variant="body2">Auto music bed</Typography>
            <Typography variant="caption" color="text.secondary">
              Rotates royalty-free tracks every few minutes, ducks under commentary, plays victory music on the result.
            </Typography>
          </Box>
        }
        sx={{ alignItems: 'flex-start', mx: 0 }}
      />
      <FormControlLabel
        control={<Switch checked={ap.autoMatch} onChange={(e) => patch({ autoMatch: e.target.checked })} />}
        label={
          <Box>
            <Typography variant="body2">Auto-pick live matches (24/7)</Typography>
            <Typography variant="caption" color="text.secondary">
              Follows the best live match; when it ends, moves to the next one (replay if nothing is live).
            </Typography>
          </Box>
        }
        sx={{ alignItems: 'flex-start', mx: 0 }}
      />

      <Divider />
      <Box>
        <Stack direction="row" alignItems="center">
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            AI commentator
          </Typography>
          <Switch checked={ap.commentator} onChange={(e) => patch({ commentator: e.target.checked })} />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Human-like neural voice reacts to every boundary, wicket and milestone, and chats about the chase, partnerships and other games between deliveries.
        </Typography>
        <AiCommentarySettings client={client} hostToken={hostToken} />
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5 }}>
          Chatter every ~{ap.chatterSeconds}s when the game is quiet
        </Typography>
        <Slider size="small" min={15} max={120} step={5} defaultValue={ap.chatterSeconds} onChangeCommitted={(_, v) => patch({ chatterSeconds: v as number })} />
        <Stack direction="row" spacing={1}>
          <TextField fullWidth placeholder="Type a line for the commentator to say on air" value={say} onChange={(e) => setSay(e.target.value)} />
          <Button
            variant="contained"
            disabled={!say.trim()}
            onClick={() => {
              void client.sayNow(say);
              setSay('');
            }}
          >
            Say
          </Button>
        </Stack>
        {client.commentary && (
          <Alert icon={<Icon name="record_voice_over" />} severity="info" sx={{ mt: 1 }}>
            {client.commentary.text}
          </Alert>
        )}
      </Box>

      <Divider />
      <Box>
        <Typography variant="subtitle2">24/7 cloud broadcast</Typography>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
          The server renders and streams the show in a headless browser, so you can close this tab. It survives disconnects, encoder restarts and server reboots, and recycles itself to keep memory flat.
        </Typography>
        {cloudLive ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip color="error" label={`Cloud producer ${st.live.state}`} />
            {st.live.reconnects ? <Chip variant="outlined" label={`${st.live.reconnects} auto-recoveries`} /> : null}
          </Stack>
        ) : (
          <Button variant="contained" color="error" startIcon={<Icon name="cloud_upload" />} disabled={live || !hasDestinations} onClick={onGoCloud}>
            Start 24/7 cloud stream
          </Button>
        )}
        {!hasDestinations && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
            Add a destination in the Stream tab first.
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
