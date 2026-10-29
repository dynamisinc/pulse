/**
 * features/social/components/ParticipantTooltip.test.tsx
 * ---------------------------------------------------------------------------
 * The participant tooltip itself (demo-feedback story 13, #494): the pure placement
 * ("never covers the control"), and the component's show / hide rules on a plain button:
 * hover (after the dwell) and KEYBOARD focus show it; leave (after a grace), blur, a
 * press and Escape hide it; the bubble is hoverable (WCAG 1.4.13); a scroll re-places it
 * and it hides only once the control leaves the viewport; only one is open at a time; a
 * touch pointer and a tap's focus never show it; the `media` gate; the bubble is
 * aria-hidden so the control's `aria-label` stays its only accessible name; and the skin
 * is the participant one (tokens, contrast read from the token sheet, no MUI / COBRA).
 *
 * The tooltip on the real controls (post actions, composer, media viewer, nav rail,
 * headers) is pinned in `ParticipantTooltip.controls.test.tsx`.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { contrastRatio } from '@/test/contrast'
import { readSrcFile } from '@/test/readSource'
import {
  ParticipantTooltip,
  TOOLTIP_HIDE_GRACE_MS,
  TOOLTIP_HOVER_DELAY_MS,
} from './ParticipantTooltip'
import { TOOLTIP_GAP, placeTooltip, type TooltipPlacement, type TooltipRect } from './tooltipPlacement'

const VIEWPORT = { width: 1280, height: 800 }
const BUBBLE = { width: 80, height: 22 }

function overlaps(a: TooltipRect, b: TooltipRect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

describe('placeTooltip — beside the control, never over it', () => {
  const anchor: TooltipRect = { top: 300, left: 600, width: 34, height: 34 }

  it('goes below by default, centred under the control, one gap away', () => {
    const at = placeTooltip(anchor, BUBBLE, 'bottom', VIEWPORT)
    expect(at.placement).toBe('bottom')
    expect(at.top).toBe(anchor.top + anchor.height + TOOLTIP_GAP)
    expect(at.left + BUBBLE.width / 2).toBe(anchor.left + anchor.width / 2)
  })

  it('flips above when there is no room below (and below when there is none above)', () => {
    const low: TooltipRect = { ...anchor, top: VIEWPORT.height - 40 }
    const flippedUp = placeTooltip(low, BUBBLE, 'bottom', VIEWPORT)
    expect(flippedUp.placement).toBe('top')
    expect(flippedUp.top + BUBBLE.height).toBe(low.top - TOOLTIP_GAP)

    const high: TooltipRect = { ...anchor, top: 4 }
    expect(placeTooltip(high, BUBBLE, 'top', VIEWPORT).placement).toBe('bottom')
    expect(placeTooltip(anchor, BUBBLE, 'top', VIEWPORT).placement).toBe('top')
  })

  it('goes to the right, vertically centred, and falls back below when the right is full', () => {
    const right = placeTooltip(anchor, BUBBLE, 'right', VIEWPORT)
    expect(right.placement).toBe('right')
    expect(right.left).toBe(anchor.left + anchor.width + TOOLTIP_GAP)
    expect(right.top + BUBBLE.height / 2).toBe(anchor.top + anchor.height / 2)

    const edge: TooltipRect = { ...anchor, left: VIEWPORT.width - 50 }
    expect(placeTooltip(edge, BUBBLE, 'right', VIEWPORT).placement).toBe('bottom')
  })

  it('slides along its side to stay inside the window', () => {
    const corner: TooltipRect = { top: 100, left: 2, width: 20, height: 20 }
    const at = placeTooltip(corner, BUBBLE, 'bottom', VIEWPORT)
    expect(at.left).toBeGreaterThanOrEqual(8)
    const far: TooltipRect = { top: 100, left: VIEWPORT.width - 22, width: 20, height: 20 }
    expect(placeTooltip(far, BUBBLE, 'bottom', VIEWPORT).left + BUBBLE.width)
      .toBeLessThanOrEqual(VIEWPORT.width - 8)
  })

  it('never overlaps the control, wherever it sits and whatever side is asked for', () => {
    const placements: TooltipPlacement[] = ['bottom', 'top', 'right']
    for (let top = 0; top <= VIEWPORT.height - 34; top += 61) {
      for (let left = 0; left <= VIEWPORT.width - 34; left += 97) {
        const control: TooltipRect = { top, left, width: 34, height: 34 }
        for (const placement of placements) {
          const at = placeTooltip(control, BUBBLE, placement, VIEWPORT)
          const bubble: TooltipRect = { top: at.top, left: at.left, ...BUBBLE }
          expect(overlaps(control, bubble), `${placement} @ ${left},${top}`).toBe(false)
        }
      }
    }
  })
})

function renderButton(props: { media?: string } = {}) {
  render(
    <div>
      <button type="button">Before</button>
      <ParticipantTooltip label="Reply" {...props}>
        <button type="button" aria-label="Reply, 3">
          <span aria-hidden="true">3</span>
        </button>
      </ParticipantTooltip>
      <ParticipantTooltip label="Repost">
        <button type="button" aria-label="Repost, 7">
          <span aria-hidden="true">7</span>
        </button>
      </ParticipantTooltip>
    </div>,
  )
  return screen.getByRole('button', { name: 'Reply, 3' })
}

const tooltip = () => screen.queryByTestId('participant-tooltip')

/** Waits out the hover dwell for the bubble. */
const shown = () =>
  screen.findByTestId('participant-tooltip', {}, { timeout: TOOLTIP_HOVER_DELAY_MS * 5 })

