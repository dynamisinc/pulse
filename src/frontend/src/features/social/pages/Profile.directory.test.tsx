/**
 * features/social/pages/Profile.directory.test.tsx
 * ---------------------------------------------------------------------------
 * Proves `<Profile>` takes the persona cast from the channel's shared DIRECTORY
 * (`useSocialDirectory()`, published once by `SocialDirectoryProvider`) and never
 * resolves one of its own. Regression for the Copilot review on PR #460: `<Profile>`
 * called `usePersonas()` again after `ProfileRoute` had already resolved the cast, and
 * `usePersonas` is a per-caller `useState`/`useEffect` fetch with no shared cache, so
 * every profile visit
 *   (1) issued a duplicate `GET /api/personas`, and
 *   (2) showed a SECOND loading skeleton right after the route's own one, because
 *       the page's private copy of the cast started out empty and "loading".
 * `<Profile>` also reaches the cast through `useFeed()` (which calls `usePersonas()`
 * itself), so it now uses `useFeedWithCast()` with the directory's cast instead --
 * otherwise the duplicate request would simply have moved one hook down.
 *
 * WHAT IS PROVED
 *  - Request count: a loaded directory + `<Profile>` issues ZERO `GET /personas`; the real
 *    route + provider + profile issues exactly ONE (the provider's). Counted on `api.get`
 *    (the mock adapters sit behind it), exact-matching `/personas` so the sibling
 *    `/personas/...` follow-graph reads are not miscounted.
 *  - No second skeleton: with a loaded directory `<Profile>` never mounts a
 *    `ProfileSkeleton` at all (the hero is its first paint), and through the real route a
 *    profile visit mounts the skeleton exactly ONCE (the route's, while the directory loads).
 *  - Wiring: the directory's `loading` and `error` drive `<Profile>`'s own loading and
 *    "isn't available" states (it reads them, rather than tracking its own).
 *  - Fail-closed: outside a Social channel (no provider) `<Profile>` throws the directory's
 *    own guidance error rather than quietly starting a private cast read.
 *
 * `api.post` (the telemetry sink) is spied to resolve so a rejected mock POST cannot race
 * worker teardown; `api.get` is spied THROUGH (call-through) purely to count calls.
 *
 * World: participant test scaffolding -- no COBRA, no MUI.
 */
import { Component, type ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { api } from '@/core/services/api'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { ProfileRoute } from '../layout/routes/ProfileRoute'
import { SocialDirectoryProvider } from '../layout/SocialDirectoryProvider'
import { SocialNavigationProvider } from '../layout/SocialNavigationProvider'
import { SocialDirectoryContext, type SocialDirectory } from '../layout/socialDirectory'
import { loadedDirectory } from '../layout/socialDirectory.testUtils'
import { Profile } from './Profile'

const FW_ID = 'persona-fairhavenwater' // verified org, authored post-seed-fw-advisory
const SHELL = { variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') } as const

beforeEach(() => {
  resetTelemetryBuffer()
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {}, status: 200, statusText: 'OK', headers: {}, config: {},
  })
})

afterEach(() => {
  resetExerciseClock()
  vi.restoreAllMocks()
})

/** `<Profile>` under a HAND-BUILT directory: no provider, hence no provider fetch. */
function renderProfileUnder(directory: SocialDirectory, personaId: string = FW_ID) {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider value={SHELL}>
          <SocialDirectoryContext.Provider value={directory}>
            <Profile personaId={personaId} />
          </SocialDirectoryContext.Provider>
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

/** The real `/:handle` route under the real provider -- the shape `SocialChannel` mounts. */
function renderProfileRoute(handle: string) {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider value={SHELL}>
          <MemoryRouter initialEntries={[`/${handle}`]}>
            <SocialNavigationProvider>
              <SocialDirectoryProvider>
                <Routes>
                  <Route path="/:handle" element={<ProfileRoute />} />
                </Routes>
              </SocialDirectoryProvider>
            </SocialNavigationProvider>
          </MemoryRouter>
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

/** How many times the persona cast (`GET /personas`, exactly) has been requested. */
function castReads(get: { mock: { calls: unknown[][] } }): number {
  return get.mock.calls.filter(call => call[0] === '/personas').length
}

/**
 * Counts every `ProfileSkeleton` element that is ever ADDED to the document. Presence
 * alone would hide the bug (the route's skeleton is swapped for the page's own in a single
 * commit, so "a skeleton is on screen" never lapses); counting mounts does not.
 */
function watchSkeletonMounts() {
  const SELECTOR = '[data-testid="profile-skeleton"]'
  let mounted = 0
  const tally = (records: MutationRecord[]) => {
    for (const record of records) {
      record.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return
        if (node.matches(SELECTOR)) mounted += 1
        mounted += node.querySelectorAll(SELECTOR).length
      })
    }
  }
  const observer = new MutationObserver(tally)
  observer.observe(document.body, { childList: true, subtree: true })
  return {
    mounts: () => {
      tally(observer.takeRecords())
      return mounted
    },
    stop: () => observer.disconnect(),
  }
}

