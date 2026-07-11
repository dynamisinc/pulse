import { Button } from '@mui/material'
import { styled } from '@mui/material/styles'

/**
 * CobraSecondaryButton - Secondary/outline button
 *
 * Use for:
 * - Alternative actions
 * - Secondary form submissions
 * - Less prominent actions
 */
export const CobraSecondaryButton = styled(Button)(({ theme }) => ({
  background: 'transparent',
  border: `1px solid ${theme.palette.buttonPrimary.main}`,
  borderRadius: 50,
  color: theme.palette.buttonPrimary.main,
  paddingBottom: 5,
  paddingLeft: 20,
  paddingRight: 20,
  paddingTop: 5,
  textTransform: 'none',
  '&:hover': {
    background: theme.palette.linkButton.light,
    borderColor: theme.palette.buttonPrimary.light,
  },
  '&:active': {
    background: theme.palette.buttonPrimary.dark,
    color: theme.palette.buttonPrimary.contrastText,
  },
}))
