/**
 * features/controller/components/ControllerConsole.integrationSeams.test.tsx
 * ---------------------------------------------------------------------------
 * The two seams the Wave 3 integration added to `ControllerConsole` (demo-polish; Wave 3
 * Gate-2 checks 22 / 26; C5 Gate-1 M-3; PE-FE Gate-1 M-2):
 *
 *  1. ⌘K / Ctrl+K YIELDS TO OTHER MODALS. While any `[aria-modal="true"]` layer outside the
 *     console is mounted (a run-sheet dialog, C5's takedown confirm, PE-FE's persona edit
 *     dialog - plain MUI Dialogs - or the shell's Pause overlay) the chord does nothing:
 *     opened over it, the palette would sit hidden behind the dialog while its focus-on-open
 *     fought the dialog's focus trap. With no other modal it still toggles the palette, and
 *     the palette's OWN panel (an `aria-modal` inside the console) never counts as "another".
 *
 *  2. `onDockClose`. Reported once when an OPEN persona dock closes, for any reason (the
 *     operator's X / Esc, the ENGINE flyout taking over), never at mount and never when the
 *     dock only changes persona - the route drops its reply target from it.
 *
 * Mirrors `ControllerConsole.slots.test.tsx`'s render setup (real `ExerciseContextProvider`
 * + `ToolstripProvider` + the shipped `<Toolstrip>`).
 */
import { useState, type ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { SEEDED_PERSONAS, type StaffPersona } from '@/features/personas'
import { postStore } from '@/features/social/services/postStore'
import { reviewStore } from '../engine/services/reviewStore'
import { engineControlStore } from '../engine/hooks/useEngineControl'
import { engineSettingsStore } from '../engine/hooks/useEngineSettings'
import { composeAsPersonaDraftStore } from '../hooks/useComposeAsPersona'
import { ActivePersonaProvider, useActivePersona } from '../hooks/useActivePersona'
import { ControllerConsole, type ControllerConsoleProps } from './ControllerConsole'

vi.setConfig({ testTimeout: 30_000 })

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

function seeded(id: string): StaffPersona {
  const found = SEEDED_PERSONAS.find(persona => persona.id === id)
  if (found === undefined) throw new Error(`seeded persona ${id} not found`)
  return found
}
const PERSONA_X = seeded('persona-fulcoem')
const PERSONA_Y = seeded('persona-fairhavenwater')
const PICKABLE = [PERSONA_X, PERSONA_Y]

/** A console whose palette lists two personas as buttons (select, then report the id). */
function Harness(props: ControllerConsoleProps) {
  const { selectPersona } = useActivePersona()
  return (
    <ControllerConsole
      renderPersonaResults={({ onSelectPersona }) => (
        <>
          {PICKABLE.map(persona => (
            <button
              key={persona.id}
              type="button"
              onClick={() => {
                selectPersona(persona)
                onSelectPersona(persona.id)
              }}
            >
              {`pick ${persona.id}`}
            </button>
          ))}
        </>
      )}
      {...props}
    />
  )
}

function renderConsole(props: ControllerConsoleProps = {}, extra?: ReactNode) {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <ToolstripProvider>
          <ActivePersonaProvider>
            <Harness {...props} />
            <Toolstrip />
            {extra}
          </ActivePersonaProvider>
        </ToolstripProvider>
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
}

const palette = () => screen.queryByRole('dialog', { name: /command palette/i })

/** A plain MUI Dialog - what C5's takedown confirm and PE-FE's persona edit dialog are. */
function PlainDialog({ onClose }: { onClose?: () => void }) {
  return (
    <Dialog open onClose={onClose}>
      <div>A modal question</div>
    </Dialog>
  )
}

/** A toggleable modal, so a test can mount and unmount it mid-way. */
function ToggleableDialog() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(current => !current)}>toggle dialog</button>
      {open && <PlainDialog onClose={() => setOpen(false)} />}
    </>
  )
}

