/**
 * features/controller/runSheet/runSheetModel.ts
 * ---------------------------------------------------------------------------
 * The run sheet's in-memory MODEL and every pure operation on it (demo-polish C3,
 * story 19). STAFF world — no React, no storage, no network: given a
 * `RunSheetData`, each function returns the next one. `runSheetStore.ts` wraps
 * these with persistence + subscriptions; `RunSheetPanel` never edits data any
 * other way, so every rule below is unit-tested without a DOM.
 *
 * TWO LAYERS OF STATE, DELIBERATELY SEPARATE
 *   definition  `name` + `beats` — exactly what the `pulse.runsheet.v1` file holds
 *               (`runSheetSchema.ts`). Authored, exported, imported.
 *   runtime     per-beat status — `pending | fired | skipped | failed`, plus the
 *               `firedPostId` / fired scenario time, a failure record, and an
 *               in-flight marker. Lives in browser storage ONLY and is never in
 *               the file. A beat without a runtime record is `pending`.
 *
 * WHY THE FAILURE RECORD HAS A KIND (the double-post rule)
 * `POST /api/posts` is not idempotent yet (F4 / #455): retrying a request whose
 * outcome is unknown can post TWICE. So a failed fire is one of
 *   `failed`       the server definitely refused it (a 4xx), or we never sent it —
 *                  nothing was created, Retry is safe;
 *   `unconfirmed`  the outcome is unknown (no response, a 5xx / 504, an unreadable
 *                  2xx, or the page died mid-request) — the post MAY be live. The
 *                  UI says so and asks the controller to check the live world; it
 *                  never retries blindly and `Fire next` never touches it.
 * Both are persisted as `status: 'failed'` (the four statuses of the AC); the
 * `kind` only changes the label, the icon, and what the button offers.
 *
 * ONE FIRE AT A TIME. A sheet allows a single in-flight fire. Besides making a
 * double-press harmless, it keeps replies ordered behind their parents and means
 * an "unconfirmed" outcome is always about exactly one beat.
 */

import {
  RUN_SHEET_LIMITS,
  normalizeBeat,
  type RunSheetBeat,
  type RunSheetDefinition,
} from './runSheetSchema'

/** The four statuses a beat can have (AC). `unconfirmed` is a kind of `failed`, see above. */
export type BeatStatus = 'pending' | 'fired' | 'skipped' | 'failed'

/** Whether a failure is known-not-created (`failed`) or may be live (`unconfirmed`). */
export type FailureKind = 'failed' | 'unconfirmed'

/** Why a fire failed, in controller-facing words. */
export interface BeatFailure {
  readonly kind: FailureKind
  readonly message: string
}

/** One beat's status record (browser storage only; never exported). */
export interface BeatRuntime {
  readonly status: BeatStatus
  /** True from the moment a fire starts until its outcome is recorded. */
  readonly inFlight?: boolean
  /**
   * The token of the fire attempt that set `inFlight`. Only THAT attempt may record its
   * outcome (`completeFire` / `failFire`): a late result must never land on a sheet that was
   * replaced, reconciled or re-fired meanwhile and show a beat that never went out as Fired.
   */
  readonly attemptId?: string
  /** The id of the post this beat created (`status: 'fired'`). */
  readonly firedPostId?: string
  /** SCENARIO instant the post was fired at (COR-053). */
  readonly firedAtScenario?: string
  /** The last failure (`status: 'failed'`); kept while skipped so Undo skip restores it. */
  readonly failure?: BeatFailure
  /** What a skipped beat was before it was skipped, so Undo skip restores it exactly. */
  readonly skippedFrom?: 'pending' | 'failed'
}

/** Everything the app holds for one exercise's sheet. */
export interface RunSheetData extends RunSheetDefinition {
  readonly runtime: Readonly<Record<string, BeatRuntime>>
}

/** The record for `beatId` (a missing record means `pending`). */
export function runtimeOf(data: RunSheetData, beatId: string): BeatRuntime {
  return data.runtime[beatId] ?? { status: 'pending' }
}

