/**
 * features/social/pages/Feed.liveAppend.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the story's Component (RTL) acceptance criterion (feeds-discovery/07;
 * SOC-083 partial, COR-053, NFR-001, NFR-002/SOC-071) at the `<Feed>` level —
 * the seam `useFeed.test.ts` proves at the hook layer, proved here through the
 * real rendered DOM:
 *  - a post appended to the live `postStore` AFTER `<Feed>` has mounted renders
 *    a NEW `<PostCard>` at the TOP of the list (newest-first, COR-053);
 *  - the list's `aria-live="polite"` contract survives the append unchanged
 *    (no new/removed live region, no attribute change — NFR-001);
 *  - the previously-rendered seeded rows are NOT torn down and recreated — the
 *    prior top card's DOM node identity is preserved, just shifted down one
 *    position (the NFR-002/SOC-071 burst-legibility guarantee, proved via the
 *    actual DOM this time, not just the memoized `PostView` array).
 *
 * Renders through the same real provider stack `Feed.test.tsx` uses
 * (ExerciseContext + Session + ShellContext + the shipped mock adapters) so
 * this exercises the true integration: `postStore` → `feedService.resolveFeed`
 * (mock adapter) / `useFeed`'s subscription → `assembleFeedView` → `<Feed>`.
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
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
    // row actually renders (an unknown author is silently skipped).
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

afterEach(() => {
  postStore.resetForTests()
})

describe('Feed — live append renders at the top (feeds-discovery/07)', () => {
  it('mounts a new <PostCard> at position 0, above the previous top row', async () => {
    renderFeed()

    const before = await screen.findAllByTestId('post-card')
    expect(before.map(c => c.getAttribute('data-post-id'))).toEqual(NEWEST_FIRST_SEEDED_IDS)

    act(() => {
      postStore.appendPost(buildLivePost())
    })

    await waitFor(() => {
      const ids = screen.getAllByTestId('post-card').map(c => c.getAttribute('data-post-id'))
      expect(ids[0]).toBe('post-live-append-e2e')
    })

    const after = screen.getAllByTestId('post-card')
    expect(after.map(c => c.getAttribute('data-post-id'))).toEqual([
      'post-live-append-e2e',
      ...NEWEST_FIRST_SEEDED_IDS,
    ])
  })

  it('keeps the aria-live="polite" contract on the list, unchanged by the append', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')

    const list = screen.getByRole('list')
    expect(list).toHaveAttribute('aria-live', 'polite')

    act(() => {
      postStore.appendPost(buildLivePost())
    })

    await waitFor(() => {
      expect(screen.getAllByTestId('post-card')).toHaveLength(NEWEST_FIRST_SEEDED_IDS.length + 1)
    })

    // Still the SAME list element (not torn down/recreated) and still polite.
    expect(screen.getByRole('list')).toBe(list)
    expect(screen.getByRole('list')).toHaveAttribute('aria-live', 'polite')
  })

  it('does not remount the existing rows — the prior top card keeps its DOM identity', async () => {
    renderFeed()

    const before = await screen.findAllByTestId('post-card')
    const priorTopCard = before[0]
    expect(priorTopCard).toBeDefined()
    expect(priorTopCard?.getAttribute('data-post-id')).toBe('post-seed-kward-correction')

    act(() => {
      postStore.appendPost(buildLivePost())
    })

    await waitFor(() => {
      expect(screen.getAllByTestId('post-card')[0]?.getAttribute('data-post-id')).toBe(
        'post-live-append-e2e',
      )
    })

    const after = screen.getAllByTestId('post-card')
    // The prior top row is now second — same node, not a fresh mount.
    expect(after[1]).toBe(priorTopCard)
  })
})
