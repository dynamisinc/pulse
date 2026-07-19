/**
 * features/controller/components/ControllerConsole.badge.test.tsx
 * ---------------------------------------------------------------------------
 * TESTER-added coverage for story 01 (console-shell) AC "A tool's toolstrip
 * icon carries a status badge ... never color alone (NFR-001)" — specifically
 * the badge SHAPE `ControllerConsole` derives from `usePersonas()`, which
 * `ControllerConsole.test.tsx` only spot-checks against the real seeded cast
 * (`Number(badge.textContent) > 0`). Here `@/features/personas` is mocked so
 * the persona count is a controlled, exact value:
 *
 *  - a ZERO persona count omits the badge entirely (the "badge is omitted
 *    while empty" comment in `ControllerConsole.tsx`) and the accessible name
 *    is the plain label, with no "0 pending" ever announced;
 *  - a non-zero count renders the badge with EXACTLY that count (not just
 *    "some positive number") in both the visible digits and the accessible
 *    name — the never-color-only signal (NFR-001);
 *  - the badge is explicitly NON-escalating (`data-escalating="false"`) —
 *    this story wires no attention source yet (see `ControllerConsole.tsx`'s
 *    "Phase-1 badge" comment), so a future change that flips this on by
 *    accident (e.g. always-escalating) should fail this test.
 *
 * Each test is a single-failure-mode probe: change the badge math in
 * `ControllerConsole.tsx` (drop the `personaCount > 0` guard, or hardcode a
 * count/escalating value) and exactly one of these fails.
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import type { Persona } from '@/features/personas'
import { usePersonas } from '@/features/personas'
import { ControllerConsole } from './ControllerConsole'

vi.mock('@/features/personas', async () => {
  const actual = await vi.importActual<typeof import('@/features/personas')>('@/features/personas')
  return { ...actual, usePersonas: vi.fn() }
})

const mockedUsePersonas = vi.mocked(usePersonas)

function personaStub(id: string): Persona {
  return {
    id,
    displayName: `Persona ${id}`,
    handle: `@${id}`,
    kind: 'human',
    verified: false,
  } as Persona
}

function renderConsole() {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <ToolstripProvider>
          <ControllerConsole />
          <Toolstrip />
        </ToolstripProvider>
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
}

describe('ControllerConsole — Personas badge shape', () => {
  it('omits the badge entirely when the persona count is zero', async () => {
    mockedUsePersonas.mockReturnValue({ personas: [], loading: false, error: undefined })
    renderConsole()

    const surfaceZone = await screen.findByTestId('toolstrip-zone-surface')
    const personasButton = await within(surfaceZone).findByTestId('toolstrip-tool-personas')

    expect(screen.queryByTestId('toolstrip-badge-personas')).not.toBeInTheDocument()
    expect(personasButton).toHaveAccessibleName('PERSONAS')
  })

  it('renders the badge with the EXACT persona count, never-escalating', async () => {
    mockedUsePersonas.mockReturnValue({
      personas: [personaStub('a'), personaStub('b'), personaStub('c')],
      loading: false,
      error: undefined,
    })
    renderConsole()

    const badge = await screen.findByTestId('toolstrip-badge-personas')
    expect(badge).toHaveTextContent('3')
    expect(badge).toHaveAttribute('data-escalating', 'false')

    const surfaceZone = screen.getByTestId('toolstrip-zone-surface')
    const personasButton = within(surfaceZone).getByTestId('toolstrip-tool-personas')
    expect(personasButton).toHaveAccessibleName('PERSONAS: 3 pending')
  })
})
