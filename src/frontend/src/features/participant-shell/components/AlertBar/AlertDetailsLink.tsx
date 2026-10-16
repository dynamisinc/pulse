/**
 * features/participant-shell/components/AlertBar/AlertDetailsLink.tsx
 * ---------------------------------------------------------------------------
 * The alert bar's "Details →" link-through (PRT-012).
 *
 * Targets {@link ALERTS_PATH} — the alerts view the participant channel
 * registers (see `features/social/layout/routes/AlertsRoute.tsx`). Before this
 * route existed the link fell through to the social `/:handle` profile route
 * and rendered "This account doesn't exist".
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
import { ALERTS_PATH } from './alertsRoute'

export interface AlertDetailsLinkProps {
  /** Optional class, e.g. the bar's touch hit-area class (story 05). */
  readonly className?: string
  readonly style: CSSProperties
  readonly children: ReactNode
}

export function AlertDetailsLink({ className, style, children }: AlertDetailsLinkProps) {
  const inRouter = useInRouterContext()
  if (inRouter) {
    return (
      <Link to={ALERTS_PATH} data-testid="pulse-alert-bar-details" className={className} style={style}>
        {children}
      </Link>
    )
  }
  return (
    <a href={ALERTS_PATH} data-testid="pulse-alert-bar-details" className={className} style={style}>
      {children}
    </a>
  )
}
