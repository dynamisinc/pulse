/**
 * features/controller/runSheet/injectErrors.test.ts
 * ---------------------------------------------------------------------------
 * 409 / 400 / 404 parsing (the frozen wire contract's error shapes) and the
 * controller-facing sentence for each (AC wording, `injectMessages`):
 *  - a 409 ProblemDetails yields `detail` and the CURRENT item, whether `item` rides
 *    under `extensions` (the contract's wording) or inline at the top level (how
 *    ASP.NET Core actually serialises ProblemDetails extensions);
 *  - a 400 yields a readable message plus field errors keyed by normalised path;
 *  - 404 is a typed not-found; everything else is passed through untouched;
 *  - "Already fired by {name}" / "Changed by someone else. Reloaded." / "World frozen".
 */
import { describe, expect, it } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import {
  InjectConflictError,
  InjectNotFoundError,
  InjectValidationError,
  normalizeFieldPath,
  translateInjectError,
} from './injectErrors'
import { MESSAGES, alreadyFiredBy, describeActionError } from './injectMessages'
import { makeItem } from './runSheetTestHarness'

function axiosError(status: number, data: unknown): AxiosError {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: {} as InternalAxiosRequestConfig,
    data,
  })
}

describe('translateInjectError', () => {
  it('409: detail + the current item from `extensions.item`', () => {
    const item = makeItem({ status: 'fired', firedByHumanId: 'human-controller-02' })
    const error = translateInjectError(
      axiosError(409, { detail: 'Already fired', extensions: { item } }),
    )
    expect(error).toBeInstanceOf(InjectConflictError)
    const conflict = error as InjectConflictError
    expect(conflict.detail).toBe('Already fired')
    expect(conflict.item?.id).toBe(item.id)
    expect(conflict.status).toBe(409)
  })

  it('409: also accepts `item` inline at the top level (ASP.NET ProblemDetails extensions)', () => {
    const item = makeItem({ status: 'held' })
    const error = translateInjectError(axiosError(409, { detail: 'Held', item }))
    expect((error as InjectConflictError).item?.status).toBe('held')
  })

  it('409: an item that is not the contract is dropped, not trusted', () => {
    const error = translateInjectError(
      axiosError(409, { detail: 'x', extensions: { item: { id: 5 } } }),
    )
    expect((error as InjectConflictError).item).toBeUndefined()
  })

  it('409 with no body still yields a typed conflict', () => {
    const error = translateInjectError(axiosError(409, undefined))
    expect(error).toBeInstanceOf(InjectConflictError)
    expect((error as InjectConflictError).detail).toBe('')
  })

  it('400: a readable message and normalised field errors', () => {
    const error = translateInjectError(
      axiosError(400, {
        title: 'One or more validation errors occurred.',
        errors: { Title: ['Title is required'], 'Posts[1].Text': ['Too long', 'ignored'] },
      }),
    ) as InjectValidationError
    expect(error).toBeInstanceOf(InjectValidationError)
    expect(error.fieldErrors).toEqual({ title: 'Title is required', 'posts.1.text': 'Too long' })
    expect(error.detail).toBe('One or more validation errors occurred.')
  })

  it('400 with only a detail keeps it as the form message', () => {
    const error = translateInjectError(
      axiosError(400, { detail: 'Persona not found' }),
    ) as InjectValidationError
    expect(error.detail).toBe('Persona not found')
    expect(error.fieldErrors).toEqual({})
  })

  it('404 is a typed not-found', () => {
    expect(translateInjectError(axiosError(404, { detail: 'Inject not found' })))
      .toBeInstanceOf(InjectNotFoundError)
  })

  it('anything else (500, a plain Error, a network error) passes through unchanged', () => {
    const server = axiosError(500, {})
    const plain = new Error('boom')
    expect(translateInjectError(server)).toBe(server)
    expect(translateInjectError(plain)).toBe(plain)
    const network = new AxiosError('Network Error', 'ERR_NETWORK')
    expect(translateInjectError(network)).toBe(network)
  })

  it('is idempotent on typed errors', () => {
    const conflict = new InjectConflictError('x')
    expect(translateInjectError(conflict)).toBe(conflict)
  })
})

describe('normalizeFieldPath', () => {
  it('lower-cases the first letter of each segment and turns [n] into .n', () => {
    expect(normalizeFieldPath('Posts[0].Text')).toBe('posts.0.text')
    expect(normalizeFieldPath('posts.2.media.1.alt')).toBe('posts.2.media.1.alt')
    expect(normalizeFieldPath('BurstWindowSeconds')).toBe('burstWindowSeconds')
  })
})

describe('describeActionError', () => {
  const names = (id: string | undefined) =>
    id === 'human-controller-02' ? 'Jordan Ames' : undefined

  it('a concurrent-fire 409 reads "Already fired by {name}"', () => {
    const item = makeItem({ status: 'fired', firedByHumanId: 'human-controller-02' })
    expect(describeActionError('fire', new InjectConflictError('Already fired', item), names))
      .toBe(alreadyFiredBy('Jordan Ames'))
  })

  it('also for an item that is already firing (a burst another controller released)', () => {
    const item = makeItem({ status: 'firing', firedByHumanId: 'human-controller-02' })
    expect(describeActionError('fire', new InjectConflictError('x', item), names))
      .toBe('Already fired by Jordan Ames')
  })

  it('falls back to "another controller" when the firer is unknown', () => {
    const item = makeItem({ status: 'fired', firedByHumanId: 'someone-unlisted' })
    expect(describeActionError('fire', new InjectConflictError('x', item), names))
      .toBe('Already fired by another controller')
    const noId = makeItem({ status: 'fired' })
    expect(describeActionError('fire', new InjectConflictError('x', noId), names))
      .toBe(`Already fired by ${MESSAGES.anotherController}`)
  })

  it('a stale-version save is "Changed by someone else. Reloaded."', () => {
    expect(describeActionError('save', new InjectConflictError('stale', makeItem()), names))
      .toBe('Changed by someone else. Reloaded.')
  })

  it('other 409s show the server detail verbatim; none falls back to the stale line', () => {
    expect(describeActionError('fire', new InjectConflictError('The world is frozen'), names))
      .toBe('The world is frozen')
    expect(describeActionError('hold', new InjectConflictError(''), names))
      .toBe(MESSAGES.changedByOthers)
  })

  it('400 / 404 / network are readable sentences', () => {
    expect(describeActionError('save', new InjectValidationError('Persona not found'), names))
      .toBe('Persona not found')
    expect(describeActionError('hold', new InjectNotFoundError(), names)).toBe(MESSAGES.notFound)
    expect(describeActionError('fire', new Error('Network Error'), names))
      .toBe("Couldn't fire: Network Error")
    expect(describeActionError('fire', axiosError(403, {}), names)).toContain('Only controllers')
    expect(describeActionError('fire', axiosError(401, {}), names)).toContain('session has ended')
  })

  it('carries the AC strings verbatim', () => {
    expect(MESSAGES.worldFrozen).toBe('World frozen')
    expect(MESSAGES.injectsPaused).toBe(
      'Injects paused: bursts are suspended; manual fire still works',
    )
    expect(MESSAGES.changedByOthers).toBe('Changed by someone else. Reloaded.')
  })
})
