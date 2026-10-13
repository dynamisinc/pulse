/**
 * features/controller/ControllerConsoleRoute.c6.test.tsx
 * ---------------------------------------------------------------------------
 * The demo-polish C6 MOUNTS, through the real `ControllerConsoleRoute` (docs/features/
 * demo-polish/23-preview-and-startex.md; implementation.md section 4.2): the StartEx / EndEx
 * control in the console's title row (`ControllerConsole`'s `lifecycleSlot`), and the
 * "Preview as participant" toggle that swaps the work area for the preview stage.
 *
 * Real providers (the mock exercise context, React Query, toolstrip, active persona and a real
 * `SessionProvider`). The ONE thing replaced is the session RESOLVER: the mock resolver always
 * returns a participant, so `lifecycle/lifecycle.sessionKit.testUtils` stands in with a STAFF
 * session whose role each case picks (production gets its staff session from the
 * `SessionProvider` that `app-shell/routes.tsx` hoists above the staff tree). Nothing about the
 * pieces under test is mocked.
 *
 *  - LIFECYCLE: the control sits in the console; Start moves STAGED -> LIVE and End (typed END)
 *    moves LIVE -> ENDEX, both on the header pill; and Ctrl+K is INERT while the End dialog is
 *    open (the dialog is an `aria-modal` layer, `core/a11y/modalPriority`), working again after.
 *    The control is gated on the SIGNED-IN SESSION's role: a controller session sees it, an
 *    evaluator session does not. (The fail-closed NO-SESSION case -- the control renders nothing
 *    and the console stays up -- is covered where the control lives:
 *    `lifecycle/ExerciseLifecycleControl.test.tsx`; this file always mounts a session.)
 *  - PREVIEW: the header's toggle stages the real, read-only channel in place of the console and
 *    Exit restores the console; the staff page's address never changes.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { ExerciseContextProvider, type ExerciseStatus } from '@/core/exerciseContext'
import {
  resetMockExerciseStatus,
  setMockExerciseStatus,
} from '@/core/exerciseContext/exerciseContextResolver'
import { resetTelemetryBuffer } from '@/core/telemetry'
import type { ExerciseRole } from '@/core/auth'
import { postStore } from '@/features/social/services/postStore'
import { removedPosts } from '@/features/social/services/removedPosts'
import { reviewStore } from './engine/services/reviewStore'
import { engineControlStore } from './engine/hooks/useEngineControl'
import { engineSettingsStore } from './engine/hooks/useEngineSettings'
import { composeAsPersonaDraftStore } from './hooks/useComposeAsPersona'
import { resetPauseStateForTest } from './hooks/usePauseState'
import { ControllerConsoleRoute } from './ControllerConsoleRoute'
import { resetSessionRole, setSessionRole } from './lifecycle/lifecycle.sessionKit.testUtils'

// Whole-console renders (MUI + emotion + several feature trees) are slow on a loaded box.
vi.setConfig({ testTimeout: 60_000 })

// The mock resolver's session is a participant; the control gates on the session's ROLE, so the
// route is mounted under a STAFF session whose role each case picks (default: controller).
vi.mock('@/core/auth/sessionResolver', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/sessionResolver')>()),
  resolveSession: (await import('./lifecycle/lifecycle.sessionKit.testUtils')).resolveSession,
}))

beforeEach(() => {
  resetPauseStateForTest()
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests({ withDemoFixtures: true })
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
  resetTelemetryBuffer()
  removedPosts.resetForTests()
  // jsdom has no matchMedia.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: 1440 >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
})

afterEach(() => {
  resetPauseStateForTest()
  resetExerciseClock()
  resetMockExerciseStatus()
  resetSessionRole()
  postStore.resetForTests()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
  removedPosts.resetForTests()
  vi.unstubAllGlobals()
})

async function renderRoute(status?: ExerciseStatus, sessionRole: ExerciseRole = 'controller') {
  if (status !== undefined) setMockExerciseStatus(status)
  setSessionRole(sessionRole)
  const user = userEvent.setup({ delay: null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ExerciseContextProvider>
        {/* Production hoists the session above the staff tree (app-shell/routes.tsx). */}
        <SessionProvider>
          <MemoryRouter initialEntries={['/console']}>
            <ControllerConsoleRoute />
          </MemoryRouter>
        </SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>,
  )
  await screen.findByTestId('controller-console')
  return { user }
}

const pill = () => screen.getByTestId('staff-header-state-pill-label').textContent
const palette = () => screen.queryByTestId('command-palette')

