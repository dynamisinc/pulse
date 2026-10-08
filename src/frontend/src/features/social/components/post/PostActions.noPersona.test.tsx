/**
 * features/social/components/post/PostActions.noPersona.test.tsx
 * ---------------------------------------------------------------------------
 * A WRITABLE session with NO bound persona rendering a `variant="full"` card
 * (COR-015, D1-011; demo-polish F3). Such a session has no identity to react as,
 * so like and repost are ABSENT as controls — inert count text, never a dead
 * button — while Reply (a navigation affordance with its own optional handler)
 * stays a button. No request is ever issued.
 *
 * Own file: `vi.mock('@/core/auth')` is hoisted over the whole module, so it
 * cannot share a file with the real-`SessionProvider` specs in
 * `PostActions.test.tsx` (same reason as `useReaction.noPersona.test.ts`).
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { api } from '@/core/services/api'
import { personaById, personaIdForHandle } from '@/features/personas'
import { PostActions } from './PostActions'
import type { PostView } from './types'

const NO_PERSONA_SESSION: Session = {
  exerciseId: 'ex-mock-0001',
  accountId: 'acct-shared',
  role: 'participant',
  personaId: undefined,
  actingHumanId: 'human-shared',
  isReadOnly: false,
  expiresAt: '2999-01-01T00:00:00.000Z',
}

vi.mock('@/core/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth')>()),
  useSession: () => NO_PERSONA_SESSION,
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

function buildPost(overrides: Partial<PostView> = {}): PostView {
  const author = personaById(personaIdForHandle('FairhavenWater'))
  if (!author) throw new Error('fixture missing seeded persona')
  return {
    id: 'post-np-1',
    author,
    text: 'text',
    counts: { reply: 3, repost: 1450, like: 42 },
    scenarioTime: '2026-07-16T12:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PostActions — writable session with no bound persona (full variant)', () => {
  it('renders like and repost as inert counts, keeps Reply a button, and shows no notice region', () => {
    render(<PostActions post={buildPost()} variant="full" onReply={vi.fn()} />)

    const region = screen.getByTestId('post-actions')
    expect(within(region).getAllByRole('button').map(b => b.getAttribute('data-action'))).toEqual(['reply'])
    expect(region.querySelector('[data-action="like"]')?.tagName).toBe('SPAN')
    expect(region.querySelector('[data-action="repost"]')?.tagName).toBe('SPAN')
    // Counts still read: compact for sighted users, spoken + exact for AT.
    expect(region).toHaveTextContent('42')
    expect(region).toHaveTextContent('1.4K')
    expect(within(region).getByText('1.4 thousand (1,450)')).toBeInTheDocument()
    expect(screen.queryByTestId('post-quote-trigger')).not.toBeInTheDocument()
  })

  it('issues no request when an inert count is clicked', async () => {
    const putSpy = vi.spyOn(api, 'put')
    const deleteSpy = vi.spyOn(api, 'delete')
    const user = userEvent.setup()
    render(<PostActions post={buildPost()} variant="full" />)

    await user.click(within(screen.getByTestId('post-actions')).getByText('42'))

    expect(putSpy).not.toHaveBeenCalled()
    expect(deleteSpy).not.toHaveBeenCalled()
  })
})
