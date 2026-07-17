/**
 * features/staffShell/toolRegistry.test.tsx
 * ---------------------------------------------------------------------------
 * Story 02 (Toolstrip dock — tool-registration API) — coverage for the
 * `ToolstripProvider` / `useRegisterSurfaceTool` / `useRegisterShellGlobalTool`
 * / `useToolstrip` seam (D7-011, XC-001):
 *
 *  - Every hook throws when called outside a `<ToolstripProvider>` — no
 *    default/module-global registry (fail-closed, mirroring
 *    `useExerciseContext()`).
 *  - `useRegisterSurfaceTool` registers into the SURFACE zone only; it never
 *    leaks into the shell-global zone.
 *  - `useRegisterShellGlobalTool` registers into the SHELL-GLOBAL zone only.
 *  - A registered tool's badge updates live when the registering component
 *    re-renders with a new badge (not just at mount).
 *  - Unmounting the registering component unregisters its tool.
 *  - `toggleTool` activates/deactivates, and only ONE tool is ever active at
 *    a time, across BOTH zones.
 *
 * A small `Probe` harness renders whatever `useToolstrip()` currently exposes
 * as plain text/DOM so assertions read the REAL hook output, not a
 * re-implemented fixture (WAVE0-REVIEW precedent 17, no tautological tests).
 */
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { faFlag, faUserGroup } from '@fortawesome/free-solid-svg-icons'
import {
  ToolstripProvider,
  useRegisterShellGlobalTool,
  useRegisterSurfaceTool,
  useToolstrip,
  type SurfaceTool,
} from './toolRegistry'

/** Renders the current registry state as plain, assertable DOM. */
function ToolstripProbe() {
  const { shellGlobalTools, surfaceTools, activeToolId, toggleTool } = useToolstrip()

  return (
    <div>
      <ul data-testid="shell-global-tools">
        {shellGlobalTools.map(tool => (
          <li key={tool.id} data-testid={`sg-${tool.id}`}>
            {tool.label}:{tool.badge?.count ?? 'no-badge'}
          </li>
        ))}
      </ul>
      <ul data-testid="surface-tools">
        {surfaceTools.map(tool => (
          <li key={tool.id} data-testid={`sf-${tool.id}`}>
            {tool.label}:{tool.badge?.count ?? 'no-badge'}
          </li>
        ))}
      </ul>
      <div data-testid="active-tool-id">{activeToolId ?? 'none'}</div>
      <button type="button" onClick={() => toggleTool('stories')}>toggle stories</button>
      <button type="button" onClick={() => toggleTool('admin')}>toggle admin</button>
    </div>
  )
}

const STORIES_TOOL: SurfaceTool = {
  id: 'stories',
  label: 'STORIES',
  icon: faFlag,
  tooltip: 'Storylines',
}

const ADMIN_TOOL: SurfaceTool = {
  id: 'admin',
  label: 'ADMIN',
  icon: faUserGroup,
  tooltip: 'Participant admin',
}

describe('toolRegistry — fail-closed outside a <ToolstripProvider>', () => {
  it('useToolstrip() throws rather than returning a default/undefined registry', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    function Bare() {
      useToolstrip()
      return null
    }

    expect(() => render(<Bare />)).toThrow(/ToolstripProvider/)
    consoleSpy.mockRestore()
  })

  it('useRegisterSurfaceTool() throws rather than silently registering nowhere', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    function Bare() {
      useRegisterSurfaceTool(STORIES_TOOL)
      return null
    }

    expect(() => render(<Bare />)).toThrow(/ToolstripProvider/)
    consoleSpy.mockRestore()
  })

  it('useRegisterShellGlobalTool() throws rather than silently registering nowhere', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    function Bare() {
      useRegisterShellGlobalTool(ADMIN_TOOL)
      return null
    }

    expect(() => render(<Bare />)).toThrow(/ToolstripProvider/)
    consoleSpy.mockRestore()
  })
})

