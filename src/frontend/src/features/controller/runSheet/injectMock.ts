/**
 * features/controller/runSheet/injectMock.ts
 * ---------------------------------------------------------------------------
 * The in-memory MOCK of the server-side inject queue (inject-queue story 07 "Mock
 * parity"; the real thing is story 06). STAFF world, no UI. It implements the same
 * `InjectService` interface as the live axios service and behaves like story 06's
 * server so `npm run dev` and every test work without the backend:
 *
 *   - STATE MACHINE (story 06):
 *       fire     pending -> fired (post) | firing (burst) | failed
 *       hold     pending -> held, firing -> held (suspends the rest of a burst)
 *       release  held -> pending, or -> firing for a burst that already started
 *       skip     pending|held -> skipped (a part-fired burst's remainder is skipped)
 *       unskip   skipped -> pending, or -> held if anything already fired
 *       retry    failed -> re-fire the failed posts
 *       edit     only while pending / held / failed (else 409)
 *       delete   soft; refused (409) for fired / firing
 *     Any other transition is a 409 `InjectConflictError` carrying the CURRENT
 *     item (`extensions.item` on the wire) so the console refreshes the row.
 *   - VERSIONS (IQ-9): every state change bumps the item's integer `version`; a
 *     stale `version` on edit/delete is a 409. Firing "claims" the item, so two
 *     controllers pressing Fire at once publish ONE post and the loser gets a 409.
 *   - BURST PACING (IQ-4): the first post goes at release; the rest are spread
 *     across the window with jitter — increasing offsets, never under 3 s apart
 *     (`planBurstOffsets`). A runner tick (`tickMs`, default 1 s; the server's is
 *     5 s) fires AT MOST ONE child per burst per tick, and when a child fires late
 *     the remainder SHIFTS by the lateness — overdue posts never dump together.
 *     That one rule covers pause, freeze, a held burst and a restart alike. The
 *     runner uses `setInterval`/`Date.now()`, so a test drives it with fake timers.
 *   - PAUSE TIERS (IQ-5): `injects` suspends bursts but manual fire still works;
 *     `freeze` makes fire/retry a 409 ("The world is frozen") and suspends bursts;
 *     `engine` has no effect. Set it with `setPauseTier` (the queue read reports it
 *     as `pauseTier`, exactly like the server).
 *   - STATUS CODES mirror story 06 (`InjectQueueService` / `InjectTransitions` /
 *     `InjectItemValidator`): 400 = the write is invalid (shape, ranges, the burst-window rule,
 *     unknown / foreign / repeated ids, bad reply references); 409 = the item's current state
 *     refuses it (stale version, not editable, an edit that would change what already fired:
 *     kind after release, or removing / changing a published post); 404 = unknown item.
 *     The order of checks is the server's. Fire accepts `pending` OR `held`.
 *   - CHILD IDENTITY (contract amendment): on edit a child echoing its `id` keeps its
 *     identity; no `id` = new; an unfired child left out is removed. `replyTo: { sequence }`
 *     points at an EARLIER sibling (works at create) and is stored as that sibling's id.
 *   - PEERS: `as(actorId)` returns the SAME store acting as another controller, so a
 *     test (or a dev with two tabs' worth of imagination) can fire/edit "as someone
 *     else" and watch the console pick it up on its next poll.
 *
 * "Fired" in the mock means the child got a mock post id, a SCENARIO time from the
 * exercise clock (`scenarioNow()`, COR-053) and a wall-clock stamp (staff-only). No
 * post is created anywhere: the mock publishes nothing to any feed.
 *
 * NO `exerciseId` (the mock models one exercise, like the server's scoped view) and
 * NO telemetry (IQ-8: the server is the single `inject_action` emitter).
 */

import { scenarioNow } from '@/core/clock'
import { personaIdForHandle } from '@/features/personas/types'
import { InjectConflictError, InjectNotFoundError, InjectValidationError } from './injectErrors'
import { INJECT_LIMITS, minimumBurstWindow, validateWrite } from './injectRules'
import type { InjectService } from './injectService'
import type {
  InjectAssigneesDto,
  InjectItemDto,
  InjectItemWrite,
  InjectPostDto,
  InjectPostWrite,
  InjectQueueDto,
} from './types'

