/**
 * features/controller/liveWorld/PinForAllAction.tsx
 * ---------------------------------------------------------------------------
 * The controller's **Pin for everyone** / **Unpin** action on a Live world row
 * (story 08, DF-7; the newscast beat: a controller pins a post and it tops every
 * participant's Pinned tab). STAFF world: COBRA link button in the row's own compact
 * style, FontAwesome icon, MUI 9 `sx` only.
 *
 * HOW IT IS MOUNTED. `LiveWorldRow` renders it beside the row's other actions, right
 * before the `renderRowActions` slot (where the console mounts *Take down*). It is not
 * rendered on a taken-down row (the server answers 404 for those).
 *
 * THE FLOW. One click: `PUT /api/staff/posts/{id}/pin` (or `DELETE` to unpin) through
 * `setPinnedForAll`. While in flight the control reads "Pinning…" / "Unpinning…",
 * stays focusable (`aria-disabled`, not `disabled`) and ignores activation. On success
 * the row updates from THIS response at once (`onPinnedChange`), without waiting for
 * the `PostPinChanged` broadcast, which only matters to OTHER consoles. On failure an
 * inline `role="alert"` beside the control shows the plain-text reason (never a
 * swallowed catch) with a Dismiss; the control stays usable to try again. A success is
 * announced through a polite live region ("Pinned for everyone" / "Unpinned"), which
 * exists from the first click so its text change is spoken; untouched rows carry none.
 *
 * The persistent PINNED state is the row's own marker (thumbtack icon AND the words
 * "Pinned for everyone", never colour alone); this control only says what a click does.
 *
 * ROLE. Not gated here: story 11 adds the read-only console's gating line to this file.
 */

import { useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faHourglassHalf,
  faThumbtack,
  faThumbtackSlash,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { CobraLinkButton } from '@/theme/styledComponents'
import type { LiveWorldPost } from './liveWorldModel'
import { liveWorldTokens, monoMeta, srOnly } from './liveWorldStyles'
import { PinForAllError, setPinnedForAll } from './pinForAllService'

export interface PinForAllActionProps {
  /** The row's post; `post.pinnedForAll` is its current state. */
  readonly post: LiveWorldPost
  /** Called once the server accepted a change, with the post's new state. */
  readonly onPinnedChange: (postId: string, pinnedForAll: boolean) => void
}

/** The compact link-button look of the row's other actions ("Reply as…", "Take down"). */
const ROW_BUTTON_SX = {
  minHeight: 0,
  minWidth: 0,
  px: '8px',
  py: '2px',
  borderRadius: '3px',
  fontSize: 11,
  fontWeight: 700,
  fontFamily: liveWorldTokens.mono,
  gap: '5px',
  '&.Mui-focusVisible, &:focus-visible': {
    outline: `2px solid ${liveWorldTokens.focus}`,
    outlineOffset: '1px',
  },
  '&[aria-disabled="true"]': { cursor: 'default', opacity: 0.7 },
} as const

/** The plain-text reason for any thrown value. */
function failureOf(error: unknown, pin: boolean): string {
  return error instanceof PinForAllError
    ? error.message
    : `The post was not ${pin ? 'pinned' : 'unpinned'}. Try again.`
}

/** The row's Pin for everyone / Unpin control. See the module header. */
export function PinForAllAction({ post, onPinnedChange }: PinForAllActionProps) {
  const pinned = post.pinnedForAll === true
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  // `null` until the first click: the live region mounts then, BEFORE its text changes.
  const [announcement, setAnnouncement] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const authorName = post.authorDisplayName

  function toggle(): void {
    if (pending) return
    const next = !pinned
    setPending(true)
    setFailure(undefined)
    setAnnouncement('')
    setPinnedForAll(post.id, next).then(
      () => {
        setPending(false)
        setAnnouncement(next ? 'Pinned for everyone' : 'Unpinned')
        onPinnedChange(post.id, next)
      },
      (error: unknown) => {
        setPending(false)
        setFailure(failureOf(error, next))
      },
    )
  }

  function dismiss(): void {
    setFailure(undefined)
    triggerRef.current?.focus()
  }

  const label = pending
    ? (pinned ? 'Unpinning…' : 'Pinning…')
    : (pinned ? 'Unpin' : 'Pin for everyone')

  return (
    <>
      <CobraLinkButton
        ref={triggerRef}
        size="small"
        data-testid="live-world-pin"
        aria-disabled={pending}
        aria-label={`${label}: the post by ${authorName}`}
        title={pinned ? 'Unpin this post for everyone' : 'Pin this post for everyone'}
        onClick={toggle}
        sx={ROW_BUTTON_SX}
      >
        <FontAwesomeIcon
          icon={pending ? faHourglassHalf : pinned ? faThumbtackSlash : faThumbtack}
          aria-hidden="true"
        />
        {label}
      </CobraLinkButton>
      {failure !== undefined && (
        <Box
          role="alert"
          data-testid="live-world-pin-failure"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '6px',
            maxWidth: '100%',
            pl: '8px',
            pr: '2px',
            py: '1px',
            border: `1px solid ${liveWorldTokens.danger}`,
            borderRadius: '3px',
          }}
        >
          <FontAwesomeIcon
            icon={faTriangleExclamation}
            color={liveWorldTokens.danger}
            aria-hidden="true"
          />
          <Typography
            component="span"
            data-testid="live-world-pin-failure-message"
            sx={{ ...monoMeta, color: liveWorldTokens.ink, fontWeight: 700 }}
          >
            {failure}
          </Typography>
          <CobraLinkButton
            size="small"
            data-testid="live-world-pin-dismiss"
            aria-label="Dismiss the pin error"
            onClick={dismiss}
            sx={ROW_BUTTON_SX}
          >
            <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
            Dismiss
          </CobraLinkButton>
        </Box>
      )}
      {announcement !== null && (
        <Box
          role="status"
          aria-live="polite"
          data-testid="live-world-pin-announcer"
          sx={srOnly}
        >
          {announcement}
        </Box>
      )}
    </>
  )
}
