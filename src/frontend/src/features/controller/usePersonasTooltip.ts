/**
 * features/controller/usePersonasTooltip.ts
 * ---------------------------------------------------------------------------
 * The PERSONAS toolstrip tool's tooltip text, naming the platform's own chord (story 14: `⌘K` on
 * Apple platforms including iPadOS, `Ctrl+K` elsewhere; one keycap). A hook so the chord is read
 * from `usePlatformModifier`; the tooltip's TOUCH equivalent is story 13's toolstrip.
 */

import { usePlatformModifier } from '@/core/hooks/usePlatformModifier'

export function usePersonasTooltip(): string {
  const { chord } = usePlatformModifier()
  return `Post as persona (${chord('K')}) — search a persona and compose`
}
