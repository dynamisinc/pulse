/**
 * features/orgDirectory/components/InvitePersonDialog.tsx
 * ---------------------------------------------------------------------------
 * The invite dialog, in three modes:
 *   - "Invite person" (#575b): Email + Display name -> `POST /org/people/invite` (a new person, or
 *     the one already holding that email).
 *   - Row "Invite" (#849, a `person` with no email): Email only -> `POST /org/people/{id}/invite`,
 *     which saves the email on that existing person (no duplicate). The admin is asked to
 *     double-check the address, because it becomes the person's sign-in email.
 *   - Row "Resend invite" (#862, a `person` whose email is on file but who has no password yet):
 *     no input; the same by-id route with the stored email issues a fresh link.
 * On success the form is replaced by the shared one-time link panel (link shown once, Copy
 * button). When a mailer is configured, the by-id route emails the link only and returns no link
 * (`inviteUrl: null`, the CR-001 rule): the dialog then says whether the email went out. On
 * failure the dialog stays open with the mapped message in a `role="alert"` region with an icon.
 * The directory list refetches via the mutation hooks. The link is never logged or stored
 * (mutation `gcTime: 0`). STAFF world: COBRA components, FontAwesome only, MUI 9 sx-only.
 */

import { useId, useState, type FormEvent } from 'react'
import { Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleExclamation } from '@fortawesome/free-solid-svg-icons'
import { CobraLinkButton, CobraPrimaryButton, CobraTextField } from '@/theme/styledComponents'
import { useInviteExistingOrgPerson, useInviteOrgPerson } from '../hooks/useOrgPeople'
import type { OrgInviteResult } from '../types'
import { OneTimeLinkPanel } from './OneTimeLinkPanel'
import { copyStatusMessage, useCopyLink } from './useCopyLink'
import { inviteErrorMessage } from './personActions'

const PENDING_SX = { '&[aria-disabled="true"]': { opacity: 0.6, cursor: 'default' } } as const
const TEXT_SX = { fontSize: 13, lineHeight: 1.5 } as const

export interface InvitePersonDialogProps {
  readonly onClose: () => void
  /** Receives the short success sentence for the page's status region. */
  readonly onSuccess?: (message: string) => void
  /**
   * An EXISTING directory person (the row actions). With `email: null` the dialog asks for the
   * email (#849); with an email on file it re-sends to that address (#862). Omitted = a new person.
   */
  readonly person?: {
    readonly id: string
    readonly displayName: string
    readonly email: string | null
  }
}

function resultSentence(result: OrgInviteResult, existing: boolean, email: string): string {
  if (result.inviteUrl === null) {
    return result.emailed
      ? `The invite was emailed to ${email}. Any earlier invite link no longer works.`
      : 'The invite email could not be sent, and no link was created for you to copy. Close this and try again.'
  }
  const sent = result.emailed ? 'The invite was also emailed. ' : 'No email was sent. '
  if (existing) {
    return `${sent}Their email is on file and they keep their exercises; any earlier invite link no longer works.`
  }
  return result.created
    ? `${sent}They were added to the directory.`
    : `${sent}They were already in the directory; any earlier invite link no longer works.`
}

export function InvitePersonDialog({ onClose, onSuccess, person }: InvitePersonDialogProps) {
  const inviteNew = useInviteOrgPerson()
  const inviteExisting = useInviteExistingOrgPerson()
  const existing = person !== undefined
  const resend = existing && person.email !== null
  const invite = existing ? inviteExisting : inviteNew
  const titleId = useId()
  const [email, setEmail] = useState(person?.email ?? '')
  const [displayName, setDisplayName] = useState(person?.displayName ?? '')
  const [validation, setValidation] = useState<string | null>(null)

  const result = invite.data
  const link = result?.inviteUrl ?? undefined
  const copyState = useCopyLink(link)
  const pending = invite.isPending
  const name = existing ? person.displayName : displayName.trim()

  const close = () => {
    if (!pending) onClose()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    const trimmedEmail = email.trim()
    if (trimmedEmail.length === 0 || !trimmedEmail.includes('@')) {
      setValidation(inviteErrorMessage(400, 'invalid-email'))
      return
    }
    // The display name is asked for (and validated) only for a NEW person.
    if (!existing && displayName.trim().length === 0) {
      setValidation(inviteErrorMessage(400, 'invalid-display-name'))
      return
    }
    setValidation(null)
    const announce = {
      onSuccess: (done: OrgInviteResult) => onSuccess?.(
        done.inviteUrl === null
          ? (done.emailed ? `Invite emailed to ${name}.` : `The invite email to ${name} could not be sent.`)
          : `Invite link created for ${name}.`,
      ),
    }
    if (existing) {
      inviteExisting.mutate({ personId: person.id, email: trimmedEmail }, announce)
    } else {
      inviteNew.mutate({ email: trimmedEmail, displayName: displayName.trim() }, announce)
    }
  }

  const errorText =
    validation ?? (invite.error ? inviteErrorMessage(invite.error.status, invite.error.code) : null)
  const status = copyStatusMessage(
    copyState,
    result === undefined
      ? ''
      : result.inviteUrl === null
        ? resultSentence(result, existing, email.trim())
        : `Invite link created for ${name}.`,
  )

  const title = !existing
    ? 'Invite person'
    : resend ? `Resend invite to ${person.displayName}` : `Invite ${person.displayName}`

  let intro: string
  if (!existing) {
    intro = 'Creates a one-time link, shown once, that you copy and give them so they can '
      + 'choose a password. Inviting someone who has not set a password yet replaces '
      + 'their earlier link.'
  } else if (resend) {
    intro = `${person.displayName} has not set a password yet. This creates a new one-time invite `
      + `for ${person.email ?? ''}, and their earlier invite link stops working.`
  } else {
    intro = `${person.displayName} has no email on file. Enter their email: it is saved on `
      + 'their account, and a one-time invite is created so they can choose a password. '
      + 'They keep their exercises.'
  }

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
        {title}
      </DialogTitle>
      <form onSubmit={submit} noValidate>
        <DialogContent>
          {result === undefined ? (
            <>
              <Typography sx={{ ...TEXT_SX, mb: 1.5 }}>{intro}</Typography>
              {existing && !resend && (
                <Typography data-testid="invite-check-address" sx={{ ...TEXT_SX, mb: 1.5, fontWeight: 700 }}>
                  Check the address carefully: it becomes {person.displayName}&apos;s sign-in email.
                </Typography>
              )}
              {!resend && (
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
              )}
              {!existing && (
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
              )}
            </>
          ) : (
            <>
              <Typography data-testid="invite-result" sx={TEXT_SX}>
                {resultSentence(result, existing, email.trim())}
              </Typography>
              {result.inviteUrl !== null && (
                <OneTimeLinkPanel
                  link={result.inviteUrl}
                  label="Invite link"
                  recipientName={name}
                  copied={copyState.copied}
                  onCopy={() => { void copyState.copy() }}
                  testIds={{ panel: 'invite-link-panel', link: 'invite-link', copy: 'copy-invite-link' }}
                />
              )}
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
              {pending ? 'Working…' : resend ? 'Send new invite' : 'Create invite link'}
            </CobraPrimaryButton>
          )}
        </DialogActions>
      </form>
    </Dialog>
  )
}
