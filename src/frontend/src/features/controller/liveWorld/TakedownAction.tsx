/**
 * features/controller/liveWorld/TakedownAction.tsx
 * ---------------------------------------------------------------------------
 * The controller's **Take down** action on a Live world row (demo-polish C5,
 * docs/features/demo-polish/22-takedown-ui.md; CTL-025, CTL-033, XC-004, DP-9, NFR-001).
 * STAFF world: COBRA controls (`@/theme/styledComponents`), dense, keyboard-first, FontAwesome
 * only, MUI 9 `sx` only — unmistakably the machine, never a participant surface.
 *
 * HOW IT IS MOUNTED. It is NOT imported by the column. The orchestrator mounts it through C2's
 * `renderRowActions` slot (implementation.md §4.2):
 *
 *     <LiveWorldColumn renderRowActions={post => <TakedownAction post={post} />} ... />
 *
 * The slot renders at the end of each row's bottom line, keyed by the post's id with a stable
 * object identity, so this component's state (an open confirm step, an in-flight request, a
 * failure) survives the column's re-renders.
 *
 * THE FLOW — two clicks, fully keyboard-operable.
 *   1. **Take down** opens a small confirm popover: a four-way category radio group
 *      (Inappropriate · PII · Real-world reference · Other, default **Other**) and
 *      **Confirm take down** / **Cancel**.
 *   2. **Confirm take down** closes the popover and calls `DELETE /api/staff/posts/{id}?category=`
 *      (`takedownService`). Nothing is sent until that second click.
 *   Keyboard: Enter/Space on Take down opens the step with focus on the selected category;
 *   Arrow keys change it; Tab/Shift+Tab cycle category -> Confirm -> Cancel and wrap; Esc cancels;
 *   on any close focus returns to the Take down control. The step is portalled (the column
 *   ignores J/K/R/N for keys that originate outside its list DOM or in a form field), and an
 *   irreversible action always costs the deliberate second activation.
 *
 * OUTCOMES (never colour alone — NFR-001: every state is an icon AND text).
 *   - pending  the control stays in place, reads "Taking down…" and ignores activation
 *              (`aria-disabled`, still focusable, so focus is not lost mid-request);
 *   - success  the control is replaced by a **Removed** marker (ban icon + "Removed"): the row
 *              stays for the record and nothing actionable remains here, so a repeat is
 *              impossible from this row (and harmless anywhere else — the endpoint is
 *              idempotent). Focus moves to the marker once, if THIS action caused it. The
 *              marker also appears when ANOTHER controller's takedown reaches this tab, or when
 *              the row remounts after a filter change — "removed" is read from the session's
 *              `removedPosts` store, not from component state;
 *   - failure  an alert with the server's plain-text message, **Retry** (re-sends the category
 *              the controller already confirmed) and **Dismiss**; focus moves to Retry.
 *
 * ABSENT, NOT DISABLED, FOR NON-CONTROLLERS (CTL-033): when the controller-identity seam's role is
 * not `controller` the component renders nothing at all. (The backend refuses anyone else too.)
 *
 * FOCUS-TRAP CONTRACT (F2, `core/a11y/modalPriority`). The confirm step is a modal dialog with its
 * own small trap (initial focus, Tab wrap, pull-back of a focus that strays outside). Every part
 * of that trap STANDS ASIDE while any other `[aria-modal="true"]` element is mounted
 * (`hasOtherModalMounted`): no focus on open, no Tab wrap, no document-level pull-back. MUI's own
 * focus management is switched off for the same reason (it would fight the shell overlay), as are
 * its scroll lock and transitions (a dense console does not want a jump or a fade for a popover).
 *
 * TELEMETRY. None here. `useTakedown` emits the one XC-004 `steering_action` per successful
 * takedown (the server emits none, DP-9), so this folder never needs the exercise scope.
 */

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react'
import { Box, FormControlLabel, Popover, Radio, RadioGroup, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBan,
  faHourglassHalf,
  faRotateRight,
  faTrashCan,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { hasOtherModalMounted } from '@/core/a11y/modalPriority'
import {
  CobraDeleteButton,
  CobraLinkButton,
  CobraSecondaryButton,
} from '@/theme/styledComponents'
import { useTakedown } from '../hooks/useTakedown'
import { useControllerIdentity } from '../identity/controllerIdentity'
import {
  DEFAULT_TAKEDOWN_CATEGORY,
  TAKEDOWN_CATEGORIES,
  isTakedownCategory,
  type TakedownCategory,
} from '../services/takedownService'
import type { LiveWorldPost } from './liveWorldModel'
import { liveWorldTokens, monoMeta } from './liveWorldStyles'

export interface TakedownActionProps {
  /** The row's post, as C2's `renderRowActions` hands it over. */
  readonly post: LiveWorldPost
}

/** The compact link-button look the row's "Reply as…" uses, so the two read as one family. */
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
} as const

