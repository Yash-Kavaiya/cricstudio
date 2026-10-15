import { useEffect, useRef, useState } from 'react';
import { Box, IconButton, Stack, TextField, Typography } from '@mui/material';
import type { StudioClient } from '../../lib/studioClient';
import { Icon } from '../Icon';

export function ChatPanel({ client, height = 520 }: { client: StudioClient; height?: number | string }) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [client.chat.length]);
  const send = () => {
    if (!text.trim()) return;
    client.sendChat(text);
    setText('');
  };
  return (
    <Stack sx={{ height }}>
      <Typography variant="caption" color="text.secondary">
        Private backstage chat between host and guests — not shown on stream.
      </Typography>
      <Box sx={{ flex: 1, overflow: 'auto', py: 1 }}>
        {client.chat.map((m) => (
          <Box key={m.id} sx={{ mb: 1.2 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: m.role === 'host' ? 'primary.main' : 'text.primary' }}>
              {m.from}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Typography>
            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
              {m.text}
            </Typography>
          </Box>
        ))}
        <div ref={end} />
      </Box>
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          fullWidth
          placeholder="Message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 999 } }}
        />
        <IconButton color="primary" onClick={send}>
          <Icon name="send" />
        </IconButton>
      </Stack>
    </Stack>
  );
}
