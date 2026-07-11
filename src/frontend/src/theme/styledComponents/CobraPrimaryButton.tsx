import { Button } from '@mui/material'
import { styled } from '@mui/material/styles'

/**
 * CobraPrimaryButton - Primary action button with cobalt blue background
 *
 * Use for:
 * - Main form submissions (Save, Submit, Create)
 * - Primary call-to-action buttons
 * - Confirm actions
 *
 * Example:
 * ```tsx
 * <CobraPrimaryButton onClick={handleSave}>Save</CobraPrimaryButton>
 * ```
 */
export const CobraPrimaryButton = styled(Button)(({ theme }) => ({
  background: theme.palette.buttonPrimary.main,
  borderRadius: 50,
  color: theme.palette.buttonPrimary.contrastText,
  paddingBottom: 5,
  paddingLeft: 20,
  paddingRight: 20,
  paddingTop: 5,
  textTransform: 'none',
  '&:hover': {
    background: theme.palette.buttonPrimary.light,
  },
  '&:active': {
    background: theme.palette.buttonPrimary.dark,
  },
  '&.Mui-disabled': {
    background: theme.palette.primary.light,
    color: theme.palette.primary.dark,
  },
}))