// ---------------------------------------------------------------------------
// Burst pacing (pure — exported so the pacing rule is unit-tested on its own)
// ---------------------------------------------------------------------------

/** No two burst posts closer than this (IQ-4, SOC-071 burst legibility). */
export const MIN_BURST_GAP_SECONDS = INJECT_LIMITS.minGapSeconds

/** A tiny deterministic PRNG (mulberry32) so jitter is stable across runs and tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Offsets (seconds after release) for `count` posts, the server's algorithm (story 06,
 * `InjectBurstPacing`): the window's SLACK (window minus the mandatory 3 s per gap) is split at
 * `count - 1` sorted uniform cut points, and post `k` is due at `3 * k + cut(k - 1)`. So the first
 * is 0, offsets strictly increase, every gap is 3 s plus a non-negative share of the slack, and
 * the last is due no later than the window. The write validator refuses a window that cannot hold
 * the gaps (`minimumBurstWindow`); if one slips through (a direct call), the 3 s floor still
 * wins and the burst runs longer than the window (legibility over speed).
 */
export function planBurstOffsets(count: number, windowSeconds: number, seed = 1): number[] {
  const offsets: number[] = [0]
  if (count <= 1) return offsets
  const rand = mulberry32(seed)
  const slack = Math.max(0, windowSeconds - minimumBurstWindow(count))
  const cuts = Array.from({ length: count - 1 }, () => Math.floor(rand() * (slack + 1))).sort(
    (a, b) => a - b,
  )
  cuts.forEach((cut, k) => {
    offsets.push((k + 1) * MIN_BURST_GAP_SECONDS + cut)
  })
  return offsets
}

// ---------------------------------------------------------------------------
// Options + controls
// ---------------------------------------------------------------------------

export type MockPauseTier = InjectQueueDto['pauseTier']

export interface InjectMockOptions {
  /** The acting controller's staff id (`InjectAssigneesDto.me`). Default: the mock identity. */
  me?: string
  assignees?: InjectAssigneesDto['assignees']
  /** Initial items (created in order, as `me`). `[]` = an empty sheet. Default: a demo script. */
  seed?: InjectItemWrite[]
  pauseTier?: MockPauseTier
  /** Runner tick, ms. Default 1000. */
  tickMs?: number
  /** Simulated network latency, ms. Default 0 (microtask only — keeps tests deterministic). */
  latencyMs?: number
}

export interface InjectMock extends InjectService {
  /** The acting controller's staff id. */
  readonly me: string
  /** Re-initialises the store (clears timers; re-seeds). */
  reset(options?: InjectMockOptions): void
  setPauseTier(tier: MockPauseTier): void
  /** The same store, acting as another controller. */
  as(actorId: string): InjectService
  /** The next publish attempt fails with `message` (exercises the `failed` path). */
  failNextPublish(message?: string): void
  /** Synchronous read of the current queue (no latency) — for assertions. */
  snapshot(): InjectQueueDto
  /** Stops the runner timer (test cleanup). */
  dispose(): void
}

/** The server's readable refusals (story 06), so a detail shown in the console reads the same. */
const FROZEN_MESSAGE = 'The world is frozen. Resume the exercise before firing.'
const STALE_MESSAGE = 'Changed by someone else. Refresh to see the latest version.'

/** Matches `resolveMockControllerIdentity('ex-mock-0001')` so "Mine" works in `npm run dev`. */
export const MOCK_ME = 'human-controller-01'

export const MOCK_ASSIGNEES: InjectAssigneesDto['assignees'] = [
  { id: MOCK_ME, displayName: 'Riley Chen', role: 'controller' },
  { id: 'human-controller-02', displayName: 'Jordan Ames', role: 'controller' },
  { id: 'human-director-01', displayName: 'Dana Whitfield', role: 'director' },
]

const p = (handle: string, text: string): InjectPostWrite => ({
  personaId: personaIdForHandle(handle),
  text,
})

