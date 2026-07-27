/**
 * features/social/components/FollowButton.noPersona.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the "no persona bound" guard (a session with no `personaId` has no
 * identity to follow AS): `<FollowButton>` renders NOTHING, distinct from the
 * observer/read-only case (`FollowButton.readonly.test.tsx`). Lives in its
 * own file for the same `vi.mock('@/core/auth')`-hoisting reason as the
 * sibling specs.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { FollowButton } from './FollowButton'

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
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('FollowButton — no persona bound', () => {
  it('renders no follow control at all', () => {
    render(
      <FollowButton
        personaId="persona-fairhavenwater"
        displayName="Fairhaven Water"
        initialFollowerCount={120}
      />,
    )

    expect(screen.queryByTestId('follow-button')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
