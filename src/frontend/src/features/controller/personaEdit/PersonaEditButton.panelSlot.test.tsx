/**
 * features/controller/personaEdit/PersonaEditButton.panelSlot.test.tsx
 * ---------------------------------------------------------------------------
 * The orchestrator's mounting contract (implementation.md §4.2): the console route
 * passes `actionsSlot={<PersonaEditButton persona={activePersona}/>}` to C4's
 * `PersonaContextPanel`. This composes exactly that, in the same provider stack the
 * route uses, and checks the two halves meet: the button sits in the panel's
 * actions slot, and after a save the panel — which renders the ACTIVE persona's
 * bio — shows the edit, because the hook refreshed the active-persona snapshot
 * (`selectPersona(updated)`). Neither `PersonaContextPanel` nor the route file is
 * edited by this story.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, describe, expect, it } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SEEDED_PERSONAS, type StaffPersona } from '@/features/personas'
import { PersonaContextPanel } from '../components/PersonaContextPanel'
import { ActivePersonaProvider, useActivePersona } from '../hooks/useActivePersona'
import { PersonaEditButton } from './PersonaEditButton'
import { resetMockPersonaEdits } from './personaEditMock'

afterEach(() => {
  resetMockPersonaEdits()
})

/** What `ControllerConsoleRoute` does: the active persona feeds both the panel and the button. */
function ConsoleStandIn({ initial }: { readonly initial: StaffPersona }) {
  const { activePersona, selectPersona } = useActivePersona()
  return (
    <>
      <button type="button" onClick={() => selectPersona(initial)}>operate as persona</button>
      {activePersona !== null ? (
        <PersonaContextPanel
          persona={activePersona}
          actionsSlot={<PersonaEditButton persona={activePersona} />}
        />
      ) : null}
    </>
  )
}

/** Like the stand-in above, but with a control that switches the active persona. */
function SwitchableConsole({ first, second }: {
  readonly first: StaffPersona
  readonly second: StaffPersona
}) {
  const { activePersona, selectPersona } = useActivePersona()
  return (
    <>
      <button type="button" onClick={() => selectPersona(first)}>operate as first</button>
      <button type="button" onClick={() => selectPersona(second)}>operate as second</button>
      {activePersona !== null ? (
        <PersonaContextPanel
          persona={activePersona}
          actionsSlot={<PersonaEditButton persona={activePersona} />}
        />
      ) : null}
    </>
  )
}

describe('PersonaEditButton in PersonaContextPanel\'s actionsSlot', () => {
  it('mounts in the slot, and the panel shows the edited bio right after Save', async () => {
    const user = userEvent.setup()
    const tom = SEEDED_PERSONAS.find(persona => persona.id === 'persona-tbrandt41')
    if (tom === undefined) throw new Error('seeded persona missing')

    render(
      <ThemeProvider theme={cobraTheme}>
        <QueryClientProvider client={new QueryClient()}>
          <ExerciseContextProvider>
            <ActivePersonaProvider>
              <ConsoleStandIn initial={tom} />
            </ActivePersonaProvider>
          </ExerciseContextProvider>
        </QueryClientProvider>
      </ThemeProvider>,
    )

    await user.click(await screen.findByRole('button', { name: 'operate as persona' }))
    const actions = await screen.findByTestId('persona-context-actions')
    const edit = within(actions).getByRole('button', { name: 'Edit persona' })
    expect(screen.getByTestId('persona-context-bio')).toHaveTextContent(tom.bio ?? '')

    await user.click(edit)
    const bio = await screen.findByLabelText(/^bio/i)
    await user.clear(bio)
    await user.type(bio, 'Now running the diner too.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('persona-context-bio')).toHaveTextContent('Now running the diner too.')
    // The button is still mounted in the slot (focus can return to it) and says what happened.
    expect(within(screen.getByTestId('persona-context-actions')).getByRole('button', {
      name: 'Edit persona',
    })).toHaveFocus()
    expect(screen.getByTestId('persona-edit-saved')).toHaveTextContent('Saved')
  })

  it('keeps editing the persona it was opened for if the console switches persona behind the dialog', async () => {
    const user = userEvent.setup()
    const first = SEEDED_PERSONAS.find(persona => persona.id === 'persona-tbrandt41')
    const second = SEEDED_PERSONAS.find(persona => persona.id === 'persona-fulcoem')
    if (first === undefined || second === undefined) throw new Error('seeded persona missing')

    render(
      <ThemeProvider theme={cobraTheme}>
        <QueryClientProvider client={new QueryClient()}>
          <ExerciseContextProvider>
            <ActivePersonaProvider>
              <SwitchableConsole first={first} second={second} />
            </ActivePersonaProvider>
          </ExerciseContextProvider>
        </QueryClientProvider>
      </ThemeProvider>,
    )

    await user.click(await screen.findByRole('button', { name: 'operate as first' }))
    await user.click(await screen.findByRole('button', { name: 'Edit persona' }))
    const name = await screen.findByLabelText(/display name/i)
    await user.clear(name)
    await user.type(name, 'Thomas Brandt')

    // The console switches persona while the dialog is open.
    fireEvent.click(screen.getByRole('button', { name: 'operate as second', hidden: true }))
    await waitFor(() =>
      expect(screen.getByTestId('persona-context-panel'))
        .toHaveAccessibleName('Persona context for Fulton County EM'))

    // The dialog is still about the FIRST persona ...
    expect(screen.getByLabelText(/^handle/i)).toHaveValue('@tbrandt41')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // ... the edit landed on it, not on the persona now active, and the console stays put.
    expect(SEEDED_PERSONAS.find(persona => persona.id === first.id)?.displayName).toBe('Thomas Brandt')
    expect(SEEDED_PERSONAS.find(persona => persona.id === second.id)?.displayName).toBe('Fulton County EM')
    expect(screen.getByTestId('persona-context-panel')).toHaveAccessibleName('Persona context for Fulton County EM')
  })
})