describe('ControllerConsole - ⌘K yields to another modal', () => {
  it('opens the palette on Ctrl+K and on Meta+K when nothing else is modal', async () => {
    const user = userEvent.setup({ delay: null })
    renderConsole()
    await screen.findByTestId('controller-console')

    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(palette()).toBeNull())

    await user.keyboard('{Meta>}k{/Meta}')
    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()
  })

  it('closes the open palette on a second Ctrl+K (its own aria-modal panel is not "another")', async () => {
    const user = userEvent.setup({ delay: null })
    renderConsole()
    await screen.findByTestId('controller-console')

    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()
    await user.keyboard('{Control>}k{/Control}')
    await waitFor(() => expect(palette()).toBeNull())
  })

  // Two separate chords, two separate renders: Ctrl+K then Meta+K in one test would TOGGLE the
  // palette open and shut again and pass for the wrong reason.
  it.each([
    ['Ctrl+K', '{Control>}k{/Control}'],
    ['Meta+K', '{Meta>}k{/Meta}'],
  ])('does NOTHING on %s while a plain MUI Dialog is open', async (_name, chord) => {
    const user = userEvent.setup({ delay: null })
    renderConsole({}, <PlainDialog />)
    await screen.findByTestId('controller-console')
    expect(await screen.findByText('A modal question')).toBeInTheDocument()

    await user.keyboard(chord)

    // By test id: MUI hides the rest of the page from the a11y tree while its dialog is open,
    // so a role query would find nothing even if the palette HAD opened behind it.
    expect(screen.queryByTestId('command-palette')).toBeNull()
    // The "Personas" tool did not toggle either (the toolstrip button is the palette's state).
    expect(screen.getByTestId('toolstrip-tool-personas')).toHaveAttribute('aria-pressed', 'false')
  })

  it('still swallows the chord while ignoring it (the browser\'s own Ctrl+K must not fire)', async () => {
    renderConsole({}, <PlainDialog />)
    await screen.findByText('A modal question')
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(screen.queryByTestId('command-palette')).toBeNull()
  })

  it('ignores the chord for any aria-modal layer, e.g. the shell\'s Pause overlay', async () => {
    const user = userEvent.setup({ delay: null })
    renderConsole({}, (
      <div role="dialog" aria-modal="true" aria-label="Exercise paused" data-shell-layer="">
        paused
      </div>
    ))
    await screen.findByTestId('controller-console')

    await user.keyboard('{Control>}k{/Control}')
    expect(screen.queryByTestId('command-palette')).toBeNull()
  })

  it('works again as soon as the other modal is gone', async () => {
    const user = userEvent.setup({ delay: null })
    renderConsole({}, <ToggleableDialog />)
    await screen.findByTestId('controller-console')
    expect(await screen.findByText('A modal question')).toBeInTheDocument()

    await user.keyboard('{Control>}k{/Control}')
    expect(screen.queryByTestId('command-palette')).toBeNull()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText('A modal question')).toBeNull())

    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()
  })
})

describe('ControllerConsole - onDockClose', () => {
  /** Opens the dock for `persona-fulcoem` through the palette. */
  async function openDock(user: ReturnType<typeof userEvent.setup>) {
    await user.keyboard('{Control>}k{/Control}')
    await user.click(await screen.findByRole('button', { name: `pick ${PERSONA_X.id}` }))
    expect(await screen.findByTestId('persona-dock-host')).toBeInTheDocument()
  }

  it('is not called at mount, nor while the dock only opens', async () => {
    const onDockClose = vi.fn()
    const user = userEvent.setup({ delay: null })
    renderConsole({ onDockClose })
    await screen.findByTestId('controller-console')
    expect(onDockClose).not.toHaveBeenCalled()

    await openDock(user)
    expect(onDockClose).not.toHaveBeenCalled()
  })

  it('is called once when the operator closes the dock (X button)', async () => {
    const onDockClose = vi.fn()
    const user = userEvent.setup({ delay: null })
    renderConsole({ onDockClose })
    await screen.findByTestId('controller-console')
    await openDock(user)

    await user.click(screen.getByRole('button', { name: 'Close post-as-persona panel' }))
    await waitFor(() => expect(screen.queryByTestId('persona-dock-host')).toBeNull())
    expect(onDockClose).toHaveBeenCalledTimes(1)
  })

  it('is called once when Esc closes the dock', async () => {
    const onDockClose = vi.fn()
    const user = userEvent.setup({ delay: null })
    renderConsole({ onDockClose })
    await screen.findByTestId('controller-console')
    await openDock(user)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('persona-dock-host')).toBeNull())
    expect(onDockClose).toHaveBeenCalledTimes(1)
  })

  it('is called when the ENGINE flyout takes the dock over (a non-explicit close)', async () => {
    const onDockClose = vi.fn()
    const user = userEvent.setup({ delay: null })
    renderConsole({ onDockClose })
    await screen.findByTestId('controller-console')
    await openDock(user)

    await user.click(await screen.findByTestId('toolstrip-tool-engine-settings'))
    await waitFor(() => expect(screen.queryByTestId('persona-dock-host')).toBeNull())
    expect(onDockClose).toHaveBeenCalledTimes(1)
  })

  it('is NOT called when the open dock merely changes persona', async () => {
    const onDockClose = vi.fn()
    const user = userEvent.setup({ delay: null })
    renderConsole({ onDockClose })
    await screen.findByTestId('controller-console')
    await openDock(user)

    await user.keyboard('{Control>}k{/Control}')
    await user.click(await screen.findByRole('button', { name: `pick ${PERSONA_Y.id}` }))
    await waitFor(() => expect(palette()).toBeNull())
    expect(screen.getByTestId('persona-dock-host')).toBeInTheDocument()
    expect(onDockClose).not.toHaveBeenCalled()
  })
})