describe('useRegisterSurfaceTool — registers into the surface zone only', () => {
  function SurfaceRegistrant() {
    useRegisterSurfaceTool(STORIES_TOOL)
    return null
  }

  it('appears in surfaceTools with its data, and never in shellGlobalTools', () => {
    render(
      <ToolstripProvider>
        <SurfaceRegistrant />
        <ToolstripProbe />
      </ToolstripProvider>,
    )

    expect(within(screen.getByTestId('surface-tools')).getByTestId('sf-stories')).toHaveTextContent('STORIES:no-badge')
    expect(screen.queryByTestId('sg-stories')).not.toBeInTheDocument()
  })

  it('unregisters when the registering component unmounts', () => {
    function Wrapper({ mounted }: { mounted: boolean }) {
      return (
        <ToolstripProvider>
          {mounted && <SurfaceRegistrant />}
          <ToolstripProbe />
        </ToolstripProvider>
      )
    }

    const { rerender } = render(<Wrapper mounted />)
    expect(screen.getByTestId('sf-stories')).toBeInTheDocument()

    rerender(<Wrapper mounted={false} />)
    expect(screen.queryByTestId('sf-stories')).not.toBeInTheDocument()
  })

  it('upserts (updates) the tool in place when its badge changes, not just at mount', async () => {
    const user = userEvent.setup()

    function RegistrantWithBadge() {
      const [count, setCount] = useState(1)
      useRegisterSurfaceTool({ ...STORIES_TOOL, badge: { count } })
      return <button type="button" onClick={() => setCount(c => c + 1)}>bump</button>
    }

    render(
      <ToolstripProvider>
        <RegistrantWithBadge />
        <ToolstripProbe />
      </ToolstripProvider>,
    )

    expect(screen.getByTestId('sf-stories')).toHaveTextContent('STORIES:1')

    await user.click(screen.getByRole('button', { name: 'bump' }))

    expect(screen.getByTestId('sf-stories')).toHaveTextContent('STORIES:2')
    // Still exactly one entry for this id — an upsert, not a duplicate append.
    expect(within(screen.getByTestId('surface-tools')).getAllByTestId('sf-stories')).toHaveLength(1)
  })
})

describe('useRegisterShellGlobalTool — registers into the shell-global zone only', () => {
  function ShellGlobalRegistrant() {
    useRegisterShellGlobalTool(ADMIN_TOOL)
    return null
  }

  it('appears in shellGlobalTools, and never in surfaceTools', () => {
    render(
      <ToolstripProvider>
        <ShellGlobalRegistrant />
        <ToolstripProbe />
      </ToolstripProvider>,
    )

    expect(within(screen.getByTestId('shell-global-tools')).getByTestId('sg-admin')).toHaveTextContent('ADMIN:no-badge')
    expect(screen.queryByTestId('sf-admin')).not.toBeInTheDocument()
  })
})

describe('ToolstripProvider — exercise-scoped state (XC-001): a remount starts clean', () => {
  it('does not carry over a previous mount\'s registered tools or active tool id (simulating a new exercise)', async () => {
    const user = userEvent.setup()

    function Scenario() {
      useRegisterSurfaceTool(STORIES_TOOL)
      useRegisterShellGlobalTool(ADMIN_TOOL)
      return <ToolstripProbe />
    }

    const { unmount } = render(
      <ToolstripProvider>
        <Scenario />
      </ToolstripProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'toggle stories' }))
    expect(screen.getByTestId('active-tool-id')).toHaveTextContent('stories')
    expect(screen.getByTestId('sf-stories')).toBeInTheDocument()
    expect(screen.getByTestId('sg-admin')).toBeInTheDocument()

    // Unmount entirely (e.g. leaving the exercise) — a module-global registry
    // would still hold `stories`/`admin` and the active id at this point.
    unmount()

    // A brand-new provider instance (a new exercise), with no registrants yet.
    render(
      <ToolstripProvider>
        <ToolstripProbe />
      </ToolstripProvider>,
    )

    expect(screen.getByTestId('active-tool-id')).toHaveTextContent('none')
    expect(screen.queryByTestId('sf-stories')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sg-admin')).not.toBeInTheDocument()
  })
})

describe('toggleTool — one active tool at a time, across both zones', () => {
  function BothRegistrants() {
    useRegisterShellGlobalTool(ADMIN_TOOL)
    useRegisterSurfaceTool(STORIES_TOOL)
    return null
  }

  it('activates a tool, then switches the active tool when another is toggled, never both at once', async () => {
    const user = userEvent.setup()

    render(
      <ToolstripProvider>
        <BothRegistrants />
        <ToolstripProbe />
      </ToolstripProvider>,
    )

    expect(screen.getByTestId('active-tool-id')).toHaveTextContent('none')

    await user.click(screen.getByRole('button', { name: 'toggle stories' }))
    expect(screen.getByTestId('active-tool-id')).toHaveTextContent('stories')

    // Activating the shell-global tool closes the surface tool's flyout —
    // exactly one active id, regardless of which zone either tool is in.
    await user.click(screen.getByRole('button', { name: 'toggle admin' }))
    expect(screen.getByTestId('active-tool-id')).toHaveTextContent('admin')

    // Toggling the already-active tool deactivates it (closes the flyout).
    await user.click(screen.getByRole('button', { name: 'toggle admin' }))
    expect(screen.getByTestId('active-tool-id')).toHaveTextContent('none')
  })
})
