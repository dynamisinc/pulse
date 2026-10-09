/**
 * features/controller/runSheet/runSheetModel.test.ts
 * ---------------------------------------------------------------------------
 * The run sheet's pure model (demo-polish C3): authoring (add / edit / duplicate /
 * delete / reorder / sort), the status transitions (one fire at a time, fired / failed /
 * unconfirmed, skip and undo skip) and the interrupted-fire reconciliation.
 */
import { describe, expect, it } from 'vitest'
import {
  addBeat,
  beginFire,
  completeFire,
  countStatuses,
  deleteBeat,
  deleteBlockReason,
  descendantIds,
  duplicateBeat,
  emptySheet,
  failFire,
  firstPendingBeat,
  INTERRUPTED_FIRE_MESSAGE,
  isFiring,
  moveBeat,
  nextBeatId,
  reconcileInterruptedFires,
  replaceBlockReason,
  replaceDefinition,
  runtimeOf,
  skipBeat,
  sortBeatsByMinute,
  unskipBeat,
  updateBeat,
  type BeatContent,
  type RunSheetData,
} from './runSheetModel'
import { RUN_SHEET_LIMITS } from './runSheetSchema'
import { beatFixture, failedBy, firedBy, sheetFixture } from './runSheetTestKit'

const ATTEMPT = 'attempt-1'

const content = (title: string, extra: Partial<BeatContent> = {}): BeatContent => ({
  title,
  scenarioMinute: 0,
  persona: { handle: 'FulcoEM' },
  text: `${title} text`,
  ...extra,
})

function threeBeats(): RunSheetData {
  return sheetFixture([
    beatFixture({ id: 'a', order: 1, title: 'A', scenarioMinute: 30 }),
    beatFixture({ id: 'b', order: 2, title: 'B', scenarioMinute: 10 }),
    beatFixture({ id: 'c', order: 3, title: 'C', scenarioMinute: 20 }),
  ])
}

describe('authoring', () => {
  it('adds beats at the end with contiguous 1-based orders and unique ids', () => {
    let data = emptySheet()
    data = addBeat(data, content('One')).data
    data = addBeat(data, content('Two')).data
    expect(data.beats.map(b => [b.id, b.order, b.title])).toEqual([
      ['beat-1', 1, 'One'],
      ['beat-2', 2, 'Two'],
    ])
  })

  it('refuses to add past 200 beats (the sheet is returned untouched)', () => {
    const beats = Array.from({ length: RUN_SHEET_LIMITS.beatsMax }, (_, i) =>
      beatFixture({ id: `b${i}`, order: i + 1 }))
    const full = sheetFixture(beats)
    const result = addBeat(full, content('One too many'))
    expect(result.beatId).toBeUndefined()
    expect(result.data).toBe(full)
  })

  it('never reuses an id that is already taken (imported ids may collide with beat-N)', () => {
    const data = sheetFixture([beatFixture({ id: 'beat-2', order: 1 })])
    expect(nextBeatId(data)).toBe('beat-3')
    const next = addBeat(data, content('New'))
    expect(next.beatId).toBe('beat-3')
  })

  it('updates a beat in place, keeping its id, order and status', () => {
    const base = firedBy(threeBeats(), 'b', { postId: 'p1', scenarioTime: '2033-09-04T14:00:00Z' })
    const next = updateBeat(base, 'b', content('B edited', { scenarioMinute: 5 }))
    expect(next.beats[1]).toMatchObject({ id: 'b', order: 2, title: 'B edited', scenarioMinute: 5 })
    expect(runtimeOf(next, 'b').status).toBe('fired')
  })

  it('duplicates a beat right after the original as a fresh pending beat', () => {
    const fired = firedBy(threeBeats(), 'a', { postId: 'p1', scenarioTime: '2033-09-04T14:00:00Z' })
    const { data, beatId } = duplicateBeat(fired, 'a')
    expect(data.beats.map(b => b.title)).toEqual(['A', 'A (copy)', 'B', 'C'])
    expect(data.beats.map(b => b.order)).toEqual([1, 2, 3, 4])
    expect(beatId).toBeDefined()
    expect(runtimeOf(data, beatId ?? '').status).toBe('pending')
    expect(data.beats[1]?.id).not.toBe('a')
  })

  it('keeps a duplicated title within 120 characters', () => {
    const long = sheetFixture([beatFixture({ id: 'x', title: 't'.repeat(120) })])
    const copy = duplicateBeat(long, 'x').data.beats[1]
    expect(copy?.title.length).toBeLessThanOrEqual(120)
    expect(copy?.title.endsWith(' (copy)')).toBe(true)
  })

  it('refuses to add or duplicate past 200 beats', () => {
    const beats = Array.from({ length: RUN_SHEET_LIMITS.beatsMax }, (_, i) =>
      beatFixture({ id: `b${i}`, order: i + 1 }))
    expect(duplicateBeat(sheetFixture(beats), 'b0').beatId).toBeUndefined()
  })

  it('moves a beat up or down and renumbers; the ends are no-ops', () => {
    const down = moveBeat(threeBeats(), 'a', 1)
    expect(down.beats.map(b => [b.id, b.order])).toEqual([['b', 1], ['a', 2], ['c', 3]])
    const up = moveBeat(down, 'c', -1)
    expect(up.beats.map(b => b.id)).toEqual(['b', 'c', 'a'])
    const data = threeBeats()
    expect(moveBeat(data, 'a', -1)).toBe(data)
    expect(moveBeat(data, 'c', 1)).toBe(data)
  })

  it('sorts by intended minute, stably, as a sort hint only', () => {
    const sorted = sortBeatsByMinute(threeBeats())
    expect(sorted.beats.map(b => [b.id, b.order, b.scenarioMinute])).toEqual([
      ['b', 1, 10],
      ['c', 2, 20],
      ['a', 3, 30],
    ])
    const ties = sortBeatsByMinute(sheetFixture([
      beatFixture({ id: 'x', order: 1, scenarioMinute: 5 }),
      beatFixture({ id: 'y', order: 2, scenarioMinute: 5 }),
    ]))
    expect(ties.beats.map(b => b.id)).toEqual(['x', 'y'])
  })

  it('replaces the whole definition on import: every beat pending, orders kept', () => {
    const fired = firedBy(threeBeats(), 'a', { postId: 'p', scenarioTime: '2033-09-04T14:00:00Z' })
    const next = replaceDefinition({
      name: 'Imported',
      beats: [beatFixture({ id: 'z', order: 7 }), beatFixture({ id: 'y', order: 3 })],
    })
    expect(fired.runtime).not.toEqual({})
    expect(next.runtime).toEqual({})
    expect(next.name).toBe('Imported')
    expect(next.beats.map(b => [b.id, b.order])).toEqual([['y', 3], ['z', 7]])
  })
})

