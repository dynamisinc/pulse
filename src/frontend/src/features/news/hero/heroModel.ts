/**
 * features/news/hero/heroModel.ts
 * ---------------------------------------------------------------------------
 * Pure helpers behind the news hero slot (news story 05; NWS-014, NWS-032, NFR-008).
 * No React, no DOM.
 *
 *  - CROP: `skin.media.cropAggression` picks the hero BOX's aspect ratio only. The image
 *    fills it with `object-fit: cover`, so the source file is never altered (the URL and
 *    bytes are the contract's). `low` keeps the source's own ratio (within the shared
 *    player's 4:5..16:9 clamp), `medium` frames it 3:2, `high` forces the wide 16:9
 *    broadcast frame (the punchiest crop of a portrait or square photo).
 *  - PROGRESS: the 50% / 100% milestones the optional `onPlayProgress` callback reports
 *    (news story 19 turns them into `content_video_progress`; this story emits nothing).
 */

import type { CaptionStyle, ContentMediaDto, CropAggression } from '@/features/channels'

/** The box ratio for a crop aggression, or `undefined` for "the source's own ratio". */
export const CROP_BOX_RATIO: Readonly<Record<CropAggression, number | undefined>> = {
  low: undefined,
  medium: 3 / 2,
  high: 16 / 9,
}

/**
 * The hero image DTO `ContentMedia` should frame for this crop. Only the width / height
 * `ContentMedia` derives the box ratio from change; `url`, `alt` and every other field are
 * the contract's own (the source is never altered, only how much of it the box shows).
 */
export function croppedHeroMedia(
  media: ContentMediaDto,
  crop: CropAggression,
): ContentMediaDto {
  const ratio = CROP_BOX_RATIO[crop]
  if (ratio === undefined) return media
  // A 1000-wide reference box: ContentMedia only reads the ratio.
  return { ...media, width: 1000, height: Math.round(1000 / ratio) }
}

/** The caption treatments a skin may pick (styles in `HeroSlot.module.css`). */
export const CAPTION_STYLE_CLASS: Readonly<Record<CaptionStyle, string>> = {
  plain: 'captionPlain',
  'italic-serif': 'captionItalicSerif',
  'small-caps': 'captionSmallCaps',
  shouty: 'captionShouty',
}

/** What the optional `onPlayProgress` callback reports. */
export type PlayProgressEvent =
  | { readonly type: 'play' }
  | { readonly type: 'progress'; readonly pct: 50 | 100 }

/** The progress milestones, in order. */
export const PROGRESS_MILESTONES = [50, 100] as const

/**
 * The milestones newly reached at `currentTime`, given those already reported. A clip
 * within half a second of its end counts as 100% (`ended` can land a frame short).
 */
export function reachedMilestones(
  currentTime: number,
  duration: number | undefined,
  reported: ReadonlySet<number>,
): Array<50 | 100> {
  if (duration === undefined || !Number.isFinite(duration) || duration <= 0) return []
  if (!Number.isFinite(currentTime) || currentTime <= 0) return []
  const pct = currentTime >= duration - 0.5 ? 100 : (currentTime / duration) * 100
  return PROGRESS_MILESTONES.filter(milestone => pct >= milestone && !reported.has(milestone))
}

/** Remembers what has been reported for one media item (see `createProgressTracker`). */
export interface ProgressTracker {
  /** The events newly due for this playback state; each is returned once only. */
  readonly observe: (
    playing: boolean,
    currentTime: number,
    duration: number | undefined,
  ) => PlayProgressEvent[]
}

/**
 * The once-per-item play / 50% / 100% bookkeeping. Nothing is due before the first real
 * play (a poster render, metadata load or a scrub while paused reports nothing).
 */
export function createProgressTracker(): ProgressTracker {
  let played = false
  const reported = new Set<number>()
  return {
    observe(playing, currentTime, duration) {
      const due: PlayProgressEvent[] = []
      if (playing && !played) {
        played = true
        due.push({ type: 'play' })
      }
      if (!played) return due
      for (const pct of reachedMilestones(currentTime, duration, reported)) {
        reported.add(pct)
        due.push({ type: 'progress', pct })
      }
      return due
    },
  }
}
