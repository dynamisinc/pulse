/**
 * features/controller/runSheet/runSheetKeyboard.ts
 * ---------------------------------------------------------------------------
 * The run sheet's KEYBOARD MAP (demo-polish C3, story 19; NFR-001). STAFF world; pure.
 * One function decides what a key press means so the panel's handler stays a switch and
 * the rules - above all "ignored while typing" - are unit-tested without a DOM tree.
 *
 *   ArrowUp / ArrowDown   select the previous / next beat
 *   F                     fire the selected beat
 *   N                     fire the next pending beat
 *   S                     skip the selected beat (or undo its skip)
 *   E                     edit the selected beat
 *
 * A press is IGNORED (returns `undefined`) when:
 *   - the target is a text field (`input`, `textarea`, `select`, or `contenteditable`), so
 *     typing a title with the letter "f" never fires anything;
 *   - Ctrl, Meta or Alt is held (those belong to the browser and the console's own shortcuts);
 *   - the event was already handled (`defaultPrevented`);
 *   - for the four ACTION keys, the key is auto-repeating (`repeat`): holding `N` down must
 *     never fire a string of posts. Arrow keys may repeat so a long list is easy to cross.
 * Shortcuts are scoped to the panel (its root `onKeyDown`), so they never collide with the
 * review queue's own `A`/`V`/`E`/`R` keys or the composer.
 */

/** What a key press asks the run sheet to do. */
export type RunSheetShortcut = 'previous' | 'next' | 'fire' | 'fireNext' | 'skip' | 'edit'

/** The parts of a keyboard event the map needs (a real `KeyboardEvent` satisfies it). */
export interface ShortcutEvent {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly repeat: boolean
  readonly defaultPrevented: boolean
  readonly target: EventTarget | null
}

/** True when the target is somewhere the controller is typing text. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** The shortcut a key press means, or `undefined` when it should be left alone. */
export function shortcutFor(event: ShortcutEvent): RunSheetShortcut | undefined {
  if (event.defaultPrevented) return undefined
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined
  if (isTypingTarget(event.target)) return undefined

  if (event.key === 'ArrowUp') return 'previous'
  if (event.key === 'ArrowDown') return 'next'
  if (event.repeat) return undefined

  switch (event.key.toLowerCase()) {
    case 'f':
      return 'fire'
    case 'n':
      return 'fireNext'
    case 's':
      return 'skip'
    case 'e':
      return 'edit'
    default:
      return undefined
  }
}

/** The list rendered in the visible "Keyboard" help. */
export const KEYBOARD_HELP: readonly { readonly keys: string; readonly action: string }[] = [
  { keys: '↑ ↓', action: 'select a beat' },
  { keys: 'F', action: 'fire the selected beat' },
  { keys: 'N', action: 'fire the next pending beat' },
  { keys: 'S', action: 'skip the selected beat (press again to undo)' },
  { keys: 'E', action: 'edit the selected beat' },
]
