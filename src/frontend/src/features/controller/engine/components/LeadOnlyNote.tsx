/**
 * features/controller/engine/components/LeadOnlyNote.tsx
 * ---------------------------------------------------------------------------
 * The compact "only the lead controller can do this" note (story 17 lead gate; #787). STAFF
 * world — COBRA operator chrome, FontAwesome icons only, MUI 9 `sx`-only system props.
 *
 * It lives in the console's command band, which must stay ONE row at 1180px for every
 * controller (story 12/16; `controller-tablet.spec.ts`). The full sentence inline made a
 * non-lead's band wrap, pushing End exercise to a second row (#787). So the note shows a
 * short label next to a lock icon, and carries the full reason for everyone else:
 *  - assistive tech: the reason is visually-hidden TEXT inside the note, so a control that
 *    points `aria-describedby` at the note's `id` is described by the full sentence (the
 *    short label and the icon are `aria-hidden`, so they are not read twice);
 *  - sighted users: the full sentence is the native `title` tooltip.
 * Never colour alone (NFR-001): the visible label is text, and the lock is an icon.
 *
 * The ref is forwarded and the note takes `tabIndex={-1}`, so a caller can move focus to it
 * (SwampedModeToggle does, after a non-lead turns swamped mode off).
 */
import { forwardRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faLock } from '@fortawesome/free-solid-svg-icons'
import { Box, Stack } from '@mui/material'
import { consoleChrome as chrome } from '../../consoleChrome'

/** Hides content visually while keeping it in the accessibility tree. */
const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const

export interface LeadOnlyNoteProps {
  /** The element id a control's `aria-describedby` points at (optional). */
  readonly id?: string
  readonly testId: string
  /** The short visible label, e.g. "Swamped: lead only". */
  readonly label: string
  /** The full reason: read by assistive tech and shown as the tooltip. */
  readonly reason: string
  /** Lets a caller move focus to the note. */
  readonly focusable?: boolean
}

export const LeadOnlyNote = forwardRef<HTMLDivElement, LeadOnlyNoteProps>(function LeadOnlyNote(
  { id, testId, label, reason, focusable = false },
  ref,
) {
  return (
    <Stack
      ref={ref}
      id={id}
      data-testid={testId}
      direction="row"
      title={reason}
      tabIndex={focusable ? -1 : undefined}
      sx={{
        position: 'relative',
        alignItems: 'center',
        gap: 0.6,
        fontSize: 10.5,
        color: chrome.inkMuted,
        whiteSpace: 'nowrap',
      }}
    >
      <FontAwesomeIcon icon={faLock} aria-hidden="true" />
      <span aria-hidden="true">{label}</span>
      <Box component="span" sx={VISUALLY_HIDDEN}>
        {reason}
      </Box>
    </Stack>
  )
})
