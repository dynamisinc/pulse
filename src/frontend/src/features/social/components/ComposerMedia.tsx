/**
 * features/social/components/ComposerMedia.tsx
 * ---------------------------------------------------------------------------
 * The composer's ATTACH TRAY (demo-polish F4, story 13 "Attach becomes real";
 * SOC-001, NFR-001, NFR-004). Participant world (Pulse skin) — plain semantic
 * elements + the scoped `ComposerMedia.module.css`, FontAwesome icons only, no
 * COBRA, no themed MUI. Two pieces, used by the shared composer form
 * (`Composer.tsx`) for both the inline composer and the thread's reply composer:
 *
 *   <AttachButton/>       the toolbar button + its hidden multi-file input
 *                         (images and video; the type/size/count rules are applied
 *                         by `useComposePost.attachFiles`, which also covers a file
 *                         that slips past the input's `accept` filter).
 *   <ComposerMediaTray/>  one row per picked file:
 *                           - a thumbnail (images: the picked file; video: its first
 *                             frame, badged "Video"), made from a local object URL
 *                             that is revoked when the row goes away;
 *                           - a REQUIRED description field with a visible label —
 *                             alt text is mandatory (NFR-001), and the composer keeps
 *                             Post disabled (and says why) until every row has one;
 *                           - a `role="progressbar"` with a percentage while it
 *                             uploads, "Uploaded" once ready, or the in-fiction
 *                             failure message (`role="alert"`);
 *                           - a Cancel (while uploading) / Remove button.
 *
 * It holds no upload logic: the tray state and every action come from
 * `useComposePost` (`@/core/media` does the uploading). A pick refused by the
 * rules (type, size, mixed image + video, too many) is announced by the form as an
 * alert; "MP4 (H.264)" rides in the unsupported-type message.
 *
 * KEYBOARD (NFR-001): Enter inside a description field does NOT submit the form (it
 * would post a half-described draft - or nothing - from a text box that looks like a
 * label); removing or cancelling a row moves focus to the next row's control (the
 * previous one at the end), or to the attach button once the tray is empty, so focus
 * never falls to the page.
 *
 * A11Y: every control is a real `<button>`/`<input>` with a label; the thumbnails
 * are decorative (`alt=""`, `aria-hidden` video) because the description field
 * next to each IS the text alternative being authored; status is words + icons,
 * never colour alone.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCheck,
  faFilm,
  faImage,
  faPlay,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { ACCEPT_ANY_MEDIA } from '@/core/media'
import {
  ALT_MAX_LENGTH,
  effectiveAlt,
  type ComposerAttachment,
} from '../hooks/useComposePost'
import styles from './ComposerMedia.module.css'

/**
 * An object URL for `file` for the life of the caller; `undefined` where the
 * platform cannot make one. The thumbnail is cosmetic, so a failure to create it
 * (an environment without a working `URL.createObjectURL`) must never take the
 * composer down - the row just shows an icon instead.
 */
function usePreviewUrl(file: File): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    let created: string
    try {
      created = URL.createObjectURL(file)
    } catch {
      return
    }
    setUrl(created)
    return () => {
      try {
        URL.revokeObjectURL(created)
      } catch {
        // Nothing to release.
      }
      setUrl(undefined)
    }
  }, [file])
  return url
}

export interface AttachButtonProps {
  /** Receives the files the author picked (the hook validates + uploads them). */
  readonly onPick: (files: File[]) => void
  /** A ref to the button, so the tray can hand it focus when its last row goes. */
  readonly buttonRef?: Ref<HTMLButtonElement>
  /** Locks the button (a publish is in flight). */
  readonly disabled?: boolean
}

/** The toolbar's "Add photos or video" button and its hidden file input. */
export function AttachButton({ onPick, buttonRef, disabled = false }: AttachButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files && files.length > 0) onPick(Array.from(files))
    // Reset so re-picking the same file still fires a change event.
    event.target.value = ''
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.attachButton}
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label="Add photos or video"
      >
        <FontAwesomeIcon icon={faImage} aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ANY_MEDIA}
        multiple
        hidden
        data-testid="composer-file-input"
        onChange={handleChange}
      />
    </>
  )
}

export interface ComposerMediaTrayProps {
  readonly attachments: readonly ComposerAttachment[]
  readonly onAltChange: (key: string, alt: string) => void
  /** Aborts an in-flight upload and drops the row. */
  readonly onCancel: (key: string) => void
  /** Drops a row. */
  readonly onRemove: (key: string) => void
  /** Locks every control (a publish is in flight). */
  readonly disabled?: boolean
  /** Where focus goes when the LAST row is removed (the attach button). */
  readonly fallbackFocusRef?: RefObject<HTMLButtonElement | null>
}

