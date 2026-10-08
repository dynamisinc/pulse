/**
 * features/social/components/post/PostActions.live.test.tsx
 * ---------------------------------------------------------------------------
 * The action row in LIVE mode (`USE_MOCK_DATA` forced false; demo-polish F3,
 * implementation.md §1.5.4 / §1.8). The shared axios client is a spy, so every
 * assertion is about what actually goes over the wire:
 *
 *  - like / repost -> `PUT /posts/{id}/reactions/{like|repost}`; unlike / undo ->
 *    `DELETE` on the same URL. NO body, NO query, NO config: the request never
 *    carries an `exerciseId`, a `personaId` or a timestamp (COR-001, COR-053);
 *  - the response's `counts` and `viewer` RECONCILE the optimistic state — the
 *    server's number wins over the client's ±1;
 *  - a rejected request or a malformed 200 rolls back EXACTLY and announces it;
 *  - ZERO client telemetry in live mode (the server is authoritative, §1.8) — not
 *    a `reaction`, not a `repost`;
 *  - the mock-only seed never leaks onto the wire.
 *
 * Own file: the module mocks below are hoisted over the whole file and cannot
 * share it with the real-provider, mock-mode specs in `PostActions.test.tsx`. The
 * session / exercise hooks are mocked (rather than provided) because the real
 * providers resolve through the same mocked `api` and `USE_MOCK_DATA`.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { api } from '@/core/services/api'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { personaById, personaIdForHandle } from '@/features/personas'
import { PostActions } from './PostActions'
import type { PostView } from './types'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/services/api', () => ({
  api: { put: vi.fn(), delete: vi.fn(), post: vi.fn().mockResolvedValue(undefined) },
}))

const LIVE_SESSION: Session = {
  exerciseId: 'ex-live-0001',
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
    exerciseId: 'ex-live-0001',
    exerciseName: 'Live',
    timeZone: 'America/Chicago',
    status: 'active',
  }),
}))

const POST_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

function author() {
  const persona = personaById(personaIdForHandle('FairhavenWater'))
  if (!persona) throw new Error('fixture missing seeded persona')
  return persona
}

function buildPost(overrides: Partial<PostView> = {}): PostView {
  return {
    id: POST_ID,
    author: author(),
    text: 'text',
    counts: { reply: 3, repost: 7, like: 42 },
    scenarioTime: '2026-07-16T12:00:00.000Z',
    ...overrides,
  }
}

/** A well-formed `ReactionStateDto` body (the server's answer). */
function reactionBody(
  kind: 'like' | 'repost',
  active: boolean,
  counts: { reply?: number; repost: number; like: number },
  viewer: { liked: boolean; reposted: boolean },
) {
  return { data: { postId: POST_ID, kind, active, counts: { reply: 3, ...counts }, viewer } }
}

function eventTypes() {
  return getEmittedTelemetryEvents().map(e => e.eventType)
}

beforeEach(() => {
  resetTelemetryBuffer()
  vi.mocked(api.put).mockReset()
  vi.mocked(api.delete).mockReset()
})

afterEach(() => {
  resetTelemetryBuffer()
})

