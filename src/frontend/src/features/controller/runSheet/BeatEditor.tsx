/**
 * features/controller/runSheet/BeatEditor.tsx
 * ---------------------------------------------------------------------------
 * The BEAT EDITOR dialog (demo-polish C3, story 19; CTL-010 lite). STAFF world -
 * COBRA components (`CobraTextField`, `CobraPrimaryButton`, `CobraLinkButton`),
 * FontAwesome icons only, MUI 9 `sx`-only. Dense and keyboard-operable: native
 * selects and inputs, `Tab` order top to bottom, `Esc` cancels (the dialog's own
 * focus trap), `Ctrl/Cmd+Enter` saves, the first field takes focus on open.
 *
 * AUTHORING FIELDS (AC "Author beats"): title, persona (picker), text with a 280
 * code-point counter, media from the exercise library, intended scenario minute
 * (shown as "T+14m" - informational and a sort hint only, nothing fires on a timer),
 * optional "reply to" (another beat or an existing post id), an optional collapsed
 * "Starting engagement" baseline, and notes.
 *
 * MEDIA (`MediaLibraryPicker`, owned by C1). The picker is imported from
 * `controller/media` and used through its FROZEN props (implementation.md §1.11):
 *
 *     { kind?: MediaKind; max: number; selectedIds: string[]; onChange(ids: string[]): void }
 *
 * The picker hands back ids only, so this editor owns what the picker does not: the
 * kind (images up to 4, or exactly one video - locked once something is attached), the
 * REQUIRED alt text per item, and the file name / thumbnail / "not in the library" notes,
 * all read from the library view the panel already builds (`libraryView.ts`: the list it loads
 * with `useMediaLibrary`, plus assets the picker cached under its Images / Videos filters).
 *
 * VALIDATION is `runSheetBeatForm.validateDraft`, which runs the draft through the same
 * zod schema the importer uses. Errors are text next to the field (never colour alone)
 * and a summary at the top announces the count (`role="alert"`). Save is blocked until
 * the draft is valid; nothing is stored before then.
 *
 * Free text (title, text, alt, notes) is held and rendered as plain text. It is sanitized
 * by the server's ingest (and the mock `createPost`) when the beat is fired (NFR-004).
 */

import { useId, useMemo, useState } from 'react'
import {
  Box,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faChevronDown,
  faChevronRight,
  faCircleExclamation,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { CobraLinkButton, CobraPrimaryButton, CobraTextField } from '@/theme/styledComponents'
import type { MediaKind, StaffMediaAssetView } from '@/core/media'
import type { Persona } from '@/features/personas'
// The ONE media-URL allow-list in the app (delegates to F2's `resolveSafeMediaUrl`): https,
// same-origin paths and same-origin blob URLs only - no credentials, control characters or
// backslash tricks.
import { safeImageUrl } from '@/features/social/utils/safeImageUrl'
import { FIELD_SX, runSheetTokens } from './runSheetTokens'
// C1's picker. Frozen props: see the module header. If C1 lands it at a different path,
// this is the ONE import to change.
import { MediaLibraryPicker } from '@/features/controller/media/MediaLibraryPicker'
import { StaffDialog } from './StaffDialog'
import { descendantIds, type BeatContent, type RunSheetData } from './runSheetModel'
import {
  contentFromDraft,
  draftFromBeat,
  emptyDraft,
  maxMediaFor,
  validateDraft,
  type BeatDraft,
  type ReplyMode,
} from './runSheetBeatForm'
import {
  RUN_SHEET_LIMITS,
  codePointLength,
  formatScenarioMinute,
  type RunSheetBeat,
} from './runSheetSchema'

export interface BeatEditorProps {
  /** The sheet being edited (reply options and validation read it). */
  readonly data: RunSheetData
  /** The beat to edit; omit to create a new one. */
  readonly beat?: RunSheetBeat
  /** The exercise's personas, for the persona picker. */
  readonly personas: readonly Persona[]
  /**
   * The exercise's media library by id, or `undefined` while it is loading / failed to load
   * (then nothing is flagged as missing).
   */
  readonly library?: ReadonlyMap<string, StaffMediaAssetView>
  /** Called with valid content when the controller saves. */
  readonly onSave: (content: BeatContent) => void
  readonly onCancel: () => void
}

const SECTION_LABEL_SX = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.08em',
  color: runSheetTokens.mutedText,
} as const

/** The kinds of the media the library knows, by id. */
function kindsOf(
  library: ReadonlyMap<string, StaffMediaAssetView> | undefined,
): Map<string, MediaKind> {
  const kinds = new Map<string, MediaKind>()
  for (const [id, asset] of library ?? []) kinds.set(id, asset.kind)
  return kinds
}

