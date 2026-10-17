/**
 * features/controller/components/confirm: shared touch-safe confirm primitives (story 15).
 * See `useArmedConfirm.ts`, `useCoarsePointer.ts`, `confirmTouch.ts`; the keyboard inset
 * (`useVisualViewportInset`) is shared with the participant composer from `@/core/hooks`.
 */
export { useCoarsePointer, COARSE_POINTER_QUERY } from './useCoarsePointer'
export { useArmedConfirm, ARMING_DELAY_MS } from './useArmedConfirm'
export { useVisualViewportInset, keyboardInset } from '@/core/hooks/useVisualViewportInset'
export * from './confirmTouch'
