/**
 * features/portal/layout/layoutSlot.ts
 * ---------------------------------------------------------------------------
 * How a mounted `ModuleFrame` tells `PortalLayout` it has hidden itself
 * (empty or errored), so a region whose every module is hidden collapses
 * instead of leaving an empty column (D2-005). Internal to `layout/`.
 */

import { createContext, useContext } from 'react'
import type { PortalModuleId } from '../contract'

export interface PortalLayoutSlot {
  readonly setModuleHidden: (moduleId: PortalModuleId, hidden: boolean) => void
}

export const PortalLayoutSlotContext = createContext<PortalLayoutSlot | undefined>(undefined)

export function usePortalLayoutSlot(): PortalLayoutSlot | undefined {
  return useContext(PortalLayoutSlotContext)
}
