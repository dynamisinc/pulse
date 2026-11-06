/**
 * features/channels/skin/OutletSkinScope.tsx
 * ---------------------------------------------------------------------------
 * The outlet skin scope (story 13): a thin wrapper over `SkinScope` that
 * resolves an outlet's `skinKey` + `skinOverrides` through the registry
 * (unknown key → neutral, logged once) and mounts the result. Mount it in the
 * channel's own route subtree, around one outlet's pages; it never wraps the
 * shell.
 *
 *   <OutletSkinScope outlet={outlet}>
 *     <OutletMasthead … />
 *   </OutletSkinScope>
 *
 * World: participant. No COBRA import.
 */

import { useMemo, type ReactNode } from 'react'
import type { OutletDto } from '../contract'
import { mergeSkinTokens } from './resolve'
import { useSkinRegistryVersion } from './skinContext'
import { SkinScope } from './SkinScope'

export interface OutletSkinScopeProps {
  /** The outlet (only `slug`, `skinKey` and `skinOverrides` are read). */
  readonly outlet: Pick<OutletDto, 'slug' | 'skinKey' | 'skinOverrides'>
  readonly children: ReactNode
}

/** Mounts the outlet's skin (registry tokens ⊕ overrides) inside its subtree. */
export function OutletSkinScope({ outlet, children }: OutletSkinScopeProps) {
  const registryVersion = useSkinRegistryVersion()
  const merged = useMemo(
    () => mergeSkinTokens(outlet.skinKey, outlet.skinOverrides),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outlet.skinKey, outlet.skinOverrides, registryVersion],
  )
  return (
    <SkinScope scopeId={`outlet-${outlet.slug}`} tokens={merged.tokens} skinKey={merged.skinKey}>
      {children}
    </SkinScope>
  )
}
