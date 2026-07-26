/**
 * features/social/components/WhoToFollow.noPersona.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the "no persona bound" guard (a session with no `personaId` has no
 * identity to follow AS): the "Who to follow" module still renders its
 * identity rows, but every row's Follow action is genuinely ABSENT, distinct
 * from the observer/read-only case (`WhoToFollow.readonly.test.tsx`). Lives
 * in its own file for the same `vi.mock('@/core/auth')`-hoisting reason as
 * the sibling specs.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
// Imported from the STORE, not from the (mocked) `followService` barrel above:
// the suggestion mock adapter now reads this shared graph directly to exclude
// already-followed accounts BEFORE applying `?limit=` (WR-001), so the seeded
// default edges would otherwise trim rows this spec is counting.
import { resetMockFollowEdges } from '../services/followEdgeStore'
import { WhoToFollow } from './WhoToFollow'

const NO_PERSONA_SESSION: Session = {
  exerciseId: 'ex-mock-0001',
  accountId: 'acct-shared',
  role: 'participant',
  personaId: undefined,
  actingHumanId: 'human-shared',
  isReadOnly: false,
  expiresAt: '2999-01-01T00:00:00.000Z',
}

vi.mock('@/core/auth', () => ({
  useSession: () => NO_PERSONA_SESSION,
}))

vi.mock('../services/followService', () => ({
  followPersona: vi.fn(),
  unfollowPersona: vi.fn(),
  resolveFollowing: vi.fn().mockResolvedValue([]),
}))

beforeEach(() => {
  // A genuinely empty mock follow graph, so the row count below is about the
  // self-exclusion rule and nothing else.
  resetMockFollowEdges()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('WhoToFollow — session with no bound persona', () => {
  it('renders identity rows with NO follow control anywhere', async () => {
    render(<WhoToFollow />)

    const rows = await screen.findAllByTestId('who-to-follow-row')
    expect(rows.length).toBeGreaterThan(0)
    expect(screen.queryByTestId('follow-button')).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('never excludes a suggestion "as self" when there is no bound persona to be', async () => {
    render(<WhoToFollow />)

    const rows = await screen.findAllByTestId('who-to-follow-row')
    // The default mock suggestion set (6 entries) is untouched by the
    // self-exclusion rule when there is no viewer persona id to compare against.
    expect(rows).toHaveLength(6)
  })
})
