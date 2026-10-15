/**
 * features/social/components/post/PostActions.liveCounts.test.tsx
 * ---------------------------------------------------------------------------
 * Demo-feedback story 14 (DF-17 / DF-18): the action row follows live engagement pushes.
 *
 *  - A `PostEngagementChanged` frame (applied to `postCountsStore`, as the realtime wiring does)
 *    moves the reply / repost / like NUMBERS on a mounted card - on live controls and on inert
 *    counts alike - and NEVER the viewer's own liked / reposted state (`aria-pressed`).
 *  - An optimistic toggle in flight is not overwritten by an older frame; the server's answer
 *    reconciles it, and a newer frame after that still lands.
 *
 * LIVE mode (`USE_MOCK_DATA` false) with the shared axios client mocked, as in
 * `PostActions.live.test.tsx`; the session / exercise hooks are mocked the same way.
 */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { api } from '@/core/services/api'
import { personaById, personaIdForHandle } from '@/features/personas'
import { postCountsStore } from '../../services/postCountsStore'
import { PostActions } from './PostActions'
import type { PostView } from './types'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/services/api', () => ({
  api: { put: vi.fn(), delete: vi.fn(), post: vi.fn().mockResolvedValue(undefined) },
}))

const LIVE_SESSION: Session = {
  exerciseId: 'ex-live-0014',
  accountId: 'acct-live',
  role: 'participant',
  personaId: 'persona-live-viewer',
  actingHumanId: 'human-live',
  isReadOnly: false,
  expiresAt: '2999-01-01T00:00:00.000Z',
}

vi.mock('@/core/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth')>()),
  useSession: () => LIVE_SESSION,
}))
vi.mock('@/core/exerciseContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/exerciseContext')>()),
  useExerciseContext: () => ({
    exerciseId: 'ex-live-0014',
    exerciseName: 'Live',
    timeZone: 'America/Chicago',
    status: 'active',
  }),
}))

const POST_ID = '9b2c1f0e-7a1d-4c55-9f5e-2b8d3c4e5f60'

function buildPost(overrides: Partial<PostView> = {}): PostView {
  const author = personaById(personaIdForHandle('FairhavenWater'))
  if (!author) throw new Error('fixture missing seeded persona')
  return {
    id: POST_ID,
    author,
    text: 'text',
    counts: { reply: 3, repost: 7, like: 42 },
    scenarioTime: '2026-07-16T12:00:00.000Z',
    ...overrides,
  }
}

function push(counts: { reply: number; repost: number; like: number }, version: number) {
  act(() => {
    postCountsStore.apply(POST_ID, counts, version)
  })
}

beforeEach(() => {
  postCountsStore.reset()
  vi.mocked(api.put).mockReset()
  vi.mocked(api.delete).mockReset()
})

describe('PostActions — live engagement counts (DF-17)', () => {
  it('moves the numbers on a push while the viewer’s own liked / reposted state stays', () => {
    render(
      <PostActions
        post={buildPost({ viewer: { liked: true, reposted: false } })}
        variant="full"
        onReply={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Like, 42, liked' })).toHaveAttribute('aria-pressed', 'true')

    push({ reply: 5, repost: 9, like: 50 }, 3)

    const like = screen.getByRole('button', { name: 'Like, 50, liked' })
    expect(like).toHaveAttribute('aria-pressed', 'true')
    const repost = screen.getByRole('button', { name: 'Repost, 9' })
    expect(repost).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Reply, 5' })).toBeInTheDocument()

    // A push that LOWERS the like count still never flips the viewer's own heart off.
    push({ reply: 5, repost: 9, like: 41 }, 4)
    expect(screen.getByRole('button', { name: 'Like, 41, liked' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('drops a stale frame (lower version) after a newer one', () => {
    render(<PostActions post={buildPost()} variant="full" />)

    push({ reply: 3, repost: 7, like: 45 }, 10)
    push({ reply: 3, repost: 7, like: 43 }, 9)

    expect(screen.getByRole('button', { name: 'Like, 45' })).toBeInTheDocument()
  })

  it('moves inert counts too (a read-only card)', () => {
    render(<PostActions post={buildPost()} variant="readOnly" />)

    push({ reply: 4, repost: 8, like: 43 }, 1)

    const row = screen.getByTestId('post-actions')
    expect(row.querySelector('[data-action="reply"]')).toHaveTextContent('4')
    expect(row.querySelector('[data-action="repost"]')).toHaveTextContent('8')
    expect(row.querySelector('[data-action="like"]')).toHaveTextContent('43')
  })

  it('never overwrites an optimistic toggle in flight with an older frame', async () => {
    let resolvePut: (value: unknown) => void = () => {}
    vi.mocked(api.put).mockReturnValue(new Promise(resolve => {
      resolvePut = resolve
    }))
    const user = userEvent.setup()
    render(<PostActions post={buildPost()} variant="full" />)

    await user.click(screen.getByRole('button', { name: 'Like, 42' }))
    expect(screen.getByRole('button', { name: 'Like, 43, liked' })).toBeInTheDocument()

    // A frame from BEFORE this like (someone else's earlier unlike) lands while the PUT is out.
    push({ reply: 3, repost: 7, like: 41 }, 5)
    expect(screen.getByRole('button', { name: 'Like, 43, liked' })).toHaveAttribute('aria-pressed', 'true')

    // The server's answer reconciles the toggle.
    await act(async () => {
      resolvePut({
        data: {
          postId: POST_ID,
          kind: 'like',
          active: true,
          counts: { reply: 3, repost: 7, like: 42 },
          viewer: { liked: true, reposted: false },
        },
      })
    })
    expect(await screen.findByRole('button', { name: 'Like, 42, liked' })).toBeInTheDocument()

    // A newer frame after the write settled still lands, and the heart stays on.
    push({ reply: 3, repost: 7, like: 44 }, 7)
    expect(screen.getByRole('button', { name: 'Like, 44, liked' })).toHaveAttribute('aria-pressed', 'true')
  })
})
