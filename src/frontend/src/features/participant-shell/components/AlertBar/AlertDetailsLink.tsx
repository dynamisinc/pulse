/**
 * features/participant-shell/components/AlertBar/AlertDetailsLink.tsx
 * ---------------------------------------------------------------------------
 * The alert bar's "Details →" link-through (PRT-012; channels-foundation
 * story 11 for `href`).
 *
 * THE RULE (`alertDetailsTarget`, in `alertsRoute.ts`). An alert with a
 * host-relative `href` (its source item: a weather warning, a news flash) goes
 * STRAIGHT to it. An alert with no `href` — a console alert — goes to `/alerts`, the
 * alerts history the participant channel registers (see
 * `features/social/layout/routes/AlertsRoute.tsx`). An `href` that is not
 * host-relative never becomes the target (COR-008): the source guard already
 * rejects one, and this re-checks so no caller can route a participant off
 * the exercise host.
 *
 * Inside a router (the real participant app) it renders a React Router
 * `<Link>`: a client-side navigation, so the exercise session, scroll caches,
 * and React Query state survive the hop. Outside a router (isolated component
 * tests, any future router-less mount) it degrades to a plain anchor with the
 * SAME `href`, so the affordance never throws and never changes target.
 *
 * World: participant. Plain React + inline style.
 */

import type { CSSProperties, ReactNode } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import { alertDetailsTarget } from './alertsRoute'

export interface AlertDetailsLinkProps {
  /** The alert's source target, if any. Absent or null opens the alerts history. */
  readonly href?: string | null
  /** Optional class, e.g. the bar's touch hit-area class (story 05). */
  readonly className?: string
  readonly style: CSSProperties
  /** Defaults to the bar's own test id. */
  readonly testId?: string
  readonly children: ReactNode
}

export function AlertDetailsLink({
  href,
  className,
  style,
  testId = 'pulse-alert-bar-details',
  children,
}: AlertDetailsLinkProps) {
  const inRouter = useInRouterContext()
  const target = alertDetailsTarget(href)
  if (inRouter) {
    return (
      <Link to={target} data-testid={testId} className={className} style={style}>
        {children}
      </Link>
    )
  }
  return (
    <a href={target} data-testid={testId} className={className} style={style}>
      {children}
    </a>
  )
}
