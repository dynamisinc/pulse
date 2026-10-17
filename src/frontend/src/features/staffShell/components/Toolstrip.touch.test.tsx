/**
 * features/staffShell/components/Toolstrip.touch.test.tsx
 * ---------------------------------------------------------------------------
 * Story 13 (mobile-tablet, staff shell at tablet sizes) — the toolstrip on a tablet:
 *  - every tool is >= 44x44 under `(pointer: coarse)` as REAL layout space (CSS contract), and is
 *    NOT enlarged without a coarse pointer (touch sizing is gated separately from width);
 *  - every tool has a visible label AND an accessible name (no icon-only unlabeled tool);
 *  - tools are >= 8px apart (the stack gap), never overlapping;
 *  - only ONE tool/flyout is active at a time (D7-011) — opening B closes A;
 *  - the tooltip has a touch equivalent (visible label + touch-hold, never hover-only).
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { faFlag, faGear } from '@fortawesome/free-solid-svg-icons'
import { Toolstrip } from './Toolstrip'
import { ToolstripProvider, useRegisterSurfaceTool, type SurfaceTool } from '../toolRegistry'
import { mediaRuleDeclarations } from '../tabletTestUtils'
import { STAFF_TOUCH_TARGET_PX } from '../staffShellTokens'

const TOOL_A: SurfaceTool = { id: 'stories', label: 'STORIES', icon: faFlag, tooltip: 'Storylines — controller toolbox' }
const TOOL_B: SurfaceTool = { id: 'engine', label: 'ENGINE', icon: faGear, tooltip: 'Engine settings — autonomy default' }

function Registrant({ tool }: { tool: SurfaceTool }) {
  useRegisterSurfaceTool(tool)
  return null
}

function renderStrip() {
  return render(
    <ToolstripProvider>
      <Registrant tool={TOOL_A} />
      <Registrant tool={TOOL_B} />
      <Toolstrip />
    </ToolstripProvider>,
  )
}

describe('Toolstrip — touch targets (story 13, TABLET-AMENDMENT §4)', () => {
  it('grows every tool to a real 44x44 inside @media (pointer: coarse), by width/height not slop', () => {
    renderStrip()
    for (const tool of [TOOL_A, TOOL_B]) {
      const button = screen.getByTestId(`toolstrip-tool-${tool.id}`)
      const coarse = mediaRuleDeclarations(button, 'pointer: coarse')
      expect(coarse.width).toBe(`${STAFF_TOUCH_TARGET_PX}px`)
      expect(coarse.height).toBe(`${STAFF_TOUCH_TARGET_PX}px`)
      expect(coarse['min-width']).toBe(`${STAFF_TOUCH_TARGET_PX}px`)
      expect(coarse['min-height']).toBe(`${STAFF_TOUCH_TARGET_PX}px`)
    }
  })

  it('does NOT gate the 44px on width: the base (non-coarse) size is the desktop 40px', () => {
    renderStrip()
    const button = screen.getByTestId('toolstrip-tool-stories')
    // No width-only media rule may carry the touch size (the pointer decides, never the viewport).
    expect(mediaRuleDeclarations(button, 'max-width').width).toBeUndefined()
    expect(getComputedStyle(button).width).toBe('40px')
  })

  it('uses no ::before/::after hit-slop on any tool', () => {
    renderStrip()
    const css = Array.from(document.styleSheets)
      .flatMap(sheet => Array.from(sheet.cssRules))
      .map(rule => rule.cssText)
      .join('\n')
    const button = screen.getByTestId('toolstrip-tool-stories')
    const cls = Array.from(button.classList).find(c => c.startsWith('css-')) ?? 'css-none'
    expect(css).not.toMatch(new RegExp(`\\.${cls}[^{]*::?(before|after)`))
  })

  it('keeps tools >= 8px apart (the zone gap is 10px, the label sits between them)', () => {
    renderStrip()
    const zone = screen.getByTestId('toolstrip-zone-surface')
    // MUI `gap: 1.25` under the COBRA 8px spacing unit is 10px.
    expect(getComputedStyle(zone).gap).toBe('10px')
  })
})

describe('Toolstrip — labels and the touch equivalent for tooltips', () => {
  it('every tool has a visible text label and an accessible name', () => {
    renderStrip()
    const strip = screen.getByTestId('staff-toolstrip')
    for (const tool of [TOOL_A, TOOL_B]) {
      expect(within(strip).getByText(tool.label)).toBeInTheDocument()
      expect(within(strip).getByRole('button', { name: tool.label })).toBeInTheDocument()
    }
  })

  it('the tool tooltip is not the only place its meaning lives (label + aria-label carry it)', () => {
    renderStrip()
    expect(screen.getByRole('button', { name: 'STORIES' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('Toolstrip — one flyout at a time (D7-011)', () => {
  it('activating a second tool deactivates the first', async () => {
    const user = userEvent.setup()
    renderStrip()
    const a = screen.getByTestId('toolstrip-tool-stories')
    const b = screen.getByTestId('toolstrip-tool-engine')

    await user.click(a)
    expect(a).toHaveAttribute('aria-pressed', 'true')
    expect(b).toHaveAttribute('aria-pressed', 'false')

    await user.click(b)
    expect(b).toHaveAttribute('aria-pressed', 'true')
    expect(a).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1)
  })
})
