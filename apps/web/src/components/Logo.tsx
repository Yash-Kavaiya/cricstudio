import { Stack, Typography } from '@mui/material';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.2}>
      <svg width="32" height="32" viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="16" fill="#1a73e8" />
        <circle cx="42" cy="22" r="8" fill="#ea4335" />
        <rect x="14" y="30" width="30" height="8" rx="4" transform="rotate(-40 29 34)" fill="#fbbc04" />
        <rect x="12" y="46" width="40" height="5" rx="2.5" fill="#34a853" />
      </svg>
      {!compact && (
        <Typography variant="h6" sx={{ fontWeight: 500, letterSpacing: -0.2 }}>
          Cric<span style={{ color: '#1a73e8' }}>Studio</span>
        </Typography>
      )}
    </Stack>
  );
}
