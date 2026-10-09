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
  failFireIn,
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

/** Begins a fire and records its success with the attempt token the store handed out. */
function fireAndRecord(
  exerciseId: string,
  beatId: string,
  result: { postId: string; scenarioTime: string },
): boolean {
  const claimed = beginFireIn(exerciseId, beatId)
  if (!claimed.ok) throw new Error(claimed.reason)
  return completeFireIn(exerciseId, beatId, claimed.attemptId, result)
}

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
    fireAndRecord(A, 'beat-1', { postId: 'post-1', scenarioTime: '2033-09-04T14:00:00.000Z' })
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
    const inA = beginFireIn(A, 'beat-1')
    expect(inA.ok).toBe(true)
    // The controller has switched to B and fired there meanwhile...
    fireAndRecord(B, 'beat-1', { postId: 'post-b', scenarioTime: '2033-09-04T14:00:00Z' })
    // ...and A's response arrives afterwards, carrying A's own attempt token.
    if (!inA.ok) throw new Error('unreachable')
    const recorded = completeFireIn(A, 'beat-1', inA.attemptId, {
      postId: 'post-a',
      scenarioTime: '2033-09-04T14:01:00Z',
    })
    expect(recorded).toBe(true)
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
    fireAndRecord(A, 'beat-1', { postId: 'p', scenarioTime: '2033-09-04T14:00:00Z' })
    expect(
      replaceSheetIn(A, { name: 'Imported', beats: [beatFixture({ id: 'z', order: 1 })] }),
    ).toEqual({ ok: true })
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

describe('a late result cannot land on a replaced or reconciled sheet (Gate-1 M-2)', () => {
  const OUTCOME = { postId: 'ghost-post', scenarioTime: '2033-09-04T14:00:00Z' }

  it('refuses to REPLACE the sheet while a beat is in flight', () => {
    addBeatTo(A, content('One'))
    const claimed = beginFireIn(A, 'beat-1')
    expect(claimed.ok).toBe(true)
    const outcome = replaceSheetIn(A, { name: 'New', beats: [beatFixture({ id: 'beat-1', order: 1 })] })
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.reason).toContain('firing')
    expect(getRunSheetSnapshot(A).name).toBe('Run sheet')
    expect(runtimeOf(getRunSheetSnapshot(A), 'beat-1').inFlight).toBe(true)
  })

  it('probe: another tab replaces the sheet, then the first tab\'s result arrives', () => {
    addBeatTo(A, content('One'))
    const claimed = beginFireIn(A, 'beat-1')
    if (!claimed.ok) throw new Error('expected ok')

    // The other tab loaded the old marker as a dead page's (reconciled in ITS memory only), then
    // replaced the sheet with one that reuses the beat id. Storage now holds a fresh sheet.
    writeStoredSheet(A, sheetFixture([beatFixture({ id: 'beat-1', order: 1 })], {}, 'Replaced'))

    // The first tab's request comes back.
    expect(completeFireIn(A, 'beat-1', claimed.attemptId, OUTCOME)).toBe(false)
    expect(failFireIn(A, 'beat-1', claimed.attemptId, { kind: 'failed', message: 'x' })).toBe(false)
    const after = getRunSheetSnapshot(A)
    expect(after.name).toBe('Replaced')
    // NOT a false "Fired" for a post this sheet never sent.
    expect(runtimeOf(after, 'beat-1')).toEqual({ status: 'pending' })
  })

  it('a result from an earlier attempt cannot land on a later attempt of the same beat', () => {
    addBeatTo(A, content('One'))
    const first = beginFireIn(A, 'beat-1')
    if (!first.ok) throw new Error('expected ok')
    // The first attempt's marker is wiped (another tab reconciled it), the controller re-fires.
    writeStoredSheet(A, sheetFixture(getRunSheetSnapshot(A).beats, {
      'beat-1': { status: 'failed', failure: { kind: 'unconfirmed', message: 'maybe' } },
    }))
    const second = beginFireIn(A, 'beat-1', { confirmedUnconfirmed: true })
    if (!second.ok) throw new Error('expected ok')

    expect(completeFireIn(A, 'beat-1', first.attemptId, OUTCOME)).toBe(false)
    expect(runtimeOf(getRunSheetSnapshot(A), 'beat-1').inFlight).toBe(true)
    expect(completeFireIn(A, 'beat-1', second.attemptId, { ...OUTCOME, postId: 'real-post' })).toBe(true)
    expect(runtimeOf(getRunSheetSnapshot(A), 'beat-1').firedPostId).toBe('real-post')
  })
})

