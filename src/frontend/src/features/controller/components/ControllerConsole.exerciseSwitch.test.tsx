/**
 * features/controller/components/ControllerConsole.exerciseSwitch.test.tsx
 * ---------------------------------------------------------------------------
 * Persona memory must not survive an exercise switch (demo-polish C4 Gate-1
 * M-2; COR-001, COR-073).
 *
 * The exercise switcher commits the new scope IN PLACE
 * (`useExerciseScopeRefresh()`): the console does not remount. So any state the
 * console keeps about "the persona the dock is open for" would carry from the
 * old exercise into the new one unless it is keyed on the exercise. Asserted:
 *
 *  - an open persona dock CLOSES when the exercise changes (in the same render
 *    the scope changes — it is derived from the exercise, not cleared a render
 *    later);
 *  - it STAYS closed if the controller switches back — the stale memory was
 *    dropped, not merely hidden;
 *  - `openComposer({ personaId })` refuses a persona that belongs to the
 *    exercise the controller just LEFT (the persona list and the route's active
 *    persona are not re-read on a switch) and opens the ⌘K palette instead — it
 *    never opens a dock for another exercise's persona.
 *
 * `resolveExerciseContext` is mocked at its module boundary (same technique as
 * `core/exerciseContext/exerciseContextRefresh.test.tsx`) so each "server" answer
 * is driven directly; the seeded cast's personas belong to `ex-mock-0001`.
 */
import { useMemo, type ReactNode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider, useExerciseScopeRefresh } from '@/core/exerciseContext'
import {
  resolveExerciseContext,
  type ExerciseScope,
} from '@/core/exerciseContext/exerciseContextResolver'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import { SEEDED_PERSONAS } from '@/features/personas'
import { reviewStore } from '../engine/services/reviewStore'
import { engineControlStore } from '../engine/hooks/useEngineControl'
import { engineSettingsStore } from '../engine/hooks/useEngineSettings'
import { composeAsPersonaDraftStore } from '../hooks/useComposeAsPersona'
import { ActivePersonaProvider, useActivePersona } from '../hooks/useActivePersona'
import { ControllerConsole } from './ControllerConsole'

vi.mock('@/core/exerciseContext/exerciseContextResolver', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext/exerciseContextResolver')>()
  return { ...actual, resolveExerciseContext: vi.fn() }
})

const mockResolve = vi.mocked(resolveExerciseContext)

/** The exercise the seeded cast belongs to. */
const HOME: ExerciseScope = {
  exerciseId: 'ex-mock-0001',
  exerciseName: 'Home Exercise',
  timeZone: 'UTC',
  status: 'live',
}
const AWAY: ExerciseScope = { ...HOME, exerciseId: 'ex-away-0002', exerciseName: 'Away Exercise' }

const PERSONA = SEEDED_PERSONAS[0]

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
  resetTelemetryBuffer()
  mockResolve.mockReset()
})

afterEach(() => {
  resetExerciseClock()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
})

/** The route stand-in: dock content derived from the active persona, as in prod. */
function RouteHarness({ children }: { children: ReactNode }) {
  const { activePersona } = useActivePersona()
  const dockSlots = useMemo(
    () =>
      activePersona
        ? { composer: <div data-testid="fake-composer" data-persona-id={activePersona.id} /> }
        : undefined,
    [activePersona],
  )
  return (
    <ControllerConsole
      dockSlots={dockSlots}
      liveWorldSlot={ctx => (
        <>
          <button type="button" onClick={() => ctx.openComposer({ personaId: PERSONA?.id })}>
            Compose
          </button>
          {children}
        </>
      )}
    />
  )
}

/** Stands in for the exercise switcher: a sibling that asks the server again. */
function Switcher() {
  const refresh = useExerciseScopeRefresh()
  return (
    <button type="button" onClick={() => void refresh()}>
      Switch exercise
    </button>
  )
}

function renderConsole() {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <ToolstripProvider>
          <ActivePersonaProvider>
            <RouteHarness>
              <Switcher />
            </RouteHarness>
            <Toolstrip />
          </ActivePersonaProvider>
        </ToolstripProvider>
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
}

async function switchExercise(user: ReturnType<typeof userEvent.setup>) {
  await act(async () => {
    await user.click(screen.getByRole('button', { name: 'Switch exercise' }))
  })
}

describe('ControllerConsole — persona memory across an exercise switch', () => {
  it('closes the open dock when the exercise changes, and does not revive it on switching back', async () => {
    if (!PERSONA) throw new Error('seeded cast is empty')
    const user = userEvent.setup()
    mockResolve.mockResolvedValueOnce(HOME)
    renderConsole()
    await screen.findByTestId('controller-console')
    await screen.findByTestId('toolstrip-badge-personas')

    await user.click(screen.getByRole('button', { name: 'Compose' }))
    expect(
      within(await screen.findByTestId('persona-dock-host')).getByTestId('fake-composer'),
    ).toHaveAttribute('data-persona-id', PERSONA.id)

    mockResolve.mockResolvedValueOnce(AWAY)
    await switchExercise(user)
    await waitFor(() => expect(screen.queryByTestId('persona-dock-host')).not.toBeInTheDocument())

    // Back to the first exercise: the dock stays closed — the memory is gone.
    mockResolve.mockResolvedValueOnce(HOME)
    await switchExercise(user)
    await waitFor(() => expect(mockResolve).toHaveBeenCalledTimes(3))
    expect(screen.queryByTestId('persona-dock-host')).not.toBeInTheDocument()
  })

  it('refuses to open a dock for a persona of the exercise just left: the palette opens instead', async () => {
    if (!PERSONA) throw new Error('seeded cast is empty')
    const user = userEvent.setup()
    mockResolve.mockResolvedValueOnce(HOME)
    renderConsole()
    await screen.findByTestId('controller-console')
    await screen.findByTestId('toolstrip-badge-personas')

    mockResolve.mockResolvedValueOnce(AWAY)
    await switchExercise(user)
    await waitFor(() => expect(mockResolve).toHaveBeenCalledTimes(2))

    await user.click(screen.getByRole('button', { name: 'Compose' }))

    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()
    expect(screen.queryByTestId('persona-dock-host')).not.toBeInTheDocument()
  })
})
