import { createContext, useContext, useMemo, useState } from 'react';
import { CssBaseline, ThemeProvider, type PaletteMode } from '@mui/material';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { prefs } from './lib/storage';
import { Dashboard } from './pages/Dashboard';
import { Join } from './pages/Join';
import { Program } from './pages/Program';
import { Studio } from './pages/Studio';
import { makeTheme } from './theme';

const ModeCtx = createContext<{ mode: PaletteMode; toggle: () => void }>({ mode: 'light', toggle: () => {} });
export const useColorMode = () => useContext(ModeCtx);

export function App() {
  const sys = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const [mode, setMode] = useState<PaletteMode>(prefs.get('mode', sys));
  const theme = useMemo(() => makeTheme(mode), [mode]);
  const ctx = useMemo(
    () => ({
      mode,
      toggle: () =>
        setMode((m) => {
          const n = m === 'dark' ? 'light' : 'dark';
          prefs.set('mode', n);
          return n;
        }),
    }),
    [mode],
  );
  return (
    <ModeCtx.Provider value={ctx}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/studio/:id" element={<Studio />} />
            <Route path="/join/:token" element={<Join />} />
            <Route path="/program/:id" element={<Program />} />
          </Routes>
          </ErrorBoundary>
        </BrowserRouter>
      </ThemeProvider>
    </ModeCtx.Provider>
  );
}
