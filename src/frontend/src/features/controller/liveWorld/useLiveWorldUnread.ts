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
 *     WHILE THE CONTROLLER IS LOOKING (the tab visible, `document.visibilityState`, and
 *     the window focused, `document.hasFocus()`); a post that lands while they are in
 *     another window stays unread ({@link useMarkReadWhenSeen}: one IntersectionObserver
 *     for the whole list, rooted on it, threshold 0.5, a {@link READ_DWELL_MS} dwell per
 *     row that only runs while attentive and restarts when attention returns), or
 *   - the controller clicks **Mark all read** (`markAllRead`: every LISTED row).
 * A post held behind "N new" is not on screen, so it stays unread until it is merged
 * and seen: merged rows arrive unread, and the "N new" behaviour itself is unchanged.
 *
 * ## Per browser, per exercise
 * Two bounded id sets are kept in `localStorage` under a key scoped by the column's
 * exercise ({@link unreadStorageKey}): `unread` (still unread) and `known` (every post
 * the column listed or held), at most {@link MAX_STORED_IDS} each. On a reload a
 * baseline post is UNREAD when it was stored unread, OR when a known set was stored and
 * the post is not in it (it arrived while the console was closed); everything else in
 * the baseline is read. A first visit (nothing stored) reads the whole baseline as read
 * (orchestrator decision, Gate-1 M2: both readings of "arrivals since the last visit").
 * Every storage access is wrapped in try/catch, and a failure (blocked storage, private
 * mode, quota, a malformed value) simply means nothing is remembered: the column then
 * behaves as on a first visit. This is the story's stated behaviour, not a swallowed
 * error: nothing the controller asked for failed.
 *
 * ## Performance (NFR-002, 120 posts/min)
 * Unread is DERIVED (`entry.live`, stored unread, or not in the stored known set),
 * minus the ids read since mount. The column hands each memoized row a plain boolean,
 * so a burst only renders the rows whose own flag changed. The read set is pruned to the
 * ids still listed.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import type { LiveWorldEntry } from './liveWorldModel'
import { MAX_PENDING, MAX_ROWS } from './liveWorldModel'

/** How long at least half of a row must stay visible before it counts as read. */
export const READ_DWELL_MS = 1000

/** The share of a row that must be visible (IntersectionObserver threshold). */
export const READ_VISIBLE_RATIO = 0.5

/** Most ids remembered per set and exercise (everything the column can hold). */
export const MAX_STORED_IDS = MAX_ROWS + MAX_PENDING

/** The read set is pruned to the listed ids once it grows past this. */
const READ_PRUNE_AT = 2 * (MAX_ROWS + MAX_PENDING)

const STORAGE_PREFIX = 'pulse.liveWorld.unread.v1:'

/** The `localStorage` key for one exercise's unread ids (a local scope; never sent). */
export function unreadStorageKey(scope: string): string {
  return `${STORAGE_PREFIX}${scope}`
}

/** What a previous visit left behind for one exercise. */
export interface StoredReadState {
  /** Posts still unread when the console was last open. */
  readonly unread: ReadonlySet<string>
  /** Every post the console listed or held then; `null` when none was stored. */
  readonly known: ReadonlySet<string> | null
}

const NOTHING_STORED: StoredReadState = { unread: new Set(), known: null }

/** The string members of `value` when it is an array, else `null`. */
function idSet(value: unknown): Set<string> | null {
  if (!Array.isArray(value)) return null
  return new Set(value.filter((id): id is string => typeof id === 'string'))
}

/**
 * The read state remembered for `scope`; "nothing stored" when there is none, the value
 * is malformed, or storage is unavailable (see the module header: nothing is remembered).
 */
export function readStoredReadState(scope: string): StoredReadState {
  try {
    const raw = window.localStorage.getItem(unreadStorageKey(scope))
    if (raw === null) return NOTHING_STORED
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return NOTHING_STORED
    const record = parsed as Record<string, unknown>
    const unread = idSet(record.unread)
    if (unread === null) return NOTHING_STORED
    return { unread, known: idSet(record.known) }
  } catch {
    // Storage blocked or the value is not JSON: nothing is remembered (story 08 AC).
    return NOTHING_STORED
  }
}

/** `ids` cut to {@link MAX_STORED_IDS} (the lists are newest-first, so the newest stay). */
function bounded(ids: readonly string[]): readonly string[] {
  return ids.length > MAX_STORED_IDS ? ids.slice(0, MAX_STORED_IDS) : ids
}

/**
 * Remembers the unread and known ids of `scope` (each bounded). Returns false when
 * storage refused the write, in which case nothing is remembered (story 08 AC).
 */
