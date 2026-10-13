/**
 * features/staffShell/components/PreviewAsParticipant.channel.test.tsx
 * ---------------------------------------------------------------------------
 * demo-polish C6 (docs/features/demo-polish/23-preview-and-startex.md) -- the
 * REAL Social channel inside the staff preview, end to end. Nothing about the channel
 * is mocked: this renders `PreviewAsParticipant` inside the real COBRA
 * `StaffShellFrame`, under the real providers (exercise scope, session -- the mock
 * session is a participant persona, the case the read-only scope exists for -- query
 * client), and drives it the way a presenter would.
 *
 * The staff route is simulated the way `renderChannel.testUtils` documents for C6: the
 * whole stack sits under a parent ROUTE (`/staff/console/*`) of a REAL router, with a
 * probe beside it that shows that router's address, so "the channel moved" and "the
 * staff page moved" can be told apart.
 *
 *  - AC1 Real channel: the exercise's own feed renders; opening a thread, a profile or
 *    Explore moves the CHANNEL and never the router, `window.location` or history; the
 *    label strip and Exit are still there (the moment picker was removed after Gate-1).
 *  - AC2 Read-only: every write affordance is ABSENT (not disabled) on every page the
 *    preview can reach; and nothing issues a write request, telemetry included.
 *  - AC3 Two worlds: no MUI in the participant subtree, none of the participant shell's
 *    own layers (alert bar, overlay, compliance banners) inside the preview.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { api } from '@/core/services/api'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { RouterProbe } from '@/features/social/layout/RouterProbe.testUtils'
import { PreviewProvider } from '../previewContext'
import { StaffShellFrame } from '../StaffShellFrame'
import { PreviewAsParticipant } from './PreviewAsParticipant'

const STAFF_ROUTE = '/staff/console'
const SCENARIO_NOW = new Date('2033-09-04T14:30:00.000Z')

function renderPreview() {
  setExerciseClock({ scenarioNow: () => SCENARIO_NOW })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[STAFF_ROUTE]}>
        <Routes>
          <Route
            path={`${STAFF_ROUTE}/*`}
            element={(
              <ExerciseContextProvider>
                <SessionProvider>
                  <PreviewProvider>
                    <StaffShellFrame>
                      <PreviewAsParticipant />
                    </StaffShellFrame>
                  </PreviewProvider>
                </SessionProvider>
              </ExerciseContextProvider>
            )}
          />
        </Routes>
        <RouterProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Waits for the exercise's feed to have rendered in the preview. */
async function feedReady() {
  const cards = await screen.findAllByTestId('post-card')
  return cards
}

function channel(): HTMLElement {
  return screen.getByTestId('social-channel')
}

let writeSpies: Array<ReturnType<typeof vi.spyOn>>
let pushState: ReturnType<typeof vi.spyOn>
let replaceState: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetTelemetryBuffer()
  writeSpies = [
    vi.spyOn(api, 'post'),
    vi.spyOn(api, 'put'),
    vi.spyOn(api, 'patch'),
    vi.spyOn(api, 'delete'),
  ]
  pushState = vi.spyOn(window.history, 'pushState')
  replaceState = vi.spyOn(window.history, 'replaceState')
})

afterEach(() => {
  vi.restoreAllMocks()
  resetExerciseClock()
  resetTelemetryBuffer()
})

