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
 * `coarse` uses the shared `useCssMediaQuery` (core). Controller components that only need the
 * coarse flag use `useCoarsePointer` from `controller/components/confirm` (story 15).
 */

import { useMemo } from 'react'
import { useCssMediaQuery } from './useCssMediaQuery'
import { platformChordLabel, platformModifierLabel } from './platformModifier'

const COARSE_QUERY = '(pointer: coarse)'

export interface PlatformModifier {
  /** `⌘` or `Ctrl`. */
  readonly modifier: string
  /** One keycap, e.g. `chord('K')` is `⌘K` or `Ctrl+K`. */
  readonly chord: (key: string) => string
  /** True when the primary pointer is a finger; show tap hints instead of key hints. */
  readonly coarse: boolean
}

export function usePlatformModifier(): PlatformModifier {
  const coarse = useCssMediaQuery(COARSE_QUERY)
  return useMemo(
    () => ({
      modifier: platformModifierLabel(),
      chord: (key: string) => platformChordLabel(key),
      coarse,
    }),
    [coarse],
  )
}
