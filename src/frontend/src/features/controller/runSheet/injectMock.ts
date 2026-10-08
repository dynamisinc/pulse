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
import { validateWrite } from './injectRules'
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
export const MIN_BURST_GAP_SECONDS = 3

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
 * Offsets (seconds from release) for `count` posts spread over `windowSeconds` with
 * +/-25% jitter: the first is 0, the rest strictly increasing with every gap
 * >= `MIN_BURST_GAP_SECONDS`. When the window is too tight for the count (20 posts
 * in 30 s) the 3-second floor wins and the burst simply runs longer than the window,
 * which is the safe direction (legibility over speed).
 */
export function planBurstOffsets(count: number, windowSeconds: number, seed = 1): number[] {
  const offsets: number[] = [0]
  if (count <= 1) return offsets
  const rand = mulberry32(seed)
  const step = Math.max(MIN_BURST_GAP_SECONDS, windowSeconds / (count - 1))
  // Accumulate in whole milliseconds so no gap ever rounds BELOW the 3 s floor.
  let elapsedMs = 0
  for (let i = 1; i < count; i++) {
    const jitter = 1 + (rand() * 2 - 1) * 0.25
    const gapMs = Math.max(MIN_BURST_GAP_SECONDS * 1000, Math.round(step * jitter * 1000))
    elapsedMs += gapMs
    offsets.push(elapsedMs / 1000)
  }
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
   * left out is removed; a fired one cannot be (400). A fired child is immutable ("corrected
   * with takedown"). `replyTo: { sequence }` (an EARLIER sibling) resolves to that sibling's
   * id here, so it survives later reorders, and works at CREATE time when no ids exist yet.
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

    if (existing.some(post => post.status === 'fired' && !claimed.has(post.id))) {
      throw new InjectValidationError("A fired post can't be removed", {
        posts: "A fired post can't be removed",
      })
    }

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
    if (pauseTier === 'freeze') throw conflict('The world is frozen', item)
    if (item.status === 'fired' || item.status === 'firing') {
      throw conflict('Already fired', item)
    }
    if (item.status !== 'pending') {
      throw conflict(`A ${item.status} item can't be fired`, item)
    }
    // A single post whose reply parent has not fired is refused up front (409).
    const only = item.posts[0]
    if (item.kind === 'post' && only?.replyTo && 'injectPostId' in only.replyTo) {
      const parent = findPost(only.replyTo.injectPostId)
      if (parent && parent.post.status !== 'fired') throw conflict('Fire the parent first', item)
    }
    item.firedByHumanId = actorId
    if (item.kind === 'post') {
      if (only) publish(item, only, actorId)
      settle(item)
    } else {
      release(item, actorId)
    }
    const first = item.posts.find(post => post.status === 'fired')
    if (first?.firedScenarioTime) item.firedScenarioTime = first.firedScenarioTime
    touch(item)
    return view(item)
  }

  const doHold = (id: string): InjectItemDto => {
    const item = findItem(id)
    if (item.status !== 'pending' && item.status !== 'firing') {
      throw conflict(`A ${item.status} item can't be held`, item)
    }
    item.status = 'held'
    touch(item)
    return view(item)
  }

  const doRelease = (id: string): InjectItemDto => {
    const item = findItem(id)
    if (item.status !== 'held') throw conflict(`A ${item.status} item isn't held`, item)
    const started = runtime.has(item.id) || item.firedCount > 0
    item.status = started ? 'firing' : 'pending'
    if (started) ensureTimer()
    touch(item)
    return view(item)
  }

  const doSkip = (id: string): InjectItemDto => {
    const item = findItem(id)
    if (item.status !== 'pending' && item.status !== 'held') {
      throw conflict(`A ${item.status} item can't be skipped`, item)
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
    if (item.status !== 'skipped') throw conflict(`A ${item.status} item isn't skipped`, item)
    for (const post of item.posts) if (post.status === 'skipped') post.status = 'pending'
    item.status = item.firedCount > 0 ? 'held' : 'pending'
    recount(item)
    touch(item)
    return view(item)
  }

  const doRetry = (id: string, actorId: string): InjectItemDto => {
    const item = findItem(id)
    if (pauseTier === 'freeze') throw conflict('The world is frozen', item)
    if (item.status !== 'failed') throw conflict(`A ${item.status} item can't be retried`, item)
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

  const check = (write: InjectItemWrite): void => {
    const errors = validateWrite(write)
    const first = Object.values(errors)[0]
    if (first) throw new InjectValidationError(first, errors)
    if (write.assigneeId && !assignees.some(a => a.id === write.assigneeId)) {
      throw new InjectValidationError('Assignee is not assigned to this exercise', {
        assigneeId: 'Assignee is not assigned to this exercise',
      })
    }
  }

  const doCreate = (write: InjectItemWrite, actorId: string): InjectItemDto => {
    check(write)
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

  const doUpdate = (id: string, write: InjectItemWrite, version: number): InjectItemDto => {
    const item = findItem(id)
    if (item.version !== version) throw conflict('This item was changed by someone else', item)
    if (item.status !== 'pending' && item.status !== 'held' && item.status !== 'failed') {
      throw conflict(`A ${item.status} item can't be edited`, item)
    }
    check(write)
    // Build (and validate) the children BEFORE touching the item: a 400 changes nothing.
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

  const doRemove = (id: string, version: number): void => {
    const item = findItem(id)
    if (item.status === 'fired' || item.status === 'firing') {
      throw conflict(`A ${item.status} item can't be deleted`, item)
    }
    if (item.version !== version) throw conflict('This item was changed by someone else', item)
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
      throw new InjectValidationError('The new order must list every item exactly once')
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
