/**
 * features/social/components/post/PostActions.test.tsx
 * ---------------------------------------------------------------------------
 * The action row in MOCK mode (the Vitest default: `USE_MOCK_DATA` is true), after
 * demo-polish F3 "Engagement — persisted likes and reposts". `PostActions`
 * SELF-WIRES `useReaction()` / `useAmplify()`, so a bare `<PostCard>` — with no
 * per-page wiring — has live like AND repost.
 *
 * Pins: canonical reply · repost · like order and accessible names (NFR-001); NO
 * Share and NO Quote anywhere (hidden, not disabled); COMPACT counts with
 * accessible names at the 0 / 9 / 999 / 1 000 / 1 450 / 12 300 boundaries;
 * optimistic like and repost with `aria-pressed` + the "…, liked" / "…, reposted"
 * suffix and exactly ONE XC-004 event per confirmed toggle (mock parity); the
 * viewer's initial state from `post.viewer`; ROLLBACK on a failed write (exact
 * revert, polite live-region message, no event); the in-flight guard; `onReply`;
 * and the read-only variant (controls ABSENT, counts inert — COR-015/D1-011).
 *
 * Live mode (`PostActions.live.test.tsx`) and no-persona sessions
 * (`PostActions.noPersona.test.tsx`) live in their own files because they need
 * module-level mocks that cannot share a file with these real-provider specs.
 */
import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { api } from '@/core/services/api'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { personaById, personaIdForHandle } from '@/features/personas'
import { resetMockReactions, setMockReactionFailure } from '../../services/reactionService'
import { PostActions } from './PostActions'
import type { PostView } from './types'

function author() {
  const persona = personaById(personaIdForHandle('FairhavenWater'))
  if (!persona) throw new Error('fixture missing seeded persona')
  return persona
}

function buildPost(overrides: Partial<PostView> = {}): PostView {
  return {
    id: 'post-actions-1',
    author: author(),
    text: 'text',
    counts: { reply: 3, repost: 7, like: 42 },
    scenarioTime: '2026-07-16T12:00:00.000Z',
    ...overrides,
  }
}

async function renderActions(node: ReactNode) {
  const utils = render(
    <ExerciseContextProvider>
      <SessionProvider>{node}</SessionProvider>
    </ExerciseContextProvider>,
  )
  await screen.findByTestId('post-actions')
  return utils
}

function eventsOf(type: string) {
  return getEmittedTelemetryEvents().filter(e => e.eventType === type)
}

beforeEach(() => {
  resetTelemetryBuffer()
  resetMockReactions()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetMockReactions()
  resetTelemetryBuffer()
})

