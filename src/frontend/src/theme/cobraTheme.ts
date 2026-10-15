import { alpha, createTheme } from '@mui/material/styles'

/**
 * COBRA C5 Design System - Material-UI 9 Theme
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
  interface TypeText {
    /**
     * COBRA muted text (demo-feedback 25, DF-37): secondary copy, hints, metadata. AA (>= 4.5:1)
     * on white and on every light COBRA surface — see `COBRA_MUTED_TEXT`.
     */
    muted: string;
  }
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
 * The ONE COBRA muted-text value (demo-feedback 25, DF-37; #461 §1, #450 F-6; NFR-001).
 *
 * Cadence's `text.secondary` was #848482: 3.75:1 on white and 3.0:1 on `grid.main`, under the
 * WCAG 2.1 AA 4.5:1 floor for normal text. Staff files worked around it with their own greys
 * (#5c5c5a, #595957, #6b6b69). This value replaces those: 6.70:1 on white,
 * 6.31:1 on `background.default`, 5.93:1 on `grid.light`, 5.44:1 on `grid.main`, 4.84:1 on
 * `primary.light` (the "not started" chip) — `cobraTheme.contrast.test.ts` computes each one.
 *
 * `text.secondary` moves to the same value: MUI paints field labels, helper text and
 * `color="text.secondary"` copy with it, so leaving it below AA would keep every new staff
 * screen re-discovering the problem. `palette.text.muted` is the name staff code uses
 * directly; `text.secondary` is the same token for MUI's own components.
 *
 * NOT for the dark console chrome (`features/controller/consoleChrome.ts` has its own inks)
 * or the navy header (`staffShellTokens.header.textMuted`): a dark grey on a dark ground fails.
 * Staff world only — participant surfaces never mount this theme.
 */
const COBRA_MUTED_TEXT = '#5c5c5a'

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
      secondary: COBRA_MUTED_TEXT,
      muted: COBRA_MUTED_TEXT,
    },
    error: {
      main: '#e42217', // lava red
    },
    info: {
      main: '#0020c2',
      light: '#0000ff',
      dark: '#00008b',
    },
    // A hairline, never text: decorative separators carry no contrast requirement (text uses
    // `text.muted`). Kept at Cadence's grey so the staff chrome does not shift.
    divider: '#848482',
    success: {
      main: '#08682a',
    },
    buttonDelete: {
      contrastText: '#ffffff',
      dark: '#c11b17', // chilli pepper
      // Hover fill. Was #ff0000 (white label 4.00:1, below AA — #461 §1); #d01f17 is 5.40:1.
      light: '#d01f17',
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
