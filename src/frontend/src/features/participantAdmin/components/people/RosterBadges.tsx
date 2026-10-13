/**
 * features/participantAdmin/components/people/RosterBadges.tsx
 * ---------------------------------------------------------------------------
 * The small status marks of the staff roster (feature: easy-login, story 10):
 * link status, access, persona kind, and an import row's outcome.
 *
 * ## NEVER colour alone (NFR-001)
 * Every badge is a FontAwesome icon (decorative, `aria-hidden`) AND a visible
 * text label; the colour is a third, redundant cue. A screen reader hears the
 * label, a colour-blind reader sees the icon and the word.
 *
 * World: STAFF (COBRA theme tokens). FontAwesome only; MUI 9 `sx`-only props.
 */

import { Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBan,
  faBuilding,
  faCircleCheck,
  faCircleMinus,
  faCircleXmark,
  faEquals,
  faLink,
  faLinkSlash,
  faPenToSquare,
  faTriangleExclamation,
  faUser,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons'
import type { RosterEntryDto, RosterRowStatus } from '../../types'
import { LINK_STATE_LABEL, linkDisplayState, type LinkDisplayState } from './rosterDisplay'
import { MUTED_TEXT } from './rosterStyles'

/** The colour tokens a badge may use. All clear AA on white. */
type Tone = 'good' | 'bad' | 'warn' | 'neutral' | 'info'

const TONE_COLOR: Readonly<Record<Tone, string>> = {
  good: 'success.main',
  bad: 'notifications.errorText',
  warn: 'notifications.warningText',
  neutral: 'text.primary',
  info: 'info.main',
}

interface StatusBadgeProps {
  readonly icon: IconDefinition
  readonly label: string
  readonly tone: Tone
  readonly testId?: string
}

/** Icon + text, inline. The building block of every mark below. */
export function StatusBadge({ icon, label, tone, testId }: StatusBadgeProps) {
  return (
    <Stack
      component="span"
      direction="row"
      data-testid={testId}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        color: TONE_COLOR[tone],
        fontWeight: 600,
        fontSize: 12.5,
        whiteSpace: 'nowrap',
      }}
    >
      <FontAwesomeIcon icon={icon} aria-hidden />
      <span>{label}</span>
    </Stack>
  )
}

const LINK_BADGE: Readonly<Record<LinkDisplayState, { icon: IconDefinition, tone: Tone }>> = {
  active: { icon: faLink, tone: 'good' },
  needsReissue: { icon: faTriangleExclamation, tone: 'warn' },
  revoked: { icon: faLinkSlash, tone: 'bad' },
  none: { icon: faCircleMinus, tone: 'neutral' },
}

/** Link status: Active / Needs reissue / Revoked / None. */
export function LinkStatusBadge({ state }: { readonly state: LinkDisplayState }) {
  const { icon, tone } = LINK_BADGE[state]
  return (
    <StatusBadge
      icon={icon}
      tone={tone}
      label={LINK_STATE_LABEL[state]}
      testId={`link-status-${state}`}
    />
  )
}

/** Access: Enabled / Disabled. */
export function AccessBadge({ access }: { readonly access: RosterEntryDto['access'] }) {
  return access === 'enabled'
    ? <StatusBadge icon={faCircleCheck} tone="good" label="Enabled" testId="access-enabled" />
    : <StatusBadge icon={faBan} tone="bad" label="Disabled" testId="access-disabled" />
}

/** The link-status badge for a whole row. */
export function EntryLinkBadge({ entry }: { readonly entry: RosterEntryDto }) {
  return <LinkStatusBadge state={linkDisplayState(entry)} />
}

/**
 * Persona: `@handle` plus a text+icon badge — **Org** for an organization
 * persona, **Auto citizen** for the citizen persona the roster made, no badge
 * for any other persona. A person with no persona says so in words.
 */
export function PersonaCell({ persona }: { readonly persona: RosterEntryDto['persona'] }) {
  if (persona === undefined) {
    return (
      <Typography component="span" sx={{ fontSize: 13, color: MUTED_TEXT }}>
        No persona
      </Typography>
    )
  }
  return (
    <Stack sx={{ gap: '2px', alignItems: 'flex-start' }}>
      <Typography component="span" sx={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-all' }}>
        @{persona.handle}
      </Typography>
      {persona.kind === 'org'
        ? <StatusBadge icon={faBuilding} tone="info" label="Org" testId="persona-badge-org" />
        : null}
      {persona.kind === 'human' && persona.autoCreated
        ? <StatusBadge icon={faUser} tone="neutral" label="Auto citizen" testId="persona-badge-auto" />
        : null}
    </Stack>
  )
}

const ROW_BADGE: Readonly<
  Record<RosterRowStatus, { icon: IconDefinition, tone: Tone, label: string, dryLabel: string }>
> = {
  created: { icon: faCircleCheck, tone: 'good', label: 'Created', dryLabel: 'Would create' },
  updated: { icon: faPenToSquare, tone: 'info', label: 'Updated', dryLabel: 'Would update' },
  unchanged: { icon: faEquals, tone: 'neutral', label: 'Unchanged', dryLabel: 'Unchanged' },
  failed: { icon: faCircleXmark, tone: 'bad', label: 'Failed', dryLabel: 'Failed' },
}

/**
 * One import row's outcome. In a dry run nothing was written, so the words say
 * "Would create" / "Would update" rather than claiming a change happened.
 */
export function ImportRowStatusBadge(
  { status, dryRun }: { readonly status: RosterRowStatus, readonly dryRun: boolean },
) {
  const { icon, tone, label, dryLabel } = ROW_BADGE[status]
  return (
    <StatusBadge
      icon={icon}
      tone={tone}
      label={dryRun ? dryLabel : label}
      testId={`import-status-${status}`}
    />
  )
}
