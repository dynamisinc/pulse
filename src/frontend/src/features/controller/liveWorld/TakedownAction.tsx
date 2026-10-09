/**
 * features/controller/liveWorld/TakedownAction.tsx
 * ---------------------------------------------------------------------------
 * The controller's **Take down** action on a Live world row (demo-polish C5,
 * docs/features/demo-polish/22-takedown-ui.md; CTL-025, CTL-033, XC-004, DP-9, NFR-001).
 * STAFF world: COBRA controls (`@/theme/styledComponents`), dense, keyboard-first, FontAwesome
 * only, MUI 9 `sx` only — unmistakably the machine, never a participant surface.
 *
 * HOW IT IS MOUNTED. It is NOT imported by the column. The orchestrator mounts it through C2's
 * `renderRowActions` slot AND wires the column's `isRowRemoved` prop to the same removed-post store
 * (implementation.md §4.2):
 *
 *     // module level, one stable function:
 *     const renderTakedown = (post: LiveWorldPost) => <TakedownAction post={post} />
 *     // inside a component (a hook cannot run in a callback):
 *     const isRowRemoved = useIsRowRemoved()
 *     <LiveWorldColumn renderRowActions={renderTakedown} isRowRemoved={isRowRemoved} ... />
 *
 * `isRowRemoved` is what makes the row itself say REMOVED (a marker on the author line, "Reply as…"
 * disabled, `R` a no-op): that is the PERSISTENT removed state, and it is the column's, so this
 * slot never draws a second "Removed" for a row the column already marks. The slot renders at the
 * end of each row's bottom line, keyed by the post's id with a stable object identity, so this
 * component's state (an open confirm step, an in-flight request, a failure) survives the column's
 * re-renders.
 *
 * THE FLOW — two clicks, fully keyboard-operable.
 *   1. **Take down** opens a small confirm popover: a four-way category radio group
 *      (Inappropriate · PII · Real-world reference · Other, default **Other**) and
 *      **Confirm take down** / **Cancel**.
 *   2. **Confirm take down** closes the popover and calls `DELETE /api/staff/posts/{id}?category=`
 *      (`takedownService`). Nothing is sent until that second click.
 *   Keyboard: Enter/Space on Take down opens the step with focus on the selected category;
 *   Arrow keys change it; Tab/Shift+Tab cycle category -> Cancel -> Confirm and wrap; Esc cancels;
 *   on close focus returns to the Take down control. The step is portalled (the column ignores
 *   J/K/R/N for keys that originate outside its list DOM or in a form field).
 *
 * THE CONFIRM STEP IS NON-MODAL MARKUP WITH ITS OWN MODAL BEHAVIOUR. It is an MUI `Popper` +
 * `ClickAwayListener`, deliberately NOT a `Popover`: a Popover is an MUI Modal, which sets
 * `aria-hidden` on the whole app root and lays an invisible backdrop over it — so the console's
 * Ctrl+K palette (an inline `aria-modal` inside that root) opened over it would be hidden from
 * assistive technology and unclickable. The Popper does neither. The dialog still declares itself
 * `role="dialog" aria-modal="true"`, traps Tab, and closes on Esc, Cancel or a click anywhere else.
 *
 * FOCUS RULES (NFR-001, WCAG 2.4.3 / 3.2.2). Focus is only ever moved when it would otherwise be
 * lost or when the controller's own gesture is what moves it:
 *   - open: focus goes to the selected category. Close (Esc / Cancel / Confirm / click-away):
 *     back to the Take down control - but only if focus is on <body> or still inside the step,
 *     never off an input the controller just clicked into;
 *   - the pending control ("Taking down…", `aria-disabled`, still focusable) keeps focus
 *     mid-request;
 *   - **Retry** and **Dismiss** unmount their own button, so activating either puts focus straight
 *     back on the Take down control (which is the pending control during a Retry);
 *   - when a request SETTLES, the confirmation (success) or Retry (failure) takes focus only if
 *     focus is lost (on <body> / detached - the control that had it just unmounted). If the
 *     controller has moved on - J/K to another row, typing in the persona composer - focus stays
 *     exactly where they put it, so a stray Space can never re-send a takedown. On success a
 *     polite live region says so instead; a failure announces itself (`role="alert"`).
 *
 * OUTCOMES (never colour alone - NFR-001: every state is an icon AND text).
 *   - pending  "Taking down…" in place of the control, ignoring activation;
 *   - success  the control is replaced by a compact confirmation to THE CONTROLLER WHO DID IT:
 *              "Taken down · {category}" (check icon + text, `tabIndex -1`, a plain `note` - not
 *              a live region, because it takes focus and focus already announces it). The row's
 *              own REMOVED marker (the column's, via `isRowRemoved`) is the persistent state; this
 *              is the acknowledgement, with the category the column does not know. After a
 *              remount, or when ANOTHER controller's `PostRemoved` reaches this tab, no category
 *              is known and the slot renders nothing - the column's marker covers it;
 *   - failure  an alert with the server's plain-text message, **Retry** (re-sends the category
 *              the controller already confirmed) and **Dismiss**.
 *
 * ABSENT, NOT DISABLED, FOR NON-CONTROLLERS (CTL-033): when the controller-identity seam's role is
 * not `controller` the component renders nothing at all. (The backend refuses anyone else too.)
 *
 * FOCUS-TRAP CONTRACT (F2, `core/a11y/modalPriority`). The step's trap (initial focus, Tab wrap)
 * STANDS ASIDE while any other `[aria-modal="true"]` element is mounted (`hasOtherModalMounted`):
 * no focus on open, no Tab wrap, no focus return on close. There is NO document-level pull-back at
 * all: because the step is non-modal (a click elsewhere is a click-away), focus that moves outside
 * it - a click into the composer, a modal taking focus, a programmatic move - CLOSES the step and
 * leaves focus exactly where it went (the control's own click is the one exception: it toggles).
 * Its z-index sits below the palette's, so a modal opened over it wins visually as well.
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
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  Box,
  ClickAwayListener,
  FormControlLabel,
  Paper,
  Popper,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCheck,
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
import { liveWorldTokens, monoMeta, srOnly } from './liveWorldStyles'

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

/**
 * Above the console's rows, BELOW a modal (the Ctrl+K palette is 1300): a modal opened over the
 * step must also paint over it.
 */