/** Waits out the leave grace for the bubble to go. */
const gone = () => waitFor(() => expect(tooltip()).toBeNull())

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ParticipantTooltip — when it shows and hides', () => {
  it('shows on mouse hover after the dwell, and hides after a short grace on leave', async () => {
    const user = userEvent.setup()
    const button = renderButton()

    await user.hover(button)
    // Not instant: sweeping across a feed must not flash a label on every row.
    expect(tooltip()).toBeNull()
    expect(await shown()).toHaveTextContent('Reply')

    await user.unhover(button)
    // The grace (WCAG 1.4.13 hoverable): still there the instant the pointer leaves...
    expect(tooltip()).not.toBeNull()
    // ...and gone once it has passed.
    await gone()
  })

  it('is hoverable (WCAG 1.4.13): moving onto the bubble keeps it open', async () => {
    const user = userEvent.setup()
    const button = renderButton()
    await user.hover(button)
    const bubble = await shown()

    // From the control onto the bubble (through the gap: a leave, then an enter).
    await user.unhover(button)
    await user.hover(bubble)
    await pause(TOOLTIP_HIDE_GRACE_MS * 3)
    expect(tooltip()).toBe(bubble)

    await user.unhover(bubble)
    await gone()
  })

  it('shows at once on keyboard focus, and hides on blur', async () => {
    const user = userEvent.setup()
    const button = renderButton()

    await user.tab()
    await user.tab()
    expect(button).toHaveFocus()
    expect(tooltip()).toHaveTextContent('Reply')

    await user.tab({ shift: true })
    expect(tooltip()).toBeNull()
  })

  it('a scroll (focus scrolling the control into view) re-places it and it stays', async () => {
    const user = userEvent.setup()
    const button = renderButton()
    await user.tab()
    await user.tab()
    const bubble = tooltip()
    expect(bubble).not.toBeNull()

    const measured = vi.spyOn(button, 'getBoundingClientRect')
    fireEvent.scroll(document)
    await pause(50) // past the next animation frame
    expect(measured).toHaveBeenCalled() // re-placed against the control's new box
    expect(tooltip()).toBe(bubble)
  })

  it('hides once a scroll has taken the control out of the viewport', async () => {
    const user = userEvent.setup()
    const button = renderButton()
    await user.tab()
    await user.tab()
    expect(tooltip()).not.toBeNull()

    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 10, y: -200, width: 34, height: 34 }),
    )
    fireEvent.scroll(window)
    await gone()
  })

  it('only one is open at a time: opening another closes the first', async () => {
    const user = userEvent.setup()
    renderButton()
    await user.tab()
    await user.tab()
    expect(tooltip()).toHaveTextContent('Reply')

    await user.hover(screen.getByRole('button', { name: 'Repost, 7' }))
    await waitFor(
      () => expect(tooltip()).toHaveTextContent('Repost'),
      { timeout: TOOLTIP_HOVER_DELAY_MS * 5 },
    )
    expect(screen.getAllByTestId('participant-tooltip')).toHaveLength(1)
  })

  it('is aria-hidden and not wired as a description: the aria-label stays the only name', async () => {
    const user = userEvent.setup()
    const button = renderButton()
    await user.tab()
    await user.tab()

    const bubble = tooltip()
    expect(bubble).toHaveAttribute('aria-hidden', 'true')
    expect(button).toHaveAccessibleName('Reply, 3')
    expect(button).toHaveAttribute('aria-label', 'Reply, 3')
    expect(button).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('tooltip')).toBeNull()
    // Portalled out of the control, so it never becomes part of its content.
    expect(button).not.toContainElement(bubble)
  })

  it('Escape dismisses it without swallowing the key (a dialog still hears it)', async () => {
    const user = userEvent.setup()
    const heard = vi.fn()
    document.addEventListener('keydown', heard)
    const button = renderButton()
    await user.tab()
    await user.tab()
    expect(tooltip()).not.toBeNull()

    await user.keyboard('{Escape}')
    expect(tooltip()).toBeNull()
    expect(heard).toHaveBeenCalled()
    expect(button).toHaveFocus()
    document.removeEventListener('keydown', heard)
  })

  it('a press hides it (click or Enter)', async () => {
    const user = userEvent.setup()
    const button = renderButton()
    await user.tab()
    await user.tab()
    expect(tooltip()).not.toBeNull()
    await user.keyboard('{Enter}')
    expect(tooltip()).toBeNull()

    await user.hover(button)
    await shown()
    await user.click(button)
    expect(tooltip()).toBeNull()
  })

  it('a touch pointer over the control shows nothing, even past the dwell', async () => {
    const button = renderButton()
    fireEvent.pointerOver(button, { pointerType: 'touch' })
    await pause(TOOLTIP_HOVER_DELAY_MS * 2)
    expect(tooltip()).toBeNull()
  })

  it('a tap\'s focus is not keyboard focus and shows nothing', async () => {
    const button = renderButton()
    fireEvent.pointerDown(button, { pointerType: 'touch' })
    button.focus()
    expect(button).toHaveFocus()
    await pause(TOOLTIP_HOVER_DELAY_MS * 2)
    expect(tooltip()).toBeNull()
  })

  it('shows only while its media query matches', async () => {
    const matches = vi.fn((query: string) => ({ matches: query !== '(gate)', media: query }))
    vi.stubGlobal('matchMedia', matches)
    const user = userEvent.setup()
    renderButton({ media: '(gate)' })

    await user.tab()
    await user.tab()
    expect(matches).toHaveBeenCalledWith('(gate)')
    expect(tooltip()).toBeNull()
  })
})

