/**
 * features/controller/runSheet/useInjectQueue.ts
 * ---------------------------------------------------------------------------
 * The run sheet's SERVER STATE (inject-queue story 07; IQ-6 "Live sync"). STAFF
 * world, React Query 5, no UI.
 *
 * WHAT IT DOES
 *   - READS `GET /api/injects` with `refetchInterval: 3000` (`INJECT_POLL_MS`),
 *     NOT in a background tab (`refetchIntervalInBackground: false`), so another
 *     controller's fire / hold / skip / edit shows here within ~3 s, and a burst's
 *     "firing n/m" advances live. No SignalR on purpose (IQ-6: B5 is reworking the
 *     realtime groups in this push; the staff push moves there after the demo).
 *   - EXPOSES the mutations — fire, hold, release, skip, unskip, retry, remove
 *     (delete), create, update, reorder — each of which refreshes the list
 *     IMMEDIATELY (it patches the cache from the server's reply, then invalidates
 *     the query, which cancels any in-flight poll so a stale poll can't overwrite
 *     the fresher reply).
 *   - A 409 carries the item's CURRENT state (`InjectConflictError.item`); that
 *     is patched into the cache too, so the row is fresh without a second call.
 *
 * ONE ACTION AT A TIME PER ROW. Every action takes a per-item in-flight lock
 * BEFORE any await (a ref, not state, so two presses inside one React batch still
 * collide): a second press while the first is in flight returns `{ status: 'busy' }`
 * and sends NOTHING. That is what makes "Fire is disabled while in flight, so a
 * double press fires once" true even for the keyboard auto-repeat of `F`.
 * `busyIds` mirrors the lock into state so rows can disable their buttons.
 *
 * ACTIONS NEVER REJECT. They resolve to an `ActionOutcome` (`ok` | `busy` |
 * `error`), so the panel decides what each failure means to a controller (409 ->
 * "Already fired by …", 400 -> field messages) in one place instead of every call
 * site remembering a try/catch.
 *
 * SCOPE. Cache keys carry the exercise id so a re-scope can never show another
 * exercise's rows (COR-001); the id is a CACHE KEY only — it is never sent: the
 * server scopes by session. NO telemetry here (IQ-8): the server emits the single
 * `inject_action` event per action.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useExerciseContext } from '@/core/exerciseContext'
import { InjectConflictError } from './injectErrors'
import { getInjectService } from './injectService'
import type { InjectQueueRead } from './injectGuards'
import type {
  InjectItemDto,
  InjectItemWrite,
  InjectQueueDto,
} from './types'

/** How often the open panel re-reads the queue (IQ-6). */
export const INJECT_POLL_MS = 3000

/** Cache keys. The exercise id is part of the key (never of a request). */
export const injectQueryKeys = {
  all: (exerciseId: string) => ['injects', exerciseId] as const,
  queue: (exerciseId: string) => ['injects', exerciseId, 'queue'] as const,
  assignees: (exerciseId: string) => ['injects', exerciseId, 'assignees'] as const,
}

/** What an action resolved to. Never a rejection. */
export type ActionOutcome<T> =
  | { readonly status: 'ok'; readonly value: T }
  /** Another action on the same row was already in flight; nothing was sent. */
  | { readonly status: 'busy' }
  | { readonly status: 'error'; readonly error: unknown }

/** Lock keys for actions that are not tied to one row (they appear in `busyIds`). */
export const CREATE_LOCK = '*create'
export const REORDER_LOCK = '*reorder'

export interface UseInjectQueueResult {
  /** Every item in `order`; empty until the first read lands. */
  readonly items: readonly InjectItemDto[]
  /**
   * Ids of queue items the server sent that this build could not render (malformed data). They
   * are DROPPED from `items`; the panel shows a staff-only warning so a shorter sheet is never
   * mistaken for "nothing scripted". Empty when every item rendered.
   */
  readonly droppedItemIds: readonly string[]
  /** The pause tier the server reported (`running` until the first read lands). */
  readonly pauseTier: InjectQueueDto['pauseTier']
  /** True until the first read resolves (success or failure). */
  readonly isLoading: boolean
  /** The first read failed and there is nothing to show. */
  readonly isError: boolean
  /** A later poll failed; the rows shown are the last good read. */
  readonly connectionLost: boolean
  readonly refetch: () => Promise<unknown>
  /** Row ids (or `*create` / `*reorder`) with an action in flight. */
  readonly busyIds: ReadonlySet<string>

