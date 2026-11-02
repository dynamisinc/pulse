/**
 * features/participant-shell/channelRouter — the participant channel router
 * (channels-foundation 12, #708). Channels register through
 * `registerChannel` (`@/features/channels`); the composition root mounts
 * `<ChannelRouter>` inside `ShellLayout`.
 */

export { ChannelRouter } from './ChannelRouter'
export { resolveChannelPath, OUTSIDE_SHELL_SEGMENTS } from './resolveChannelPath'
export type { ChannelPathResolution } from './resolveChannelPath'
export { useNavigableChannels, toNavigableChannels } from './useNavigableChannels'
export type { NavigableChannel, NavigableChannels } from './useNavigableChannels'
export { rememberReturnTo, takeReturnTo, isSafeReturnToPath } from './returnTo'
