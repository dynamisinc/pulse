/**
 * features/participantAdmin/components/people/AddParticipantDialog.tsx
 * ---------------------------------------------------------------------------
 * "Add participant" — add ONE person to the exercise without a CSV (feature:
 * easy-login, story 10; COR-011). The fields are exactly `RosterRowWrite`:
 * name (required), agency, role, email, persona handle, sign-in name.
 *
 * ## Validation
 * The form validates BEFORE sending (`rosterValidation`): name required, sign-in
 * name `a-z 0-9 . _ -` 3 to 32, email shape. The first invalid field is focused
 * and each error is attached to its field (`aria-invalid` + `aria-describedby`
 * via the text field's helper text) as text, never colour alone. A server
 * answer is shown INLINE, in a `role="alert"` block: a `400` says what is wrong,
 * a `409` says the person is "already on the roster".
 *
 * ## What happens after
 * On success the mutation has already refetched the list, so `onAdded(entry)`
 * runs with the new row in place; the page closes the dialog and focuses that
 * row. Focus restore is the page's job (`disableRestoreFocus` here) so it can
 * send focus to the new row on success and back to the trigger on cancel.
 *
 * ## Why this is a form inside the dialog
 * The state lives in `AddParticipantForm`, which MUI unmounts when the dialog
 * closes, so reopening always starts blank.
 *
 * ## One request at a time, and no closing mid-request (story 10 Gate-1 W3)
 * The submit handler sets an in-flight ref synchronously, so a double Enter or
 * double click sends ONE request. While a request is pending the dialog ignores
 * Escape and backdrop clicks (`onClose` is withheld) and Cancel is disabled.
 *
 * World: STAFF. COBRA buttons + text fields from `@/theme/styledComponents`; MUI
 * `Dialog` under the COBRA theme. FontAwesome only; `sx`-only system props.
 */

import { useRef, useState, type FormEvent } from 'react'
import { Box, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTriangleExclamation, faUserPlus } from '@fortawesome/free-solid-svg-icons'
import {
  CobraLinkButton,
  CobraPrimaryButton,
  CobraTextField,
} from '@/theme/styledComponents'
import { useAddParticipant } from '../../hooks/useRosterMutations'
import type { RosterError } from '../../services/rosterService'
import type { RosterEntryDto, RosterRowWrite } from '../../types'
import {
  EMPTY_ROSTER_FORM,
  toRosterRowWrite,
  validateRosterForm,
  type RosterFormErrors,
  type RosterFormField,
  type RosterFormValues,
} from './rosterValidation'

export interface AddParticipantDialogProps {
  readonly open: boolean
  /** Cancel / Escape / backdrop. */
  readonly onClose: () => void
  /** The participant was added and the list has refetched. */
  readonly onAdded: (entry: RosterEntryDto) => void
}

/** Maps a server failure to the text shown inline. */
function serverFailureMessage(error: RosterError): string {
  if (error.status === 409) {
    return error.serverMessage ?? 'That person is already on the roster.'
  }
  if (error.status === 400) {
    return error.serverMessage ?? 'The server rejected those details. Check the fields and try again.'
  }
  if (error.status === 401 || error.status === 403) {
    return 'You don\'t have access to add participants.'
  }
  if (error.status === undefined) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  return error.serverMessage ?? 'The participant could not be added. Try again.'
}

const FIELD_HELP: Readonly<Partial<Record<RosterFormField, string>>> = {
  signInName:
    'Optional. What they type to sign in. Blank derives it from the name (Jane Smith becomes'
    + ' jsmith).',
  personaHandle:
    'Optional. The handle of an organization persona to operate (for example FulcoEM). Blank'
    + ' creates a citizen persona from their name.',
  email: 'Optional. Staff-only; never shown to participants.',
}

interface AddParticipantFormProps {
  readonly pending: boolean
  readonly submit: (row: RosterRowWrite) => Promise<RosterEntryDto>
  readonly onClose: () => void
  readonly onAdded: (entry: RosterEntryDto) => void
}

