/**
 * features/social/components/post/PostActions.test.tsx
 * ---------------------------------------------------------------------------
 * The action row after the wiring relocation (demo-polish F0, DP-14): `PostActions`
 * SELF-WIRES the existing local-optimistic `useReaction()` / `useAmplify()`, so a
 * bare `<PostCard>` — with no per-page wiring — has live like/repost/quote.
 *
 * Pins: canonical reply · repost · like order and accessible names (NFR-001);
 * optimistic like with exactly one XC-004 `reaction` event per toggle; the viewer's
 * initial liked state from `post.viewer`; repost emits one `repost` event and does
 * not touch the count; the SEPARATE Quote trigger opens an inline panel that emits
 * one `quote` event and closes; `onReply`; the read-only variant (controls
 * ABSENT, counts inert — COR-015/D1-011); and NO FOCUSABLE NO-OPS: an action with
 * nothing wired to it (Reply without `onReply`, Share always) is the same inert
 * span markup — not a button, not a tab stop — with `data-action` kept.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { personaById, personaIdForHandle } from '@/features/personas'
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

beforeEach(() => {
  resetTelemetryBuffer()
})

afterEach(() => {
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

  it('appends share, in order, only when present in counts', async () => {
    await renderActions(
      <PostActions
        post={buildPost({ counts: { reply: 1, repost: 2, like: 3, share: 4 } })}
        variant="full"
      />,
    )

    // `[data-action]`: Share has no handler, so it is an inert span, not a button.
    const keys = Array.from(
      screen.getByTestId('post-actions').querySelectorAll('[data-action]'),
    ).map(b => b.getAttribute('data-action'))
    expect(keys).toEqual(['reply', 'repost', 'like', 'share'])
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
    let events = getEmittedTelemetryEvents().filter(e => e.eventType === 'reaction')
    expect(events).toHaveLength(1)
    expect(events[0]?.target).toEqual({ entityType: 'post', entityId: 'post-like' })
    expect(events[0]?.payload).toEqual({ reaction: 'like', liked: true })

    await user.click(liked)

    expect(screen.getByRole('button', { name: 'Like, 42' })).toHaveAttribute('aria-pressed', 'false')
    events = getEmittedTelemetryEvents().filter(e => e.eventType === 'reaction')
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
  })

  it('leaves aria-pressed false when the viewer state is unknown (absent)', async () => {
    await renderActions(<PostActions post={buildPost({ viewer: undefined })} variant="full" />)

    expect(screen.getByRole('button', { name: 'Like, 42' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('PostActions — self-wired repost and quote (SOC-020, NFR-004)', () => {
  it('reposting emits one repost event and leaves the count alone', async () => {
    const user = userEvent.setup()
    await renderActions(<PostActions post={buildPost({ id: 'post-rp' })} variant="full" />)

    await user.click(screen.getByRole('button', { name: /^repost/i }))

    const events = getEmittedTelemetryEvents().filter(e => e.eventType === 'repost')
    expect(events).toHaveLength(1)
    expect(events[0]?.target).toEqual({ entityType: 'post', entityId: 'post-rp' })
    expect(screen.getByRole('button', { name: 'Repost, 7' })).toBeInTheDocument()
  })

  it('shows the Quote trigger as a SEPARATE control with no data-action', async () => {
    await renderActions(<PostActions post={buildPost()} variant="full" />)

    const trigger = screen.getByTestId('post-quote-trigger')
    expect(trigger).not.toHaveAttribute('data-action')
    // Repost + Like only: Reply (no `onReply`) is inert, and Quote has no `data-action`.
    expect(screen.getByTestId('post-actions').querySelectorAll('button[data-action]')).toHaveLength(2)
  })

  it('opens an inline quote panel, submits one quote event, then closes it', async () => {
    const user = userEvent.setup()
    await renderActions(<PostActions post={buildPost({ id: 'post-q' })} variant="full" />)

    await user.click(screen.getByTestId('post-quote-trigger'))
    const composer = await screen.findByTestId('quote-composer')
    // The panel is a SIBLING of the action row, not inside it.
    expect(composer.closest('[data-testid="post-actions"]')).toBeNull()
    await user.type(within(composer).getByLabelText('Quote commentary'), 'Unconfirmed.')
    await user.click(within(composer).getByRole('button', { name: 'Quote' }))

    await waitFor(() => expect(screen.queryByTestId('quote-composer')).not.toBeInTheDocument())
    const events = getEmittedTelemetryEvents().filter(e => e.eventType === 'quote')
    expect(events).toHaveLength(1)
    expect(events[0]?.target).toEqual({ entityType: 'post', entityId: 'post-q' })
  })

  it('cancelling the quote panel emits nothing', async () => {
    const user = userEvent.setup()
    await renderActions(<PostActions post={buildPost()} variant="full" />)

    await user.click(screen.getByTestId('post-quote-trigger'))
    await user.click(within(await screen.findByTestId('quote-composer')).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByTestId('quote-composer')).not.toBeInTheDocument()
    expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'quote')).toHaveLength(0)
  })
})

describe('PostActions — onReply', () => {
  it('fires onReply with the post id on click', async () => {
    const onReply = vi.fn()
    const user = userEvent.setup()
    await renderActions(<PostActions post={buildPost({ id: 'post-r' })} variant="full" onReply={onReply} />)

    await user.click(screen.getByRole('button', { name: /^reply/i }))

    expect(onReply).toHaveBeenCalledWith('post-r')
  })
})

describe('PostActions — no focusable no-ops (unwired actions are inert, not dead buttons)', () => {
  it('renders an unwired Reply (no onReply) as an inert span: not a button, not focusable', async () => {
    const user = userEvent.setup()
    await renderActions(<PostActions post={buildPost()} variant="full" />)

    expect(screen.queryByRole('button', { name: /^reply/i })).not.toBeInTheDocument()
    const reply = screen.getByTestId('post-actions').querySelector('[data-action="reply"]')
    expect(reply?.tagName).toBe('SPAN')
    expect(reply).not.toHaveAttribute('tabindex')
    // The same inert markup the read-only branch uses: count + visually-hidden label.
    expect(reply).toHaveTextContent('3')
    expect(within(reply as HTMLElement).getByText('Reply')).toBeInTheDocument()

    // Tabbing from the document start lands on a real control, never on Reply.
    await user.tab()
    expect(reply).not.toHaveFocus()
    expect(screen.getByTestId('post-actions').contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toHaveAttribute('data-action', 'repost')
  })

  it('renders Share (never wired) as an inert span: not a button, not focusable', async () => {
    await renderActions(
      <PostActions
        post={buildPost({ counts: { reply: 1, repost: 2, like: 3, share: 4 } })}
        variant="full"
        onReply={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument()
    const share = screen.getByTestId('post-actions').querySelector('[data-action="share"]')
    expect(share?.tagName).toBe('SPAN')
    expect(share).not.toHaveAttribute('tabindex')
    expect(share).toHaveTextContent('4')
    expect(within(share as HTMLElement).getByText('Share')).toBeInTheDocument()
  })

  it('leaves NO focusable element in the row but the wired controls', async () => {
    await renderActions(
      <PostActions
        post={buildPost({ counts: { reply: 1, repost: 2, like: 3, share: 4 } })}
        variant="full"
      />,
    )

    const region = screen.getByTestId('post-actions')
    // Repost, Quote and Like only — Reply and Share are inert.
    expect(within(region).getAllByRole('button').map(b => b.getAttribute('data-action'))).toEqual([
      'repost',
      null,
      'like',
    ])
    expect(region.querySelectorAll('[tabindex]')).toHaveLength(0)
  })

  it('renders a WIRED Reply as a button that fires onReply', async () => {
    const onReply = vi.fn()
    const user = userEvent.setup()
    await renderActions(
      <PostActions post={buildPost({ id: 'post-wired' })} variant="full" onReply={onReply} />,
    )

    const reply = screen.getByRole('button', { name: 'Reply, 3' })
    expect(reply).toHaveAttribute('data-action', 'reply')
    await user.click(reply)

    expect(onReply).toHaveBeenCalledTimes(1)
    expect(onReply).toHaveBeenCalledWith('post-wired')
  })

  it('keeps wired Like and Repost as buttons and the Quote trigger alongside them', async () => {
    await renderActions(<PostActions post={buildPost()} variant="full" />)

    expect(screen.getByRole('button', { name: 'Like, 42' })).toHaveAttribute('data-action', 'like')
    expect(screen.getByRole('button', { name: 'Repost, 7' })).toHaveAttribute('data-action', 'repost')
    expect(screen.getByRole('button', { name: 'Quote' })).toBeInTheDocument()
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
  })
})
