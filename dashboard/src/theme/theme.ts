'use client';

import { createTheme, alpha } from '@mui/material/styles';

// AITO Dashboard Theme - Gold/Dark with Glass-morphism
export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#ffd700',      // Gold
      light: '#ffe54c',
      dark: '#c9a600',
      contrastText: '#000000',
    },
    secondary: {
      main: '#00ff88',      // Neon Green (healthy status)
      light: '#5cffac',
      dark: '#00cc6a',
      contrastText: '#000000',
    },
    error: {
      main: '#ff4757',      // Red
      light: '#ff6b7a',
      dark: '#cc3945',
    },
    warning: {
      main: '#ffa502',      // Orange
      light: '#ffb84d',
      dark: '#cc8400',
    },
    info: {
      main: '#45b7d1',      // Light Blue
      light: '#6dc9de',
      dark: '#3792a7',
    },
    success: {
      main: '#00ff88',
      light: '#5cffac',
      dark: '#00cc6a',
    },
    background: {
      default: '#0f0f23',
      paper: '#1a1a2e',
    },
    text: {
      primary: '#ffffff',
      secondary: 'rgba(255, 255, 255, 0.7)',
    },
    divider: 'rgba(255, 255, 255, 0.12)',
  },
  typography: {
    fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
    h1: {
      fontSize: '2.5rem',
      fontWeight: 700,
    },
    h2: {
      fontSize: '2rem',
      fontWeight: 600,
    },
    h3: {
      fontSize: '1.5rem',
      fontWeight: 600,
    },
    h4: {
      fontSize: '1.25rem',
      fontWeight: 600,
    },
    h5: {
      fontSize: '1rem',
      fontWeight: 600,
    },
    h6: {
      fontSize: '0.875rem',
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f0f23 100%)',
          minHeight: '100vh',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          background: 'rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          transition: 'transform 0.2s ease, box-shadow 0.2s ease',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: '0 8px 32px rgba(255, 215, 0, 0.15)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          background: 'rgba(255, 255, 255, 0.05)',
          backdropFilter: 'blur(10px)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: 'rgba(26, 26, 46, 0.9)',
          backdropFilter: 'blur(10px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          background: 'rgba(26, 26, 46, 0.95)',
          backdropFilter: 'blur(10px)',
          borderRight: '1px solid rgba(255, 255, 255, 0.1)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
        },
        containedPrimary: {
          '&:hover': {
            boxShadow: '0 4px 20px rgba(255, 215, 0, 0.4)',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500,
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          margin: '4px 8px',
          '&.Mui-selected': {
            backgroundColor: 'rgba(255, 215, 0, 0.15)',
            '&:hover': {
              backgroundColor: 'rgba(255, 215, 0, 0.25)',
            },
          },
        },
      },
    },
  },
});

// Agent type colors (matching old dashboard)
export const agentColors: Record<string, string> = {
  ceo: '#ffd700',      // Gold
  dao: '#6c5ce7',      // Purple
  cmo: '#ff6b6b',      // Red
  cto: '#45b7d1',      // Light Blue
  cfo: '#4ecdc4',      // Teal
  coo: '#f9ca24',      // Yellow
  cco: '#a29bfe',      // Light Purple
};

// Status colors
export const statusColors = {
  healthy: '#00ff88',
  unhealthy: '#ff4757',
  degraded: '#ffa502',
  inactive: '#666666',
  pending: '#45b7d1',
};
