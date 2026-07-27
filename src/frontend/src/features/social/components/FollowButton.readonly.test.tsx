/**
 * features/social/components/FollowButton.readonly.test.tsx
 * ---------------------------------------------------------------------------
 * Covers story-02's observer-mode AC (COR-015/D1-011): in a read-only session
 * `<FollowButton>` renders NOTHING — absent, not disabled. Mirrors
 * `useFollow.readonly.test.ts`'s session mock; lives in its own file for the
 * same `vi.mock('@/core/auth')`-hoisting reason as the hook specs.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { FollowButton } from './FollowButton'

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
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('FollowButton — observer/read-only session (COR-015, D1-011)', () => {
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
