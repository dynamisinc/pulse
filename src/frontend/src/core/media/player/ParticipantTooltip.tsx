/**
 * core/media/player/ParticipantTooltip.tsx
 * ---------------------------------------------------------------------------
 * The ONE participant tooltip (demo-feedback story 13, issue #494): a small dark label
 * that names an icon-only control on hover AND on keyboard focus, the way X labels its
 * Reply / Repost / Like icons. Wrap the control:
 *
 *     <ParticipantTooltip label="Reply">
 *       <button aria-label="Reply, 3">...</button>
 *     </ParticipantTooltip>
 *
 * WHAT IT SHOWS. `label` is the control's NAME, the same words as its `aria-label` (for a
 * control whose `aria-label` also carries a count or a state, "Like, 42, liked", the
 * tooltip is the leading name, "Like": the count is already visible beside the icon).
 *
 * NOT AN ACCESSIBLE NAME (NFR-001). The control keeps its own `aria-label`; the bubble is
 * `aria-hidden` and is never wired as `aria-describedby`, so a screen reader hears the
 * name once, from the control, and nothing changes for assistive tech. It is a visual
 * aid for sighted mouse and keyboard users only.
 *
 * WHEN IT SHOWS
 *  - mouse / pen hover, after `TOOLTIP_HOVER_DELAY_MS` (so sweeping across a feed does
 *    not flash a label on every action row);
 *  - KEYBOARD focus, at once. Focus that follows a click or a tap is not keyboard focus
 *    (the last interaction decides, as for `:focus-visible`: see `trackModality`), so a
 *    click never leaves a label hanging and focus returned after a mouse pick stays quiet;
 *  - only while `media` matches, when given (the nav rail passes "below 840px", where
 *    its text labels are visually hidden; above that the visible text IS the label).
 *  TOUCH IS UNAFFECTED: a touch pointer never shows it, and a tap's focus does not either.
 *
 * WHEN IT HIDES: blur, any press on the control, Escape (WCAG 1.4.13 "dismissible"; the
 * key is not swallowed, so a dialog's own Escape still works), and pointer leave after a
 * `TOOLTIP_HIDE_GRACE_MS` grace. The bubble itself takes the pointer, and moving onto it
 * keeps it open (WCAG 1.4.13 "hoverable"). ONE AT A TIME: opening a tooltip closes any
 * other that is open (a module-level handle).
 *
 * SCROLL AND RESIZE follow the control: the bubble is re-placed in the next animation
 * frame (a keyboard focus that scrolls the control into view keeps its label), and it
 * hides only once the control's box has left the viewport.
 *
 * NEVER COVERS THE CONTROL. The bubble sits beside the control's box, never over it:
 * `placement` ('bottom' by default, 'top', or 'right') with a gap, flipped to the
 * opposite side when it would leave the viewport, and slid along that side to stay
 * on screen. `placeTooltip` (`tooltipPlacement.ts`) is the pure geometry, unit-tested.
 *
 * WHY A PORTAL. The controls live inside clipping boxes (the video player and the
 * attachment thumbnails are `overflow: hidden`) and a transformed ancestor (the focused
 * thread card), so an absolutely or fixed-positioned child would be clipped or misplaced.
 * The bubble is portalled to `<body>` (or to the fullscreen element while one is
 * showing, so an expanded video's controls keep their labels) at the media viewer's
 * layer, `SHELL_Z.alertBar - 1`: above the channel and the viewer, never above the alert
 * bar, the overlay layer or the compliance banners.
 *
 * NO WRAPPER BOX. The anchor is a `display: contents` span, so wrapping a control
 * changes no layout (flex gaps, grid tracks and hit areas stay exactly as they were);
 * the bubble is placed against the wrapped control's own box (its first element child).
 *
 * World: participant. CSS Module reading the participant `--pc-*` tokens (the bubble
 * composes `.tokens` itself, since the portal leaves the channel's token scope). No MUI,
 * no COBRA, FontAwesome-free.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { SHELL_Z } from '@/features/participant-shell/mountContract'
import { getFullscreenElement } from '@/core/dom/fullscreen'
import { placeTooltip, type TooltipPlacement } from './tooltipPlacement'
import styles from './ParticipantTooltip.module.css'

/** Hover dwell before the label appears (ms). Keyboard focus shows it at once. */
export const TOOLTIP_HOVER_DELAY_MS = 400

/** Grace after the pointer leaves before the bubble hides, so it can reach the bubble (ms). */
export const TOOLTIP_HIDE_GRACE_MS = 100

/** Same layer as the media viewer, so the viewer's own controls are labelled above it. */
const TOOLTIP_Z_INDEX = SHELL_Z.alertBar - 1

/** The close function of the tooltip open right now, if any: only one is ever open. */
let openTooltipClose: (() => void) | null = null

/** True when `rect` still shows at least partly inside the window. */
function inViewport(rect: DOMRect): boolean {
  return (
    rect.bottom >= 0 &&
    rect.right >= 0 &&
    rect.top <= window.innerHeight &&
    rect.left <= window.innerWidth
  )
}

/**
 * INPUT MODALITY: was the last interaction a key press (keyboard focus) or a pointer
 * press (a click's or a tap's focus)? One pair of capture listeners on the document,
 * installed with the first tooltip, decides it for every tooltip -- the rule browsers
 * use for `:focus-visible`, kept here so it is explicit and testable. Starts as
 * "pointer": focus moved by script before any interaction shows no label.
 */
const modality = { keyboard: false, installed: false }