describe('replies', () => {
  const replyChain = (): RunSheetData => sheetFixture([
    beatFixture({ id: 'p', order: 1, title: 'Parent' }),
    beatFixture({ id: 'c', order: 2, title: 'Child', replyTo: { beatId: 'p' } }),
    beatFixture({ id: 'g', order: 3, title: 'Grandchild', replyTo: { beatId: 'c' } }),
  ])

  it('finds every transitive descendant (they cannot become the parent)', () => {
    expect([...descendantIds(replyChain(), 'p')].sort()).toEqual(['c', 'g'])
    expect([...descendantIds(replyChain(), 'g')]).toEqual([])
  })

  it('refuses to delete a beat that un-fired replies depend on, and says which', () => {
    const data = replyChain()
    const reason = deleteBlockReason(data, 'p')
    expect(reason).toContain('"Child"')
    expect(deleteBeat(data, 'p')).toBe(data)
  })

  it('deleting a FIRED parent re-points its replies at the live post', () => {
    const fired = firedBy(replyChain(), 'p', { postId: 'post-1', scenarioTime: '2033-09-04T14:00:00Z' })
    expect(deleteBlockReason(fired, 'p')).toBeUndefined()
    const next = deleteBeat(fired, 'p')
    expect(next.beats.map(b => b.id)).toEqual(['c', 'g'])
    expect(next.beats[0]?.replyTo).toEqual({ postId: 'post-1' })
    expect(next.beats[1]?.replyTo).toEqual({ beatId: 'c' })
    expect(next.runtime.p).toBeUndefined()
    expect(next.beats.map(b => b.order)).toEqual([1, 2])
  })

  it('cannot delete a beat that is firing', () => {
    const begun = beginFire(threeBeats(), 'a', { attemptId: ATTEMPT })
    if (!begun.ok) throw new Error('expected ok')
    expect(deleteBlockReason(begun.data, 'a')).toContain('firing')
  })
})

