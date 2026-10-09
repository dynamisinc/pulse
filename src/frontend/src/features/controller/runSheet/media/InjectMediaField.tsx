/**
 * features/controller/runSheet/media/InjectMediaField.tsx
 * ---------------------------------------------------------------------------
 * THE ONE ADAPTER between the run-sheet editor and "attach media to a scripted
 * post" (inject-queue story 07, AC "Author live": media, <= 4 images or 1 video,
 * ALT REQUIRED). STAFF world.
 *
 * >>> THIS MODULE IS THE SINGLE PLACE C1's `MediaLibraryPicker` GETS IMPORTED
 * >>> if/when demo-polish C1 lands (frozen props: `{ kind?: MediaKind; max: number;
 * >>> selectedIds: string[]; onChange(ids: string[]): void }`, demo-polish
 * >>> implementation.md §1.11). Nothing else in `runSheet/` may import a picker or
 * >>> know how media is chosen: the editor only ever sees this component's
 * >>> `{ mediaId, alt }[]` value. Swapping the "Library" list below for C1's picker
 * >>> is a one-file change; the alt rows and the rule stay here (the picker returns
 * >>> ids only, so ALT TEXT LIVES HERE).
 *
 * TODAY C1's picker is not on main, so this module reads F0's library hook directly
 * (`useMediaLibrary` from `@/core/media`, `GET /api/staff/media`; the mock registry in
 * dev) and renders:
 *   - the ATTACHED media: a thumbnail (the asset's URL, or a video's poster), its file
 *     name + kind, and a REQUIRED alt-text field (NFR-001) with a Remove;
 *   - the LIBRARY: a compact scrollable list (thumbnail, file name, kind) with an
 *     Attach button per row, each disabled with its reason shown as text when the rule
 *     forbids it;
 *   - a small "Use media id" toggle that reveals the paste-an-id fallback (an id that is
 *     not in the library, or a library that cannot be read).
 *
 * THE RULE (`mediaRules.attachReason`, from the asset KIND the library reports): up to 4
 * images, OR exactly 1 video on its own, never mixed. A pasted id of unknown kind counts
 * toward the limit and cannot sit next to a video; its real kind is the server's call. The
 * rule is also checked on the whole SET (`injectRules.mediaSetError`): once the kinds are
 * known — including for ids pasted before the library loaded — a mixed set or a second video
 * shows in the media error slot, and the editor's Save refuses it. An id that is not on the
 * loaded library page (one page, the newest 100) reads "Kind unknown", not "not in the library".
 * A thumbnail that fails to load (an expired read URL) falls back to the kind icon.
 *
 * CONTENT SECURITY (NFR-004). A media id is an opaque reference the server resolves in
 * scope (a cross-exercise id is an unknown id, COR-001). Thumbnails render only a URL the
 * library hook returned AND `safeImageUrl` accepts (http(s), a same-origin path, a blob);
 * file names and alt text are React text only.
 */

import { useState } from 'react'
import { Box } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleExclamation,
  faFilm,
  faImage,
  faKey,
  faPlus,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { useMediaLibrary, type StaffMediaAssetView } from '@/core/media'
import { consoleChrome as chrome } from '../../consoleChrome'
import { RunSheetButton, RunSheetIconButton } from '../RunSheetButtons'
import { RunSheetField } from '../RunSheetField'
import { INJECT_LIMITS, countCodePoints, mediaSetError } from '../injectRules'
import { attachReason, safeImageUrl, type AttachKind } from './mediaRules'

export interface InjectMediaValue {
  mediaId: string
  alt: string
}

export interface InjectMediaFieldProps {
  /** Unique id prefix (one per post) so every input id is unique on the page. */
  readonly idPrefix: string
  readonly media: readonly InjectMediaValue[]
  readonly onChange: (media: InjectMediaValue[]) => void
  readonly disabled?: boolean
  /**
   * Errors keyed relative to this field: `media` (the list), `media.{i}.mediaId`,
   * `media.{i}.alt` — the editor passes its dotted errors with the post prefix stripped.
   */
  readonly errors?: Readonly<Record<string, string>>
}

/**
 * The picture (or a video's poster) of an asset. If it fails to load (a read URL that has
 * expired, a missing file) it falls back to the kind icon instead of a broken-image glyph.
 */
