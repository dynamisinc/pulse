/**
 * core/hooks/useCoarsePointer.ts
 * ---------------------------------------------------------------------------
 * Whether the PRIMARY input is a finger: `(pointer: coarse)`. Mobile-tablet story 15 (D5-025,
 * TABLET-AMENDMENT §5). A hook, no UI; shared by the staff confirms (story 15), the console
 * touch affordances and `usePlatformModifier` (story 14). Re-exported from
 * `controller/components/confirm`.
 *
 * WHY THIS AND NOT A WIDTH. The amendment (§1) separates the two questions: viewport WIDTH picks
 * the tablet LAYOUT, `(pointer: coarse)` picks TOUCH AFFORDANCES. An iPad with a trackpad still
 * gets the tablet layout; a narrow desktop window gets the tablet layout with desktop-size
 * controls. Everything touch-only in the deliberate-confirm steps (44px targets, the 400ms
 * arming delay, the STOP -> Live re-arm confirm) keys off this hook and never off a width.
 *
 * Without `matchMedia` (jsdom, SSR) it is `false`, so every pre-existing test and every desktop
 * render is unchanged. The MediaQueryList is created once per `window.matchMedia` function (a
 * test that swaps the mock gets a fresh list) and shared by `subscribe` / `getSnapshot`.
 */

import { useSyncExternalStore } from 'react'

export const COARSE_POINTER_QUERY = '(pointer: coarse)'

let cached: { factory: typeof window.matchMedia, list: MediaQueryList } | undefined

function coarseList(): MediaQueryList | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
  if (cached === undefined || cached.factory !== window.matchMedia) {
    cached = { factory: window.matchMedia, list: window.matchMedia(COARSE_POINTER_QUERY) }
  }
  return cached.list
}

function subscribe(onChange: () => void): () => void {
  const list = coarseList()
  if (list === undefined) return () => {}
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  return coarseList()?.matches ?? false
}

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
