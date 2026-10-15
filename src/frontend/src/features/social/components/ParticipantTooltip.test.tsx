/**
 * features/social/components/ParticipantTooltip.test.tsx
 * ---------------------------------------------------------------------------
 * The participant tooltip itself (demo-feedback story 13, #494): the pure placement
 * ("never covers the control"), and the component's show / hide rules on a plain button:
 * hover (after the dwell) and KEYBOARD focus show it; leave, blur, a press and Escape
 * hide it; a touch pointer and a tap's focus never show it; the `media` gate; the
 * bubble is aria-hidden so the control's `aria-label` stays its only accessible name;
 * and the skin is the participant one (tokens, contrast, no MUI / COBRA).
 *
 * The tooltip on the real controls (post actions, composer, media viewer, nav rail,
 * headers) is pinned in `ParticipantTooltip.controls.test.tsx`.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { contrastRatio } from '@/test/contrast'
import { readSrcFile } from '@/test/readSource'
import { ParticipantTooltip, TOOLTIP_HOVER_DELAY_MS } from './ParticipantTooltip'
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
    </div>,
  )
  return screen.getByRole('button', { name: 'Reply, 3' })
}

const tooltip = () => screen.queryByTestId('participant-tooltip')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ParticipantTooltip — when it shows and hides', () => {
  it('shows on mouse hover after the dwell, and hides on leave', async () => {
    const user = userEvent.setup()
    const button = renderButton()

    await user.hover(button)
    // Not instant: sweeping across a feed must not flash a label on every row.
    expect(tooltip()).toBeNull()
    const bubble = await screen.findByTestId(
      'participant-tooltip',
      {},
      { timeout: TOOLTIP_HOVER_DELAY_MS * 5 },
    )
    expect(bubble).toHaveTextContent('Reply')

    await user.unhover(button)
    expect(tooltip()).toBeNull()
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
    await screen.findByTestId('participant-tooltip', {}, { timeout: TOOLTIP_HOVER_DELAY_MS * 5 })
    await user.click(button)
    expect(tooltip()).toBeNull()
  })

  it('touch is unaffected: a touch pointer and a tap\'s focus show nothing', async () => {
    const button = renderButton()
    fireEvent.pointerOver(button, { pointerType: 'touch' })
    fireEvent.pointerDown(button, { pointerType: 'touch' })
    button.focus()
    await new Promise(resolve => setTimeout(resolve, TOOLTIP_HOVER_DELAY_MS * 2))
    expect(button).toHaveFocus()
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

describe('ParticipantTooltip — participant skin, not MUI or COBRA', () => {
  const source = readSrcFile('features/social/components/ParticipantTooltip.tsx')
  const sheet = readSrcFile('features/social/components/ParticipantTooltip.module.css')

  it('imports no MUI and no COBRA staff component', () => {
    expect(source).not.toMatch(/from '@mui\//)
    expect(source).not.toMatch(/@\/theme/)
    expect(source).not.toMatch(/Cobra/)
  })

  it('reads the participant token palette (composed, since the portal leaves the frame)', () => {
    expect(sheet).toMatch(/composes:\s*tokens from '\.\.\/theme\/social\.module\.css'/)
    expect(sheet).toContain('background: var(--pc-ink-muted)')
    expect(sheet).toContain('color: var(--pc-bg)')
    expect(sheet).toContain('pointer-events: none')
    expect(sheet).not.toMatch(/prefers-color-scheme|data-theme/)
  })

  it('its text clears WCAG AA: white on the muted ink is at least 4.5:1', () => {
    // `--pc-bg` / `--pc-ink-muted` in theme/social.module.css.
    expect(contrastRatio('#ffffff', '#61707a')).toBeGreaterThanOrEqual(4.5)
  })
})
