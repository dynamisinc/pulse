import { Button } from '@mui/material'
import { styled } from '@mui/material/styles'

/**
 * CobraLinkButton - Text-style link button
 *
 * Use for:
 * - Cancel actions
 * - Back navigation
 * - Dismiss actions
 * - Less important actions
 */
export const CobraLinkButton = styled(Button)(({ theme }) => ({
  background: 'transparent',
  borderRadius: 50,
  color: theme.palette.linkButton.main,
  paddingBottom: 5,
  paddingLeft: 20,
  paddingRight: 20,
  paddingTop: 5,
  textDecoration: 'none',
  textTransform: 'none',
  '&:hover': {
    background: theme.palette.linkButton.light,
    textDecoration: 'underline',
  },
  '&:active': {
    background: theme.palette.buttonPrimary.dark,
    color: theme.palette.buttonPrimary.contrastText,
  },
}))
