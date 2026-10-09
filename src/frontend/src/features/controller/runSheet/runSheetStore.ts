/**
 * features/controller/runSheet/runSheetStore.ts
 * ---------------------------------------------------------------------------
 * The reactive, persistent run-sheet STORE (demo-polish C3, story 19). STAFF world.
 * A module singleton, keyed by exercise id, that wraps the pure operations of
 * `runSheetModel.ts` with `localStorage` persistence (`runSheetStorage.ts`) and a
 * `useSyncExternalStore` subscription for React.
 *
 * WHY A MODULE STORE (not component state)
 *  - The console does not remount when the exercise switches (the scope is
 *    re-resolved in place), so a sheet must be selected BY KEY on every render:
 *    `useRunSheetSnapshot(exerciseId)` reads `snapshots.get(exerciseId)`, which can
 *    only ever hold that exercise's sheet - no cross-exercise bleed by construction.
 *  - A fire outlives the component that started it. If the controller scrolls away,
 *    the console re-renders, or the exercise switches mid-request, the outcome must
 *    still be recorded against the right exercise and beat. Every mutating function
 *    here takes the exercise id explicitly; nothing reads "the current exercise".
 *
 * PERSISTENCE RULES
 *  - Write-through on every change. A failed write does NOT roll the change back: the
 *    snapshot keeps it and carries a `storageWarning` the panel shows, and the next
 *    successful write clears it ("storage failure shows a visible warning instead of
 *    silently losing edits").
 *  - Read-modify-write. Each mutation first re-reads the stored sheet (unless the last
 *    write failed, in which case memory is the truth), so two tabs on the same exercise
 *    do not overwrite each other's status with a stale copy - which is what would let
 *    an already-fired beat look `pending` and be fired twice. A `storage` listener also
 *    refreshes this tab when the other one writes.
 *  - Interrupted fires. The first time a sheet is loaded into a page, any beat still
 *    marked in flight is turned into `unconfirmed` (see `reconcileInterruptedFires`):
 *    the request that was behind it died with the previous page.
 *  - An unreadable stored value puts the sheet in an `unreadable` state: nothing is
 *    overwritten until the controller explicitly chooses `startFresh` (which backs the
 *    old text up first).
 *
 * `getRunSheetSnapshot` has no side effects beyond caching (it is called during render);
 * a reconciled sheet is persisted by the next real mutation.
 */

import { useSyncExternalStore } from 'react'
import {
  addBeat,
  beginFire,
  completeFire,
  deleteBeat,
  deleteBlockReason,
  duplicateBeat,
  emptySheet,
  failFire,
  inFlightAttempts,
  moveBeat,
  reconcileInterruptedFires,
  renameSheet,
  replaceBlockReason,
  replaceDefinition,
  skipBeat,
  sortBeatsByMinute,
  unskipBeat,
  updateBeat,
  type BeatContent,
  type BeatFailure,
  type RunSheetData,
} from './runSheetModel'
import type { RunSheetDefinition } from './runSheetSchema'
import {
  backUpUnreadable,
  exerciseIdFromStorageKey,
  parseStoredSheet,
  readStoredSheet,
  removeStoredSheet,
  serializeStoredSheet,
  writeStoredSheet,
} from './runSheetStorage'

/** What the panel renders for one exercise: the data plus how it was loaded/saved. */
export interface RunSheetSnapshot extends RunSheetData {
  /** `unreadable`: the stored value could not be used and nothing has been overwritten. */
  readonly state: 'ready' | 'unreadable'
  /** Set while the browser would not read or save the sheet; cleared by the next good write. */
  readonly storageWarning?: string
  /**
   * Set when a change was REFUSED because storing it would have produced a sheet that reads
   * back as invalid (defence in depth; the editor validates first). Cleared by the next
   * applied change.
   */
  readonly changeRefused?: string
  /** Why the stored value was unreadable (`state: 'unreadable'`). */
  readonly unreadableReason?: string
}

const snapshots = new Map<string, RunSheetSnapshot>()
/** The raw text of an unreadable stored value, kept in memory for the backup on `startFresh`. */
const unreadableRaw = new Map<string, string>()
/** Per exercise: the in-flight markers a stored sheet had when THIS page loaded it. */
const orphanedFires = new Map<string, ReadonlySet<string>>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function snapshotFrom(
  data: RunSheetData,
  extra: Pick<RunSheetSnapshot, 'storageWarning' | 'changeRefused'> = {},
): RunSheetSnapshot {
  return { ...data, state: 'ready', ...extra }
}

