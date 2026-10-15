/**
 * features/controller/liveWorld/liveWorldModel.pinUnread.test.ts
 * ---------------------------------------------------------------------------
 * Story 08, the pure model: entries know whether they ARRIVED LIVE (unread on arrival)
 * and whether they are PINNED FOR EVERYONE; a refresh keeps the first-sighting `live`
 * flag but carries the server's pin state; `applyPinChange` re-pins one entry only
 * (identity kept for everything else, so memoized rows stay memoized).
 */
import { describe, expect, it } from 'vitest'
import type { ParticipantPostView } from '@/features/social'
import {
  applyPinChange,
  EMPTY_LIVE_WORLD_STATE,
  ingest,
  readPinnedForAll,
  toEntry,
  toLiveWorldPost,
} from './liveWorldModel'
import { at, view } from './liveWorldTestKit'

/** A view as the wire sends it once pinned (the key joins the shared type with story 07). */
function pinnedView(id: string, minute = 0): ParticipantPostView {
  return { ...view(id, { scenarioTime: at(minute) }), pinnedForAll: true } as ParticipantPostView
}

describe('readPinnedForAll', () => {
  it('is true only for a literal pinnedForAll: true', () => {
    expect(readPinnedForAll({ pinnedForAll: true })).toBe(true)
    expect(readPinnedForAll({ pinnedForAll: 'true' })).toBe(false)
    expect(readPinnedForAll({})).toBe(false)
  })
})

describe('toEntry: live and pinned', () => {
  it('defaults to a baseline (not live), unpinned entry', () => {
    const entry = toEntry(view('a'), 1)
    expect(entry.live).toBe(false)
    expect(entry.pinnedForAll).toBe(false)
  })

  it('reads the pin off the view, and takes explicit options', () => {
    expect(toEntry(pinnedView('a'), 1).pinnedForAll).toBe(true)
    const entry = toEntry(view('b'), 2, { live: true, pinnedForAll: true })
    expect(entry.live).toBe(true)
    expect(entry.pinnedForAll).toBe(true)
  })
})

describe('ingest: refresh keeps live, carries the pin', () => {
  it('a re-delivery of a live post as a baseline/sweep item keeps it live', () => {
    const base = ingest(EMPTY_LIVE_WORLD_STATE, [toEntry(view('a', { scenarioTime: at(5) }), 1, {
      live: true,
    })], false)
    const sweep = toEntry(
      view('a', { scenarioTime: at(5), counts: { reply: 1, repost: 0, like: 0 } }), 2)
    const next = ingest(base, [sweep], false)
    expect(next.rows[0]?.live).toBe(true)
    expect(next.rows[0]?.view.counts.reply).toBe(1)
  })

  it('a refresh whose only change is the pin state replaces the entry', () => {
    const base = ingest(EMPTY_LIVE_WORLD_STATE, [toEntry(view('a', { scenarioTime: at(5) }), 1)], false)
    const next = ingest(base, [toEntry(view('a', { scenarioTime: at(5) }), 2, {
      pinnedForAll: true,
    })], false)
    expect(next).not.toBe(base)
    expect(next.rows[0]?.pinnedForAll).toBe(true)
    expect(next.rows[0]?.seq).toBe(1)
  })

  it('an unchanged re-delivery (same pin) is still a no-op', () => {
    const base = ingest(EMPTY_LIVE_WORLD_STATE, [toEntry(pinnedView('a', 5), 1)], false)
    expect(ingest(base, [toEntry(pinnedView('a', 5), 2)], false)).toBe(base)
  })
})

describe('applyPinChange', () => {
  const base = ingest(
    ingest(EMPTY_LIVE_WORLD_STATE, [
      toEntry(view('a', { scenarioTime: at(5) }), 1),
      toEntry(view('b', { scenarioTime: at(4) }), 2),
    ], false),
    [toEntry(view('held', { scenarioTime: at(9) }), 3, { live: true })],
    true,
  )

  it('re-pins only that entry; every other entry keeps its identity', () => {
    const next = applyPinChange(base, 'a', true)
    expect(next.rows[0]?.pinnedForAll).toBe(true)
    expect(next.rows[0]).not.toBe(base.rows[0])
    expect(next.rows[1]).toBe(base.rows[1])
    expect(next.pending).toBe(base.pending)
  })

  it('re-pins a held post too, and unpins', () => {
    const pinned = applyPinChange(base, 'held', true)
    expect(pinned.pending[0]?.pinnedForAll).toBe(true)
    expect(applyPinChange(pinned, 'held', false).pending[0]?.pinnedForAll).toBe(false)
  })

  it('returns the same state for an unknown id or no change', () => {
    expect(applyPinChange(base, 'nope', true)).toBe(base)
    expect(applyPinChange(base, 'a', false)).toBe(base)
  })
})

describe('toLiveWorldPost: pinnedForAll', () => {
  it('is present (true) only when pinned', () => {
    expect(toLiveWorldPost(view('a'), undefined, true).pinnedForAll).toBe(true)
    expect('pinnedForAll' in toLiveWorldPost(view('a'), undefined)).toBe(false)
  })
})
