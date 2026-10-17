/**
 * features/controller/engine/components/AmbientChatterSection.tsx
 * ---------------------------------------------------------------------------
 * The "Ambient chatter" section of the engine settings flyout (story
 * `docs/features/ambient-chatter/01-ambient-background-posting.md`, #168, AC2;
 * ADP-005). STAFF world — COBRA operator chrome (the panel's `consoleChrome`
 * tokens + `CobraTextField` / `CobraPrimaryButton`), FontAwesome icons only,
 * MUI 9 `sx`-only system props. Never a participant-skinned surface.
 *
 * SHOWS / EDITS the exercise's ambient policy (contract:
 * `../models/ambientPolicyContract.ts`):
 *  - MODE `off | review | autonomous` — always TEXT + ICON, never colour alone
 *    (NFR-001). A "current mode" status line shows the SAVED server value; the
 *    segmented control below it edits a local draft that is only committed by
 *    "Save ambient policy" (await-then-apply, via `useEngineSettings`);
 *  - CAPS `maxPerMinute` / `maxPerHour` (integer inputs);
 *  - TOPIC allow-list (multi-select over the server vocabulary, or the local
 *    fallback) and PERSONA allow-list (multi-select over this exercise's
 *    personas, from `useStaffPersonas()` in the panel). Selections are
 *    toggle buttons (`aria-pressed` + check glyph), not colour-coded. An EMPTY
 *    list renders "Nothing allowed" — never "everything" (AC1).
 *
 * SAFETY COPY. A rejected `autonomous` save (400, PROVIDER-GOVERNANCE §8) shows
 * the not-authorized message and the draft snaps back to the saved mode, so the
 * section never claims a mode the server refused. `review` stays available.
 * A restart-reset note is always shown (policy is process memory).
 *
 * This component is presentational: the panel owns the hook and passes values
 * in, which keeps it unit-testable without a store.
 */

import { useEffect, useState } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faBan,
  faCheck,
  faCircleInfo,
  faEye,
  faPowerOff,
  faRobot,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { CobraPrimaryButton, CobraTextField } from '@/theme/styledComponents'
import { consoleChrome as chrome } from '../../consoleChrome'
import {
  AMBIENT_MODES,
  AMBIENT_RESET_NOTE,
  FALLBACK_AMBIENT_TOPIC_VOCABULARY,
  topicLabel,
  type AmbientMode,
  type AmbientPolicyDraft,
  type AmbientPolicyDto,
} from '../models/ambientPolicyContract'

/** A persona the controller can allow-list (id is what goes on the wire). */
export interface AmbientPersonaOption {
  readonly id: string
  readonly displayName: string
  readonly handle: string
}

/** Id of the unauthorized note; the disabled Autonomous option points at it. */
const AUTONOMOUS_NOTE_ID = 'ambient-autonomous-unauthorized-note-text'

interface ModeMeta {
  label: string
  icon: IconDefinition
  help: string
}

const MODE_META: Readonly<Record<AmbientMode, ModeMeta>> = {
  off: { label: 'Off', icon: faPowerOff, help: 'No ambient posts are generated or published.' },
  review: {
    label: 'Review',
    icon: faEye,
    help: 'Ambient drafts go to the review queue; nothing publishes without a controller.',
  },
  autonomous: {
    label: 'Autonomous',
    icon: faRobot,
    help: 'Ambient posts publish on their own, inside the caps and allow-lists below.',
  },
}

export interface AmbientChatterSectionProps {
  readonly policy: AmbientPolicyDto
  readonly personas: readonly AmbientPersonaOption[]
  readonly personasLoading?: boolean
  /** `false` for a non-controller: the section renders as read-only text. */
  readonly canControl: boolean
  /**
   * Any engine-settings request is in flight (shared serialization) or the session is
   * forbidden.
   */
  readonly disabled: boolean
  readonly pending: boolean
  readonly error: string | null
  readonly onSave: (draft: AmbientPolicyDraft) => void
}

/** Parses a cap input; `null` unless a non-negative integer. */
function parseCap(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null
  return Number(raw.trim())
}

function toggle(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter(x => x !== id) : [...list, id]
}

