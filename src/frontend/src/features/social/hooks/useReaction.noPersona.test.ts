/**
 * features/social/hooks/useReaction.noPersona.test.ts
 * ---------------------------------------------------------------------------
 * Covers the "no persona bound" guard called out in `useReaction`'s own header
 * doc: a session with no `personaId` has no identity to react as, so
 * `canReact` is false and `toggleLike()` is a no-op — distinct from the
 * observer/read-only case (`useReaction.readonly.test.ts`), which is
 * `isReadOnly: true` with a persona still bound. Lives in its own file for the
 * same reason as the readonly spec: `vi.mock('@/core/auth')` is hoisted to the
 * whole module, so it cannot share a file with the real-`SessionProvider`
 * spec.
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { useReaction } from './useReaction'

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

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ExerciseContextProvider, null, children)
}

beforeEach(() => {
  resetTelemetryBuffer()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useReaction — no persona bound', () => {
  it('is not read-only but cannot react, and toggleLike is inert', async () => {
    const { result } = renderHook(
      () => useReaction({ postId: 'post-seed-fw-advisory', initialLikeCount: 76 }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.likeCount).toBe(76))

    expect(result.current.isReadOnly).toBe(false)
    expect(result.current.canReact).toBe(false)

    act(() => result.current.toggleLike())

    expect(result.current.likeCount).toBe(76)
    expect(result.current.likedByViewer).toBe(false)
    expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'reaction')).toHaveLength(0)
  })
})