/** The attach tray; renders nothing when empty. */
export function ComposerMediaTray({
  attachments,
  onAltChange,
  onCancel,
  onRemove,
  disabled = false,
  fallbackFocusRef,
}: ComposerMediaTrayProps) {
  const listRef = useRef<HTMLUListElement>(null)
  // The index of the row the author just removed/cancelled, until focus is re-homed.
  const removedIndexRef = useRef<number | null>(null)

  // A removed row takes its focused button with it: put focus on the row now at the
  // same index (the next one; the previous at the end), or on the fallback when the
  // tray is empty. Runs only after a remove/cancel the AUTHOR made.
  useEffect(() => {
    const removed = removedIndexRef.current
    if (removed === null) return
    removedIndexRef.current = null
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>(
      'button[data-attachment-action]',
    )
    const target = buttons !== undefined && buttons.length > 0
      ? buttons[Math.min(removed, buttons.length - 1)]
      : fallbackFocusRef?.current
    target?.focus()
  }, [attachments, fallbackFocusRef])

  if (attachments.length === 0) return null

  return (
    <ul
      ref={listRef}
      className={styles.mediaList}
      data-testid="composer-media"
      aria-label="Attachments"
    >
      {attachments.map((item, index) => (
        <AttachmentRow
          key={item.key}
          item={item}
          index={index}
          count={attachments.length}
          disabled={disabled}
          onAltChange={onAltChange}
          onCancel={key => {
            removedIndexRef.current = index
            onCancel(key)
          }}
          onRemove={key => {
            removedIndexRef.current = index
            onRemove(key)
          }}
        />
      ))}
    </ul>
  )
}

/** Enter in a single-line description must not implicitly submit the compose form. */
function preventEnterSubmit(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key === 'Enter') event.preventDefault()
}

interface AttachmentRowProps {
  readonly item: ComposerAttachment
  readonly index: number
  readonly count: number
  readonly disabled: boolean
  readonly onAltChange: (key: string, alt: string) => void
  readonly onCancel: (key: string) => void
  readonly onRemove: (key: string) => void
}

function AttachmentRow({
  item,
  index,
  count,
  disabled,
  onAltChange,
  onCancel,
  onRemove,
}: AttachmentRowProps) {
  const altId = useId()
  const statusId = useId()
  const previewUrl = usePreviewUrl(item.file)
  // A description left empty AFTER the author has been in the field: marked
  // invalid (and the composer states the reason in words).
  const [touched, setTouched] = useState(false)

  const noun = item.kind === 'video' ? 'video' : 'photo'
  const ordinal = count > 1 ? ` ${index + 1}` : ''
  const uploading = item.status === 'uploading'
  const percent = Math.round(Math.min(1, Math.max(0, item.progress)) * 100)
  const missingAlt = touched && effectiveAlt(item.alt).length === 0

  return (
    <li className={styles.attachment} data-testid="composer-attachment" data-status={item.status}>
      <div className={styles.thumb} aria-hidden="true">
        {previewUrl !== undefined && item.kind === 'image' && (
          <img className={styles.thumbMedia} src={previewUrl} alt="" />
        )}
        {previewUrl !== undefined && item.kind === 'video' && (
          <video
            className={styles.thumbMedia}
            src={`${previewUrl}#t=0.1`}
            preload="metadata"
            muted
            playsInline
            tabIndex={-1}
          />
        )}
        {previewUrl === undefined && (
          <FontAwesomeIcon icon={item.kind === 'video' ? faFilm : faImage} />
        )}
        {item.kind === 'video' && (
          <span className={styles.videoBadge}>
            <FontAwesomeIcon icon={faPlay} />
            Video
          </span>
        )}
      </div>

      <div className={styles.attachBody}>
        <label className={styles.altLabel} htmlFor={altId}>
          {`Describe ${noun}${ordinal} (required)`}
        </label>
        <input
          id={altId}
          type="text"
          className={styles.altInput}
          value={item.alt}
          maxLength={ALT_MAX_LENGTH}
          placeholder={`What is shown in this ${noun}?`}
          required
          aria-required="true"
          aria-invalid={missingAlt}
          aria-describedby={statusId}
          readOnly={disabled}
          onChange={event => onAltChange(item.key, event.target.value)}
          onKeyDown={preventEnterSubmit}
          onBlur={() => setTouched(true)}
        />

        <div id={statusId} className={styles.statusRow}>
          {uploading && (
            <>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-label={`Uploading ${item.file.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div className={styles.progressFill} style={{ width: `${percent}%` }} />
              </div>
              <span className={styles.progressText} aria-hidden="true">{`${percent}%`}</span>
            </>
          )}
          {item.status === 'ready' && (
            <span className={styles.readyText}>
              <FontAwesomeIcon icon={faCheck} aria-hidden="true" />
              Uploaded
            </span>
          )}
          {item.status === 'failed' && (
            <p className={styles.itemError} role="alert">
              <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
              <span>{item.error}</span>
            </p>
          )}
        </div>
      </div>

      <button
        type="button"
        className={styles.remove}
        data-attachment-action={uploading ? 'cancel' : 'remove'}
        disabled={disabled}
        aria-label={
          uploading ? `Cancel upload of ${item.file.name}` : `Remove ${item.file.name}`
        }
        onClick={() => (uploading ? onCancel(item.key) : onRemove(item.key))}
      >
        <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
      </button>
    </li>
  )
}
