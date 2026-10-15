import { useState } from 'react';
import { IconButton, Stack, Tooltip } from '@mui/material';
import type { StudioClient } from '../lib/studioClient';
import { Icon } from './Icon';
import { MediaSettingsDialog } from './MediaSettings';

function RoundBtn({ title, icon, on = true, danger, onClick }: { title: string; icon: string; on?: boolean; danger?: boolean; onClick: (e: React.MouseEvent<HTMLElement>) => void }) {
  return (
    <Tooltip title={title}>
      <IconButton
        onClick={onClick}
        sx={{
          width: 42,
          height: 42,
          bgcolor: danger ? 'error.main' : on ? 'action.selected' : 'error.main',
          color: danger || !on ? '#fff' : 'text.primary',
          '&:hover': { bgcolor: danger || !on ? 'error.dark' : 'action.hover' },
        }}
      >
        <Icon name={icon} fill={!on} />
      </IconButton>
    </Tooltip>
  );
}

export function ControlBar({ client, onLeave }: { client: StudioClient; onLeave: () => void }) {
  const [settings, setSettings] = useState(false);
  const mic = !client.isMicMuted();
  const cam = !client.isCamOff();
  return (
    <Stack direction="row" spacing={1} justifyContent="center" alignItems="center">
      <RoundBtn title={mic ? 'Mute mic' : 'Unmute mic'} icon={mic ? 'mic' : 'mic_off'} on={mic} onClick={() => client.setMuted(mic)} />
      <RoundBtn title={cam ? 'Turn camera off' : 'Turn camera on'} icon={cam ? 'videocam' : 'videocam_off'} on={cam} onClick={() => client.setCamOff(cam)} />
      <RoundBtn title={client.screenStream ? 'Stop sharing' : 'Share screen'} icon={client.screenStream ? 'cancel_presentation' : 'present_to_all'} onClick={() => void client.toggleScreen()} />
      <RoundBtn title="Audio & video settings" icon="settings" onClick={() => setSettings(true)} />
      <RoundBtn title="Leave studio" icon="call_end" danger onClick={onLeave} />
      <MediaSettingsDialog client={client} open={settings} onClose={() => setSettings(false)} />
    </Stack>
  );
}
