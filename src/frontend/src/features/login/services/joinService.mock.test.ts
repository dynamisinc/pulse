/**
 * features/login/services/joinService.mock.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login story 08 — MOCK-mode coverage of `signInWithLink`
 * (`USE_MOCK_DATA` pinned to `true`). This file uses the REAL shared axios client,
 * so the request travels the genuine pipeline (JSON-serialised body, interceptors)
 * and only the adapter is swapped, exactly the property the mock seam promises.
 * Nothing reaches a network: the per-request mock adapter short-circuits it.
 *
 * Pins the token-prefix contract documented in `joinService.ts`:
 *   demo-…     -> signs in as the mock participant (Dana Reyes, consistent with
 *                 `core/auth/sessionResolver.ts`'s mock session)
 *   slow-…     -> waits about 1.5 s, then signs in
 *   expired-…  -> 401
 *   (other)    -> 401 too: an unknown link is never a login
 * and that the mock never echoes the join token back (not in the envelope, not
 * in any error).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParticipantSignInError, isLoginEnvelope } from './participantSignInService'
import { MOCK_SLOW_JOIN_MS, classifyJoinFailure, signInWithLink } from './joinService'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: true }))

afterEach(() => {
  vi.useRealTimers()
})

async function failureOf(token: string): Promise<ParticipantSignInError> {
  try {
    await signInWithLink(token)
  } catch (error) {
    if (error instanceof ParticipantSignInError) return error
    throw error
  }
  throw new Error('expected signInWithLink to reject')
}

describe('signInWithLink — mock mode: demo- tokens', () => {
  it('signs in as the mock participant with a valid LoginEnvelope', async () => {
    const envelope = await signInWithLink('demo-dana')

    expect(isLoginEnvelope(envelope)).toBe(true)
    expect(envelope.token.length).toBeGreaterThan(0)
    expect(envelope.refreshToken?.length).toBeGreaterThan(0)
  })

  it('is the same participant the mock session resolver resolves (Dana Reyes)', async () => {
    const envelope = await signInWithLink('demo-anything-at-all')

    expect(envelope.session).toMatchObject({
      exerciseId: 'ex-mock-0001',
      accountId: 'acct-dreyes',
      role: 'participant',
      personaId: 'persona-dreyes_fh',
      actingHumanId: 'human-dreyes',
      isReadOnly: false,
    })
  })

  it('stamps a future expiresAt', async () => {
    const envelope = await signInWithLink('demo-x')
    const expiresAt = (envelope.session as { expiresAt: string }).expiresAt

    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now())
  })

  it('never echoes the join token back', async () => {
    const token = 'demo-SECRET-LINK-VALUE'

    const envelope = await signInWithLink(token)

    expect(JSON.stringify(envelope)).not.toContain(token)
  })
})

describe('signInWithLink — mock mode: expired- and unknown tokens', () => {
  it('answers an expired- token with a 401, classified as link-invalid', async () => {
    const error = await failureOf('expired-abc')

    expect(error.status).toBe(401)
    expect(classifyJoinFailure(error)).toBe('link-invalid')
  })

  it('answers an unknown token with a 401 as well', async () => {
    const error = await failureOf('not-a-known-prefix')

    expect(error.status).toBe(401)
    expect(classifyJoinFailure(error)).toBe('link-invalid')
  })

  it('keeps the token out of the 401 error in every form', async () => {
    const token = 'expired-SECRET-LINK-VALUE'

    const error = await failureOf(token)

    expect(error.cause).toBeUndefined()
    expect(`${error.message}${error.stack ?? ''}${JSON.stringify(error)}`).not.toContain(token)
  })
})

describe('signInWithLink — mock mode: slow- tokens', () => {
  it('waits about 1.5 s, then signs in', async () => {
    vi.useFakeTimers()
    let settled = false
    const exchange = signInWithLink('slow-demo').then(envelope => {
      settled = true
      return envelope
    })

    await vi.advanceTimersByTimeAsync(MOCK_SLOW_JOIN_MS - 1)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    const envelope = await exchange
    expect(settled).toBe(true)
    expect(isLoginEnvelope(envelope)).toBe(true)
  })

  it('is about 1.5 seconds (the documented contract)', () => {
    expect(MOCK_SLOW_JOIN_MS).toBe(1500)
  })
})
