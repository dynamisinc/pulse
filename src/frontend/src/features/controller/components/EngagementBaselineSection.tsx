/**
 * features/controller/components/EngagementBaselineSection.tsx
 * ---------------------------------------------------------------------------
 * The composer's optional, COLLAPSED "Starting engagement" section (demo-polish C1,
 * story 17 "Engagement baseline"; CTL-001, SOC-012, NFR-001). STAFF world (COBRA):
 * `CobraTextField` inputs, FontAwesome chevron, plain buttons for the presets,
 * MUI 9 `sx`-only. Pure presentational - the state lives in `useComposeAsPersona`.
 *
 * WHAT IT SEEDS. A controller posting as a persona can start the post with a
 * believable like / repost / reply count ("this is already trending"). The three
 * numbers ride on the `POST /api/posts` body as `engagementBaseline`; the server adds
 * them to the real counts and answers 400 for anything outside 0..1,000,000. They are
 * STAFF-ONLY: the server ignores them for participants and never returns them as a
 * separate field, so this control exists only on the controller console.
 *
 * DEFAULT NONE. The section starts collapsed and empty (no baseline is sent). While
 * collapsed it still SAYS what it holds ("none", "Like 1.2K | Repost 340", or "needs
 * fixing"), so an invalid value is never hidden behind a closed panel. Each field takes
 * a whole number from 0 to 1,000,000 (digits only; blank = not set) with quick presets
 * (100, 500, 1.2K, 2.3K). An invalid value shows an inline message beside the field
 * and blocks Fire (the composer explains the block in words next to the Post button).
 *
 * KEYBOARD / A11Y: the header is a real `<button aria-expanded aria-controls>`; the
 * fields are labelled inputs; each preset's accessible name contains its visible text
 * ("Set Like to 1.2K"); invalid fields set `aria-invalid` and carry the message as
 * helper text - not colour alone.
 */

import { useId, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown, faChevronRight } from '@fortawesome/free-solid-svg-icons'
import { CobraTextField } from '@/theme/styledComponents'
import { formatMagnitude } from '@/features/social'
import type { EngagementBaseline } from '@/features/social'
import { BASELINE_FIELDS, type BaselineField } from '../hooks/useComposeAsPersona'
import styles from './PersonaComposer.module.css'

/** Quick presets, in whole numbers; shown compact (100, 500, 1.2K, 2.3K). */
const BASELINE_PRESETS: readonly number[] = [100, 500, 1_200, 2_300]

const FIELD_LABEL: Readonly<Record<BaselineField, string>> = {
  like: 'Like',
  repost: 'Repost',
  reply: 'Reply',
}

export interface EngagementBaselineSectionProps {
  /** The raw inputs (strings, so a half-typed value is representable). */
  fields: Readonly<Record<BaselineField, string>>
  /** Inline message per invalid field. */
  errors: Readonly<Partial<Record<BaselineField, string>>>
  /** The parsed baseline (for the collapsed summary); `undefined` when none / invalid. */
  baseline: EngagementBaseline | undefined
  onChange: (field: BaselineField, value: string) => void
  /** Locks the inputs while a publish is in flight. */
  locked?: boolean
}

/** The collapsed one-line summary of what the section holds. */
function summarize(
  errors: EngagementBaselineSectionProps['errors'],
  baseline: EngagementBaseline | undefined,
): string {
  if (Object.keys(errors).length > 0) return 'needs fixing'
  if (baseline === undefined) return 'none'
  return BASELINE_FIELDS
    .flatMap(field => {
      const value = baseline[field]
      return value !== undefined ? [`${FIELD_LABEL[field]} ${formatMagnitude(value)}`] : []
    })
    .join(' | ')
}

/** The collapsed "Starting engagement" section. See the module header. */
export function EngagementBaselineSection({
  fields,
  errors,
  baseline,
  onChange,
  locked = false,
}: EngagementBaselineSectionProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()

  return (
    <section aria-label="Starting engagement" data-testid="baseline-section">
      <button
        type="button"
        className={styles.disclosure}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(current => !current)}
      >
        <FontAwesomeIcon icon={open ? faChevronDown : faChevronRight} aria-hidden="true" />
        <span>Starting engagement</span>
        <span className={styles.disclosureSummary} data-testid="baseline-summary">
          {summarize(errors, baseline)}
        </span>
      </button>

      {open && (
        <div id={panelId} className={styles.baselineFields}>
          {BASELINE_FIELDS.map(field => {
            const error = errors[field]
            return (
              <div key={field} className={styles.baselineRow}>
                <CobraTextField
                  size="small"
                  label={FIELD_LABEL[field]}
                  value={fields[field]}
                  onChange={event => onChange(field, event.target.value)}
                  error={error !== undefined}
                  helperText={error}
                  sx={{ width: 150 }}
                  slotProps={{
                    htmlInput: {
                      inputMode: 'numeric',
                      maxLength: 9,
                      readOnly: locked,
                      'aria-invalid': error !== undefined,
                    },
                    formHelperText: { sx: { fontSize: 11, marginLeft: 0 } },
                  }}
                />
                <div
                  className={styles.presets}
                  role="group"
                  aria-label={`${FIELD_LABEL[field]} presets`}
                >
                  {BASELINE_PRESETS.map(value => (
                    <button
                      key={value}
                      type="button"
                      className={styles.preset}
                      disabled={locked}
                      aria-label={`Set ${FIELD_LABEL[field]} to ${formatMagnitude(value)}`}
                      onClick={() => onChange(field, String(value))}
                    >
                      {formatMagnitude(value)}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
