/**
 * core/emoji/EmojiPickerButton.tsx
 * ---------------------------------------------------------------------------
 * The emoji trigger (demo-feedback story 12): a FontAwesome face-smile icon button
 * wired to a `useEmojiPicker()` controller (spread its `buttonProps`). World-neutral
 * and unstyled - the host passes its own `className` (participant skin in the Social
 * composer, COBRA styling in the persona composer for 12b), so this file carries no
 * look of its own.
 *
 * A11y: a real <button> (Enter/Space open it), named "Add emoji" by default, with
 * `aria-haspopup="dialog"`, `aria-expanded`, and `aria-controls` pointing at the
 * panel while it is open.
 */

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFaceSmile } from '@fortawesome/free-solid-svg-icons'
import type { EmojiPickerButtonBindings } from './useEmojiPicker'

export interface EmojiPickerButtonProps extends EmojiPickerButtonBindings {
  readonly className?: string
  /** Accessible name. */
  readonly label?: string
}

export function EmojiPickerButton({
  buttonRef,
  isOpen,
  disabled,
  panelId,
  onToggle,
  className,
  label = 'Add emoji',
}: EmojiPickerButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={className}
      onClick={onToggle}
      disabled={disabled}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls={isOpen ? panelId : undefined}
      data-testid="emoji-button"
    >
      <FontAwesomeIcon icon={faFaceSmile} aria-hidden="true" />
    </button>
  )
}
