/**
 * features/social/components/ThreadView.intent.test.tsx
 * ---------------------------------------------------------------------------
 * "Open the thread with the reply composer focused" must survive the real load
 * ordering (demo-polish F4 Gate-1 M-2, L-7; NFR-001):
 *
 *  - the persona cast is a SEPARATE fetch from the thread GET and can land after it (a
 *    cold deep link: the channel directory is still loading). The thread then keeps its
 *    "Loading thread…" state rather than a blank body. The composer needs the focused
 *    author's persona, so the reply intent must not be spent at "thread loaded" while the
 *    composer does not exist yet: focus must land in the composer once it mounts;
 *  - a thread that fails to load drops the request, so it cannot fire on a later
 *    visit to the same post;
 *  - a request expires (see `replyIntent.test.ts`), so a thread opened long after a
 *    stray tap is not focused.
 *
 * `usePersonas` is replaced by a store the test controls (everything else in
 * `@/features/personas` stays real); own file because `vi.mock` is module-wide.
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { api } from '@/core/services/api'
import { resolvePersonas, type Persona } from '@/features/personas'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { postStore } from '../services/postStore'
import { ownPostStore } from '../services/ownPostStore'
import {
  consumeReplyFocus,
  requestReplyFocus,
  resetReplyIntent,
} from '../services/replyIntent'
import { SocialDirectoryProvider } from '../layout/SocialDirectoryProvider'
import { ThreadView } from './ThreadView'

interface PersonaSnapshot {
  readonly personas: readonly Persona[]
  readonly loading: boolean
  readonly error: unknown
}

const personaStore = vi.hoisted(() => {
  let snapshot: PersonaSnapshot = { personas: [], loading: true, error: undefined }
  const listeners = new Set<() => void>()
  return {
    get: () => snapshot,
    set(next: PersonaSnapshot) {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
})

vi.mock('@/features/personas', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/personas')>()
  const { useSyncExternalStore } = await import('react')
  return {
    ...actual,
    usePersonas: () => useSyncExternalStore(personaStore.subscribe, personaStore.get),
  }
})

const FOCUS = 'post-seed-mvega-question'

function renderThread() {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
        >
          <SocialDirectoryProvider>
            <ThreadView focusedPostId={FOCUS} />
          </SocialDirectoryProvider>
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

let cast: readonly Persona[]

beforeEach(async () => {
  cast = await resolvePersonas()
  personaStore.set({ personas: [], loading: true, error: undefined })
  resetReplyIntent()
})

afterEach(() => {
  vi.restoreAllMocks()
  postStore.resetForTests()
  ownPostStore.resetForTests()
  resetReplyIntent()
})

describe('ThreadView — the reply intent waits for the composer (M-2)', () => {
  it('focuses the composer when the personas land AFTER the thread has loaded', async () => {
    // Flag the moment the thread GET resolves, so "the cast lands AFTER the thread" is
    // asserted about a thread that really has landed (the loading text alone cannot say).
    let threadLanded = false
    const realGet = api.get.bind(api)
    vi.spyOn(api, 'get').mockImplementation((url: string, config?: Parameters<typeof api.get>[1]) =>
      url.startsWith('/threads/')
        ? realGet(url, config).then(response => {
          threadLanded = true
          return response
        })
        : realGet(url, config))
    requestReplyFocus(FOCUS)
    renderThread()
    await waitFor(() => expect(threadLanded).toBe(true))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    // Thread loaded, cast still pending: no author to name, so no composer yet -- and the
    // body is the thread's loading state, not a blank (the cold-deep-link gap).
    expect(screen.getByText('Loading thread…')).toBeInTheDocument()
    expect(screen.queryByLabelText('Reply text')).not.toBeInTheDocument()
    expect(document.body).toHaveFocus()

    personaStore.set({ personas: cast, loading: false, error: undefined })

    const input = await screen.findByLabelText('Reply text')
    await waitFor(() => expect(input).toHaveFocus())
    // One-shot: it was spent exactly when it was honoured.
    expect(consumeReplyFocus(FOCUS)).toBe(false)
  })

  it('focuses the composer when the personas were already there (the common order)', async () => {
    personaStore.set({ personas: cast, loading: false, error: undefined })
    requestReplyFocus(FOCUS)
    renderThread()

    const input = await screen.findByLabelText('Reply text')
    await waitFor(() => expect(input).toHaveFocus())
  })

  it('does not focus anything when no reply was requested', async () => {
    personaStore.set({ personas: cast, loading: false, error: undefined })
    renderThread()

    const input = await screen.findByLabelText('Reply text')
    expect(input).not.toHaveFocus()
  })
})

describe('ThreadView — a request cannot go stale (L-7)', () => {
  it('a thread that fails to load drops the request', async () => {
    personaStore.set({ personas: cast, loading: false, error: undefined })
    const realGet = api.get.bind(api)
    vi.spyOn(api, 'get').mockImplementation((url: string, config?: Parameters<typeof api.get>[1]) =>
      url.startsWith('/threads/') ? Promise.reject(new Error('network down')) : realGet(url, config))
    requestReplyFocus(FOCUS)

    renderThread()

    await screen.findByText('Unable to load this thread.')
    expect(consumeReplyFocus(FOCUS)).toBe(false)
  })
})
