/**
 * core/emoji/useEmojiPicker.ts
 * ---------------------------------------------------------------------------
 * The state + insertion logic behind an emoji button (demo-feedback story 12, DF-15).
 * World-neutral: it knows nothing about skins, so the participant composer (12a) and
 * the controller's persona composer (12b, COBRA) drive the same machine and differ
 * only in the class names they hand `<EmojiPickerButton>` and `<EmojiPicker>`.
 *
 * WHAT IT OWNS
 *  - open/closed (forced closed while `disabled`, e.g. a publish is in flight);
 *  - INSERTION: `pick(emoji)` splices the emoji into the CONTROLLED value at the text
 *    field's caret, or over its selection (`insertAtSelection`), and hands the new
 *    text to `onChange` - so it flows through the host's own state and counter, and
 *    counts toward the character limit exactly like a typed character;
 *  - FOCUS: after a pick, focus goes back to the text field with the caret just past
 *    the emoji; after Escape, focus goes back to the text field with its selection
 *    untouched. Both happen in a layout effect after the commit that applied the new
 *    value (a controlled update would otherwise park the caret at the end). A press
 *    or Tab outside the picker closes it WITHOUT moving focus (the author went
 *    somewhere on purpose).
 *
 * The text field's `selectionStart`/`selectionEnd` survive the field losing focus to
 * the picker's search box, so the caret the author left is the one that is used.
 *
 * NO NETWORK: nothing here (or anywhere in `core/emoji`) fetches; the emoji set is
 * bundled text (`emojiData.ts`).
 */

import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { insertAtSelection } from './insertAtSelection'

/** The text field an emoji is inserted into. */
export type EmojiTargetElement = HTMLTextAreaElement | HTMLInputElement

export interface UseEmojiPickerOptions {
  /** The text field the emoji goes into. */
  readonly targetRef: RefObject<EmojiTargetElement | null>
  /** The field's current (controlled) value. */
  readonly value: string
  /** Receives the new value after an insertion. */
  readonly onChange: (next: string) => void
  /** Disables the button and closes the picker (e.g. while publishing). */
  readonly disabled?: boolean
}

/** Props the hook hands to `<EmojiPicker>` (spread them). */
export interface EmojiPickerBindings {
  readonly id: string
  readonly onPick: (emoji: string) => void
  /** Escape: close and return focus to the text field. */
  readonly onEscape: () => void
  /** A press or focus outside: close quietly. */
  readonly onDismiss: () => void
  /** The trigger button; a press on it is not "outside". */
  readonly anchorRef: RefObject<HTMLButtonElement | null>
}

/** Props the hook hands to `<EmojiPickerButton>` (spread them). */
export interface EmojiPickerButtonBindings {
  readonly buttonRef: RefObject<HTMLButtonElement | null>
  readonly isOpen: boolean
  readonly disabled: boolean
  /** `id` of the picker panel (the button's `aria-controls`). */
  readonly panelId: string
  /** Open, or close if open (the button's click). */
  readonly onToggle: () => void
}

export interface EmojiPickerController {
  /** Whether to render `<EmojiPicker>`. */
  readonly isOpen: boolean
  readonly buttonProps: EmojiPickerButtonBindings
  readonly pickerProps: EmojiPickerBindings
}

/** What to do with focus after the next commit; `caret: null` = leave the selection. */
interface PendingFocus {
  readonly caret: number | null
}

export function useEmojiPicker({
  targetRef,
  value,
  onChange,
  disabled = false,
}: UseEmojiPickerOptions): EmojiPickerController {
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pendingFocus = useRef<PendingFocus | null>(null)
  const [open, setOpen] = useState(false)
  const isOpen = open && !disabled

  // After the commit that applied a pick (or an Escape), put the author back in the
  // text field. No dependency list on purpose: it is a cheap no-op unless a pick or
  // an Escape queued something, and it must run after whichever commit that was.
  useLayoutEffect(() => {
    const pending = pendingFocus.current
    if (pending === null) return
    pendingFocus.current = null
    const target = targetRef.current
    if (target === null) return
    target.focus()
    if (pending.caret !== null) target.setSelectionRange(pending.caret, pending.caret)
  })

  const pick = (emoji: string) => {
    const target = targetRef.current
    const { value: next, caret } = insertAtSelection(
      value,
      target?.selectionStart,
      target?.selectionEnd,
      emoji,
    )
    pendingFocus.current = { caret }
    setOpen(false)
    onChange(next)
  }

  const escape = () => {
    pendingFocus.current = { caret: null }
    setOpen(false)
  }

  return {
    isOpen,
    buttonProps: {
      buttonRef: triggerRef,
      isOpen,
      disabled,
      panelId,
      onToggle: () => setOpen(!isOpen),
    },
    pickerProps: {
      id: panelId,
      onPick: pick,
      onEscape: escape,
      onDismiss: () => setOpen(false),
      anchorRef: triggerRef,
    },
  }
}
