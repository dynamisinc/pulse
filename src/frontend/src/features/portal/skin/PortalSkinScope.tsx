/**
 * features/portal/skin/PortalSkinScope.tsx
 * ---------------------------------------------------------------------------
 * The portal's skin scope (exercise-portal story 06, #771; FU-4a). A thin
 * wrapper over F13's token-object `SkinScope`: it merges the exercise's
 * `PortalDto.skinOverrides` over the registered `portalTokens` and mounts the
 * result INSIDE ITS SUBTREE ONLY (CSS custom properties on F13's own wrapper,
 * plus a per-scope MUI theme built from the tokens, never COBRA).
 *
 *  - The merge is F13's `mergeSkinTokens('portal', overrides)`: the strict FC-3b
 *    schema validates the overrides, and an invalid or out-of-allowlist object
 *    is ignored whole, so the portal falls back to its default tokens.
 *  - `SkinScope` then runs F13's `finalizeSkinTokens`: the AA floor, the
 *    clutter guard (never the portal) and the `ext.portal` schema.
 *  - The CANNOT list has no token key at all (slot order, the scenario-time
 *    source, the watermark slot, the a11y floor), so no override reaches them.
 *
 * Mounted by the portal channel (story 17) in its own route subtree, below
 * `ShellLayout`; it never wraps the shell.
 *
 * World: participant. No COBRA import.
 */

import { useMemo, type ReactNode } from 'react'
import { SkinScope, mergeSkinTokens, type JsonObject } from '@/features/channels'
import { PORTAL_SKIN_KEY } from './portalTokens'

export interface PortalSkinScopeProps {
  /** `PortalDto.skinOverrides`: a partial `OutletSkinTokens`, or null for the defaults. */
  readonly skinOverrides?: JsonObject | null
  readonly children: ReactNode
}

export function PortalSkinScope({ skinOverrides, children }: PortalSkinScopeProps) {
  // Keyed on the override VALUES so a refetch with equal JSON does not re-merge.
  const overridesKey = JSON.stringify(skinOverrides ?? null)
  const tokens = useMemo(
    () => mergeSkinTokens(PORTAL_SKIN_KEY, skinOverrides).tokens,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overridesKey],
  )
  return (
    <SkinScope scopeId={PORTAL_SKIN_KEY} tokens={tokens} skinKey={PORTAL_SKIN_KEY}>
      {children}
    </SkinScope>
  )
}
