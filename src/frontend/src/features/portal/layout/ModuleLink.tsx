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
 * skin styles it through `className`, merged on top.
 * Participant world: no COBRA, no MUI component.
 */

import { Link, type LinkProps } from 'react-router-dom'
import type { PortalModuleId } from '../contract'
import { usePortalFrameEnvironment } from './frameEnvironmentContext'
import type { PortalModuleClickTarget } from './types'
import styles from './ModuleLink.module.css'

export interface ModuleLinkProps extends Omit<LinkProps, 'to' | 'target'> {
  readonly moduleId: PortalModuleId
  /** A host-relative path, typically a content permalink. */
  readonly to: string
  /** What the link opens (`contentId` becomes `payload.contentId`). Not the HTML `target`. */
  readonly target?: PortalModuleClickTarget
}

export function ModuleLink(props: ModuleLinkProps) {
  const { moduleId, to, target, onClick, className, ...linkProps } = props
  const { trackClick } = usePortalFrameEnvironment()
  return (
    <Link
      {...linkProps}
      to={to}
      className={className ? `${styles.link} ${className}` : styles.link}
      onClick={event => {
        trackClick(moduleId, target)
        onClick?.(event)
      }}
    />
  )
}
