/**
 * features/orgDirectory/components/InvitePersonDialog.tsx
 * ---------------------------------------------------------------------------
 * "Invite person" dialog (#575b): Email + Display name, submit -> `POST /org/people/invite`.
 * On success the form is replaced by the shared one-time link panel (link shown once, Copy
 * button; the dialog's always-mounted status region speaks the result and the copy outcome). On
 * failure the dialog stays open with the mapped message in a `role="alert"` region with an icon.
 * The directory list refetches via the mutation hook. The link is never logged or stored
 * (mutation `gcTime: 0`). Email is off on UAT so `emailed` is normally false; the copy says which.
 * STAFF world: COBRA components, FontAwesome only, MUI 9 sx-only.
 */

import { useId, useState, type FormEvent } from 'react'
import { Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleExclamation } from '@fortawesome/free-solid-svg-icons'
import { CobraLinkButton, CobraPrimaryButton, CobraTextField } from '@/theme/styledComponents'
import { useInviteOrgPerson } from '../hooks/useOrgPeople'
import { OneTimeLinkPanel } from './OneTimeLinkPanel'
import { copyStatusMessage, useCopyLink } from './useCopyLink'
import { inviteErrorMessage } from './personActions'

const PENDING_SX = { '&[aria-disabled="true"]': { opacity: 0.6, cursor: 'default' } } as const

export interface InvitePersonDialogProps {
  readonly onClose: () => void
  /** Receives the short success sentence for the page's status region. */
  readonly onSuccess?: (message: string) => void
}

export function InvitePersonDialog({ onClose, onSuccess }: InvitePersonDialogProps) {
  const invite = useInviteOrgPerson()
  const titleId = useId()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [validation, setValidation] = useState<string | null>(null)

  const result = invite.data
  const link = result?.inviteUrl
  const copyState = useCopyLink(link)
  const pending = invite.isPending

  const close = () => {
    if (!pending) onClose()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    const trimmedEmail = email.trim()
    const trimmedName = displayName.trim()
    if (trimmedEmail.length === 0 || !trimmedEmail.includes('@')) {
      setValidation(inviteErrorMessage(400, 'invalid-email'))
      return
    }
    if (trimmedName.length === 0) {
      setValidation(inviteErrorMessage(400, 'invalid-display-name'))
      return
    }
    setValidation(null)
    invite.mutate(
      { email: trimmedEmail, displayName: trimmedName },
      { onSuccess: () => onSuccess?.(`Invite link created for ${trimmedName}.`) },
    )
  }

  const errorText =
    validation ?? (invite.error ? inviteErrorMessage(invite.error.status, invite.error.code) : null)
  const status = copyStatusMessage(
    copyState,
    result !== undefined ? `Invite link created for ${displayName.trim()}.` : '',
  )

  return (
    <Dialog
      open
      // Once the link is shown, only Done closes: Escape or a backdrop
      // click would discard the only copy.
      onClose={() => {
        if (link === undefined) close()
      }}
      maxWidth="sm"
      fullWidth
      aria-labelledby={titleId}
      data-testid="invite-person-dialog"
    >
      <DialogTitle id={titleId} sx={{ fontSize: 15, fontWeight: 800 }}>
        Invite person
      </DialogTitle>
      <form onSubmit={submit} noValidate>
        <DialogContent>
          {result === undefined ? (
            <>
              <Typography sx={{ fontSize: 13, lineHeight: 1.5, mb: 1.5 }}>
                Creates a one-time link, shown once, that you copy and give them so they can
                choose a password. Inviting someone who has not set a password yet replaces
                their earlier link.
              </Typography>
              <CobraTextField
                label="Email"
                name="email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={pending}
                required
                fullWidth
                autoFocus
                sx={{ mb: 1.5 }}
              />
              <CobraTextField
                label="Display name"
                name="displayName"
                autoComplete="off"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                disabled={pending}
                required
                fullWidth
              />
            </>
          ) : (
            <>
              <Typography sx={{ fontSize: 13, lineHeight: 1.5 }}>
                {result.emailed ? 'The invite was also emailed. ' : 'No email was sent. '}
                {result.created
                  ? 'They were added to the directory.'
                  : 'They were already in the directory; any earlier invite link no longer works.'}
              </Typography>
              <OneTimeLinkPanel
                link={result.inviteUrl}
                label="Invite link"
                recipientName={displayName.trim()}
                copied={copyState.copied}
                onCopy={() => { void copyState.copy() }}
                testIds={{ panel: 'invite-link-panel', link: 'invite-link', copy: 'copy-invite-link' }}
              />
            </>
          )}

          {/* Always mounted, inside the modal (it hides the page region), so it is announced. */}
          <div role="status" aria-live="polite" data-testid="invite-status">{status}</div>

          <div role="alert" data-testid="invite-error">
            {errorText !== null && (
              <Typography
                component="div"
                sx={{ fontSize: 13, mt: 1.5, display: 'flex', gap: 1, alignItems: 'flex-start' }}
              >
                <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" style={{ marginTop: 3 }} />
                <span>{errorText}</span>
              </Typography>
            )}
          </div>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <CobraLinkButton onClick={close} aria-disabled={pending} sx={PENDING_SX}>
            {result !== undefined ? 'Done' : 'Cancel'}
          </CobraLinkButton>
          {result === undefined && (
            <CobraPrimaryButton
              type="submit"
              aria-disabled={pending}
              aria-busy={pending}
              sx={PENDING_SX}
              data-testid="invite-submit"
            >
              {pending ? 'Working…' : 'Create invite link'}
            </CobraPrimaryButton>
          )}
        </DialogActions>
      </form>
    </Dialog>
  )
}
