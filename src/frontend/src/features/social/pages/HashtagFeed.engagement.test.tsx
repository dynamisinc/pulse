/**
 * features/social/pages/HashtagFeed.engagement.test.tsx
 * ---------------------------------------------------------------------------
 * "No dead buttons anywhere" (demo-polish F3, DP-14) for the HASHTAG page: its
 * `<PostCard>`s self-wire like and repost through `PostActions`, so a tap reaches
 * `PUT /posts/{id}/reactions/{like|repost}` and flips the control — no per-page
 * wiring. Mirrors `Profile.engagement.test.tsx`; the real provider stack, mock
 * mode, `api.put` / `api.delete` spied as pass-throughs.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { api } from '@/core/services/api'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { personaIdForHandle } from '@/features/personas'
import type { Post } from '@/features/social'
import { postStore } from '../services/postStore'
import { resetMockReactions } from '../services/reactionService'
import { HashtagFeed } from './HashtagFeed'

const TAGGED_ID = 'post-ht-engage'

function taggedPost(): Post {
  return {
    id: TAGGED_ID,
    exerciseId: 'ex-mock-0001',
    authorPersonaId: personaIdForHandle('FairhavenWater'),
    actingHumanId: 'human-simcell-utility',
    text: 'Water tankers staged at the depot #Zone2Engage',
    counts: { reply: 0, repost: 4, like: 1450 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T13:00:00Z',
    origin: 'controller-as-persona',
  }
}

function renderHashtagFeed() {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant: 'full', scenarioNow: new Date('2033-09-04T16:00:00.000Z') }}
        >
          <HashtagFeed tag="zone2engage" />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

beforeEach(() => {
  resetTelemetryBuffer()
  resetMockReactions()
  postStore.appendPost(taggedPost())
})

afterEach(() => {
  vi.restoreAllMocks()
  postStore.resetForTests()
  resetMockReactions()
  resetTelemetryBuffer()
})

describe('HashtagFeed — post cards have live like and repost', () => {
  it('a like fires PUT /posts/{id}/reactions/like, bumps the compact count and sets aria-pressed', async () => {
    const putSpy = vi.spyOn(api, 'put')
    const user = userEvent.setup()
    renderHashtagFeed()

    const card = (await screen.findAllByTestId('post-card')).find(
      c => c.getAttribute('data-post-id') === TAGGED_ID,
    )
    if (!card) throw new Error('expected the tagged post to render')
    // 1 450 renders compact, with the exact figure in the accessible name.
    const like = within(card).getByRole('button', { name: 'Like, 1.4 thousand (1,450)' })
    expect(like).toHaveTextContent('1.4K')

    await user.click(like)

    expect(putSpy).toHaveBeenCalledTimes(1)
    expect(putSpy.mock.calls[0]?.[0]).toBe(`/posts/${TAGGED_ID}/reactions/like`)
    expect(
      within(card).getByRole('button', { name: 'Like, 1.4 thousand (1,451), liked' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('a repost fires PUT .../reactions/repost and shows the reposted state', async () => {
    const putSpy = vi.spyOn(api, 'put')
    const user = userEvent.setup()
    renderHashtagFeed()

    const card = (await screen.findAllByTestId('post-card')).find(
      c => c.getAttribute('data-post-id') === TAGGED_ID,
    )
    if (!card) throw new Error('expected the tagged post to render')

    await user.click(within(card).getByRole('button', { name: 'Repost, 4' }))

    expect(putSpy.mock.calls[0]?.[0]).toBe(`/posts/${TAGGED_ID}/reactions/repost`)
    expect(within(card).getByRole('button', { name: 'Repost, 5, reposted' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
