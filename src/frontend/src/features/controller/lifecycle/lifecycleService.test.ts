/**
 * features/controller/lifecycle/lifecycleService.test.ts
 * ---------------------------------------------------------------------------
 * The wire contract of the lifecycle calls (demo-polish C6): the exact paths and bodies, the
 * fail-closed parse, and the error mapping -- every failure a sentence, the server's own words
 * only when they are short, one-line and not markup.
 */
import { AxiosError } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import {
  fetchLifecycle,
  isLifecycleState,
  LIFECYCLE_STATES,
  LifecycleError,
  parseLifecycle,
  postTransition,
  REQUEST_TIMEOUT_MS,
  sameExercise,
  stateMayHaveChanged,
  toLifecycleError,
} from './lifecycleService'

afterEach(() => {
  vi.restoreAllMocks()
})

function httpError(status: number, data: unknown): AxiosError {
  const config = { headers: {} } as never
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, {
    status,
    statusText: '',
    data,
    headers: {},
    config,
  })
}

describe('the vocabulary', () => {
  it('is the COR-032 six, canonical, in lifecycle order', () => {
    expect(LIFECYCLE_STATES).toEqual(['build', 'staged', 'live', 'paused', 'completed', 'archived'])
  })

  it('recognises only the canonical literals -- not the legacy ones, not other casings', () => {
    for (const state of LIFECYCLE_STATES) expect(isLifecycleState(state)).toBe(true)
    for (const bad of ['active', 'scheduled', 'complete', 'Live', 'LIVE', '', undefined, null, 3]) {
      expect(isLifecycleState(bad)).toBe(false)
    }
  })
})

describe('parseLifecycle', () => {
  it('reads the state, its allowed transitions and the exercise echo off the endpoint body, ignoring the rest', () => {
    expect(parseLifecycle({
      exerciseId: 'x',
      state: 'live',
      storedStatus: 'active',
      allowedTransitions: ['paused', 'completed'],
      behaviour: { clockRuns: true },
    })).toEqual({ exerciseId: 'x', state: 'live', allowedTransitions: ['paused', 'completed'] })
  })

  it('S-3: keeps the body\'s exerciseId when it sends one, and omits it when it does not (or sends junk)', () => {
    expect(parseLifecycle({ exerciseId: 'ex-1', state: 'staged' }).exerciseId).toBe('ex-1')
    for (const body of [
      { state: 'staged' },
      { exerciseId: '', state: 'staged' },
      { exerciseId: 7, state: 'staged' },
    ]) {
      expect(parseLifecycle(body)).not.toHaveProperty('exerciseId')
    }
  })

  it('drops allowed targets it does not know, and treats a missing list as none', () => {
    expect(parseLifecycle({ state: 'paused', allowedTransitions: ['live', 'x', 3] }))
      .toEqual({ state: 'paused', allowedTransitions: ['live'] })
    expect(parseLifecycle({ state: 'archived' })).toEqual({ state: 'archived', allowedTransitions: [] })
  })

  it.each([undefined, null, {}, { state: 'active' }, { state: 7 }])(
    'FAILS CLOSED on %j: a state it cannot name is never guessed',
    body => {
      expect(() => parseLifecycle(body)).toThrow(LifecycleError)
    },
  )
})

describe('the calls', () => {
  it('GETs /staff/exercise-lifecycle (relative to /api), bounded, with no parameters', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: { state: 'staged', allowedTransitions: ['live'] },
    })

    await expect(fetchLifecycle()).resolves.toEqual({ state: 'staged', allowedTransitions: ['live'] })

    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('/staff/exercise-lifecycle', { timeout: REQUEST_TIMEOUT_MS })
  })

  it('POSTs { to } and nothing else to /staff/exercise-lifecycle/transition, bounded', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: { state: 'live', allowedTransitions: ['paused', 'completed'] },
    })

    await expect(postTransition('live')).resolves.toEqual({
      state: 'live',
      allowedTransitions: ['paused', 'completed'],
    })

    expect(post).toHaveBeenCalledWith(
      '/staff/exercise-lifecycle/transition',
      { to: 'live' },
      { timeout: REQUEST_TIMEOUT_MS },
    )
    expect(Object.keys(post.mock.calls[0]?.[1] as object)).toEqual(['to'])
  })

  it('rejects a 200 whose body names a state it does not know (fail closed, not a silent success)', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ data: { state: 'nonsense', allowedTransitions: [] } })

    await expect(postTransition('completed')).rejects.toBeInstanceOf(LifecycleError)
  })

  it('turns a rejected call into a LifecycleError carrying the HTTP status', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(httpError(403, undefined))

    const error = await postTransition('live').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(LifecycleError)
    expect((error as LifecycleError).status).toBe(403)
  })
})