interface ChipListProps {
  readonly testIdPrefix: string
  readonly groupLabel: string
  readonly options: ReadonlyArray<{ readonly id: string; readonly label: string }>
  readonly selected: readonly string[]
  readonly editable: boolean
  readonly disabled: boolean
  readonly onToggle: (id: string) => void
  readonly emptyOptionsText: string
  /** Optional per-option annotation (text, never colour-only), e.g. "not in engine cast". */
  readonly optionNote?: (id: string) => string | null
}

function ChipList(props: ChipListProps) {
  const {
    testIdPrefix,
    groupLabel,
    options,
    selected,
    editable,
    disabled,
    onToggle,
    emptyOptionsText,
    optionNote,
  } = props
  return (
    <Stack sx={{ gap: 0.6 }}>
      {selected.length === 0 && (
        <Stack
          data-testid={`${testIdPrefix}-nothing-allowed`}
          direction="row"
          sx={{ alignItems: 'center', gap: 0.6 }}
        >
          <FontAwesomeIcon icon={faBan} color={chrome.amber} aria-hidden="true" />
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: chrome.amber }}>
            Nothing allowed
          </Typography>
        </Stack>
      )}
      {options.length === 0 && (
        <Typography sx={{ fontSize: 10.5, color: chrome.inkFaint }}>{emptyOptionsText}</Typography>
      )}
      {editable ? (
        <Stack
          direction="row"
          role="group"
          aria-label={groupLabel}
          sx={{ gap: 0.6, flexWrap: 'wrap', maxHeight: 132, overflowY: 'auto' }}
        >
          {options.map(option => {
            const on = selected.includes(option.id)
            return (
              <Box
                key={option.id}
                component="button"
                type="button"
                data-testid={`${testIdPrefix}-${option.id}`}
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onToggle(option.id)}
                sx={{
                  px: 0.9,
                  py: 0.4,
                  fontSize: 11,
                  fontWeight: 700,
                  color: on ? chrome.ink : chrome.inkMuted,
                  bgcolor: on ? chrome.card : 'transparent',
                  border: `1px solid ${on ? chrome.blue : chrome.line}`,
                  borderRadius: '7px',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                  {on && <FontAwesomeIcon icon={faCheck} aria-hidden="true" />}
                  <Box component="span">{option.label}</Box>
                  {optionNote?.(option.id) && (
                    <Box
                      component="span"
                      data-testid={`${testIdPrefix}-${option.id}-note`}
                      sx={{ fontWeight: 500, fontSize: 10, color: chrome.inkFaint }}
                    >
                      {`— ${optionNote(option.id)}`}
                    </Box>
                  )}
                </Stack>
              </Box>
            )
          })}
        </Stack>
      ) : (
        selected.length > 0 && (
          <Typography data-testid={`${testIdPrefix}-readonly`} sx={{ fontSize: 11, color: chrome.ink }}>
            {options
              .filter(o => selected.includes(o.id))
              .map(o => o.label)
              .join(', ') || selected.join(', ')}
          </Typography>
        )
      )}
    </Stack>
  )
}