const POPPER_Z_INDEX = 1250

/** The visible label of a category (the picker's own words). */
function labelOfCategory(category: TakedownCategory): string {
  return TAKEDOWN_CATEGORIES.find(option => option.value === category)?.label ?? category
}

/** Tabbable descendants, in DOM order; only the CHECKED radio of a group is a Tab stop. */
function tabbableIn(container: HTMLElement): HTMLElement[] {
  const found = container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  return Array.from(found).filter(
    element => !(element instanceof HTMLInputElement && element.type === 'radio' && !element.checked),
  )
}

/** True when keyboard focus has nowhere useful to be: on <body>, nothing, or a detached node. */
function focusIsLost(): boolean {
  const active = document.activeElement
  return active === null || active === document.body || !active.isConnected
}

interface ConfirmPanelProps {
  /** The dialog element, owned by the caller so it can tell "another modal" from this one. */
  readonly panelRef: RefObject<HTMLDivElement | null>
  /**
   * True from the moment the caller starts closing the step. The dialog is still in the document
   * until React commits the close, and the caller is about to move focus OUT of it - the trap must
   * not pull that focus straight back in.
   */
  readonly closingRef: RefObject<boolean>
  readonly authorName: string
  readonly category: TakedownCategory
  readonly onCategoryChange: (category: TakedownCategory) => void
  readonly onConfirm: () => void
  readonly onCancel: () => void
  /** Focus landed outside the step (a click elsewhere, another modal, a programmatic move). */
  readonly onFocusLeave: (target: Node) => void
}

/**
 * The confirm step's content and its small focus trap. Mounted only while the step is open, so the
 * trap's effect IS the dialog's lifetime. Esc is handled here (and stopped from propagating, so the
 * console's own key handlers never also act on it).
 */
