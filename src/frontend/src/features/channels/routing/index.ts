/**
 * features/channels/routing — FC-8 `routing/`. Story 08 ships the enablement
 * guard (`useEnabledChannels`, `<ChannelRoute>`) and the baseline
 * `ChannelNotFound`; story 12 adds the channel registry and router.
 */

export { useEnabledChannels, DEFAULT_ENABLED_CHANNEL_IDS } from './enabled'
export type { EnabledChannels } from './enabled'
export { ChannelRoute } from './ChannelRoute'
export type { ChannelRouteProps } from './ChannelRoute'
export { ChannelNotFound } from './ChannelNotFound'
export { ChannelPending } from './ChannelPending'
export { useChannelTitle } from './useChannelTitle'
export {
  registerChannel,
  useRegisteredChannels,
  getRegisteredChannels,
  findChannelForPath,
  channelNavPath,
  channelPathPrefix,
  ROOT_CHANNEL_ID,
} from './registry'
export type { ChannelRegistration } from './registry'
