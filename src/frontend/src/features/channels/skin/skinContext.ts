/**
 * features/channels/skin/skinContext.ts
 * ---------------------------------------------------------------------------
 * The skin React context (story 13) and its consumer hooks. Kept in a plain
 * `.ts` module so the `.tsx` component files each export one component
 * (`react-refresh/only-export-components`; the `brandTokens.ts` precedent).
 */

import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Theme } from '@mui/material/styles'
import type { OutletSkinTokens } from './schema'
import { getSkinRegistryVersion, subscribeSkinRegistry } from './registry'

/** What a mounted `SkinScope` provides. */
export interface SkinContextValue {
  readonly scopeId: string
  /** The skin key the scope mounted, or `undefined` for a keyless token object. */
  readonly skinKey: string | undefined
  /** The finalized tokens (floor, guards and ext schemas applied). */
  readonly tokens: OutletSkinTokens
  /**
   * The MUI theme from OUTSIDE every skin scope; `SkinResetBoundary` restores
   * it so nothing inside the boundary sees an outlet theme.
   */
  readonly outerTheme: Theme
  /** Every custom property this scope and its ancestor scopes set (what a reset unsets). */
  readonly cssVarNames: readonly string[]
}

export const SkinContext = createContext<SkinContextValue | undefined>(undefined)

/**
 * The current scope's finalized skin. Fails closed: throws outside a
 * `SkinScope` / `OutletSkinScope` (and inside a `SkinResetBoundary`), so a
 * layout can never render against an implied default skin.
 */
export function useSkin(): SkinContextValue {
  const skin = useContext(SkinContext)
  if (skin === undefined) {
    throw new Error('useSkin() must be called within a <SkinScope> or <OutletSkinScope>.')
  }
  return skin
}

/** Re-renders the caller whenever the skin registry changes. */
export function useSkinRegistryVersion(): number {
  return useSyncExternalStore(subscribeSkinRegistry, getSkinRegistryVersion, getSkinRegistryVersion)
}