describe('status transitions', () => {
  it('starts every beat pending and counts them', () => {
    const data = threeBeats()
    expect(runtimeOf(data, 'a')).toEqual({ status: 'pending' })
    expect(countStatuses(data)).toEqual({
      total: 3, pending: 3, fired: 0, skipped: 0, failed: 0, unconfirmed: 0,
    })
    expect(firstPendingBeat(data)?.id).toBe('a')
  })

  it('allows only ONE fire at a time and marks it in flight', () => {
    const first = beginFire(threeBeats(), 'a', { attemptId: ATTEMPT })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(isFiring(first.data)).toBe(true)
    expect(runtimeOf(first.data, 'a').inFlight).toBe(true)
    const second = beginFire(first.data, 'b', { attemptId: ATTEMPT })
    expect(second).toEqual({
      ok: false,
      reason: 'Another beat is still firing. Wait for its result.',
    })
    const again = beginFire(first.data, 'a', { attemptId: ATTEMPT })
    expect(again.ok).toBe(false)
  })

  it('refuses to fire a fired, skipped or missing beat', () => {
    const fired = firedBy(threeBeats(), 'a', { postId: 'p', scenarioTime: '2033-09-04T14:00:00Z' })
    expect(beginFire(fired, 'a', { attemptId: ATTEMPT })).toMatchObject({ ok: false, reason: 'That beat has already been fired.' })
    const skipped = skipBeat(threeBeats(), 'a')
    expect(beginFire(skipped, 'a', { attemptId: ATTEMPT })).toMatchObject({ ok: false })
    expect(beginFire(threeBeats(), 'nope', { attemptId: ATTEMPT })).toMatchObject({ ok: false })
  })

  it('records firedPostId and the fired scenario time, clearing the in-flight marker', () => {
    const begun = beginFire(threeBeats(), 'a', { attemptId: ATTEMPT })
    if (!begun.ok) throw new Error('expected ok')
    const fired = completeFire(begun.data, 'a', ATTEMPT, { postId: 'post-9', scenarioTime: '2033-09-04T14:00:00.000Z' })
    expect(runtimeOf(fired, 'a')).toEqual({
      status: 'fired',
      firedPostId: 'post-9',
      firedAtScenario: '2033-09-04T14:00:00.000Z',
    })
    expect(isFiring(fired)).toBe(false)
    expect(firstPendingBeat(fired)?.id).toBe('b')
  })

  it('records a failure, which Fire next never picks up', () => {
    const begun = beginFire(threeBeats(), 'a', { attemptId: ATTEMPT })
    if (!begun.ok) throw new Error('expected ok')
    const failed = failFire(begun.data, 'a', ATTEMPT, { kind: 'failed', message: 'refused' })
    expect(runtimeOf(failed, 'a')).toEqual({ status: 'failed', failure: { kind: 'failed', message: 'refused' } })
    expect(firstPendingBeat(failed)?.id).toBe('b')
    // A failed beat may be fired again directly (Retry): the server refused it.
    expect(beginFire(failed, 'a', { attemptId: ATTEMPT }).ok).toBe(true)
  })

  it('counts unconfirmed separately from failed', () => {
    let data = threeBeats()
    data = failedBy(data, 'a', { kind: 'failed', message: 'x' })
    data = failedBy(data, 'b', { kind: 'unconfirmed', message: 'y' })
    expect(countStatuses(data)).toMatchObject({ failed: 1, unconfirmed: 1, pending: 1 })
  })

  it('skips a pending or failed beat and undoes it exactly', () => {
    const skipped = skipBeat(threeBeats(), 'a')
    expect(runtimeOf(skipped, 'a')).toEqual({ status: 'skipped', skippedFrom: 'pending' })
    expect(firstPendingBeat(skipped)?.id).toBe('b')
    expect(runtimeOf(unskipBeat(skipped, 'a'), 'a')).toEqual({ status: 'pending' })

    const unconfirmed = failedBy(threeBeats(), 'a', { kind: 'unconfirmed', message: 'maybe live' })
    const skippedUnconfirmed = skipBeat(unconfirmed, 'a')
    expect(runtimeOf(skippedUnconfirmed, 'a').status).toBe('skipped')
    // Undo skip restores the warning: an unconfirmed beat never silently becomes pending.
    expect(runtimeOf(unskipBeat(skippedUnconfirmed, 'a'), 'a')).toEqual({
      status: 'failed',
      failure: { kind: 'unconfirmed', message: 'maybe live' },
    })
  })

  it('does not skip a fired or in-flight beat', () => {
    const fired = firedBy(threeBeats(), 'a', { postId: 'p', scenarioTime: '2033-09-04T14:00:00Z' })
    expect(skipBeat(fired, 'a')).toBe(fired)
    const begun = beginFire(threeBeats(), 'a', { attemptId: ATTEMPT })
    if (!begun.ok) throw new Error('expected ok')
    expect(skipBeat(begun.data, 'a')).toBe(begun.data)
  })
})