/** A new, empty sheet. */
export function emptySheet(name = 'Run sheet'): RunSheetData {
  return { name, beats: [], runtime: {} }
}

/** Beats sorted by `order` with `order` rewritten as 1..n (contiguous, unique). */
function renumber(beats: readonly RunSheetBeat[]): RunSheetBeat[] {
  return [...beats]
    .sort((a, b) => a.order - b.order)
    .map((beat, index) => (beat.order === index + 1 ? beat : { ...beat, order: index + 1 }))
}

function withBeats(data: RunSheetData, beats: readonly RunSheetBeat[]): RunSheetData {
  return { ...data, beats: renumber(beats) }
}

function withRuntime(data: RunSheetData, beatId: string, record: BeatRuntime): RunSheetData {
  return { ...data, runtime: { ...data.runtime, [beatId]: record } }
}

function withoutRuntime(data: RunSheetData, beatId: string): RunSheetData {
  const { [beatId]: _removed, ...rest } = data.runtime
  return { ...data, runtime: rest }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** True while any beat of the sheet is mid-fire. */
export function isFiring(data: RunSheetData): boolean {
  return Object.values(data.runtime).some(record => record.inFlight === true)
}

/** The first `pending` beat (by order) that is not mid-fire - what "Fire next" targets. */
export function firstPendingBeat(data: RunSheetData): RunSheetBeat | undefined {
  return data.beats.find(beat => {
    const record = runtimeOf(data, beat.id)
    return record.status === 'pending' && record.inFlight !== true
  })
}

/** Beats whose `replyTo.beatId` is `beatId`. */
export function repliesTo(data: RunSheetData, beatId: string): RunSheetBeat[] {
  return data.beats.filter(beat => beat.replyTo !== undefined && 'beatId' in beat.replyTo
    && beat.replyTo.beatId === beatId)
}

/** Every beat that (transitively) replies to `beatId` - these cannot become its parent. */
export function descendantIds(data: RunSheetData, beatId: string): Set<string> {
  const found = new Set<string>()
  const queue = [beatId]
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) break
    for (const child of repliesTo(data, current)) {
      if (!found.has(child.id)) {
        found.add(child.id)
        queue.push(child.id)
      }
    }
  }
  return found
}

/** Counts shown in the panel header. `unconfirmed` is counted inside `failed`. */
export interface RunSheetCounts {
  readonly total: number
  readonly pending: number
  readonly fired: number
  readonly skipped: number
  readonly failed: number
  readonly unconfirmed: number
}

export function countStatuses(data: RunSheetData): RunSheetCounts {
  let pending = 0
  let fired = 0
  let skipped = 0
  let failed = 0
  let unconfirmed = 0
  for (const beat of data.beats) {
    const record = runtimeOf(data, beat.id)
    if (record.status === 'fired') fired += 1
    else if (record.status === 'skipped') skipped += 1
    else if (record.status === 'failed') {
      if (record.failure?.kind === 'unconfirmed') unconfirmed += 1
      else failed += 1
    } else pending += 1
  }
  return { total: data.beats.length, pending, fired, skipped, failed, unconfirmed }
}

// ---------------------------------------------------------------------------
// Authoring operations
// ---------------------------------------------------------------------------

/** What the editor hands over to create or replace a beat: a beat without its identity. */
export type BeatContent = Omit<RunSheetBeat, 'id' | 'order'>

/** The first free `beat-N` id (N counting up from the current beat count + 1). */
export function nextBeatId(data: RunSheetData): string {
  const taken = new Set(data.beats.map(beat => beat.id))
  let n = data.beats.length + 1
  while (taken.has(`beat-${n}`)) n += 1
  return `beat-${n}`
}

/** True when another beat can still be added. */
export function canAddBeat(data: RunSheetData): boolean {
  return data.beats.length < RUN_SHEET_LIMITS.beatsMax
}

