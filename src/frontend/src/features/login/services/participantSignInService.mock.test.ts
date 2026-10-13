/**
 * features/login/services/participantSignInService.mock.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login story 09 ("Sign-in page: Today's word") — coverage for the
 * MOCK adapter behind `signInWithDayWord` (the frontend runs mock-first behind
 * the frozen `POST /auth/word` contract until backend story 05 is deployed).
 *
 * `@/core/config/mockData` is pinned to `true` so the service takes its mock
 * path. Unlike `participantSignInService.test.ts`, the REAL shared axios client
 * is used (no `@/core/services/api` mock): the adapter is handed to
 * `api.post(..., { adapter })`, so running through the real client proves the
 * request body is serialised the way the adapter reads it, and that a mock 401
 * travels the client's real error path (`/auth/word` is excluded from the
 * silent-refresh retry) and comes out as the same `ParticipantSignInError` a
 * live 401 would. No request ever leaves the process: the adapter answers.
 *
 * The mock's rules under test (also in the service header): the word
 * `demo-word` (after trimming) with a non-blank name -> a mock envelope;
 * anything else -> 401; the `slow` sentinel (as name or word) waits ~1.5 s.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MOCK_DAY_WORD,
  MOCK_SLOW_DELAY_MS,
  MOCK_SLOW_SENTINEL,
  ParticipantSignInError,
  isUnauthorizedSignInError,
  signInWithDayWord,
} from './participantSignInService'

vi.mock('@/core/config/mockData', () => ({
  USE_MOCK_DATA: true,
}))

afterEach(() => {
  vi.useRealTimers()
})

/** Settles to the thrown value (or `undefined`), so rejections are easy to assert on. */
async function caughtFrom(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  )
}

describe('signInWithDayWord - mock adapter: the accepted word', () => {
  it('exports the documented demo word, delay and sentinel', () => {
    expect(MOCK_DAY_WORD).toBe('demo-word')
    expect(MOCK_SLOW_DELAY_MS).toBe(1500)
    expect(MOCK_SLOW_SENTINEL).toBe('slow')
  })

  it('signs in as a mock participant with demo-word and any non-blank name', async () => {
    const envelope = await signInWithDayWord({ signInName: 'dreyes', word: 'demo-word' })

    expect(typeof envelope.token).toBe('string')
    expect(envelope.token.length).toBeGreaterThan(0)
    expect(typeof envelope.refreshToken).toBe('string')
  })

  it('compares the word after trimming', async () => {
    await expect(
      signInWithDayWord({ signInName: 'dreyes', word: '  demo-word  ' }),
    ).resolves.toMatchObject({ token: expect.any(String) })
  })

  it('accepts any non-blank name, including one that is not on any roster', async () => {
    await expect(
      signInWithDayWord({ signInName: 'someone.else', word: 'demo-word' }),
    ).resolves.toMatchObject({ token: expect.any(String) })
  })
})

describe('signInWithDayWord - mock adapter: everything else is a 401', () => {
  it.each([
    ['a wrong word', { signInName: 'dreyes', word: 'not-the-word' }],
    ['an empty word', { signInName: 'dreyes', word: '' }],
    ['a blank name', { signInName: '', word: 'demo-word' }],
    ['a whitespace-only name', { signInName: '   ', word: 'demo-word' }],
  ])('%s -> 401 as a ParticipantSignInError', async (_label, credentials) => {
    const caught = await caughtFrom(signInWithDayWord(credentials))

    expect(caught).toBeInstanceOf(ParticipantSignInError)
    expect((caught as ParticipantSignInError).status).toBe(401)
    expect(isUnauthorizedSignInError(caught)).toBe(true)
  })

  it('the 401 is the same whichever half is wrong (no reason leaks)', async () => {
    const wrongWord = await caughtFrom(signInWithDayWord({ signInName: 'dreyes', word: 'nope' }))
    const wrongName = await caughtFrom(signInWithDayWord({ signInName: '', word: 'demo-word' }))

    expect((wrongWord as ParticipantSignInError).message).toBe(
      (wrongName as ParticipantSignInError).message,
    )
    expect((wrongWord as ParticipantSignInError).serverMessage).toBeUndefined()
    expect((wrongName as ParticipantSignInError).serverMessage).toBeUndefined()
  })
})

describe('signInWithDayWord - mock adapter: the `slow` sentinel', () => {
  /** Resolves/rejects flag so a still-pending promise can be told apart. */
  function track(promise: Promise<unknown>) {
    const state = { settled: false }
    const done = promise.then(
      () => {
        state.settled = true
      },
      () => {
        state.settled = true
      },
    )
    return { state, done }
  }

  it('a `slow` NAME with demo-word signs in, but only after ~1.5 s', async () => {
    vi.useFakeTimers()
    const request = signInWithDayWord({ signInName: 'slow', word: 'demo-word' })
    const { state, done } = track(request)

    await vi.advanceTimersByTimeAsync(MOCK_SLOW_DELAY_MS - 100)
    expect(state.settled).toBe(false)

    await vi.advanceTimersByTimeAsync(100)
    await done
    expect(state.settled).toBe(true)
    await expect(request).resolves.toMatchObject({ token: expect.any(String) })
  })

  it('a `slow` WORD is a slow 401 (it is not demo-word)', async () => {
    vi.useFakeTimers()
    const request = signInWithDayWord({ signInName: 'dreyes', word: 'slow' })
    const { state, done } = track(request)

    await vi.advanceTimersByTimeAsync(MOCK_SLOW_DELAY_MS - 100)
    expect(state.settled).toBe(false)

    await vi.advanceTimersByTimeAsync(100)
    await done
    const caught = await caughtFrom(request)
    expect(isUnauthorizedSignInError(caught)).toBe(true)
  })

  it('the sentinel is matched after trimming and ignoring case', async () => {
    vi.useFakeTimers()
    const { state, done } = track(
      signInWithDayWord({ signInName: ' SLOW ', word: 'demo-word' }),
    )

    await vi.advanceTimersByTimeAsync(MOCK_SLOW_DELAY_MS - 100)
    expect(state.settled).toBe(false)
    await vi.advanceTimersByTimeAsync(100)
    await done
    expect(state.settled).toBe(true)
  })

  it('anything else answers without waiting on the timer', async () => {
    vi.useFakeTimers()

    // No timer is advanced: if the mock waited, this would hang until the test timed out.
    await expect(
      signInWithDayWord({ signInName: 'dreyes', word: 'demo-word' }),
    ).resolves.toMatchObject({ token: expect.any(String) })
  })
})
