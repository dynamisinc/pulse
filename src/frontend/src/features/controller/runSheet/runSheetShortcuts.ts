/**
 * features/controller/runSheet/runSheetShortcuts.ts
 * ---------------------------------------------------------------------------
 * The run sheet's keyboard shortcut table (inject-queue story 07, AC "Keyboard
 * (NFR-001)"). STAFF world, no UI. ONE source read by both the panel's key handler
 * (`RunSheetPanel`) and the visible "Keyboard" help (`KeyboardHelp`), so the help
 * can never list a key the panel does not honour or miss one it does.
 */

export interface RunSheetShortcut {
  readonly keys: string
  readonly action: string
}

export const RUN_SHEET_SHORTCUTS: readonly RunSheetShortcut[] = [
  { keys: '↑ / ↓', action: 'Select the previous / next item' },
  { keys: 'F', action: 'Fire the selected item' },
  { keys: 'N', action: 'Fire next: the first pending item in this view (held items are skipped)' },
  { keys: 'H', action: 'Hold / release the selected item' },
  { keys: 'S', action: 'Skip / unskip the selected item' },
  { keys: 'E', action: 'Edit the selected item (read-only once it has fired)' },
  { keys: 'A', action: 'Add a new item' },
]