/**
 * Appends a new beat at the end. Returns the next data and the new beat's id (no id, and the
 * data untouched, when the sheet is already at the 200-beat limit).
 */
export function addBeat(
  data: RunSheetData,
  content: BeatContent,
): { readonly data: RunSheetData; readonly beatId?: string } {
  if (!canAddBeat(data)) return { data }
  const beatId = nextBeatId(data)
  // After the largest existing order, NOT `length + 1`: an imported sheet may use orders
  // 10, 20, 30, and a new beat must go at the END (Fire next would fire it first otherwise).
  const lastOrder = data.beats.reduce((max, beat) => Math.max(max, beat.order), 0)
  const beat = normalizeBeat({ ...content, id: beatId, order: lastOrder + 1 })
  return { data: withBeats(data, [...data.beats, beat]), beatId }
}

/** Replaces a beat's content, keeping its id and position. Its status is left alone. */
export function updateBeat(data: RunSheetData, beatId: string, content: BeatContent): RunSheetData {
  const existing = data.beats.find(beat => beat.id === beatId)
  if (existing === undefined) return data
  const next = normalizeBeat({ ...content, id: existing.id, order: existing.order })
  return withBeats(data, data.beats.map(beat => (beat.id === beatId ? next : beat)))
}

/**
 * Copies a beat to sit right after it, as a fresh `pending` beat with a new id and
 * "(copy)" appended to the title. A reply stays a reply to the same parent.
 */
export function duplicateBeat(
  data: RunSheetData,
  beatId: string,
): { readonly data: RunSheetData; readonly beatId?: string } {
  const source = data.beats.find(beat => beat.id === beatId)
  if (source === undefined || !canAddBeat(data)) return { data }
  const copyId = nextBeatId(data)
  const suffix = ' (copy)'
  const title = `${source.title.slice(0, RUN_SHEET_LIMITS.titleMax - suffix.length)}${suffix}`
  const copy = normalizeBeat({ ...source, id: copyId, title, order: source.order + 0.5 })
  return { data: withBeats(data, [...data.beats, copy]), beatId: copyId }
}

/** Why a beat cannot be deleted (or `undefined` when it can). */
export function deleteBlockReason(data: RunSheetData, beatId: string): string | undefined {
  const record = runtimeOf(data, beatId)
  if (record.inFlight === true) return 'This beat is firing right now.'
  const replies = repliesTo(data, beatId)
  if (replies.length > 0 && !(record.status === 'fired' && record.firedPostId !== undefined)) {
    const names = replies.map(reply => `"${reply.title}"`).join(', ')
    return `${replies.length === 1 ? 'A beat replies' : `${replies.length} beats reply`} to this one `
      + `(${names}). Delete them or change their "reply to" first.`
  }
  return undefined
}

/**
 * Deletes a beat and its status. Reply beats that pointed at a FIRED beat are
 * re-pointed at its live post (`replyTo.postId`), so they keep working; a beat with
 * un-fired reply beats cannot be deleted (see {@link deleteBlockReason}).
 */
export function deleteBeat(data: RunSheetData, beatId: string): RunSheetData {
  if (deleteBlockReason(data, beatId) !== undefined) return data
  const record = runtimeOf(data, beatId)
  const postId = record.firedPostId
  const beats = data.beats
    .filter(beat => beat.id !== beatId)
    .map(beat => {
      const replyTo = beat.replyTo
      if (replyTo === undefined || !('beatId' in replyTo) || replyTo.beatId !== beatId) return beat
      return postId === undefined ? beat : { ...beat, replyTo: { postId } }
    })
  return withBeats(withoutRuntime(data, beatId), beats)
}

/** Moves a beat one place up (`-1`) or down (`1`) in the order. */
export function moveBeat(data: RunSheetData, beatId: string, direction: -1 | 1): RunSheetData {
  const index = data.beats.findIndex(beat => beat.id === beatId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= data.beats.length) return data
  const beats = [...data.beats]
  const [moved] = beats.splice(index, 1)
  if (moved === undefined) return data
  beats.splice(target, 0, moved)
  return { ...data, beats: beats.map((beat, position) => ({ ...beat, order: position + 1 })) }
}