describe('reconcileInterruptedFires', () => {
  it('turns a beat left in flight by a closed page into unconfirmed, never pending', () => {
    const begun = beginFire(threeBeats(), 'a', { attemptId: ATTEMPT })
    if (!begun.ok) throw new Error('expected ok')
    const next = reconcileInterruptedFires(begun.data)
    expect(runtimeOf(next, 'a')).toEqual({
      status: 'failed',
      failure: { kind: 'unconfirmed', message: INTERRUPTED_FIRE_MESSAGE },
    })
    expect(isFiring(next)).toBe(false)
    expect(firstPendingBeat(next)?.id).toBe('b')
  })

  it('leaves a sheet with nothing in flight untouched', () => {
    const data = threeBeats()
    expect(reconcileInterruptedFires(data)).toBe(data)
  })
})

describe('a new beat goes at the END, even on an imported sheet with sparse orders', () => {
  it('uses the largest order + 1, so Fire next does not fire it first (Gate-1 M-1)', () => {
    const imported = replaceDefinition({
      name: 'Imported',
      beats: [
        beatFixture({ id: 'x10', order: 10, title: 'Ten' }),
        beatFixture({ id: 'x20', order: 20, title: 'Twenty' }),
      ],
    })
    const { data, beatId } = addBeat(imported, content('Brand new'))
    expect(data.beats.map(b => [b.title, b.order])).toEqual([
      ['Ten', 1],
      ['Twenty', 2],
      ['Brand new', 3],
    ])
    expect(beatId).toBe(data.beats[2]?.id)
    expect(firstPendingBeat(data)?.id).toBe('x10')
  })
})

describe('only the attempt that started a fire may record its outcome (Gate-1 M-2)', () => {
  it('records a result carrying the matching token', () => {
    const begun = beginFire(threeBeats(), 'a', { attemptId: 't1' })
    if (!begun.ok) throw new Error('expected ok')
    const done = completeFire(begun.data, 'a', 't1', { postId: 'p', scenarioTime: '2033-09-04T14:00:00Z' })
    expect(runtimeOf(done, 'a')).toMatchObject({ status: 'fired', firedPostId: 'p' })
    expect(runtimeOf(done, 'a').attemptId).toBeUndefined()
  })

  it('ignores a late result whose token no longer matches (another attempt, or none)', () => {
    const begun = beginFire(threeBeats(), 'a', { attemptId: 't2' })
    if (!begun.ok) throw new Error('expected ok')
    const late = { postId: 'ghost', scenarioTime: '2033-09-04T14:00:00Z' }
    expect(completeFire(begun.data, 'a', 't1', late)).toBe(begun.data)
    expect(failFire(begun.data, 'a', 't1', { kind: 'failed', message: 'x' })).toBe(begun.data)
    // A replaced sheet has no in-flight marker at all: the same late result is dropped.
    const replaced = replaceDefinition({ name: 'New', beats: threeBeats().beats })
    expect(completeFire(replaced, 'a', 't2', late)).toBe(replaced)
    expect(runtimeOf(replaced, 'a').status).toBe('pending')
    // And so is one for a beat that was reconciled to unconfirmed in the meantime.
    const reconciled = reconcileInterruptedFires(begun.data)
    expect(completeFire(reconciled, 'a', 't2', late)).toBe(reconciled)
    expect(runtimeOf(reconciled, 'a').status).toBe('failed')
  })

  it('stamps the token on the in-flight marker', () => {
    const begun = beginFire(threeBeats(), 'a', { attemptId: 't9' })
    if (!begun.ok) throw new Error('expected ok')
    expect(runtimeOf(begun.data, 'a')).toMatchObject({ inFlight: true, attemptId: 't9' })
  })
})

describe('the unconfirmed gate lives in beginFire (Gate-1 L-1)', () => {
  const unconfirmed = () => failedBy(threeBeats(), 'a', { kind: 'unconfirmed', message: 'maybe live' })

  it('refuses to fire an unconfirmed beat until the caller confirms', () => {
    const data = unconfirmed()
    const refused = beginFire(data, 'a', { attemptId: 't1' })
    expect(refused).toMatchObject({ ok: false, needsConfirmation: true })
    const confirmed = beginFire(data, 'a', { attemptId: 't1', confirmedUnconfirmed: true })
    expect(confirmed.ok).toBe(true)
  })

  it('does not ask for confirmation for a clean failure (Retry is safe)', () => {
    const data = failedBy(threeBeats(), 'a', { kind: 'failed', message: 'refused' })
    expect(beginFire(data, 'a', { attemptId: 't1' }).ok).toBe(true)
  })
})

describe('replaceBlockReason', () => {
  it('blocks a replacement while a beat is firing, and only then', () => {
    expect(replaceBlockReason(threeBeats())).toBeUndefined()
    const begun = beginFire(threeBeats(), 'a', { attemptId: 't1' })
    if (!begun.ok) throw new Error('expected ok')
    expect(replaceBlockReason(begun.data)).toContain('firing')
  })
})
