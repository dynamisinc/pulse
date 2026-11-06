/**
 * features/portal/layout/ModuleLink.tsx
 * ---------------------------------------------------------------------------
 * An in-module link that reports its activation once (PC-6
 * `portal_module_click`). Tracking hangs off `onClick` only: a keyboard Enter
 * on a link already dispatches one click, so Enter never double-fires.
 * Host-relative paths only (FC-9.3). Every other router `Link` prop
 * (`aria-label`, `ref`, `state`, ...) passes through, so a module never needs
 * a bare `Link` (which would lose the click event).
 *
 * Base styles only (a 44 px touch target, a visible focus ring); the module's
 * skin styles it through `className`, added after the base class (equal
 * specificity, so where the two set the same property the stylesheet loaded
 * later wins; the base only sets focus outline and coarse-pointer sizing).
 * Participant world: no COBRA, no MUI component.
 */

import type { RefAttributes } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import type { PortalModuleId } from '../contract'
import { usePortalFrameEnvironment } from './frameEnvironmentContext'
import type { PortalModuleClickTarget } from './types'
import styles from './ModuleLink.module.css'

export interface ModuleLinkProps extends Omit<LinkProps, 'to'>, RefAttributes<HTMLAnchorElement> {
  readonly moduleId: PortalModuleId
  /** A host-relative path, typically a content permalink. */
  readonly to: string
  /** What the link opens (`contentId` becomes `payload.contentId`). */
  readonly clickTarget?: PortalModuleClickTarget
}

export function ModuleLink(props: ModuleLinkProps) {
  const { moduleId, to, clickTarget, onClick, className, ...linkProps } = props
  const { trackClick } = usePortalFrameEnvironment()
  return (
    <Link
      {...linkProps}
      to={to}
      className={className ? `${styles.link} ${className}` : styles.link}
      onClick={event => {
        trackClick(moduleId, clickTarget)
        onClick?.(event)
      }}
    />
  )
}
