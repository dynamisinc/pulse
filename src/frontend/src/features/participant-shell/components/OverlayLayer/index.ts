/**
 * features/participant-shell/components/OverlayLayer/index.ts
 * ---------------------------------------------------------------------------
 * Public barrel for the overlay layer (feature: participant-shell, story 05).
 * Import `OverlayLayer` from here — mount it once, near the shell root,
 * alongside `<ComplianceChrome />` and as a sibling of `<ShellLayout>` (see
 * `OverlayLayer.tsx`'s module header). No prop threading required: the
 * component reads its own mock state internally.
 */

export { OverlayLayer } from './OverlayLayer'
export { useOverlayState } from './overlayState'
export type { OverlayRegister, OverlayState, OverlayStateKind } from './types'
