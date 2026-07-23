/**
 * features/social/pages/Feed.liveAppend.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the story's real-time behaviour at the `<Feed>` level (feeds-discovery
 * /04; SOC-083, COR-053, NFR-001/002, SOC-071, D1-005) through the real
 * rendered DOM — superseding the interim /07 auto-insert this file used to
 * assert:
 *  - a post appended to the live `postStore` AFTER `<Feed>` has mounted does
 *    NOT insert into the reading stream; the seeded rows are untouched and the
 *    sticky "▲ N new posts" pill surfaces the count instead (AC1);
 *  - the list's `aria-live="polite"` contract is unchanged by the arrival — no
 *    new/removed live region, no attribute change, no new row (NFR-001);
 *  - tapping the pill loads the buffered post at the TOP of the stream (AC2),
 *    newest-first (COR-053).
 *
 * (The exhaustive pill suite — observer hides it, bounded burst buffering,
 * scroll-to-top, the pill's own polite region — is added by the story's test
 * pass; this file keeps the pre-existing `<Feed>` integration coverage honest
 * against the new truth.)
 *
 * Renders through the same real provider stack `Feed.test.tsx` uses
 * (ExerciseContext + Session + ShellContext + the shipped mock adapters), so the
 * default mock stream source (`postStore` → `useFeedStream`) is exercised end to
 * end: append → buffer → pill → tap → prepend.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { personaIdForHandle } from '@/features/personas'
import type { Post } from '@/features/social'
import { postStore } from '../services/postStore'
import { Feed } from './Feed'

/** The seeded Fairhaven arc, newest-first by scenarioTime — mirrors Feed.test.tsx. */
const NEWEST_FIRST_SEEDED_IDS = [
  'post-seed-kward-correction', // 14:20 — the current top row.
  'post-seed-mvega-question',
  'post-seed-newsline7-breaking',
  'post-seed-fulco-coordination',
  'post-seed-fwupd-rumor',
  'post-seed-fw-advisory',
]

function buildLivePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-live-append-e2e',
    exerciseId: 'ex-mock-0001',
    // An existing seeded persona so the convergence resolves an author and the
    // row actually renders on load (an unknown author is silently skipped).
    authorPersonaId: personaIdForHandle('FairhavenWater'),
    actingHumanId: 'human-simcell-utility',
    text: 'Systems restored — tap water is safe again in Zones 2-4.',
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    // Newer than every seeded post (max seed = 2033-09-04T14:20:00Z) → top.
    scenarioTime: '2033-09-04T16:00:00Z',
    origin: 'controller-as-persona',
    ...overrides,
  }
}

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

/** The load-time telemetry event (the pill tap), distinguished from the mount
 * 'view' by its `payload.newPostsLoaded`. The mount view carries no payload. */
function loadTelemetryEvents() {
  return getEmittedTelemetryEvents().filter(
    e => e.eventType === 'view' && e.payload !== undefined && 'newPostsLoaded' in e.payload,
  )
}

// jsdom does not implement scrollIntoView; the page guards on its presence, so
// define a spy to (a) exercise the scroll branch and (b) assert it is NOT called
// when a tap resolves nothing (Copilot #301).
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

describe('Feed — real-time arrivals buffer behind the pill (feeds-discovery/04)', () => {
  it('does NOT insert an appended post; the pill surfaces the count instead (AC1)', async () => {
    renderFeed()

    const before = await screen.findAllByTestId('post-card')
    expect(before.map(c => c.getAttribute('data-post-id'))).toEqual(NEWEST_FIRST_SEEDED_IDS)

    act(() => {
      postStore.appendPost(buildLivePost())
    })

    // The pill appears with the count …
    const pill = await screen.findByTestId('new-posts-pill')
    expect(pill).toHaveTextContent('1 new post')

    // … and the reading stream is unchanged (no insert, same rows, same order).
    const after = screen.getAllByTestId('post-card')
    expect(after.map(c => c.getAttribute('data-post-id'))).toEqual(NEWEST_FIRST_SEEDED_IDS)
  })

  it('keeps the aria-live="polite" list contract, unchanged by the arrival (NFR-001)', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')

    const list = screen.getByRole('list')
    expect(list).toHaveAttribute('aria-live', 'polite')

    act(() => {
      postStore.appendPost(buildLivePost())
    })
    await screen.findByTestId('new-posts-pill')

    // Still the SAME list element, still polite, and still only the seeded rows
    // (the arrival is buffered, not inserted).
    expect(screen.getByRole('list')).toBe(list)
    expect(screen.getByRole('list')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getAllByTestId('post-card')).toHaveLength(NEWEST_FIRST_SEEDED_IDS.length)
  })

  it('loads the buffered post at the top when the pill is tapped (AC2)', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')

    act(() => {
      postStore.appendPost(buildLivePost())
    })
    const pill = await screen.findByTestId('new-posts-pill')

    fireEvent.click(pill)

    await waitFor(() => {
      const ids = screen.getAllByTestId('post-card').map(c => c.getAttribute('data-post-id'))
      expect(ids[0]).toBe('post-live-append-e2e')
    })

    const after = screen.getAllByTestId('post-card')
    expect(after.map(c => c.getAttribute('data-post-id'))).toEqual([
      'post-live-append-e2e',
      ...NEWEST_FIRST_SEEDED_IDS,
    ])
    // The pill clears after loading.
    expect(screen.queryByTestId('new-posts-pill')).toBeNull()
  })
})

describe('Feed — pill-load guards against empty/dupe resolve (Copilot #301)', () => {
  it('normal load prepends, scrolls to top, and emits ONE load event with the resolved count', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')

    act(() => {
      postStore.appendPost(buildLivePost())
    })
    const pill = await screen.findByTestId('new-posts-pill')

    fireEvent.click(pill)

    await waitFor(() => {
      const ids = screen.getAllByTestId('post-card').map(c => c.getAttribute('data-post-id'))
      expect(ids[0]).toBe('post-live-append-e2e')
    })

    // Scrolled to top (AC2) …
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' })

    // … and exactly ONE load event whose count reflects what actually rendered.
    const loads = loadTelemetryEvents()
    expect(loads).toHaveLength(1)
    expect(loads[0]?.payload?.newPostsLoaded).toBe(1)
  })

  it('a tap that resolves nothing (unknown author) clears the count WITHOUT scrolling or emitting', async () => {
    renderFeed()
    const before = await screen.findAllByTestId('post-card')
    expect(before.map(c => c.getAttribute('data-post-id'))).toEqual(NEWEST_FIRST_SEEDED_IDS)

    // Buffers fine (the stream source doesn't check authors) — the pill counts
    // it — but the author is not in the persona cast, so resolveLiveViews skips
    // it on load and nothing actually renders (matching the baseline skip).
    act(() => {
      postStore.appendPost(
        buildLivePost({ id: 'post-live-unknown-author', authorPersonaId: 'persona-does-not-exist' }),
      )
    })
    const pill = await screen.findByTestId('new-posts-pill')
    expect(pill).toHaveTextContent('1 new post')

    fireEvent.click(pill)

    // Count clears (drain reset it) and the pill disappears …
    await waitFor(() => expect(screen.queryByTestId('new-posts-pill')).toBeNull())

    // … but the feed did not change, we did NOT scroll, and NO load event fired.
    const after = screen.getAllByTestId('post-card')
    expect(after.map(c => c.getAttribute('data-post-id'))).toEqual(NEWEST_FIRST_SEEDED_IDS)
    expect(scrollSpy).not.toHaveBeenCalled()
    expect(loadTelemetryEvents()).toHaveLength(0)
  })
})
