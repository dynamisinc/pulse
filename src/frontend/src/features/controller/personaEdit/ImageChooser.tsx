/**
 * features/controller/personaEdit/ImageChooser.tsx
 * ---------------------------------------------------------------------------
 * One avatar-or-banner chooser inside the persona edit dialog (demo-polish story
 * 21 / PE-FE; COR-024). STAFF world (COBRA buttons, dense, labelled) — it
 * deliberately does NOT reuse the participant `Avatar` or any participant
 * styling: the preview is a plainly staff-styled, bordered frame so it can never
 * be mistaken for what a participant sees.
 *
 * The controller can:
 *   - UPLOAD a new image (`useMediaUpload`, owned by the dialog so it can disable
 *     Save while an upload is running) — checked client-side first
 *     (`validateMediaFile` for size/MIME, then "must be an image": a video is
 *     refused here, the server would 400 it anyway); progress is a labelled
 *     `progressbar`, and it can be cancelled;
 *   - PICK from the exercise media library (C1's `MediaLibraryPicker`, imported
 *     only through `./libraryPicker`, `kind="image"`, `max={1}`) — opened inline
 *     on demand, closed again once something is picked;
 *   - REMOVE the current image (sent as `null` on save) and UNDO any of the above.
 *     Remove is offered whether or not a preview URL is present: the staff DTO has
 *     only the signed URL (no media id, no has-image flag), and the URL is missing
 *     both when no image is set AND when signing it failed — so the chooser never
 *     claims "none is set", and never withholds Remove;
 *
 * Every state is said in WORDS next to the preview ("Current image", "New image
 * selected — takes effect when you save", "Image will be removed when you save",
 * "No avatar image available — none is set, or its preview could not be loaded"),
 * never by a border colour or an icon alone (NFR-001). Nothing here talks to the
 * server about the persona: the chooser only reports an `ImageChoice`; the dialog's
 * Save turns it into the merge-patch.
 *
 * Preview URLs are opaque strings (a SAS read URL live, a `blob:`/`/mock-media`
 * URL in mock mode): they pass through the app's one media allow-list
 * (`resolveSafeMediaUrl`) before reaching an `<img src>` — a rejected URL shows
 * the text placeholder instead of a request.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react'
import { Box, LinearProgress, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faImages,
  faRotateLeft,
  faTrashCan,
  faTriangleExclamation,
  faUpload,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import {
  ACCEPT_IMAGES_ONLY,
  useMediaLibrary,
  validateMediaFile,
  type UseMediaUploadResult,
} from '@/core/media'
import { resolveSafeMediaUrl } from '@/features/social/components/media/safeMediaUrl'
import { CobraLinkButton, CobraSecondaryButton } from '@/theme/styledComponents'
import { MediaLibraryPicker } from './libraryPicker'
import { MUTED_TEXT } from './personaEditStyles'
import type { ImageChoice } from './types'

export interface ImageChooserProps {
  /** Which image this is: drives the preview shape and the words around it. */
  readonly slot: 'avatar' | 'banner'
  /** The persona's handle (no `@`), for the preview's accessible text. */
  readonly handle: string
  /** The persona's initials, shown in the avatar placeholder. */
  readonly initials: string
  /**
   * The persisted image's signed read URL, or `undefined` when the persona has none OR
   * the server could not sign it. The staff DTO carries no media id and no has-image flag,
   * so "no URL" is deliberately NOT read as "no image" (see `WORDS` and Remove below).
   */
  readonly currentUrl: string | undefined
  readonly choice: ImageChoice
  readonly onChoose: (choice: ImageChoice) => void
  /** The dialog-owned upload state machine for this slot. */
  readonly upload: UseMediaUploadResult
}

/**
 * The words around each image. `unknown` is the honest status for "the persona has no
 * read URL": that means none is set OR the image's URL could not be signed — the
 * staff DTO cannot tell the two apart, so the copy must not claim either.
 */
const WORDS = {
  avatar: {
    label: 'Avatar',
    unknown:
      'No avatar image available — none is set, or its preview could not be loaded.',
  },
  banner: {
    label: 'Banner',
    unknown:
      'No banner image available — none is set, or its preview could not be loaded.',
  },
} as const

const PREVIEW_FRAME_SX = {
  flex: 'none',
  overflow: 'hidden',
  border: '1px solid',
  borderColor: 'text.secondary',
  bgcolor: 'grey.100',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
} as const

/** Inline icon + words problem line (NFR-001: never colour alone). */
function Problem({ message }: { message: string }) {
  return (
    <Stack
      direction="row"
      sx={{ alignItems: 'flex-start', gap: 0.75, color: 'notifications.errorText' }}
    >
      <Box component="span" sx={{ mt: '2px' }}>
        <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
      </Box>
      <Typography variant="body2">{message}</Typography>
    </Stack>
  )
}

