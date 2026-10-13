/**
 * features/participantAdmin/ParticipantAdminRoute.test.tsx
 * ---------------------------------------------------------------------------
 * Easy-login story 10 — the route composition the staff registry mounts at
 * `/staff/participant-admin`: the roster page inside `StaffShellFrame`
 * (`StaffHeader surfaceName="Participants"` + `Toolstrip`), on the COBRA theme
 * the frame supplies. The route supplies NO ExerciseContextProvider of its own
 * (CR-001), so this test supplies the hoisted one, as `routes.tsx` does.
 */
import { describe, expect, it, vi } from 'vitest'
import { configure, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { ParticipantAdminRoute } from './ParticipantAdminRoute'

// The full COBRA page mounts through the mock backend; give a loaded CI box headroom
// over the 10 s test default and the 5 s `findBy`/`waitFor` default (src/test/setup.ts).
vi.setConfig({ testTimeout: 30_000 })
configure({ asyncUtilTimeout: 20_000 })

function renderRoute() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter initialEntries={['/staff/participant-admin']}>
      <QueryClientProvider client={queryClient}>
        <ExerciseContextProvider>
          <ParticipantAdminRoute />
        </ExerciseContextProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('ParticipantAdminRoute', () => {
  it('mounts the roster inside the staff shell frame, headed "Participants"', async () => {
    renderRoute()

    const frame = await screen.findByTestId('staff-shell-frame')
    expect(within(frame).getByTestId('staff-shell-header')).toHaveTextContent('Participants')
    expect(within(frame).getByTestId('staff-shell-toolstrip')).toBeInTheDocument()

    // The page lives in the frame's work area and loads the roster.
    const workArea = within(frame).getByTestId('staff-shell-work-area')
    expect(await within(workArea).findByTestId('roster-table')).toBeInTheDocument()
    expect(within(workArea).getByRole('heading', { level: 1, name: 'Participants' })).toBeInTheDocument()
  })

  it('exposes exactly one main landmark (the frame\'s), not a second one from the page', async () => {
    renderRoute()
    await screen.findByTestId('roster-table')
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('renders no slot content until the orchestrator composes it', async () => {
    renderRoute()
    await screen.findByTestId('roster-table')
    // The bare route passes no slot props: only the roster toolbar controls exist.
    const toolbar = screen.getByTestId('roster-toolbar')
    expect(within(toolbar).queryByText(/print/i)).not.toBeInTheDocument()
    expect(within(toolbar).queryByText(/email/i)).not.toBeInTheDocument()
  })
})