/** Tabbable descendants, in DOM order; only the CHECKED radio of a group is a Tab stop. */
function tabbableIn(container: HTMLElement): HTMLElement[] {
  const found = container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  return Array.from(found).filter(
    element => !(element instanceof HTMLInputElement && element.type === 'radio' && !element.checked),
  )
}

interface ConfirmPanelProps {
  /** The dialog element, owned by the caller so it can tell "another modal" from this one. */
  readonly panelRef: RefObject<HTMLDivElement | null>
  /**
   * True from the moment the caller starts closing the step. The dialog stays in the document for a
   * beat after that (the popover's exit), and the caller is about to move focus OUT of it - the
   * trap must not pull that focus straight back in.
   */
  readonly closingRef: RefObject<boolean>
  readonly authorName: string
  readonly category: TakedownCategory
  readonly onCategoryChange: (category: TakedownCategory) => void
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * The popover's content and its small focus trap. Mounted only while the popover is open, so the
 * trap's effect IS the dialog's lifetime. Esc is handled by the popover itself (it owns the
 * keydown on its root and stops it propagating).
 */
function ConfirmPanel({
  panelRef,
  closingRef,
  authorName,
  category,
  onCategoryChange,
  onConfirm,
  onCancel,
}: ConfirmPanelProps) {
  const titleId = useId()
  const descriptionId = useId()
  const groupLabelId = useId()

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (panel === null) return undefined

    // Another modal (the shell overlay) is up: it owns focus — take none (F2 contract).
    if (!hasOtherModalMounted(panel)) {
      const checked = panel.querySelector<HTMLElement>('input[type="radio"]:checked')
      ;(checked ?? panel).focus()
    }

    // Focus that strays outside is pulled back — unless another modal is mounted.
    function handleFocusIn(event: FocusEvent): void {
      const target = event.target
      if (panel === null || !(target instanceof Node) || panel.contains(target)) return
      if (closingRef.current || hasOtherModalMounted(panel)) return
      ;(tabbableIn(panel)[0] ?? panel).focus()
    }
    document.addEventListener('focusin', handleFocusIn)
    return () => {
      document.removeEventListener('focusin', handleFocusIn)
    }
  }, [panelRef, closingRef])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Tab') return
    const panel = panelRef.current
    // Closing, or another modal owns the keyboard right now: do not wrap (F2 contract).
    if (panel === null || closingRef.current || hasOtherModalMounted(panel)) return
    const stops = tabbableIn(panel)
    const first = stops[0]
    const last = stops[stops.length - 1]
    if (first === undefined || last === undefined) {
      event.preventDefault()
      panel.focus()
      return
    }
    const active = document.activeElement
    if (!panel.contains(active) || active === panel) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    } else if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <Box
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
      data-testid="takedown-dialog"
      onKeyDown={handleKeyDown}
      sx={{ p: '12px', width: 292, outline: 'none', fontFamily: liveWorldTokens.mono }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: '6px' }}>
        <FontAwesomeIcon icon={faTrashCan} color={liveWorldTokens.danger} aria-hidden="true" />
        <Typography
          id={titleId}
          component="h2"
          sx={{ fontSize: 13, fontWeight: 700, color: liveWorldTokens.ink, m: 0 }}
        >
          Take down this post?
        </Typography>
      </Stack>
      <Typography
        id={descriptionId}
        sx={{ fontSize: 12, lineHeight: 1.4, color: liveWorldTokens.ink, mt: '6px' }}
      >
        {`The post by ${authorName} disappears from every participant feed right away. `}
        This row stays here for the record. It cannot be undone.
      </Typography>

      <Typography
        id={groupLabelId}
        sx={{ ...monoMeta, fontWeight: 700, mt: '10px', textTransform: 'uppercase' }}
      >
        Category
      </Typography>
      <RadioGroup
        aria-labelledby={groupLabelId}
        name="takedown-category"
        value={category}
        onChange={event => {
          const next = event.target.value
          if (isTakedownCategory(next)) onCategoryChange(next)
        }}
        sx={{ mt: '2px' }}
      >
        {TAKEDOWN_CATEGORIES.map(option => (
          <FormControlLabel
            key={option.value}
            value={option.value}
            control={<Radio size="small" sx={{ py: '3px' }} />}
            label={option.label}
            slotProps={{ typography: { sx: { fontSize: 12.5, color: liveWorldTokens.ink } } }}
          />
        ))}
      </RadioGroup>

      <Stack direction="row" sx={{ justifyContent: 'flex-end', gap: '8px', mt: '10px' }}>
        <CobraSecondaryButton
          data-testid="takedown-cancel"
          onClick={onCancel}
          sx={{ fontSize: 12 }}
        >
          Cancel
        </CobraSecondaryButton>
        <CobraDeleteButton
          data-testid="takedown-confirm"
          onClick={onConfirm}
          sx={{ fontSize: 12 }}
        >
          Confirm take down
        </CobraDeleteButton>
      </Stack>
    </Box>
  )
}

