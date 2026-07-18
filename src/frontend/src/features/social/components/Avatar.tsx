/**
 * features/social/components/Avatar.tsx
 * ---------------------------------------------------------------------------
 * The interim avatar treatment (R-004 — docs/design/DECISIONS.md cross-surface
 * reconciliation) until the COR-024 photo library lands. Raw initials are
 * RETIRED as of this decision:
 *
 *  - `kind === 'org'`   -> a monogram: the persona's `initials`, centered on a
 *                          circle filled with `avatarColor` (logo-analog;
 *                          also preserves the intentionally near-identical
 *                          @FairhavenWater / @FairhavenWaterUpd impersonation
 *                          pair, SOC-052 — both are orgs, both get monograms).
 *  - `kind === 'human'` -> a duotone head-and-shoulders SILHOUETTE (a simple
 *                          inline SVG shape, ~85% white) over `avatarColor`.
 *                          Offline-safe, no photo dependency.
 *
 * Decorative only: `aria-hidden`, no alt text duplicated here — the post
 * card's name/handle text carries the author's identity for assistive tech,
 * not the avatar graphic.
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

import type { Persona } from '@/features/personas'

/** The subset of `Persona` an avatar needs to render (kept minimal and reusable). */
export type AvatarPersona = Pick<Persona, 'kind' | 'avatarColor' | 'initials' | 'displayName'>

export interface AvatarProps {
  persona: AvatarPersona
  /** Diameter in px. Defaults to the post-card scale (42px, R-004). */
  size?: number
}

const DEFAULT_SIZE = 42

export function Avatar({ persona, size = DEFAULT_SIZE }: AvatarProps) {
  const dimension = `${size}px`

  return (
    <span
      aria-hidden="true"
      data-testid="post-avatar"
      data-avatar-kind={persona.kind}
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
      {persona.kind === 'org' ? (
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