function AddParticipantForm({ pending, submit, onClose, onAdded }: AddParticipantFormProps) {
  // Set synchronously in the submit handler. `pending` only turns true on a later
  // render, so a double Enter or double click would otherwise send two requests (and
  // the second would 409 against the first).
  const inFlight = useRef(false)
  const [values, setValues] = useState<RosterFormValues>(EMPTY_ROSTER_FORM)
  const [errors, setErrors] = useState<RosterFormErrors>({})
  const [serverError, setServerError] = useState<string | undefined>(undefined)

  const setField = (field: RosterFormField) => (value: string) => {
    setValues(current => ({ ...current, [field]: value }))
    if (errors[field] !== undefined) setErrors(current => ({ ...current, [field]: undefined }))
    if (serverError !== undefined) setServerError(undefined)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (inFlight.current) return
    const form = event.currentTarget
    const found = validateRosterForm(values)
    if (Object.values(found).some(message => message !== undefined)) {
      setErrors(found)
      setServerError(undefined)
      // Let the error state render, then put the cursor on the first bad field.
      queueMicrotask(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setErrors({})
    setServerError(undefined)
    inFlight.current = true
    try {
      const entry = await submit(toRosterRowWrite(values))
      onAdded(entry)
    } catch (error) {
      setServerError(serverFailureMessage(error as RosterError))
    } finally {
      inFlight.current = false
    }
  }

  const field = (
    name: RosterFormField,
    label: string,
    extra: { required?: boolean, autoFocus?: boolean, maxLength?: number } = {},
  ) => (
    <CobraTextField
      id={`add-participant-${name}`}
      label={label}
      value={values[name]}
      onChange={event => setField(name)(event.target.value)}
      error={errors[name] !== undefined}
      helperText={errors[name] ?? FIELD_HELP[name]}
      required={extra.required}
      autoFocus={extra.autoFocus}
      fullWidth
      disabled={pending}
      slotProps={{ htmlInput: { maxLength: extra.maxLength } }}
    />
  )

  return (
    <Box component="form" noValidate onSubmit={event => { void handleSubmit(event) }}>
      <DialogTitle id="add-participant-title" sx={{ fontSize: 16, fontWeight: 700 }}>
        Add participant
      </DialogTitle>
      <DialogContent>
        <Typography id="add-participant-intro" variant="body2" sx={{ mb: 2 }}>
          Adds one person to this exercise with a sign-in name, a persona and a personal link.
        </Typography>
        <Stack sx={{ gap: 1.5 }}>
          {field('name', 'Name', { required: true, autoFocus: true, maxLength: 256 })}
          <Stack direction="row" sx={{ gap: 1.5 }}>
            {field('agency', 'Agency', { maxLength: 128 })}
            {field('role', 'Role', { maxLength: 128 })}
          </Stack>
          {field('email', 'Email', { maxLength: 254 })}
          {field('personaHandle', 'Persona handle', { maxLength: 256 })}
          {field('signInName', 'Sign-in name', { maxLength: 64 })}
        </Stack>
        {serverError !== undefined
          ? (
            <Stack
              role="alert"
              direction="row"
              data-testid="add-participant-error"
              sx={{ mt: 1.5, gap: 1, alignItems: 'flex-start', color: 'notifications.errorText' }}
            >
              <Box component="span" sx={{ mt: '2px' }}>
                <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
              </Box>
              <Typography variant="body2">{serverError}</Typography>
            </Stack>
          )
          : null}
      </DialogContent>
      <DialogActions sx={{ padding: '8px 20px 16px', gap: 1 }}>
        <CobraLinkButton type="button" disabled={pending} onClick={onClose}>
          Cancel
        </CobraLinkButton>
        <CobraPrimaryButton
          type="submit"
          disabled={pending}
          startIcon={<FontAwesomeIcon icon={faUserPlus} />}
        >
          {pending ? 'Adding…' : 'Add participant'}
        </CobraPrimaryButton>
      </DialogActions>
    </Box>
  )
}

/** The "Add participant" dialog. See the module header. */
export function AddParticipantDialog({ open, onClose, onAdded }: AddParticipantDialogProps) {
  // The mutation lives HERE, not in the form, so the dialog itself knows a request is
  // in flight: while one is, Escape and a backdrop click do nothing (closing mid-request
  // would leave the person added with no feedback), exactly as Cancel is disabled.
  const mutation = useAddParticipant()
  const pending = mutation.isPending
  return (
    <Dialog
      open={open}
      onClose={pending ? undefined : onClose}
      disableRestoreFocus
      maxWidth="sm"
      fullWidth
      aria-labelledby="add-participant-title"
      aria-describedby="add-participant-intro"
    >
      <AddParticipantForm
        pending={pending}
        submit={row => mutation.mutateAsync(row)}
        onClose={onClose}
        onAdded={onAdded}
      />
    </Dialog>
  )
}
