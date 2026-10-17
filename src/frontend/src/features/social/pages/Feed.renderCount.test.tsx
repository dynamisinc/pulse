/**
 * features/social/pages/Feed.renderCount.test.tsx
 * ---------------------------------------------------------------------------
 * Pins the burst-legibility memoization (mobile-tablet story 07; NFR-002,
 * SOC-071, D1-005). While a post is buffered behind the "new posts" pill the
 * visible rows must cost NOTHING: an arrival changes only the pill's count, so
 * no existing row (PostBody stands in for "a row re-rendered") may render again.
 * A regression here shows up on a phone as long tasks at 120 posts/min.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { personaIdForHandle } from '@/features/personas'
import type { Post } from '@/features/social'
import { postStore } from '../services/postStore'

const renders = vi.hoisted(() => ({ body: 0 }))

vi.mock('../components/post/PostBody', async importOriginal => {
  const actual = await importOriginal<typeof import('../components/post/PostBody')>()
  return {
    ...actual,
    PostBody: (props: Parameters<typeof actual.PostBody>[0]) => {
      renders.body += 1
      return actual.PostBody(props)
    },
  }
})

import { Feed } from './Feed'

function livePost(id: string): Post {
  return {
    id,
    exerciseId: 'ex-mock-0001',
    authorPersonaId: personaIdForHandle('FairhavenWater'),
    actingHumanId: 'human-simcell-utility',
    text: `Burst ${id} #Burst`,
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T16:00:00Z',
    origin: 'controller-as-persona',
  }
}

afterEach(() => postStore.resetForTests())

describe('Feed - arrivals behind the pill do not re-render existing rows', () => {
  it('appending posts only updates the pill count', async () => {
    render(
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider
            value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
          >
            <Feed onOpenThread={() => {}} />
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>,
    )
    await screen.findAllByTestId('post-card')
    const settled = renders.body
    expect(settled).toBeGreaterThan(0)

    act(() => postStore.appendPost(livePost('rc-1')))
    expect(await screen.findByTestId('new-posts-pill')).toHaveTextContent('1 new post')
    act(() => postStore.appendPost(livePost('rc-2')))
    expect(screen.getByTestId('new-posts-pill')).toHaveTextContent('2 new posts')

    expect(renders.body).toBe(settled)
  })
})