describe('Profile — one persona-cast read, shared with the route', () => {
  it('issues no cast read of its own when the directory is already loaded', async () => {
    const directory = await loadedDirectory()
    const get = vi.spyOn(api, 'get')

    renderProfileUnder(directory)
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })
    // The Posts tab resolves through `useFeedWithCast`: wait for it, so a cast read hiding
    // in the feed hook would have been issued by now.
    await screen.findAllByTestId('post-card')

    expect(castReads(get)).toBe(0)
  })

  it('route + provider + profile issue exactly one cast read between them', async () => {
    const get = vi.spyOn(api, 'get')

    renderProfileRoute('FairhavenWater')
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })
    await screen.findAllByTestId('post-card')

    expect(castReads(get)).toBe(1)
  })
})

describe('Profile — no second skeleton once the directory is loaded', () => {
  it('mounts no skeleton at all: the hero is its first paint', async () => {
    const directory = await loadedDirectory()
    // The providers above render nothing while they resolve, so "first commit" is counted
    // from before the render: no `ProfileSkeleton` is ever added, from mount to settled.
    const watch = watchSkeletonMounts()

    renderProfileUnder(directory)
    await screen.findByTestId('profile-identity')
    await screen.findAllByTestId('post-card')

    expect(watch.mounts()).toBe(0)
    watch.stop()
  })

  it('a profile visit through the route mounts the skeleton exactly once', async () => {
    const watch = watchSkeletonMounts()

    renderProfileRoute('FairhavenWater')
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })
    await screen.findAllByTestId('post-card')

    expect(watch.mounts()).toBe(1) // the route's, while the directory loads -- not a second
    expect(screen.queryByTestId('profile-skeleton')).toBeNull()
    watch.stop()
  })
})

describe('Profile — reads loading and error from the directory', () => {
  it('shows the skeleton while the DIRECTORY is loading', async () => {
    const loaded = await loadedDirectory()

    renderProfileUnder({ ...loaded, personas: [], loading: true, findById: () => undefined })

    expect(await screen.findByTestId('profile-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('profile-identity')).toBeNull()
  })

  it('says the profile is unavailable when the DIRECTORY failed to load', async () => {
    const loaded = await loadedDirectory()

    renderProfileUnder({
      ...loaded,
      personas: [],
      loading: false,
      error: new Error('cast unavailable'),
      findById: () => undefined,
    })

    expect(await screen.findByRole('status')).toHaveTextContent(
      'This profile isn’t available right now.',
    )
    expect(screen.queryByTestId('profile-skeleton')).toBeNull()
  })

  it('says the account does not exist for an id the loaded directory lacks', async () => {
    const directory = await loadedDirectory()

    renderProfileUnder(directory, 'persona-nobody-here')

    expect(await screen.findByRole('status')).toHaveTextContent('This account doesn’t exist.')
  })
})

/** Catches the render-time throw so the test can read it (no provider => no directory). */
class Catcher extends Component<{ children: ReactNode }, { message: string | undefined }> {
  state = { message: undefined as string | undefined }

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  render() {
    return this.state.message === undefined
      ? this.props.children
      : <p data-testid="caught">{this.state.message}</p>
  }
}

describe('Profile — outside a Social channel', () => {
  it('fails closed (the directory\'s own guidance error) instead of reading the cast itself', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const get = vi.spyOn(api, 'get')

    render(
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider value={SHELL}>
            <Catcher>
              <Profile personaId={FW_ID} />
            </Catcher>
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>,
    )

    expect(await screen.findByTestId('caught')).toHaveTextContent(/Social channel/)
    expect(castReads(get)).toBe(0)
  })
})
