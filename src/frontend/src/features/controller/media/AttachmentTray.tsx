/**
 * features/controller/media/AttachmentTray.tsx
 * ---------------------------------------------------------------------------
 * The composer's attach tray VIEW (demo-polish C1, story 17 "Attach by upload" /
 * "Attach from the library"; NFR-001, NFR-004). STAFF world (COBRA): dense rows, a
 * `CobraTextField` for the alt text, FontAwesome icons only, MUI 9 `sx`-only, no
 * participant component. State lives in `useAttachmentTray`; this file only renders
 * it and runs the uploads.
 *
 * EACH ROW shows a thumbnail (a video shows its POSTER), the file name, the kind
 * (IMAGE / VIDEO - text, not just an icon), where it came from (uploaded now / from
 * the library), its state, and a REQUIRED alt-text field (the post cannot be fired
 * until every row has one; videos have no captions this push (DP-12), so the alt is
 * their only text alternative).
 *
 * UPLOADS. An 'upload' row owns one `core/media` `useMediaUpload()` instance and
 * starts it on mount (`start(file)` -> `uploadPickedMedia`: an image has its size
 * read then is uploaded; a video goes through `uploadVideoWithPoster`, poster first).
 * One hook per ROW is what lets four images upload in parallel with their own
 * progress and cancel - `useMediaUpload` is deliberately single-slot (a second
 * `start` aborts the first). While uploading the row shows a `role="progressbar"`
 * (live `aria-valuenow`, plus the percentage as text) and a Cancel button; when done
 * it says "Uploaded"; a failure is words + icon in an alert and the row must be
 * removed (a file is never silently dropped from a post). Removing / cancelling a row
 * unmounts it, which aborts the upload.
 *
 * KEYBOARD (NFR-001): every control is a real button / input in tab order. Enter in
 * an alt field does NOT submit the composer (the composer form swallows plain Enter
 * on inputs). After a row is removed, focus moves to a neighbouring row's button, or
 * - once the tray is empty - to whatever `onEmpty` focuses (the composer's Upload
 * button), never to <body>.
 *
 * CONTENT SECURITY (NFR-004): thumbnail URLs are opaque strings, so they pass the
 * shared media-URL allow-list before reaching an `<img src>`; the file name and alt
 * are React text nodes / input values (never HTML).
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleCheck,
  faFilm,
  faImage,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { CobraTextField } from '@/theme/styledComponents'
import {
  MEDIA_ERROR_TEXT,
  isAbortError,
  useMediaUpload,
  type MediaAssetView,
} from '@/core/media'
import { safeImageUrl } from '@/features/social/utils/safeImageUrl'
import { ALT_MAX_LENGTH, effectiveAlt } from './attachmentRules'
import type { TrayItem, UseAttachmentTrayResult } from './useAttachmentTray'
import styles from './AttachmentTray.module.css'

export interface AttachmentTrayProps {
  tray: UseAttachmentTrayResult
  /** Locks editing and removal while a publish is in flight. */
  locked?: boolean
  /** Called after the LAST row is removed, so the composer can move focus. */
  onEmpty?: () => void
}

/** The tray's rows (and the reason the last attach was refused). Renders nothing when empty. */
export function AttachmentTray({ tray, locked = false, onEmpty }: AttachmentTrayProps) {
  const listRef = useRef<HTMLUListElement | null>(null)
  const pendingFocus = useRef<{ readonly key: string | null } | null>(null)

  // After a removal, put focus on a neighbouring row's button, or hand it to the
  // composer once the tray is empty. Runs in a layout effect so focus never visibly
  // falls to <body> between the removal and this move.
  useLayoutEffect(() => {
    const pending = pendingFocus.current
    if (pending === null) return
    pendingFocus.current = null
    if (pending.key === null) {
      onEmpty?.()
      return
    }
    listRef.current
      ?.querySelector<HTMLElement>(`[data-row-key="${pending.key}"] [data-row-action]`)
      ?.focus()
  }, [tray.items, onEmpty])

  const removeRow = (key: string) => {
    const index = tray.items.findIndex(item => item.key === key)
    const neighbour = tray.items[index + 1] ?? tray.items[index - 1]
    pendingFocus.current = { key: neighbour?.key ?? null }
    tray.remove(key)
  }

  return (
    <>
      {tray.attachError !== undefined && (
        <p className={styles.attachError} role="alert" data-testid="attach-error">
          <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
          <span>{tray.attachError}</span>
        </p>
      )}
      {tray.items.length > 0 && (
        <ul className={styles.tray} ref={listRef} aria-label="Attached media" data-testid="attachments">
          {tray.items.map(item => (
            <AttachmentRow
              key={item.key}
              item={item}
              tray={tray}
              locked={locked}
              onRemove={removeRow}
            />
          ))}
        </ul>
      )}
    </>
  )
}

