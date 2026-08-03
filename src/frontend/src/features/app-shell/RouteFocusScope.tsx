/**
 * features/app-shell/RouteFocusScope.tsx
 * ---------------------------------------------------------------------------
 * A programmatic-only focus target that moves focus to the top of a surface
 * whenever `focusKey` changes — i.e. on a world change (participant ⇄ staff) or
 * a staff route change — so focus is never stranded on `<body>` (NFR-001).
 *
 * Extracted from `RoleAwareEntry.tsx` when staff routing became a nested route
 * tree: BOTH the participant branch (`RoleAwareEntry`, one scope for the whole
 * participant world) and each staff route (`StaffRouteTree`, one scope per
 * surface so back/forward between staff surfaces re-announces) need it, and a
 * shared component is the only way those two stay identical.
 *
 * Deliberately world-neutral: a plain `<div>` with an inline style — no MUI, no
 * theme, no router — so it is safe to wrap EITHER world. In particular it reads
 * NO location: it is on the participant render path, which must stay completely
 * location-blind (COR-004; mechanically asserted by
 * `participantLocationBlindness.test.ts`).
 *
 * It carries NO landmark role — the surfaces own their own `<main>`/regions, and
 * a competing landmark here would double the landmark list in a screen reader.
 */

import { useEffect, useRef, type ReactNode } from 'react'

export interface RouteFocusScopeProps {
  /** Changing this re-focuses the scope. Use a stable per-surface identifier. */
  focusKey: string
  /** Announced when focus lands here (e.g. the surface's label). */
  label: string
  children: ReactNode
}

export function RouteFocusScope({ focusKey, label, children }: RouteFocusScopeProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [focusKey])

  return (
    <div
      ref={ref}
      tabIndex={-1}
      aria-label={label}
      data-app-shell-focus-scope={focusKey}
      style={{ outline: 'none' }}
    >
      {children}
    </div>
  )
}