/** The data of a snapshot, without the load / save bookkeeping (what the model operates on). */
function dataOf(snapshot: RunSheetSnapshot): RunSheetData {
  return { name: snapshot.name, beats: snapshot.beats, runtime: snapshot.runtime }
}

/**
 * Settles the beats that were in flight when this page first loaded the sheet (their request
 * died with the old page) into `unconfirmed`. Later loads of the same exercise only touch
 * those same beats.
 */
function settleOrphans(exerciseId: string, data: RunSheetData, firstLoad: boolean): RunSheetData {
  if (firstLoad) orphanedFires.set(exerciseId, inFlightAttempts(data))
  const orphans = orphanedFires.get(exerciseId)
  return orphans === undefined || orphans.size === 0
    ? data
    : reconcileInterruptedFires(data, orphans)
}

/** Loads one exercise's sheet from storage. `firstLoad` is true only for a page's first read. */
function loadSnapshot(exerciseId: string, firstLoad: boolean): RunSheetSnapshot {
  const read = readStoredSheet(exerciseId)
  switch (read.kind) {
    case 'ok':
      return snapshotFrom(settleOrphans(exerciseId, read.data, firstLoad))
    case 'empty':
      return snapshotFrom(emptySheet())
    case 'unavailable':
      return snapshotFrom(emptySheet(), { storageWarning: read.message })
    case 'unreadable':
      unreadableRaw.set(exerciseId, read.raw)
      return { ...emptySheet(), state: 'unreadable', unreadableReason: read.message }
  }
}

/** The current snapshot for an exercise (loaded on first use). Stable identity until it changes. */
export function getRunSheetSnapshot(exerciseId: string): RunSheetSnapshot {
  const cached = snapshots.get(exerciseId)
  if (cached !== undefined) return cached
  const loaded = loadSnapshot(exerciseId, true)
  snapshots.set(exerciseId, loaded)
  return loaded
}

function onStorageEvent(event: StorageEvent): void {
  // `key === null` means the whole storage was cleared.
  const exerciseId = exerciseIdFromStorageKey(event.key)
  const affected =
    event.key === null ? [...snapshots.keys()] : exerciseId === undefined ? [] : [exerciseId]
  let changed = false
  for (const id of affected) {
    if (!snapshots.has(id)) continue
    snapshots.set(id, loadSnapshot(id, false))
    changed = true
  }
  if (changed) emit()
}

let storageListening = false

