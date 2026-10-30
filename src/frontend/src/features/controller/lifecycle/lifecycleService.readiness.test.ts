/**
 * features/controller/lifecycle/lifecycleService.readiness.test.ts
 * ---------------------------------------------------------------------------
 * exercise-build-golive story 04: the readiness-blocking 409 on a STAGE. It parses into a typed
 * `LifecycleError` (`kind: 'readiness-blocking'`, validated items); every other 409 keeps its
 * existing handling; a malformed body FAILS CLOSED to the generic 409.
 */
import { AxiosError } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { postTransition, REQUEST_TIMEOUT_MS, toLifecycleError } from './lifecycleService'

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

const item = { id: 'schedule-set', label: 'Schedule set', status: 'open', detail: 'No start.' }
const body = { error: 'readiness-blocking', message: 'Blocking items are open.', blocking: [item] }

describe('the readiness-blocking 409 (exercise-build-golive story 04)', () => {
  it('parses into a typed error carrying the validated items', () => {
    const error = toLifecycleError(httpError(409, body))
    expect(error.kind).toBe('readiness-blocking')
    expect(error.status).toBe(409)
    expect(error.message).toBe('Blocking items are open.')
    expect(error.blocking).toEqual([item])
  })

  it('postTransition("staged") posts { to } and rejects with the typed error', async () => {
    const post = vi.spyOn(api, 'post').mockRejectedValue(httpError(409, body))
    await expect(postTransition('staged')).rejects.toMatchObject({ kind: 'readiness-blocking' })
    expect(post).toHaveBeenCalledWith(
      '/staff/exercise-lifecycle/transition',
      { to: 'staged' },
      { timeout: REQUEST_TIMEOUT_MS },
    )
  })

  it('uses a fixed sentence when the message is not showable', () => {
    const error = toLifecycleError(httpError(409, { ...body, message: '<b>x</b>' }))
    expect(error.kind).toBe('readiness-blocking')
    expect(error.message).toMatch(/cannot be staged yet/i)
  })

  it('a plain-string 409 still shows the machine sentence, with no kind', () => {
    const sentence = "'live' -> 'live' is not an allowed lifecycle transition."
    const error = toLifecycleError(httpError(409, sentence))
    expect(error.kind).toBeUndefined()
    expect(error.blocking).toBeUndefined()
    expect(error.message).toBe(sentence)
  })

  it.each([
    ['an empty blocking list', { ...body, blocking: [] }],
    ['a malformed item', { ...body, blocking: [{ id: 'x', label: 'X', status: 'weird', detail: null }] }],
    ['an item that is not open', { ...body, blocking: [{ id: 'x', label: 'X', status: 'ok', detail: null }] }],
    ['a non-array list', { ...body, blocking: 'nope' }],
    ['a different error code', { ...body, error: 'other' }],
    ['no blocking key', { error: 'readiness-blocking', message: 'm' }],
  ])('fails closed on %s: generic 409 handling, no typed error', (_name, data) => {
    const error = toLifecycleError(httpError(409, data))
    expect(error.kind).toBeUndefined()
    expect(error.blocking).toBeUndefined()
    expect(error.status).toBe(409)
    expect(error.message).toMatch(/not in a state that allows that change/i)
  })

  it('a readiness-blocking body on a non-409 status is not honoured', () => {
    expect(toLifecycleError(httpError(400, body)).kind).toBeUndefined()
  })
})
