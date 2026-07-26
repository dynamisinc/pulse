/**
 * features/social/components/WhoToFollow.readonly.test.tsx
 * ---------------------------------------------------------------------------
 * Covers story-04's observer-mode AC (D1-011): in a read-only session the
 * "Who to follow" module still renders its identity rows (name, handle, the
 * verified mark where applicable), but every row's Follow action is
 * genuinely ABSENT — not disabled — because `<WhoToFollow>` reuses
 * `<FollowButton>`/`useFollow` unmodified rather than re-implementing the
 * D1-011 gate. Mirrors `FollowButton.readonly.test.tsx`'s session mock; lives
 * in its own file for the same `vi.mock('@/core/auth')`-hoisting reason as
 * the sibling specs.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { WhoToFollow } from './WhoToFollow'

const READONLY_SESSION: Session = {
  exerciseId: 'ex-mock-0001',
  accountId: 'acct-observer',
  role: 'participant',
  personaId: 'persona-dreyes_fh',
  actingHumanId: 'human-observer',
  isReadOnly: true,
  expiresAt: '2999-01-01T00:00:00.000Z',
}

vi.mock('@/core/auth', () => ({
  useSession: () => READONLY_SESSION,
}))

vi.mock('../services/followService', () => ({
  followPersona: vi.fn(),
  unfollowPersona: vi.fn(),
  resolveFollowing: vi.fn().mockResolvedValue([]),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('WhoToFollow — observer/read-only session (D1-011)', () => {
  it('renders the module and its identity rows, with NO follow control anywhere', async () => {
    render(<WhoToFollow />)

    const rows = await screen.findAllByTestId('who-to-follow-row')
    expect(rows.length).toBeGreaterThan(0)

    // The title and identity content are still present — only the ACTION is absent.
    expect(screen.getByRole('heading', { name: 'Who to follow' })).toBeInTheDocument()
    expect(screen.queryByTestId('follow-button')).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
