import { Box, ButtonBase, Chip, Stack, Typography } from '@mui/material';
import { SCENES, type SceneMeta, type StudioState } from '@cricstudio/shared';
import { Icon } from './Icon';

const GROUP_ORDER: SceneMeta['group'][] = ['Show', 'Cameras', 'Score', 'Stats', 'Insights', 'Analysis', 'Match'];

export function SceneRail({ state, onPick, disabled }: { state: StudioState; onPick: (id: SceneMeta['id']) => void; disabled?: boolean }) {
  const temp = state.sceneUntil && state.scene !== state.baseScene;
  const pinned = state.pinnedUntil > Date.now();
  return (
    <Box sx={{ overflow: 'auto', height: '100%', pr: 0.5 }}>
      {GROUP_ORDER.map((g) => (
        <Box key={g} sx={{ mb: 1.5 }}>
          <Typography variant="overline" color="text.secondary" sx={{ px: 1, lineHeight: 2 }}>
            {g}
          </Typography>
          {SCENES.filter((s) => s.group === g).map((s) => {
            const active = state.scene === s.id;
            const base = state.baseScene === s.id && temp;
            return (
              <ButtonBase
                key={s.id}
                disabled={disabled}
                onClick={() => onPick(s.id)}
                sx={{
                  width: '100%',
                  justifyContent: 'flex-start',
                  borderRadius: 1.5,
                  px: 1.5,
                  py: 0.9,
                  mb: 0.25,
                  gap: 1.5,
                  bgcolor: active ? 'primary.main' : base ? 'action.selected' : 'transparent',
                  color: active ? 'primary.contrastText' : 'text.primary',
                  transition: 'background-color .2s',
                  '&:hover': { bgcolor: active ? 'primary.main' : 'action.hover' },
                }}
              >
                <Icon name={s.icon} size={20} fill={active} />
                <Typography variant="body2" sx={{ flex: 1, textAlign: 'left', fontWeight: active ? 600 : 500 }} noWrap>
                  {s.name}
                </Typography>
                {active && temp && <Chip size="small" label="auto" sx={{ height: 18, fontSize: 10, bgcolor: 'rgba(255,255,255,.25)', color: 'inherit' }} />}
                {active && pinned && !temp && <Icon name="push_pin" size={16} />}
                {s.hotkey && !active && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                    {s.hotkey}
                  </Typography>
                )}
              </ButtonBase>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