function ThumbImage({ src, kind }: { readonly src: string; readonly kind: AttachKind }) {
  const [failed, setFailed] = useState(false)
  return failed ? (
    <FontAwesomeIcon icon={kind === 'video' ? faFilm : faImage} data-testid="media-thumb-fallback" />
  ) : (
    <img
      src={src}
      alt=""
      width={40}
      height={40}
      style={{ objectFit: 'cover' }}
      onError={() => setFailed(true)}
    />
  )
}

/** A 40 px square: the asset's picture (or a video's poster), else a kind icon. */
function Thumb({ asset }: { readonly asset: StaffMediaAssetView | undefined }) {
  const src = safeImageUrl(asset?.kind === 'video' ? asset.posterUrl : asset?.url)
  return (
    <Box
      aria-hidden="true"
      data-testid="media-thumb"
      sx={{
        flex: 'none',
        width: 40,
        height: 40,
        borderRadius: '4px',
        overflow: 'hidden',
        border: `1px solid ${chrome.line}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: chrome.inkMuted,
        bgcolor: chrome.bg,
      }}
    >
      {src ? (
        // Keyed by the URL: a new URL gets a fresh try even after an earlier one failed.
        <ThumbImage key={src} src={src} kind={asset?.kind ?? 'unknown'} />
      ) : (
        <FontAwesomeIcon icon={asset?.kind === 'video' ? faFilm : faImage} />
      )}
    </Box>
  )
}

/**
 * `unknown` is "Kind unknown", NOT "not in the library": the library read is one page (the
 * newest 100), so an id that is not on it may well exist — the console just cannot tell its kind.
 */
const kindWord = (kind: AttachKind): string =>
  kind === 'video' ? 'Video' : kind === 'image' ? 'Image' : 'Kind unknown'

export function InjectMediaField({
  idPrefix,
  media,
  onChange,
  disabled,
  errors = {},
}: InjectMediaFieldProps) {
  const library = useMediaLibrary()
  const assets = library.data ?? []
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pending, setPending] = useState('')

  const assetOf = (mediaId: string): StaffMediaAssetView | undefined =>
    assets.find(asset => asset.id === mediaId)
  const attachedKinds: AttachKind[] = media.map(entry => assetOf(entry.mediaId)?.kind ?? 'unknown')
  // SET-LEVEL kind rule, live: once the kinds are known (also for ids pasted BEFORE the library
  // loaded) a mixed set, or more than one video, shows in the media error slot. The editor's
  // Save refuses it too (it validates with the same library kinds).
  const mediaError = errors.media ?? mediaSetError(attachedKinds)

  const attach = (mediaId: string): void => onChange([...media, { mediaId, alt: '' }])
  const setAlt = (index: number, alt: string): void =>
    onChange(media.map((m, i) => (i === index ? { ...m, alt } : m)))
  const remove = (index: number): void => onChange(media.filter((_, i) => i !== index))

  // Paste-an-id fallback.
  const candidate = pending.trim()
  const duplicate = candidate !== '' && media.some(m => m.mediaId === candidate)
  const pasteReason = attachReason(assetOf(candidate)?.kind ?? 'unknown', attachedKinds)
  const canPaste = !disabled && candidate !== '' && !duplicate && pasteReason === undefined
  const paste = (): void => {
    if (!canPaste) return
    attach(candidate)
    setPending('')
  }

  return (
    <Box
      role="group"
      aria-label="Media"
      data-testid="media-field"
      sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}
    >
      <Box sx={{ fontSize: 11.5, color: chrome.inkMuted }}>
        {`Media: up to ${INJECT_LIMITS.mediaMax} images or 1 video (not both). Alt text is required for each.`}
      </Box>

      {media.map((entry, index) => {
        const asset = assetOf(entry.mediaId)
        const name = asset?.fileName ?? entry.mediaId
        return (
          <Box
            key={entry.mediaId}
            data-testid="media-entry"
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.75,
              p: 1,
              border: `1px solid ${chrome.cardBorder}`,
              borderRadius: '6px',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Thumb asset={asset} />
              <Box sx={{ flex: 1, minWidth: 0, fontSize: 11.5 }}>
                <Box
                  component="div"
                  data-testid="media-name"
                  sx={{ color: chrome.ink, fontWeight: 700, overflowWrap: 'anywhere' }}
                >
                  {name}
                </Box>
                <Box component="div" sx={{ color: chrome.inkMuted }}>
                  <span data-testid="media-kind">{kindWord(asset?.kind ?? 'unknown')}</span>
                  {' · '}
                  <Box
                    component="code"
                    data-testid="media-id"
                    sx={{ fontSize: 11, overflowWrap: 'anywhere' }}
                  >
                    {entry.mediaId}
                  </Box>
                </Box>
              </Box>
              <RunSheetIconButton
                icon={faXmark}
                ariaLabel={`Remove media ${name}`}
                disabled={disabled}
                onClick={() => remove(index)}
              />
            </Box>
            <RunSheetField
              id={`${idPrefix}-alt-${index}`}
              label={`Alt text for ${name}`}
              required
              multiline
              rows={1}
              value={entry.alt}
              onChange={value => setAlt(index, value)}
              disabled={disabled}
              error={errors[`media.${index}.alt`] ?? errors[`media.${index}.mediaId`]}
              hint={`${countCodePoints(entry.alt)}/${INJECT_LIMITS.altMax}`}
            />
          </Box>
        )
      })}

      {mediaError ? (
        <Box data-testid={`${idPrefix}-media-error`} sx={{ fontSize: 12, color: chrome.amber }}>
          <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" /> {mediaError}
        </Box>
      ) : null}

      {!disabled ? (
        <Box
          role="group"
          aria-label="Media library"
          data-testid="media-library"
          sx={{
            border: `1px solid ${chrome.cardBorder}`,
            borderRadius: '6px',
            p: 0.75,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5,
          }}
        >
          <Box sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', color: chrome.inkFaint }}>
            LIBRARY
          </Box>
          {library.isPending ? (
            <Box data-testid="media-library-loading" sx={{ fontSize: 12, color: chrome.inkMuted }}>
              Loading the media library…
            </Box>
          ) : library.isError ? (
            <Box data-testid="media-library-error" sx={{ fontSize: 12, color: chrome.amber }}>
              The media library is unavailable. Use a media id instead.
            </Box>
          ) : assets.length === 0 ? (
            <Box data-testid="media-library-empty" sx={{ fontSize: 12, color: chrome.inkMuted }}>
              The library is empty. Upload media from the composer, or use a media id.
            </Box>
          ) : (
            <Box
              component="ul"
              aria-label="Media library items"
              sx={{
                m: 0,
                p: 0,
                listStyle: 'none',
                maxHeight: 190,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 0.5,
              }}
            >
              {assets.map(asset => {
                const attached = media.some(m => m.mediaId === asset.id)
                const reason = attached ? 'Already attached' : attachReason(asset.kind, attachedKinds)
                return (
                  <Box
                    component="li"
                    key={asset.id}
                    data-testid="media-library-item"
                    sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                  >
                    <Thumb asset={asset} />
                    <Box sx={{ flex: 1, minWidth: 0, fontSize: 11.5 }}>
                      <Box sx={{ color: chrome.ink, fontWeight: 700, overflowWrap: 'anywhere' }}>
                        {asset.fileName}
                      </Box>
                      <Box sx={{ color: chrome.inkMuted }}>{kindWord(asset.kind)}</Box>
                      {reason ? (
                        <Box data-testid="media-reason" sx={{ color: chrome.inkMuted }}>
                          {reason}
                        </Box>
                      ) : null}
                    </Box>
                    <RunSheetButton
                      icon={faPlus}
                      label="Attach"
                      ariaLabel={`Attach ${asset.fileName}`}
                      disabled={reason !== undefined}
                      title={reason}
                      testId="media-attach"
                      onClick={() => attach(asset.id)}
                    />
                  </Box>
                )
              })}
            </Box>
          )}

          <Box>
            <RunSheetButton
              icon={faKey}
              label="Use media id"
              ariaLabel="Use media id"
              pressed={pasteOpen}
              testId={`${idPrefix}-use-media-id`}
              onClick={() => setPasteOpen(open => !open)}
            />
          </Box>
          {pasteOpen ? (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <Box sx={{ flex: 1 }}>
                <RunSheetField
                  id={`${idPrefix}-add-media`}
                  label="Add media id"
                  value={pending}
                  onChange={setPending}
                  error={
                    duplicate
                      ? 'That media is already attached'
                      : candidate !== '' && pasteReason
                        ? pasteReason
                        : undefined
                  }
                  onEnter={paste}
                  inputProps={{ 'data-testid': `${idPrefix}-add-media-input` }}
                  sx={{ '& input': { fontFamily: 'ui-monospace, monospace' } }}
                />
              </Box>
              <RunSheetButton
                icon={faPlus}
                label="Add media"
                ariaLabel="Add media"
                disabled={!canPaste}
                testId={`${idPrefix}-add-media-button`}
                onClick={paste}
              />
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}
