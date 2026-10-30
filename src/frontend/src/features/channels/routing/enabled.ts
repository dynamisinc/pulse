/**
 * features/channels/routing/enabled.ts
 * ---------------------------------------------------------------------------
 * `useEnabledChannels()` — the client half of the channel enablement gate
 * (channels-foundation 08, #704; PRT-003, COR-030, D2-005).
 *
 * **One source.** It derives from `GET /api/channel-nav-config` through the
 * participant shell's own query (`channelNavConfigQueryKey` +
 * `fetchChannelNavConfig`), so it shares the shell nav's cache entry: the nav
 * strip and `<ChannelRoute>` cannot disagree. The server gate
 * (`RequireChannelEnabled`) resolves the same stored value through the same
 * rule, so all three agree.
 *
 * **Live.** This observer uses `staleTime: 0`, so mounting a guarded channel
 * route refetches: a planner's toggle applies on the participant's next
 * navigation without a reload. The shell nav sees the refreshed entry too.
 * `isRefreshing` is true while that refetch is in flight over cached data, so
 * the guard can hold a not-found until the fresh answer lands.
 *
 * **Fail closed.** While loading, `status` is `'loading'` (the guard renders a
 * quiet placeholder, never a premature not-found). On error it resolves to the
 * shell's documented safe default, Social only, exactly what `useChannelNav`
 * falls back to — so a disabled channel is never served because a request
 * failed. (The shared query client retries once first, so the fallback lands
 * after that retry.)
 *
 * Exercise-scoped (XC-001): the exercise id keys the cache only; the server
 * scopes by session. World: participant. No UI here.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useExerciseContext } from '@/core/exerciseContext'
import {
  channelNavConfigQueryKey,
  fetchChannelNavConfig,
  type ChannelNavConfig,
} from '@/features/participant-shell/channelNavConfig'

/** The pilot default (Master §4): Social only. Also the fail-closed fallback. */
export const DEFAULT_ENABLED_CHANNEL_IDS: ReadonlySet<string> = new Set(['social'])

/** The resolved enabled set, or `'loading'` before the first answer. */
export interface EnabledChannels {
  readonly status: 'loading' | 'ready'
  /** The enabled channel ids. Empty while loading. */
  readonly enabledIds: ReadonlySet<string>
  /** Whether `channelId` is enabled. Always `false` while loading. */
  readonly isEnabled: (channelId: string) => boolean
  /** A refetch is in flight over cached data (the cached answer may be stale). */
  readonly isRefreshing: boolean
}

function toEnabledIds(config: ChannelNavConfig): ReadonlySet<string> {
  return new Set(config.channels.map(channel => channel.id))
}

function resolve(enabledIds: ReadonlySet<string> | null, isRefreshing: boolean): EnabledChannels {
  if (enabledIds === null) {
    return { status: 'loading', enabledIds: new Set(), isEnabled: () => false, isRefreshing }
  }
  return {
    status: 'ready',
    enabledIds,
    isEnabled: channelId => enabledIds.has(channelId),
    isRefreshing,
  }
}

/** The enabled participant channels for the resolved exercise (see module header). */
export function useEnabledChannels(): EnabledChannels {
  const { exerciseId } = useExerciseContext()

  const { data, isError, isFetching } = useQuery({
    queryKey: channelNavConfigQueryKey(exerciseId),
    queryFn: fetchChannelNavConfig,
    staleTime: 0,
  })

  const enabledIds = useMemo(() => (data ? toEnabledIds(data) : null), [data])
  const resolvedIds = enabledIds ?? (isError ? DEFAULT_ENABLED_CHANNEL_IDS : null)
  const isRefreshing = isFetching && enabledIds !== null

  return useMemo(() => resolve(resolvedIds, isRefreshing), [resolvedIds, isRefreshing])
}