/** Subscribes to any change (any exercise). Starts the cross-tab listener on first use. */
export function subscribeRunSheet(listener: () => void): () => void {
  if (!storageListening && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorageEvent)
    storageListening = true
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The sheet snapshot for `exerciseId`, re-rendering the caller on any change. */
export function useRunSheetSnapshot(exerciseId: string): RunSheetSnapshot {
  return useSyncExternalStore(subscribeRunSheet, () => getRunSheetSnapshot(exerciseId))
}

/** What {@link mutate} did. */
type MutateResult = 'applied' | 'unchanged' | 'refused' | 'blocked'

/** Why a sheet would not read back from storage, or `undefined` when it would. */
function storageProblem(data: RunSheetData): string | undefined {
  const reread = parseStoredSheet(serializeStoredSheet(data))
  if (reread.kind === 'ok') return undefined
  return reread.kind === 'unreadable' ? reread.message : 'it could not be stored'
}

/**
 * Applies `change` to an exercise's data, persists it, and notifies subscribers.
 * `change` returns the same object to mean "nothing to do".
 *
 *  - `blocked`   nothing was written: the stored value is (or has just become) unreadable.
 *                A stored value that does not read back is NEVER overwritten here - only
 *                `startFreshIn`, an explicit choice, replaces it.
 *  - `refused`   nothing was written: the changed sheet would not read back as valid.
 *  - `unchanged` `change` had nothing to do (or its guard said no).
 *  - `applied`   written (or kept in memory with a visible warning if the write failed).
 */
function mutate(exerciseId: string, change: (data: RunSheetData) => RunSheetData): MutateResult {
  const current = getRunSheetSnapshot(exerciseId)
  if (current.state === 'unreadable') return 'blocked'

  // Re-read storage first: another tab may have written since we last looked.
  const stored = readStoredSheet(exerciseId)
  // If our own last write failed, memory is ahead of storage: keep editing in memory (the
  // warning already says so) and still never write over the unreadable value.
  const memoryOnly = stored.kind === 'unreadable' && current.storageWarning !== undefined
  if (stored.kind === 'unreadable' && !memoryOnly) {
    unreadableRaw.set(exerciseId, stored.raw)
    snapshots.set(exerciseId, {
      ...emptySheet(),
      state: 'unreadable',
      unreadableReason: stored.message,
    })
    emit()
    return 'blocked'
  }

  // Pick up that tab's latest status, unless our last write failed (then memory is ahead
  // of storage and must not be rolled back).
  let base: RunSheetData = dataOf(current)
  if (current.storageWarning === undefined && stored.kind === 'ok') {
    base = settleOrphans(exerciseId, stored.data, false)
  }

  const next = change(base)
  if (next === base) {
    // Nothing to change; but if the refresh found newer data, adopt it.
    if (!sameData(base, current)) {
      snapshots.set(exerciseId, snapshotFrom(base))
      emit()
    }
    return 'unchanged'
  }

  const problem = storageProblem(next)
  if (problem !== undefined) {
    snapshots.set(
      exerciseId,
      snapshotFrom(base, {
        changeRefused:
          `That change was not saved because the sheet would no longer be valid (${problem}). `
          + 'Nothing was overwritten.',
      }),
    )
    emit()
    return 'refused'
  }

  if (memoryOnly) {
    snapshots.set(exerciseId, snapshotFrom(next, { storageWarning: current.storageWarning }))
    emit()
    return 'applied'
  }
  const written = writeStoredSheet(exerciseId, next)
  snapshots.set(
    exerciseId,
    snapshotFrom(next, written.ok ? {} : { storageWarning: written.message }),
  )
  emit()
  return 'applied'
}

/** True when two data objects describe the same sheet (compared as they would be stored). */
function sameData(a: RunSheetData, b: RunSheetData): boolean {
  return serializeStoredSheet(a) === serializeStoredSheet(b)
}

let attemptCounter = 0

/** A token unique to one fire attempt (see `BeatRuntime.attemptId`). */
function newAttemptId(): string {
  attemptCounter += 1
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `attempt-${attemptCounter}-${random}`
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

/** Appends a beat; returns its id. */
export function addBeatTo(exerciseId: string, content: BeatContent): string | undefined {
  let created: string | undefined
  mutate(exerciseId, data => {
    const result = addBeat(data, content)
    created = result.beatId
    return result.data
  })
  return created
}

export function updateBeatIn(exerciseId: string, beatId: string, content: BeatContent): void {
  mutate(exerciseId, data => updateBeat(data, beatId, content))
}

/** Duplicates a beat; returns the copy's id (or `undefined` at the 200-beat limit). */
export function duplicateBeatIn(exerciseId: string, beatId: string): string | undefined {
  let created: string | undefined
  mutate(exerciseId, data => {
    const result = duplicateBeat(data, beatId)
    created = result.beatId
    return result.data
  })
  return created
}

/** Result of {@link deleteBeatFrom}. */
export type DeleteBeatOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

/** Deletes a beat, unless it is firing or has un-fired reply beats (the reason says which). */
export function deleteBeatFrom(exerciseId: string, beatId: string): DeleteBeatOutcome {
  let outcome: DeleteBeatOutcome = { ok: true }
  mutate(exerciseId, data => {
    const reason = deleteBlockReason(data, beatId)
    if (reason !== undefined) {
      outcome = { ok: false, reason }
      return data
    }
    return deleteBeat(data, beatId)
  })
  return outcome
}

export function moveBeatIn(exerciseId: string, beatId: string, direction: -1 | 1): void {
  mutate(exerciseId, data => moveBeat(data, beatId, direction))
}

export function sortBeatsByMinuteIn(exerciseId: string): void {
  mutate(exerciseId, data => sortBeatsByMinute(data))
}

export function renameSheetIn(exerciseId: string, name: string): void {
  mutate(exerciseId, data => (data.name === name ? data : renameSheet(data, name)))
}

/** Result of {@link replaceSheetIn}. */
export type ReplaceSheetOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

const replaceOk = (): ReplaceSheetOutcome => ({ ok: true })

/**
 * Replaces the whole sheet with an imported definition (every beat starts pending). REFUSED
 * while a beat is in flight: its result would otherwise land on the new sheet and could show
 * a same-id beat as Fired that never went out.
 */
export function replaceSheetIn(
  exerciseId: string,
  definition: RunSheetDefinition,
): ReplaceSheetOutcome {
  let outcome = replaceOk()
  const result = mutate(exerciseId, data => {
    const reason = replaceBlockReason(data)
    if (reason !== undefined) {
      outcome = { ok: false, reason }
      return data
    }
    return replaceDefinition(definition)
  })
  if (outcome.ok && result !== 'applied') {
    return { ok: false, reason: 'The sheet could not be replaced. Nothing was changed.' }
  }
  return outcome
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Result of {@link beginFireIn}. */
export type BeginFireOutcome =
  | { readonly ok: true; readonly attemptId: string }
  | {
    readonly ok: false
    readonly reason: string
    /** The beat's last outcome is unknown: confirm with the controller, then call again. */
    readonly needsConfirmation?: true
  }

const beginRefused = (): BeginFireOutcome => ({
  ok: false,
  reason: 'That beat no longer exists.',
})

/**
 * Claims the single fire slot for a beat, SYNCHRONOUSLY: it is already persisted when
 * this returns, so a second call in the same tick (a double-press) is refused. The returned
 * `attemptId` must be handed back to {@link completeFireIn} / {@link failFireIn}; only that
 * attempt may record the outcome. Nothing is sent unless this says `ok` - so a change that
 * could not be stored (refused / unreadable) is `ok: false` too.
 */
export function beginFireIn(
  exerciseId: string,
  beatId: string,
  options: { readonly confirmedUnconfirmed?: boolean } = {},
): BeginFireOutcome {
  const attemptId = newAttemptId()
  let outcome = beginRefused()
  const result = mutate(exerciseId, data => {
    const attempt = beginFire(data, beatId, {
      attemptId,
      ...(options.confirmedUnconfirmed === true ? { confirmedUnconfirmed: true } : {}),
    })
    if (!attempt.ok) {
      outcome = {
        ok: false,
        reason: attempt.reason,
        ...(attempt.needsConfirmation === true ? { needsConfirmation: true as const } : {}),
      }
      return data
    }
    outcome = { ok: true, attemptId }
    return attempt.data
  })
  if (outcome.ok && result !== 'applied') {
    return { ok: false, reason: 'The sheet could not be saved, so nothing was fired.' }
  }
  if (result === 'blocked') {
    return { ok: false, reason: 'The saved run sheet could not be read, so nothing was fired.' }
  }
  return outcome
}

/**
 * Records a confirmed fire. Returns whether it was RECORDED: false means the beat no longer
 * carries this attempt's in-flight marker (the sheet was replaced or reconciled meanwhile),
 * so the post went out but the sheet could not say so - the caller must tell the controller.
 */
export function completeFireIn(
  exerciseId: string,
  beatId: string,
  attemptId: string,
  result: { readonly postId: string; readonly scenarioTime: string },
): boolean {
  return mutate(exerciseId, data => completeFire(data, beatId, attemptId, result)) === 'applied'
}

/** Records a failed or unconfirmed fire; returns whether it was recorded (see above). */
export function failFireIn(
  exerciseId: string,
  beatId: string,
  attemptId: string,
  failure: BeatFailure,
): boolean {
  return mutate(exerciseId, data => failFire(data, beatId, attemptId, failure)) === 'applied'
}

export function skipBeatIn(exerciseId: string, beatId: string): void {
  mutate(exerciseId, data => skipBeat(data, beatId))
}

export function unskipBeatIn(exerciseId: string, beatId: string): void {
  mutate(exerciseId, data => unskipBeat(data, beatId))
}

// ---------------------------------------------------------------------------
// Recovery + tests
// ---------------------------------------------------------------------------

/**
 * Starts a new empty sheet over an UNREADABLE stored value, after copying the old text
 * to a backup key. The only way out of the `unreadable` state.
 */
export function startFreshIn(exerciseId: string): void {
  const current = getRunSheetSnapshot(exerciseId)
  if (current.state !== 'unreadable') return
  const raw = unreadableRaw.get(exerciseId)
  if (raw !== undefined) backUpUnreadable(exerciseId, raw)
  unreadableRaw.delete(exerciseId)
  const fresh = emptySheet()
  const written = writeStoredSheet(exerciseId, fresh)
  snapshots.set(
    exerciseId,
    snapshotFrom(fresh, written.ok ? {} : { storageWarning: written.message }),
  )
  emit()
}

/** Test-only: forget every cached sheet (and optionally the stored copies). */
export function resetRunSheetStoreForTests(
  opts: { clearStorageFor?: readonly string[] } = {},
): void {
  for (const id of opts.clearStorageFor ?? []) removeStoredSheet(id)
  snapshots.clear()
  unreadableRaw.clear()
  orphanedFires.clear()
}
