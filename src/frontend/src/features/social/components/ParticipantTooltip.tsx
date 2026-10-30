/**
 * features/social/components/ParticipantTooltip.tsx
 * ---------------------------------------------------------------------------
 * Re-export shim (channels-foundation 14): the implementation moved to
 * `@/core/media/player/ParticipantTooltip` so channels can use the player without Social chrome
 * (news FU-9). Kept so Social's imports are unchanged.
 */

export {
  ParticipantTooltip,
  TOOLTIP_HIDE_GRACE_MS,
  TOOLTIP_HOVER_DELAY_MS,
} from '@/core/media/player/ParticipantTooltip'
export type { ParticipantTooltipProps } from '@/core/media/player/ParticipantTooltip'
