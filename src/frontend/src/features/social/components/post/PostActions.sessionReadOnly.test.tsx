/**
 * features/social/components/post/PostActions.sessionReadOnly.test.tsx
 * ---------------------------------------------------------------------------
 * A READ-ONLY SESSION (`session.isReadOnly`) rendering a `variant="full"` card
 * (COR-015, D1-011; demo-polish F3, Gate-1 finding 6). The card variant and the
 * session can disagree — Profile / Hashtag cards take their variant from the
 * shell, not from the session — and when they do ALL THREE actions must go inert
 * together: no Reply button either (even with `onReply` wired), no like / repost
 * control, no live region, and no request.
 *
 * Own file: `vi.mock('@/core/auth')` is hoisted over the whole module, so it
 * cannot share a file with the real-`SessionProvider` specs in
 * `PostActions.test.tsx` (same reason as `PostActions.noPersona.test.tsx`).
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { api } from '@/core/services/api'
import { personaById, personaIdForHandle } from '@/features/personas'
import { PostActions } from './PostActions'
import type { PostView } from './types'

// A persona IS bound — only the session's read-only flag differs from a normal one.
const READ_ONLY_SESSION: Session = {
  exerciseId: 'ex-mock-0001',
  accountId: 'acct-observer',
  role: 'participant',
  personaId: 'persona-dreyes_fh',
  actingHumanId: 'human-observer',
  isReadOnly: true,
  expiresAt: '2999-01-01T00:00:00.000Z',
}

vi.mock('@/core/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth')>()),
  useSession: () => READ_ONLY_SESSION,
}))
vi.mock('@/core/exerciseContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/exerciseContext')>()),
  useExerciseContext: () => ({
    exerciseId: 'ex-mock-0001',
    exerciseName: 'Mock',
    timeZone: 'America/Chicago',
    status: 'active',
  }),
}))

function buildPost(): PostView {
  const author = personaById(personaIdForHandle('FairhavenWater'))
  if (!author) throw new Error('fixture missing seeded persona')
  return {
    id: 'post-ro-1',
    author,
    text: 'text',
    counts: { reply: 3, repost: 7, like: 42 },
    scenarioTime: '2026-07-16T12:00:00.000Z',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PostActions — read-only session on a variant="full" card', () => {
  it('renders ALL THREE actions inert: no buttons, no tab stops, no live region', () => {
    const onReply = vi.fn()
    render(<PostActions post={buildPost()} variant="full" onReply={onReply} />)

    const region = screen.getByTestId('post-actions')
    expect(within(region).queryAllByRole('button')).toHaveLength(0)
    expect(
      Array.from(region.querySelectorAll('[data-action]')).map(e => e.tagName),
    ).toEqual(['SPAN', 'SPAN', 'SPAN'])
    expect(region.querySelectorAll('[tabindex]')).toHaveLength(0)
    // The counts still read.
    expect(region).toHaveTextContent('3')
    expect(region).toHaveTextContent('7')
    expect(region).toHaveTextContent('42')
    expect(screen.queryByTestId('post-actions-notice')).not.toBeInTheDocument()
  })

  it('fires neither onReply nor a reaction request when a count is clicked', async () => {
    const onReply = vi.fn()
    const putSpy = vi.spyOn(api, 'put')
    const deleteSpy = vi.spyOn(api, 'delete')
    const user = userEvent.setup()
    render(<PostActions post={buildPost()} variant="full" onReply={onReply} />)

    const region = screen.getByTestId('post-actions')
    await user.click(within(region).getByText('3'))
    await user.click(within(region).getByText('42'))

    expect(onReply).not.toHaveBeenCalled()
    expect(putSpy).not.toHaveBeenCalled()
    expect(deleteSpy).not.toHaveBeenCalled()
  })
})
