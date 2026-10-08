/**
 * features/social/services/replyIntent.test.ts
 * ---------------------------------------------------------------------------
 * "Open this thread with the reply composer focused" handoff (demo-polish F4,
 * story 13): the intent is one-shot, keyed by post id, replaced by a newer
 * request, and never consumed by a different thread — so a stale tap can never
 * steal focus later.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  REPLY_INTENT_TTL_MS,
  consumeReplyFocus,
  requestReplyFocus,
  resetReplyIntent,
} from './replyIntent'

afterEach(() => {
  vi.restoreAllMocks()
  resetReplyIntent()
})

describe('replyIntent', () => {
  it('is consumed exactly once for the requested post', () => {
    requestReplyFocus('post-1')

    expect(consumeReplyFocus('post-1')).toBe(true)
    expect(consumeReplyFocus('post-1')).toBe(false)
  })

  it('is not consumed by a different thread, and survives until the right one opens', () => {
    requestReplyFocus('post-1')

    expect(consumeReplyFocus('post-2')).toBe(false)
    expect(consumeReplyFocus('post-1')).toBe(true)
  })

  it('a newer request replaces an older one', () => {
    requestReplyFocus('post-1')
    requestReplyFocus('post-2')

    expect(consumeReplyFocus('post-1')).toBe(false)
    expect(consumeReplyFocus('post-2')).toBe(true)
  })

  it('is false when nothing was requested', () => {
    expect(consumeReplyFocus('post-1')).toBe(false)
  })

  it('EXPIRES: a request older than the TTL is not honoured (and is cleared) (L-7)', () => {
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(1000)
    requestReplyFocus('post-1')

    now.mockReturnValue(1000 + REPLY_INTENT_TTL_MS + 1)

    expect(consumeReplyFocus('post-1')).toBe(false)
    // Gone for good, not merely skipped once.
    now.mockReturnValue(1000)
    expect(consumeReplyFocus('post-1')).toBe(false)
  })

  it('is honoured right up to the TTL', () => {
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(1000)
    requestReplyFocus('post-1')

    now.mockReturnValue(1000 + REPLY_INTENT_TTL_MS)

    expect(consumeReplyFocus('post-1')).toBe(true)
  })

  it('resetReplyIntent forgets a pending request', () => {
    requestReplyFocus('post-1')

    resetReplyIntent()

    expect(consumeReplyFocus('post-1')).toBe(false)
  })
})
