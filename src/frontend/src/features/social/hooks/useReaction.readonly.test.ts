/**
 * features/social/hooks/useReaction.readonly.test.ts
 * ---------------------------------------------------------------------------
 * Covers story-01's observer-mode acceptance criterion (COR-015 / D1-011): in
 * a read-only session the like CONTROL is ABSENT (not disabled). This hook
 * surfaces that as `isReadOnly: true` + `canReact: false` so the action row can
 * render the count inert with no control, and `toggleLike()` hard no-ops (no
 * state change, no telemetry) even if a caller wires it by mistake.
 *
 * The shared Wave-1 mock session is a normal writable participant, so this one
 * scenario forces a read-only session by mocking `useSession()`. It lives in
 * its own file precisely because `vi.mock` is hoisted to the whole module —
 * the sibling `useReaction.test.ts` uses the REAL `SessionProvider` (mirrors
 * the `Composer.test.tsx` / `Composer.readonly.test.tsx` split).
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { useReaction } from './useReaction'

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

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ExerciseContextProvider, null, children)
}

beforeEach(() => {
  resetTelemetryBuffer()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useReaction — observer mode (COR-015, D1-011)', () => {
  it('reports read-only with no react capability, and toggleLike is inert', async () => {
    const { result } = renderHook(
      () => useReaction({ postId: 'post-seed-fw-advisory', initialLikeCount: 76 }),
      { wrapper },
    )

    // Wait for the exercise context to resolve and the hook to mount.
    await waitFor(() => expect(result.current.likeCount).toBe(76))

    expect(result.current.isReadOnly).toBe(true)
    expect(result.current.canReact).toBe(false)
    // The count still renders (inert) — it is not hidden, only the control is.
    expect(result.current.likeCount).toBe(76)

    // A stray toggle must not mutate state OR emit telemetry.
    act(() => result.current.toggleLike())

    expect(result.current.likeCount).toBe(76)
    expect(result.current.likedByViewer).toBe(false)
    expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'reaction')).toHaveLength(0)
  })
})
