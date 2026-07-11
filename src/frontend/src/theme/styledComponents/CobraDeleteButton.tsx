import { Button, type ButtonProps } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTrash } from '@fortawesome/free-solid-svg-icons'
import { styled } from '@mui/material/styles'

/**
 * CobraDeleteButton - Red delete/remove button
 *
 * Use for:
 * - Delete actions
 * - Remove items
 * - Destructive operations
 */
const StyledDeleteButton = styled(Button)(({ theme }) => ({
  background: theme.palette.buttonDelete.main,
  borderRadius: 50,
  color: theme.palette.buttonDelete.contrastText,
  paddingBottom: 5,
  paddingLeft: 20,
  paddingRight: 20,
  paddingTop: 5,
  textTransform: 'none',
  '&:hover': {
    background: theme.palette.buttonDelete.light,
  },
  '&:active': {
    background: theme.palette.buttonDelete.dark,
  },
}))

interface CobraDeleteButtonProps extends ButtonProps {
  hideIcon?: boolean;
}

export const CobraDeleteButton = ({
  hideIcon = false,
  startIcon,
  children,
  ...props
}: CobraDeleteButtonProps) => (
  <StyledDeleteButton
    startIcon={hideIcon ? undefined : (startIcon ?? <FontAwesomeIcon icon={faTrash} />)}
    {...props}
  >
    {children}
  </StyledDeleteButton>
)
