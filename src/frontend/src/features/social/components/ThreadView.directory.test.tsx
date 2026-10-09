/**
 * features/social/components/ThreadView.directory.test.tsx
 * ---------------------------------------------------------------------------
 * Proves `<ThreadView>` takes the persona cast from the channel's shared DIRECTORY
 * (`useSocialDirectory()`, published once by `SocialDirectoryProvider`) and never resolves
 * one of its own -- the same fix `<Profile>` got (Copilot review, PR #460).
 *
 * THE PROBLEM. `<ThreadView>` called `usePersonas()`, a per-caller fetch with no shared
 * cache, and resolves every card's author against it. The thread GET and that private cast
 * read are two independent requests: whenever the thread landed FIRST, `useThread` said
 * "loaded" (so "Loading thread..." went away) while no author could be resolved yet, and
 * the thread body -- ancestors, the focused post, the reply composer, every reply -- was
 * BLANK, with no indicator, until the private read finished. In-app navigation to a thread
 * always hits this window, because the channel already holds the cast and the page starts
 * a second read for it anyway.
 *
 * WHAT IS PROVED
 *  - No cast read of its own: under a loaded directory `<ThreadView>` issues ZERO
 *    `GET /personas`; under the real provider the provider's read is the only one (1).
 *    Counted on `api.get`, exact-matching `/personas` (the mock adapters sit behind it).
 *  - No blank frame: with the directory already loaded and the thread GET deferred, the
 *    thread shows "Loading thread..." until the GET lands and then renders its cards in
 *    that same step. Any cast read `<ThreadView>` still made on its own is HELD for the
 *    whole test, so a regression (a private read again) leaves the body blank at exactly
 *    the assertion that checks for it, rather than passing because a fast cast read
 *    happened to beat the thread.
 *  - Cold deep link (a reload on a thread URL): the directory can still be LOADING when the
 *    thread GET lands. The body must not be blank then either -- "Loading thread..." holds
 *    until the cast lands, and the cards render in the step it clears. If the directory
 *    instead FAILS, the loading state ends (it never spins) in the thread's existing
 *    "Unable to load this thread." state; and a thread GET that fails is reported at once,
 *    not held behind a directory that is still loading.
 *  - Fail-closed: outside a Social channel (no provider) `<ThreadView>` throws the
 *    directory's own guidance error rather than quietly starting a private cast read.
 *
 * `api.post` (the telemetry sink) is spied to resolve so a rejected mock POST cannot race
 * worker teardown; `api.get` is spied THROUGH purely to count and to hold selected reads.
 *
 * World: participant test scaffolding -- no COBRA, no MUI.
 */
