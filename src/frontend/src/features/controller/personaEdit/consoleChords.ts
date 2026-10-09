/**
 * features/controller/personaEdit/consoleChords.ts
 * ---------------------------------------------------------------------------
 * Keeps the CONSOLE's global keyboard chords from firing out of a modal dialog
 * (demo-polish story 21 / PE-FE Gate-1 M-2). Staff world, no UI.
 *
 * The console listens for ⌘K / Ctrl+K on `window` and toggles its command palette
 * (`ControllerConsole`), which is a hand-rolled overlay MUI's modal manager does not
 * know about. Opened behind an MUI `Dialog`, it paints under the dialog's portal and
 * MUI's focus trap pulls focus straight back out of it — a stuck, unreachable
 * palette. So while one of PE-FE's dialogs has focus, that chord is swallowed at the
 * dialog: `preventDefault()` (also stops the browser's own Ctrl+K) and
 * `stopPropagation()` (React 19 listens at the portal container, so the native event
 * never reaches `window`).
 *
 * The console's own listener should additionally stand aside while another
 * `aria-modal` is mounted (`core/a11y/modalPriority`); that is wiring outside this
 * story, and this guard does not depend on it.
 */

import type { KeyboardEvent } from 'react'

/**
 * Swallows ⌘K / Ctrl+K. Returns true when it did, so a caller can stop handling the
 * event. Attach to a dialog's `onKeyDown`.
 */
export function swallowConsoleChord(event: KeyboardEvent<HTMLElement>): boolean {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    event.stopPropagation()
    return true
  }
  return false
}