/** The Live world row's Take down control. See the module header. */
export function TakedownAction({ post }: TakedownActionProps) {
  const { role } = useControllerIdentity()
  const takedown = useTakedown(post.id)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const markerRef = useRef<HTMLSpanElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closingRef = useRef(false)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [category, setCategory] = useState<TakedownCategory>(DEFAULT_TAKEDOWN_CATEGORY)
  const open = anchorEl !== null

  const { phase, removed, removedHere } = takedown

  // This action's own success: the trigger is gone, so say where focus went (the marker).
  useLayoutEffect(() => {
    if (removed && removedHere) markerRef.current?.focus()
  }, [removed, removedHere])
  // This action's own failure: the trigger is gone, so focus lands on the way forward (Retry).
  useLayoutEffect(() => {
    if (phase === 'failed') retryRef.current?.focus()
  }, [phase])

  // Absent, not disabled, for anyone who is not a controller (CTL-033). Hooks above all ran.
  if (role !== 'controller') return null

  const authorName = post.authorDisplayName

  function openConfirm(event: MouseEvent<HTMLElement>): void {
    if (phase === 'pending') return
    closingRef.current = false
    setCategory(DEFAULT_TAKEDOWN_CATEGORY)
    setAnchorEl(event.currentTarget)
  }

  /**
   * Closes the step; focus returns to the control that opened it - unless ANOTHER modal (the shell
   * overlay) is mounted, which then owns focus. "Another" is judged from this step's own dialog,
   * which is still in the document at this moment and must not count against itself.
   */
  function closeConfirm(): void {
    closingRef.current = true
    setAnchorEl(null)
    const trigger = triggerRef.current
    const own = panelRef.current ?? trigger
    if (trigger !== null && own !== null && !hasOtherModalMounted(own)) trigger.focus()
  }

  function confirm(): void {
    closeConfirm()
    takedown.takeDown(category)
  }

  if (removed) {
    return (
      <Box
        ref={markerRef}
        component="span"
        role="status"
        tabIndex={-1}
        // Names the post when focus lands here (the visible word "Removed" is the label's start).
        aria-label={`Removed. The post by ${authorName} is taken down from participant feeds.`}
        data-testid="takedown-removed"
        sx={{
          ...monoMeta,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          px: '8px',
          py: '2px',
          fontWeight: 700,
          letterSpacing: '0.04em',
          color: liveWorldTokens.ink,
          border: `1px solid ${liveWorldTokens.danger}`,
          borderRadius: '3px',
          '&:focus-visible': {
            outline: `2px solid ${liveWorldTokens.focus}`,
            outlineOffset: '1px',
          },
        }}
      >
        <FontAwesomeIcon icon={faBan} color={liveWorldTokens.danger} aria-hidden="true" />
        <span>Removed</span>
      </Box>
    )
  }

  if (phase === 'failed') {
    return (
      <Box
        role="alert"
        data-testid="takedown-failure"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '6px',
          maxWidth: '100%',
          px: '8px',
          py: '2px',
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
          data-testid="takedown-failure-message"
          sx={{ ...monoMeta, color: liveWorldTokens.ink, fontWeight: 700 }}
        >
          {takedown.failure}
        </Typography>
        <CobraLinkButton
          ref={retryRef}
          size="small"
          data-testid="takedown-retry"
          aria-label={`Retry taking down the post by ${authorName}`}
          onClick={takedown.retry}
          sx={ROW_BUTTON_SX}
        >
          <FontAwesomeIcon icon={faRotateRight} aria-hidden="true" />
          Retry
        </CobraLinkButton>
        <CobraLinkButton
          size="small"
          data-testid="takedown-dismiss"
          aria-label={`Dismiss the failed take down of the post by ${authorName}`}
          onClick={takedown.dismiss}
          sx={ROW_BUTTON_SX}
        >
          Dismiss
        </CobraLinkButton>
      </Box>
    )
  }

  const pending = phase === 'pending'
  return (
    <>
      {/* `aria-disabled` (not `disabled`) while pending: the control keeps focus and its place
          in the Tab order, and simply ignores activation. */}
      <CobraLinkButton
        ref={triggerRef}
        size="small"
        data-testid="takedown-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-disabled={pending}
        aria-label={pending
          ? `Taking down the post by ${authorName}`
          : `Take down post by ${authorName}`}
        title={pending ? 'Taking down…' : 'Take down'}
        onClick={openConfirm}
        sx={{
          ...ROW_BUTTON_SX,
          '&[aria-disabled="true"]': { cursor: 'default', opacity: 0.7 },
        }}
      >
        <FontAwesomeIcon
          icon={pending ? faHourglassHalf : faTrashCan}
          color={pending ? undefined : liveWorldTokens.danger}
          aria-hidden="true"
        />
        {pending ? 'Taking down…' : 'Take down'}
      </CobraLinkButton>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={closeConfirm}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        transitionDuration={0}
        // Our own trap (ConfirmPanel) replaces MUI's, which would fight the shell overlay.
        disableAutoFocus
        disableEnforceFocus
        disableRestoreFocus
        disableScrollLock
        slotProps={{
          paper: {
            sx: {
              mt: '4px',
              bgcolor: liveWorldTokens.surface,
              border: `1px solid ${liveWorldTokens.panelBorder}`,
              borderRadius: '4px',
            },
          },
        }}
      >
        <ConfirmPanel
          panelRef={panelRef}
          closingRef={closingRef}
          authorName={authorName}
          category={category}
          onCategoryChange={setCategory}
          onConfirm={confirm}
          onCancel={closeConfirm}
        />
      </Popover>
    </>
  )
}