export function BeatEditor({ data, beat, personas, library, onSave, onCancel }: BeatEditorProps) {
  const titleId = useId()
  const isEdit = beat !== undefined
  const [draft, setDraft] = useState<BeatDraft>(() =>
    beat === undefined ? emptyDraft() : draftFromBeat(beat, kindsOf(library)),
  )
  // Errors appear after the first failed save, then follow every edit.
  const [attempted, setAttempted] = useState(false)
  const [baselineOpen, setBaselineOpen] = useState(
    () => draft.baselineLike !== '' || draft.baselineRepost !== '' || draft.baselineReply !== '',
  )

  const errors = useMemo(
    () => validateDraft(draft, data, beat?.id),
    [draft, data, beat?.id],
  )
  const errorList = Object.values(errors)
  const shown = attempted ? errors : {}
  const update = (patch: Partial<BeatDraft>) => setDraft(prev => ({ ...prev, ...patch }))

  const textLength = codePointLength(draft.text)
  const overBy = textLength - RUN_SHEET_LIMITS.textMax
  const minuteNumber = /^\d+$/.test(draft.minute.trim()) ? Number(draft.minute.trim()) : undefined

  const personaOptions = useMemo(
    () => [...personas].sort((a, b) => a.handle.localeCompare(b.handle)),
    [personas],
  )
  const knownHandle = personas.some(p => p.handle.toLowerCase() === draft.handle.toLowerCase())

  // A reply cannot target itself or anything that (transitively) replies to it.
  const replyOptions = useMemo(() => {
    const excluded = beat === undefined ? new Set<string>() : descendantIds(data, beat.id)
    return data.beats.filter(candidate => candidate.id !== beat?.id && !excluded.has(candidate.id))
  }, [data, beat])

  const maxMedia = maxMediaFor(draft.mediaKind)

  const setMediaIds = (ids: string[]) => {
    const kept = ids.slice(0, maxMedia)
    setDraft(prev => ({
      ...prev,
      media: kept.map(id => ({
        mediaId: id,
        alt: prev.media.find(item => item.mediaId === id)?.alt ?? '',
      })),
    }))
  }
  const setAlt = (mediaId: string, alt: string) =>
    setDraft(prev => ({
      ...prev,
      media: prev.media.map(item => (item.mediaId === mediaId ? { ...item, alt } : item)),
    }))

  const handleSave = () => {
    setAttempted(true)
    if (Object.keys(errors).length > 0) return
    onSave(contentFromDraft(draft))
  }

  return (
    <StaffDialog
      initialFocus="[data-initial-focus]"
      open
      onClose={onCancel}
      fullWidth
      maxWidth="md"
      aria-labelledby={titleId}
    >
      <DialogTitle id={titleId} sx={{ fontSize: 15, fontWeight: 800, pb: 0.5 }}>
        {isEdit ? 'Edit beat' : 'New beat'}
      </DialogTitle>
      <DialogContent sx={FIELD_SX}>
        <Stack
          data-testid="beat-editor"
          // Keyboard-first (NFR-001): Ctrl/Cmd+Enter saves without leaving the field.
          onKeyDown={event => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              handleSave()
            }
          }}
          sx={{ gap: 1.5, pt: 1 }}
        >
          {attempted && errorList.length > 0 && (
            <Box
              role="alert"
              data-testid="beat-editor-errors"
              sx={{ display: 'flex', gap: 1, alignItems: 'center', fontSize: 13, fontWeight: 700 }}
            >
              <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
              Fix {errorList.length} {errorList.length === 1 ? 'problem' : 'problems'} before saving.
            </Box>
          )}

          <CobraTextField
            label="Title"
            size="small"
            fullWidth
            required
            slotProps={{ htmlInput: { 'data-initial-focus': '' } }}
            value={draft.title}
            onChange={event => update({ title: event.target.value })}
            error={shown.title !== undefined}
            helperText={shown.title ?? 'Shown only to controllers.'}
          />

          <Stack direction="row" sx={{ gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <CobraTextField
              select
              label="Persona"
              size="small"
              required
              value={draft.handle}
              onChange={event => update({ handle: event.target.value })}
              error={shown.persona !== undefined}
              helperText={shown.persona ?? 'Who posts this. Checked again when you fire.'}
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
              sx={{ flex: '2 1 260px' }}
            >
              <option value="">Choose a persona...</option>
              {draft.handle !== '' && !knownHandle && (
                <option value={draft.handle}>
                  @{draft.handle} (not found in this exercise)
                </option>
              )}
              {personaOptions.map(persona => (
                <option key={persona.id} value={persona.handle}>
                  @{persona.handle} - {persona.displayName}
                </option>
              ))}
            </CobraTextField>

            <CobraTextField
              label="Intended minute"
              size="small"
              required
              value={draft.minute}
              onChange={event => update({ minute: event.target.value })}
              error={shown.minute !== undefined}
              helperText={
                shown.minute
                ?? `${minuteNumber === undefined ? 'T+?m' : formatScenarioMinute(minuteNumber)}: `
                  + 'a sort hint only, nothing fires on a timer.'
              }
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
              sx={{ flex: '1 1 180px' }}
            />
          </Stack>

          <CobraTextField
            label="Text"
            size="small"
            fullWidth
            multiline
            minRows={3}
            value={draft.text}
            onChange={event => update({ text: event.target.value })}
            error={shown.text !== undefined || overBy > 0}
            helperText={
              <Box component="span" sx={{ display: 'inline-flex', gap: 1, alignItems: 'center' }}>
                {(shown.text !== undefined || overBy > 0) && (
                  <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" />
                )}
                <span data-testid="beat-text-counter">
                  {textLength} / {RUN_SHEET_LIMITS.textMax}
                  {overBy > 0 ? ` - ${overBy} over the limit` : ''}
                </span>
                {shown.text !== undefined && overBy <= 0 && <span>{shown.text}</span>}
              </Box>
            }
          />

          {/* ---- Media ---- */}
          <Stack
            component="fieldset"
            data-testid="beat-media"
            sx={{
              m: 0,
              p: 1.25,
              gap: 1,
              border: `1px solid ${runSheetTokens.hairline}`,
              borderRadius: '6px',
              minWidth: 0,
            }}
          >
            <Typography component="legend" sx={{ ...SECTION_LABEL_SX, px: 0.5 }}>
              MEDIA (OPTIONAL)
            </Typography>
            <Stack direction="row" sx={{ gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              {(['image', 'video'] as const).map(kind => (
                <Box
                  key={kind}
                  component="label"
                  sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'center', fontSize: 13 }}
                >
                  <input
                    type="radio"
                    name="beat-media-kind"
                    value={kind}
                    checked={draft.mediaKind === kind}
                    disabled={draft.media.length > 0}
                    onChange={() => update({ mediaKind: kind })}
                  />
                  {kind === 'image' ? 'Images (up to 4)' : 'One video'}
                </Box>
              ))}
              {draft.media.length > 0 && (
                <Typography sx={{ fontSize: 12, color: runSheetTokens.mutedText }}>
                  Remove the attached media to switch type.
                </Typography>
              )}
            </Stack>

            <MediaLibraryPicker
              kind={draft.mediaKind}
              max={maxMedia}
              selectedIds={draft.media.map(item => item.mediaId)}
              onChange={setMediaIds}
            />

            {shown.media !== undefined && (
              <Typography role="alert" sx={{ fontSize: 12, fontWeight: 700 }}>
                {shown.media}
              </Typography>
            )}

            {draft.media.length > 0 && (
              <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0, gap: 1 }}>
                {draft.media.map((item, index) => {
                  const asset = library?.get(item.mediaId)
                  const missing = library !== undefined && asset === undefined
                  const src = safeImageUrl(asset?.kind === 'video' ? asset.posterUrl : asset?.url)
                  const altError = shown[`media.${index}.alt`]
                  return (
                    <Stack
                      component="li"
                      key={item.mediaId}
                      direction="row"
                      sx={{ gap: 1.25, alignItems: 'flex-start' }}
                    >
                      <Box
                        sx={{
                          flex: 'none',
                          width: 56,
                          height: 56,
                          borderRadius: '4px',
                          overflow: 'hidden',
                          border: `1px solid ${runSheetTokens.hairline}`,
                          bgcolor: runSheetTokens.workArea,
                        }}
                      >
                        {src !== undefined && (
                          <Box
                            component="img"
                            src={src}
                            alt=""
                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        )}
                      </Box>
                      <Stack sx={{ flex: 1, minWidth: 0, gap: 0.5 }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 700, wordBreak: 'break-all' }}>
                          {asset?.fileName ?? item.mediaId}
                          {asset !== undefined ? ` (${asset.kind})` : ''}
                        </Typography>
                        {missing && (
                          <Typography
                            data-testid="media-missing-note"
                            sx={{ fontSize: 12, display: 'flex', gap: 0.75, alignItems: 'center' }}
                          >
                            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
                            Not in this exercise's media library. You can still save, but firing
                            may be refused.
                          </Typography>
                        )}
                        <CobraTextField
                          label={`Description (alt text) for ${asset?.fileName ?? item.mediaId}`}
                          size="small"
                          fullWidth
                          required
                          value={item.alt}
                          onChange={event => setAlt(item.mediaId, event.target.value)}
                          error={altError !== undefined}
                          helperText={altError ?? 'Required: what someone who cannot see it needs to know.'}
                        />
                      </Stack>
                      <CobraLinkButton
                        size="small"
                        aria-label={`Remove ${asset?.fileName ?? item.mediaId}`}
                        onClick={() => setMediaIds(
                          draft.media
                            .filter(other => other.mediaId !== item.mediaId)
                            .map(other => other.mediaId),
                        )}
                      >
                        Remove
                      </CobraLinkButton>
                    </Stack>
                  )
                })}
              </Stack>
            )}
          </Stack>

          {/* ---- Reply to ---- */}
          <Stack direction="row" sx={{ gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <CobraTextField
              select
              label="Reply to"
              size="small"
              value={draft.replyMode}
              onChange={event => update({ replyMode: event.target.value as ReplyMode })}
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
              sx={{ flex: '1 1 200px' }}
            >
              <option value="none">Not a reply</option>
              <option value="beat">A beat in this sheet</option>
              <option value="post">An existing post</option>
            </CobraTextField>
            {draft.replyMode === 'beat' && (
              <CobraTextField
                select
                label="Parent beat"
                size="small"
                value={draft.replyBeatId}
                onChange={event => update({ replyBeatId: event.target.value })}
                error={shown.replyTo !== undefined}
                helperText={shown.replyTo ?? 'This beat stays disabled until the parent is fired.'}
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                sx={{ flex: '2 1 260px' }}
              >
                <option value="">Choose a beat...</option>
                {draft.replyBeatId !== ''
                  && !replyOptions.some(option => option.id === draft.replyBeatId) && (
                  <option value={draft.replyBeatId}>{draft.replyBeatId} (unavailable)</option>
                )}
                {replyOptions.map(option => (
                  <option key={option.id} value={option.id}>
                    #{option.order} {option.title}
                  </option>
                ))}
              </CobraTextField>
            )}
            {draft.replyMode === 'post' && (
              <CobraTextField
                label="Post id"
                size="small"
                value={draft.replyPostId}
                onChange={event => update({ replyPostId: event.target.value })}
                error={shown.replyTo !== undefined}
                helperText={shown.replyTo ?? 'The id of a post that already exists.'}
                sx={{ flex: '2 1 260px' }}
              />
            )}
          </Stack>

          {/* ---- Starting engagement ---- */}
          <Box>
            <CobraLinkButton
              size="small"
              aria-expanded={baselineOpen}
              aria-controls="beat-baseline"
              onClick={() => setBaselineOpen(open => !open)}
              startIcon={<FontAwesomeIcon icon={baselineOpen ? faChevronDown : faChevronRight} />}
              sx={{ pl: 0 }}
            >
              Starting engagement
            </CobraLinkButton>
            {baselineOpen && (
              <Stack
                id="beat-baseline"
                direction="row"
                sx={{ gap: 1.5, flexWrap: 'wrap', mt: 0.5 }}
              >
                {([
                  ['Likes', 'baselineLike', 'baseline.like'],
                  ['Reposts', 'baselineRepost', 'baseline.repost'],
                  ['Replies', 'baselineReply', 'baseline.reply'],
                ] as const).map(([label, key, errorKey]) => (
                  <CobraTextField
                    key={key}
                    label={label}
                    size="small"
                    value={draft[key]}
                    onChange={event => update({ [key]: event.target.value })}
                    error={shown[errorKey] !== undefined}
                    helperText={shown[errorKey] ?? '0 to 1,000,000'}
                    slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                    sx={{ flex: '1 1 140px' }}
                  />
                ))}
              </Stack>
            )}
          </Box>

          <CobraTextField
            label="Notes"
            size="small"
            fullWidth
            multiline
            minRows={2}
            value={draft.notes}
            onChange={event => update({ notes: event.target.value })}
            error={shown.notes !== undefined}
            helperText={shown.notes ?? `Controller-only. ${draft.notes.length} / ${RUN_SHEET_LIMITS.notesMax}`}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Typography sx={{ flex: 1, fontSize: 12, color: runSheetTokens.mutedText }}>
          Ctrl+Enter saves, Esc cancels.
        </Typography>
        <CobraLinkButton onClick={onCancel}>Cancel</CobraLinkButton>
        <CobraPrimaryButton onClick={handleSave}>
          Save beat
        </CobraPrimaryButton>
      </DialogActions>
    </StaffDialog>
  )
}