/** Re-orders the beats by intended scenario minute (stable: ties keep their order). */
export function sortBeatsByMinute(data: RunSheetData): RunSheetData {
  const sorted = [...data.beats]
    .map((beat, position) => ({ beat, position }))
    .sort((a, b) => a.beat.scenarioMinute - b.beat.scenarioMinute || a.position - b.position)
    .map(entry => entry.beat)
  return { ...data, beats: sorted.map((beat, position) => ({ ...beat, order: position + 1 })) }
}

/** Renames the sheet (the caller validates the name). */
export function renameSheet(data: RunSheetData, name: string): RunSheetData {
  return { ...data, name }
}

/** Replaces the whole definition (an import). Every beat starts `pending`. */
export function replaceDefinition(definition: RunSheetDefinition): RunSheetData {
  return {
    name: definition.name,
    beats: renumberKeepingOrder(definition.beats),
    runtime: {},
  }
}

/** Imported beats keep their `order` values (already unique); only the array is sorted. */
function renumberKeepingOrder(beats: readonly RunSheetBeat[]): RunSheetBeat[] {
  return [...beats].sort((a, b) => a.order - b.order).map(normalizeBeat)
}

// ---------------------------------------------------------------------------
// Status operations
// ---------------------------------------------------------------------------

/** Result of trying to start a fire. */
export type BeginFireResult =
  | { readonly ok: true; readonly data: RunSheetData }
  | {
    readonly ok: false
    readonly reason: string
    /** The beat's outcome is unknown (it may be live): the caller must confirm and retry. */
    readonly needsConfirmation?: true
  }

/** Options for {@link beginFire}. */
export interface BeginFireOptions {
  /** This attempt's token, stamped on the in-flight marker (see `BeatRuntime.attemptId`). */
  readonly attemptId: string
  /** The controller has confirmed re-firing a beat whose outcome is unknown. */
  readonly confirmedUnconfirmed?: boolean
}

/**
 * Marks a beat in flight. Refused when ANY beat is already in flight (one at a time),
 * when the beat does not exist, when it is fired or skipped, or - unless the controller has
 * confirmed - when its last outcome is `unconfirmed` (the post may be live). The
 * confirmation gate lives HERE, on the data the store has just re-read, so a stale tab
 * cannot skip past a warning another tab recorded.
 */
export function beginFire(
  data: RunSheetData,
  beatId: string,
  options: BeginFireOptions,
): BeginFireResult {
  if (isFiring(data)) {
    return { ok: false, reason: 'Another beat is still firing. Wait for its result.' }
  }
  if (!data.beats.some(beat => beat.id === beatId)) {
    return { ok: false, reason: 'That beat no longer exists.' }
  }
  const record = runtimeOf(data, beatId)
  if (record.status === 'fired') return { ok: false, reason: 'That beat has already been fired.' }
  if (record.status === 'skipped') {
    return { ok: false, reason: 'That beat is skipped. Undo the skip to fire it.' }
  }
  if (record.failure?.kind === 'unconfirmed' && options.confirmedUnconfirmed !== true) {
    return {
      ok: false,
      needsConfirmation: true,
      reason: 'This beat may already be live. Check the Live world, then confirm to fire again.',
    }
  }
  return {
    ok: true,
    data: withRuntime(data, beatId, { ...record, inFlight: true, attemptId: options.attemptId }),
  }
}

/** True when `record` is the in-flight marker that attempt `attemptId` set. */
function isAttempt(record: BeatRuntime, attemptId: string): boolean {
  return record.inFlight === true && record.attemptId === attemptId
}

/**
 * Records a confirmed success: `fired` with the post id and the scenario instant. Applies
 * ONLY while the beat still carries this attempt's in-flight marker; otherwise (the sheet
 * was replaced, the beat was reconciled by another tab, ...) it returns `data` unchanged.
 */
