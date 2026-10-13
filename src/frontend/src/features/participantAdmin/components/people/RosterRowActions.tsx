/**
 * features/participantAdmin/components/people/RosterRowActions.tsx
 * ---------------------------------------------------------------------------
 * The per-row action buttons of the staff roster (feature: easy-login, story 10;
 * COR-017 — force-logout, credential reset, "wrong account" diagnosis):
 *
 *   Copy link · Reissue link · Revoke link · Disable · Enable  (and Issue link)
 *
 * Which buttons a row offers follows its state:
 *
 *   active link         Copy link, Reissue link, Revoke link, Disable
 *   needs reissue       Reissue link (INSTEAD of Copy: the token is lost), Revoke link, Disable
 *   revoked             Reissue link, Disable
 *   no link ("none")    Issue link, Disable
 *   access disabled     Enable   (the person is off; turn them back on first)
 *
 * Reissue, Revoke and Disable are CONSEQUENTIAL — they end the participant's
 * live sessions (EL-8) — so each sits behind a confirm dialog that says plainly
 * what will happen. Issuing the FIRST link to someone with no link and no live
 * sessions has nothing to lose, so it goes straight through. Enable and Copy
 * never confirm.
 *
 * ## Copy link and the secret
 * The `joinUrl` is a bearer credential. It is read from the list data ALREADY IN
 * MEMORY and handed to the clipboard inside the click handler (Safari allows a
 * clipboard write only during the gesture — gotcha 10, `copyToClipboard`). It is
 * never rendered, never put in the announcement ("Link copied for {name}" has no
 * URL), a toast, a `title`, a log or a URL.
 *
 * ## Keyboard + focus
 * Every action is a real button with an accessible name that includes the person
 * ("Copy link for Dana Whitfield"). After an action completes the list has been
 * refetched; focus returns to the SAME action's button if it still exists
 * (Reissue stays Reissue), otherwise to the row's first remaining action (Disable
 * becomes Enable). Cancelling a confirm returns focus to the button that opened
 * it. MUI's own focus restore is off for the dialog precisely because the
 * trigger may be gone by then.
 *
 * Results (and `sessionsEnded`) are reported UP through `onReport`, to the
 * page's single `aria-live` region; failures of a confirmed action also show
 * inside the dialog so a retry is one click away.
 *
 * World: STAFF. COBRA buttons; FontAwesome only; `sx`-only system props.
 */

import { useEffect, useRef, useState } from 'react'
import { Box } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowsRotate,
  faBan,
  faCircleCheck,
  faCopy,
  faLinkSlash,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons'
import { CobraLinkButton } from '@/theme/styledComponents'
import { useRosterAction } from '../../hooks/useRosterMutations'
import type { RosterError } from '../../services/rosterService'
import type { RosterActionKind, RosterEntryDto } from '../../types'
import { ConfirmActionDialog } from './ConfirmActionDialog'
import { copyToClipboard } from './copyToClipboard'
import {
  actionLabel,
  availableActions,
  confirmText,
  failureMessage,
  needsConfirmation,
  successMessage,
  type RosterActionReport,
  type RowActionId,
} from './rosterActions'

export interface RosterRowActionsProps {
  readonly entry: RosterEntryDto
  readonly onReport: (report: RosterActionReport) => void
}

/** How long to wait for the refreshed row before restoring focus anyway. */
const FOCUS_SETTLE_MS = 250

interface PendingFocus {
  readonly action: RowActionId
  /** Restore once `entry` is a different object than this (the refetched row); `null` = now. */
  readonly awaitUpdateFrom: RosterEntryDto | null
}

const ACTION_ICON: Readonly<Record<RowActionId, IconDefinition>> = {
  copy: faCopy,
  reissue: faArrowsRotate,
  revoke: faLinkSlash,
  disable: faBan,
  enable: faCircleCheck,
}

const BUTTON_SX = {
  padding: '2px 8px',
  minWidth: 0,
  fontSize: 12.5,
  whiteSpace: 'nowrap',
} as const

const DESTRUCTIVE_SX = { ...BUTTON_SX, color: 'notifications.errorText' } as const

