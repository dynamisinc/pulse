/**
 * core/hooks/useCssMediaQuery.ts
 * ---------------------------------------------------------------------------
 * Whether a CSS media query currently matches, kept live as the viewport changes
 * (rotation, window resize). Built on `useSyncExternalStore`, so a change re-renders
 * subscribers in the same commit and there is no stale first paint after hydration.
 *
 * Where `matchMedia` does not exist (jsdom without a stub, SSR) this returns `false`, so
 * components fall back to their default (desktop) layout and existing tests that never
 * stub `matchMedia` see unchanged behaviour.
 *
 * One `MediaQueryList` is kept per query string and reused by `subscribe` and
 * `getSnapshot`; it is rebuilt if a test swaps `window.matchMedia`.
 *
 * Named apart from MUI's `useMediaQuery` (staff surfaces) so an auto-import on a participant
 * path cannot pull the MUI one in.
 *
 * Used by: participant-shell `ComplianceChrome` (narrow-screen banner wrap, #612).
 */

import { useCallback, useSyncExternalStore } from 'react'

const lists = new Map<string, { factory: typeof window.matchMedia, list: MediaQueryList }>()

function mediaList(query: string): MediaQueryList | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
  const cached = lists.get(query)
  if (cached !== undefined && cached.factory === window.matchMedia) return cached.list
  const list = window.matchMedia(query)
  lists.set(query, { factory: window.matchMedia, list })
  return list
}

export function useCssMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const list = mediaList(query)
    if (list === undefined) return () => {}
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  const getSnapshot = useCallback(() => mediaList(query)?.matches ?? false, [query])
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
