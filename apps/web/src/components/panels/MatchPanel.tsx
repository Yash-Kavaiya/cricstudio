import { useMemo, useState } from 'react';
import { Alert, Avatar, Box, Button, ButtonGroup, Chip, List, ListItemButton, ListItemText, Stack, TextField, Typography } from '@mui/material';
import type { StudioClient } from '../../lib/studioClient';
import { Icon } from '../Icon';

export function MatchPanel({ client }: { client: StudioClient }) {
  const [q, setQ] = useState('');
  const st = client.state!;
  const m = client.match;
  const list = useMemo(
    () =>
      client.matches
        .filter((x) => !q || `${x.name} ${x.leagueName}`.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 60),
    [client.matches, q],
  );
  const keyOf = (x: (typeof list)[number]) => (x.isDemo ? 'demo:replay' : `${x.leagueId}:${x.id}`);

  return (
    <Stack spacing={2}>
      {m ? (
        <Box sx={{ p: 2, borderRadius: 1.5, bgcolor: 'action.hover' }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Chip size="small" color={m.state === 'in' ? 'error' : 'default'} label={m.state === 'in' ? 'LIVE' : m.state === 'pre' ? 'Upcoming' : 'Result'} />
            <Typography variant="caption" color="text.secondary" noWrap>
              {m.series}
            </Typography>
          </Stack>
          {m.teams.map((t) => (
            <Stack key={t.id} direction="row" spacing={1} alignItems="center" sx={{ py: 0.3 }}>
              <Avatar src={t.logo} sx={{ width: 22, height: 22, fontSize: 10 }}>
                {t.abbr}
              </Avatar>
              <Typography sx={{ flex: 1 }} noWrap>
                {t.name}
              </Typography>
              <Typography sx={{ fontWeight: 700, fontFamily: '"Roboto Condensed"' }}>{t.score}</Typography>
            </Stack>
          ))}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {m.summary || m.statusText}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Updated {new Date(m.lastUpdated).toLocaleTimeString()} · {m.recentBalls.length} balls cached
          </Typography>
          {m.isDemo && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
              <Typography variant="caption">Replay:</Typography>
              <ButtonGroup size="small">
                <Button onClick={() => void client.demoStep(1)}>+1 ball</Button>
                <Button onClick={() => void client.demoStep(6)}>+1 over</Button>
                <Button onClick={() => void client.demoStep(30)}>+5 overs</Button>
              </ButtonGroup>
            </Stack>
          )}
        </Box>
      ) : (
        <Alert severity="info" icon={<Icon name="sports_cricket" />}>
          {st.matchKey ? 'Loading match data…' : 'No match attached. Pick one below to power scores and automation.'}
        </Alert>
      )}
      <TextField placeholder="Search live & upcoming matches" value={q} onChange={(e) => setQ(e.target.value)} InputProps={{ startAdornment: <Icon name="search" style={{ marginRight: 8 }} /> }} />
      <List dense disablePadding sx={{ maxHeight: 420, overflow: 'auto', mx: -1 }}>
        {list.map((x) => {
          const k = keyOf(x);
          const active = k === st.matchKey;
          return (
            <ListItemButton key={k} selected={active} onClick={() => void client.patch({ matchKey: k })} sx={{ borderRadius: 2 }}>
              <ListItemText
                primary={
                  <Stack direction="row" spacing={1} alignItems="center">
                    {x.state === 'in' && <span className="live-dot" />}
                    <Typography variant="body2" noWrap sx={{ fontWeight: active ? 700 : 500 }}>
                      {x.teams.map((t) => `${t.abbr} ${t.score}`.trim()).join(' v ')}
                    </Typography>
                  </Stack>
                }
                secondary={`${x.leagueName} · ${x.statusText}`}
                secondaryTypographyProps={{ noWrap: true }}
              />
            </ListItemButton>
          );
        })}
      </List>
      {st.matchKey && (
        <Button color="inherit" startIcon={<Icon name="link_off" />} onClick={() => void client.patch({ matchKey: null })}>
          Detach match
        </Button>
      )}
    </Stack>
  );
}
