/**
 * features/participantAdmin/email/EmailLinksButton.tsx
 * ---------------------------------------------------------------------------
 * "Email links" on the staff roster (easy-login story 13; COR-017 in part,
 * NFR-001). `ParticipantAdminSurface.tsx` mounts it into the roster's email slot:
 *
 *     renderEmailAction={selection => <EmailLinksButton selection={selection} />}
 *
 * DARK UNTIL CONFIGURED. It renders NOTHING unless the roster the screen already
 * loaded reports `capabilities.emailLinks: true` (read passively, see
 * `useRosterSnapshot`; no extra request). So with email unconfigured on the server
 * there is no button, and nothing to explain.
 *
 * WHAT IT DOES
 *   1. A COBRA button: "Email links (N)" for N selected people, or "Email all links"
 *      with nothing selected (every eligible participant, the server's `{}`). A
 *      selection of only blank ids is "(0)" and disabled, never widened to everyone.
 *      It is also disabled while the roster reports `joinLinksAvailable: false`: with no
 *      site address there is no link to email, the server would answer 503, and the
 *      roster's own banner already says why (S-2).
 *   2. A confirm step (`role="alertdialog"`, focus on Cancel): the story's sentence,
 *      verbatim ("This emails each person a personal sign-in link. An emailed link
 *      can't be recalled; reissue it to cancel it."), and how many of the people the
 *      roster says can be emailed. Over 100 people it explains the cap and offers no
 *      send. The selection is SNAPSHOTTED when the button is pressed.
 *   3. `POST /staff/roster/email-links` once (no chunking, no automatic retry).
 *   4. A result summary in an `aria-live` region: counts by status (sent / skipped /
 *      failed, each text plus icon, never colour alone) and, for skipped and failed,
 *      the reasons with the people's names from the roster.
 *   5. "Send again to the N not sent": re-posts ONLY the ids KNOWN not to have been
 *      sent and fixed by waiting (rate-limited, not attempted in time) as
 *      `{ participantIds }`. Never a skipped or a sent person, never a refused one
 *      (`sendFailed`: it would most likely be refused again), and never a timed-out one
 *      (`timedOut`: it may have been accepted, and the summary says to check first), so
 *      nobody is emailed twice by it. The new result replaces the summary. The confirm
 *      already given covers these same people.
 *   Closing returns focus to the button.
 *
 * SECRETS. Nothing here reads, shows or logs a join URL or an email address: the
 * response carries ids and fixed reasons, and names come from the roster rows.
 *
 * World: STAFF. COBRA buttons (`@/theme/styledComponents`), MUI `Dialog` under the
 * COBRA theme the staff frame mounts, FontAwesome only, `sx` only.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleCheck,
  faCircleMinus,
  faEnvelope,
  faSpinner,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  CobraLinkButton,
  CobraPrimaryButton,
  CobraSecondaryButton,
} from '@/theme/styledComponents'
import type { RosterEntryDto } from '../types'
import {
  EMAIL_LINKS_WARNING,
  MAX_EMAILS_PER_REQUEST,
  consideredEntries,
  emailLinksLabel,
  looksEmailable,
  people,
  summarizeResult,
  unsentIds,
  usableIds,
  type EmailLinksSummary,
} from './emailLinksFormat'
import { EmailLinksError, sendEmailLinks } from './emailLinksService'
import type { RosterEmailResultDto } from './types'
import { useRosterSnapshot } from './useRosterSnapshot'

export interface EmailLinksButtonProps {
  /**
   * The selected participants' account ids (`RosterEntryDto.id`).
   * Empty = every eligible participant.
   */
  selection: readonly string[]
}

/** One count line of the summary: icon + text, so the status never rests on colour. */
function CountLine({ icon, text, color }: { icon: IconDefinition, text: string, color: string }) {
  return (
    <Stack direction="row" sx={{ gap: 1, alignItems: 'center', color }}>
      <FontAwesomeIcon icon={icon} aria-hidden fixedWidth />
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {text}
      </Typography>
    </Stack>
  )
}

