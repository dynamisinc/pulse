import { TextField } from '@mui/material'
import { styled } from '@mui/material/styles'

/**
 * CobraTextField - Styled text input field with COBRA theme colors
 *
 * Use for:
 * - All text inputs
 * - Multi-line text areas (multiline prop)
 * - Form fields
 *
 * Example:
 * ```tsx
 * <CobraTextField
 *   label="Title"
 *   value={title}
 *   onChange={e => setTitle(e.target.value)}
 *   fullWidth
 *   required
 * />
 * ```
 */
export const CobraTextField = styled(TextField)(({ theme }) => ({
  '& .MuiInputBase-root': {
    background: theme.palette.background.paper,
  },
  '& .Mui-error': {
    margin: 0,
  },
  '& label.Mui-focused': {
    color: theme.palette.buttonPrimary.main,
  },
  '& .MuiOutlinedInput-root': {
    '&:hover fieldset': {
      borderColor: theme.palette.buttonPrimary.main,
    },
    '&.Mui-focused fieldset': {
      borderColor: theme.palette.buttonPrimary.main,
    },
  },
}))
