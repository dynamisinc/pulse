/**
 * features/portal/layout/PortalLayout.tsx
 * ---------------------------------------------------------------------------
 * The portal page grid (exercise-portal story 07, #772; PRT-003, D2-003,
 * D2-005, NFR-001). It mounts every registered module named in
 * `PortalDto.modules`, in the stored order, into its registered region.
 *
 * `anchor` (the only December layout): `lead` (hero + card grid) and `rail`
 * (336 px) side by side at >= 1024 px via `grid-template-areas`; below that the
 * rail folds under the lead, still in stored order; one column at 320 px.
 *
 * Clean hiding (D2-005), "the page must look complete with any subset":
 *  - an id with no registered module is skipped, never framed;
 *  - once the enabled set is known, a module whose channel is off is dropped
 *    (a live toggle never leaves a stale module);
 *  - a module that reports `empty` / `error` hides itself (`ModuleFrame`);
 *  - a region with nothing visible collapses entirely, and the other region
 *    takes the full width;
 *  - with nothing at all, no grid is rendered (no empty frame).
 *
 * The component renders the page's `main` (the masthead's `banner` sits
 * outside it, story 06/17). Participant world: CSS Module with skin variables,
 * no COBRA, no MUI component.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { PortalLayoutKey, PortalModuleDto, PortalModuleId } from '../contract'
import { LivePortalFrameEnvironment } from './frameEnvironment'
import { useOptionalPortalFrameEnvironment, usePortalFrameEnvironment } from './frameEnvironmentContext'
import { PortalLayoutSlotContext, type PortalLayoutSlot } from './layoutSlot'
import { placePortalModules, type PlacedPortalModule } from './placeModules'
import { portalModuleRegistry, type PortalModuleRegistry } from './registry'
import type { PortalRegion } from './types'
import styles from './PortalLayout.module.css'

export interface PortalLayoutProps {
  /** `PortalDto.layoutKey`. Only `anchor` exists in December (D2-003). */
  readonly layoutKey: PortalLayoutKey
  /** `PortalDto.modules`: the enabled, available modules in stored order. */
  readonly modules: readonly PortalModuleDto[]
  /** Content rendered in `main` above the grid (for example the alerts entry). */
  readonly before?: ReactNode
  /** Content rendered in `main` below the grid (for example the resources shelf link). */
  readonly after?: ReactNode
  /** The registry to mount from. Default: the app registry. Tests pass an isolated one. */
  readonly registry?: PortalModuleRegistry
}

function Region(
  { region, items, hiddenIds }: {
    readonly region: PortalRegion
    readonly items: readonly PlacedPortalModule[]
    readonly hiddenIds: ReadonlySet<PortalModuleId>
  },
) {
  const { trackClick } = usePortalFrameEnvironment()
  if (items.length === 0) return null
  const collapsed = items.every(item => hiddenIds.has(item.registration.id))
  return (
    <div
      className={region === 'lead' ? styles.lead : styles.rail}
      data-portal-region={region}
      hidden={collapsed || undefined}
    >
      {items.map(({ registration }) => {
        const { Component, id } = registration
        return (
          <Component
            key={id}
            moduleId={id}
            region={region}
            trackClick={target => trackClick(id, target)}
          />
        )
      })}
    </div>
  )
}

function LayoutGrid(props: PortalLayoutProps) {
  const { layoutKey, modules, before, after, registry = portalModuleRegistry } = props
  const environment = usePortalFrameEnvironment()
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<PortalModuleId>>(() => new Set())

  const setModuleHidden = useCallback((moduleId: PortalModuleId, hidden: boolean) => {
    setHiddenIds(current => {
      if (current.has(moduleId) === hidden) return current
      const next = new Set(current)
      if (hidden) next.add(moduleId)
      else next.delete(moduleId)
      return next
    })
  }, [])
  const slot = useMemo<PortalLayoutSlot>(() => ({ setModuleHidden }), [setModuleHidden])

  const placed = placePortalModules(
    modules,
    registry,
    environment.channelsKnown ? environment.isChannelEnabled : null,
  )
  const filled = (region: PortalRegion) =>
    placed[region].some(item => !hiddenIds.has(item.registration.id))
  const anyMounted = placed.lead.length + placed.rail.length > 0
  const leadFilled = filled('lead')
  const railFilled = filled('rail')

  return (
    <main className={styles.page} data-portal-layout={layoutKey}>
      {before}
      {anyMounted && (
        <PortalLayoutSlotContext.Provider value={slot}>
          <div
            className={styles.grid}
            data-lead={leadFilled ? 'filled' : 'empty'}
            data-rail={railFilled ? 'filled' : 'empty'}
            hidden={(!leadFilled && !railFilled) || undefined}
            data-testid="portal-layout-grid"
          >
            <Region region="lead" items={placed.lead} hiddenIds={hiddenIds} />
            <Region region="rail" items={placed.rail} hiddenIds={hiddenIds} />
          </div>
        </PortalLayoutSlotContext.Provider>
      )}
      {after}
    </main>
  )
}

export function PortalLayout(props: PortalLayoutProps) {
  const outer = useOptionalPortalFrameEnvironment()
  const grid = <LayoutGrid {...props} />
  return outer ? grid : <LivePortalFrameEnvironment>{grid}</LivePortalFrameEnvironment>
}
