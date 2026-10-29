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
 *
 * **Fail closed.** While loading, `status` is `'loading'` (the guard renders a
 * quiet placeholder, never a premature not-found). On error it resolves to the
 * shell's documented safe default, Social only, exactly what `useChannelNav`
 * falls back to — so a disabled channel is never served because a request
 * failed.
 *
 * Exercise-scoped (XC-001): the exercise id keys the cache only; the server
 * scopes by session. World: participant. No UI here.
 */

import { useQuery } from '@tanstack/react-query'
import { useExerciseContext } from '@/core/exerciseContext'
import {
  channelNavConfigQueryKey,
  fetchChannelNavConfig,
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
}

const LOADING: EnabledChannels = {
  status: 'loading',
  enabledIds: new Set(),
  isEnabled: () => false,
}

function ready(enabledIds: ReadonlySet<string>): EnabledChannels {
  return { status: 'ready', enabledIds, isEnabled: channelId => enabledIds.has(channelId) }
}

const DEFAULT_READY = ready(DEFAULT_ENABLED_CHANNEL_IDS)

/** The enabled participant channels for the resolved exercise (see module header). */
export function useEnabledChannels(): EnabledChannels {
  const { exerciseId } = useExerciseContext()

  const { data, isError } = useQuery({
    queryKey: channelNavConfigQueryKey(exerciseId),
    queryFn: fetchChannelNavConfig,
    staleTime: 0,
    select: config => new Set(config.channels.map(channel => channel.id)) as ReadonlySet<string>,
  })

  if (data) return ready(data)
  return isError ? DEFAULT_READY : LOADING
}
