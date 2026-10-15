import { useEffect, useReducer } from 'react';
import type { StudioClient } from './studioClient';

/** Re-render whenever the StudioClient notifies. */
export function useClient(client: StudioClient | null) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!client) return;
    const off = client.subscribe(force);
    return () => {
      off();
    };
  }, [client]);
  return client;
}