export function completeFire(
  data: RunSheetData,
  beatId: string,
  attemptId: string,
  result: { readonly postId: string; readonly scenarioTime: string },
): RunSheetData {
  if (!data.beats.some(beat => beat.id === beatId)) return data
  if (!isAttempt(runtimeOf(data, beatId), attemptId)) return data
  return withRuntime(data, beatId, {
    status: 'fired',
    firedPostId: result.postId,
    firedAtScenario: result.scenarioTime,
  })
}

/** Records a failed fire (`failed` or `unconfirmed`); same attempt rule as {@link completeFire}. */
export function failFire(
  data: RunSheetData,
  beatId: string,
  attemptId: string,
  failure: BeatFailure,
): RunSheetData {
  if (!data.beats.some(beat => beat.id === beatId)) return data
  if (!isAttempt(runtimeOf(data, beatId), attemptId)) return data
  return withRuntime(data, beatId, { status: 'failed', failure })
}

/** Why the sheet cannot be replaced right now (a fire is in flight), or `undefined`. */
export function replaceBlockReason(data: RunSheetData): string | undefined {
  return isFiring(data)
    ? 'A beat is firing right now. Wait for its result before replacing the sheet.'
    : undefined
}

/** Skips a `pending` or `failed` beat (undo-able). Anything else is left alone. */
export function skipBeat(data: RunSheetData, beatId: string): RunSheetData {
  const record = runtimeOf(data, beatId)
  if (record.inFlight === true) return data
  if (record.status !== 'pending' && record.status !== 'failed') return data
  return withRuntime(data, beatId, { ...record, status: 'skipped', skippedFrom: record.status })
}

/** Undoes a skip, restoring exactly what the beat was (including an `unconfirmed` warning). */
export function unskipBeat(data: RunSheetData, beatId: string): RunSheetData {
  const record = runtimeOf(data, beatId)
  if (record.status !== 'skipped') return data
  const previous = record.skippedFrom ?? 'pending'
  if (previous === 'pending') return withoutRuntime(data, beatId)
  const { skippedFrom: _skippedFrom, ...rest } = record
  return withRuntime(data, beatId, { ...rest, status: 'failed' })
}

/** What a beat that was mid-fire when the page closed is recorded as on the next load. */
export const INTERRUPTED_FIRE_MESSAGE =
  'This beat was firing when the page was closed or reloaded, so it is unknown whether the post '
  + 'went out. Check the live world before firing it again.'

/** Identifies one in-flight marker: the beat plus the attempt token that set it. */
function attemptKey(beatId: string, record: BeatRuntime): string {
  return `${beatId}|${record.attemptId ?? ''}`
}

/** The in-flight markers a stored sheet carries (see {@link reconcileInterruptedFires}). */
export function inFlightAttempts(data: RunSheetData): Set<string> {
  return new Set(
    Object.entries(data.runtime)
      .filter(([, record]) => record.inFlight === true)
      .map(([beatId, record]) => attemptKey(beatId, record)),
  )
}

/**
 * Applied once when a sheet is loaded from storage into a fresh page: a beat still
 * marked in flight cannot have a live request behind it any more, and its outcome is
 * unknown, so it becomes `unconfirmed` - never silently `pending`. `only` limits this to
 * the markers that were already orphaned at load (a marker a LIVE second tab sets later, a
 * different attempt, is its own business and is left alone).
 */
export function reconcileInterruptedFires(
  data: RunSheetData,
  only?: ReadonlySet<string>,
): RunSheetData {
  let next = data
  for (const [beatId, record] of Object.entries(data.runtime)) {
    if (record.inFlight !== true) continue
    if (only !== undefined && !only.has(attemptKey(beatId, record))) continue
    next = withRuntime(next, beatId, {
      status: 'failed',
      failure: { kind: 'unconfirmed', message: INTERRUPTED_FIRE_MESSAGE },
    })
  }
  return next
}
