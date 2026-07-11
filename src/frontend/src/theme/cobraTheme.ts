import { alpha, createTheme } from '@mui/material/styles'

/**
 * COBRA C5 Design System - Material-UI 7 Theme
 *
 * Shared Dynamis operator-tooling theme, ported from Cadence.
 *
 * In Pulse this is the **staff world** foundation (D0 §2): controller and
 * evaluator consoles use the fixed COBRA system look so a Cadence-trained
 * controller is productive immediately. Participant surfaces (the fiction:
 * Pulse social, portals, outlets, weather) are heavily skinned per-brand and
 * must NEVER read as an enterprise app — they do not use this theme.
 *
 * Key Design Principles:
 * - Silver/Cobalt Blue color scheme
 * - Small form controls by default
 * - 54px header height
 * - Consistent spacing and padding via CobraStyles
 */

// Extend MUI Theme interface with custom properties
declare module '@mui/material/styles' {
  interface Theme {
    cssStyling: {
      headerHeight: number;
      drawerClosedWidth: number;
      drawerOpenWidth: number;
    };
  }
  interface ThemeOptions {
    cssStyling?: {
      headerHeight: number;
      drawerClosedWidth: number;
      drawerOpenWidth: number;
    };
  }
  interface Palette {
    breadcrumb: {
      background: string;
    };
    border: {
      main: string;
    };
    buttonDelete: {
      contrastText: string;
      dark: string;
      light: string;
      main: string;
    };
    buttonPrimary: {
      contrastText: string;
      dark: string;
      light: string;
      main: string;
    };
    grid: {
      light: string;
      main: string;
    };
    linkButton: {
      contrastText: string;
      dark: string;
      light: string;
      main?: string;
    };
    notifications: {
      error: string;
      errorText: string;
      info: string;
      success: string;
      successText: string;
      warning: string;
      warningText: string;
    };
    statusChart: {
      grey: string;
      red: string;
      yellow: string;
      green: string;
      black: string;
    };
  }

  interface PaletteOptions {
    breadcrumb?: {
      background: string;
    };
    border?: {
      main: string;
    };
    buttonDelete?: {
      contrastText: string;
      dark: string;
      light: string;
      main?: string;
    };
    buttonPrimary?: {
      contrastText: string;
      dark: string;
      light: string;
      main?: string;
    };
    grid: {
      light: string;
      main: string;
    };
    linkButton?: {
      contrastText: string;
      dark: string;
      light: string;
      main?: string;
    };
    notifications?: {
      error: string;
      errorText: string;
      info: string;
      success: string;
      successText: string;
      warning: string;
      warningText: string;
    };
    statusChart?: {
      grey: string;
      red: string;
      yellow: string;
      green: string;
      black: string;
    };
  }
}

// Color overrides for buttons
declare module '@mui/material/Button' {
  interface ButtonPropsColorOverrides {
    white: true;
  }
}

const primaryContrastText = '#1a1a1a'

/**
 * COBRA Breakpoints (staff / desktop-first surfaces).
 * Participant surfaces are mobile-first and define their own responsive rules.
 */
export const cobraBreakpoints = {
  values: {
    xs: 0,
    sm: 600,
    md: 768,
    lg: 1024,
    xl: 1440,
  },
}

export const cobraTheme = createTheme({
  breakpoints: cobraBreakpoints,
  cssStyling: {
    drawerClosedWidth: 64,
    drawerOpenWidth: 288,
    headerHeight: 54,
  },
  palette: {
    mode: 'light',
    primary: {
      dark: '#696969', // dim gray
      main: '#c0c0c0', // silver
      contrastText: primaryContrastText,
      light: '#dadbdd', // silver white
    },
    secondary: {
      main: '#b22222', // firebrick
    },
    background: {
      default: '#f8f8f8',
      paper: '#ffffff',
    },
    border: {
      main: alpha(primaryContrastText, 0.23),
    },
    breadcrumb: {
      background: '#F1F1F1',
    },
    grid: {
      light: '#EAF2FB',
      main: '#DBE9FA',
    },
    text: {
      primary: '#1a1a1a',
      secondary: '#848482',
    },
    error: {
      main: '#e42217', // lava red
    },
    info: {
      main: '#0020c2',
      light: '#0000ff',
      dark: '#00008b',
    },
    divider: '#848482',
    success: {
      main: '#08682a',
    },
    buttonDelete: {
      contrastText: '#ffffff',
      dark: '#c11b17', // chilli pepper
      light: '#ff0000',
      main: '#e42217', // lava red
    },
    buttonPrimary: {
      contrastText: '#ffffff',
      dark: '#00008b', // darkblue
      light: '#0000ff',
      main: '#0020c2', // cobalt blue
    },
    linkButton: {
      contrastText: '#ffffff',
      dark: '#00008b',
      light: '#DBE9FA',
      main: '#0020c2',
    },
    notifications: {
      error: '#EFB6B6',
      errorText: '#b22222',
      info: '#DBE9FA',
      success: '#AEFBB8',
      successText: '#008000',
      warning: '#F9F9BE',
      warningText: '#6F4E37',
    },
    statusChart: {
      grey: '#C0C0C0',
      red: '#C11B17',
      yellow: '#FFEF00',
      green: '#008000',
      black: '#000000',
    },
  },
  typography: {
    fontFamily: 'Roboto, Arial, sans-serif',
    fontSize: 14,
    button: {
      textTransform: 'none',
    },
  },
  components: {
    MuiIconButton: {
      styleOverrides: {
        root: {
          color: '#1a1a1a',
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiAutocomplete: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiSelect: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiInputLabel: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiButtonGroup: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiToggleButtonGroup: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiButton: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiListItemIcon: {
      styleOverrides: {
        root: {
          color: '#3A3B3C',
        },
      },
    },
  },
})

/**
 * Helper: progress-bar color based on completion percentage.
 */
export const getProgressColor = (percentage: number): string => {
  if (percentage === 100) return cobraTheme.palette.success.main
  if (percentage >= 67) return cobraTheme.palette.info.main
  if (percentage >= 34) return cobraTheme.palette.statusChart.yellow
  return cobraTheme.palette.error.main
}

/**
 * Helper: generic status-chip colors (bg + text).
 */
export const getStatusChipColor = (
  status: string,
): { bg: string; text: string } => {
  const statusLower = status.toLowerCase()

  switch (statusLower) {
    case 'completed':
    case 'complete':
      return {
        bg: cobraTheme.palette.notifications.success,
        text: cobraTheme.palette.text.primary,
      }
    case 'in progress':
    case 'in-progress':
    case 'active':
      return {
        bg: cobraTheme.palette.grid.main,
        text: cobraTheme.palette.text.primary,
      }
    case 'not started':
    case 'not-started':
      return {
        bg: cobraTheme.palette.primary.light,
        text: cobraTheme.palette.text.secondary,
      }
    case 'blocked':
      return { bg: cobraTheme.palette.error.main, text: '#ffffff' }
    default:
      return {
        bg: cobraTheme.palette.primary.main,
        text: cobraTheme.palette.text.primary,
      }
  }
}

export default cobraTheme
