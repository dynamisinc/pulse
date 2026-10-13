/**
 * features/social/notifications/notificationStorage.test.ts
 * ---------------------------------------------------------------------------
 * What the notifications feature keeps in `sessionStorage` (demo-polish F7, story 16
 * "Isolation": "the storage key includes the exercise id; nothing is read from another
 * persona"): the key's scope, the round trip, defence against malformed/oversized stored
 * values, the sign-out sweep, and survival of unusable storage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMPTY_PERSISTED,
  NOTIFICATION_STORAGE_PREFIX,
  clearAllNotificationStorage,
  notificationStorageKey,
  parsePersisted,
  readPersisted,
  writePersisted,
  type PersistedNotifications,
} from './notificationStorage'
import { LIKE_RECORDS_CAP, READ_IDS_CAP } from './notificationTypes'

beforeEach(() => {
  window.sessionStorage.clear()
})
afterEach(() => {
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

const SAMPLE: PersistedNotifications = {
  v: 1,
  readIds: ['r1', 'r2'],
  likes: [
    { postId: 'm1', baseline: 4 },
    { postId: 'm2', baseline: 2, riseAt: '2033-09-04T14:00:00.000Z' },
    { postId: 'm3', baseline: 9, read: { count: 3, at: '2033-09-04T13:00:00.000Z' } },
  ],
}

describe('the storage key (Isolation AC)', () => {
  it('includes BOTH the exercise id and the persona id, under the feature prefix', () => {
    const key = notificationStorageKey('ex-1', 'persona-dreyes_fh')
    expect(key.startsWith(`${NOTIFICATION_STORAGE_PREFIX}:`)).toBe(true)
    expect(key).toContain('ex-1')
    expect(key).toContain('persona-dreyes_fh')
  })

  it('differs per persona and per exercise', () => {
    const base = notificationStorageKey('ex-1', 'p-a')
    expect(notificationStorageKey('ex-1', 'p-b')).not.toBe(base)
    expect(notificationStorageKey('ex-2', 'p-a')).not.toBe(base)
  })

  it('cannot be made to collide by an id that contains the separator', () => {
    expect(notificationStorageKey('a:b', 'c')).not.toBe(notificationStorageKey('a', 'b:c'))
  })
})

describe('read / write', () => {
  it('round-trips a state', () => {
    const key = notificationStorageKey('ex-1', 'p-a')
    writePersisted(window.sessionStorage, key, SAMPLE)
    expect(readPersisted(window.sessionStorage, key)).toEqual(SAMPLE)
  })

  it('reads nothing from another persona\'s or another exercise\'s entry', () => {
    writePersisted(window.sessionStorage, notificationStorageKey('ex-1', 'p-a'), SAMPLE)
    expect(readPersisted(window.sessionStorage, notificationStorageKey('ex-1', 'p-b')))
      .toEqual(EMPTY_PERSISTED)
    expect(readPersisted(window.sessionStorage, notificationStorageKey('ex-2', 'p-a')))
      .toEqual(EMPTY_PERSISTED)
  })

  it('an absent entry is the empty state', () => {
    expect(readPersisted(window.sessionStorage, 'nothing-here')).toEqual(EMPTY_PERSISTED)
  })
})

describe('untrusted stored values', () => {
  it.each([
    ['not json', '{oops'],
    ['a string', '"hello"'],
    ['null', 'null'],
    ['an array', '[]'],
    ['the wrong version', JSON.stringify({ v: 2, readIds: [], likes: [] })],
    ['missing arrays', JSON.stringify({ v: 1 })],
    ['arrays of the wrong type', JSON.stringify({ v: 1, readIds: 'x', likes: {} })],
  ])('%s is ignored (an empty state, never half-trusted)', (_label, raw) => {
    expect(parsePersisted(raw)).toEqual(EMPTY_PERSISTED)
  })

  it('drops malformed entries but keeps the good ones', () => {
    const parsed = parsePersisted(JSON.stringify({
      v: 1,
      readIds: ['ok', 7, '', null, 'also-ok'],
      likes: [
        { postId: 'good', baseline: 3 },
        { postId: 'neg', baseline: -1 },
        { postId: 'nan', baseline: 'x' },
        { baseline: 2 },
        { postId: 'bad-read', baseline: 1, read: { count: 'x', at: 'y' } },
        { postId: 'bad-rise', baseline: 1, riseAt: 7 },
        'junk',
      ],
    }))
    expect(parsed.readIds).toEqual(['ok', 'also-ok'])
    expect(parsed.likes).toEqual([{ postId: 'good', baseline: 3 }])
  })

  it('rebuilds records field by field: a stray key (even an own `__proto__`) never rides through', () => {
    // Written as raw JSON: an object literal's `__proto__` is not an own key, JSON's is.
    const parsed = parsePersisted(
      '{"v":1,"readIds":[],"likes":[{"postId":"m1","baseline":1,"secret":"x",' +
        '"__proto__":{"polluted":true}}]}',
    )
    expect(Object.keys(parsed.likes[0] ?? {}).sort()).toEqual(['baseline', 'postId'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('bounds an oversized stored state, keeping the newest entries', () => {
    const readIds = Array.from({ length: READ_IDS_CAP + 40 }, (_, index) => `r${index}`)
    const likes = Array.from({ length: LIKE_RECORDS_CAP + 40 }, (_, index) => ({
      postId: `m${index}`,
      baseline: index,
    }))
    const parsed = parsePersisted(JSON.stringify({ v: 1, readIds, likes }))
    expect(parsed.readIds).toHaveLength(READ_IDS_CAP)
    expect(parsed.readIds.at(-1)).toBe(`r${READ_IDS_CAP + 39}`)
    expect(parsed.likes).toHaveLength(LIKE_RECORDS_CAP)
    expect(parsed.likes.at(-1)?.postId).toBe(`m${LIKE_RECORDS_CAP + 39}`)
  })
})

describe('sign-out sweep', () => {
  it('removes every notification entry (any persona, any exercise) and nothing else', () => {
    writePersisted(window.sessionStorage, notificationStorageKey('ex-1', 'p-a'), SAMPLE)
    writePersisted(window.sessionStorage, notificationStorageKey('ex-1', 'p-b'), SAMPLE)
    writePersisted(window.sessionStorage, notificationStorageKey('ex-2', 'p-a'), SAMPLE)
    window.sessionStorage.setItem('unrelated', 'keep me')
    window.sessionStorage.setItem(`${NOTIFICATION_STORAGE_PREFIX}-lookalike`, 'keep me too')

    clearAllNotificationStorage(window.sessionStorage)

    expect(window.sessionStorage.getItem(notificationStorageKey('ex-1', 'p-a'))).toBeNull()
    expect(window.sessionStorage.getItem(notificationStorageKey('ex-1', 'p-b'))).toBeNull()
    expect(window.sessionStorage.getItem(notificationStorageKey('ex-2', 'p-a'))).toBeNull()
    expect(window.sessionStorage.getItem('unrelated')).toBe('keep me')
    expect(window.sessionStorage.getItem(`${NOTIFICATION_STORAGE_PREFIX}-lookalike`))
      .toBe('keep me too')
  })
})

describe('unusable storage', () => {
  it('no storage at all: reads are empty, writes and sweeps are no-ops', () => {
    expect(readPersisted(undefined, 'k')).toEqual(EMPTY_PERSISTED)
    expect(() => writePersisted(undefined, 'k', SAMPLE)).not.toThrow()
    expect(() => clearAllNotificationStorage(undefined)).not.toThrow()
  })

  it('storage that throws (quota, blocked) never throws out of the feature', () => {
    const broken = {
      length: 1,
      key: () => { throw new Error('blocked') },
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('blocked') },
    } as unknown as Storage
    expect(readPersisted(broken, 'k')).toEqual(EMPTY_PERSISTED)
    expect(() => writePersisted(broken, 'k', SAMPLE)).not.toThrow()
    expect(() => clearAllNotificationStorage(broken)).not.toThrow()
  })
})