describe('toLifecycleError -- every failure is a sentence', () => {
  it('shows the server\'s own sentence for a 409 and for a 400', () => {
    const sentence = "'live' -> 'live' is not an allowed lifecycle transition (allowed from 'live': paused, completed)."
    expect(toLifecycleError(httpError(409, sentence)).message).toBe(sentence)
    expect(toLifecycleError(httpError(400, "'to' must be one of: build, staged.")).message)
      .toBe("'to' must be one of: build, staged.")
  })

  it('falls back to a fixed sentence when the server\'s text is markup, multi-line, empty, too long, or not a string', () => {
    const fallback = 'The exercise is not in a state that allows that change. Its state was refreshed.'
    for (const body of [
      '<html><body>Bad gateway</body></html>',
      'line one\nline two',
      '   ',
      'x'.repeat(301),
      { message: 'object bodies are not shown' },
      undefined,
    ]) {
      expect(toLifecycleError(httpError(409, body)).message).toBe(fallback)
    }
  })

  it('NEVER shows server text for a status that is not a refusal sentence (401 / 403 / 404 / 5xx)', () => {
    expect(toLifecycleError(httpError(403, 'internal detail that must not leak')).message)
      .toBe('Only staff assigned to this exercise can change its state.')
    expect(toLifecycleError(httpError(500, 'Server stack trace')).message)
      .toBe('The exercise state was not changed (the server answered 500).')
  })

  it('maps the other statuses to fixed sentences', () => {
    expect(toLifecycleError(httpError(401, undefined)).message)
      .toBe('Your console session has expired or has no exercise. Sign in again.')
    expect(toLifecycleError(httpError(404, undefined)).message).toBe('This exercise no longer exists.')
    for (const busy of [408, 429, 502, 503, 504]) {
      expect(toLifecycleError(httpError(busy, undefined)).message)
        .toBe('The server is busy right now. Try again in a moment.')
    }
  })

  it('says the server could not be reached when there was no response at all', () => {
    expect(toLifecycleError(new AxiosError('Network Error', 'ERR_NETWORK')).message)
      .toBe('The server could not be reached. Check the connection and try again.')
  })

  it('passes a LifecycleError through untouched, and wraps anything else', () => {
    const original = new LifecycleError('already ours', 409)
    expect(toLifecycleError(original)).toBe(original)
    expect(toLifecycleError(new TypeError('boom'))).toBeInstanceOf(LifecycleError)
    expect(toLifecycleError('a string').message).toBe('The exercise state could not be read or changed. Try again.')
  })
})

describe('stateMayHaveChanged -- which failures leave the exercise state UNKNOWN (S-A)', () => {
  it.each([undefined, 408, 409, 500, 502, 503, 504, 599])(
    'a failure with status %s may have changed the state: ask the server',
    status => {
      expect(stateMayHaveChanged(status)).toBe(true)
    },
  )

  it.each([400, 401, 403, 404, 405, 422, 429])(
    'a %i is a definitive refusal: the server persisted nothing',
    status => {
      expect(stateMayHaveChanged(status)).toBe(false)
    },
  )

  it('agrees with what toLifecycleError reports for a failure with no response', () => {
    expect(stateMayHaveChanged(toLifecycleError(new AxiosError('Network Error', 'ERR_NETWORK')).status))
      .toBe(true)
  })
})

describe('sameExercise -- is the server\'s answer for the exercise the console shows? (S-3)', () => {
  it('matches the same id, ignoring letter case and surrounding space (a GUID\'s casing must never hide the control)', () => {
    expect(sameExercise('ex-1', 'ex-1')).toBe(true)
    expect(sameExercise('3F2504E0-4F89-11D3-9A0C-0305E82C3301', '3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(true)
    expect(sameExercise(' ex-1 ', 'ex-1')).toBe(true)
  })

  it('does not match a different exercise', () => {
    expect(sameExercise('ex-2', 'ex-1')).toBe(false)
  })

  it('has nothing to contradict when the answer carries no echo (mock data, an older server)', () => {
    expect(sameExercise(undefined, 'ex-1')).toBe(true)
  })
})
