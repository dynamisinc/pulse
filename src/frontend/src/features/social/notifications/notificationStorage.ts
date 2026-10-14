/**
 * features/social/notifications/notificationStorage.ts
 * ---------------------------------------------------------------------------
 * What the notifications feature remembers in the browser (demo-polish F7, story 16:
 * "Mark all read persists per persona ... under an exercise-scoped key"; "Like-increase
 * detection compares `counts.like` against a per-post snapshot"). Participant world -- plain
 * functions, no React, no clock.
 *
 * WHERE: `localStorage`, NOT `sessionStorage`. Demo-polish easy-login 07 moves participant
 * tokens to `localStorage`, so once it lands the same persona comes back to the same exercise
 * after a closed tab -- and their read marks and like baselines must come back with them, or
 * every reopen would present the whole feed's replies as unread again and reset every baseline.
 * The state is tab-independent but strictly per (exercise, persona, account).
 *
 * IT DOES NOT SHARE A LIFETIME WITH THE TOKENS (a correction): sign-out sweeps this state, but
 * a token that merely EXPIRES, or a browser that is simply closed, does not. And until
 * easy-login 07 merges, participant tokens are still in `sessionStorage`, so on such a build
 * this state outlives the token across a closed tab. That is harmless -- the key names the
 * exercise, the persona and the account, nothing is stored that the server would not serve
 * again, and `start()` sweeps every entry that is not the current viewer's -- but it is not
 * "live and die together". One browser holds one participant session, so any entry that does
 * not belong to the viewer who is signed in now is dead weight and is removed.
 *
 * MIGRATION: none. This feature has never shipped with `sessionStorage` state in the wild
 * (it was built on an unreleased branch), so there is nothing to migrate. The sign-out sweep
 * still clears any `sessionStorage` entry a development build may have left.
 *
 * WHAT IS STORED, per (exercise, persona):
 *
 *   readIds   the ids of the reply/mention events the viewer has marked read (the newest
 *             {@link READ_IDS_CAP} are written);
 *   likes     per post of mine: the like count when the viewer last LOOKED (the baseline
 *             a rise is measured against), when the latest rise was first seen, and the
 *             last acknowledged "N new likes" row.
 *
 * Nothing else. In particular no post text, no persona name and no other persona's data:
 * the rows themselves are always re-derived from the exercise-scoped feed, so storage can
 * never put content on screen that the server would not currently serve.
 *
 * THE KEY IS EXERCISE-, PERSONA- AND ACCOUNT-SCOPED (Isolation AC, COR-001). It is built
 * from all three ids, each `encodeURIComponent`-ed so an id containing the `:` separator
 * cannot make two different tuples collide. A different persona (or the same persona in
 * another exercise) therefore reads a different key and starts from a clean baseline, and
 * so does a different ACCOUNT on the same persona: two humans who each log in to a shared
 * org persona on a kiosk do not inherit each other's read marks. Nothing is ever read from
 * another viewer's entry. (Two humans on one SHARED account, or the same account in two
 * browsers, are one viewer to this key -- see the story's known limitations.)
 *
 * SWEEPS. `clearAllNotificationStorage` removes entries under the prefix from the store it is
 * given. On SIGN-OUT the notifications store sweeps EVERY entry from both `localStorage` and
 * `sessionStorage` (registered with `core/auth/sessionReset`, so `endSession` wipes them: the
 * next sign-in on the same browser starts clean even for the same persona) -- but only in a
 * tab that has run a notifications session since it last swept (the sweep spends the
 * ownership; a new session re-arms it), so a STAFF tab's sign-out -- or a second reset in a tab
 * that already signed its participant out -- leaves a participant's state alone. On START it
 * sweeps every entry except the current viewer's (`keepKey`).
 *
 * TWO TABS. `localStorage` is shared, so two tabs of the same persona write the same key.
 * `mergeForWrite` makes a write additive for what must never be lost (read marks are
 * unioned; a like record this tab does not know is kept), so one tab's write does not undo
 * the other's "Mark all read". It is last-writer-wins for a record both tabs know.
 *
 * FAIL-SAFE. Storage can be absent or throw (sandboxed frames, blocked storage, quota);
 * every call is guarded and the feature simply works from memory. A stored value that does not
 * parse, or is the wrong shape, is IGNORED (an empty state), never trusted half-way: this is
 * origin-wide data any script on the origin could have written, so it is validated field by
 * field and rebuilt, not cast. Sizes are bounded on read as well as write.
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
 * `window.localStorage`, or `undefined` where it is unavailable -- the store the state lives in
 * (see the module header). Even the property lookup can throw (a sandboxed iframe, storage
 * disabled), so it is guarded.
 */
export function getPersistentStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

/**
 * `window.sessionStorage`, or `undefined`. Nothing is stored there any more; it exists so the
 * sign-out sweep can also clear an entry an earlier development build left behind.
 */
export function getSessionStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage
  } catch {
    return undefined
  }
}

/** The storage key for one viewer: exercise, persona AND account (see the module header). */
export function notificationStorageKey(
  exerciseId: string,
  personaId: string,
  accountId: string,
): string {
  const part = encodeURIComponent
  return `${NOTIFICATION_STORAGE_PREFIX}:${part(exerciseId)}:${part(personaId)}:${part(accountId)}`
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
 * What to write given what is ALREADY stored (another tab of the same viewer may have written
 * since this one loaded): read marks are unioned (stored first, so this tab's newest stay at
 * the tail the cap keeps), and a like record this tab has no opinion on is kept. A record both
 * know takes this tab's version.
 */
export function mergeForWrite(
  stored: PersistedNotifications,
  mine: PersistedNotifications,
): PersistedNotifications {
  const readIds = [...new Set([...stored.readIds, ...mine.readIds])].slice(-READ_IDS_CAP)
  const known = new Set(mine.likes.map(record => record.postId))
  const likes = [...stored.likes.filter(record => !known.has(record.postId)), ...mine.likes]
  return { v: 1, readIds, likes: likes.slice(-LIKE_RECORDS_CAP) }
}

/**
 * Removes every notification entry from the given storage, whichever exercise/persona/account
 * wrote it -- except `keepKey`, when given (the entry of the viewer who is signed in now).
 * Keys are collected first and removed after, because removing while iterating shifts the
 * indices.
 */
export function clearAllNotificationStorage(
  storage: Storage | undefined,
  keepKey?: string,
): void {
  if (storage === undefined) return
  try {
    const doomed: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key !== null && key.startsWith(`${NOTIFICATION_STORAGE_PREFIX}:`) && key !== keepKey) {
        doomed.push(key)
      }
    }
    for (const key of doomed) storage.removeItem(key)
  } catch {
    // Nothing to clear if storage is unusable.
  }
}