import { Component, type ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { api } from '@/core/services/api'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { SocialDirectoryProvider } from '../layout/SocialDirectoryProvider'
import { SocialDirectoryContext, type SocialDirectory } from '../layout/socialDirectory'
import { loadedDirectory } from '../layout/socialDirectory.testUtils'
import { ownPostStore } from '../services/ownPostStore'
import { postStore } from '../services/postStore'
import { resetReplyIntent } from '../services/replyIntent'
import { ThreadView } from './ThreadView'

const FOCUS = 'post-seed-mvega-question'
const SHELL = { variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') } as const

beforeEach(() => {
  resetTelemetryBuffer()
  resetReplyIntent()
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {}, status: 200, statusText: 'OK', headers: {}, config: {},
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  postStore.resetForTests()
  ownPostStore.resetForTests()
  resetReplyIntent()
})

/** `<ThreadView>` under a HAND-BUILT directory: no provider, hence no provider fetch. */
function renderThreadUnder(directory: SocialDirectory) {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider value={SHELL}>
          <SocialDirectoryContext.Provider value={directory}>
            <ThreadView focusedPostId={FOCUS} />
          </SocialDirectoryContext.Provider>
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

/** How many times the persona cast (`GET /personas`, exactly) has been requested. */
function castReads(get: { mock: { calls: unknown[][] } }): number {
  return get.mock.calls.filter(call => call[0] === '/personas').length
}

/** A promise held open until `release()` -- how a test defers one specific read. */
function deferred() {
  let release: () => void = () => undefined
  const held = new Promise<void>(resolve => { release = resolve })
  return { held, release }
}

describe('ThreadView — no cast read of its own', () => {
  it('issues none when the directory is already loaded', async () => {
    const directory = await loadedDirectory()
    const get = vi.spyOn(api, 'get')

    renderThreadUnder(directory)
    await screen.findByTestId('thread-focused')
    await screen.findByLabelText('Reply text')

    expect(castReads(get)).toBe(0)
  })

  it('adds none to the provider\'s own: exactly one cast read for provider + thread', async () => {
    const get = vi.spyOn(api, 'get')

    render(
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider value={SHELL}>
            <SocialDirectoryProvider>
              <ThreadView focusedPostId={FOCUS} />
            </SocialDirectoryProvider>
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>,
    )
    await screen.findByTestId('thread-focused')
    await screen.findByLabelText('Reply text')

    expect(castReads(get)).toBe(1)
  })
})

describe('ThreadView — no blank frame once the directory is loaded', () => {
  it('renders the thread body the moment the thread GET lands', async () => {
    const directory = await loadedDirectory()
    const thread = deferred() // the thread GET, held so the "loading" state can be observed
    const cast = deferred() // any cast read ThreadView makes itself: never released in time
    const realGet = api.get.bind(api)
    vi.spyOn(api, 'get').mockImplementation(
      (url: string, config?: Parameters<typeof api.get>[1]) => {
        if (url.startsWith('/threads/')) return thread.held.then(() => realGet(url, config))
        if (url === '/personas') return cast.held.then(() => realGet(url, config))
        return realGet(url, config)
      },
    )

    renderThreadUnder(directory)
    // While the GET is outstanding the thread says so (and nothing else is on screen yet).
    await screen.findByText('Loading thread…')
    expect(screen.queryByTestId('thread-focused')).toBeNull()

    await act(async () => { thread.release() })
    await waitFor(() => expect(screen.queryByText('Loading thread…')).toBeNull())

    // The first frame after "loading" already carries the cards: no blank body in between.
    expect(screen.getByTestId('thread-focused')).toBeInTheDocument()
    expect(screen.getAllByTestId('thread-reply').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Reply text')).toBeInTheDocument()

    cast.release() // let a (regressed) private read settle so nothing dangles past the test
  })
})

/** The whole tree for a given directory value; re-render it to "move" the directory on. */
function threadTree(directory: SocialDirectory) {
  return (
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider value={SHELL}>
          <SocialDirectoryContext.Provider value={directory}>
            <ThreadView focusedPostId={FOCUS} />
          </SocialDirectoryContext.Provider>
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>
  )
}

/** A directory that has not landed yet: empty, `loading`, no error. */
function pendingDirectory(loaded: SocialDirectory): SocialDirectory {
  return {
    ...loaded,
    personas: [],
    loading: true,
    findById: () => undefined,
    findByHandle: () => undefined,
  }
}

/** A directory whose read FAILED: empty, settled, with the error. */
function failedDirectory(loaded: SocialDirectory): SocialDirectory {
  return { ...pendingDirectory(loaded), loading: false, error: new Error('cast unavailable') }
}

/**
 * Lets the thread GET reach `useThread` while the directory is still pending, and returns once
 * it has. The wrapped GET flags the moment the (real, mock-adapter) response resolves, then a
 * macrotask lets React apply it -- so a test that goes on to assert "still loading" is
 * asserting about a thread that HAS landed, not one that has not been fetched yet.
 */
async function landThreadFirst() {
  let landed = false
  const realGet = api.get.bind(api)
  vi.spyOn(api, 'get').mockImplementation(
    (url: string, config?: Parameters<typeof api.get>[1]) => url.startsWith('/threads/')
      ? realGet(url, config).then(response => {
        landed = true
        return response
      })
      : realGet(url, config),
  )
  return async () => {
    await waitFor(() => expect(landed).toBe(true))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
}

describe('ThreadView — cold deep link: the directory is still loading', () => {
  it('holds "Loading thread…" until the cast lands, then renders the cards (no blank frame)', async () => {
    const loaded = await loadedDirectory()
    const threadHasLanded = await landThreadFirst()

    const view = render(threadTree(pendingDirectory(loaded)))
    await threadHasLanded()

    // The thread is in, the cast is not: no author can be named, so the body is NOT blank --
    // it is still the loading state, and nothing (card, composer) is half-drawn.
    expect(screen.getByText('Loading thread…')).toBeInTheDocument()
    expect(screen.queryByTestId('thread-focused')).toBeNull()
    expect(screen.queryByLabelText('Reply text')).toBeNull()

    view.rerender(threadTree(loaded))
    await waitFor(() => expect(screen.queryByText('Loading thread…')).toBeNull())

    // The step that clears the loading text already carries the cards.
    expect(screen.getByTestId('thread-focused')).toBeInTheDocument()
    expect(screen.getAllByTestId('thread-reply').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Reply text')).toBeInTheDocument()
  })

  it('does not spin forever when the directory FAILS: it ends in the thread\'s error state', async () => {
    const loaded = await loadedDirectory()
    const threadHasLanded = await landThreadFirst()

    const view = render(threadTree(pendingDirectory(loaded)))
    await threadHasLanded()
    expect(screen.getByText('Loading thread…')).toBeInTheDocument()

    view.rerender(threadTree(failedDirectory(loaded)))

    expect(await screen.findByText('Unable to load this thread.')).toBeInTheDocument()
    expect(screen.queryByText('Loading thread…')).toBeNull()
    expect(screen.queryByTestId('thread-focused')).toBeNull()
    expect(screen.queryByLabelText('Reply text')).toBeNull()
  })

  it('reports a failed thread GET at once, not held behind the pending directory', async () => {
    const loaded = await loadedDirectory()
    const realGet = api.get.bind(api)
    vi.spyOn(api, 'get').mockImplementation(
      (url: string, config?: Parameters<typeof api.get>[1]) => url.startsWith('/threads/')
        ? Promise.reject(new Error('network down'))
        : realGet(url, config),
    )

    render(threadTree(pendingDirectory(loaded)))

    expect(await screen.findByText('Unable to load this thread.')).toBeInTheDocument()
    expect(screen.queryByText('Loading thread…')).toBeNull()
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

describe('ThreadView — outside a Social channel', () => {
  it('fails closed (the directory\'s own guidance error) instead of reading the cast itself', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const get = vi.spyOn(api, 'get')

    render(
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider value={SHELL}>
            <Catcher>
              <ThreadView focusedPostId={FOCUS} />
            </Catcher>
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>,
    )

    expect(await screen.findByTestId('caught')).toHaveTextContent(/Social channel/)
    expect(castReads(get)).toBe(0)
  })
})