/** The result: counts by status, then who was skipped or failed and why. */
function ResultSummary({
  summary,
  nameOf,
}: {
  summary: EmailLinksSummary
  nameOf: (participantId: string) => string
}) {
  return (
    <Stack sx={{ gap: 1 }} data-testid="email-links-summary">
      <CountLine icon={faCircleCheck} color="success.main" text={`Sent: ${people(summary.sent)}`} />
      <CountLine icon={faCircleMinus} color="text.secondary" text={`Skipped: ${people(summary.skipped)}`} />
      <CountLine
        icon={faTriangleExclamation}
        color={summary.failed > 0 ? 'notifications.errorText' : 'text.secondary'}
        text={`Failed: ${people(summary.failed)}`}
      />
      {summary.groups.length > 0
        ? (
          <Box component="ul" sx={{ margin: 0, paddingLeft: '20px' }} aria-label="Not emailed">
            {summary.groups.map(group => (
              <Box component="li" key={`${group.status}:${group.reason}`} sx={{ mb: 0.5 }}>
                <Typography variant="body2">
                  <strong>{group.status === 'failed' ? 'Failed' : 'Skipped'}, {group.text}:</strong>{' '}
                  {group.participantIds.map(nameOf).join(', ')}
                </Typography>
              </Box>
            ))}
          </Box>
        )
        : null}
    </Stack>
  )
}

