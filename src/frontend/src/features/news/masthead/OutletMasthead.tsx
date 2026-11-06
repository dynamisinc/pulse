/**
 * features/news/masthead/OutletMasthead.tsx
 * ---------------------------------------------------------------------------
 * The outlet masthead (story 03, D3-P1 slot 2, D3-P2; NWS-001/002/003): ONE
 * component, skin-selected variants. Name, tagline and logo come from the
 * outlet (`OutletDto`, F03's registry); layout, type and rule weights come only
 * from the skin's CSS custom properties plus `ext.news.masthead`:
 *
 *   tv-bar              accent bar, condensed name, optional live chip
 *   centered-nameplate  centred nameplate over a double rule
 *   wire-strip          left-aligned strip, kicker-family tagline
 *   tabloid-flag        loud flag on the breaking fill
 *
 * `ext.news.mastheadFill` (a band colour) and `ext.news.mastheadDoubleRule`
 * refine any variant; text on the fill is black or white via F13's `onColor`.
 *
 * A fifth outlet is a token file: nothing here names a skin key.
 *
 * No platform chrome (D3-P4): the only words drawn are the outlet's own (name,
 * tagline, categories), the nav's "Home"/"Sections", and the skin's own
 * `ext.news.liveChip` word, shown only when the page ALSO opts in
 * (`showLiveChip`). The chip is decorative branding, not a status claim, so it
 * has no live-region role.
 *
 * Heading order: the name is the page `h1` only where the page says so (the
 * outlet home); on article and section pages it is a `p` inside a labelled
 * region, so the article headline stays the `h1`.
 *
 * Props only, no fetching. It must sit inside the outlet's `OutletSkinScope`
 * (it reads `useSkin()`; fonts load lazily through that scope).
 *
 * World: participant. No COBRA, no default MUI look; FontAwesome only.
 */

import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { onColor, useSkin, type OutletDto } from '@/features/channels'
import '../skins/newsExtension'
import {
  liveChipLabel,
  mastheadDoubleRule,
  mastheadFill,
  mastheadVariant,
  newsHomePath,
  type SectionNavCurrent,
} from './mastheadModel'
import { SectionNav } from './SectionNav'
import styles from './OutletMasthead.module.css'

export interface OutletMastheadProps {
  /** The outlet (F03 registry). Only display fields are read. */
  readonly outlet: Pick<OutletDto, 'slug' | 'name' | 'tagline' | 'logo' | 'categories'>
  /** `'h1'` on the outlet home only; `'p'` (default) on article and section pages. */
  readonly nameAs?: 'h1' | 'p'
  /** The page's opt-in for the skin's live chip (shown only if the skin declares one). */
  readonly showLiveChip?: boolean
  /** The current nav entry; omit on an article page. */
  readonly current?: SectionNavCurrent
}

/** The skin-driven outlet masthead with its section nav. */
export function OutletMasthead({
  outlet,
  nameAs = 'p',
  showLiveChip = false,
  current,
}: OutletMastheadProps) {
  // The skin is the enclosing scope's, never a prop: the variant and the CSS
  // custom properties it draws with must come from the same tokens.
  const { tokens } = useSkin()
  const variant = mastheadVariant(tokens)
  const chip = showLiveChip ? liveChipLabel(tokens) : null
  const fill = mastheadFill(tokens)
  const doubleRule = mastheadDoubleRule(tokens, variant)
  // Text on the skin's band fill is black or white, whichever is AA (F13 `onColor`).
  const fillStyle = fill === null
    ? undefined
    : ({ '--news-masthead-fill': fill, '--news-masthead-on-fill': onColor(fill) } as CSSProperties)
  const NameTag = nameAs
  const tagline = outlet.tagline?.trim() ?? ''

  return (
    <section
      className={styles.root}
      data-masthead={variant}
      data-fill={fill === null ? 'false' : 'true'}
      data-double-rule={doubleRule ? 'true' : 'false'}
      style={fillStyle}
      aria-label={outlet.name}
    >
      <div className={styles.band}>
        <div className={styles.well}>
          <div className={styles.nameRow}>
            <NameTag className={styles.name}>
              <Link to={newsHomePath(outlet.slug)} className={styles.nameLink}>
                {outlet.logo
                  ? (
                    <img
                      className={styles.logo}
                      src={outlet.logo.url}
                      alt={outlet.name}
                      width={outlet.logo.width ?? undefined}
                      height={outlet.logo.height ?? undefined}
                    />
                  )
                  : outlet.name}
              </Link>
            </NameTag>
            {chip !== null && <span className={styles.liveChip}>{chip}</span>}
          </div>
          {tagline !== '' && <p className={styles.tagline}>{tagline}</p>}
        </div>
      </div>
      <SectionNav outlet={outlet} current={current} />
    </section>
  )
}
