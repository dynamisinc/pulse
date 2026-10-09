/**
 * features/social/components/Avatar.tsx
 * ---------------------------------------------------------------------------
 * The avatar primitive (R-004 — docs/design/DECISIONS.md cross-surface
 * reconciliation; COR-024 photo library, demo-polish F5).
 *
 * PHOTO FIRST. When the persona carries an `avatarUrl` (the COR-024 library
 * image, `GET /api/personas`), the avatar is that image: a circular
 * `<img alt="" loading="lazy">` filling the circle. The circle's own
 * `avatarColor` shows while it loads.
 *
 * FALLBACK. With no `avatarUrl`, an unsafe one (see `safeImageUrl`), or an
 * image that FAILS to load (`onError`), the avatar renders the R-004 treatment
 * that predates photos. Raw initials are RETIRED as of that decision:
 *
 *  - `kind === 'org'`   -> a monogram: the persona's `initials`, centered on a
 *                          circle filled with `avatarColor` (logo-analog;
 *                          also preserves the intentionally near-identical
 *                          @FairhavenWater / @FairhavenWaterUpd impersonation
 *                          pair, SOC-052 — both are orgs, both get monograms).
 *                          Blank initials (a name with no letter or digit, e.g.
 *                          all emoji; the server derives initials from letters and
 *                          digits only) fall back to the silhouette below, never an
 *                          empty disc.
 *  - `kind === 'human'` -> a duotone head-and-shoulders SILHOUETTE (a simple
 *                          inline SVG shape, ~85% white) over `avatarColor`.
 *                          Offline-safe, no photo dependency.
 *
 * NO LOOKALIKE CUE (SOC-052). `AvatarPersona` deliberately has no `verified`
 * (or any trust) member, so this component CANNOT treat an unverified account
 * differently: an impersonator may use a near-identical photo and gets exactly
 * the same rendering as the real account. Verification is shown by the
 * `<VerifiedMark>` seal's presence or absence, nowhere else.
 *
 * Decorative only: the wrapper is `aria-hidden` and the image has `alt=""` —
 * the post card's name/handle text carries the author's identity for assistive
 * tech, not the avatar graphic.
 *
 * This is a cross-surface primitive (R-004 note on `PostCard.tsx`): the E7
 * staff console imports the same component rather than re-styling its own
 * avatar treatment. Kept deliberately free of any `social.module.css`
 * dependency so a consumer never has to pull in Pulse's post-card stylesheet
 * just to render an avatar; sizing/color are applied via inline style from
 * props/persona data only.
 *
 * World: participant (Pulse skin) — reused verbatim by the staff console;
 * no COBRA/MUI dependency either way.
 */

import { useState } from 'react'
import type { Persona } from '@/features/personas'
import { safeImageUrl } from '../utils/safeImageUrl'

/**
 * The subset of `Persona` an avatar needs to render (kept minimal and reusable).
 * `avatarUrl` is optional on `Persona`, so existing literals keep compiling. There
 * is no `verified` here on purpose (SOC-052 — see the module header).
 */
export type AvatarPersona = Pick<
  Persona,
  'kind' | 'avatarColor' | 'initials' | 'displayName' | 'avatarUrl'
>

export interface AvatarProps {
  persona: AvatarPersona
  /** Diameter in px. Defaults to the post-card scale (42px, R-004). */
  size?: number
}

const DEFAULT_SIZE = 42

export function Avatar({ persona, size = DEFAULT_SIZE }: AvatarProps) {
  const dimension = `${size}px`

  // The url that last failed to load. Keyed by URL (not a boolean) so a persona
  // whose `avatarUrl` later CHANGES gets a fresh attempt without an effect/reset.
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined)
  const candidate = safeImageUrl(persona.avatarUrl)
  const imageUrl = candidate !== undefined && candidate !== failedUrl ? candidate : undefined

  return (
    <span
      aria-hidden="true"
      data-testid="post-avatar"
      data-avatar-kind={persona.kind}
      data-avatar-image={imageUrl !== undefined ? 'photo' : 'fallback'}
      style={{
        width: dimension,
        height: dimension,
        backgroundColor: persona.avatarColor,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        borderRadius: '999px',
        overflow: 'hidden',
      }}
    >
      {imageUrl !== undefined ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedUrl(imageUrl)}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: '999px',
          }}
        />
      ) : persona.kind === 'org' && persona.initials.trim() !== '' ? (
        <span
          style={{
            color: '#fff',
            fontFamily: "'Figtree', system-ui, sans-serif",
            fontWeight: 700,
            fontSize: `${Math.round(size * 0.38)}px`,
            lineHeight: 1,
          }}
        >
          {persona.initials}
        </span>
      ) : (
        <svg viewBox="0 0 100 100" width="70%" height="70%" focusable="false">
          <circle cx="50" cy="38" r="20" fill="#fff" fillOpacity="0.85" />
          <path d="M14 100c0-24 16-40 36-40s36 16 36 40" fill="#fff" fillOpacity="0.85" />
        </svg>
      )}
    </span>
  )
}
