/**
 * features/controller/liveWorld/useLiveWorldUnread.ts
 * ---------------------------------------------------------------------------
 * UNREAD tracking for the console's Live world column (story 08: "bold unread posts …
 * highlighting would help controllers spot what's new"). STAFF world, no UI.
 *
 * ## What is unread
 * A post that ARRIVED LIVE — a realtime arrival, or one first seen by a polling sweep,
 * i.e. not part of the opening baseline read (`LiveWorldEntry.live`) — is unread until:
 *   - at least half of its row has been visible in the column's list for one second
 *     ({@link useMarkReadWhenSeen}: one IntersectionObserver for the whole list, rooted
 *     on it, threshold 0.5, a {@link READ_DWELL_MS} dwell per row), or
 *   - the controller clicks **Mark all read** (`markAllRead`: every LISTED row).
 * A post held behind "N new" is not on screen, so it stays unread until it is merged
 * and seen: merged rows arrive unread, and the "N new" behaviour itself is unchanged.
 *
 * ## Per browser, per exercise
 * The set of still-unread ids is kept in `localStorage` under a key scoped by the
 * column's exercise ({@link unreadStorageKey}), bounded at {@link MAX_STORED_UNREAD}.
 * On a reload the opening baseline is READ, except the posts that were still unread
 * when the console was last open: those stay unread. Every storage access is wrapped
 * in try/catch, and a failure (blocked storage, private mode, quota, a malformed value)
 * simply means nothing is remembered: the column then treats the whole baseline as
 * read, exactly as on a first visit. This is the story's stated behaviour, not a
 * swallowed error: nothing the controller asked for failed.
 *
 * ## Performance (NFR-002, 120 posts/min)
 * Unread is DERIVED: `entry.live || storedUnread.has(id)`, minus the ids read since
 * mount. The column hands each memoized row a plain boolean, so a burst only renders
 * the rows whose own flag changed. The read set is pruned to the ids still listed.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { LiveWorldEntry } from './liveWorldModel'
import { MAX_PENDING, MAX_ROWS } from './liveWorldModel'

/** How long at least half of a row must stay visible before it counts as read. */
export const READ_DWELL_MS = 1000

/** The share of a row that must be visible (IntersectionObserver threshold). */
export const READ_VISIBLE_RATIO = 0.5

/** Most unread ids remembered per exercise (everything the column can hold). */
export const MAX_STORED_UNREAD = MAX_ROWS + MAX_PENDING

/** The read set is pruned to the listed ids once it grows past this. */
const READ_PRUNE_AT = 2 * (MAX_ROWS + MAX_PENDING)

const STORAGE_PREFIX = 'pulse.liveWorld.unread.v1:'

/** The `localStorage` key for one exercise's unread ids (a local scope; never sent). */
export function unreadStorageKey(scope: string): string {
  return `${STORAGE_PREFIX}${scope}`
}

/**
 * The unread ids remembered for `scope`; an EMPTY set when there is none, the value is
 * malformed, or storage is unavailable (see the module header: nothing is remembered).
 */
export function readStoredUnread(scope: string): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(unreadStorageKey(scope))
    if (raw === null) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return new Set()
    const ids = (parsed as Record<string, unknown>).unread
    if (!Array.isArray(ids)) return new Set()
    return new Set(ids.filter((id): id is string => typeof id === 'string'))
  } catch {
    // Storage blocked or the value is not JSON: nothing is remembered (story 08 AC).
    return new Set()
  }
}

/**
 * Remembers `ids` as the unread posts of `scope` (bounded). Returns false when storage
 * refused the write, in which case nothing is remembered (story 08 AC).
 */
export function writeStoredUnread(scope: string, ids: readonly string[]): boolean {
  try {
    const bounded = ids.length > MAX_STORED_UNREAD ? ids.slice(0, MAX_STORED_UNREAD) : ids
    window.localStorage.setItem(unreadStorageKey(scope), JSON.stringify({ unread: bounded }))
    return true
  } catch {
    // Storage blocked or full: the read state is simply not remembered (story 08 AC).
    return false
  }
}

export interface UseLiveWorldUnreadOptions {
  /** The storage scope: the column's exercise (local only, never sent anywhere). */
  readonly scope: string
  /** The listed rows, newest-first. */
  readonly rows: readonly LiveWorldEntry[]
  /** The arrivals held behind "N new". */
  readonly pending: readonly LiveWorldEntry[]
  /** True once the opening baseline is in: nothing is written before that. */
  readonly ready: boolean
}

export interface UseLiveWorldUnreadResult {
  /** The ids of every unread post, listed or held. */
  readonly unreadIds: ReadonlySet<string>
  /** How many LISTED rows are unread (the column header's "N unread"). */
  readonly unreadCount: number
  /** Marks one post read. Stable identity. */
  markRead(postId: string): void
  /** Marks every listed row read (held arrivals stay unread until merged). Stable identity. */
  markAllRead(): void
}