interface LibraryChoiceProps {
  readonly selectedId: string | undefined
  readonly onPick: (mediaId: string | undefined, previewUrl: string | undefined) => void
}

/**
 * The inline library picker. Its own component so the library read is only made
 * (and the asset's preview URL only looked up) while the picker is actually open.
 */
function LibraryChoice({ selectedId, onPick }: LibraryChoiceProps) {
  const library = useMediaLibrary('image')
  return (
    <MediaLibraryPicker
      kind="image"
      max={1}
      selectedIds={selectedId !== undefined ? [selectedId] : []}
      onChange={ids => {
        if (ids.length === 0) {
          onPick(undefined, undefined)
          return
        }
        // With max = 1 a picker may hand back [previous, next] or just [next].
        const next = ids.find(id => id !== selectedId) ?? ids[0]
        const asset = library.data?.find(candidate => candidate.id === next)
        onPick(next, asset?.url)
      }}
    />
  )
}

/** The avatar / banner chooser. See the module header. */
export function ImageChooser({
  slot,
  handle,
  initials,
  currentUrl,
  choice,
  onChoose,
  upload,
}: ImageChooserProps) {
  const { label, unknown } = WORDS[slot]
  const noun = label.toLowerCase()
  const statusId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [fileProblem, setFileProblem] = useState<string | undefined>(undefined)
  // The upload whose result may still be applied. Cleared by Cancel and on unmount, replaced
  // by a newer upload — so a response that lands in the same tick as a Cancel (the request
  // finished, `cancel()` came a moment later) is dropped rather than applied.
  const currentUploadRef = useRef<symbol | null>(null)
  useEffect(() => () => {
    currentUploadRef.current = null
  }, [])

  // FOCUS CONTINUITY (Gate-1 L-focus). Remove, Undo, a library pick, Cancel upload and a
  // finished upload each REMOVE (or disable) the control that was focused; the browser then
  // parks focus on the dialog container / <body>, which strands a keyboard user. So the
  // handler names the counterpart control that should take focus, and the layout effect below
  // focuses it as soon as it exists in the DOM (right after the commit that removed the old
  // one) — but only while focus is still "parked" or inside this chooser, never stealing it
  // from a field the controller has since moved to.
  const rootRef = useRef<HTMLFieldSetElement>(null)
  const uploadButtonRef = useRef<HTMLButtonElement>(null)
  const removeButtonRef = useRef<HTMLButtonElement>(null)
  const undoButtonRef = useRef<HTMLButtonElement>(null)
  const focusNextRef = useRef<'upload' | 'remove' | 'undo' | null>(null)
  useLayoutEffect(() => {
    const wanted = focusNextRef.current
    if (wanted === null) return
    const target = { upload: uploadButtonRef, remove: removeButtonRef, undo: undoButtonRef }[wanted]
      .current
    if (target === null || target.disabled) return // not rendered yet — try again next commit
    focusNextRef.current = null
    const active = document.activeElement
    const parked =
      active === null
      || active === document.body
      || (active instanceof HTMLElement && active.classList.contains('MuiDialog-container'))
      || rootRef.current?.contains(active) === true
    if (parked) target.focus()
  })

  const uploading = upload.state === 'uploading'
  const previewSource =
    choice.mode === 'set' ? choice.previewUrl : choice.mode === 'keep' ? currentUrl : undefined
  const previewUrl = resolveSafeMediaUrl(previewSource)
  // Remove never depends on `currentUrl`: when the URL is missing because signing failed,
  // an image may still be set and the controller must still be able to clear it.
  const canRemove = choice.mode === 'keep'

  const status =
    choice.mode === 'set'
      ? 'New image selected — takes effect when you save.'
      : choice.mode === 'clear'
        ? 'Image will be removed when you save.'
        : currentUrl !== undefined
          ? 'Current image.'
          : unknown

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset so choosing the SAME file again still fires a change.
    event.target.value = ''
    if (file === undefined) return
    setFileProblem(undefined)

    const checked = validateMediaFile(file)
    if (!checked.ok) {
      setFileProblem(checked.error)
      return
    }
    if (checked.kind !== 'image') {
      setFileProblem(`The ${noun} must be an image — JPEG, PNG, GIF or WebP.`)
      return
    }
    setLibraryOpen(false)
    const token = Symbol('upload')
    currentUploadRef.current = token
    upload
      .start(file)
      .then(asset => {
        if (currentUploadRef.current !== token) return
        if (asset.kind !== 'image') {
          setFileProblem(`The ${noun} must be an image — JPEG, PNG, GIF or WebP.`)
          return
        }
        focusNextRef.current = 'undo'
        onChoose({ mode: 'set', mediaId: asset.id, previewUrl: asset.url })
      })
      // The failure is recorded in `upload.error` (or is a cancel); never unhandled.
      .catch(() => undefined)
  }

  return (
    <Box
      component="fieldset"
      ref={rootRef}
      data-testid={`persona-edit-${slot}`}
      sx={{
        m: 0,
        p: 0,
        border: 0,
        minWidth: 0,
      }}
    >
      <Typography
        component="legend"
        sx={{ p: 0, mb: 0.75, fontSize: 13, fontWeight: 700 }}
      >
        {label}
      </Typography>

      <Stack direction="row" sx={{ gap: 2, alignItems: 'flex-start' }}>
        <Box
          data-testid={`persona-edit-${slot}-preview`}
          sx={{
            ...PREVIEW_FRAME_SX,
            ...(slot === 'avatar'
              ? { width: 72, height: 72, borderRadius: '50%' }
              : { width: 216, height: 72, borderRadius: '4px' }),
          }}
        >
          {previewUrl !== undefined ? (
            <Box
              component="img"
              src={previewUrl}
              alt={`${label} preview for @${handle}`}
              sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <Typography
              aria-hidden
              sx={{ fontSize: slot === 'avatar' ? 20 : 11, fontWeight: 700, color: MUTED_TEXT }}
            >
              {slot === 'avatar' ? initials : choice.mode === 'clear' ? 'Removed' : 'No preview'}
            </Typography>
          )}
        </Box>

        <Stack sx={{ gap: 1, minWidth: 0, flex: 1 }}>
          <Typography id={statusId} variant="body2" data-testid={`persona-edit-${slot}-status`}>
            {status}
          </Typography>

          <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <CobraSecondaryButton
              ref={uploadButtonRef}
              size="small"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              startIcon={<FontAwesomeIcon icon={faUpload} />}
              aria-describedby={statusId}
            >
              Upload image…
            </CobraSecondaryButton>
            <CobraSecondaryButton
              size="small"
              disabled={uploading}
              aria-expanded={libraryOpen}
              onClick={() => setLibraryOpen(open => !open)}
              startIcon={<FontAwesomeIcon icon={faImages} />}
              aria-describedby={statusId}
            >
              Choose from library
            </CobraSecondaryButton>
            {canRemove ? (
              <CobraLinkButton
                ref={removeButtonRef}
                size="small"
                disabled={uploading}
                onClick={() => {
                  focusNextRef.current = 'undo'
                  onChoose({ mode: 'clear' })
                }}
                startIcon={<FontAwesomeIcon icon={faTrashCan} />}
              >
                Remove {noun}
              </CobraLinkButton>
            ) : null}
            {choice.mode !== 'keep' ? (
              <CobraLinkButton
                ref={undoButtonRef}
                size="small"
                disabled={uploading}
                onClick={() => {
                  focusNextRef.current = 'remove'
                  onChoose({ mode: 'keep' })
                }}
                startIcon={<FontAwesomeIcon icon={faRotateLeft} />}
              >
                Undo {noun} change
              </CobraLinkButton>
            ) : null}
          </Stack>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_IMAGES_ONLY}
            aria-label={`Upload ${noun} image file`}
            data-testid={`persona-edit-${slot}-file`}
            onChange={handleFile}
            style={{ display: 'none' }}
          />

          {uploading ? (
            <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
              <LinearProgress
                variant="determinate"
                value={Math.round(upload.progress * 100)}
                aria-label={`Uploading ${noun}`}
                sx={{ flex: 1, height: 8, borderRadius: 4 }}
              />
              <Typography variant="caption">{Math.round(upload.progress * 100)}%</Typography>
              <CobraLinkButton
                size="small"
                onClick={() => {
                  currentUploadRef.current = null
                  focusNextRef.current = 'upload'
                  upload.cancel()
                }}
                startIcon={<FontAwesomeIcon icon={faXmark} />}
              >
                Cancel upload
              </CobraLinkButton>
            </Stack>
          ) : null}

          <Box role="alert">
            {fileProblem !== undefined ? <Problem message={fileProblem} /> : null}
            {upload.state === 'error' && upload.error !== undefined && fileProblem === undefined
              ? <Problem message={upload.error} />
              : null}
          </Box>
        </Stack>
      </Stack>

      {libraryOpen ? (
        <Box
          role="region"
          aria-label={`Choose the ${noun} from the media library`}
          sx={{
            mt: 1.5,
            p: 1,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '4px',
            maxHeight: 220,
            overflowY: 'auto',
          }}
        >
          <LibraryChoice
            selectedId={choice.mode === 'set' ? choice.mediaId : undefined}
            onPick={(mediaId, url) => {
              if (mediaId === undefined) {
                onChoose({ mode: 'keep' })
                return
              }
              focusNextRef.current = 'undo'
              onChoose({ mode: 'set', mediaId, ...(url !== undefined ? { previewUrl: url } : {}) })
              setLibraryOpen(false)
            }}
          />
        </Box>
      ) : null}
    </Box>
  )
}
