import { describe, expect, it } from 'vitest'
import { ambientRaiseKind, isAmbientRaise } from './ambientRaise'

const base = {
  mode: 'autonomous' as const,
  maxPerMinute: 2,
  maxPerHour: 30,
  topicAllowList: ['a', 'b'],
  personaAllowList: ['p1', 'p2'],
}

describe('isAmbientRaise', () => {
  it('switching to autonomous is a raise', () => {
    expect(isAmbientRaise({ ...base, mode: 'review' }, base)).toBe(true)
    expect(ambientRaiseKind({ ...base, mode: 'off' }, base)).toBe('switch')
  })
  it('raising either cap while autonomous is a raise', () => {
    expect(isAmbientRaise(base, { ...base, maxPerMinute: 3 })).toBe(true)
    expect(ambientRaiseKind(base, { ...base, maxPerHour: 31 })).toBe('widen')
  })
  it('adding a topic or persona is a raise', () => {
    expect(isAmbientRaise(base, { ...base, topicAllowList: ['a', 'b', 'c'] })).toBe(true)
    expect(isAmbientRaise(base, { ...base, personaAllowList: [...base.personaAllowList, 'p3'] })).toBe(true)
  })
  it('a swap counts as adding', () => {
    expect(isAmbientRaise(base, { ...base, topicAllowList: ['a', 'c'] })).toBe(true)
  })
  it('reorder is not a raise', () => {
    expect(isAmbientRaise(base, { ...base, topicAllowList: ['b', 'a'], personaAllowList: ['p2', 'p1'] })).toBe(false)
  })
  it('lowering caps or removing entries is not a raise', () => {
    expect(isAmbientRaise(base, { ...base, maxPerMinute: 1, maxPerHour: 10 })).toBe(false)
    expect(isAmbientRaise(base, { ...base, topicAllowList: [], personaAllowList: ['p1'] })).toBe(false)
  })
  it('unchanged autonomous is not a raise', () => {
    expect(isAmbientRaise(base, base)).toBe(false)
  })
  it('off/review drafts are never a raise, even with bigger caps or lists', () => {
    const bigger = { ...base, maxPerMinute: 99, topicAllowList: ['a', 'b', 'z'] }
    expect(isAmbientRaise(base, { ...bigger, mode: 'review' })).toBe(false)
    expect(isAmbientRaise(base, { ...bigger, mode: 'off' })).toBe(false)
    expect(isAmbientRaise({ ...base, mode: 'off' }, { ...bigger, mode: 'review' })).toBe(false)
  })
})