/** Tracks which Live world posts are unread. See the module header. */
export function useLiveWorldUnread({
  scope,
  rows,
  pending,
  ready,
}: UseLiveWorldUnreadOptions): UseLiveWorldUnreadResult {
  // Read once per mount: the column's panel remounts on an exercise switch.
  const [storedUnread] = useState(() => readStoredUnread(scope))
  const [read, setRead] = useState<ReadonlySet<string>>(() => new Set())

  const unreadIds = useMemo(() => {
    const next = new Set<string>()
    for (const list of [rows, pending]) {
      for (const entry of list) {
        const id = entry.view.id
        if ((entry.live || storedUnread.has(id)) && !read.has(id)) next.add(id)
      }
    }
    return next
  }, [rows, pending, read, storedUnread])

  const unreadCount = useMemo(
    () => rows.reduce((count, entry) => count + (unreadIds.has(entry.view.id) ? 1 : 0), 0),
    [rows, unreadIds],
  )

  // The latest collections, for the stable callbacks below.
  const listedRef = useRef({ rows, pending })
  useLayoutEffect(() => {
    listedRef.current = { rows, pending }
  })

  const addRead = useCallback((ids: readonly string[]) => {
    setRead(prev => {
      const fresh = ids.filter(id => !prev.has(id))
      if (fresh.length === 0) return prev
      let base: Iterable<string> = prev
      if (prev.size + fresh.length > READ_PRUNE_AT) {
        // Keep only what is still listed or held: an evicted post never comes back.
        const listed = new Set<string>()
        for (const entry of listedRef.current.rows) listed.add(entry.view.id)
        for (const entry of listedRef.current.pending) listed.add(entry.view.id)
        base = [...prev].filter(id => listed.has(id))
      }
      return new Set([...base, ...fresh])
    })
  }, [])

  const markRead = useCallback((postId: string) => addRead([postId]), [addRead])
  const markAllRead = useCallback(
    () => addRead(listedRef.current.rows.map(entry => entry.view.id)),
    [addRead],
  )

  // Remember what is still unread, per exercise, whenever it changes (only after the
  // baseline is in, so an early empty list never erases the last visit's state).
  // Written synchronously: a page reload runs no React cleanup, so a debounce could lose
  // the last change. The value is small (bounded ids) and only written on a change.
  const lastWrittenRef = useRef<string | null>(null)
  useEffect(() => {
    if (!ready) return
    const ids: string[] = []
    for (const list of [rows, pending]) {
      for (const entry of list) if (unreadIds.has(entry.view.id)) ids.push(entry.view.id)
    }
    const key = ids.join('|')
    if (key === lastWrittenRef.current) return
    lastWrittenRef.current = key
    writeStoredUnread(scope, ids)
  }, [ready, scope, rows, pending, unreadIds])

  return { unreadIds, unreadCount, markRead, markAllRead }
}

/** Row elements carry these (see `LiveWorldRow`). */
const UNREAD_ROW_SELECTOR = '[data-live-world-row][data-unread="true"]'

/**
 * Marks an unread row read once at least {@link READ_VISIBLE_RATIO} of it has been
 * visible inside `listRef`'s element for {@link READ_DWELL_MS}. One IntersectionObserver
 * for the whole list (rooted on it), re-pointed incrementally after each render: a row
 * that stays unread and stays mounted keeps its observation AND its running dwell timer,
 * so a burst of arrivals never restarts the clock. A row scrolled out of view before the
 * dwell completes stays unread. A browser without IntersectionObserver marks nothing
 * read by sight (Mark all read still works).
 *
 * `rowsTrigger` / `unreadTrigger` are values whose identity changes when the rendered rows
 * (the column's visible list) or the unread set may have changed.
 */
export function useMarkReadWhenSeen(
  listRef: RefObject<HTMLElement | null>,
  markRead: (postId: string) => void,
  rowsTrigger: unknown,
  unreadTrigger: unknown,
): void {
  const stateRef = useRef<{
    root: HTMLElement | null
    observer: IntersectionObserver | null
    observed: Map<Element, string>
    timers: Map<string, ReturnType<typeof setTimeout>>
  }>({ root: null, observer: null, observed: new Map(), timers: new Map() })
  const markReadRef = useRef(markRead)
  useLayoutEffect(() => {
    markReadRef.current = markRead
  })

  useLayoutEffect(() => {
    const state = stateRef.current
    const list = listRef.current
    if (typeof IntersectionObserver === 'undefined') return

    const clearTimer = (id: string) => {
      const timer = state.timers.get(id)
      if (timer !== undefined) {
        clearTimeout(timer)
        state.timers.delete(id)
      }
    }

    // The list element came or went (it unmounts while nothing is listed): start over.
    if (state.root !== list) {
      state.observer?.disconnect()
      for (const timer of state.timers.values()) clearTimeout(timer)
      state.timers.clear()
      state.observed.clear()
      state.observer = null
      state.root = list
      if (list !== null) {
        state.observer = new IntersectionObserver(entries => {
          for (const entry of entries) {
            const id = state.observed.get(entry.target)
            if (id === undefined) continue
            if (entry.isIntersecting && entry.intersectionRatio >= READ_VISIBLE_RATIO) {
              if (!state.timers.has(id)) {
                state.timers.set(id, setTimeout(() => {
                  state.timers.delete(id)
                  markReadRef.current(id)
                }, READ_DWELL_MS))
              }
            } else {
              clearTimer(id)
            }
          }
        }, { root: list, threshold: [READ_VISIBLE_RATIO] })
      }
    }

    const observer = state.observer
    if (list === null || observer === null) return

    const current = new Map<Element, string>()
    for (const element of list.querySelectorAll<HTMLElement>(UNREAD_ROW_SELECTOR)) {
      const id = element.dataset.postId
      if (id !== undefined) current.set(element, id)
    }
    for (const [element, id] of state.observed) {
      if (!current.has(element)) {
        observer.unobserve(element)
        state.observed.delete(element)
        clearTimer(id)
      }
    }
    for (const [element, id] of current) {
      if (!state.observed.has(element)) {
        state.observed.set(element, id)
        observer.observe(element)
      }
    }
  }, [listRef, rowsTrigger, unreadTrigger])

  useEffect(() => {
    const state = stateRef.current
    return () => {
      state.observer?.disconnect()
      for (const timer of state.timers.values()) clearTimeout(timer)
      state.timers.clear()
      state.observed.clear()
      state.observer = null
      state.root = null
    }
  }, [])
}
