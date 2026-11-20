/**
 * features/controller/engine/services/liveReviewStore.scopeReset.test.ts
 * ---------------------------------------------------------------------------
 * #856: the live review-queue store across a staff EXERCISE SWITCH (the session stays signed in).
 * It holds exercise A's queue outside React Query, so `runExerciseScopeResets()` (run by
 * `useSetActiveExercise` once B's scope is committed) must forget it - above all when B's GET
 * FAILS, which would otherwise leave A's drafts on screen under B. A GET still in flight for A is
 * discarded when it lands, and a console still mounted re-reads B's queue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runExerciseScopeResets } from '@/core/auth/sessionReset'
import { clearTokens, setTokens } from '@/core/auth/tokenStore'
import { createFakeTransport } from '@/test/fakeHubConnection'
import type { FakeTransport } from '@/test/fakeHubConnection'
import { liveReviewStore } from './liveReviewStore'

const getMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
    post: () => Promise.resolve({ data: {} }),
  },
}))

function wireItem(draftId: string) {
  return {
    exerciseId: 'ex-a',
    storylineId: 'storyline-live',
    draftId,
    routedAtLevel: 'suggest',
    disposition: 'queued',
    countdown: null,
    posts: [{ personaHandle: 'FulcoEM', text: 'draft text', sentiment: 0, hashtags: ['#Tag'] }],
    storylineTag: '#Tag',
    storylineBrief: 'brief',
    actionLabel: 'reply',
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
}

let transport: FakeTransport

beforeEach(() => {
  getMock.mockReset()
  getMock.mockResolvedValue({ data: [wireItem('draft-of-exercise-a')] })
  liveReviewStore.resetForTests()
  setTokens({ token: 'staff-token' })
  transport = createFakeTransport()
})

afterEach(() => {
  liveReviewStore.resetForTests()
  clearTokens()
})

describe('liveReviewStore - the exercise switches', () => {
  it('drops exercise A\'s snapshot even when B\'s refetch fails', async () => {
    liveReviewStore.ensureStarted(transport.connection)
    await flush()
    expect(liveReviewStore.getItems()).toHaveLength(1)
    liveReviewStore.subscribe(() => {}) // a mounted <ReviewQueue>

    getMock.mockRejectedValue(new Error('B unreachable'))
    runExerciseScopeResets()
    await flush()

    expect(liveReviewStore.getItems()).toEqual([])
  })

  it('discards an A-era GET that lands after the switch', async () => {
    let resolveSlow: (value: { data: unknown }) => void = () => {}
    getMock.mockReturnValue(new Promise(resolve => {
      resolveSlow = resolve
    }))
    liveReviewStore.ensureStarted(transport.connection)
    await flush()

    runExerciseScopeResets()
    resolveSlow({ data: [wireItem('late-from-a')] })
    await flush()

    expect(liveReviewStore.getItems()).toEqual([])
  })
})