describe('PostActions (live) — the wire', () => {
  it('likes with PUT on the like URL, no body and no config, then DELETEs to unlike', async () => {
    vi.mocked(api.put).mockResolvedValue(
      reactionBody('like', true, { repost: 7, like: 43 }, { liked: true, reposted: false }),
    )
    vi.mocked(api.delete).mockResolvedValue(
      reactionBody('like', false, { repost: 7, like: 42 }, { liked: false, reposted: false }),
    )
    const user = userEvent.setup()
    render(<PostActions post={buildPost()} variant="full" />)

    await user.click(screen.getByRole('button', { name: 'Like, 42' }))
    expect(api.put).toHaveBeenCalledTimes(1)
    // (url, body, config) — body and config are both undefined in live mode.
    expect(api.put).toHaveBeenCalledWith(`/posts/${POST_ID}/reactions/like`, undefined, undefined)
    expect(await screen.findByRole('button', { name: 'Like, 43, liked' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Like, 43, liked' }))
    expect(api.delete).toHaveBeenCalledTimes(1)
    expect(api.delete).toHaveBeenCalledWith(`/posts/${POST_ID}/reactions/like`, undefined)
    expect(await screen.findByRole('button', { name: 'Like, 42' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('reposts and undoes through the repost URL', async () => {
    vi.mocked(api.put).mockResolvedValue(
      reactionBody('repost', true, { repost: 8, like: 42 }, { liked: false, reposted: true }),
    )
    vi.mocked(api.delete).mockResolvedValue(
      reactionBody('repost', false, { repost: 7, like: 42 }, { liked: false, reposted: false }),
    )
    const user = userEvent.setup()
    render(<PostActions post={buildPost()} variant="full" />)

    await user.click(screen.getByRole('button', { name: 'Repost, 7' }))
    expect(api.put).toHaveBeenCalledWith(`/posts/${POST_ID}/reactions/repost`, undefined, undefined)
    await user.click(await screen.findByRole('button', { name: 'Repost, 8, reposted' }))
    expect(api.delete).toHaveBeenCalledWith(`/posts/${POST_ID}/reactions/repost`, undefined)
    expect(await screen.findByRole('button', { name: 'Repost, 7' })).toBeInTheDocument()
  })

  it('URL-encodes an opaque post id and never puts exerciseId / personaId anywhere in the request', async () => {
    vi.mocked(api.put).mockResolvedValue({
      data: {
        postId: 'post/odd id',
        kind: 'like',
        active: true,
        counts: { reply: 0, repost: 0, like: 1 },
        viewer: { liked: true, reposted: false },
      },
    })
    const user = userEvent.setup()
    render(
      <PostActions
        post={buildPost({ id: 'post/odd id', counts: { reply: 0, repost: 0, like: 0 } })}
        variant="full"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Like, 0' }))

    await waitFor(() => expect(api.put).toHaveBeenCalled())
    const [url, body, config] = vi.mocked(api.put).mock.calls[0] ?? []
    expect(url).toBe('/posts/post%2Fodd%20id/reactions/like')
    expect(body).toBeUndefined()
    expect(config).toBeUndefined()
    const wire = JSON.stringify(vi.mocked(api.put).mock.calls)
    expect(wire).not.toContain('ex-live-0001')
    expect(wire).not.toContain('persona-live-viewer')
  })
})

describe('PostActions (live) — reconcile with the server', () => {
  it('adopts the server\'s count and viewer flag over the optimistic ±1', async () => {
    // Another participant liked it meanwhile: 42 -> the server says 57.
    vi.mocked(api.put).mockResolvedValue(
      reactionBody('like', true, { repost: 7, like: 57 }, { liked: true, reposted: false }),
    )
    const user = userEvent.setup()
    render(<PostActions post={buildPost()} variant="full" />)

    await user.click(screen.getByRole('button', { name: 'Like, 42' }))

    expect(await screen.findByRole('button', { name: 'Like, 57, liked' })).toBeInTheDocument()
  })

  it('self-corrects when the server says the reaction is NOT active (idempotent repeat)', async () => {
    // The viewer already liked it in another tab; our PUT is a no-op the other way round.
    vi.mocked(api.delete).mockResolvedValue(
      reactionBody('like', false, { repost: 7, like: 42 }, { liked: false, reposted: false }),
    )
    const user = userEvent.setup()
    render(
      <PostActions
        post={buildPost({
          counts: { reply: 3, repost: 7, like: 43 },
          viewer: { liked: true, reposted: false },
        })}
        variant="full"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Like, 43, liked' }))

    expect(await screen.findByRole('button', { name: 'Like, 42' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('PostActions (live) — rollback', () => {
  it('rolls back exactly and announces when the request is rejected', async () => {
    vi.mocked(api.put).mockRejectedValue(new Error('503'))
    const user = userEvent.setup()
    render(<PostActions post={buildPost()} variant="full" />)

    await user.click(screen.getByRole('button', { name: 'Like, 42' }))

    await waitFor(() =>
      expect(screen.getByTestId('post-actions-notice')).toHaveTextContent(/couldn't update your like/i))
    const like = screen.getByRole('button', { name: 'Like, 42' })
    expect(like).toHaveAttribute('aria-pressed', 'false')
    expect(like).toHaveTextContent('42')
  })

  it('treats a malformed 200 body as a failure and rolls back (fail closed)', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { postId: POST_ID, kind: 'like', active: true } })
    const user = userEvent.setup()
    render(<PostActions post={buildPost()} variant="full" />)

    await user.click(screen.getByRole('button', { name: 'Like, 42' }))

    await waitFor(() =>
      expect(screen.getByTestId('post-actions-notice')).toHaveTextContent(/couldn't update your like/i))
    expect(screen.getByRole('button', { name: 'Like, 42' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('treats a response for the wrong kind as a failure', async () => {
    vi.mocked(api.put).mockResolvedValue(
      reactionBody('repost', true, { repost: 8, like: 43 }, { liked: true, reposted: true }),
    )
    const user = userEvent.setup()
    render(<PostActions post={buildPost()} variant="full" />)

    await user.click(screen.getByRole('button', { name: 'Like, 42' }))

    await waitFor(() =>
      expect(screen.getByTestId('post-actions-notice')).toHaveTextContent(/couldn't update your like/i))
    expect(screen.getByRole('button', { name: 'Like, 42' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('a rapid double tap while the write is pending sends ONE request', async () => {
    let resolve: (value: unknown) => void = () => undefined
    vi.mocked(api.put).mockReturnValue(new Promise(r => { resolve = r }))
    const user = userEvent.setup()
    render(<PostActions post={buildPost()} variant="full" />)

    await user.click(screen.getByRole('button', { name: 'Like, 42' }))
    // Optimistic and still pending: a second tap must not toggle back or re-send.
    await user.click(screen.getByRole('button', { name: 'Like, 43, liked' }))

    expect(api.put).toHaveBeenCalledTimes(1)
    expect(api.delete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Like, 43, liked' })).toBeInTheDocument()

    resolve(reactionBody('like', true, { repost: 7, like: 43 }, { liked: true, reposted: false }))
    expect(await screen.findByRole('button', { name: 'Like, 43, liked' })).toBeInTheDocument()
    expect(api.put).toHaveBeenCalledTimes(1)
  })
})

describe('PostActions (live) — no double telemetry (§1.8)', () => {
  it('emits NO reaction and NO repost event from the client, on success or on failure', async () => {
    vi.mocked(api.put)
      .mockResolvedValueOnce(
        reactionBody('like', true, { repost: 7, like: 43 }, { liked: true, reposted: false }),
      )
      .mockResolvedValueOnce(
        reactionBody('repost', true, { repost: 8, like: 43 }, { liked: true, reposted: true }),
      )
      .mockRejectedValueOnce(new Error('503'))
    vi.mocked(api.delete).mockResolvedValue(
      reactionBody('like', false, { repost: 8, like: 42 }, { liked: false, reposted: true }),
    )
    const user = userEvent.setup()
    render(<PostActions post={buildPost()} variant="full" />)

    await user.click(screen.getByRole('button', { name: 'Like, 42' }))
    await screen.findByRole('button', { name: 'Like, 43, liked' })
    await user.click(screen.getByRole('button', { name: 'Repost, 7' }))
    await screen.findByRole('button', { name: 'Repost, 8, reposted' })
    await user.click(screen.getByRole('button', { name: 'Like, 43, liked' }))
    await screen.findByRole('button', { name: 'Like, 42' })
    // Third PUT rejects (a failed write).
    await user.click(screen.getByRole('button', { name: 'Like, 42' }))
    await waitFor(() =>
      expect(screen.getByTestId('post-actions-notice')).toHaveTextContent(/couldn't update/i))

    const types = eventTypes()
    expect(types).not.toContain('reaction')
    expect(types).not.toContain('repost')
    expect(types).not.toContain('quote')
  })
})

describe('PostActions (live) — controls', () => {
  it('has no Quote trigger and no Share action', () => {
    render(<PostActions post={buildPost({ counts: { reply: 1, repost: 2, like: 3, share: 9 } })} variant="full" />)

    expect(screen.queryByTestId('post-quote-trigger')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /quote|share/i })).not.toBeInTheDocument()
  })
})
