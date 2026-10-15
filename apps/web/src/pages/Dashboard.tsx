import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Skeleton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import type { MatchListItem } from '@cricstudio/shared';
import { useColorMode } from '../App';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { api } from '../lib/api';
import { studioStore, type SavedStudio } from '../lib/storage';

type Filter = 'in' | 'pre' | 'post' | 'all';

function MatchCard({ m, onCreate }: { m: MatchListItem; onCreate: () => void }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardActionArea onClick={onCreate} sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          {m.state === 'in' ? (
            <Chip size="small" color="error" label={<Stack direction="row" alignItems="center" gap={0.75}><span className="live-dot" style={{ background: '#fff' }} />LIVE</Stack>} />
          ) : (
            <Chip size="small" variant="outlined" label={m.state === 'pre' ? 'Upcoming' : 'Result'} />
          )}
          {m.isDemo && <Chip size="small" color="secondary" label="Demo replay" />}
          <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>
            {m.leagueName}
          </Typography>
        </Stack>
        {m.teams.map((t) => (
          <Stack key={t.id} direction="row" alignItems="center" spacing={1.5} sx={{ py: 0.6 }}>
            <Avatar src={t.logo} sx={{ width: 28, height: 28, bgcolor: 'action.hover', fontSize: 12 }}>
              {t.abbr.slice(0, 3)}
            </Avatar>
            <Typography sx={{ flex: 1, fontWeight: t.winner ? 700 : 500 }} noWrap>
              {t.name}
            </Typography>
            <Typography sx={{ fontFamily: '"Roboto Condensed"', fontWeight: 700, fontSize: 17 }} noWrap>
              {t.score}
            </Typography>
          </Stack>
        ))}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, flex: 1 }} noWrap>
          {m.description} · {m.statusText}
        </Typography>
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1.5 }}>
          <Button size="small" variant="text" startIcon={<Icon name="videocam" size={18} />} component="span" sx={{ bgcolor: 'action.selected' }}>
            Create studio
          </Button>
        </Stack>
      </CardActionArea>
    </Card>
  );
}

export function Dashboard() {
  const nav = useNavigate();
  const { mode, toggle } = useColorMode();
  const [matches, setMatches] = useState<MatchListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('in');
  const [q, setQ] = useState('');
  const [create, setCreate] = useState<{ match: MatchListItem | null } | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedStudio[]>(studioStore.all());

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .matches()
        .then((m) => alive && (setMatches(m), setError(null)))
        .catch((e) => alive && setError(e.message));
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const shown = useMemo(() => {
    const list = matches ?? [];
    return list.filter(
      (m) =>
        (filter === 'all' || m.state === filter || (m.isDemo && filter === 'in')) &&
        (!q || `${m.name} ${m.leagueName} ${m.description}`.toLowerCase().includes(q.toLowerCase())),
    );
  }, [matches, filter, q]);

  const counts = useMemo(() => {
    const c = { in: 0, pre: 0, post: 0, all: matches?.length ?? 0 };
    matches?.forEach((m) => c[m.state]++);
    return c;
  }, [matches]);

  const openCreate = (m: MatchListItem | null) => {
    setName(m ? `${m.teams.map((t) => t.abbr).join(' vs ')} — Live Watch-along` : 'Cricket Live Show');
    setCreate({ match: m });
  };

  const doCreate = async () => {
    setBusy(true);
    try {
      const mk = create?.match ? (create.match.isDemo ? 'demo:replay' : `${create.match.leagueId}:${create.match.id}`) : null;
      const r = await api.createStudio(name, mk);
      const s: SavedStudio = { ...r, matchKey: mk, createdAt: Date.now() };
      studioStore.save(s);
      setSaved(studioStore.all());
      nav(`/studio/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <AppBar position="sticky" sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Toolbar sx={{ gap: 2 }}>
          <Logo />
          <Box sx={{ flex: 1 }} />
          <TextField
            placeholder="Search matches, series, teams"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            sx={{ width: { xs: 180, md: 420 }, '& .MuiOutlinedInput-root': { borderRadius: 999, bgcolor: 'action.hover' }, '& fieldset': { border: 'none' } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Icon name="search" /></InputAdornment> }}
          />
          <Tooltip title={mode === 'dark' ? 'Light theme' : 'Dark theme'}>
            <IconButton onClick={toggle}>
              <Icon name={mode === 'dark' ? 'light_mode' : 'dark_mode'} />
            </IconButton>
          </Tooltip>
          <Button variant="contained" startIcon={<Icon name="add" />} onClick={() => openCreate(null)}>
            New studio
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'flex-end' }} spacing={2} sx={{ mb: 3 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h4">Go live with cricket</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Pick a match — live scores, ball-by-ball, scorecards and automated scenes are wired in for you. Stream to YouTube, Facebook, X and Twitch at once.
            </Typography>
          </Box>
          <ToggleButtonGroup exclusive size="small" value={filter} onChange={(_, v) => v && setFilter(v)} sx={{ '& .MuiToggleButton-root': { px: 2, borderRadius: 999 } }}>
            <ToggleButton value="in">Live ({counts.in})</ToggleButton>
            <ToggleButton value="pre">Upcoming ({counts.pre})</ToggleButton>
            <ToggleButton value="post">Results ({counts.post})</ToggleButton>
            <ToggleButton value="all">All</ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        {saved.length > 0 && (
          <Box sx={{ mb: 4 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              Your studios
            </Typography>
            <Stack direction="row" gap={1} flexWrap="wrap">
              {saved.map((s) => (
                <Chip
                  key={s.id}
                  icon={<Icon name="video_camera_front" size={18} />}
                  label={s.name}
                  onClick={() => nav(`/studio/${s.id}`)}
                  onDelete={() => {
                    studioStore.remove(s.id);
                    setSaved(studioStore.all());
                  }}
                  sx={{ py: 2.2, px: 0.5 }}
                />
              ))}
            </Stack>
          </Box>
        )}

        {error && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Could not load live scores ({error}). The demo replay is still available.
          </Alert>
        )}

        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(3, 1fr)', xl: 'repeat(4, 1fr)' } }}>
          {matches === null &&
            Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} variant="rounded" height={200} sx={{ borderRadius: 2 }} />)}
          <AnimatePresence>
            {shown.map((m, i) => (
              <motion.div key={`${m.leagueId}-${m.id}`} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.03, 0.4) } }} exit={{ opacity: 0 }}>
                <MatchCard m={m} onCreate={() => openCreate(m)} />
              </motion.div>
            ))}
          </AnimatePresence>
        </Box>
        {matches && !shown.length && (
          <Stack alignItems="center" sx={{ py: 8, color: 'text.secondary' }} spacing={1}>
            <Icon name="sports_cricket" size={48} />
            <Typography>No matches in this view right now.</Typography>
          </Stack>
        )}
      </Container>

      <Dialog open={!!create} onClose={() => setCreate(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Create a studio</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {create?.match && (
              <Alert icon={<Icon name="sports_cricket" />} severity="info">
                {create.match.name} · {create.match.description}
              </Alert>
            )}
            <TextField label="Show title" value={name} onChange={(e) => setName(e.target.value)} fullWidth autoFocus />
            <Typography variant="body2" color="text.secondary">
              You'll be the host. Invite up to 4 expert guests with a link. Live data, scenes and automation are attached to this match — you can switch matches anytime.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setCreate(null)}>Cancel</Button>
          <Button variant="contained" onClick={doCreate} disabled={busy || !name.trim()} startIcon={busy ? <CircularProgress size={16} /> : <Icon name="arrow_forward" />}>
            Enter studio
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
