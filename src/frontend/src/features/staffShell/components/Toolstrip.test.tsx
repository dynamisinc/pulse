/**
 * features/staffShell/components/Toolstrip.test.tsx
 * ---------------------------------------------------------------------------
 * Story 02 (Toolstrip dock) — RTL coverage for `<Toolstrip>` (D7-011,
 * COR-063, NFR-001):
 *
 *  - Renders the shell-global zone + a divider + the surface zone as ONE
 *    dock, even with an empty registry (the shell-owned structure doesn't
 *    depend on any tool being registered yet).
 *  - A tool registered via `useRegisterSurfaceTool()` in a realistic
 *    registrant harness actually appears in the dock, in the surface zone,
 *    with a screen-reader-labelled badge.
 *  - Tools are real, keyboard-operable buttons — Enter toggles `aria-pressed`.
 *  - An escalating badge is flagged distinctly from a non-escalating one
 *    (never color-only — the count text is present either way; escalation
 *    adds a further, separately-assertable treatment).
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { faFlag } from '@fortawesome/free-solid-svg-icons'
import { Toolstrip } from './Toolstrip'
import { ToolstripProvider, useRegisterSurfaceTool, type SurfaceTool } from '../toolRegistry'

const STORIES_TOOL: SurfaceTool = {
  id: 'stories',
  label: 'STORIES',
  icon: faFlag,
  tooltip: 'Storylines — controller toolbox',
}

function SurfaceRegistrant({ tool }: { tool: SurfaceTool }) {
  useRegisterSurfaceTool(tool)
  return null
}

describe('Toolstrip — shell-owned dock structure (AC1)', () => {
  it('renders a shell-global zone, a divider, and a surface zone as one dock, even with no tools registered', () => {
    render(
      <ToolstripProvider>
        <Toolstrip />
      </ToolstripProvider>,
    )

    expect(screen.getByTestId('staff-toolstrip')).toBeInTheDocument()
    expect(screen.getByTestId('toolstrip-zone-shell-global')).toBeInTheDocument()
    expect(screen.getByTestId('toolstrip-divider')).toBeInTheDocument()
    expect(screen.getByTestId('toolstrip-zone-surface')).toBeInTheDocument()
  })
})

describe('Toolstrip — a registered surface tool renders in the dock (AC2)', () => {
  it('appears as a focusable tool button inside the surface zone (never the shell-global zone)', () => {
    render(
      <ToolstripProvider>
        <SurfaceRegistrant tool={STORIES_TOOL} />
        <Toolstrip />
      </ToolstripProvider>,
    )

    const surfaceZone = screen.getByTestId('toolstrip-zone-surface')
    expect(within(surfaceZone).getByTestId('toolstrip-tool-stories')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('toolstrip-zone-shell-global')).queryByTestId('toolstrip-tool-stories'),
    ).not.toBeInTheDocument()
  })
})

describe('Toolstrip — badge is screen-reader labelled with its count (AC3, NFR-001)', () => {
  it('a non-escalating badge is labelled with its count in words', () => {
    render(
      <ToolstripProvider>
        <SurfaceRegistrant tool={{ ...STORIES_TOOL, badge: { count: 3 } }} />
        <Toolstrip />
      </ToolstripProvider>,
    )

    expect(screen.getByRole('button', { name: 'STORIES: 3 pending' })).toBeInTheDocument()
    expect(screen.getByTestId('toolstrip-badge-stories')).toHaveTextContent('3')
    expect(screen.getByTestId('toolstrip-badge-stories')).toHaveAttribute('data-escalating', 'false')
  })

  it('an escalating badge is labelled AND visually flagged distinctly, but the count text is present either way', () => {
    render(
      <ToolstripProvider>
        <SurfaceRegistrant tool={{ ...STORIES_TOOL, badge: { count: 5, escalating: true } }} />
        <Toolstrip />
      </ToolstripProvider>,
    )

    expect(screen.getByRole('button', { name: 'STORIES: 5 pending, escalating' })).toBeInTheDocument()
    const badge = screen.getByTestId('toolstrip-badge-stories')
    expect(badge).toHaveTextContent('5')
    expect(badge).toHaveAttribute('data-escalating', 'true')
  })
})

describe('Toolstrip — keyboard operability (NFR-001)', () => {
  it('a tool button is focusable and Enter toggles its active (aria-pressed) state', async () => {
    const user = userEvent.setup()

    render(
      <ToolstripProvider>
        <SurfaceRegistrant tool={STORIES_TOOL} />
        <Toolstrip />
      </ToolstripProvider>,
    )

    const button = screen.getByTestId('toolstrip-tool-stories')
    expect(button).toHaveAttribute('aria-pressed', 'false')

    // `user.tab()` (not a raw `.focus()` call) so any Tooltip/ButtonBase
    // focus-triggered state update is wrapped in `act(...)` by user-event.
    await user.tab()
    expect(button).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(button).toHaveAttribute('aria-pressed', 'true')

    await user.keyboard('{Enter}')
    expect(button).toHaveAttribute('aria-pressed', 'false')
  })
})
