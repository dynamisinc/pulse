/**
 * features/social/pages/Feed.pillGuards.test.tsx
 * ---------------------------------------------------------------------------
 * The guard-1 half of the Copilot PR #301 pill-load fix (feeds-discovery/04):
 * if the persona cast has NOT resolved when the reader taps the "▲ N new posts"
 * pill, `handleLoadNew` must NOT drain the buffer. A drain now would fail every
 * author resolution and PERMANENTLY drop the buffered posts the reader was just
 * told about (data loss) while resetting the count. Instead the tap is a no-op:
 * the buffer + pill stay intact, so a later tap (once the cast loads) still
 * works. In practice the cast is loaded by the time the pill can be tapped (the
 * baseline feed rendered) — this proves the fail-soft path with no data loss.
 *
 * DRIVER. `usePersonas` is mocked to an empty, already-settled cast. Because
 * `vi.mock` is file-scoped, this lives apart from `Feed.liveAppend.test.tsx`
 * (which needs the real cast). The arrival still BUFFERS — the stream source is
 * author-agnostic — so the pill shows a count; the assertion is that tapping it
 * leaves that count intact and neither scrolls the feed nor emits a load event.
 *
 * Participant world (Pulse Social skin) — no COBRA, real provider stack.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import type { Post } from '@/features/social'
import { postStore } from '../services/postStore'
import { Feed } from './Feed'

// An empty, already-settled cast → `personaById` is empty in <Feed>, so the
// guard-1 early-return fires on tap. `loading: false` so the feed is not stuck.
vi.mock('@/features/personas', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/personas')>()
  return {
    ...actual,
    usePersonas: () => ({ personas: [], loading: false, error: undefined }),
  }
})

function buildLivePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-live-cast-not-loaded',
    exerciseId: 'ex-mock-0001',
    authorPersonaId: 'persona-fairhavenwater',
    actingHumanId: 'human-simcell-utility',
    text: 'Buffered while the cast is still loading.',
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T16:00:00Z',
    origin: 'controller-as-persona',
    ...overrides,
  }
}

/** Load-time telemetry (the pill tap), distinguished by `payload.newPostsLoaded`. */
function loadTelemetryEvents() {
  return getEmittedTelemetryEvents().filter(
    e => e.eventType === 'view' && e.payload !== undefined && 'newPostsLoaded' in e.payload,
  )
}

type ScrollIntoViewFn = (arg?: boolean | ScrollIntoViewOptions) => void
let scrollSpy: Mock<ScrollIntoViewFn>

beforeEach(() => {
  resetTelemetryBuffer()
  scrollSpy = vi.fn<ScrollIntoViewFn>()
  HTMLElement.prototype.scrollIntoView = scrollSpy
})

afterEach(() => {
  postStore.resetForTests()
  resetTelemetryBuffer()
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

function renderFeed() {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
        >
          <Feed />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

describe('Feed — pill tap before the persona cast loads is a no-op, not data loss (Copilot #301)', () => {
  it('leaves the buffer + pill intact and neither scrolls nor emits when the cast is empty', async () => {
    renderFeed()
    // Wait for the feed to settle first — this guarantees the stream source has
    // baselined at start() before we append, so the arrival is treated as NEW
    // (not folded into the baseline). With an empty cast no cards render, so we
    // await the settled empty state instead of the seeded rows.
    await screen.findByText('No posts yet.')

    // Append after mount → the (author-agnostic) stream buffers it → pill shows.
    act(() => {
      postStore.appendPost(buildLivePost())
    })
    const pill = await screen.findByTestId('new-posts-pill')
    expect(pill).toHaveTextContent('1 new post')

    fireEvent.click(pill)

    // The cast is empty, so the tap returned BEFORE draining: the pill (and its
    // count) survive for a later tap; nothing scrolled; no load event fired.
    expect(screen.getByTestId('new-posts-pill')).toHaveTextContent('1 new post')
    expect(scrollSpy).not.toHaveBeenCalled()
    expect(loadTelemetryEvents()).toHaveLength(0)
  })
})