export function AmbientChatterSection(props: AmbientChatterSectionProps) {
  const {
    policy,
    personas,
    personasLoading = false,
    canControl,
    disabled,
    pending,
    error,
    onSave,
  } = props

  const [draft, setDraft] = useState<AmbientPolicyDraft>(() => ({
    mode: policy.mode,
    maxPerMinute: policy.maxPerMinute,
    maxPerHour: policy.maxPerHour,
    topicAllowList: policy.topicAllowList,
    personaAllowList: policy.personaAllowList,
  }))
  const [perMinuteText, setPerMinuteText] = useState(String(policy.maxPerMinute))
  const [perHourText, setPerHourText] = useState(String(policy.maxPerHour))

  // Re-sync from the server whenever a new authoritative policy is applied.
  useEffect(() => {
    setDraft({
      mode: policy.mode,
      maxPerMinute: policy.maxPerMinute,
      maxPerHour: policy.maxPerHour,
      topicAllowList: policy.topicAllowList,
      personaAllowList: policy.personaAllowList,
    })
    setPerMinuteText(String(policy.maxPerMinute))
    setPerHourText(String(policy.maxPerHour))
  }, [policy])

  // A rejected save keeps the PREVIOUS mode: snap the draft's mode back.
  useEffect(() => {
    if (error) setDraft(d => ({ ...d, mode: policy.mode }))
  }, [error, policy.mode])

  const vocabulary = policy.topicVocabulary ?? FALLBACK_AMBIENT_TOPIC_VOCABULARY
  const topicOptions = vocabulary.map(id => ({ id, label: topicLabel(id) }))
  const voiceable = policy.voiceablePersonaIds ?? null
  const personaNote = (id: string): string | null =>
    voiceable !== null && !voiceable.includes(id) ? 'not in engine cast' : null
  const personaOptions = personas.map(p => ({ id: p.id, label: `${p.displayName} (${p.handle})` }))

  const perMinute = parseCap(perMinuteText)
  const perHour = parseCap(perHourText)
  const capsValid = perMinute !== null && perHour !== null
  const editing = canControl
  const controlsDisabled = disabled || pending
  const saved = MODE_META[policy.mode]

  const save = () => {
    if (perMinute === null || perHour === null) return
    onSave({ ...draft, maxPerMinute: perMinute, maxPerHour: perHour })
  }

  return (
    <Stack data-testid="ambient-chatter-section" sx={{ gap: 0.9 }}>
      <Typography
        component="h3"
        sx={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', color: chrome.inkMuted }}
      >
        AMBIENT CHATTER
      </Typography>

      {/* Saved mode: text + icon, announced politely on change. */}
      <Stack
        data-testid="ambient-mode-status"
        direction="row"
        role="status"
        aria-live="polite"
        sx={{ alignItems: 'center', gap: 0.7 }}
      >
        <FontAwesomeIcon icon={saved.icon} color={chrome.blue} aria-hidden="true" />
        <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: chrome.ink }}>
          {`Ambient mode: ${saved.label}`}
        </Typography>
      </Stack>
      <Typography sx={{ fontSize: 10.5, color: chrome.inkMuted, lineHeight: 1.4 }}>
        {saved.help}
      </Typography>

      {editing && (
        <Stack direction="row" role="group" aria-label="Ambient mode" sx={{ gap: 0.6, flexWrap: 'wrap' }}>
          {AMBIENT_MODES.map(mode => {
            const meta = MODE_META[mode]
            const selected = draft.mode === mode
            const blocked = mode === 'autonomous' && policy.autonomousAuthorized === false
            const modeDisabled = controlsDisabled || blocked
            return (
              <Box
                key={mode}
                component="button"
                type="button"
                data-testid={`ambient-mode-${mode}`}
                aria-pressed={selected}
                aria-describedby={blocked ? AUTONOMOUS_NOTE_ID : undefined}
                disabled={modeDisabled}
                onClick={() => setDraft(d => ({ ...d, mode }))}
                sx={{
                  px: 1,
                  py: 0.6,
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: selected ? chrome.ink : chrome.inkMuted,
                  bgcolor: selected ? chrome.card : 'transparent',
                  border: `1px solid ${selected ? chrome.blue : chrome.line}`,
                  borderRadius: '7px',
                  cursor: modeDisabled ? 'not-allowed' : 'pointer',
                  opacity: modeDisabled ? 0.5 : 1,
                }}
              >
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                  <FontAwesomeIcon icon={meta.icon} aria-hidden="true" />
                  <Box component="span">{`${meta.label}${selected ? ' (selected)' : ''}`}</Box>
                </Stack>
              </Box>
            )
          })}
        </Stack>
      )}

      {policy.autonomousAuthorized === false && (
        <Stack
          id={AUTONOMOUS_NOTE_ID}
          data-testid="ambient-autonomous-unauthorized-note"
          direction="row"
          sx={{ alignItems: 'flex-start', gap: 0.6 }}
        >
          <FontAwesomeIcon icon={faCircleInfo} color={chrome.inkFaint} aria-hidden="true" />
          <Typography sx={{ fontSize: 10.5, color: chrome.inkFaint, lineHeight: 1.4 }}>
            Autonomous is not authorized for this environment (PROVIDER-GOVERNANCE §8); Review stays
            available.
          </Typography>
        </Stack>
      )}

      {/* Caps. */}
      <Stack direction="row" sx={{ gap: 1 }}>
        {editing ? (
          <>
            <CobraTextField
              size="small"
              label="Max per minute"
              value={perMinuteText}
              disabled={controlsDisabled}
              error={perMinute === null}
              onChange={e => setPerMinuteText(e.target.value)}
              slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'ambient-max-per-minute' } }}
            />
            <CobraTextField
              size="small"
              label="Max per hour"
              value={perHourText}
              disabled={controlsDisabled}
              error={perHour === null}
              onChange={e => setPerHourText(e.target.value)}
              slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'ambient-max-per-hour' } }}
            />
          </>
        ) : (
          <Typography data-testid="ambient-caps-readonly" sx={{ fontSize: 11, color: chrome.ink }}>
            {`Caps: ${policy.maxPerMinute} per minute, ${policy.maxPerHour} per hour`}
          </Typography>
        )}
      </Stack>
      {editing && !capsValid && (
        <Typography data-testid="ambient-caps-invalid" role="alert" sx={{ fontSize: 10.5, color: chrome.red }}>
          Caps must be whole numbers (0 or more).
        </Typography>
      )}

      {/* Allow-lists. */}
      <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: chrome.inkMuted }}>
        Allowed topics
      </Typography>
      <ChipList
        testIdPrefix="ambient-topic"
        groupLabel="Allowed ambient topics"
        options={topicOptions}
        selected={editing ? draft.topicAllowList : policy.topicAllowList}
        editable={editing}
        disabled={controlsDisabled}
        onToggle={id => setDraft(d => ({ ...d, topicAllowList: toggle(d.topicAllowList, id) }))}
        emptyOptionsText="No topics available."
      />

      <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: chrome.inkMuted }}>
        Allowed personas
      </Typography>
      <Typography
        data-testid="ambient-persona-cast-help"
        sx={{ fontSize: 10.5, color: chrome.inkFaint, lineHeight: 1.4 }}
      >
        Only personas in the engine cast post ambient chatter.
      </Typography>
      <ChipList
        optionNote={personaNote}
        testIdPrefix="ambient-persona"
        groupLabel="Allowed ambient personas"
        options={personaOptions}
        selected={editing ? draft.personaAllowList : policy.personaAllowList}
        editable={editing}
        disabled={controlsDisabled}
        onToggle={id => setDraft(d => ({ ...d, personaAllowList: toggle(d.personaAllowList, id) }))}
        emptyOptionsText={personasLoading ? 'Loading personas…' : 'No personas in this exercise.'}
      />

      {editing && (
        <CobraPrimaryButton
          data-testid="ambient-save"
          size="small"
          disabled={controlsDisabled || !capsValid}
          onClick={save}
          sx={{ alignSelf: 'flex-start' }}
        >
          Save ambient policy
        </CobraPrimaryButton>
      )}

      {pending && (
        <Typography
          data-testid="ambient-applying"
          role="status"
          aria-live="polite"
          sx={{ fontSize: 10.5, color: chrome.blue }}
        >
          Applying…
        </Typography>
      )}

      {error && (
        <Stack
          data-testid="ambient-error"
          direction="row"
          role="alert"
          sx={{ alignItems: 'flex-start', gap: 0.6, p: 1, border: `1px solid ${chrome.red}`, borderRadius: '7px' }}
        >
          <FontAwesomeIcon icon={faTriangleExclamation} color={chrome.red} aria-hidden="true" />
          <Typography sx={{ fontSize: 10.5, color: chrome.ink, lineHeight: 1.4 }}>
            {error}
          </Typography>
        </Stack>
      )}

      <Stack data-testid="ambient-reset-note" direction="row" sx={{ alignItems: 'flex-start', gap: 0.6 }}>
        <FontAwesomeIcon icon={faCircleInfo} color={chrome.blue} aria-hidden="true" />
        <Typography sx={{ fontSize: 10.5, color: chrome.inkMuted, lineHeight: 1.4 }}>
          {AMBIENT_RESET_NOTE}
        </Typography>
      </Stack>
    </Stack>
  )
}
