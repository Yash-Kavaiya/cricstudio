import { createTheme, type PaletteMode } from '@mui/material';

// Google Material 3-ish tokens
export const G = {
  blue: '#1a73e8',
  blueDark: '#8ab4f8',
  red: '#ea4335',
  yellow: '#fbbc04',
  green: '#34a853',
  purple: '#9334e6',
  grey: '#5f6368',
};

export function makeTheme(mode: PaletteMode) {
  const dark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      primary: { main: dark ? G.blueDark : G.blue, contrastText: dark ? '#062e6f' : '#fff' },
      secondary: { main: dark ? '#81c995' : G.green },
      error: { main: dark ? '#f28b82' : '#d93025' },
      warning: { main: dark ? '#fdd663' : '#f9ab00' },
      success: { main: dark ? '#81c995' : '#188038' },
      background: dark ? { default: '#131314', paper: '#1e1f20' } : { default: '#f8fafd', paper: '#ffffff' },
      text: dark ? { primary: '#e3e3e3', secondary: '#c4c7c5' } : { primary: '#1f1f1f', secondary: '#444746' },
      divider: dark ? 'rgba(255,255,255,0.12)' : '#e0e3e7',
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: '"Google Sans", Roboto, "Helvetica Neue", Arial, sans-serif',
      h4: { fontWeight: 500, letterSpacing: 0 },
      h5: { fontWeight: 500 },
      h6: { fontWeight: 500 },
      button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0.1 },
      subtitle2: { fontWeight: 500 },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { borderRadius: 10, paddingInline: 18 } },
      },
      MuiChip: { styleOverrides: { root: { borderRadius: 6, fontWeight: 500 } } },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: ({ theme }) => ({ border: `1px solid ${theme.palette.divider}`, borderRadius: 10 }),
        },
      },
      MuiPaper: { styleOverrides: { rounded: { borderRadius: 10 } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', minHeight: 48, fontWeight: 500 } } },
      MuiTooltip: { defaultProps: { arrow: true } },
      MuiAppBar: { defaultProps: { elevation: 0, color: 'inherit' } },
      MuiTextField: { defaultProps: { size: 'small' } },
    },
  });
}