interface AttachmentRowProps {
  item: TrayItem
  tray: UseAttachmentTrayResult
  locked: boolean
  onRemove: (key: string) => void
}

function AttachmentRow({ item, tray, locked, onRemove }: AttachmentRowProps) {
  const isVideo = item.kind === 'video'
  const thumbUrl = safeImageUrl(isVideo ? item.asset?.posterUrl : item.asset?.url)
  const missingAlt = effectiveAlt(item.alt).length === 0

  return (
    <li
      className={styles.row}
      data-testid="attachment"
      data-row-key={item.key}
      data-status={item.status}
      data-source={item.source}
    >
      <span className={styles.thumb} aria-hidden="true">
        {thumbUrl !== undefined
          ? <img src={thumbUrl} alt="" draggable={false} />
          : <FontAwesomeIcon icon={isVideo ? faFilm : faImage} />}
      </span>

      <div className={styles.head}>
        <div className={styles.meta}>
          <span className={styles.name} title={item.name}>{item.name}</span>
          <span className={styles.sub}>
            <span className={styles.kind}>{isVideo ? 'VIDEO' : 'IMAGE'}</span>
            <span>{item.source === 'upload' ? 'UPLOAD' : 'LIBRARY'}</span>
          </span>
          {item.source === 'upload' && (
            <UploadStatus item={item} tray={tray} onRemove={onRemove} />
          )}
          {item.status === 'ready' && (
            <span className={`${styles.sub} ${styles.status}`}>
              <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />
              {item.source === 'upload' ? 'Uploaded' : 'Ready'}
            </span>
          )}
          {item.status === 'failed' && (
            <span
              className={`${styles.sub} ${styles.status} ${styles.statusFailed}`}
              role="alert"
            >
              <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
              {item.error ?? MEDIA_ERROR_TEXT.failed}
            </span>
          )}
        </div>
        {item.status !== 'uploading' && (
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`Remove ${item.name}`}
            disabled={locked}
            data-row-action
            onClick={() => onRemove(item.key)}
          >
            <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
            Remove
          </button>
        )}
      </div>

      <div className={styles.alt}>
        <CobraTextField
          size="small"
          fullWidth
          required
          label={`Alt text for ${item.name}`}
          value={item.alt}
          onChange={event => tray.setAlt(item.key, event.target.value)}
          helperText={missingAlt
            ? isVideo
              ? 'Required. This is the video\'s only text alternative (no captions).'
              : 'Required. Describe the image for people who cannot see it.'
            : undefined}
          slotProps={{
            htmlInput: { maxLength: ALT_MAX_LENGTH, readOnly: locked },
            formHelperText: { sx: { fontSize: 11, marginLeft: 0 } },
          }}
        />
      </div>
    </li>
  )
}

interface UploadStatusProps {
  item: TrayItem
  tray: UseAttachmentTrayResult
  onRemove: (key: string) => void
}

/**
 * The upload half of an 'upload' row: ONE `useMediaUpload()` instance that both RUNS
 * the upload (started once on mount) and RENDERS its progress + Cancel, so the bar
 * and the transfer can never disagree. A cancel / unmount / superseded upload rejects
 * with an AbortError, which is a choice, not a failure.
 */
function UploadStatus({ item, tray, onRemove }: UploadStatusProps) {
  const { start, cancel, progress } = useMediaUpload()
  const { markUploaded, markFailed } = tray
  const { key, file, status, name } = item

  useEffect(() => {
    if (status !== 'uploading' || file === undefined) return
    start(file).then(
      (asset: MediaAssetView) => markUploaded(key, asset),
      (failure: unknown) => {
        if (isAbortError(failure)) return
        markFailed(key, failure instanceof Error ? failure.message : MEDIA_ERROR_TEXT.failed)
      },
    )
  }, [start, key, file, status, markUploaded, markFailed])

  if (status !== 'uploading') return null

  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100)
  return (
    <span className={styles.progressWrap}>
      <span
        className={styles.bar}
        role="progressbar"
        aria-label={`Uploading ${name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className={styles.barFill} style={{ width: `${percent}%` }} />
      </span>
      <span className={`${styles.sub} ${styles.percent}`}>{percent}%</span>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={`Cancel upload of ${name}`}
        data-row-action
        onClick={() => {
          cancel()
          onRemove(key)
        }}
      >
        <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
        Cancel
      </button>
    </span>
  )
}
