import { Paper } from '@mui/material'
import { styled } from '@mui/material/styles'

/**
 * COBRA Styling Constants
 *
 * Centralized spacing and padding values for consistent styling across staff surfaces.
 *
 * Usage:
 * - Import this file: import CobraStyles from '@/theme/CobraStyles'
 * - Use constants: padding={CobraStyles.Padding.MainWindow}
 * - Use spacing: spacing={CobraStyles.Spacing.FormFields}
 *
 * IMPORTANT: Always use these constants instead of hardcoded values to maintain consistency.
 */
const CobraStyles = {
  /**
   * Padding Constants
   * Use for container padding (dialogs, pages, popovers)
   */
  Padding: {
    /** Main window/page content padding: 18px */
    MainWindow: '18px',

    /** Dialog content padding: 15px */
    DialogContent: '15px',

    /** Popover content padding: 12px */
    PopoverContent: '12px',
  },

  /**
   * Spacing Constants
   * Use for gaps between elements (Stack spacing, margins, etc.)
   */
  Spacing: {
    /** Spacing after dividers/separators: 18px */
    AfterSeparator: '18px',

    /** Spacing between dashboard widgets: 20px */
    DashboardWidgets: '20px',

    /** Spacing between icon and text: 5px */
    IconAndText: '5px',

    /** Spacing between form fields: 12px */
    FormFields: '12px',
  },

  /**
   * Scrollbar Constants
   * Use for consistent scrollbar styling across scrollable containers
   */
  Scrollbar: {
    /** Spacing between content and scrollbar: 12px (MUI spacing 1.5) */
    ContentSpacing: 12,

    /** Scrollbar width: 8px */
    Width: 8,

    /** MUI sx object for consistent scrollbar styling */
    Styling: {
      '&::-webkit-scrollbar': {
        width: 8,
      },
      '&::-webkit-scrollbar-track': {
        bgcolor: 'grey.100',
        borderRadius: 1,
      },
      '&::-webkit-scrollbar-thumb': {
        bgcolor: 'grey.400',
        borderRadius: 1,
        '&:hover': {
          bgcolor: 'grey.500',
        },
      },
    },
  },

  /**
   * Styled Paper Components
   */
  Paper: {
    /** Large paper component with overflow hidden */
    Large: styled(Paper)(() => ({
      overflow: 'hidden',
      toolbar: {
        paddingLeft: '16px !important',
      },
    })),
  },
}

export default CobraStyles
