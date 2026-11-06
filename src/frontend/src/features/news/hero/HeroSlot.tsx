/**
 * features/news/hero/HeroSlot.tsx
 * ---------------------------------------------------------------------------
 * D3-P1 slot 6: the article hero (news story 05; NWS-014, NWS-032, NFR-008, NFR-001,
 * D3-P2, D2-008). Presentational (E4-C2): `{ item, skin }` plus optional callbacks.
 *
 *  - No hero (or a `document`, which is never a hero): renders NOTHING, so the slot
 *    collapses with no gap and no placeholder art.
 *  - `image`: F14's `ContentMedia` with the EXERCISE chip (`watermark`), its required
 *    `alt`, the caption, and a box ratio from `skin.media.cropAggression` (CSS only; the
 *    source is never altered, see `heroModel.ts`).
 *  - `video`: the shared `BroadcastPlayer`, keyed by media id, with the caption below.
 *    The caption is the player's accessible description (`aria-describedby`).
 *  - CAPTION: styled by `skin.media.captionStyle` (plain / italic-serif / small-caps /
 *    shouty). The text is the author's, never transformed beyond CSS.
 *  - MOBILE: full-bleed to the content edge, square corners at phone width; the box is
 *    `width: 100%` at its aspect ratio, so it never forces horizontal scroll.
 *
 * Skins reach this slot ONLY through `skin.media.*` and the F13 custom properties; none
 * of them can address the EXERCISE chip (the FC-3b CANNOT list).
 * Participant world: CSS Module, no COBRA, no MUI.
 */

import { useId } from 'react'
import { ContentMedia } from '@/features/channels'
import type { ChannelContentSummaryDto, OutletSkinTokens } from '@/features/channels'
import { BroadcastPlayer } from './BroadcastPlayer'
import { CAPTION_STYLE_CLASS, croppedHeroMedia } from './heroModel'
import type { PlayProgressEvent } from './heroModel'
import styles from './HeroSlot.module.css'

export interface HeroSlotProps {
  /** The article (or a list row): only `hero` is read. */
  readonly item: Pick<ChannelContentSummaryDto, 'hero'>
  /** The outlet's finalized skin tokens (`useSkin().tokens` / `useOutletSkin`). */
  readonly skin: OutletSkinTokens
  /** Video hero: first play and 50% / 100% milestones (news story 19). */
  readonly onPlayProgress?: (event: PlayProgressEvent) => void
  /** Video hero: the in-app fullscreen fallback (no native fullscreen API). */
  readonly onRequestVideoModal?: (trigger: HTMLElement, startAt?: number) => void
}

export function HeroSlot({ item, skin, onPlayProgress, onRequestVideoModal }: HeroSlotProps) {
  const captionId = useId()
  const hero = item.hero
  if (hero === null || hero.kind === 'document') return null

  const captionClass = styles[CAPTION_STYLE_CLASS[skin.media.captionStyle]]
  const rootClass = [styles.hero, captionClass].filter(Boolean).join(' ')

  if (hero.kind === 'image') {
    return (
      <div className={rootClass} data-testid="news-hero" data-hero-kind="image">
        <ContentMedia media={croppedHeroMedia(hero, skin.media.cropAggression)} watermark />
      </div>
    )
  }

  const caption = hero.caption !== null && hero.caption.trim() !== '' ? hero.caption : null
  return (
    <figure className={rootClass} data-testid="news-hero" data-hero-kind="video">
      <BroadcastPlayer
        key={hero.id}
        media={hero}
        describedBy={caption !== null ? captionId : undefined}
        onPlayProgress={onPlayProgress}
        onRequestModal={onRequestVideoModal}
      />
      {caption !== null && (
        <figcaption id={captionId} className={styles.caption}>{caption}</figcaption>
      )}
    </figure>
  )
}
