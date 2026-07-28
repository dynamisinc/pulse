/**
 * features/social/hooks/useFollow.noPersona.test.ts
 * ---------------------------------------------------------------------------
 * Covers the "no persona bound" guard called out in `useFollow`'s own header
 * doc: a session with no `personaId` has no identity to follow AS, so
 * `canFollow` is false and `toggleFollow()` is a no-op — distinct from the
 * observer/read-only case (`useFollow.readonly.test.ts`), which is
 * `isReadOnly: true` with a persona still bound. Lives in its own file for the
 * same reason as the readonly spec: `vi.mock('@/core/auth')` is hoisted to
 * the whole module, so it cannot share a file with the real-`SessionProvider`
 * spec.
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { useFollow } from './useFollow'
import { followPersona, unfollowPersona } from '../services/followService'

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

function wrapper({ children }: { children: ReactNode }) {
  return createElement('div', null, children)
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useFollow — no persona bound', () => {
  it('is not read-only but cannot follow, and toggleFollow is inert', async () => {
    const { result } = renderHook(
      () => useFollow({ personaId: 'persona-fairhavenwater', initialFollowerCount: 120 }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.followerCount).toBe(120))

    expect(result.current.isReadOnly).toBe(false)
    expect(result.current.canFollow).toBe(false)

    act(() => result.current.toggleFollow())

    expect(result.current.followerCount).toBe(120)
    expect(result.current.isFollowing).toBe(false)
    expect(followPersona).not.toHaveBeenCalled()
    expect(unfollowPersona).not.toHaveBeenCalled()
  })
})