  readonly fire: (id: string) => Promise<ActionOutcome<InjectItemDto>>
  readonly hold: (id: string) => Promise<ActionOutcome<InjectItemDto>>
  readonly release: (id: string) => Promise<ActionOutcome<InjectItemDto>>
  readonly skip: (id: string) => Promise<ActionOutcome<InjectItemDto>>
  readonly unskip: (id: string) => Promise<ActionOutcome<InjectItemDto>>
  readonly retry: (id: string) => Promise<ActionOutcome<InjectItemDto>>
  readonly remove: (id: string, version: number) => Promise<ActionOutcome<void>>
  readonly create: (body: InjectItemWrite) => Promise<ActionOutcome<InjectItemDto>>
  readonly update: (
    id: string,
    body: InjectItemWrite,
    version: number,
  ) => Promise<ActionOutcome<InjectItemDto>>
  readonly reorder: (ids: string[]) => Promise<ActionOutcome<InjectQueueRead>>
}

const byOrder = (a: InjectItemDto, b: InjectItemDto): number => a.order - b.order

const EMPTY_ITEMS: readonly InjectItemDto[] = []
const NO_DROPPED: readonly string[] = []

export function useInjectQueue(): UseInjectQueueResult {
  const { exerciseId } = useExerciseContext()
  const queryClient = useQueryClient()
  const queueKey = useMemo(() => injectQueryKeys.queue(exerciseId), [exerciseId])

  const query = useQuery({
    queryKey: queueKey,
    queryFn: () => getInjectService().list(),
    refetchInterval: INJECT_POLL_MS,
    refetchIntervalInBackground: false,
    // The shared client's 60 s staleTime would make mount/refocus reads a no-op.
    staleTime: 0,
  })

  // ----- cache patching ----------------------------------------------------

  /** Puts a fresher item in the cache (or adds a new one); never moves a row backwards. */
  const applyItem = useCallback(
    (item: InjectItemDto): void => {
      queryClient.setQueryData<InjectQueueRead>(queueKey, previous => {
        if (!previous) return previous
        const index = previous.items.findIndex(candidate => candidate.id === item.id)
        if (index === -1) {
          return { ...previous, items: [...previous.items, item].sort(byOrder) }
        }
        if ((previous.items[index]?.version ?? 0) > item.version) return previous
        const items = previous.items.slice()
        items[index] = item
        return { ...previous, items }
      })
    },
    [queryClient, queueKey],
  )

  const dropItem = useCallback(
    (id: string): void => {
      queryClient.setQueryData<InjectQueueRead>(queueKey, previous =>
        previous
          ? { ...previous, items: previous.items.filter(candidate => candidate.id !== id) }
          : previous,
      )
    },
    [queryClient, queueKey],
  )

  /**
   * Applies a reorder's result as ORDER ONLY. The reply is a snapshot taken when the server handled
   * the reorder; row actions and deletes use independent locks, so a delayed reply can be older
   * than what the cache already holds (a Fire that landed meanwhile, a row since deleted).
   * Replacing the cache with it would roll those back until the next successful read. So each
   * cached row keeps its OWN content (and so its version guard) and takes only its new `order`;
   * a row missing from the reply is left alone, and a row we already dropped is not resurrected.
   * The invalidation that follows every mutation reconciles anything this leaves out.
   */
  const applyOrder = useCallback(
    (reply: InjectQueueRead): void => {
      const orders = new Map(reply.items.map(item => [item.id, item.order]))
      queryClient.setQueryData<InjectQueueRead>(queueKey, previous => {
        if (!previous) return previous
        const items = previous.items
          .map(item => {
            const order = orders.get(item.id)
            return order === undefined ? item : { ...item, order }
          })
          .sort(byOrder)
        return { ...previous, items }
      })
    },
    [queryClient, queueKey],
  )

  /** Cancels any in-flight poll and re-reads now, so a mutation shows up immediately. */
  const refreshNow = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: queueKey })
  }, [queryClient, queueKey])

  /** A refused write still tells us the item's current state — show it. */
  const onItemError = useCallback(
    (error: unknown): void => {
      if (error instanceof InjectConflictError && error.item) applyItem(error.item)
    },
    [applyItem],
  )

  const itemHandlers = { onSuccess: applyItem, onError: onItemError, onSettled: refreshNow }

  // ----- mutations ---------------------------------------------------------

  const { mutateAsync: fireAsync } = useMutation({
    mutationFn: (id: string) => getInjectService().fire(id),
    ...itemHandlers,
  })
  const { mutateAsync: holdAsync } = useMutation({
    mutationFn: (id: string) => getInjectService().hold(id),
    ...itemHandlers,
  })
  const { mutateAsync: releaseAsync } = useMutation({
    mutationFn: (id: string) => getInjectService().release(id),
    ...itemHandlers,
  })
  const { mutateAsync: skipAsync } = useMutation({
    mutationFn: (id: string) => getInjectService().skip(id),
    ...itemHandlers,
  })
  const { mutateAsync: unskipAsync } = useMutation({
    mutationFn: (id: string) => getInjectService().unskip(id),
    ...itemHandlers,
  })
  const { mutateAsync: retryAsync } = useMutation({
    mutationFn: (id: string) => getInjectService().retry(id),
    ...itemHandlers,
  })
  const { mutateAsync: createAsync } = useMutation({
    mutationFn: (body: InjectItemWrite) => getInjectService().create(body),
    ...itemHandlers,
  })
  const { mutateAsync: updateAsync } = useMutation({
    mutationFn: (vars: { id: string; body: InjectItemWrite; version: number }) =>
      getInjectService().update(vars.id, vars.body, vars.version),
    ...itemHandlers,
  })
  const { mutateAsync: removeAsync } = useMutation({
    mutationFn: (vars: { id: string; version: number }) =>
      getInjectService().remove(vars.id, vars.version),
    onSuccess: (_void: void, vars: { id: string; version: number }) => dropItem(vars.id),
    onError: onItemError,
    onSettled: refreshNow,
  })
  const { mutateAsync: reorderAsync } = useMutation({
    mutationFn: (ids: string[]) => getInjectService().reorder(ids),
    onSuccess: applyOrder,
    onSettled: refreshNow,
  })

  // ----- per-row in-flight lock -------------------------------------------

  const inFlight = useRef(new Set<string>())
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set())

  const guarded = useCallback(
    async <T>(lock: string, work: () => Promise<T>): Promise<ActionOutcome<T>> => {
      // Synchronous check-and-set BEFORE the first await: two presses in one tick collide here.
      if (inFlight.current.has(lock)) return { status: 'busy' }
      inFlight.current.add(lock)
      setBusyIds(new Set(inFlight.current))
      try {
        return { status: 'ok', value: await work() }
      } catch (error) {
        return { status: 'error', error }
      } finally {
        inFlight.current.delete(lock)
        setBusyIds(new Set(inFlight.current))
      }
    },
    [],
  )

  const fire = useCallback((id: string) => guarded(id, () => fireAsync(id)), [guarded, fireAsync])
  const hold = useCallback((id: string) => guarded(id, () => holdAsync(id)), [guarded, holdAsync])
  const release = useCallback(
    (id: string) => guarded(id, () => releaseAsync(id)),
    [guarded, releaseAsync],
  )
  const skip = useCallback((id: string) => guarded(id, () => skipAsync(id)), [guarded, skipAsync])
  const unskip = useCallback(
    (id: string) => guarded(id, () => unskipAsync(id)),
    [guarded, unskipAsync],
  )
  const retry = useCallback(
    (id: string) => guarded(id, () => retryAsync(id)),
    [guarded, retryAsync],
  )
  const remove = useCallback(
    (id: string, version: number) => guarded(id, () => removeAsync({ id, version })),
    [guarded, removeAsync],
  )
  const create = useCallback(
    (body: InjectItemWrite) => guarded(CREATE_LOCK, () => createAsync(body)),
    [guarded, createAsync],
  )
  const update = useCallback(
    (id: string, body: InjectItemWrite, version: number) =>
      guarded(id, () => updateAsync({ id, body, version })),
    [guarded, updateAsync],
  )
  const reorder = useCallback(
    (ids: string[]) => guarded(REORDER_LOCK, () => reorderAsync(ids)),
    [guarded, reorderAsync],
  )

  const { data, refetch } = query

  return {
    items: data?.items ?? EMPTY_ITEMS,
    droppedItemIds: data?.droppedItemIds ?? NO_DROPPED,
    pauseTier: data?.pauseTier ?? 'running',
    isLoading: query.isPending,
    isError: query.isError && data === undefined,
    connectionLost: query.isRefetchError,
    refetch,
    busyIds,
    fire,
    hold,
    release,
    skip,
    unskip,
    retry,
    remove,
    create,
    update,
    reorder,
  }
}
