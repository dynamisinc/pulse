/**
 * features/social/hooks/useFollow.readonly.test.ts
 * ---------------------------------------------------------------------------
 * Covers story-02's observer-mode acceptance criterion (COR-015 / D1-011): in
 * a read-only session the follow CONTROL is ABSENT (not disabled). This hook
 * surfaces that as `isReadOnly: true` + `canFollow: false` so `<FollowButton>`
 * renders nothing, and `toggleFollow()` hard no-ops (no state change, no
 * write) even if a caller wires it by mistake.
 *
 * Mirrors `useReaction.readonly.test.ts` exactly — forces a read-only session
 * via `vi.mock('@/core/auth')`, which is hoisted to the whole module, so this
 * lives in its own file (the sibling `useFollow.test.ts` uses the REAL
 * `SessionProvider`).
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { useFollow } from './useFollow'
import { followPersona, unfollowPersona } from '../services/followService'

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

function wrapper({ children }: { children: ReactNode }) {
  return createElement('div', null, children)
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useFollow — observer mode (COR-015, D1-011)', () => {
  it('reports read-only with no follow capability, and toggleFollow is inert', async () => {
    const { result } = renderHook(
      () => useFollow({ personaId: 'persona-fairhavenwater', initialFollowerCount: 120 }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.followerCount).toBe(120))

    expect(result.current.isReadOnly).toBe(true)
    expect(result.current.canFollow).toBe(false)
    // The count still renders (inert) — it is not hidden, only the control is.
    expect(result.current.followerCount).toBe(120)

    act(() => result.current.toggleFollow())

    expect(result.current.followerCount).toBe(120)
    expect(result.current.isFollowing).toBe(false)
    expect(followPersona).not.toHaveBeenCalled()
    expect(unfollowPersona).not.toHaveBeenCalled()
  })
})