describe('the unconfirmed gate is checked against fresh storage (Gate-1 L-1)', () => {
  it('a stale tab that thinks the beat is pending still has to confirm', () => {
    addBeatTo(A, content('One'))
    expect(runtimeOf(getRunSheetSnapshot(A), 'beat-1').status).toBe('pending')
    // The other tab recorded "unconfirmed" for it.
    const other = readStoredSheet(A)
    if (other.kind !== 'ok') throw new Error('expected a stored sheet')
    writeStoredSheet(A, {
      ...other.data,
      runtime: { 'beat-1': { status: 'failed', failure: { kind: 'unconfirmed', message: 'maybe live' } } },
    })

    const refused = beginFireIn(A, 'beat-1')
    expect(refused).toMatchObject({ ok: false, needsConfirmation: true })
    expect(beginFireIn(A, 'beat-1', { confirmedUnconfirmed: true }).ok).toBe(true)
  })
})

describe('a stored value that does not read back is never overwritten (Gate-1 L-4)', () => {
  const key = runSheetStorageKey(A)

  it('when storage turns unreadable under a ready sheet, the next change is blocked, not written', () => {
    addBeatTo(A, content('One'))
    window.localStorage.setItem(key, '{ corrupted by another tab')
    addBeatTo(A, content('Two'))
    expect(window.localStorage.getItem(key)).toBe('{ corrupted by another tab')
    const snapshot = getRunSheetSnapshot(A)
    expect(snapshot.state).toBe('unreadable')
    expect(snapshot.unreadableReason).toContain('not valid JSON')
    expect(beginFireIn(A, 'beat-1').ok).toBe(false)
  })

  it('keeps editing in memory (still without writing) when our own earlier write had failed', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    addBeatTo(A, content('One'))
    spy.mockRestore()
    window.localStorage.setItem(key, '{ corrupted')
    addBeatTo(A, content('Two'))
    expect(window.localStorage.getItem(key)).toBe('{ corrupted')
    const snapshot = getRunSheetSnapshot(A)
    expect(snapshot.state).toBe('ready')
    expect(snapshot.beats.map(b => b.title)).toEqual(['One', 'Two'])
    expect(snapshot.storageWarning).toBeDefined()
  })

  it('refuses a change that would not read back as a valid sheet, and says so', () => {
    addBeatTo(A, content('One'))
    const before = window.localStorage.getItem(key)
    updateBeatIn(A, 'beat-1', content('One', { text: 'x'.repeat(300) }))
    const snapshot = getRunSheetSnapshot(A)
    expect(snapshot.changeRefused).toContain('was not saved')
    expect(snapshot.beats[0]?.text).toBe('One text')
    expect(window.localStorage.getItem(key)).toBe(before)

    // The next valid change clears the notice.
    updateBeatIn(A, 'beat-1', content('One again'))
    expect(getRunSheetSnapshot(A).changeRefused).toBeUndefined()
    expect(getRunSheetSnapshot(A).beats[0]?.title).toBe('One again')
  })
})

describe('storage warnings tell the truth about Export (Gate-1 L-3)', () => {
  it('say that Export does not carry fired status, so a reload shows every beat Pending', () => {
    for (const message of [STORAGE_UNAVAILABLE_MESSAGE, STORAGE_WRITE_FAILED_MESSAGE]) {
      expect(message).toContain('Export keeps your beats but NOT which have been fired')
      expect(message).toContain('every beat shows as Pending')
    }
  })
})
