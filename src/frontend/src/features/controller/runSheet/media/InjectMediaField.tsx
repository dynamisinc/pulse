/**
 * features/controller/runSheet/media/InjectMediaField.tsx
 * ---------------------------------------------------------------------------
 * THE ONE ADAPTER between the run-sheet editor and "attach media to a scripted
 * post" (inject-queue story 07, AC "Author live": media via C1's
 * `MediaLibraryPicker`, <= 4 images or 1 video, ALT REQUIRED). STAFF world.
 *
 * >>> THIS MODULE IS THE SINGLE PLACE C1's `MediaLibraryPicker` GETS IMPORTED
 * >>> when demo-polish C1 lands (frozen props: `{ kind?: MediaKind; max: number;
 * >>> selectedIds: string[]; onChange(ids: string[]): void }`, demo-polish
 * >>> implementation.md §1.11). Nothing else in `runSheet/` may import the picker
 * >>> or know how media is chosen: the editor only ever sees this component's
 * >>> `{ mediaId, alt }[]` value. That keeps the C1 swap a one-file change.
 *
 * TODAY (C1's picker does not exist yet): it renders the attached media — each
 * entry's id, a REQUIRED alt-text field and a Remove — plus an "Add media id" text
 * input (paste a library media id, press Enter or Add). It does NOT look the id up
 * or preview it: the library read (`GET /api/staff/media`) belongs to C1.
 *
 * WHEN C1 LANDS: render `<MediaLibraryPicker max={4} selectedIds={ids}
 * onChange={ids => ...} />` in place of the "Add media id" input and keep the alt
 * rows below it. The picker returns ids only, so ALT TEXT STAYS HERE: on `onChange`
 * keep the alt of ids that remain and start new ids with an empty alt (which the
 * editor then refuses to submit until it is filled, NFR-001). The "<= 4 images OR
 * exactly 1 video, never mixed" rule needs the media KIND, which only the library
 * knows; until then the console enforces the count (<= 4) and the server enforces
 * the mix (400 on the field).
 *
 * CONTENT SECURITY (NFR-004). A media id is an opaque reference the server
 * resolves in scope (a cross-exercise id is an unknown id, COR-001); the console
 * never fetches or renders a URL from it. Alt text is rendered as React text only.
 */

import { useState } from 'react'
import { Box } from '@mui/material'
import { faPlus, faXmark } from '@fortawesome/free-solid-svg-icons'
import { consoleChrome as chrome } from '../../consoleChrome'
import { RunSheetButton, RunSheetIconButton } from '../RunSheetButtons'
import { RunSheetField } from '../RunSheetField'
import { INJECT_LIMITS, countCodePoints } from '../injectRules'

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

export function InjectMediaField({
  idPrefix,
  media,
  onChange,
  disabled,
  errors = {},
}: InjectMediaFieldProps) {
  const [pending, setPending] = useState('')
  const atLimit = media.length >= INJECT_LIMITS.mediaMax
  const candidate = pending.trim()
  const duplicate = candidate !== '' && media.some(m => m.mediaId === candidate)
  const canAdd = !disabled && !atLimit && candidate !== '' && !duplicate

  const add = (): void => {
    if (!canAdd) return
    onChange([...media, { mediaId: candidate, alt: '' }])
    setPending('')
  }

  const setAlt = (index: number, alt: string): void =>
    onChange(media.map((m, i) => (i === index ? { ...m, alt } : m)))

  const remove = (index: number): void => onChange(media.filter((_, i) => i !== index))

  return (
    <Box
      role="group"
      aria-label="Media"
      data-testid="media-field"
      sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}
    >
      <Box sx={{ fontSize: 11.5, color: chrome.inkMuted }}>
        {`Media: up to ${INJECT_LIMITS.mediaMax} images or 1 video. Alt text is required for each.`}
      </Box>

      {media.map((entry, index) => (
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
            <Box
              component="code"
              data-testid="media-id"
              sx={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontSize: 11.5,
                color: chrome.ink,
              }}
            >
              {entry.mediaId}
            </Box>
            <RunSheetIconButton
              icon={faXmark}
              ariaLabel={`Remove media ${entry.mediaId}`}
              disabled={disabled}
              onClick={() => remove(index)}
            />
          </Box>
          <RunSheetField
            id={`${idPrefix}-alt-${index}`}
            label={`Alt text for ${entry.mediaId}`}
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
      ))}

      {errors.media ? (
        <Box data-testid={`${idPrefix}-media-error`} sx={{ fontSize: 12, color: chrome.amber }}>
          {errors.media}
        </Box>
      ) : null}

      {!disabled ? (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Box sx={{ flex: 1 }}>
            <RunSheetField
              id={`${idPrefix}-add-media`}
              label="Add media id"
              value={pending}
              onChange={setPending}
              disabled={atLimit}
              error={duplicate ? 'That media is already attached' : undefined}
              hint={atLimit ? `Limit of ${INJECT_LIMITS.mediaMax} reached` : undefined}
              onEnter={add}
              inputProps={{ 'data-testid': `${idPrefix}-add-media-input` }}
              sx={{ '& input': { fontFamily: 'ui-monospace, monospace' } }}
            />
          </Box>
          <RunSheetButton
            icon={faPlus}
            label="Add media"
            ariaLabel="Add media"
            disabled={!canAdd}
            testId={`${idPrefix}-add-media-button`}
            onClick={add}
          />
        </Box>
      ) : null}
    </Box>
  )
}
