/**
 * features/controller/runSheet/runSheetStorage.ts
 * ---------------------------------------------------------------------------
 * Browser persistence for the run sheet (demo-polish C3, story 19;
 * implementation.md §1.9 "Browser storage"). STAFF world; no React.
 *
 *   key    `pulse.runsheet.v1:{exerciseId}`  (`localStorage`)
 *   value  { "v": 1, "name", "beats", "runtime" }
 *
 * The key carries the exercise id, so switching exercise can only ever read that
 * exercise's own sheet - there is no shared slot to bleed between exercises
 * (COR-001). The id is an opaque string; nothing here parses it. `beats` is exactly
 * the file's definition (and is validated with the same zod schema + cross-beat
 * rules on every load); `runtime` is the per-beat status that is NEVER exported.
 *
 * NOTHING FAILS SILENTLY. Every function returns a result instead of throwing:
 *   - storage that cannot be read (disabled, blocked, private mode) -> `unavailable`;
 *   - a stored value that is not a valid sheet -> `unreadable`, with the reason and
 *     the raw text, so the panel can say so and refuse to overwrite it until the
 *     controller explicitly starts over (we back the raw text up under a sibling
 *     key first, best effort);
 *   - a write that fails (quota, blocked) -> `{ ok: false, message }`, which the
 *     store turns into a visible warning rather than silently losing edits.
 *
 * `window.localStorage` is read lazily inside each call, never at import time, so a
 * browser that throws on access (Safari with storage blocked) cannot break module
 * load.
 */

import { z } from 'zod'
import {
  RUN_SHEET_SCHEMA_ID,
  beatsSchema,
  checkSheetConsistency,
  sheetNameSchema,
} from './runSheetSchema'
import type { BeatRuntime, RunSheetData } from './runSheetModel'

/** The storage key for an exercise's sheet. */
export function runSheetStorageKey(exerciseId: string): string {
  return `${RUN_SHEET_SCHEMA_ID}:${exerciseId}`
}

/** Where an unreadable value is copied before the controller starts a fresh sheet. */
export function runSheetBackupKey(exerciseId: string): string {
  return `${runSheetStorageKey(exerciseId)}:unreadable-backup`
}

/** The prefix every run-sheet key shares (used to recognise `storage` events). */
export const RUN_SHEET_STORAGE_PREFIX = `${RUN_SHEET_SCHEMA_ID}:`

/** The exercise id a run-sheet storage key belongs to, or `undefined` for any other key. */
export function exerciseIdFromStorageKey(key: string | null): string | undefined {
  if (key === null || !key.startsWith(RUN_SHEET_STORAGE_PREFIX)) return undefined
  const id = key.slice(RUN_SHEET_STORAGE_PREFIX.length)
  return id === '' || id.endsWith(':unreadable-backup') ? undefined : id
}

const failureSchema = z.strictObject({
  kind: z.enum(['failed', 'unconfirmed']),
  message: z.string().max(2000),
})

const runtimeSchema = z.strictObject({
  status: z.enum(['pending', 'fired', 'skipped', 'failed']),
  inFlight: z.boolean().optional(),
  firedPostId: z.string().min(1).max(200).optional(),
  firedAtScenario: z.string().min(1).max(64).optional(),
  failure: failureSchema.optional(),
  skippedFrom: z.enum(['pending', 'failed']).optional(),
})

const storedSchema = z.strictObject({
  v: z.literal(1),
  name: sheetNameSchema,
  beats: beatsSchema,
  runtime: z.record(z.string(), runtimeSchema),
})

/** The outcome of reading one exercise's stored sheet. */
export type StoredRead =
  | { readonly kind: 'empty' }
  | { readonly kind: 'ok'; readonly data: RunSheetData }
  | { readonly kind: 'unreadable'; readonly message: string; readonly raw: string }
  | { readonly kind: 'unavailable'; readonly message: string }

/** The warning shown when the browser will not let us read or write storage at all. */
export const STORAGE_UNAVAILABLE_MESSAGE =
  'Browser storage is unavailable, so this run sheet will not be saved. Your edits are lost when '
  + 'you close or reload this tab - use Export to keep a copy.'

