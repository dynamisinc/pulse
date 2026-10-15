/**
 * core/emoji — public barrel (demo-feedback story 12, DF-15).
 *
 * A hand-rolled, world-neutral emoji picker over a bundled list of native emoji: no
 * dependency, no network request, no images. A host wires it in three pieces:
 *
 *   const emoji = useEmojiPicker({ targetRef, value, onChange, disabled })
 *   <EmojiPickerButton {...emoji.buttonProps} className={hostButtonClass} />
 *   {emoji.isOpen && <EmojiPicker {...emoji.pickerProps} className={hostSkinClass} />}
 *
 * `hostSkinClass` sets the `--emoji-*` custom properties (see EmojiPicker.module.css).
 * 12a: the participant Social composer (`features/social/components/Composer.tsx`).
 * 12b: the controller persona composer, with COBRA values.
 */
export { EmojiPicker, type EmojiPickerProps } from './EmojiPicker'
export { EmojiPickerButton, type EmojiPickerButtonProps } from './EmojiPickerButton'
export {
  useEmojiPicker,
  type EmojiPickerBindings,
  type EmojiPickerButtonBindings,
  type EmojiPickerController,
  type EmojiTargetElement,
  type UseEmojiPickerOptions,
} from './useEmojiPicker'
export {
  ALL_EMOJI,
  EMOJI_CATEGORIES,
  EMOJI_COLUMNS,
  type EmojiCategory,
  type EmojiEntry,
} from './emojiData'
export { isSearching, searchEmoji } from './emojiSearch'
export { insertAtSelection, type InsertResult } from './insertAtSelection'