describe('PreviewAsParticipant -- the real channel (AC1)', () => {
  it('renders the exercise\'s own feed inside the staff frame, with the label strip and Exit', async () => {
    renderPreview()
    const cards = await feedReady()

    expect(cards.length).toBeGreaterThan(0)
    expect(screen.getByText(/not the official utility account/i)).toBeInTheDocument()

    // The participant render is INSIDE the mat, inside the staff work area.
    const frame = screen.getByTestId('preview-frame')
    expect(frame).toContainElement(channel())
    expect(screen.getByTestId('preview-stage')).toContainElement(frame)
    expect(screen.getByTestId('staff-shell-work-area')).toContainElement(screen.getByTestId('preview-stage'))

    // The staff strip keeps its label and Exit (the moment picker was removed after Gate-1).
    expect(screen.getByTestId('preview-bar-label')).toHaveTextContent('PREVIEW AS PARTICIPANT — READ-ONLY')
    expect(screen.getByTestId('preview-exit')).toBeInTheDocument()
  })

  it('is no longer the PortalStub mock', async () => {
    renderPreview()
    await feedReady()

    expect(screen.queryByTestId('portal-stub')).not.toBeInTheDocument()
  })

  it('opens a thread, a profile and Explore INSIDE the preview -- the staff page never moves', async () => {
    const user = userEvent.setup()
    const originalHref = window.location.href
    renderPreview()
    const [first] = await feedReady()
    if (first === undefined) throw new Error('no post rendered')
    const main = screen.getByTestId('social-main')
    expect(main).toHaveAttribute('data-route', 'home')

    // A thread.
    await user.click(within(first).getByTestId('post-open-target'))
    await waitFor(() => expect(main).toHaveAttribute('data-route', 'thread'))
    expect(await screen.findByTestId('social-thread-region')).toBeInTheDocument()

    // Back, then a profile.
    await user.click(screen.getByRole('button', { name: /^back$/i }))
    await waitFor(() => expect(main).toHaveAttribute('data-route', 'home'))
    const [firstAgain] = await feedReady()
    if (firstAgain === undefined) throw new Error('no post rendered')
    await user.click(within(firstAgain).getByTestId('post-author-target'))
    await waitFor(() => expect(main).toHaveAttribute('data-route', 'profile'))
    expect(await screen.findByTestId('social-profile-region')).toBeInTheDocument()

    // Explore, from the nav rail.
    await user.click(screen.getByRole('link', { name: 'Explore' }))
    await waitFor(() => expect(main).toHaveAttribute('data-route', 'explore'))

    // The real router, the address bar and the history stack never moved.
    expect(screen.getByTestId('router-location')).toHaveTextContent(STAFF_ROUTE)
    expect(window.location.href).toBe(originalHref)
    expect(pushState).not.toHaveBeenCalled()
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('offers no moment picker (Gate-1 amendment): nothing on the strip changes the feed', async () => {
    renderPreview()
    await feedReady()

    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.queryByTestId('preview-moment-picker')).not.toBeInTheDocument()
  })
})

describe('PreviewAsParticipant -- read-only: every write affordance is ABSENT (AC2)', () => {
  /** Asserts that no write control exists anywhere in the channel as currently shown. */
  function expectNoWriteControls() {
    const root = channel()
    // Composers: the home composer, the reply box, the quote composer.
    expect(root.querySelector('textarea')).toBeNull()
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reply-composer')).not.toBeInTheDocument()
    // The Post button, and with it the compose modal.
    expect(screen.queryByTestId('nav-post-button')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Follow / Unfollow, wherever it could be (profile header, follower lists, Who to follow).
    expect(screen.queryByTestId('follow-button')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(un)?follow /i })).not.toBeInTheDocument()
    // Like / repost / reply on every card: inert counts, never buttons.
    expect(root.querySelectorAll('button[data-action]')).toHaveLength(0)
    // The identity-bearing parts of the app frame that would sign the STAFF user out.
    expect(screen.queryByTestId('account-card')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument()
    // The Following feed (needs a persona) and the live "new posts" stream.
    expect(screen.queryByRole('tablist', { name: 'Feed' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('new-posts-pill')).not.toBeInTheDocument()
  }

  it('Home: no composer, no Post button, no Follow, no like / repost / reply buttons', async () => {
    renderPreview()
    await feedReady()
    // The Who-to-follow rail has loaded its rows, so "no Follow button" is not "not loaded yet".
    await screen.findAllByTestId('who-to-follow-row')

    expectNoWriteControls()
    // ...and the counts the buttons would have been are still there, as text (not vacuous).
    expect(channel().querySelectorAll('[data-action]').length).toBeGreaterThan(0)
  })

  it('a thread: no reply composer', async () => {
    const user = userEvent.setup()
    renderPreview()
    const [first] = await feedReady()
    if (first === undefined) throw new Error('no post rendered')

    await user.click(within(first).getByTestId('post-open-target'))
    expect(await screen.findByTestId('social-thread-region')).toBeInTheDocument()
    await screen.findByTestId('thread-view')

    expectNoWriteControls()
  })

  it('a profile: no Follow button', async () => {
    const user = userEvent.setup()
    renderPreview()
    const [first] = await feedReady()
    if (first === undefined) throw new Error('no post rendered')

    await user.click(within(first).getByTestId('post-author-target'))
    expect(await screen.findByTestId('profile-identity')).toBeInTheDocument()

    expectNoWriteControls()
  })

  it('issues no write request -- no POST / PUT / PATCH / DELETE, and no telemetry', async () => {
    const user = userEvent.setup()
    renderPreview()
    const [first] = await feedReady()
    if (first === undefined) throw new Error('no post rendered')

    // Exercise the pages the preview can reach (each of these emits a participant `view`
    // in a normal mount).
    await user.click(within(first).getByTestId('post-open-target'))
    await screen.findByTestId('thread-view')
    await user.click(screen.getByRole('button', { name: /^back$/i }))
    await feedReady()
    await act(async () => { await Promise.resolve() })

    for (const spy of writeSpies) expect(spy).not.toHaveBeenCalled()
    expect(getEmittedTelemetryEvents()).toEqual([])
  })
})

describe('PreviewAsParticipant -- two worlds stay true (AC3)', () => {
  it('has no MUI element anywhere in the participant subtree', async () => {
    renderPreview()
    await feedReady()

    expect(channel().querySelectorAll('[class*="Mui"]')).toHaveLength(0)
    // ...while the staff strip and mat around it ARE the staff look (MUI under COBRA),
    // which is what makes the check above mean something.
    expect(screen.getByTestId('preview-bar').className).toMatch(/Mui/)
  })

  it('keeps the participant subtree out of the staff strip, and the strip out of the subtree', async () => {
    renderPreview()
    await feedReady()

    const strip = screen.getByTestId('preview-bar')
    expect(strip).not.toContainElement(channel())
    expect(channel()).not.toContainElement(strip)
    expect(within(strip).queryByTestId('pulse-brand-theme-scope')).not.toBeInTheDocument()
    expect(within(strip).queryByTestId('social-brand-scope')).not.toBeInTheDocument()
  })

  it('mounts none of the participant shell\'s own layers -- nothing to fight the staff shell', async () => {
    renderPreview()
    await feedReady()

    // No pause / EndEx / break-fiction overlay, no modal of any kind, no persistent alert bar.
    expect(document.querySelector('[data-shell-layer]')).toBeNull()
    expect(document.querySelector('[aria-modal="true"]')).toBeNull()
    expect(screen.queryByTestId('alert-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('compliance-chrome-top')).not.toBeInTheDocument()
    expect(screen.queryByTestId('compliance-chrome-bottom')).not.toBeInTheDocument()
  })

  it('contains position:fixed descendants in the frame (a transform), not the staff viewport', async () => {
    renderPreview()
    await feedReady()

    expect(screen.getByTestId('preview-frame')).toHaveStyle({ transform: 'translateZ(0)' })
  })
})
