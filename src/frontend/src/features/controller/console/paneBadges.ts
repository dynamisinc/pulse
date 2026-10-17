/**
 * features/controller/console/paneBadges.tsx
 * ---------------------------------------------------------------------------
 * The seam that carries the Live world "N new" and Run sheet "N due" counts from the two panes
 * up to the console's pane-switcher tabs (feature: mobile-tablet, story 12; TABLET-AMENDMENT
 * section 2, "every tab carries a text badge"). STAFF world, no UI.
 *
 * WHY A SEAM. The counts are computed INSIDE the panes (`useLiveWorldUnread` lives in
 * `LiveWorldColumn`, the run sheet's queue in `RunSheetPanel`), and the console never imports
 * live-world or run-sheet code (the slots are render props supplied by the route). So a pane
 * PUBLISHES its count with {@link usePublishPaneBadge}, and the console reads them with
 * {@link usePaneBadgeStore} and offers the publisher through `PaneBadgeContext`.
 *
 * OUTSIDE A CONSOLE the publisher is a no-op (no provider), so the panes render unchanged in
 * their own tests and on the desktop layout, where nothing reads the counts. All panes stay
 * mounted at every tablet size, so a hidden pane keeps publishing and its badge stays live.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

/** The panes that publish a count (Review's count comes from `useReviewQueue` directly). */
export type BadgePane = 'liveWorld' | 'runSheet'

export type PaneBadgePublish = (pane: BadgePane, count: number | null) => void

/** Provided by the console; panes publish through it. */
export const PaneBadgeContext = createContext<PaneBadgePublish | null>(null)

/** The latest published counts; a pane that has not published (or has unmounted) is `null`. */
export type PaneBadgeCounts = Readonly<Record<BadgePane, number | null>>

export interface PaneBadgeStore {
  readonly counts: PaneBadgeCounts
  readonly publish: PaneBadgePublish
}

/** Held by the console: the published counts and the publisher to hand down. */
export function usePaneBadgeStore(): PaneBadgeStore {
  const [counts, setCounts] = useState<PaneBadgeCounts>({ liveWorld: null, runSheet: null })
  const publish = useCallback<PaneBadgePublish>((pane, count) => {
    setCounts(current => (current[pane] === count ? current : { ...current, [pane]: count }))
  }, [])
  return useMemo(() => ({ counts, publish }), [counts, publish])
}

/** Called by a pane: keeps `count` published while the pane is mounted. No-op outside a console. */
export function usePublishPaneBadge(pane: BadgePane, count: number): void {
  const publish = useContext(PaneBadgeContext)
  useEffect(() => {
    publish?.(pane, count)
  }, [publish, pane, count])
  useEffect(() => () => publish?.(pane, null), [publish, pane])
}