function trackModality(): void {
  if (modality.installed || typeof document === 'undefined') return
  modality.installed = true
  document.addEventListener(
    'keydown',
    event => {
      // A shortcut chord (ctrl/cmd/alt + key) is not keyboard navigation.
      if (!event.metaKey && !event.ctrlKey && !event.altKey) modality.keyboard = true
    },
    true,
  )
  document.addEventListener('pointerdown', () => { modality.keyboard = false }, true)
  document.addEventListener('mousedown', () => { modality.keyboard = false }, true)
}

/** True when `query` matches now; true when there is no `matchMedia` (nothing to gate on). */
function mediaMatches(query: string | undefined): boolean {
  if (query === undefined) return true
  if (typeof window.matchMedia !== 'function') return true
  return window.matchMedia(query).matches
}

/** The fullscreen element when one is showing (so the bubble renders inside it), else body. */
function portalTarget(): HTMLElement {
  const fullscreen = getFullscreenElement()
  return fullscreen instanceof HTMLElement && !(fullscreen instanceof HTMLVideoElement)
    ? fullscreen
    : document.body
}

export interface ParticipantTooltipProps {
  /** The control's name, as in its `aria-label` (the leading name when that adds a count). */
  readonly label: string
  /** Preferred side; flipped when it would leave the viewport. Default `'bottom'`. */
  readonly placement?: TooltipPlacement
  /** Show only while this media query matches (e.g. the icon-only nav rail). */
  readonly media?: string
  /** Exactly one control element. */
  readonly children: ReactNode
}

export function ParticipantTooltip({
  label,
  placement = 'bottom',
  media,
  children,
}: ParticipantTooltipProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLSpanElement>(null)
  const showTimer = useRef<number | undefined>(undefined)
  const hideTimer = useRef<number | undefined>(undefined)

  const clearTimers = useCallback(() => {
    window.clearTimeout(showTimer.current)
    window.clearTimeout(hideTimer.current)
    showTimer.current = undefined
    hideTimer.current = undefined
  }, [])

  const hide = useCallback(() => {
    clearTimers()
    setOpen(false)
  }, [clearTimers])

  /** Pointer left the control and the bubble: hide after the grace (hoverable, 1.4.13). */
  const hideSoon = useCallback(() => {
    window.clearTimeout(showTimer.current)
    showTimer.current = undefined
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = undefined
      setOpen(false)
    }, TOOLTIP_HIDE_GRACE_MS)
  }, [])

  useEffect(() => clearTimers, [clearTimers])
  useEffect(trackModality, [])

  // One at a time: opening this one closes whichever other tooltip is open.
  useEffect(() => {
    if (!open) return undefined
    if (openTooltipClose !== null && openTooltipClose !== hide) openTooltipClose()
    openTooltipClose = hide
    return () => {
      if (openTooltipClose === hide) openTooltipClose = null
    }
  }, [open, hide])

  /** Places the bubble against the control's box; hides it once the control is off screen. */
  const reposition = useCallback(() => {
    const bubble = bubbleRef.current
    const control = anchorRef.current?.firstElementChild
    if (!bubble || !control) return
    const anchor = control.getBoundingClientRect()
    if (!inViewport(anchor)) {
      hide()
      return
    }
    const size = bubble.getBoundingClientRect()
    const position = placeTooltip(
      anchor,
      { width: size.width, height: size.height },
      placement,
      { width: window.innerWidth, height: window.innerHeight },
    )
    bubble.style.top = `${position.top}px`
    bubble.style.left = `${position.left}px`
    bubble.dataset.placement = position.placement
  }, [hide, placement])

  // While open: Escape dismisses (in the capture phase, so a control that stops its own
  // Escape -- the emoji button -- still drops the label; never swallowed), and a scroll or
  // resize re-places the bubble in the next frame (it follows the control).
  useEffect(() => {
    if (!open) return undefined
    let frame: number | undefined
    const follow = () => {
      if (frame !== undefined) return
      frame = window.requestAnimationFrame(() => {
        frame = undefined
        reposition()
      })
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [open, hide, reposition])

  // Place the bubble before paint.
  useLayoutEffect(() => {
    if (open) reposition()
  }, [open, label, reposition])

  // The bubble is a React child of the anchor (through the portal), so moving from the
  // control onto the bubble re-enters the anchor: a pending hide is cancelled there.
  const handlePointerEnter = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.pointerType === 'touch') return
    window.clearTimeout(hideTimer.current)
    hideTimer.current = undefined
    if (open || !mediaMatches(media)) return
    window.clearTimeout(showTimer.current)
    showTimer.current = window.setTimeout(() => {
      showTimer.current = undefined
      setOpen(true)
    }, TOOLTIP_HOVER_DELAY_MS)
  }

  const handleFocus = () => {
    if (!modality.keyboard || !mediaMatches(media)) return
    clearTimers()
    setOpen(true)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    // Activating the control by key is a press: drop the label like a click does.
    if (event.key === 'Enter' || event.key === ' ') hide()
  }

  return (
    <span
      ref={anchorRef}
      className={styles.anchor}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={hideSoon}
      onPointerDown={hide}
      onFocus={handleFocus}
      onBlur={hide}
      onKeyDown={handleKeyDown}
    >
      {children}
      {open &&
        createPortal(
          <span
            ref={bubbleRef}
            className={styles.tooltip}
            style={{ zIndex: TOOLTIP_Z_INDEX }}
            aria-hidden="true"
            data-testid="participant-tooltip"
          >
            {label}
          </span>,
          portalTarget(),
        )}
    </span>
  )
}