function ConfirmPanel({
  panelRef,
  closingRef,
  authorName,
  category,
  onCategoryChange,
  onConfirm,
  onCancel,
  onFocusLeave,
}: ConfirmPanelProps) {
  const titleId = useId()
  // The latest handler, read at event time, so the listener below subscribes once per open.
  const focusLeaveRef = useRef(onFocusLeave)
  useLayoutEffect(() => {
    focusLeaveRef.current = onFocusLeave
  }, [onFocusLeave])
  const descriptionId = useId()
  const groupLabelId = useId()

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (panel === null) return undefined

    // Another modal (the shell overlay / the palette) is up: it owns focus - take none (F2).
    // `preventScroll`: the popper is positioned a frame later; focusing must not jump the page.
    if (!hasOtherModalMounted(panel)) {
      const checked = panel.querySelector<HTMLElement>('input[type="radio"]:checked')
      ;(checked ?? panel).focus({ preventScroll: true })
    }

    // Focus that lands outside the step ends it - and stays where it went: never pulled back (a
    // pull-back would fight a click into another field, and the shell overlay's own trap).
    function handleFocusIn(event: FocusEvent): void {
      const target = event.target
      if (panel === null || !(target instanceof Node) || panel.contains(target)) return
      if (closingRef.current) return
      focusLeaveRef.current(target)
    }
    document.addEventListener('focusin', handleFocusIn)
    return () => {
      document.removeEventListener('focusin', handleFocusIn)
    }
  }, [panelRef, closingRef])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.stopPropagation()
      event.preventDefault()
      onCancel()
      return
    }
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
  const confirmationRef = useRef<HTMLSpanElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closingRef = useRef(false)
  /** Set by Retry / Dismiss (their own button is about to unmount): refocus the control. */
  const refocusTriggerRef = useRef(false)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [category, setCategory] = useState<TakedownCategory>(DEFAULT_TAKEDOWN_CATEGORY)
  const [announcement, setAnnouncement] = useState('')
  const open = anchorEl !== null

  const { phase, failure, removed, takenDownAs } = takedown
  const authorName = post.authorDisplayName
  const pending = phase === 'pending'

  // Retry / Dismiss unmounted the failure box that held focus: land on the control that replaced it
  // (the pending control during a Retry, the idle one after a Dismiss).
  useLayoutEffect(() => {
    if (!refocusTriggerRef.current || phase === 'failed') return
    refocusTriggerRef.current = false
    triggerRef.current?.focus()
  }, [phase])

  // This action's own success. Focus the confirmation ONLY if focus was lost with the control that
  // had it; if the controller has moved on, leave focus alone and say so politely instead.
  useLayoutEffect(() => {
    if (!removed || takenDownAs === undefined) return
    if (focusIsLost()) {
      confirmationRef.current?.focus()
    } else {
      setAnnouncement(
        `The post by ${authorName} is taken down: ${labelOfCategory(takenDownAs)}.`,
      )
    }
  }, [removed, takenDownAs, authorName])

  // This action's own failure: same rule - Retry takes focus only when it would otherwise be lost.
  useLayoutEffect(() => {
    if (phase === 'failed' && focusIsLost()) retryRef.current?.focus()
  }, [phase])

  // Absent, not disabled, for anyone who is not a controller (CTL-033). Hooks above all ran.
  if (role !== 'controller') return null

  function openConfirm(event: ReactMouseEvent<HTMLElement>): void {
    if (phase === 'pending') return
    // A click on the control while the step is open closes it (the click-away ignores the control).
    if (open) {
      closeConfirm()
      return
    }
    closingRef.current = false
    setCategory(DEFAULT_TAKEDOWN_CATEGORY)
    setAnchorEl(event.currentTarget)
  }

  /**
   * Closes the step. Focus returns to the control that opened it when it would otherwise be lost
   * (it is inside the step, or on <body>) - never off something the controller clicked into - and
   * never while ANOTHER modal is mounted, which then owns focus. "Another" is judged from this
   * step's own dialog, still in the document at this moment, which must not count against itself.
   */
  function closeConfirm(): void {
    closingRef.current = true
    setAnchorEl(null)
    const trigger = triggerRef.current
    const panel = panelRef.current
    const own = panel ?? trigger
    if (trigger === null || own === null || hasOtherModalMounted(own)) return
    if (focusIsLost() || (panel !== null && panel.contains(document.activeElement))) {
      trigger.focus()
    }
  }

  function handleClickAway(event: MouseEvent | TouchEvent): void {
    // The control's own click is handled by `openConfirm` (it toggles).
    if (event.target instanceof Node && anchorEl?.contains(event.target) === true) return
    closeConfirm()
  }

  function handleFocusLeave(target: Node): void {
    // The control's own click is handled by `openConfirm` (it toggles); anything else ends it.
    if (anchorEl?.contains(target) === true) return
    closeConfirm()
  }

  function confirm(): void {
    closeConfirm()
    takedown.takeDown(category)
  }

  function retry(): void {
    refocusTriggerRef.current = true
    takedown.retry()
  }

  function dismiss(): void {
    refocusTriggerRef.current = true
    takedown.dismiss()
  }

  // Taken down, but not by this instance (another controller's push, or this row remounted):
  // there is no category to confirm, and the column's REMOVED marker (`isRowRemoved`) already
  // says it. (While THIS instance's request is in flight the store may already say removed:
  // keep showing "pending".)
  if (removed && takenDownAs === undefined && !pending) return null

  let content: ReactNode
  // `removed` alone is not "confirmed": the store flips a beat BEFORE this request's own
  // continuation records the category it was sent with.
  if (removed && takenDownAs !== undefined) {
    const label = labelOfCategory(takenDownAs)
    content = (
      <Box
        ref={confirmationRef}
        component="span"
        role="note"
        tabIndex={-1}
        // Names the post when focus lands here; it starts with the visible words.
        aria-label={
          `Taken down · ${label}. The post by ${authorName} is no longer shown to participants.`
        }
        data-testid="takedown-confirmation"
        sx={{
          ...monoMeta,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          px: '8px',
          py: '2px',
          fontWeight: 700,
          color: liveWorldTokens.ink,
          '&:focus-visible': {
            outline: `2px solid ${liveWorldTokens.focus}`,
            outlineOffset: '1px',
          },
        }}
      >
        <FontAwesomeIcon icon={faCheck} aria-hidden="true" />
        <span>{`Taken down · ${label}`}</span>
      </Box>
    )
  } else if (phase === 'failed') {
    content = (
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
          {failure}
        </Typography>
        <CobraLinkButton
          ref={retryRef}
          size="small"
          data-testid="takedown-retry"
          aria-label={`Retry taking down the post by ${authorName}`}
          onClick={retry}
          sx={ROW_BUTTON_SX}
        >
          <FontAwesomeIcon icon={faRotateRight} aria-hidden="true" />
          Retry
        </CobraLinkButton>
        <CobraLinkButton
          size="small"
          data-testid="takedown-dismiss"
          aria-label={`Dismiss the failed take down of the post by ${authorName}`}
          onClick={dismiss}
          sx={ROW_BUTTON_SX}
        >
          Dismiss
        </CobraLinkButton>
      </Box>
    )
  } else {
    content = (
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

        <Popper
          open={open}
          anchorEl={anchorEl}
          placement="bottom-end"
          modifiers={[{ name: 'offset', options: { offset: [0, 4] } }]}
          // The Popper root is presentational; the dialog role lives on the panel.
          slotProps={{ root: { role: 'presentation' } }}
          sx={{ zIndex: POPPER_Z_INDEX }}
        >
          <ClickAwayListener onClickAway={handleClickAway}>
            <Paper
              elevation={8}
              sx={{
                bgcolor: liveWorldTokens.surface,
                border: `1px solid ${liveWorldTokens.panelBorder}`,
                borderRadius: '4px',
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
                onFocusLeave={handleFocusLeave}
              />
            </Paper>
          </ClickAwayListener>
        </Popper>
      </>
    )
  }

  // The polite region is the SECOND child in every state, so it is the same DOM node from the idle
  // control through "Taking down…" to the confirmation: it exists before its text changes.
  return (
    <>
      {content}
      <Box role="status" aria-live="polite" data-testid="takedown-announcer" sx={srOnly}>
        {announcement}
      </Box>
    </>
  )
}
