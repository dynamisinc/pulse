/**
 * features/social/notifications/notificationStorage.ts
 * ---------------------------------------------------------------------------
 * What the notifications feature remembers in `sessionStorage` (demo-polish F7, story 16:
 * "Mark all read persists per persona in `sessionStorage` under an exercise-scoped key";
 * "Like-increase detection compares `counts.like` against a per-post snapshot stored in
 * `sessionStorage`"). Participant world -- plain functions, no React, no clock.
 *
 * WHAT IS STORED, per (exercise, persona):
 *
 *   readIds   the ids of the reply/mention events the viewer has marked read;
 *   likes     per post of mine: the like count when the viewer last LOOKED (the baseline
 *             a rise is measured against), when the latest rise was first seen, and the
 *             last acknowledged "N new likes" row.
 *
 * Nothing else. In particular no post text, no persona name and no other persona's data:
 * the rows themselves are always re-derived from the exercise-scoped feed, so storage can
 * never put content on screen that the server would not currently serve.
 *
 * THE KEY IS EXERCISE- AND PERSONA-SCOPED (Isolation AC, COR-001). It is built from BOTH
 * ids, each `encodeURIComponent`-ed so an id containing the `:` separator cannot make two
 * different pairs collide. A different persona (or the same persona in another exercise)
 * therefore reads a different key and starts from a clean baseline; nothing is ever read
 * from another persona's entry.
 *
 * SIGN-OUT. `clearAllNotificationStorage` removes EVERY entry under the prefix, whichever
 * persona wrote it; the store registers it with `core/auth/sessionReset`, so `endSession`
 * wipes it (the next sign-in on the same tab starts clean even for the same persona).
 *
 * FAIL-SAFE. `sessionStorage` can be absent or throw (sandboxed frames, blocked storage,
 * quota); every call is guarded and the feature simply works from memory. A stored value
 * that does not parse, or is the wrong shape, is IGNORED (an empty state), never trusted
 * half-way: this is tab-local data any script on the origin could have written, so it is
 * validated field by field and rebuilt, not cast. Sizes are bounded on read as well as write.
 */

import { LIKE_RECORDS_CAP, READ_IDS_CAP } from './notificationTypes'

/** The key prefix every entry lives under; also what sign-out sweeps. */
export const NOTIFICATION_STORAGE_PREFIX = 'pulse.notifications.v1'

/** One post of mine's like bookkeeping. */
export interface LikeRecord {
  readonly postId: string
  /** The like count when the viewer last looked (first sight, or "Mark all read"). */
  readonly baseline: number
  /** Scenario ISO instant the latest rise above `baseline` was first seen, if there is one. */
  readonly riseAt?: string
  /** The last acknowledged "N new likes" row, kept so a read row stays on the page. */
  readonly read?: { readonly count: number; readonly at: string }
}

/** The persisted shape (versioned: a bump invalidates older entries by ignoring them). */
export interface PersistedNotifications {
  readonly v: 1
  readonly readIds: readonly string[]
  readonly likes: readonly LikeRecord[]
}

/** A fresh, empty state: nothing read, no baselines yet. */
export const EMPTY_PERSISTED: PersistedNotifications = { v: 1, readIds: [], likes: [] }

/**
 * `sessionStorage`, or `undefined` where it is unavailable. Reading `window.sessionStorage`
 * itself can throw (a sandboxed iframe, storage disabled), so even the lookup is guarded.
 */
export function getSessionStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage
  } catch {
    return undefined
  }
}

/** The storage key for one viewer: exercise AND persona (see the module header). */
export function notificationStorageKey(exerciseId: string, personaId: string): string {
  return `${NOTIFICATION_STORAGE_PREFIX}:${encodeURIComponent(exerciseId)}:${encodeURIComponent(personaId)}`
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** One like record rebuilt from untrusted JSON, or `undefined` when malformed. */
function parseLikeRecord(value: unknown): LikeRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { postId, baseline, riseAt, read } = value as Record<string, unknown>
  if (!isNonEmptyString(postId) || !isCount(baseline)) return undefined

  let parsedRead: { count: number; at: string } | undefined
  if (read !== undefined && read !== null) {
    if (typeof read !== 'object') return undefined
    const { count, at } = read as Record<string, unknown>
    if (!isCount(count) || !isNonEmptyString(at)) return undefined
    parsedRead = { count, at }
  }
  if (riseAt !== undefined && riseAt !== null && !isNonEmptyString(riseAt)) return undefined

  return {
    postId,
    baseline,
    ...(typeof riseAt === 'string' ? { riseAt } : {}),
    ...(parsedRead !== undefined ? { read: parsedRead } : {}),
  }
}

/** Rebuilds a stored value field by field; anything off-shape is an empty state. */
export function parsePersisted(raw: string | null): PersistedNotifications {
  if (raw === null) return EMPTY_PERSISTED
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return EMPTY_PERSISTED
  }
  if (typeof value !== 'object' || value === null) return EMPTY_PERSISTED
  const { v, readIds, likes } = value as Record<string, unknown>
  if (v !== 1 || !Array.isArray(readIds) || !Array.isArray(likes)) return EMPTY_PERSISTED

  const ids: string[] = []
  for (const id of readIds) {
    if (isNonEmptyString(id)) ids.push(id)
  }
  const records: LikeRecord[] = []
  for (const entry of likes) {
    const record = parseLikeRecord(entry)
    if (record !== undefined) records.push(record)
  }
  return {
    v: 1,
    // Bounded on read too: keep the NEWEST (the tail), the same end the writer keeps.
    readIds: ids.slice(-READ_IDS_CAP),
    likes: records.slice(-LIKE_RECORDS_CAP),
  }
}

/** Reads one viewer's persisted state (empty when absent, unreadable or malformed). */
export function readPersisted(storage: Storage | undefined, key: string): PersistedNotifications {
  if (storage === undefined) return EMPTY_PERSISTED
  try {
    return parsePersisted(storage.getItem(key))
  } catch {
    return EMPTY_PERSISTED
  }
}

/** Writes one viewer's state. Failure (quota, blocked storage) is swallowed: memory carries on. */
export function writePersisted(
  storage: Storage | undefined,
  key: string,
  state: PersistedNotifications,
): void {
  if (storage === undefined) return
  try {
    storage.setItem(key, JSON.stringify(state))
  } catch {
    // Quota exceeded / storage blocked: the feature keeps working from memory.
  }
}

/**
 * Removes EVERY notification entry from the tab's storage, whichever exercise/persona wrote
 * it. Keys are collected first and removed after, because removing while iterating shifts
 * the indices.
 */
export function clearAllNotificationStorage(storage: Storage | undefined): void {
  if (storage === undefined) return
  try {
    const doomed: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key !== null && key.startsWith(`${NOTIFICATION_STORAGE_PREFIX}:`)) doomed.push(key)
    }
    for (const key of doomed) storage.removeItem(key)
  } catch {
    // Nothing to clear if storage is unusable.
  }
}
