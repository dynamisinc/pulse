/**
 * features/controller/runSheet/runSheetStore.test.ts
 * ---------------------------------------------------------------------------
 * Persistence + reactivity of the run-sheet store (demo-polish C3; AC "Persisted per
 * exercise"): the `pulse.runsheet.v1:{exerciseId}` key, survival across a reload, NO
 * cross-exercise bleed, the visible storage-failure warning, an unreadable saved sheet
 * (never overwritten silently), the interrupted-fire reconciliation, and the
 * read-modify-write that stops a stale second tab from re-firing a fired beat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_UNAVAILABLE_MESSAGE,
  STORAGE_WRITE_FAILED_MESSAGE,
  readStoredSheet,
  runSheetBackupKey,
  runSheetStorageKey,
  writeStoredSheet,
} from './runSheetStorage'
import {
  addBeatTo,
  beginFireIn,
  completeFireIn,
  deleteBeatFrom,
  duplicateBeatIn,
  getRunSheetSnapshot,
  moveBeatIn,
  renameSheetIn,
  replaceSheetIn,
  resetRunSheetStoreForTests,
  skipBeatIn,
  startFreshIn,
  subscribeRunSheet,
  unskipBeatIn,
  updateBeatIn,
} from './runSheetStore'
import { INTERRUPTED_FIRE_MESSAGE, runtimeOf, type BeatContent } from './runSheetModel'
import { beatFixture, resetRunSheetWorld, seedStoredSheet, sheetFixture } from './runSheetTestKit'

const A = 'ex-a'
const B = 'ex-b'

const content = (title: string, extra: Partial<BeatContent> = {}): BeatContent => ({
  title,
  scenarioMinute: 3,
  persona: { handle: 'FulcoEM' },
  text: `${title} text`,
  ...extra,
})

beforeEach(resetRunSheetWorld)
afterEach(() => {
  vi.restoreAllMocks()
  resetRunSheetWorld()
})

describe('storage key and shape', () => {
  it('keeps each exercise under its own pulse.runsheet.v1:{exerciseId} key', () => {
    expect(runSheetStorageKey('ex-1')).toBe('pulse.runsheet.v1:ex-1')
    addBeatTo(A, content('In A'))
    expect(window.localStorage.getItem('pulse.runsheet.v1:ex-a')).not.toBeNull()
    expect(window.localStorage.getItem('pulse.runsheet.v1:ex-b')).toBeNull()
  })

  it('stores the definition and the status side by side, with no exerciseId inside', () => {
    const id = addBeatTo(A, content('One'))
    expect(id).toBe('beat-1')
    beginFireIn(A, 'beat-1')
    completeFireIn(A, 'beat-1', { postId: 'post-1', scenarioTime: '2033-09-04T14:00:00.000Z' })
    const raw = window.localStorage.getItem(runSheetStorageKey(A)) ?? ''
    const stored: unknown = JSON.parse(raw)
    expect(stored).toMatchObject({
      v: 1,
      name: 'Run sheet',
      beats: [{ id: 'beat-1', title: 'One' }],
      runtime: { 'beat-1': { status: 'fired', firedPostId: 'post-1' } },
    })
    expect(raw).not.toMatch(/exerciseId|ex-a/)
  })
})

describe('per-exercise isolation (no cross-exercise bleed)', () => {
  it('shows only the selected exercise\'s sheet, and each survives a reload', () => {
    addBeatTo(A, content('Only in A'))
    expect(getRunSheetSnapshot(A).beats.map(b => b.title)).toEqual(['Only in A'])
    expect(getRunSheetSnapshot(B).beats).toEqual([])

    addBeatTo(B, content('Only in B'))
    expect(getRunSheetSnapshot(A).beats.map(b => b.title)).toEqual(['Only in A'])
    expect(getRunSheetSnapshot(B).beats.map(b => b.title)).toEqual(['Only in B'])

    // "Reload": the module cache is gone, storage remains.
    resetRunSheetStoreForTests()
    expect(getRunSheetSnapshot(A).beats.map(b => b.title)).toEqual(['Only in A'])
    expect(getRunSheetSnapshot(B).beats.map(b => b.title)).toEqual(['Only in B'])
  })

  it('records a fire against the exercise it started in, whatever is current later', () => {
    addBeatTo(A, content('A beat'))
    addBeatTo(B, content('B beat'))
    expect(beginFireIn(A, 'beat-1').ok).toBe(true)
    // The controller has switched to B and fired there meanwhile...
    expect(beginFireIn(B, 'beat-1').ok).toBe(true)
    completeFireIn(B, 'beat-1', { postId: 'post-b', scenarioTime: '2033-09-04T14:00:00Z' })
    // ...and A's response arrives afterwards.
    completeFireIn(A, 'beat-1', { postId: 'post-a', scenarioTime: '2033-09-04T14:01:00Z' })
    expect(runtimeOf(getRunSheetSnapshot(A), 'beat-1').firedPostId).toBe('post-a')
    expect(runtimeOf(getRunSheetSnapshot(B), 'beat-1').firedPostId).toBe('post-b')
  })
})

describe('authoring through the store persists every change', () => {
  it('survives a reload: add, edit, duplicate, move, rename, skip, delete', () => {
    addBeatTo(A, content('One'))
    addBeatTo(A, content('Two'))
    updateBeatIn(A, 'beat-1', content('One edited'))
    duplicateBeatIn(A, 'beat-1')
    moveBeatIn(A, 'beat-2', 1)
    renameSheetIn(A, 'My sheet')
    skipBeatIn(A, 'beat-2')
    resetRunSheetStoreForTests()
    const after = getRunSheetSnapshot(A)
    expect(after.name).toBe('My sheet')
    expect(after.beats.map(b => b.title)).toEqual(['One edited', 'One edited (copy)', 'Two'])
    expect(after.beats.map(b => b.order)).toEqual([1, 2, 3])
    expect(runtimeOf(after, 'beat-2').status).toBe('skipped')
    unskipBeatIn(A, 'beat-2')
    expect(deleteBeatFrom(A, 'beat-2')).toEqual({ ok: true })
    resetRunSheetStoreForTests()
    expect(getRunSheetSnapshot(A).beats.map(b => b.title)).toEqual([
      'One edited',
      'One edited (copy)',
    ])
  })

  it('refuses to delete a beat with un-fired replies and reports why', () => {
    addBeatTo(A, content('Parent'))
    addBeatTo(A, content('Child', { replyTo: { beatId: 'beat-1' } }))
    const outcome = deleteBeatFrom(A, 'beat-1')
    expect(outcome.ok).toBe(false)
    expect(getRunSheetSnapshot(A).beats).toHaveLength(2)
  })

  it('replaces the sheet on import, with every beat pending', () => {
    addBeatTo(A, content('Old'))
    beginFireIn(A, 'beat-1')
    completeFireIn(A, 'beat-1', { postId: 'p', scenarioTime: '2033-09-04T14:00:00Z' })
    replaceSheetIn(A, { name: 'Imported', beats: [beatFixture({ id: 'z', order: 1 })] })
    const after = getRunSheetSnapshot(A)
    expect(after.name).toBe('Imported')
    expect(after.beats.map(b => b.id)).toEqual(['z'])
    expect(after.runtime).toEqual({})
  })
})

describe('storage failure is a visible warning, never silent loss', () => {
  it('keeps the edit in memory, raises a warning, and clears it on the next good write', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    addBeatTo(A, content('Kept in memory'))
    const failed = getRunSheetSnapshot(A)
    expect(failed.beats.map(b => b.title)).toEqual(['Kept in memory'])
    expect(failed.storageWarning).toBe(STORAGE_WRITE_FAILED_MESSAGE)

    // Memory stays the truth while the warning stands (no rollback from a stale store).
    addBeatTo(A, content('Second'))
    expect(getRunSheetSnapshot(A).beats).toHaveLength(2)

    spy.mockRestore()
    addBeatTo(A, content('Third'))
    const healed = getRunSheetSnapshot(A)
    expect(healed.storageWarning).toBeUndefined()
    expect(healed.beats).toHaveLength(3)
    resetRunSheetStoreForTests()
    expect(getRunSheetSnapshot(A).beats).toHaveLength(3)
  })

  it('warns up front when the browser will not let us read storage at all', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    resetRunSheetStoreForTests()
    const snapshot = getRunSheetSnapshot(A)
    expect(snapshot.state).toBe('ready')
    expect(snapshot.storageWarning).toBe(STORAGE_UNAVAILABLE_MESSAGE)
    expect(snapshot.beats).toEqual([])
  })
})

describe('an unreadable saved sheet is never silently overwritten', () => {
  const key = runSheetStorageKey(A)

  it('reports invalid JSON, ignores edits, and leaves the stored text alone', () => {
    window.localStorage.setItem(key, '{ definitely not json')
    const snapshot = getRunSheetSnapshot(A)
    expect(snapshot.state).toBe('unreadable')
    expect(snapshot.unreadableReason).toContain('not valid JSON')
    addBeatTo(A, content('Ignored'))
    expect(getRunSheetSnapshot(A).beats).toEqual([])
    expect(window.localStorage.getItem(key)).toBe('{ definitely not json')
  })

  it('treats a schema-invalid sheet (text over 280) as unreadable too', () => {
    const bad = JSON.stringify({
      v: 1,
      name: 'x',
      beats: [beatFixture({ text: 'a'.repeat(400) })],
      runtime: {},
    })
    window.localStorage.setItem(key, bad)
    expect(getRunSheetSnapshot(A).state).toBe('unreadable')
  })

  it('treats a fired beat with no post id as unreadable (a reply would gate on nothing)', () => {
    window.localStorage.setItem(key, JSON.stringify({
      v: 1,
      name: 'x',
      beats: [beatFixture()],
      runtime: { b1: { status: 'fired' } },
    }))
    expect(getRunSheetSnapshot(A).state).toBe('unreadable')
  })

  it('starts fresh only on request, keeping a backup copy of the old text', () => {
    window.localStorage.setItem(key, '{ nope')
    expect(getRunSheetSnapshot(A).state).toBe('unreadable')
    startFreshIn(A)
    expect(getRunSheetSnapshot(A).state).toBe('ready')
    expect(getRunSheetSnapshot(A).beats).toEqual([])
    expect(window.localStorage.getItem(runSheetBackupKey(A))).toBe('{ nope')
    addBeatTo(A, content('New'))
    expect(readStoredSheet(A).kind).toBe('ok')
  })
})

describe('an interrupted fire is never silently pending again', () => {
  it('turns a beat still in flight at load into unconfirmed (the page that sent it is gone)', () => {
    seedStoredSheet(A, sheetFixture(
      [beatFixture({ id: 'b1', order: 1 }), beatFixture({ id: 'b2', order: 2 })],
      { b1: { status: 'pending', inFlight: true } },
    ))
    const snapshot = getRunSheetSnapshot(A)
    expect(runtimeOf(snapshot, 'b1')).toEqual({
      status: 'failed',
      failure: { kind: 'unconfirmed', message: INTERRUPTED_FIRE_MESSAGE },
    })
    // And it is persisted by the next real change, not left as a pending beat on disk.
    renameSheetIn(A, 'Renamed')
    const stored = readStoredSheet(A)
    expect(stored.kind === 'ok' && runtimeOf(stored.data, 'b1').failure?.kind).toBe('unconfirmed')
  })
})

describe('the single fire slot', () => {
  it('claims the slot synchronously: a second press in the same tick is refused', () => {
    addBeatTo(A, content('One'))
    addBeatTo(A, content('Two'))
    const first = beginFireIn(A, 'beat-1')
    const doublePress = beginFireIn(A, 'beat-1')
    const otherBeat = beginFireIn(A, 'beat-2')
    expect(first.ok).toBe(true)
    expect(doublePress.ok).toBe(false)
    expect(otherBeat).toEqual({
      ok: false,
      reason: 'Another beat is still firing. Wait for its result.',
    })
  })

  it('persists the in-flight marker before the request resolves', () => {
    addBeatTo(A, content('One'))
    beginFireIn(A, 'beat-1')
    const stored = readStoredSheet(A)
    expect(stored.kind === 'ok' && stored.data.runtime['beat-1']?.inFlight).toBe(true)
  })
})

describe('a second tab', () => {
  it('cannot re-fire a beat the other tab already fired (read-modify-write)', () => {
    addBeatTo(A, content('One'))
    // The other tab fires it and writes: this tab's cache is now stale (still pending).
    const other = readStoredSheet(A)
    if (other.kind !== 'ok') throw new Error('expected a stored sheet')
    writeStoredSheet(A, {
      ...other.data,
      runtime: {
        'beat-1': { status: 'fired', firedPostId: 'post-1', firedAtScenario: '2033-09-04T14:00:00Z' },
      },
    })
    expect(runtimeOf(getRunSheetSnapshot(A), 'beat-1').status).toBe('pending')
    expect(beginFireIn(A, 'beat-1')).toEqual({
      ok: false,
      reason: 'That beat has already been fired.',
    })
    expect(runtimeOf(getRunSheetSnapshot(A), 'beat-1').firedPostId).toBe('post-1')
  })

  it('refreshes this tab, and notifies subscribers, when the other tab writes (storage event)', () => {
    addBeatTo(A, content('One'))
    const listener = vi.fn()
    const unsubscribe = subscribeRunSheet(listener)
    const other = readStoredSheet(A)
    if (other.kind !== 'ok') throw new Error('expected a stored sheet')
    const key = runSheetStorageKey(A)
    writeStoredSheet(A, { ...other.data, name: 'Edited elsewhere' })
    window.dispatchEvent(new StorageEvent('storage', { key }))
    expect(getRunSheetSnapshot(A).name).toBe('Edited elsewhere')
    expect(listener).toHaveBeenCalled()

    // An unrelated key does nothing.
    listener.mockClear()
    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }))
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })
})
