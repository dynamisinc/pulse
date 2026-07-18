/**
 * features/social/components/VerifiedMark.tsx
 * ---------------------------------------------------------------------------
 * The canonical scallop-with-check verified seal (SOC-002/SOC-052, D1-003,
 * cross-surface reconciliation R-001 — see docs/design/DECISIONS.md). This is
 * the DESIGN-LOCKED mark: the exact SVG path data below is the one true seal
 * shared by every Pulse surface AND the staff Controller Console (R-001
 * replaced three ad-hoc theme-colored console marks with this one, precisely
 * because a trust signal must never derive from theme color).
 *
 * Fixed seal-blue (`SEAL_BLUE`, `#2D9CDB`) — NEVER the per-exercise accent.
 * The fill is set directly on the SVG path, not via a CSS custom property, so
 * no ancestor stylesheet (not even a future `BrandThemeProvider`) can ever
 * recolor it. Rebranding an exercise must never alter the trust signal
 * trainees are being trained to read (COR-030, SOC-052).
 *
 * Accessibility (NFR-001): this is a SHAPE + COLOR seal, not a color-only
 * signal — `role="img"` + `aria-label` + a `<title>` announce it to assistive
 * tech. Per SOC-052/D1-008, the mark's ABSENCE is equally meaningful: an
 * unverified account must render NO mark and NO substitute "unverified"
 * badge (the platform never flags an impersonator) — callers achieve that by
 * simply not rendering this component, never by rendering it in a "muted" or
 * "unverified" state.
 *
 * World: participant (Pulse skin) — reused verbatim on the staff console
 * (R-001); no COBRA/MUI dependency either way.
 */

import { SEAL_BLUE } from '../theme/tokens'

export interface VerifiedMarkProps {
  /** Rendered width/height in px. Defaults to the post-card scale (16px). */
  size?: number
}

const DEFAULT_SIZE = 16

export function VerifiedMark({ size = DEFAULT_SIZE }: VerifiedMarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label="Verified account"
      data-testid="verified-mark"
    >
      <title>Verified account</title>
      <path
        fill={SEAL_BLUE}
        d="M22.25 12l-2.05-2.35.3-3.1-3.05-.7L15.9 3.1 13 4.3 10.1 3.1 8.55 5.85l-3.05.7.3 3.1L3.75 12l2.05 2.35-.3 3.1 3.05.7 1.55 2.75L13 19.7l2.9 1.2 1.55-2.75 3.05-.7-.3-3.1z"
      />
      <path
        fill="#fff"
        d="M11.1 15.4l-3.2-3.2 1.25-1.25 1.95 1.95 4.75-4.75 1.25 1.25z"
      />
    </svg>
  )
}
