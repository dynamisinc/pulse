/**
 * features/social/layout/PulseLogo.tsx
 * ---------------------------------------------------------------------------
 * The Pulse heartbeat logomark (demo-polish F1; D1 "Nav rail (240px) -- Pulse
 * heartbeat logomark"). An original ECG-style line, drawn as a stroked inline SVG
 * so it takes the brand accent from the cascade (`currentColor`, set by the
 * parent to `var(--pc-accent)` -> the per-exercise `--pulse-ac`, COR-030) and
 * rebrands with the exercise instead of shipping a fixed raster.
 *
 * Decorative by default (`aria-hidden`): the surrounding link carries the
 * accessible name ("Pulse home"). The shape is the mark itself -- the line
 * crossing a baseline with one tall spike -- so it does not rely on color to be
 * recognisable (NFR-001).
 *
 * World: participant. Pure SVG, no COBRA, no MUI, no icon-library dependency.
 */

export interface PulseLogoProps {
  /** Rendered square size in px. Defaults to 32. */
  size?: number
}

export function PulseLogo({ size = 32 }: PulseLogoProps) {
  return (
    <svg
      data-testid="pulse-logo"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 17h6l3.5-9 5 17 3.5-8H29" />
    </svg>
  )
}
