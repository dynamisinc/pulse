/**
 * features/social/hooks/useAmplify.gating.test.ts
 * ---------------------------------------------------------------------------
 * `canAmplify` gating (COR-015, D1-011; demo-polish F3): an observer / read-only
 * session AND a session with no bound persona can never repost — `canAmplify` is
 * false and `toggleRepost()` is a hard no-op that issues no request and emits no
 * event. Mirrors `useReaction.readonly.test.ts` / `useReaction.noPersona.test.ts`.
 * Own file: the `@/core/auth` mock is hoisted over the whole module.
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { api } from '@/core/services/api'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { useAmplify } from './useAmplify'

const SESSIONS: Record<string, Session> = {
  readOnly: {
    exerciseId: 'ex-mock-0001',
    accountId: 'acct-observer',
    role: 'participant',
    personaId: 'persona-dreyes_fh',
    actingHumanId: 'human-observer',
    isReadOnly: true,
    expiresAt: '2999-01-01T00:00:00.000Z',
  },
  noPersona: {
    exerciseId: 'ex-mock-0001',
    accountId: 'acct-shared',
    role: 'participant',
    personaId: undefined,
    actingHumanId: 'human-shared',
    isReadOnly: false,
    expiresAt: '2999-01-01T00:00:00.000Z',
  },
}
let current: Session = SESSIONS.readOnly as Session

vi.mock('@/core/auth', () => ({
  useSession: () => current,
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

describe.each([
  ['a read-only (observer) session', 'readOnly'],
  ['a session with no bound persona', 'noPersona'],
] as const)('useAmplify — %s', (_label, key) => {
  it('cannot amplify and toggleRepost is inert', async () => {
    current = SESSIONS[key] as Session
    const putSpy = vi.spyOn(api, 'put')
    const deleteSpy = vi.spyOn(api, 'delete')
    const { result } = renderHook(
      () => useAmplify({ postId: 'post-x', initialRepostCount: 5 }),
      { wrapper },
    )

    // The exercise-context provider renders nothing until it resolves.
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current.canAmplify).toBe(false)

    act(() => result.current.toggleRepost())

    expect(result.current.repostCount).toBe(5)
    expect(result.current.repostedByViewer).toBe(false)
    expect(putSpy).not.toHaveBeenCalled()
    expect(deleteSpy).not.toHaveBeenCalled()
    expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'repost')).toHaveLength(0)
  })

  it('doQuote is inert too', async () => {
    current = SESSIONS[key] as Session
    const { result } = renderHook(() => useAmplify({ postId: 'post-x' }), { wrapper })
    await waitFor(() => expect(result.current).not.toBeNull())

    expect(result.current.doQuote('hello')).toBeUndefined()
  })
})
