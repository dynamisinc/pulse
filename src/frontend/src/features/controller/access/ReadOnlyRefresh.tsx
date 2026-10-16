/**
 * features/controller/access/ReadOnlyRefresh.tsx
 * ---------------------------------------------------------------------------
 * The mount point for `useReadOnlyRefresh` (demo-feedback story 11, Gate-1 L-A). A component, not
 * a hook call in the console, so `ControllerConsole` can mount it for a non-controller only and a
 * controller's console never subscribes to the polled reads. Renders nothing.
 */

import { useReadOnlyRefresh } from './useReadOnlyRefresh'

/** Polls the pause tier and engine settings while mounted. See `useReadOnlyRefresh`. */
export function ReadOnlyRefresh() {
  useReadOnlyRefresh()
  return null
}