/** A small Fairhaven demo script so `npm run dev` shows a believable run sheet. */
export const MOCK_DEMO_SEED: InjectItemWrite[] = [
  {
    kind: 'post',
    title: 'Boil-water advisory (official)',
    notes: 'Opening beat. Fire on the first cue from the exercise director.',
    plannedMinute: 0,
    assigneeId: MOCK_ME,
    posts: [
      p('FairhavenWater', 'A boil-water advisory is in effect for Fairhaven Eastside until further notice. Boil tap water for 1 minute before drinking. #WaterIssues'),
    ],
  },
  {
    kind: 'post',
    title: 'Resident reports brown tap water',
    plannedMinute: 5,
    assigneeId: 'human-controller-02',
    posts: [
      p('tbrandt41', 'Anyone else getting brown water from the tap on the Eastside? Did not drink it but the kids are asking. #WaterIssues'),
    ],
  },
  {
    kind: 'burst',
    title: 'Pile-on: "they are covering it up"',
    notes: 'Misinformation burst. Release only after the advisory has been up for a few minutes.',
    plannedMinute: 15,
    assigneeId: MOCK_ME,
    burstWindowSeconds: 90,
    posts: [
      p('TheScoopHQ', 'Hearing the water is "fine" and the advisory is just cover. Who are they protecting? #WaterIssues'),
      p('kwardFH', 'My cousin works at the plant and says it is way worse than they are telling us.'),
      p('FairhavenWaterUpd', 'UPDATE: tap water is safe to drink again. Advisory lifted. #WaterIssues'),
      p('dreyes_fh', 'Wait, is it safe or not? Two different accounts saying two different things.'),
      p('tbrandt41', 'Not drinking anything from the tap until someone official explains this.'),
      p('mvega_fh', 'Please stick to the official Fairhaven Water Utility account for updates, everyone.'),
    ],
  },
  {
    kind: 'post',
    title: 'County EM reassurance (hold for director)',
    plannedMinute: 20,
    assigneeId: 'human-controller-02',
    posts: [
      p('FulcoEM', 'Fulton County EM is coordinating with Fairhaven Water. Bottled water distribution points will be announced shortly.'),
    ],
  },
]

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