describe('PostActions — anatomy (R-002, NFR-001)', () => {
  it('renders reply, repost, like in canonical order with "<Label>, <count>" names', async () => {
    await renderActions(<PostActions post={buildPost()} variant="full" onReply={vi.fn()} />)

    const buttons = screen.getByTestId('post-actions').querySelectorAll('button[data-action]')
    expect(Array.from(buttons).map(b => b.getAttribute('data-action'))).toEqual([
      'reply',
      'repost',
      'like',
    ])
    expect(screen.getByRole('button', { name: 'Reply, 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repost, 7' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Like, 42' })).toBeInTheDocument()
  })
})

describe('PostActions — Quote and Share are hidden (F3, D1-011: absent, not disabled)', () => {
  it('renders no Share action even when the counts carry a share figure', async () => {
    await renderActions(
      <PostActions
        post={buildPost({ counts: { reply: 1, repost: 2, like: 3, share: 4 } })}
        variant="full"
      />,
    )

    const region = screen.getByTestId('post-actions')
    expect(Array.from(region.querySelectorAll('[data-action]')).map(e => e.getAttribute('data-action')))
      .toEqual(['reply', 'repost', 'like'])
    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument()
  })

  it('renders no Quote trigger and never mounts the quote panel', async () => {
    const user = userEvent.setup()
    await renderActions(<PostActions post={buildPost()} variant="full" />)

    expect(screen.queryByTestId('post-quote-trigger')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^quote/i })).not.toBeInTheDocument()
    // Even after the repost control is used, no quote surface appears.
    await user.click(screen.getByRole('button', { name: /^repost/i }))
    expect(screen.queryByTestId('quote-composer')).not.toBeInTheDocument()
    expect(eventsOf('quote')).toHaveLength(0)
  })
})

describe('PostActions — compact counts with exact accessible names (F3)', () => {
  const cases: ReadonlyArray<readonly [number, string, string]> = [
    // [count, visible text, accessible-name count]
    [0, '0', '0'],
    [9, '9', '9'],
    [999, '999', '999'],
    [1000, '1K', '1 thousand (1,000)'],
    [1450, '1.4K', '1.4 thousand (1,450)'],
    [12300, '12.3K', '12.3 thousand (12,300)'],
    [1_200_000, '1.2M', '1.2 million (1,200,000)'],
  ]

  it.each(cases)('renders %i as "%s" with the accessible name "Like, %s"', async (count, visible, spoken) => {
    await renderActions(
      <PostActions post={buildPost({ counts: { reply: 0, repost: 0, like: count } })} variant="full" />,
    )

    const like = screen.getByRole('button', { name: `Like, ${spoken}` })
    expect(within(like).getByText(visible)).toBeInTheDocument()
    expect(like).toHaveTextContent(visible)
  })

  it('compacts the reply and repost counts too, and keeps the exact figure in their names', async () => {
    await renderActions(
      <PostActions
        post={buildPost({ counts: { reply: 1450, repost: 12300, like: 9 } })}
        variant="full"
        onReply={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Reply, 1.4 thousand (1,450)' })).toHaveTextContent('1.4K')
    expect(screen.getByRole('button', { name: 'Repost, 12.3 thousand (12,300)' })).toHaveTextContent('12.3K')
  })

  it('keeps the compact count and the "liked" suffix together once liked', async () => {
    const user = userEvent.setup()
    await renderActions(
      <PostActions post={buildPost({ counts: { reply: 0, repost: 0, like: 1450 } })} variant="full" />,
    )

    await user.click(screen.getByRole('button', { name: 'Like, 1.4 thousand (1,450)' }))

    // 1 451 still truncates to 1.4K — the visual stays put, the exact figure moves.
    const liked = screen.getByRole('button', { name: 'Like, 1.4 thousand (1,451), liked' })
    expect(liked).toHaveTextContent('1.4K')
    expect(liked).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('PostActions — self-wired like (SOC-030)', () => {
  it('toggles optimistically, never colour-only, with one reaction event per toggle', async () => {
    const user = userEvent.setup()
    await renderActions(<PostActions post={buildPost({ id: 'post-like' })} variant="full" />)

    const like = screen.getByRole('button', { name: 'Like, 42' })
    expect(like).toHaveAttribute('aria-pressed', 'false')

    await user.click(like)

    const liked = screen.getByRole('button', { name: 'Like, 43, liked' })
    expect(liked).toHaveAttribute('aria-pressed', 'true')
    // The ON state carries a class (filled icon + heavier count) as well as the ARIA cues.
    expect(liked.className).toMatch(/actionButtonActive/)
    let events = eventsOf('reaction')
    expect(events).toHaveLength(1)
    expect(events[0]?.target).toEqual({ entityType: 'post', entityId: 'post-like' })
    expect(events[0]?.payload).toEqual({ reaction: 'like', liked: true })

    await user.click(liked)

    const unliked = screen.getByRole('button', { name: 'Like, 42' })
    expect(unliked).toHaveAttribute('aria-pressed', 'false')
    expect(unliked.className).not.toMatch(/actionButtonActive/)
    events = eventsOf('reaction')
    expect(events).toHaveLength(2)
    expect(events[1]?.payload).toEqual({ reaction: 'like', liked: false })
  })

  it('starts liked when the post says the viewer already liked it', async () => {
    await renderActions(
      <PostActions
        post={buildPost({
          counts: { reply: 0, repost: 0, like: 43 },
          viewer: { liked: true, reposted: false },
        })}
        variant="full"
      />,
    )

    expect(screen.getByRole('button', { name: 'Like, 43, liked' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // Starting liked is a read, not a toggle: nothing is emitted.
    expect(eventsOf('reaction')).toHaveLength(0)
  })

  it('leaves aria-pressed false when the viewer state is unknown (absent)', async () => {
    await renderActions(<PostActions post={buildPost({ viewer: undefined })} variant="full" />)

    expect(screen.getByRole('button', { name: 'Like, 42' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Repost, 7' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('PostActions — self-wired repost toggle (SOC-020, SOC-021)', () => {
  it('reposts: count +1, aria-pressed, "reposted" suffix, one repost event; undo reverses', async () => {
    const user = userEvent.setup()
    await renderActions(<PostActions post={buildPost({ id: 'post-rp' })} variant="full" />)

    const repost = screen.getByRole('button', { name: 'Repost, 7' })
    expect(repost).toHaveAttribute('aria-pressed', 'false')
    await user.click(repost)

    const reposted = screen.getByRole('button', { name: 'Repost, 8, reposted' })
    expect(reposted).toHaveAttribute('aria-pressed', 'true')
    expect(reposted.className).toMatch(/actionButtonActive/)
    // The like control is a different toggle and is untouched.
    expect(screen.getByRole('button', { name: 'Like, 42' })).toHaveAttribute('aria-pressed', 'false')

    let events = eventsOf('repost')
    expect(events).toHaveLength(1)
    expect(events[0]?.target).toEqual({ entityType: 'post', entityId: 'post-rp' })
    expect(events[0]?.payload).toEqual({ reposted: true })

    await user.click(reposted)

    expect(screen.getByRole('button', { name: 'Repost, 7' })).toHaveAttribute('aria-pressed', 'false')
    events = eventsOf('repost')
    expect(events).toHaveLength(2)
    expect(events[1]?.payload).toEqual({ reposted: false })
  })

  it('starts reposted when the post says the viewer already reposted it', async () => {
    await renderActions(
      <PostActions
        post={buildPost({ viewer: { liked: false, reposted: true } })}
        variant="full"
      />,
    )

    expect(screen.getByRole('button', { name: 'Repost, 7, reposted' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

describe('PostActions — rollback on a failed write (F3)', () => {
  it('reverts the count and aria-pressed exactly, announces a polite message, emits nothing', async () => {
    const user = userEvent.setup()
    await renderActions(<PostActions post={buildPost({ id: 'post-fail' })} variant="full" />)
    const notice = screen.getByTestId('post-actions-notice')
    // The live region is mounted up front, polite, and empty.
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveAttribute('aria-live', 'polite')
    expect(notice).toBeEmptyDOMElement()

    setMockReactionFailure(true)
    await user.click(screen.getByRole('button', { name: 'Like, 42' }))

    await waitFor(() => expect(notice).toHaveTextContent(/couldn't update your like/i))
    const like = screen.getByRole('button', { name: 'Like, 42' })
    expect(like).toHaveAttribute('aria-pressed', 'false')
    expect(eventsOf('reaction')).toHaveLength(0)

    // A retry after the failure clears the message and succeeds.
    setMockReactionFailure(false)
    await user.click(like)
    expect(screen.getByRole('button', { name: 'Like, 43, liked' })).toBeInTheDocument()
    expect(notice).toBeEmptyDOMElement()
    expect(eventsOf('reaction')).toHaveLength(1)
  })

  it('rolls an undo back too (the heart stays on, the count unchanged)', async () => {
    const user = userEvent.setup()
    await renderActions(
      <PostActions
        post={buildPost({
          counts: { reply: 0, repost: 5, like: 43 },
          viewer: { liked: true, reposted: true },
        })}
        variant="full"
      />,
    )

    setMockReactionFailure(true)
    await user.click(screen.getByRole('button', { name: 'Like, 43, liked' }))
    await waitFor(() =>
      expect(screen.getByTestId('post-actions-notice')).toHaveTextContent(/couldn't update your like/i))
    expect(screen.getByRole('button', { name: 'Like, 43, liked' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Repost, 5, reposted' }))
    await waitFor(() =>
      expect(screen.getByTestId('post-actions-notice')).toHaveTextContent(/couldn't update your repost/i))
    expect(screen.getByRole('button', { name: 'Repost, 5, reposted' })).toHaveAttribute('aria-pressed', 'true')
    expect(eventsOf('repost')).toHaveLength(0)
  })

  it('dismisses the message by itself after a few seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderActions(<PostActions post={buildPost()} variant="full" />)
      setMockReactionFailure(true)
      await user.click(screen.getByRole('button', { name: 'Like, 42' }))
      const notice = screen.getByTestId('post-actions-notice')
      await waitFor(() => expect(notice).toHaveTextContent(/couldn't update/i))

      act(() => {
        vi.advanceTimersByTime(7000)
      })

      expect(notice).toBeEmptyDOMElement()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('PostActions — in-flight guard', () => {
  it('two back-to-back taps before the write settles send ONE request and count once', async () => {
    const putSpy = vi.spyOn(api, 'put')
    await renderActions(<PostActions post={buildPost({ id: 'post-dbl' })} variant="full" />)
    const like = screen.getByRole('button', { name: 'Like, 42' })

    fireEvent.click(like)
    fireEvent.click(screen.getByRole('button', { name: /^like/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Like, 43, liked' })).toBeInTheDocument())
    expect(putSpy).toHaveBeenCalledTimes(1)
    expect(eventsOf('reaction')).toHaveLength(1)
  })
})

describe('PostActions — mock persistence across a re-mount (dev parity)', () => {
  it('a re-mounted card re-seeds from the remembered state when persistence is on', async () => {
    resetMockReactions({ persist: true })
    const user = userEvent.setup()
    const first = await renderActions(<PostActions post={buildPost({ id: 'post-persist' })} variant="full" />)
    await user.click(screen.getByRole('button', { name: 'Like, 42' }))
    expect(screen.getByRole('button', { name: 'Like, 43, liked' })).toBeInTheDocument()
    first.unmount()

    await renderActions(<PostActions post={buildPost({ id: 'post-persist' })} variant="full" />)

    expect(screen.getByRole('button', { name: 'Like, 43, liked' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('does NOT leak between tests when persistence is off (the Vitest default)', async () => {
    const user = userEvent.setup()
    const first = await renderActions(<PostActions post={buildPost({ id: 'post-nopersist' })} variant="full" />)
    await user.click(screen.getByRole('button', { name: 'Like, 42' }))
    first.unmount()

    await renderActions(<PostActions post={buildPost({ id: 'post-nopersist' })} variant="full" />)

    expect(screen.getByRole('button', { name: 'Like, 42' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('PostActions — a card re-pointed at another post (keyed state)', () => {
  it('drops the previous post\'s like state instead of showing it on the new post', async () => {
    const user = userEvent.setup()
    const { rerender } = await renderActions(<PostActions post={buildPost({ id: 'post-a' })} variant="full" />)
    await user.click(screen.getByRole('button', { name: 'Like, 42' }))
    expect(screen.getByRole('button', { name: 'Like, 43, liked' })).toBeInTheDocument()

    rerender(
      <ExerciseContextProvider>
        <SessionProvider>
          <PostActions
            post={buildPost({ id: 'post-b', counts: { reply: 0, repost: 0, like: 9 } })}
            variant="full"
          />
        </SessionProvider>
      </ExerciseContextProvider>,
    )

    expect(await screen.findByRole('button', { name: 'Like, 9' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('PostActions — Reply is a button only when it is wired (WR-002, F3)', () => {
  it('a wired Reply is a button and fires onReply with the post id on click', async () => {
    const onReply = vi.fn()
    const user = userEvent.setup()
    await renderActions(<PostActions post={buildPost({ id: 'post-r' })} variant="full" onReply={onReply} />)

    const reply = screen.getByRole('button', { name: 'Reply, 3' })
    expect(reply.tagName).toBe('BUTTON')
    await user.click(reply)

    expect(onReply).toHaveBeenCalledTimes(1)
    expect(onReply).toHaveBeenCalledWith('post-r')
  })

  it('leaves NO focusable element in the row but the wired controls (Repost and Like)', async () => {
    await renderActions(
      <PostActions
        post={buildPost({ counts: { reply: 1, repost: 2, like: 3, share: 4 } })}
        variant="full"
      />,
    )

    const region = screen.getByTestId('post-actions')
    // Reply is unwired and Share/Quote are hidden: only the two toggles are controls.
    expect(within(region).getAllByRole('button').map(b => b.getAttribute('data-action'))).toEqual([
      'repost',
      'like',
    ])
    expect(region.querySelectorAll('[tabindex]')).toHaveLength(0)
  })

  it('an unwired Reply is inert text: not a button, not focusable, count still readable', async () => {
    const user = userEvent.setup()
    await renderActions(<PostActions post={buildPost()} variant="full" />)

    expect(screen.queryByRole('button', { name: /^reply/i })).not.toBeInTheDocument()
    const reply = screen.getByTestId('post-actions').querySelector('[data-action="reply"]')
    expect(reply?.tagName).toBe('SPAN')
    expect(reply).not.toHaveAttribute('tabindex')
    expect(reply).toHaveTextContent('3')
    expect(within(reply as HTMLElement).getByText('Reply')).toBeInTheDocument()

    // Tab order skips it entirely: the first stop is Repost.
    await user.tab()
    expect(reply).not.toHaveFocus()
    expect(screen.getByRole('button', { name: /^repost/i })).toHaveFocus()
    expect(document.activeElement).toHaveAttribute('data-action', 'repost')
  })
})

describe('PostActions — readOnly variant (COR-015, D1-011)', () => {
  it('renders NO controls: counts are inert text with visually-hidden labels', async () => {
    await renderActions(<PostActions post={buildPost()} variant="readOnly" onReply={vi.fn()} />)

    const region = screen.getByTestId('post-actions')
    expect(within(region).queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByTestId('post-quote-trigger')).not.toBeInTheDocument()
    expect(region.querySelectorAll('[tabindex]')).toHaveLength(0)
    expect(region).toHaveTextContent('3')
    expect(region).toHaveTextContent('7')
    expect(region).toHaveTextContent('42')
    expect(within(region).getByText('Reply')).toBeInTheDocument()
    // No controls => no live region to announce a failure from.
    expect(screen.queryByTestId('post-actions-notice')).not.toBeInTheDocument()
  })

  it('shows compact counts as inert text with the spoken form for assistive technology', async () => {
    await renderActions(
      <PostActions
        post={buildPost({ counts: { reply: 0, repost: 9, like: 12300 } })}
        variant="readOnly"
      />,
    )

    const region = screen.getByTestId('post-actions')
    const compact = within(region).getByText('12.3K')
    expect(compact).toHaveAttribute('aria-hidden', 'true')
    expect(within(region).getByText('12.3 thousand (12,300)')).toBeInTheDocument()
    expect(within(region).getByText('Like')).toBeInTheDocument()
    // A count below 1 000 is already speakable: no duplicate, no aria-hidden.
    expect(within(region).getByText('9')).not.toHaveAttribute('aria-hidden')
  })

  it('fires no request when a count is clicked', async () => {
    const putSpy = vi.spyOn(api, 'put')
    const user = userEvent.setup()
    await renderActions(<PostActions post={buildPost()} variant="readOnly" />)

    await user.click(within(screen.getByTestId('post-actions')).getByText('42'))

    expect(putSpy).not.toHaveBeenCalled()
  })
})
