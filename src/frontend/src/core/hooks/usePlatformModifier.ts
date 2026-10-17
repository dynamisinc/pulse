/**
 * core/hooks/usePlatformModifier.ts
 * ---------------------------------------------------------------------------
 * React side of the shortcut-hint rules (mobile-tablet story 14, D5-024; STAFF world, no UI):
 *   - `modifier`  : `⌘` on Apple platforms (including iPadOS), `Ctrl` elsewhere;
 *   - `chord(key)`: ONE keycap's text, `⌘K` / `Ctrl+K`;
 *   - `coarse`    : the primary pointer is a finger, `(pointer: coarse)`. A hint then reads as a
 *                   TAP hint ("Tap PERSONAS or press ⌘K") rather than promising a keyboard.
 *
 * Platform is read once (it cannot change in a session). `coarse` is live via
 * `useSyncExternalStore`; without `matchMedia` (jsdom) it is false, so desktop renders and
 * every pre-existing test are unchanged.
 *
 * DUPLICATION NOTE (documented on purpose). Story 15 (#622) adds
 * `controller/components/confirm/useCoarsePointer`, and #619 adds `core/hooks/useCssMediaQuery`.
 * This file keeps its own 10-line `(pointer: coarse)` read so story 14 does not depend on
 * either branch. FOLLOW-UP: once #622 and #619 land, replace `useIsCoarsePointer` below with
 * one of them.
 */

import { useMemo, useSyncExternalStore } from 'react'
import { platformChordLabel, platformModifierLabel } from './platformModifier'

const COARSE_QUERY = '(pointer: coarse)'

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const list = window.matchMedia(COARSE_QUERY)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(COARSE_QUERY).matches
}

/** Whether the primary pointer is coarse (a finger). False without `matchMedia`. */
export function useIsCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

export interface PlatformModifier {
  /** `⌘` or `Ctrl`. */
  readonly modifier: string
  /** One keycap, e.g. `chord('K')` is `⌘K` or `Ctrl+K`. */
  readonly chord: (key: string) => string
  /** True when the primary pointer is a finger; show tap hints instead of key hints. */
  readonly coarse: boolean
}

export function usePlatformModifier(): PlatformModifier {
  const coarse = useIsCoarsePointer()
  return useMemo(
    () => ({
      modifier: platformModifierLabel(),
      chord: (key: string) => platformChordLabel(key),
      coarse,
    }),
    [coarse],
  )
}
