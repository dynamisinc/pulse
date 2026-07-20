/**
 * features/controller/engine/services/reviewActions.test.ts
 * ---------------------------------------------------------------------------
 * Covers the review actions (engine-review-cockpit/01; ADP-040/041, COR-018,
 * NFR-004, XC-004):
 *  - approve publishes each burst post via the SHIPPED `createPost` as its persona
 *    with `origin: 'engine'` + the approving controller (COR-018), pushes to the
 *    live feed, marks the item Published, and logs `engine.reviewed` (approve);
 *  - edit publishes with the lead text replaced (sanitized by `createPost`) and
 *    logs action `edit` — same `origin: 'engine'` (no `engine-edited`);
 *  - veto marks Vetoed, publishes nothing, logs action `veto`;
 *  - re-roll swaps in a fresh draft + resets the countdown, publishes nothing,
 *    logs action `re-roll`;
 *  - batch approve reports a per-item outcome (published vs skipped).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { listPosts, type Post } from '@/features/social'
import { postStore } from '@/features/social/services/postStore'
import { personaIdForHandle } from '@/features/personas'
import { DraftDisposition, type EngineReviewItem } from '../models/reviewContracts'
import { reviewStore } from './reviewStore'
import { approve, batchApprove, edit, reroll, veto, type ReviewActionContext } from './reviewActions'

const CTX: ReviewActionContext = {
  exerciseId: 'ex-mock-0001',
  timeZone: 'America/New_York',
  scenarioTime: '2033-09-04T14:00:00Z',
  actingHumanId: 'human-controller-01',
}

function itemById(draftId: string): EngineReviewItem {
  const item = reviewStore.getItems().find(i => i.draftId === draftId)
  if (!item) throw new Error(`seed item ${draftId} missing`)
  return item
}

function appendedPosts(): Post[] {
  const baseline = new Set(listPosts().map(p => p.id))
  return postStore.getPosts().filter(p => !baseline.has(p.id))
}

function reviewedEvents() {
  return getEmittedTelemetryEvents().filter(e => e.eventType === 'engine.reviewed')
}

function firstOrThrow<T>(arr: readonly T[]): T {
  const [head] = arr
  if (head === undefined) throw new Error('expected a non-empty array')
  return head
}

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:00Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
})

describe('approve', () => {
  it('publishes the burst as its persona with origin engine + the approving controller', () => {
    const item = itemById('draft-fulco-reassure')
    const published = approve(item, CTX)

    expect(published).toHaveLength(item.postCount)
    const post = firstOrThrow(published)
    expect(post.origin).toBe('engine')
    expect(post.authorPersonaId).toBe(personaIdForHandle('FulcoEM'))
    expect(post.actingHumanId).toBe('human-controller-01')
    expect(post.scenarioTime).toBe('2033-09-04T14:00:00Z')

    // Pushed to the live feed and marked Published.
    expect(appendedPosts().map(p => p.id)).toContain(post.id)
    expect(itemById('draft-fulco-reassure').disposition).toBe(DraftDisposition.Published)
  })

  it('logs engine.reviewed (approve) with storyline + trigger, plus the post event', () => {
    approve(itemById('draft-fulco-reassure'), CTX)

    const reviewed = reviewedEvents()
    expect(reviewed).toHaveLength(1)
    const evt = firstOrThrow(reviewed)
    expect(evt.channel).toBe('system')
    expect(evt.actor.kind).toBe('engine')
    expect(evt.actor.actingHumanId).toBe('human-controller-01')
    expect(evt.origin).toBe('engine')
    expect(evt.payload).toMatchObject({
      action: 'approve',
      storylineId: 'storyline-water-advisory',
      storyline: '#WaterIssues',
    })
    expect(evt.payload?.trigger).toBeTruthy()

    // createPost emitted its own 'post' event too (not double-emitted here).
    expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'post')).toHaveLength(1)
  })
})

describe('edit', () => {
  it('publishes with the edited lead text (origin engine) and logs action edit', () => {
    const item = itemById('draft-fulco-reassure')
    const published = edit(item, 'Boil water in Zones 2-4 until further notice.', CTX)

    const post = firstOrThrow(published)
    expect(post.text).toBe('Boil water in Zones 2-4 until further notice.')
    expect(post.origin).toBe('engine')
    expect(itemById('draft-fulco-reassure').disposition).toBe(DraftDisposition.Published)

    const reviewed = reviewedEvents()
    expect(reviewed).toHaveLength(1)
    expect(firstOrThrow(reviewed).payload?.action).toBe('edit')
  })
})

describe('veto', () => {
  it('marks the burst Vetoed, publishes nothing, and logs action veto', () => {
    veto(itemById('draft-scoop-amplify'), CTX)

    expect(itemById('draft-scoop-amplify').disposition).toBe(DraftDisposition.Vetoed)
    expect(appendedPosts()).toHaveLength(0)
    expect(firstOrThrow(reviewedEvents()).payload?.action).toBe('veto')
  })
})

describe('reroll', () => {
  it('swaps in a fresh draft, resets a Delayed-auto item to counting down, publishes nothing', () => {
    const before = itemById('draft-fulco-reassure').previewText
    reroll(itemById('draft-fulco-reassure'), CTX)

    const after = itemById('draft-fulco-reassure')
    expect(after.previewText).not.toBe(before)
    expect(after.disposition).toBe(DraftDisposition.CountingDown)
    expect(after.countdown).not.toBeNull()
    expect(appendedPosts()).toHaveLength(0)
    expect(firstOrThrow(reviewedEvents()).payload?.action).toBe('re-roll')
  })

  it('resets a Suggest item back to queued (no countdown)', () => {
    reroll(itemById('draft-scoop-amplify'), CTX)
    const after = itemById('draft-scoop-amplify')
    expect(after.disposition).toBe(DraftDisposition.Queued)
    expect(after.countdown).toBeNull()
  })
})

describe('batchApprove', () => {
  it('reports a per-item outcome, skipping already-resolved items', () => {
    veto(itemById('draft-scoop-amplify'), CTX)
    const targets = reviewStore.getItems()
    const outcomes = batchApprove(targets, CTX)

    const byId = new Map(outcomes.map(o => [o.draftId, o.outcome]))
    expect(byId.get('draft-scoop-amplify')).toBe('skipped') // already vetoed
    expect(byId.get('draft-fulco-reassure')).toBe('published')
    expect(byId.get('draft-mvega-anxious')).toBe('published') // a held item is still approvable
  })
})