/** The action buttons (and confirm dialog) of one roster row. */
export function RosterRowActions({ entry, onReport }: RosterRowActionsProps) {
  const mutation = useRosterAction()
  const groupRef = useRef<HTMLDivElement>(null)

  // `confirm.action` is kept after `open` goes false so the dialog's exit
  // transition keeps its words instead of flashing empty.
  const [confirm, setConfirm] = useState<{ action: RosterActionKind, open: boolean } | null>(null)
  const [dialogError, setDialogError] = useState<string | undefined>(undefined)
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null)

  // Focus is applied in an effect, after the dialog has closed AND the refetched
  // row has rendered, so neither the focus trap nor a stale DOM can win. React
  // Query notifies observers on a later tick than the mutation resolving, so
  // "the mutation finished" is not "the row has re-rendered": wait for `entry`
  // to become a new object (the refetched row), with a short timer as a
  // fallback for a refresh that changed nothing.
  useEffect(() => {
    if (pendingFocus === null) return
    const apply = () => {
      const group = groupRef.current
      const target =
        Array.from(group?.querySelectorAll<HTMLElement>('[data-roster-action]') ?? [])
          .find(element => element.dataset.rosterAction === pendingFocus.action)
        ?? group?.querySelector<HTMLElement>('button')
      target?.focus()
      setPendingFocus(null)
    }
    if (pendingFocus.awaitUpdateFrom === null || entry !== pendingFocus.awaitUpdateFrom) {
      apply()
      return
    }
    const timer = setTimeout(apply, FOCUS_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [pendingFocus, entry])

  const run = async (kind: RosterActionKind, viaDialog: boolean) => {
    try {
      const result = await mutation.mutateAsync({ kind, participantId: entry.id })
      setConfirm(current => (current ? { ...current, open: false } : current))
      setDialogError(undefined)
      onReport({ tone: 'success', message: successMessage(kind, entry.name, result.sessionsEnded) })
      setPendingFocus({ action: kind, awaitUpdateFrom: entry })
    } catch (error) {
      const rosterError = error as RosterError
      const message = failureMessage(rosterError, kind, entry.name)
      if (viaDialog && rosterError.status !== 404) {
        setDialogError(message)
        return
      }
      setConfirm(current => (current ? { ...current, open: false } : current))
      setDialogError(undefined)
      onReport({ tone: 'error', message })
    }
  }

  const handleClick = (action: RowActionId) => {
    if (action === 'copy') {
      // Inside the click handler, with data already in memory (Safari).
      const url = entry.link.joinUrl
      if (url === undefined) return
      void copyToClipboard(url).then(copied => {
        onReport(copied
          ? { tone: 'success', message: `Link copied for ${entry.name}.` }
          : {
            tone: 'error',
            message: `Could not copy the link for ${entry.name}. Your browser blocked clipboard access.`,
          })
      })
      return
    }
    if (needsConfirmation(action, entry)) {
      setDialogError(undefined)
      setConfirm({ action, open: true })
      return
    }
    void run(action, false)
  }

  const handleCancel = () => {
    const action = confirm?.action
    setConfirm(current => (current ? { ...current, open: false } : current))
    setDialogError(undefined)
    if (action !== undefined) setPendingFocus({ action, awaitUpdateFrom: null })
  }

  const dialogText = confirm ? confirmText(confirm.action, entry) : undefined

  return (
    <>
      <Box
        ref={groupRef}
        role="group"
        aria-label={`Actions for ${entry.name}`}
        sx={{ display: 'flex', flexWrap: 'wrap', gap: '2px 4px' }}
      >
        {availableActions(entry).map(action => {
          const label = actionLabel(action, entry)
          const destructive = action === 'revoke' || action === 'disable'
          return (
            <CobraLinkButton
              key={action}
              type="button"
              data-roster-action={action}
              aria-label={action === 'disable' || action === 'enable'
                ? `${label} ${entry.name}`
                : `${label} for ${entry.name}`}
              startIcon={<FontAwesomeIcon icon={ACTION_ICON[action]} />}
              disabled={mutation.isPending}
              sx={destructive ? DESTRUCTIVE_SX : BUTTON_SX}
              onClick={() => handleClick(action)}
            >
              {label}
            </CobraLinkButton>
          )
        })}
      </Box>

      {confirm && dialogText
        ? (
          <ConfirmActionDialog
            open={confirm.open}
            idPrefix={`roster-confirm-${entry.id}`}
            title={dialogText.title}
            body={dialogText.body}
            confirmLabel={dialogText.confirmLabel}
            destructive={confirm.action !== 'reissue'}
            pending={mutation.isPending}
            errorMessage={dialogError}
            onConfirm={() => { void run(confirm.action, true) }}
            onCancel={handleCancel}
          />
        )
        : null}
    </>
  )
}
