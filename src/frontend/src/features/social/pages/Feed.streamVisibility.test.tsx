/**
 * features/social/pages/Feed.streamVisibility.test.tsx
 * ---------------------------------------------------------------------------
 * Test pass for feeds-discovery/04 "Realtime new-posts pill" (#123) — the
 * observer-hidden contract at the `<Feed>` level (D1-011, COR-015): under a
 * non-"full" shell variant, the stream is not merely visually hidden but
 * genuinely INERT — nothing starts, nothing buffers, nothing announces — and
 * this is contrasted against the "full" variant where the same arrival
 * produces the pill.
 *
 * Renders through the same real provider stack `Feed.liveAppend.test.tsx`
 * uses (ExerciseContext + Session + ShellContext + the shipped mock
 * adapters), so the default mock stream source (`postStore` → `useFeedStream`)
 * is exercised end to end.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import {
  ShellContextProvider,
  type ShellVariant,
} from '@/features/participant-shell/mountContract'
import { personaIdForHandle } from '@/features/personas'
import type { Post } from '@/features/social'
import { postStore } from '../services/postStore'
import { Feed } from './Feed'

function buildLivePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-live-observer-hidden',
    exerciseId: 'ex-mock-0001',
    authorPersonaId: personaIdForHandle('FairhavenWater'),
    actingHumanId: 'human-simcell-utility',
    text: 'Systems restored — tap water is safe again in Zones 2-4.',
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T16:00:00Z',
    origin: 'controller-as-persona',
    ...overrides,
  }
}

function renderFeed(variant: ShellVariant) {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant, scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
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

describe('Feed — the stream is observer-hidden AND inert under a non-"full" variant (D1-011)', () => {
  it.each(['readOnly', 'preview'] as const)(
    'variant=%s: no pill ever appears, and the arrival is not buffered/inserted',
    async variant => {
      renderFeed(variant)
      const before = await screen.findAllByTestId('post-card')

      // Hidden from the first render — the observer has no pill at all.
      expect(screen.queryByTestId('new-posts-pill')).toBeNull()

      act(() => {
        postStore.appendPost(buildLivePost())
      })

      // Still hidden after the arrival — the stream never started, so there
      // is nothing to buffer or announce (genuinely inert, not just unmounted UI).
      expect(screen.queryByTestId('new-posts-pill')).toBeNull()

      // No insert either — parity with the frozen-baseline guarantee (AC1).
      const after = screen.getAllByTestId('post-card')
      expect(after.map(c => c.getAttribute('data-post-id'))).toEqual(
        before.map(c => c.getAttribute('data-post-id')),
      )
      expect(
        after.some(c => c.getAttribute('data-post-id') === 'post-live-observer-hidden'),
      ).toBe(false)
    },
  )

  it('contrast: the pill DOES appear under variant="full" for the identical arrival', async () => {
    renderFeed('full')
    await screen.findAllByTestId('post-card')

    act(() => {
      postStore.appendPost(buildLivePost())
    })

    const pill = await screen.findByTestId('new-posts-pill')
    expect(pill).toHaveTextContent('1 new post')
  })
})
