/**
 * features/social/edit/EditPostDialog.tsx
 * ---------------------------------------------------------------------------
 * The "Edit post" dialog (demo-feedback story 20; DF-29, D1 parity "X edit"). PARTICIPANT world,
 * in the brand skin (`EditDialogs.module.css`; no COBRA, no MUI). Opened from the Edit action on
 * the viewer's OWN post while its 15-minute window is open.
 *
 *  - PREFILLED with the post's current text; a textarea with the composer's length counter (the
 *    NUMBER and words carry the state, colour only echoes it, NFR-001) and the shared emoji
 *    button (`core/emoji`). Media is shown READ-ONLY ("Media can't be changed"): an edit is
 *    text-only (DF-29).
 *  - SAVE (`editPost`, PATCH /api/posts/{id}) applies the new text to the card IMMEDIATELY
 *    through `editedPostsStore.setPendingText` (own-post optimistic update) and rolls it back on
 *    any failure. Success applies the server's text + `edited` summary under the session
 *    generation captured at click (a sign-out mid-save never repopulates the next session),
 *    reports the fresh window to the parent (`onSaved`) and closes.
 *  - FAILURE keeps the dialog open with a plain message in an `role="alert"` region: the three
 *    409 reasons ("The 15-minute edit window has closed", "You've reached the edit limit",
 *    "Posting is paused right now") and a generic one for the rest. A 409 also tells the parent
 *    (`onRejected`) so the card's Edit button stops offering a window the server closed.
 *  - Save is `aria-disabled` (still focusable; a press is ignored) for empty, unchanged or
 *    over-limit text and while a save is in flight. Esc / Close / Cancel dismiss with no change;
 *    focus returns to the Edit button (`EditDialogShell`).
 *
 * CONTENT SECURITY (NFR-004): the text goes to the server RAW; the server sanitizes (strip, never
 * encode) and its returned text is what the card shows. Rendered as plain React text everywhere.
 * No wall-clock time is shown (COR-053).
 */

import { useRef, useState, type FormEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { EmojiPicker, EmojiPickerButton, useEmojiPicker } from '@/core/emoji'
import { DEFAULT_CHAR_LIMIT } from '../hooks/useComposePost'
import type { PostMedia } from '../types/post'
import { EditDialogShell } from './EditDialogShell'
import { editedPostsStore } from './editedPostsStore'
import {
  EditPostError,
  editFailureMessage,
  editPost,
  type EditPostFailureReason,
  type EditPostResult,
} from './editPostService'
import styles from './EditDialogs.module.css'

/** The count at which the counter turns "low" (shows its warning cue). */
const LOW_REMAINING = 20

export interface EditPostDialogProps {
  readonly postId: string
  /** The text shown on the card right now (the prefill). */
  readonly initialText: string
  /** The post's media, shown read-only. */
  readonly media?: readonly PostMedia[]
  /** Dismiss (Esc, Close, Cancel, backdrop, or after a successful save). */
  readonly onClose: () => void
  /** A save succeeded: the server's result (carries the new window). */
  readonly onSaved: (result: EditPostResult) => void
  /** A save was refused with this reason (409s close the window / limit on the card). */
  readonly onRejected?: (reason: EditPostFailureReason) => void
  /** The Edit button, for focus return. */
  readonly returnFocusTo: HTMLElement | null
  /** Per-exercise character limit (default 280). */
  readonly charLimit?: number
}

function describeMedia(media: readonly PostMedia[]): string {
  const videos = media.filter(item => item.kind === 'video').length
  const images = media.length - videos
  const parts: string[] = []
  if (images > 0) parts.push(`${images} ${images === 1 ? 'photo' : 'photos'}`)
  if (videos > 0) parts.push(`${videos} ${videos === 1 ? 'video' : 'videos'}`)
  return parts.join(' and ')
}

export function EditPostDialog({
  postId,
  initialText,
  media,
  onClose,
  onSaved,
  onRejected,
  returnFocusTo,
  charLimit = DEFAULT_CHAR_LIMIT,
}: EditPostDialogProps) {
  const [text, setText] = useState(initialText)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement | null>(null)

  const emoji = useEmojiPicker({
    targetRef: textRef,
    value: text,
    onChange: setText,
    disabled: saving,
  })

  const length = [...text].length
  const remaining = charLimit - length
  const isOver = remaining < 0
  const isLow = !isOver && remaining <= LOW_REMAINING
  const unchanged = text === initialText
  const canSave = text.trim() !== '' && !isOver && !unchanged

  const counterClass = isOver
    ? `${styles.counter} ${styles.counterOver}`
    : isLow
      ? `${styles.counter} ${styles.counterLow}`
      : styles.counter
  const counterText = isOver
    ? `${Math.abs(remaining)} characters over the limit`
    : `${remaining} characters remaining`

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving || !canSave) return
    setSaving(true)
    setError(null)
    const generation = editedPostsStore.getGeneration()
    // Own-post optimistic update: the card shows the new text now, rolled back on failure.
    editedPostsStore.setPendingText(postId, text, generation)
    try {
      const result = await editPost(postId, text)
      if (result.edited !== undefined) {
        editedPostsStore.apply(
          {
            postId,
            text: result.text,
            edited: result.edited,
            version: result.edited.count,
          },
          generation,
        )
      }
      editedPostsStore.setPendingText(postId, null, generation)
      onSaved(result)
      onClose()
    } catch (failure) {
      editedPostsStore.setPendingText(postId, null, generation)
      const reason = failure instanceof EditPostError ? failure.reason : 'failed'
      setError(editFailureMessage(reason))
      if (reason === 'window-closed' || reason === 'edit-limit') onRejected?.(reason)
      setSaving(false)
    }
  }

  return (
    <EditDialogShell
      title="Edit post"
      testId="edit-post-dialog"
      onClose={onClose}
      returnFocusTo={returnFocusTo}
    >
      <form className={styles.body} onSubmit={event => { void handleSubmit(event) }}>
        <textarea
          ref={textRef}
          className={styles.input}
          value={text}
          onChange={event => setText(event.target.value)}
          aria-label="Post text"
          readOnly={saving}
          rows={5}
        />

        {media !== undefined && media.length > 0 && (
          <p className={styles.mediaNote} data-testid="edit-post-media-note">
            {`${describeMedia(media)} attached. Media can't be changed.`}
          </p>
        )}

        <div className={styles.toolbar}>
          <EmojiPickerButton {...emoji.buttonProps} className={styles.emojiButton} />
          <p className={counterClass} role="status" aria-live="polite" data-testid="edit-counter">
            {counterText}
          </p>
        </div>

        {emoji.isOpen && <EmojiPicker {...emoji.pickerProps} className={styles.emojiPicker} />}

        {error !== null && (
          <p className={styles.error} role="alert" data-testid="edit-post-error">
            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles.save}
            aria-disabled={!canSave || saving ? true : undefined}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </EditDialogShell>
  )
}
