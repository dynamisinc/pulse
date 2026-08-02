/**
 * features/controller/components/ControllerConsole.personaDraftDiscard.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the EXPLICIT close-and-discard fix (feature: autonomy-safety, story
 * 06): `ControllerConsole`'s `closeDock` — the handler `<PersonaDockHost>`
 * calls on Esc/X — discards the persisted draft (`useComposeAsPersona`'s
 * Gate-1 WR-103 mirror) for whichever persona was active, so an
 * explicitly-dismissed draft never silently pre-fills a later compose for the
 * SAME persona. `useComposeAsPersona.test.ts` proves the underlying store
 * primitive in isolation; THIS file drives the REAL Esc/X through the actual
 * production wiring (`ControllerConsole` → `PersonaDockHost` → `closeDock`),
 * mounting the real `<PersonaComposer>` into the dock's `composer` slot —
 * exactly as the `/console` route wires it at integration.
 *
 * Also proves the fix is correctly SCOPED: activating the ENGINE settings
 * tool closes the dock for an UNRELATED reason (Gate-1 WR-005) and must NOT
 * discard the draft — only the operator's own explicit Esc/X does.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
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
import { PersonaComposer } from './PersonaComposer'
import { ControllerConsole } from './ControllerConsole'

/** The fixed exercise id `ExerciseContextProvider`'s mock resolver returns. */
const EXERCISE_ID = 'ex-mock-0001'

const ACTIVE_PERSONA: StaffPersona = {
  id: 'persona-fairhavenwater',
  exerciseId: EXERCISE_ID,
  templateId: 'tmpl-fairhaven-water',
  displayName: 'Fairhaven Water',
  handle: 'FairhavenWater',
  kind: 'org',
  personaType: 'agency',
  verified: true,
  avatarColor: '#1d4ed8',
  initials: 'FW',
  audienceBand: 'mid',
  followerCount: 4200,
  joinedAt: '2030-01-01T00:00:00Z',
}

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
})

function renderConsole() {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <ToolstripProvider>
          <ControllerConsole
            renderPersonaResults={({ onSelectPersona }) => (
              <button
                type="button"
                data-testid="pick-persona"
                onClick={() => onSelectPersona(ACTIVE_PERSONA.id)}
              >
                pick Fairhaven Water
              </button>
            )}
            dockSlots={{
              composer: (
                <PersonaComposer
                  activePersona={ACTIVE_PERSONA}
                  actingHumanId="human-ctl-7"
                  callSign="SIMCELL-1"
                />
              ),
            }}
          />
          <Toolstrip />
        </ToolstripProvider>
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
}

/**
 * Opens the persona dock and puts `text` in the composer.
 *
 * The draft text is set with ONE `fireEvent.change`, not `userEvent.type`. What
 * these tests assert is what `closeDock` does to a NON-EMPTY draft; the
 * keystrokes that made it non-empty are not under test, and a controlled field
 * reaches an identical state either way. Replaying them costs ~50ms per
 * character in this tree (the whole console re-renders per keystroke through
 * MUI/emotion), which is why these tests already carry a hand-raised 20000ms
 * timeout — and they blew through even that under full-suite load. Removing the
 * cost is the fix; raising the ceiling again is not. See the same change and its
 * measurements in `engine/components/EngineDraftEditComposer.test.tsx`.
 *
 * The 20000ms per-test overrides are KEPT, because what remains under them is
 * real: each test drives several genuine `userEvent` interactions (open the
 * tool, pick the persona, Esc/X, reopen) through the whole console, ~3-4.5s
 * on an idle machine, down from ~4-6.7s. That is the behavior under test, not
 * overhead — unlike the keystroke replay, which was neither.
 */
async function openDockAndType(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(await screen.findByTestId('toolstrip-tool-personas'))
  await user.click(await screen.findByTestId('pick-persona'))
  const field = await screen.findByRole('textbox', { name: 'Post text' })
  fireEvent.change(field, { target: { value: text } })
  return field
}

describe('ControllerConsole — the persona dock\'s explicit Esc/X close discards the draft (autonomy-safety story 06)', () => {
  it('typing a draft then pressing Escape, then reopening the SAME persona, starts EMPTY — not the dismissed text', async () => {
    const user = userEvent.setup()
    renderConsole()
    await screen.findByTestId('controller-console')

    const field = await openDockAndType(user, 'Boil-water notice lifted for Zone 3.')
    expect(field).toHaveValue('Boil-water notice lifted for Zone 3.')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('persona-dock-host')).not.toBeInTheDocument())

    // Reopen the SAME persona — the explicit discard must mean this starts
    // empty, not silently pre-filled with the dismissed text.
    await user.click(await screen.findByTestId('toolstrip-tool-personas'))
    await user.click(await screen.findByTestId('pick-persona'))
    const reopenedField = await screen.findByRole('textbox', { name: 'Post text' })
    expect(reopenedField).toHaveValue('')
  }, 20000)

  it('typing a draft then clicking the X close button also discards it', async () => {
    const user = userEvent.setup()
    renderConsole()
    await screen.findByTestId('controller-console')

    const field = await openDockAndType(user, 'Only for this session.')
    expect(field).toHaveValue('Only for this session.')

    const closeButton = screen.getByRole('button', { name: /close post-as-persona panel/i })
    await user.click(closeButton)
    await waitFor(() => expect(screen.queryByTestId('persona-dock-host')).not.toBeInTheDocument())

    await user.click(await screen.findByTestId('toolstrip-tool-personas'))
    await user.click(await screen.findByTestId('pick-persona'))
    const reopenedField = await screen.findByRole('textbox', { name: 'Post text' })
    expect(reopenedField).toHaveValue('')
  }, 20000)

  it('SCOPING: activating ENGINE (an UNRELATED reason the dock closes, Gate-1 WR-005) does NOT discard the draft', async () => {
    const user = userEvent.setup()
    renderConsole()
    await screen.findByTestId('controller-console')

    const field = await openDockAndType(user, 'Still mid-thought.')
    expect(field).toHaveValue('Still mid-thought.')

    // ENGINE activating closes the dock for a reason that is NOT the operator
    // choosing to discard their text (WR-005) — the draft must survive.
    await user.click(await screen.findByTestId('toolstrip-tool-engine-settings'))
    await waitFor(() => expect(screen.queryByTestId('persona-dock-host')).not.toBeInTheDocument())
    expect(await screen.findByTestId('engine-settings-panel')).toBeInTheDocument()

    // Close ENGINE and reopen the SAME persona — the draft must still be there.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('engine-settings-panel')).not.toBeInTheDocument())

    await user.click(await screen.findByTestId('toolstrip-tool-personas'))
    await user.click(await screen.findByTestId('pick-persona'))
    const reopenedField = await screen.findByRole('textbox', { name: 'Post text' })
    expect(reopenedField).toHaveValue('Still mid-thought.')
  }, 20000)
})