interface BurstRuntime {
  /** Wall-clock ms the burst was released (first fire). */
  releasedAtMs: number
  /** Accumulated lateness: every child's due time is `released + offset + shift`. */
  shiftMs: number
  /** Who pressed Fire — the acting human recorded on every child. */
  actorId: string
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function wallIso(): string {
  return new Date(Date.now()).toISOString()
}

export function createInjectMock(initial: InjectMockOptions = {}): InjectMock {
  let me = MOCK_ME
  let assignees = MOCK_ASSIGNEES
  let tickMs = 1000
  let latencyMs = 0
  let pauseTier: MockPauseTier = 'running'
  let items: InjectItemDto[] = []
  let runtime = new Map<string, BurstRuntime>()
  let idCounter = 0
  let publishedCounter = 0
  let nextFailure: string | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  const nextId = (prefix: string): string => `${prefix}-${++idCounter}`

  // ----- helpers ----------------------------------------------------------

  const nameOf = (id: string | null | undefined): string | undefined =>
    id ? assignees.find(a => a.id === id)?.displayName : undefined

  const touch = (item: InjectItemDto): void => {
    item.version += 1
    item.updatedAt = wallIso()
  }

  const findItem = (id: string): InjectItemDto => {
    const found = items.find(i => i.id === id)
    if (!found) throw new InjectNotFoundError('Inject not found')
    return found
  }

  const view = (item: InjectItemDto): InjectItemDto => {
    const dto = clone(item)
    const name = nameOf(dto.assigneeId)
    if (name) dto.assigneeName = name
    else delete dto.assigneeName
    return dto
  }

  const renumber = (): void => {
    items.sort((a, b) => a.order - b.order).forEach((item, index) => {
      item.order = index + 1
    })
  }

  const queueView = (): InjectQueueDto => ({ items: items.map(view), pauseTier })

  const conflict = (message: string, item: InjectItemDto): InjectConflictError =>
    new InjectConflictError(message, view(item))

  const recount = (item: InjectItemDto): void => {
    item.firedCount = item.posts.filter(post => post.status === 'fired').length
    item.total = item.posts.length
  }

  /** Once no child is pending: failed if any failed, skipped if nothing fired, else fired. */
  const settle = (item: InjectItemDto): void => {
    recount(item)
    if (item.posts.some(post => post.status === 'pending')) return
    const failed = item.posts.find(post => post.status === 'failed')
    if (failed) {
      item.status = 'failed'
      item.error = failed.error ?? 'A post failed to publish'
    } else {
      item.status = item.firedCount > 0 ? 'fired' : 'skipped'
      delete item.error
    }
    runtime.delete(item.id)
  }

  const findPost = (
    injectPostId: string,
  ): { item: InjectItemDto; post: InjectPostDto } | undefined => {
    for (const item of items) {
      const post = item.posts.find(candidate => candidate.id === injectPostId)
      if (post) return { item, post }
    }
    return undefined
  }

  type Publish = 'fired' | 'failed' | 'waiting'

  /** The in-process publish (stands in for `PostIngestService.IngestAsync`). */
  const publish = (item: InjectItemDto, post: InjectPostDto, actorId: string): Publish => {
    const reply = post.replyTo
    if (reply && 'injectPostId' in reply) {
      const parent = findPost(reply.injectPostId)
      if (!parent) {
        post.status = 'failed'
        post.error = 'The post this replies to no longer exists'
        return 'failed'
      }
      if (parent.post.status !== 'fired') {
        // An earlier child of the SAME burst that has not fired yet: wait for it.
        if (parent.item.id === item.id && parent.post.status === 'pending') return 'waiting'
        post.status = 'failed'
        post.error = 'Fire the parent first'
        return 'failed'
      }
    }
    if (nextFailure !== undefined) {
      post.status = 'failed'
      post.error = nextFailure
      nextFailure = undefined
      return 'failed'
    }
    post.status = 'fired'
    post.firedPostId = `post-mock-${++publishedCounter}`
    post.firedScenarioTime = scenarioNow().toISOString()
    post.firedWallClock = wallIso()
    post.firedByHumanId = actorId
    delete post.error
    return 'fired'
  }

  /**
   * Builds an item's children from a write (contract: "Child identity on PUT"). Children are
   * ordered by ARRAY POSITION (`sequence`). A write carrying the `id` of an existing child of
   * THIS item keeps that child's identity (status, fired post, replies pointing at it); one
   * without an `id` is new; an unknown / repeated / foreign `id` is a 400. An unfired child
   * left out is removed. A fired child is immutable ("corrected with takedown"): `doUpdate` has
   * ALREADY refused (409) any edit that removes or changes one, so it is returned as is here.
   * `replyTo: { sequence }` (an EARLIER sibling) resolves to that sibling's id here, so it
   * survives later reorders, and works at CREATE time when no ids exist yet.
   */
  const buildPosts = (
    writes: InjectPostWrite[],
    existing: InjectPostDto[] = [],
  ): InjectPostDto[] => {
    const byId = new Map(existing.map(post => [post.id, post]))
    const claimed = new Set<string>()

    const built = writes.map((write, index) => {
      let old: InjectPostDto | undefined
      if (write.id !== undefined) {
        old = byId.get(write.id)
        if (!old || claimed.has(write.id)) {
          const message = 'That post is not part of this item'
          throw new InjectValidationError(message, { [`posts.${index}.id`]: message })
        }
        claimed.add(write.id)
      }
      if (old && old.status === 'fired') return old
      const post: InjectPostDto = {
        ...clone(write),
        id: old?.id ?? nextId('injp'),
        sequence: index + 1,
        status: old?.status === 'failed' ? 'failed' : 'pending',
      }
      if (old?.status === 'failed') post.error = old.error
      return post
    })

    built.forEach((post, index) => {
      const reply = post.replyTo
      if (post.status === 'fired' || !reply || !('sequence' in reply)) return
      const target = built[reply.sequence - 1]
      if (!target || reply.sequence - 1 >= index) {
        const message = 'Reply to an earlier post in this burst'
        throw new InjectValidationError(message, { [`posts.${index}.replyTo`]: message })
      }
      post.replyTo = { injectPostId: target.id }
    })
    return built
  }

  // ----- the runner -------------------------------------------------------

  const stopTimerIfIdle = (): void => {
    if (timer !== undefined && !items.some(item => item.status === 'firing')) {
      clearInterval(timer)
      timer = undefined
    }
  }

  const tick = (): void => {
    const suspended = pauseTier === 'injects' || pauseTier === 'freeze'
    if (!suspended) {
      const now = Date.now()
      for (const item of items) {
        if (item.status !== 'firing') continue
        const rt = runtime.get(item.id)
        const child = item.posts.find(post => post.status === 'pending')
        if (!rt || !child) {
          settle(item)
          continue
        }
        const due = rt.releasedAtMs + (child.dueOffsetSeconds ?? 0) * 1000 + rt.shiftMs
        if (now < due) continue
        const outcome = publish(item, child, rt.actorId)
        if (outcome === 'waiting') continue
        // Lateness shifts the remainder: nothing overdue ever dumps at once.
        rt.shiftMs += now - due
        touch(item)
        settle(item)
      }
    }
    stopTimerIfIdle()
  }

  const ensureTimer = (): void => {
    if (timer === undefined) timer = setInterval(tick, tickMs)
  }

  // ----- transitions ------------------------------------------------------

  /** (Re)starts firing the pending children from now; returns the resulting status. */
  const release = (item: InjectItemDto, actorId: string): void => {
    const pending = item.posts.filter(post => post.status === 'pending')
    const window = item.burstWindowSeconds ?? 90
    const offsets = planBurstOffsets(pending.length, window, hashString(item.id))
    pending.forEach((post, index) => {
      post.dueOffsetSeconds = offsets[index]
    })
    runtime.set(item.id, { releasedAtMs: Date.now(), shiftMs: 0, actorId })
    item.status = 'firing'
    // The first post goes at release, not on the next tick.
    const first = pending[0]
    if (first) {
      const outcome = publish(item, first, actorId)
      if (outcome === 'waiting') first.status = 'pending'
    }
    settle(item)
    if (item.status === 'firing') ensureTimer()
  }

  const doFire = (id: string, actorId: string): InjectItemDto => {
    const item = findItem(id)
    if (pauseTier === 'freeze') throw conflict(FROZEN_MESSAGE, item)
    // The server fires a `pending` OR a `held` item (a held item is released + fired directly);
    // the console's UI still offers Release for a held row, but the API accepts both.
    if (item.status === 'fired') throw conflict('This item has already been fired.', item)
    if (item.status === 'firing') throw conflict('This item is already firing.', item)
    if (item.status !== 'pending' && item.status !== 'held') {
      throw conflict(`This item is ${item.status} and cannot be fired.`, item)
    }
    // A single post whose reply parent has not fired is refused up front (409).
    const only = item.posts[0]
    if (item.kind === 'post' && only?.replyTo && 'injectPostId' in only.replyTo) {
      const parent = findPost(only.replyTo.injectPostId)
      if (parent && parent.post.status !== 'fired') throw conflict('Fire the parent first', item)
    }
    // Who pressed Fire the FIRST time stays on the item (a re-fired held burst keeps its starter).
    item.firedByHumanId ??= actorId
    if (item.kind === 'post') {
      if (only) publish(item, only, actorId)
      settle(item)
    } else {
      release(item, actorId)
    }
    const first = item.posts.find(post => post.status === 'fired')
    if (first?.firedScenarioTime && !item.firedScenarioTime) {
      item.firedScenarioTime = first.firedScenarioTime
    }
    touch(item)
    return view(item)
  }

  const doHold = (id: string): InjectItemDto => {
    const item = findItem(id)
    if (item.status !== 'pending' && item.status !== 'firing') {
      throw conflict(`This item is ${item.status} and cannot be held.`, item)
    }
    item.status = 'held'
    touch(item)
    return view(item)
  }

  const doRelease = (id: string): InjectItemDto => {
    const item = findItem(id)
    if (item.status !== 'held') throw conflict(`This item is ${item.status} and is not held.`, item)
    const started = runtime.has(item.id) || item.firedCount > 0
    item.status = started ? 'firing' : 'pending'
    if (started) ensureTimer()
    touch(item)
    return view(item)
  }

  const doSkip = (id: string): InjectItemDto => {
    const item = findItem(id)
    if (item.status !== 'pending' && item.status !== 'held') {
      throw conflict(`This item is ${item.status} and cannot be skipped.`, item)
    }
    for (const post of item.posts) if (post.status === 'pending') post.status = 'skipped'
    item.status = 'skipped'
    runtime.delete(item.id)
    recount(item)
    touch(item)
    return view(item)
  }

  const doUnskip = (id: string): InjectItemDto => {
    const item = findItem(id)
    if (item.status !== 'skipped') {
      throw conflict(`This item is ${item.status} and is not skipped.`, item)
    }
    for (const post of item.posts) if (post.status === 'skipped') post.status = 'pending'
    item.status = item.firedCount > 0 ? 'held' : 'pending'
    recount(item)
    touch(item)
    return view(item)
  }

  const doRetry = (id: string, actorId: string): InjectItemDto => {
    const item = findItem(id)
    if (pauseTier === 'freeze') throw conflict(FROZEN_MESSAGE, item)
    if (item.status !== 'failed') {
      throw conflict(`Only a failed item can be retried; this one is ${item.status}.`, item)
    }
    for (const post of item.posts) {
      if (post.status === 'failed') {
        post.status = 'pending'
        delete post.error
      }
    }
    delete item.error
    item.firedByHumanId ??= actorId
    if (item.kind === 'post') {
      const only = item.posts[0]
      if (only) publish(item, only, actorId)
      settle(item)
    } else {
      release(item, actorId)
    }
    touch(item)
    return view(item)
  }

  // ----- create / update / delete / reorder -------------------------------

  /**
   * PHASE 1 (400): shape, ranges and lengths (the shared validator, incl. the burst-window rule),
   * and a child id repeated in one write. Server: `InjectItemValidator.Parse`.
   */
  const parseWrite = (write: InjectItemWrite): void => {
    const errors = validateWrite(write)
    const first = Object.values(errors)[0]
    if (first) throw new InjectValidationError(first, errors)
    const seen = new Set<string>()
    write.posts.forEach((post, index) => {
      if (post.id === undefined) return
      if (seen.has(post.id)) {
        const message = `Post ${index + 1}: the same post appears twice.`
        throw new InjectValidationError(message, { [`posts.${index}.id`]: message })
      }
      seen.add(post.id)
    })
  }

  /**
   * PHASE 2 (400): the ids the write names, against what exists in this exercise — the assignee,
   * each child `id` (an existing child of THIS item; on create there is none, so any id is refused;
   * a foreign or unknown id gets the same message), and each `{ injectPostId }` reply (a sibling
   * echoed EARLIER in the write, or a post of ANOTHER live item). Server: `CheckReferences`.
   */
  const checkReferences = (write: InjectItemWrite, edited?: InjectItemDto): void => {
    const refuse = (field: string, message: string): never => {
      throw new InjectValidationError(message, { [field]: message })
    }
    if (write.assigneeId && !assignees.some(a => a.id === write.assigneeId)) {
      refuse('assigneeId', 'assigneeId does not name a staff member assigned to this exercise.')
    }
    const echoed = write.posts.map(post => post.id)
    write.posts.forEach((post, index) => {
      const label = `Post ${index + 1}`
      if (post.id !== undefined && !edited?.posts.some(child => child.id === post.id)) {
        refuse(`posts.${index}.id`, `${label}: id does not name a post of this item.`)
      }
      const reply = post.replyTo
      if (!reply || !('injectPostId' in reply)) return
      const sibling = echoed.indexOf(reply.injectPostId)
      if (sibling >= 0) {
        if (sibling >= index) {
          refuse(
            `posts.${index}.replyTo`,
            `${label}: replyTo.injectPostId must name an earlier post when it is in the same item.`,
          )
        }
        return
      }
      const target = findPost(reply.injectPostId)
      if (!target || target.item.id === edited?.id) {
        refuse(
          `posts.${index}.replyTo`,
          `${label}: replyTo.injectPostId does not name a scripted post in this exercise.`,
        )
      }
    })
  }

  /** What a write's `replyTo` points at, as ids (a `{ sequence }` becomes its sibling's id). */
  const resolveReply = (
    write: InjectItemWrite,
    index: number,
  ): { inject?: string; post?: string } => {
    const reply = write.posts[index]?.replyTo
    if (!reply) return {}
    if ('postId' in reply) return { post: reply.postId }
    if ('injectPostId' in reply) return { inject: reply.injectPostId }
    return { inject: write.posts[reply.sequence - 1]?.id }
  }

  /**
   * PHASE 3 (409): would this edit rewrite what participants already saw? Once an item has fired
   * (been released) its kind is fixed, and every published child must be echoed back by id with
   * its content unchanged — a published post is corrected with a takedown, never by editing it.
   * Unpublished children may be changed, reordered or removed freely. Server:
   * `InjectTransitions.WhyEditWouldRewriteHistory`.
   */
  const whyEditWouldRewriteHistory = (
    item: InjectItemDto,
    write: InjectItemWrite,
  ): string | undefined => {
    if (item.firedByHumanId !== undefined && write.kind !== item.kind) {
      return "An item's kind cannot change once it has fired."
    }
    const echoed = write.posts.map(post => post.id)
    for (const published of item.posts.filter(post => post.status === 'fired')) {
      const index = echoed.indexOf(published.id)
      if (index < 0) {
        return `Post ${published.sequence} was already published and cannot be removed.`
      }
      const source = write.posts[index]
      const reply = resolveReply(write, index)
      const stored = published.replyTo
      const media = (list?: { mediaId: string; alt: string }[]): string =>
        JSON.stringify((list ?? []).map(m => [m.mediaId, m.alt]))
      const unchanged =
        source?.personaId === published.personaId &&
        source.text === published.text &&
        media(source.media) === media(published.media) &&
        reply.inject === (stored && 'injectPostId' in stored ? stored.injectPostId : undefined) &&
        reply.post === (stored && 'postId' in stored ? stored.postId : undefined) &&
        source.engagementBaseline?.like === published.engagementBaseline?.like &&
        source.engagementBaseline?.repost === published.engagementBaseline?.repost &&
        source.engagementBaseline?.reply === published.engagementBaseline?.reply
      if (!unchanged) return `Post ${index + 1} was already published and cannot be changed.`
    }
    return undefined
  }

  const doCreate = (write: InjectItemWrite, actorId: string): InjectItemDto => {
    parseWrite(write)
    checkReferences(write)
    const posts = buildPosts(write.posts)
    const item: InjectItemDto = {
      id: nextId('inj'),
      kind: write.kind,
      title: write.title.trim(),
      ...(write.notes ? { notes: write.notes } : {}),
      ...(write.plannedMinute !== undefined ? { plannedMinute: write.plannedMinute } : {}),
      assigneeId: write.assigneeId ?? null,
      ...(write.kind === 'burst' ? { burstWindowSeconds: write.burstWindowSeconds ?? 90 } : {}),
      order: items.length + 1,
      status: 'pending',
      posts,
      firedCount: 0,
      total: posts.length,
      version: 1,
      createdByHumanId: actorId,
      updatedAt: wallIso(),
    }
    items.push(item)
    return view(item)
  }

  /**
   * The server's order of checks (`InjectQueueService.UpdateAsync`): unknown item 404 -> invalid
   * write 400 -> stale version 409 -> not editable 409 -> bad references 400 -> would rewrite
   * history 409. (A post "being published right now" cannot be simulated: the mock publishes
   * synchronously, so there is never a claim in flight.)
   */
  const doUpdate = (id: string, write: InjectItemWrite, version: number): InjectItemDto => {
    const item = findItem(id)
    parseWrite(write)
    if (item.version !== version) throw conflict(STALE_MESSAGE, item)
    if (item.status !== 'pending' && item.status !== 'held' && item.status !== 'failed') {
      throw conflict(`This item is ${item.status} and is read-only.`, item)
    }
    checkReferences(write, item)
    const history = whyEditWouldRewriteHistory(item, write)
    if (history) throw conflict(history, item)
    // Build the children BEFORE touching the item, so a refusal changes nothing.
    const posts = buildPosts(write.posts, item.posts)
    item.kind = write.kind
    item.title = write.title.trim()
    if (write.notes) item.notes = write.notes
    else delete item.notes
    if (write.plannedMinute !== undefined) item.plannedMinute = write.plannedMinute
    else delete item.plannedMinute
    item.assigneeId = write.assigneeId ?? null
    if (write.kind === 'burst') item.burstWindowSeconds = write.burstWindowSeconds ?? 90
    else delete item.burstWindowSeconds
    item.posts = posts
    item.posts.forEach((post, index) => {
      post.sequence = index + 1
    })
    recount(item)
    touch(item)
    return view(item)
  }

  /** Deletable: pending, held, skipped or failed (never fired / firing). Stale version first. */
  const doRemove = (id: string, version: number): void => {
    const item = findItem(id)
    if (item.version !== version) throw conflict(STALE_MESSAGE, item)
    if (item.status === 'fired' || item.status === 'firing') {
      throw conflict(`This item is ${item.status} and cannot be deleted.`, item)
    }
    items = items.filter(candidate => candidate.id !== id)
    runtime.delete(id)
    renumber()
  }

  const doReorder = (ids: string[]): InjectQueueDto => {
    const known = new Set(items.map(item => item.id))
    const valid =
      ids.length === items.length &&
      new Set(ids).size === ids.length &&
      ids.every(id => known.has(id))
    if (!valid) {
      throw new InjectValidationError('ids must list every item in the queue exactly once.')
    }
    ids.forEach((id, index) => {
      findItem(id).order = index + 1
    })
    renumber()
    return queueView()
  }

  // ----- service surface --------------------------------------------------

  const delay = async (): Promise<void> => {
    if (latencyMs > 0) await new Promise<void>(resolve => setTimeout(resolve, latencyMs))
    else await Promise.resolve()
  }

  /** Awaits the (simulated) network, then runs `work` synchronously: calls serialise in order. */
  async function via<T>(work: () => T): Promise<T> {
    await delay()
    return work()
  }

  const serviceFor = (actorId: string): InjectService => ({
    list: () => via(queueView),
    assignees: () => via(() => ({ me: actorId, assignees: clone(assignees) })),
    create: body => via(() => doCreate(body, actorId)),
    update: (id, body, version) => via(() => doUpdate(id, body, version)),
    remove: (id, version) => via(() => doRemove(id, version)),
    reorder: ids => via(() => doReorder(ids)),
    fire: id => via(() => doFire(id, actorId)),
    hold: id => via(() => doHold(id)),
    release: id => via(() => doRelease(id)),
    skip: id => via(() => doSkip(id)),
    unskip: id => via(() => doUnskip(id)),
    retry: id => via(() => doRetry(id, actorId)),
  })

  const dispose = (): void => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  const reset = (options: InjectMockOptions = {}): void => {
    dispose()
    me = options.me ?? MOCK_ME
    assignees = options.assignees ?? MOCK_ASSIGNEES
    tickMs = options.tickMs ?? 1000
    latencyMs = options.latencyMs ?? 0
    pauseTier = options.pauseTier ?? 'running'
    items = []
    runtime = new Map()
    idCounter = 0
    publishedCounter = 0
    nextFailure = undefined
    for (const write of options.seed ?? MOCK_DEMO_SEED) doCreate(write, me)
  }

  reset(initial)

  /** The default (own) view of the store: always bound to the CURRENT `me`. */
  const self = (): InjectService => serviceFor(me)

  return {
    get me() {
      return me
    },
    list: () => self().list(),
    assignees: () => self().assignees(),
    create: body => self().create(body),
    update: (id, body, version) => self().update(id, body, version),
    remove: (id, version) => self().remove(id, version),
    reorder: ids => self().reorder(ids),
    fire: id => self().fire(id),
    hold: id => self().hold(id),
    release: id => self().release(id),
    skip: id => self().skip(id),
    unskip: id => self().unskip(id),
    retry: id => self().retry(id),
    reset,
    setPauseTier(tier) {
      pauseTier = tier
    },
    as: serviceFor,
    failNextPublish(message = 'The post could not be published') {
      nextFailure = message
    },
    snapshot: queueView,
    dispose,
  }
}

/** The process-wide mock `getInjectService()` returns under `USE_MOCK_DATA`. */
export const injectMock: InjectMock = createInjectMock()
