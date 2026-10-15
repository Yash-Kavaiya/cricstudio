import { Component, type ReactNode } from 'react';
import { Alert, Button, Stack } from '@mui/material';

/** Keeps a UI bug from taking down the whole studio (and its live WebRTC/stream sessions). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[ui]', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', p: 3 }} spacing={2}>
        <Alert severity="error" sx={{ maxWidth: 560 }}>
          Something went wrong in the interface: {this.state.error.message}
        </Alert>
        <Button variant="contained" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </Stack>
    );
  }
}
