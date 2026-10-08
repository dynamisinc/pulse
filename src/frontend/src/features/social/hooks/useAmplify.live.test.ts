/**
 * features/social/hooks/useAmplify.live.test.ts
 * ---------------------------------------------------------------------------
 * LIVE mode (`USE_MOCK_DATA` forced false; implementation.md §1.8; Wave 2 Gate-2 low):
 * the server emits the XC-004 amplification events, so `doQuote` must emit NO client
 * `quote` event -- it still sanitizes and returns its record. (The mock-mode counterpart,
 * "sanitizes the commentary and emits one quote event", is in `useAmplify.test.ts`;
 * `useReactionToggle.live.test.ts` pins the same rule for repost / like.) Own file: the
 * `mockData` mock is hoisted over the whole module.
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { useAmplify } from './useAmplify'

// With mock data off the exercise context and session would resolve over the (absent)
// network and fail closed, so both are supplied directly.
vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-live-0001',
    exerciseName: 'Live',
    timeZone: 'UTC',
    status: 'active',
  }),
}))
vi.mock('@/core/auth', () => ({
  useSession: () => ({
    exerciseId: 'ex-live-0001',
    accountId: 'acct-live',
    role: 'participant',
    personaId: 'persona-dreyes_fh',
    actingHumanId: 'human-live',
    isReadOnly: false,
    expiresAt: '2999-01-01T00:00:00.000Z',
  }),
}))

beforeEach(() => {
  resetTelemetryBuffer()
})

describe('useAmplify (live) — the server owns the quote event', () => {
  it('doQuote sanitizes and returns its record but emits no client quote event', () => {
    const { result } = renderHook(() => useAmplify({ postId: 'post-q-live' }))
    expect(result.current.canAmplify).toBe(true)

    let record: ReturnType<typeof result.current.doQuote>
    act(() => {
      record = result.current.doQuote('<b>live</b> take')
    })

    expect(record?.kind).toBe('quote')
    expect(record?.commentary).toBe('live take')
    expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'quote')).toHaveLength(0)
  })
})
