/**
 * features/social/components/ReplyComposer.tsx
 * ---------------------------------------------------------------------------
 * The reply box under a thread's focused post (demo-polish F4, story 13 "Reply
 * composer"; SOC-011, D1-006, D1-011, NFR-001). Participant world (Pulse skin) —
 * plain semantic elements + scoped CSS Modules, no COBRA, no themed MUI,
 * FontAwesome icons only.
 *
 * It is the SAME form as the inline post composer (`ComposerForm`: text area,
 * 280-character ring counter, attach tray with required descriptions, Post/Retry,
 * failure alert), differently wired:
 *   - a "Replying to @handle" line above the text area names who is being answered;
 *   - publishing sends `parentPostId` (an opaque post id), so the server creates a
 *     REPLY — and emits the `reply` event; in mock mode `createPost` does, once;
 *   - `onPosted(view)` fires with the created reply's participant-safe view, which
 *     `<ThreadView>` appends to the open thread (de-duplicated against the realtime
 *     echo of the same reply).
 *
 * ABSENT, NOT DISABLED (COR-015 / D1-011). A read-only session — and a session with
 * no persona to reply AS — gets NO reply box at all (this renders `null`; there is
 * not even the inline composer's "posting isn't available" note), so assistive tech
 * never announces controls that cannot be used. The host should not mount it either;
 * this guard is belt-and-braces.
 *
 * FOCUS. `inputRef` is the text area, so the thread can move focus here when a
 * card's reply button was the way in (see `services/replyIntent`). The text area is
 * `aria-describedby` the "Replying to @handle" line, so a screen reader that lands
 * in it hears who is being answered.
 */

import { useId, type Ref } from 'react'
import { useComposePost, type UseComposePostOptions } from '../hooks/useComposePost'
import { ComposerForm } from './Composer'
import styles from './ReplyComposer.module.css'

export interface ReplyComposerProps {
  /** The post being replied to (an opaque id); sent as `parentPostId`. */
  readonly parentPostId: string
  /** The replied-to author's handle, WITHOUT the leading '@'. */
  readonly parentHandle: string
  /** Per-exercise character limit; defaults to 280 (SOC-001). */
  readonly charLimit?: number
  /** Called with the created reply's participant-safe view after a successful publish. */
  readonly onPosted?: UseComposePostOptions['onPosted']
  /** A ref to the text area, so the host can focus it. */
  readonly inputRef?: Ref<HTMLTextAreaElement>
}

export function ReplyComposer({
  parentPostId,
  parentHandle,
  charLimit,
  onPosted,
  inputRef,
}: ReplyComposerProps) {
  const contextId = useId()
  const compose = useComposePost({
    parentPostId,
    ...(charLimit !== undefined ? { charLimit } : {}),
    ...(onPosted !== undefined ? { onPosted } : {}),
  })

  // COR-015 / D1-011: absent for a read-only session and for one with no persona.
  if (compose.isReadOnly || !compose.canPost) return null

  return (
    <ComposerForm
      compose={compose}
      testId="reply-composer"
      textLabel="Reply text"
      placeholder="Post your reply"
      submitLabel="Reply"
      busyLabel="Replying…"
      postedNotice="Reply published."
      inputRef={inputRef}
      inputDescribedBy={contextId}
      rows={2}
      header={
        <p id={contextId} className={styles.context} data-testid="reply-composer-context">
          {`Replying to @${parentHandle}`}
        </p>
      }
    />
  )
}