/** The value of a custom property declared in a stylesheet (`--name: value;`). */
function cssVar(sheet: string, name: string): string {
  const found = new RegExp(`${name}:\\s*([^;]+);`).exec(sheet)
  if (found?.[1] === undefined) throw new Error(`${name} is not declared`)
  return found[1].trim()
}

describe('ParticipantTooltip — participant skin, not MUI or COBRA', () => {
  const source = readSrcFile('core/media/player/ParticipantTooltip.tsx')
  const sheet = readSrcFile('core/media/player/ParticipantTooltip.module.css')
  const tokens = readSrcFile('features/social/theme/social.module.css')

  it('imports no MUI and no COBRA staff component', () => {
    expect(source).not.toMatch(/from '@mui\//)
    expect(source).not.toMatch(/@\/theme/)
    expect(source).not.toMatch(/Cobra/)
  })

  it('reads the participant token palette (composed, since the portal leaves the frame)', () => {
    // The sheet lives in core/media/player since channels-foundation 14; it still composes
    // Social's token class (an absolute-from-src relative path; a stale one breaks vite build).
    expect(sheet).toMatch(
      /composes:\s*tokens from '\.\.\/\.\.\/\.\.\/features\/social\/theme\/social\.module\.css'/,
    )
    expect(sheet).toContain('background: var(--pc-ink-muted)')
    expect(sheet).toContain('color: var(--pc-bg)')
    // Hoverable (WCAG 1.4.13): the bubble takes the pointer.
    expect(sheet).toContain('pointer-events: auto')
    expect(sheet).not.toMatch(/prefers-color-scheme|data-theme/)
  })

  it('its text clears WCAG AA: --pc-bg on --pc-ink-muted, as declared, is at least 4.5:1', () => {
    const background = cssVar(tokens, '--pc-ink-muted')
    const text = cssVar(tokens, '--pc-bg')
    expect(background).toMatch(/^#[0-9a-f]{3,6}$/i)
    const full = text.length === 4 ? `#${[...text.slice(1)].map(c => c + c).join('')}` : text
    expect(contrastRatio(full, background)).toBeGreaterThanOrEqual(4.5)
  })
})
