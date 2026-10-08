/**
 * features/social/components/ThreadView.lateReply.test.tsx
 * ---------------------------------------------------------------------------
 * A reply's 201 can land AFTER the reader has moved to another thread (demo-polish
 * F4 Gate-1 M-1). The publish is bound to the thread it was made in, so the late
 * `onPosted` must append nothing under the new focus:
 *
 *  - moving the view from post A to post B gives B a FRESH reply composer (keyed by
 *    the thread) whose `onPosted` is bound to B;
 *  - A's composer's `onPosted`, called late (after the move), leaves B's replies and
 *    reply count exactly as loaded;
 *  - B's own composer still appends to B (control).
 *
 * `ReplyComposer` is replaced by a probe that records the props each instance was
 * given, so "the 201 arrives late" can be driven without a network; everything else is
 * real. Own file: `vi.mock` is module-wide.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { personaIdForHandle } from '@/features/personas'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import type { ParticipantPostView } from '@/features/social'
import { postStore } from '../services/postStore'
import { ThreadView } from './ThreadView'

interface ProbeProps {
  readonly parentPostId: string
  readonly onPosted?: (view: ParticipantPostView) => void
}

const probes = vi.hoisted(() => ({ byParent: new Map<string, unknown[]>() }))

vi.mock('./ReplyComposer', () => ({
  ReplyComposer: (props: ProbeProps) => {
    const seen = probes.byParent.get(props.parentPostId) ?? []
    seen.push(props)
    probes.byParent.set(props.parentPostId, seen)
    return <div data-testid="probe-composer" data-parent={props.parentPostId} />
  },
}))

const A = 'post-seed-mvega-question'
const B = 'post-seed-fulco-coordination'

function latestOnPosted(parent: string): (view: ParticipantPostView) => void {
  const seen = probes.byParent.get(parent) as ProbeProps[] | undefined
  const props = seen?.[seen.length - 1]
  if (props?.onPosted === undefined) throw new Error(`no composer was rendered for ${parent}`)
  return props.onPosted
}

function replyTo(parent: string, handle: string, id: string): ParticipantPostView {
  return {
    id,
    authorPersonaId: personaIdForHandle('dreyes_fh'),
    text: `late reply ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    scenarioTime: '2033-09-04T15:00:00Z',
    inReplyTo: { postId: parent, authorHandle: handle },
  }
}

function tree(focusedPostId: string) {
  return (
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
        >
          <ThreadView focusedPostId={focusedPostId} />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>
  )
}

async function settled(focusedId: string) {
  await waitFor(() => expect(screen.queryByText('Loading thread…')).not.toBeInTheDocument())
  await waitFor(() => {
    const focused = within(screen.getByTestId('thread-focused')).getByTestId('post-card')
    expect(focused.getAttribute('data-post-id')).toBe(focusedId)
  })
  await screen.findByTestId('probe-composer')
}

function replyCount(): string | null {
  const focused = within(screen.getByTestId('thread-focused')).getByTestId('post-card')
  return within(focused).getByRole('button', { name: /^Reply, \d+$/ }).getAttribute('aria-label')
}

beforeEach(() => {
  probes.byParent.clear()
})

afterEach(() => {
  postStore.resetForTests()
})

describe('ThreadView — a late 201 never lands in the wrong thread (M-1)', () => {
  it('a reply posted in A whose 201 arrives after the reader moved to B leaves B unchanged', async () => {
    const { rerender } = render(tree(A))
    await settled(A)
    const lateOnPostedForA = latestOnPosted(A)

    rerender(tree(B))
    await settled(B)
    const repliesBefore = screen.queryAllByTestId('thread-reply').length
    const countBefore = replyCount()

    // The 201 for the reply that was posted in A finally lands.
    act(() => lateOnPostedForA(replyTo(A, 'mvega_fh', 'post-late-a')))

    expect(screen.queryByText('late reply post-late-a')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('thread-reply')).toHaveLength(repliesBefore)
    expect(replyCount()).toBe(countBefore)
    expect(screen.getByTestId('thread-live-region')).toHaveTextContent('')
  })

  it('the composer for B is bound to B and still appends there (control)', async () => {
    const { rerender } = render(tree(A))
    await settled(A)
    rerender(tree(B))
    await settled(B)
    const repliesBefore = screen.queryAllByTestId('thread-reply').length

    act(() => latestOnPosted(B)(replyTo(B, 'FulcoEM', 'post-now-b')))

    expect(await screen.findByText('late reply post-now-b')).toBeInTheDocument()
    expect(screen.queryAllByTestId('thread-reply')).toHaveLength(repliesBefore + 1)
  })

  it('gives each thread its own composer instance (keyed by the thread)', async () => {
    const { rerender } = render(tree(A))
    await settled(A)
    const first = screen.getByTestId('probe-composer')
    expect(first).toHaveAttribute('data-parent', A)

    rerender(tree(B))
    await settled(B)

    const second = screen.getByTestId('probe-composer')
    expect(second).toHaveAttribute('data-parent', B)
    expect(second).not.toBe(first)
  })
})