/** The warning shown when a write fails. */
export const STORAGE_WRITE_FAILED_MESSAGE =
  'The last change could not be saved to browser storage (it may be full or blocked). Your edits '
  + 'are kept while this tab stays open - use Export to keep a copy.'

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

/** Parses + validates stored text. Never throws. */
export function parseStoredSheet(raw: string): StoredRead {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { kind: 'unreadable', message: 'the saved text is not valid JSON', raw }
  }
  const parsed = storedSchema.safeParse(value)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first === undefined ? '' : `${first.path.join('.')} ${first.message}`.trim()
    return { kind: 'unreadable', message: `the saved sheet is not valid (${where})`, raw }
  }
  const { name, beats, runtime } = parsed.data
  const inconsistent = checkSheetConsistency(beats)
  if (inconsistent !== undefined) {
    return { kind: 'unreadable', message: `the saved sheet is not valid (${inconsistent})`, raw }
  }
  // A status record for a beat that no longer exists is harmless noise: drop it.
  const known = new Set(beats.map(beat => beat.id))
  const kept: Record<string, BeatRuntime> = {}
  for (const [beatId, record] of Object.entries(runtime)) {
    if (known.has(beatId)) kept[beatId] = record
  }
  // A `fired` beat must say which post it created (a reply gates on it).
  for (const beat of beats) {
    const record = kept[beat.id]
    if (record?.status === 'fired' && record.firedPostId === undefined) {
      return { kind: 'unreadable', message: `beat "${beat.id}" is marked fired without a post id`, raw }
    }
  }
  const sortedBeats = [...beats].sort((a, b) => a.order - b.order)
  return { kind: 'ok', data: { name, beats: sortedBeats, runtime: kept } }
}

/** Reads one exercise's stored sheet. Never throws. */
export function readStoredSheet(exerciseId: string): StoredRead {
  const store = storage()
  if (store === undefined) return { kind: 'unavailable', message: STORAGE_UNAVAILABLE_MESSAGE }
  let raw: string | null
  try {
    raw = store.getItem(runSheetStorageKey(exerciseId))
  } catch {
    return { kind: 'unavailable', message: STORAGE_UNAVAILABLE_MESSAGE }
  }
  if (raw === null) return { kind: 'empty' }
  return parseStoredSheet(raw)
}

/** The text stored for a sheet (runtime records for beats that exist, nothing else). */
export function serializeStoredSheet(data: RunSheetData): string {
  const runtime: Record<string, BeatRuntime> = {}
  for (const beat of data.beats) {
    const record = data.runtime[beat.id]
    if (record !== undefined) runtime[beat.id] = record
  }
  return JSON.stringify({ v: 1, name: data.name, beats: data.beats, runtime })
}

/** The outcome of a write. */
export type StoredWrite = { readonly ok: true } | { readonly ok: false; readonly message: string }

/** Writes one exercise's sheet. Never throws. */
export function writeStoredSheet(exerciseId: string, data: RunSheetData): StoredWrite {
  const store = storage()
  if (store === undefined) return { ok: false, message: STORAGE_UNAVAILABLE_MESSAGE }
  try {
    store.setItem(runSheetStorageKey(exerciseId), serializeStoredSheet(data))
    return { ok: true }
  } catch {
    return { ok: false, message: STORAGE_WRITE_FAILED_MESSAGE }
  }
}

/** Copies an unreadable value aside (best effort) so starting over never destroys it. */
export function backUpUnreadable(exerciseId: string, raw: string): void {
  try {
    storage()?.setItem(runSheetBackupKey(exerciseId), raw)
  } catch {
    // Best effort only - the controller has already been told the data is unreadable.
  }
}

/** Removes an exercise's stored sheet. Test-only helper; the app never deletes a sheet. */
export function removeStoredSheet(exerciseId: string): void {
  try {
    storage()?.removeItem(runSheetStorageKey(exerciseId))
    storage()?.removeItem(runSheetBackupKey(exerciseId))
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
