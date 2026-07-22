/**
 * features/controller/engine/services/liveReviewActions.test.ts
 * ---------------------------------------------------------------------------
 * Covers the LIVE review actions (engine-review-cockpit, story 02 mock→live
 * flip; COR-001, COR-018):
 *  - approve/edit/veto POST to their respective endpoints with the acting
 *    human + time zone (no client `exerciseId`, COR-001) and optimistically
 *    remove the item from `liveReviewStore`'s snapshot;
 *  - re-roll POSTs but does NOT optimistically mutate the snapshot;
 *  - batchApprove POSTs once with every unresolved draft id, optimistically
 *    removes each, and returns the same synchronous per-item outcome shape
 *    (`published` vs `skipped`) the mock produces — skipping items already
 *    Published/Vetoed without re-sending them;
 *  - a rejected POST is swallowed (never an unhandled rejection — the CI
 *    teardown-race hazard), leaving reconciliation to the next
 *    `ReviewItemChanged` push / reconnect resync.
 *
 * `api.post` is mocked (`vi.mock('@/core/services/api')`, hoisted above
 * imports by Vitest) so no real network call is made.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HubConnectionState } from '@/core/realtime/connection'
import type { RealtimeConnection } from '@/core/realtime/connection'
import {
  AutonomyLevel,
  DraftDisposition,
  EngineReviewItem,
} from '../models/reviewContracts'
import type { ReviewActionContext } from './reviewActions'
import { liveReviewStore } from './liveReviewStore'
import { approve, batchApprove, edit, reroll, veto } from './liveReviewActions'

const postMock = vi.fn()
const getMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
  },
}))

class FakeConnection implements RealtimeConnection {
  state: HubConnectionState = HubConnectionState.Disconnected
  private readonly stateListeners = new Set<(state: HubConnectionState) => void>()

  subscribe(): () => void {
    return () => {}
  }

  onStateChange(listener: (state: HubConnectionState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  start(): Promise<void> {
    this.state = HubConnectionState.Connected
    return Promise.resolve()
  }
}

/** The wire shape matching `makeItem()`'s default fields, for seeding the live store via GET. */
function wireItemFor(draftId: string) {
  return {
    exerciseId: 'ex-live-0001',
    storylineId: 'storyline-live',
    draftId,
    routedAtLevel: 'suggest',
    disposition: 'queued',
    countdown: null,
    posts: [{ personaHandle: 'FulcoEM', text: 'draft', sentiment: 0, hashtags: [] }],
    storylineTag: '#Tag',
    storylineBrief: 'brief',
    actionLabel: 'reply → @someone',
  }
}

const CTX: ReviewActionContext = {
  exerciseId: 'ex-live-0001',
  timeZone: 'America/New_York',
  scenarioTime: '2033-09-04T14:00:00Z',
  actingHumanId: 'human-controller-01',
}

function makeItem(
  overrides: Partial<{ draftId: string; disposition: DraftDisposition }> = {},
): EngineReviewItem {
  return new EngineReviewItem({
    exerciseId: 'ex-live-0001',
    storylineId: 'storyline-live',
    draftId: overrides.draftId ?? 'draft-live-1',
    routedAtLevel: AutonomyLevel.Suggest,
    disposition: overrides.disposition ?? DraftDisposition.Queued,
    countdown: null,
    posts: [{ personaHandle: 'FulcoEM', text: 'draft', sentiment: 0, hashtags: [] }],
    storylineTag: '#Tag',
    storylineBrief: 'brief',
    actionLabel: 'reply → @someone',
  })
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  postMock.mockReset()
  postMock.mockResolvedValue({ data: {} })
  getMock.mockReset()
  getMock.mockResolvedValue({ data: [] })
  liveReviewStore.resetForTests()
})

afterEach(() => {
  liveReviewStore.resetForTests()
})

describe('liveReviewActions — single-item actions', () => {
  it('approve POSTs the acting human + time zone (no client exerciseId)', () => {
    const item = makeItem()
    approve(item, CTX)

    expect(postMock).toHaveBeenCalledWith(
      '/engine/review/draft-live-1/approve',
      { actingHumanId: 'human-controller-01', timeZone: 'America/New_York' },
    )
  })

  it('optimistically removes the item from liveReviewStore right away (does not wait on the round trip)', async () => {
    getMock.mockResolvedValue({ data: [wireItemFor('draft-live-optimistic')] })
    liveReviewStore.ensureStarted(new FakeConnection())
    await Promise.resolve()
    await Promise.resolve()
    expect(liveReviewStore.getItems().map(i => i.draftId)).toContain('draft-live-optimistic')

    approve(makeItem({ draftId: 'draft-live-optimistic' }), CTX)

    expect(liveReviewStore.getItems().map(i => i.draftId)).not.toContain('draft-live-optimistic')
  })

  it('veto POSTs to the veto endpoint', () => {
    const item = makeItem({ draftId: 'draft-live-2' })
    veto(item, CTX)

    expect(postMock).toHaveBeenCalledWith(
      '/engine/review/draft-live-2/veto',
      { actingHumanId: 'human-controller-01', timeZone: 'America/New_York' },
    )
  })

  it('edit POSTs the new text alongside the common action fields', () => {
    const item = makeItem({ draftId: 'draft-live-3' })
    edit(item, 'Edited text.', CTX)

    expect(postMock).toHaveBeenCalledWith(
      '/engine/review/draft-live-3/edit',
      { actingHumanId: 'human-controller-01', timeZone: 'America/New_York', text: 'Edited text.' },
    )
  })

  it('re-roll POSTs to the re-roll endpoint', () => {
    const item = makeItem({ draftId: 'draft-live-4' })
    reroll(item, CTX)

    expect(postMock).toHaveBeenCalledWith(
      '/engine/review/draft-live-4/re-roll',
      { actingHumanId: 'human-controller-01', timeZone: 'America/New_York' },
    )
  })

  it('swallows a rejected POST rather than throwing or leaving an unhandled rejection', async () => {
    postMock.mockRejectedValue(new Error('network down'))
    const item = makeItem({ draftId: 'draft-live-5' })

    expect(() => approve(item, CTX)).not.toThrow()
    await flushMicrotasks()
  })
})

describe('liveReviewActions — batchApprove', () => {
  it('POSTs once with every unresolved draft id and reports a per-item outcome', () => {
    const queued = makeItem({ draftId: 'draft-a', disposition: DraftDisposition.Queued })
    const held = makeItem({ draftId: 'draft-b', disposition: DraftDisposition.Held })
    const alreadyPublished = makeItem({ draftId: 'draft-c', disposition: DraftDisposition.Published })

    const outcomes = batchApprove([queued, held, alreadyPublished], CTX)

    expect(postMock).toHaveBeenCalledTimes(1)
    expect(postMock).toHaveBeenCalledWith('/engine/review/batch-approve', {
      actingHumanId: 'human-controller-01',
      timeZone: 'America/New_York',
      draftIds: ['draft-a', 'draft-b'],
    })
    expect(outcomes).toEqual([
      { draftId: 'draft-a', outcome: 'published' },
      { draftId: 'draft-b', outcome: 'published' },
      { draftId: 'draft-c', outcome: 'skipped' },
    ])
  })

  it('does not POST when every item is already resolved', () => {
    const alreadyVetoed = makeItem({ draftId: 'draft-d', disposition: DraftDisposition.Vetoed })

    const outcomes = batchApprove([alreadyVetoed], CTX)

    expect(postMock).not.toHaveBeenCalled()
    expect(outcomes).toEqual([{ draftId: 'draft-d', outcome: 'skipped' }])
  })
})