describe('ControllerConsoleRoute -- the StartEx / EndEx control (C6)', () => {
  it('shows End exercise in the console title row for a live exercise, and Start for a staged one', async () => {
    await renderRoute('live')
    const console_ = screen.getByTestId('controller-console')
    expect(within(console_).getByRole('button', { name: /end exercise/i })).toBeInTheDocument()
    expect(within(console_).queryByRole('button', { name: /start exercise/i })).not.toBeInTheDocument()
  })

  it('an evaluator session does not get the control (gated on the session role, not the identity mock)', async () => {
    await renderRoute('live', 'evaluator')

    const console_ = screen.getByTestId('controller-console')
    expect(within(console_).queryByRole('button', { name: /start exercise|end exercise/i }))
      .not.toBeInTheDocument()
    expect(screen.queryByTestId('exercise-lifecycle-control')).not.toBeInTheDocument()
  })

  it('Start exercise moves the header pill STAGED -> LIVE', async () => {
    const { user } = await renderRoute('staged')
    expect(pill()).toBe('STAGED')

    await user.click(screen.getByRole('button', { name: /start exercise/i }))

    await waitFor(() => expect(pill()).toBe('LIVE'))
  })

  it('End exercise needs a typed END, then moves the header pill LIVE -> ENDEX', async () => {
    const { user } = await renderRoute('live')
    expect(pill()).toBe('LIVE')

    await user.click(screen.getByRole('button', { name: /end exercise/i }))
    const dialog = await screen.findByRole('dialog', { name: /end the exercise/i })
    expect(pill()).toBe('LIVE')
    await user.type(within(dialog).getByLabelText('Type END to confirm'), 'END')
    await user.click(within(dialog).getByTestId('end-exercise-confirm'))

    await waitFor(() => expect(pill()).toBe('ENDEX'))
  })

  it('W-2: the pill reads ENDEX after End even while the world is FROZEN (a pause tier never masks the end)', async () => {
    const { user } = await renderRoute('live')
    // Freeze the world through the real pause control (the guarded Freeze).
    await user.click(screen.getByTestId('pause-pill'))
    await user.click(within(screen.getByTestId('pause-tier-option-freeze')).getByRole('radio'))
    await user.click(screen.getByTestId('pause-apply'))
    await user.click(screen.getByTestId('pause-freeze-confirm-button'))
    await waitFor(() => expect(pill()).toBe('WORLD FROZEN'))

    // End the exercise.
    await user.click(screen.getByRole('button', { name: /end exercise/i }))
    const dialog = await screen.findByRole('dialog', { name: /end the exercise/i })
    await user.type(within(dialog).getByLabelText('Type END to confirm'), 'END')
    await user.click(within(dialog).getByTestId('end-exercise-confirm'))

    // The lifecycle wins once the world is no longer running: ENDEX, not WORLD FROZEN.
    await waitFor(() => expect(pill()).toBe('ENDEX'))
    expect(screen.getByTestId('staff-header-state-pill')).toHaveAttribute('aria-label', 'Exercise state: ENDEX')
  })

  it('W-2: a pause tier still shows on the pill while the world is running', async () => {
    const { user } = await renderRoute('live')

    await user.click(screen.getByTestId('pause-pill'))
    await user.click(within(screen.getByTestId('pause-tier-option-freeze')).getByRole('radio'))
    await user.click(screen.getByTestId('pause-apply'))
    await user.click(screen.getByTestId('pause-freeze-confirm-button'))

    await waitFor(() => expect(pill()).toBe('WORLD FROZEN'))
  })

  it('keeps Ctrl+K inert while the End dialog is open, and working again once it closes', async () => {
    const { user } = await renderRoute('live')
    await user.click(screen.getByRole('button', { name: /end exercise/i }))
    const dialog = await screen.findByRole('dialog', { name: /end the exercise/i })

    await user.keyboard('{Control>}k{/Control}')
    expect(palette()).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByTestId('command-palette')).toBeInTheDocument()
  })
})

describe('ControllerConsoleRoute -- Preview as participant (C6)', () => {
  it('stages the real read-only channel in place of the console, and Exit brings the console back', async () => {
    const { user } = await renderRoute('live')
    const toggle = screen.getByTestId('staff-header-preview-toggle')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    const href = window.location.href

    await user.click(toggle)

    expect(await screen.findByTestId('preview-as-participant')).toBeInTheDocument()
    expect(await screen.findByTestId('social-channel')).toBeInTheDocument()
    expect(screen.queryByTestId('controller-console')).not.toBeInTheDocument()
    expect(screen.queryByTestId('portal-stub')).not.toBeInTheDocument()
    expect(screen.getByTestId('staff-header-preview-toggle')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('preview-bar-label')).toHaveTextContent('PREVIEW AS PARTICIPANT — READ-ONLY')
    // Read-only: no composer, no Post button.
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('nav-post-button')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('preview-exit'))

    expect(await screen.findByTestId('controller-console')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-as-participant')).not.toBeInTheDocument()
    expect(window.location.href).toBe(href)
    // Focus went back to the header button that opened the preview, not to <body>.
    expect(screen.getByTestId('staff-header-preview-toggle')).toHaveFocus()
  })
})