export function EmailLinksButton({ selection }: EmailLinksButtonProps) {
  const roster = useRosterSnapshot()
  const titleId = useId()
  const bodyId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const wasOpenRef = useRef(false)

  // `null` = closed; otherwise the ids the dialog was opened for (empty = everyone eligible).
  const [openFor, setOpenFor] = useState<readonly string[] | null>(null)
  // Whether this dialog's last send went through (or is in flight): the "who would be emailed"
  // estimate then gives way to the results. A request-level error clears it, so the retry's
  // confirm shows who would be emailed again.
  const [sentOnce, setSentOnce] = useState(false)
  const isOpen = openFor !== null

  const mutation = useMutation<RosterEmailResultDto, EmailLinksError, readonly string[]>({
    mutationFn: ids => sendEmailLinks(ids),
  })
  const { reset } = mutation

  const entries: readonly RosterEntryDto[] = useMemo(() => roster?.participants ?? [], [roster])
  const usable = usableIds(selection)
  const nothingUsable = selection.length > 0 && usable.length === 0

  const open = useCallback(() => {
    reset()
    setSentOnce(false)
    setOpenFor(usableIds(selection))
  }, [reset, selection])
  const close = useCallback(() => setOpenFor(null), [])

  // Return focus to the button once the dialog has closed.
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true
      return
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false
      buttonRef.current?.focus()
    }
  }, [isOpen])

  // When the result arrives, the confirm buttons are gone: put focus on Close.
  useEffect(() => {
    if (mutation.isSuccess) closeRef.current?.focus()
  }, [mutation.isSuccess])

  // Dark until configured: no capability, no button (and no dialog). After every hook.
  if (roster?.capabilities.emailLinks !== true) return null

  const considered = openFor === null ? [] : consideredEntries(entries, openFor)
  const emailable = considered.filter(looksEmailable).length
  const everyone = openFor !== null && openFor.length === 0
  const requested = everyone ? emailable : (openFor?.length ?? 0)
  const overCap = requested > MAX_EMAILS_PER_REQUEST
  const pending = mutation.isPending
  const done = mutation.isSuccess
  const unsent = done ? unsentIds(mutation.data) : []
  const joinLinksOff = roster.joinLinksAvailable === false

  const send = (ids: readonly string[]) => {
    setSentOnce(true)
    mutation.mutate(ids, { onError: () => setSentOnce(false) })
  }

  // Re-posts only the people who were not sent an email; the snapshot becomes them.
  const sendAgain = () => {
    setOpenFor(unsent)
    send(unsent)
  }

  const nameById = new Map(entries.map(entry => [entry.id, entry.name]))
  const nameOf = (participantId: string) => nameById.get(participantId) ?? 'A participant not on this roster'

  const scopeLine = everyone
    ? `Everyone on the roster who can be emailed: ${people(emailable)} with an email address and an active link.`
    : `${people(requested)} selected; ${emailable} of them ${emailable === 1 ? 'has' : 'have'} an email address and an active link. Anyone else is skipped.`

  return (
    <>
      <CobraSecondaryButton
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        disabled={nothingUsable || joinLinksOff}
        startIcon={<FontAwesomeIcon icon={faEnvelope} />}
        onClick={open}
      >
        {emailLinksLabel(selection)}
      </CobraSecondaryButton>

      <Dialog
        open={isOpen}
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        disableRestoreFocus
        maxWidth="sm"
        fullWidth
        onClose={(_event, reason) => {
          // An alert dialog is answered deliberately: Escape closes it, a backdrop click does not.
          if (reason === 'escapeKeyDown' && !pending) close()
        }}
      >
        <DialogTitle id={titleId} sx={{ fontSize: 16, fontWeight: 700 }}>
          {done ? 'Email links: result' : 'Email personal sign-in links?'}
        </DialogTitle>
        <DialogContent>
          <Stack id={bodyId} sx={{ gap: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {EMAIL_LINKS_WARNING}
            </Typography>
            {sentOnce
              ? null
              : (
                <Typography variant="body2" data-testid="email-links-scope">
                  {scopeLine}
                </Typography>
              )}
            {overCap && !sentOnce
              ? (
                <Typography variant="body2" data-testid="email-links-over-cap">
                  Email goes to at most {MAX_EMAILS_PER_REQUEST} people at a time. Select{' '}
                  {MAX_EMAILS_PER_REQUEST} or fewer people on the roster and try again.
                </Typography>
              )
              : null}
          </Stack>

          {/* One persistent live region: "Sending…", then the summary, announced once each. */}
          <Box role="status" aria-live="polite" data-testid="email-links-status" sx={{ mt: 1.5 }}>
            {pending
              ? (
                <Stack direction="row" sx={{ gap: 1, alignItems: 'center', color: 'text.secondary' }}>
                  <FontAwesomeIcon icon={faSpinner} spin aria-hidden />
                  <Typography variant="body2">
                    Sending, one email at a time. This can take a minute or two.
                  </Typography>
                </Stack>
              )
              : null}
            {done
              ? <ResultSummary summary={summarizeResult(mutation.data)} nameOf={nameOf} />
              : null}
          </Box>

          <Box role="alert" data-testid="email-links-error">
            {mutation.isError
              ? (
                <Stack direction="row" sx={{ mt: 1.5, gap: 1, alignItems: 'flex-start', color: 'notifications.errorText' }}>
                  <Box component="span" sx={{ mt: '2px' }}>
                    <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
                  </Box>
                  <Typography variant="body2">{mutation.error.message}</Typography>
                </Stack>
              )
              : null}
          </Box>
        </DialogContent>
        <DialogActions sx={{ padding: '8px 20px 16px', gap: 1 }}>
          {done
            ? (
              <>
                {unsent.length > 0
                  ? (
                    <CobraSecondaryButton
                      type="button"
                      startIcon={<FontAwesomeIcon icon={faEnvelope} />}
                      onClick={sendAgain}
                    >
                      Send again to the {unsent.length} not sent
                    </CobraSecondaryButton>
                  )
                  : null}
                <CobraPrimaryButton ref={closeRef} type="button" onClick={close}>
                  Close
                </CobraPrimaryButton>
              </>
            )
            : (
              <>
                <CobraLinkButton type="button" autoFocus disabled={pending} onClick={close}>
                  {overCap ? 'Close' : 'Cancel'}
                </CobraLinkButton>
                {overCap
                  ? null
                  : (
                    <CobraPrimaryButton
                      type="button"
                      disabled={pending}
                      startIcon={<FontAwesomeIcon icon={faEnvelope} />}
                      onClick={() => { if (openFor !== null) send(openFor) }}
                    >
                      {pending ? 'Sending…' : 'Send emails'}
                    </CobraPrimaryButton>
                  )}
              </>
            )}
        </DialogActions>
      </Dialog>
    </>
  )
}