export function writeStoredReadState(
  scope: string,
  unread: readonly string[],
  known: readonly string[],
): boolean {
  try {
    window.localStorage.setItem(
      unreadStorageKey(scope),
      JSON.stringify({ unread: bounded(unread), known: bounded(known) }),
    )
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
  const [stored] = useState(() => readStoredReadState(scope))
  const [read, setRead] = useState<ReadonlySet<string>>(() => new Set())

  const unreadIds = useMemo(() => {
    const next = new Set<string>()
    for (const list of [rows, pending]) {
      for (const entry of list) {
        const id = entry.view.id
        if (read.has(id)) continue
        if (
          entry.live
          || stored.unread.has(id)
          // Arrived while the console was closed: not among the ids the last visit knew.
          || (stored.known !== null && !stored.known.has(id))
        ) {
          next.add(id)
        }
      }
    }
    return next
  }, [rows, pending, read, stored])

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

  // Remember what is still unread (and what was known), per exercise, whenever it
  // changes (only after the baseline is in, so an early empty list never erases the last
  // visit's state).
  // Written synchronously: a page reload runs no React cleanup, so a debounce could lose
  // the last change. The value is small (bounded ids) and only written on a change.
  const lastWrittenRef = useRef<string | null>(null)
  useEffect(() => {
    if (!ready) return
    const unreadList: string[] = []
    const known: string[] = []
    for (const list of [rows, pending]) {
      for (const entry of list) {
        known.push(entry.view.id)
        if (unreadIds.has(entry.view.id)) unreadList.push(entry.view.id)
      }
    }
    const key = `${unreadList.join('|')}#${known.join('|')}`
    if (key === lastWrittenRef.current) return
    lastWrittenRef.current = key
    writeStoredReadState(scope, unreadList, known)
  }, [ready, scope, rows, pending, unreadIds])

  return { unreadIds, unreadCount, markRead, markAllRead }
}

/** Row elements carry these (see `LiveWorldRow`). */
const UNREAD_ROW_SELECTOR = '[data-live-world-row][data-unread="true"]'

/**
 * True while the controller can be looking at the column: the tab is visible and the
 * window has focus. A dwell only runs while this holds.
 */
export function isAttentive(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

interface SeenState {
  root: HTMLElement | null
  observer: IntersectionObserver | null
  /** Watched unread row elements and their post ids. */
  observed: Map<Element, string>
  /** Ids at least half visible right now (whether or not the controller is attentive). */
  visible: Set<string>
  /** Running dwell timers, by id. */
  timers: Map<string, ReturnType<typeof setTimeout>>
}

/**
 * Marks an unread row read once at least {@link READ_VISIBLE_RATIO} of it has been
 * visible inside `listRef`'s element for {@link READ_DWELL_MS} WHILE ATTENTIVE
 * ({@link isAttentive}). One IntersectionObserver for the whole list (rooted on it),
 * re-pointed incrementally after each render: a row that stays unread and stays mounted
 * keeps its observation AND its running dwell timer, so a burst of arrivals never
 * restarts the clock. A row scrolled out of view before the dwell completes stays
 * unread. Hiding the tab or leaving the window stops every dwell; coming back restarts
 * them for the rows then in view. A browser without IntersectionObserver marks nothing
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
  const stateRef = useRef<SeenState>({
    root: null,
    observer: null,
    observed: new Map(),
    visible: new Set(),
    timers: new Map(),
  })
  const markReadRef = useRef(markRead)
  useLayoutEffect(() => {
    markReadRef.current = markRead
  })

  /** Starts the dwell for `id` (once), if the controller is attentive. */
  const startDwell = useCallback((id: string) => {
    const state = stateRef.current
    if (state.timers.has(id) || !isAttentive()) return
    state.timers.set(id, setTimeout(() => {
      state.timers.delete(id)
      markReadRef.current(id)
    }, READ_DWELL_MS))
  }, [])

  const stopDwell = useCallback((id: string) => {
    const state = stateRef.current
    const timer = state.timers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      state.timers.delete(id)
    }
  }, [])

  useLayoutEffect(() => {
    const state = stateRef.current
    const list = listRef.current
    if (typeof IntersectionObserver === 'undefined') return

    // The list element came or went (it unmounts while nothing is listed): start over.
    if (state.root !== list) {
      state.observer?.disconnect()
      for (const timer of state.timers.values()) clearTimeout(timer)
      state.timers.clear()
      state.observed.clear()
      state.visible.clear()
      state.observer = null
      state.root = list
      if (list !== null) {
        state.observer = new IntersectionObserver(entries => {
          for (const entry of entries) {
            const id = state.observed.get(entry.target)
            if (id === undefined) continue
            if (entry.isIntersecting && entry.intersectionRatio >= READ_VISIBLE_RATIO) {
              state.visible.add(id)
              startDwell(id)
            } else {
              state.visible.delete(id)
              stopDwell(id)
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
        state.visible.delete(id)
        stopDwell(id)
      }
    }
    for (const [element, id] of current) {
      if (!state.observed.has(element)) {
        state.observed.set(element, id)
        observer.observe(element)
      }
    }
  }, [listRef, rowsTrigger, unreadTrigger, startDwell, stopDwell])

  // Attention comes and goes: stop every dwell on leaving, restart the visible ones on return.
  useEffect(() => {
    const state = stateRef.current
    const onAttentionChange = () => {
      if (isAttentive()) {
        for (const id of state.visible) startDwell(id)
      } else {
        for (const id of [...state.timers.keys()]) stopDwell(id)
      }
    }
    document.addEventListener('visibilitychange', onAttentionChange)
    window.addEventListener('focus', onAttentionChange)
    window.addEventListener('blur', onAttentionChange)
    return () => {
      document.removeEventListener('visibilitychange', onAttentionChange)
      window.removeEventListener('focus', onAttentionChange)
      window.removeEventListener('blur', onAttentionChange)
    }
  }, [startDwell, stopDwell])

  useEffect(() => {
    const state = stateRef.current
    return () => {
      state.observer?.disconnect()
      for (const timer of state.timers.values()) clearTimeout(timer)
      state.timers.clear()
      state.observed.clear()
      state.visible.clear()
      state.observer = null
      state.root = null
    }
  }, [])
}
