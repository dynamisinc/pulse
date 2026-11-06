/**
 * features/weather/components/product/ProductImagery.tsx
 * ---------------------------------------------------------------------------
 * Product and forecast imagery (weather-source story 07, #758; WX-013, NFR-008,
 * D4-012). A thin wrapper over F14's `ContentMedia` that ALWAYS reserves the
 * bottom-right EXERCISE `WatermarkSlot` (every weather image is high-risk: a
 * radar or cone image reads as real), so the chip shows whenever the exercise
 * requires it and toggling it shifts nothing. `ContentMedia` supplies the
 * `ExerciseBands`, the safe-URL check and the non-empty alt text (a missing
 * `alt` becomes a placeholder and warns in dev).
 *
 * Participant world: no COBRA, no MUI.
 */

import { ContentMedia } from '@/features/channels/primitives'
import type { ContentMediaDto } from '@/features/channels/contract'

export interface ProductImageryProps {
  readonly media: ContentMediaDto
  /** Show the caption under the image / video. Default true. */
  readonly showCaption?: boolean
  /** The video player's in-app fullscreen fallback (see `ContentMedia`). */
  readonly onRequestVideoModal?: (trigger: HTMLElement, startAt?: number) => void
  readonly className?: string
}

export function ProductImagery({
  media,
  showCaption,
  onRequestVideoModal,
  className,
}: ProductImageryProps) {
  return (
    <ContentMedia
      media={media}
      watermark
      showCaption={showCaption}
      onRequestVideoModal={onRequestVideoModal}
      className={className}
    />
  )
}
