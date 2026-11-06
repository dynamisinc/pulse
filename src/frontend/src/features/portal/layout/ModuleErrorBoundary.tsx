/**
 * features/portal/layout/ModuleErrorBoundary.tsx
 * ---------------------------------------------------------------------------
 * One per mounted module (story 07, #772; D2-005 fail closed). A module that
 * throws while rendering hides itself like an `error` status would: it
 * renders nothing and tells the layout, so its region can collapse. The rest
 * of the page is unaffected. Internal to `layout/`.
 */

import { Component, type ReactNode } from 'react'
import type { PortalModuleId } from '../contract'

interface ModuleErrorBoundaryProps {
  readonly moduleId: PortalModuleId
  readonly onHidden: (moduleId: PortalModuleId, hidden: boolean) => void
  readonly children: ReactNode
}

interface ModuleErrorBoundaryState {
  readonly failed: boolean
}

export class ModuleErrorBoundary
  extends Component<ModuleErrorBoundaryProps, ModuleErrorBoundaryState> {
  override state: ModuleErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ModuleErrorBoundaryState {
    return { failed: true }
  }

  override componentDidCatch(): void {
    this.props.onHidden(this.props.moduleId, true)
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
