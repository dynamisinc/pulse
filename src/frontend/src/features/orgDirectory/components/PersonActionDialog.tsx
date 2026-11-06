/**
 * features/orgDirectory/components/PersonActionDialog.tsx
 * ---------------------------------------------------------------------------
 * One confirm dialog for all five per-person actions (grant/revoke org admin, disable/enable, copy
 * password-reset link). Cancel has initial focus. A failure keeps the dialog open and says why in a
 * `role="alert"` region with an icon (409 mapping in `personActions.ts`); the list refetches either
 * way. For the reset action the confirm creates the link and the dialog then shows it with a Copy
 * button (the link is shown once and never stored). Pending: aria-disabled controls, Esc ignored.
 * SUCCESS is reported up through `onSuccess(message)` so the page's polite status region announces
 * it (W-003). The reset link keeps the dialog open, and a modal hides the page from assistive tech,
 * so that success is ALSO spoken by the dialog's own always-mounted status region. Removing your
 * own org admin shows an extra "you will be signed out" line (S4).
 * STAFF world: COBRA components, FontAwesome only, MUI 9 sx-only.
 */

import { useId, useState } from 'react'
import { Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faCircleExclamation, faCopy } from '@fortawesome/free-solid-svg-icons'
import { CobraLinkButton, CobraPrimaryButton, CobraSecondaryButton } from '@/theme/styledComponents'
import { useIssuePasswordReset, useUpdateOrgPerson } from '../hooks/useOrgPeople'
import type { OrgPeopleError } from '../services/orgPeopleService'
import type { OrgPerson } from '../types'
import {
  actionBody,
  actionConfirmLabel,
  actionTitle,
  errorMessage,
  patchFor,
  SELF_REVOKE_NOTE,
  successMessage,
  type PersonActionKind,
} from './personActions'

const PENDING_SX = { '&[aria-disabled="true"]': { opacity: 0.6, cursor: 'default' } } as const

export interface PersonActionDialogProps {
  readonly person: OrgPerson
  readonly kind: PersonActionKind
  /** True when `person` is the signed-in caller (adds the self sign-out line to Remove admin). */
  readonly isSelf?: boolean
  readonly onClose: () => void
  /** Receives the short success sentence for the page's status region. */
  readonly onSuccess?: (message: string) => void
}

export function PersonActionDialog({
  person,
  kind,
  isSelf = false,
  onClose,
  onSuccess,
}: PersonActionDialogProps) {
  const update = useUpdateOrgPerson()
  const reset = useIssuePasswordReset()
  const titleId = useId()
  const bodyId = useId()
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  const pending = update.isPending || reset.isPending
  const error: OrgPeopleError | null = update.error ?? reset.error
  const link = reset.data

  const close = () => {
    if (!pending) onClose()
  }

  const confirm = () => {
    if (pending) return
    const patch = patchFor(kind)
    const announce = () => onSuccess?.(successMessage(kind, person.displayName))
    if (patch === null) reset.mutate(person.id, { onSuccess: announce })
    else {
      update.mutate({ personId: person.id, patch }, {
        onSuccess: () => {
          announce()
          onClose()
        },
      })
    }
  }

  const dialogStatus = copied
    ? 'Link copied to the clipboard.'
    : copyFailed
      ? 'Could not copy automatically. Select the link and copy it.'
      : link !== undefined
        ? successMessage('resetPassword', person.displayName)
        : ''

  const copy = async () => {
    if (link === undefined) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setCopyFailed(false)
    } catch {
      setCopied(false)
      setCopyFailed(true)
    }
  }

  return (
    <Dialog
      open
      onClose={close}
      maxWidth="sm"
      fullWidth
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-testid="person-action-dialog"
    >
      <DialogTitle id={titleId} sx={{ fontSize: 15, fontWeight: 800 }}>
        {actionTitle(kind)}
      </DialogTitle>
      <DialogContent>
        <Typography id={bodyId} component="div" sx={{ fontSize: 13, lineHeight: 1.5 }}>
          <strong data-testid="person-action-name">{person.displayName}</strong>{' '}
          {actionBody(kind)}
        </Typography>
        {kind === 'revokeAdmin' && isSelf && (
          <Typography
            data-testid="person-action-self-note"
            sx={{ fontSize: 13, lineHeight: 1.5, mt: 1, fontWeight: 700 }}
          >
            {SELF_REVOKE_NOTE}
          </Typography>
        )}

        {link !== undefined && (
          <div data-testid="reset-link-panel" style={{ marginTop: 12 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
              Reset link (shown once; give it to {person.displayName} directly)
            </Typography>
            <Typography
              component="code"
              data-testid="reset-link"
              sx={{ display: 'block', fontSize: 12, wordBreak: 'break-all', mt: 0.5 }}
            >
              {link}
            </Typography>
            <CobraSecondaryButton
              type="button"
              size="small"
              onClick={() => { void copy() }}
              startIcon={<FontAwesomeIcon icon={copied ? faCheck : faCopy} aria-hidden="true" />}
              sx={{ mt: 1 }}
              data-testid="copy-reset-link"
            >
              {copied ? 'Copied' : 'Copy link'}
            </CobraSecondaryButton>
          </div>
        )}

        {/* Always mounted, inside the modal (it hides the page region), so it is announced. */}
        <div role="status" aria-live="polite" data-testid="copy-status">{dialogStatus}</div>

        {/* Always mounted so a screen reader announces the text when it appears. */}
        <div role="alert" data-testid="person-action-error">
          {error !== null && (
            <Typography
              component="div"
              sx={{ fontSize: 13, mt: 1.5, display: 'flex', gap: 1, alignItems: 'flex-start' }}
            >
              <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" style={{ marginTop: 3 }} />
              <span>
                <strong>Nothing was changed.</strong> {errorMessage(error.status, error.code)}
              </span>
            </Typography>
          )}
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <CobraLinkButton onClick={close} aria-disabled={pending} sx={PENDING_SX} autoFocus>
          {link !== undefined ? 'Done' : 'Cancel'}
        </CobraLinkButton>
        {link === undefined && (
          <CobraPrimaryButton
            onClick={confirm}
            aria-disabled={pending}
            aria-busy={pending}
            sx={PENDING_SX}
            data-testid="person-action-confirm"
          >
            {pending ? 'Working…' : actionConfirmLabel(kind)}
          </CobraPrimaryButton>
        )}
      </DialogActions>
    </Dialog>
  )
}
