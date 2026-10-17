/**
 * features/controller/components/ControllerConsole.personaRefresh.test.tsx
 * ---------------------------------------------------------------------------
 * #450 F-1 regression (demo-feedback 24, #542): after an in-place exercise
 * switch, opening the composer for a persona of the NEW exercise works.
 *
 * Before the fix the console's `useStaffPersonas()` read was keyed on nothing,
 * so after a switch it still held the previous exercise's cast;
 * `openComposer`'s `findExercisePersona` rejected every persona of the new
 * exercise and fell back to the ⌘K palette until the console remounted.
 * Asserted here, with the console mounted ONCE across the switch:
 *
 *  - the switch triggers a second `/personas` read (the issue's named check);
 *  - `openComposer({ personaId })` for a persona of the new exercise opens the
 *    dock for THAT persona (no palette fallback);
 *  - a persona of the exercise just left is still refused (palette instead).
 *
 * `resolveExerciseContext` is mocked at its module boundary (same technique as
 * `ControllerConsole.exerciseSwitch.test.tsx`); `api.get('/personas')` answers
 * with the cast of the exercise the "server" is currently in, every other
 * request passes through to the real client (and its dev mock adapters).
 */
import { useMemo, type ReactNode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { api } from '@/core/services/api'
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
import type { StaffPersona } from '@/features/personas'
import { reviewStore } from '../engine/services/reviewStore'
import { engineControlStore } from '../engine/hooks/useEngineControl'
import { engineSettingsStore } from '../engine/hooks/useEngineSettings'
import { composeAsPersonaDraftStore } from '../hooks/useComposeAsPersona'
import { ActivePersonaProvider, useActivePersona } from '../hooks/useActivePersona'
import { ControllerConsole } from './ControllerConsole'

vi.mock('@/features/controller/access/useCanControl', () => ({
  useCanControl: () => true,
  useCanEditContent: () => true,
  useCanStaffPost: () => true,
  useCanStaffPin: () => true,
}))

vi.mock('@/core/exerciseContext/exerciseContextResolver', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext/exerciseContextResolver')>()
  return { ...actual, resolveExerciseContext: vi.fn() }
})

const mockResolve = vi.mocked(resolveExerciseContext)

const EX_A: ExerciseScope = {
  exerciseId: 'ex-a-0001',
  exerciseName: 'Exercise A',
  timeZone: 'UTC',
  status: 'live',
}
const EX_B: ExerciseScope = { ...EX_A, exerciseId: 'ex-b-0002', exerciseName: 'Exercise B' }

function staffPersona(id: string, exerciseId: string, displayName: string): StaffPersona {
  return {
    id,
    exerciseId,
    templateId: `tmpl-${id}`,
    displayName,
    handle: id.replace(/[^a-z0-9]/gi, ''),
    kind: 'human',
    personaType: 'citizen',
    verified: false,
    avatarColor: '#334455',
    initials: 'PP',
    audienceBand: 'micro',
    followerCount: 1,
    joinedAt: '2026-01-01T00:00:00.000Z',
  }
}

const PERSONA_A = staffPersona('persona-a-1', EX_A.exerciseId, 'Alpha One')
const PERSONA_B = staffPersona('persona-b-1', EX_B.exerciseId, 'Bravo One')
const CASTS: Record<string, StaffPersona[]> = {
  [EX_A.exerciseId]: [PERSONA_A],
  [EX_B.exerciseId]: [PERSONA_B],
}

/** The exercise the "server" session is in — what `/personas` answers for. */
let serverExerciseId = EX_A.exerciseId
let personaReads = 0

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
  resetTelemetryBuffer()
  mockResolve.mockReset()
  serverExerciseId = EX_A.exerciseId
  personaReads = 0

  const realGet = api.get.bind(api)
  vi.spyOn(api, 'get').mockImplementation(((url: string, config?: Parameters<typeof api.get>[1]) => {
    if (url === '/personas') {
      personaReads += 1
      return Promise.resolve({ data: CASTS[serverExerciseId] ?? [] })
    }
    return realGet(url, config)
  }) as typeof api.get)
})

afterEach(() => {
  vi.restoreAllMocks()
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
          <button type="button" onClick={() => ctx.openComposer({ personaId: PERSONA_B.id })}>
            Compose as B
          </button>
          <button type="button" onClick={() => ctx.openComposer({ personaId: PERSONA_A.id })}>
            Compose as A
          </button>
          {children}
        </>
      )}
    />
  )
}

/** Stands in for the exercise switcher: the server moves, then the scope is re-asked. */
function Switcher() {
  const refresh = useExerciseScopeRefresh()
  return (
    <button
      type="button"
      onClick={() => {
        serverExerciseId = EX_B.exerciseId
        void refresh()
      }}
    >
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

async function switchToB(user: ReturnType<typeof userEvent.setup>) {
  mockResolve.mockResolvedValueOnce(EX_B)
  await act(async () => {
    await user.click(screen.getByRole('button', { name: 'Switch exercise' }))
  })
  await waitFor(() => expect(mockResolve).toHaveBeenCalledTimes(2))
}

describe('ControllerConsole — persona list refreshes on an exercise switch (#450 F-1)', () => {
  // 20s per-test budget: heavy emotion/MUI render + user-event when the run is loaded.
  it('re-reads /personas on the switch and opens the composer for a persona of the new exercise', async () => {
    const user = userEvent.setup()
    mockResolve.mockResolvedValueOnce(EX_A)
    renderConsole()
    await screen.findByTestId('controller-console')
    await screen.findByTestId('toolstrip-badge-personas')
    const readsBeforeSwitch = personaReads
    expect(readsBeforeSwitch).toBeGreaterThan(0)

    await switchToB(user)
    await waitFor(() => expect(personaReads).toBeGreaterThan(readsBeforeSwitch))
    // Let the new exercise's read land before acting on it.
    await act(async () => {})

    await user.click(screen.getByRole('button', { name: 'Compose as B' }))

    expect(
      within(await screen.findByTestId('persona-dock-host')).getByTestId('fake-composer'),
    ).toHaveAttribute('data-persona-id', PERSONA_B.id)
    expect(screen.queryByRole('dialog', { name: /command palette/i })).not.toBeInTheDocument()
  }, 20000)

  // 20s per-test budget, as above.
  it('still refuses a persona of the exercise just left: the palette opens instead', async () => {
    const user = userEvent.setup()
    mockResolve.mockResolvedValueOnce(EX_A)
    renderConsole()
    await screen.findByTestId('toolstrip-badge-personas')
    const readsBeforeSwitch = personaReads

    await switchToB(user)
    await waitFor(() => expect(personaReads).toBeGreaterThan(readsBeforeSwitch))
    // Let the new exercise's read land before acting on it.
    await act(async () => {})

    await user.click(screen.getByRole('button', { name: 'Compose as A' }))

    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()
    expect(screen.queryByTestId('persona-dock-host')).not.toBeInTheDocument()
  }, 20000)
})
