/**
 * features/portal/layout/ModuleLink.tsx
 * ---------------------------------------------------------------------------
 * An in-module link that reports its activation once (PC-6
 * `portal_module_click`). Tracking hangs off `onClick` only: a keyboard Enter
 * on a link already dispatches one click, so Enter never double-fires.
 * Host-relative paths only (FC-9.3).
 *
 * Unstyled on purpose: the module's skin styles it through `className`.
 * Participant world: no COBRA, no MUI component.
 */

import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { PortalModuleId } from '../contract'
import { usePortalFrameEnvironment } from './frameEnvironmentContext'
import type { PortalModuleClickTarget } from './types'

export interface ModuleLinkProps {
  readonly moduleId: PortalModuleId
  /** A host-relative path, typically a content permalink. */
  readonly to: string
  /** What the link opens (`contentId` becomes `payload.contentId`). */
  readonly target?: PortalModuleClickTarget
  readonly className?: string
  readonly onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
  readonly children: ReactNode
}

export function ModuleLink({ moduleId, to, target, className, onClick, children }: ModuleLinkProps) {
  const { trackClick } = usePortalFrameEnvironment()
  return (
    <Link
      to={to}
      className={className}
      onClick={event => {
        trackClick(moduleId, target)
        onClick?.(event)
      }}
    >
      {children}
    </Link>
  )
}
