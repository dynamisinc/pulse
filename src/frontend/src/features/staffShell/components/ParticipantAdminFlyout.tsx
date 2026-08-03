/**
 * features/staffShell/components/ParticipantAdminFlyout.tsx
 * ---------------------------------------------------------------------------
 * The participant-admin / login-triage tool (feature: staff-shell, story 03 —
 * "Participant-admin flyout / login triage"; COR-017; see
 * docs/features/staff-shell/03-participant-admin-flyout.md and
 * docs/design/D7-application-shells/SHELL-CONTRACT.md §1 "Staff shell owns" →
 * "Toolstrip": "shell-global tools on top (**Participant admin**, COR-017, on
 * every staff surface)").
 *
 * `ParticipantAdminFlyout` is a SHELL-GLOBAL toolstrip tool: it registers
 * itself into the toolstrip's shell-global zone via
 * `useRegisterShellGlobalTool()` (story 02's `../toolRegistry`) and renders
 * its own 330px flyout when `useToolstrip().isActive('participant-admin')` —
 * exactly the "each registrant renders its own flyout" contract
 * `Toolstrip.tsx`'s module header documents. Mount exactly ONE of these
 * inside the staff frame, under `<ToolstripProvider>` +
 * `<ExerciseContextProvider>` (Integration B, the orchestrator's job — this
 * component only needs those two ancestors to exist somewhere above it).
 *
 * ## Positioning — within the frame, never a portal (AC1)
 * The flyout is `position: 'absolute'`, flush against the toolstrip's right
 * edge (`right: staffShellTokens.toolstrip.widthPx`), spanning the work
 * area's full height (`top: 0`, `bottom: 0`). It renders as an ordinary
 * descendant of wherever this component is mounted — deliberately NOT a
 * `createPortal` to `document.body` — so it stays inside the staff frame's
 * DOM (and unmounts/rebinds with it) rather than escaping to the document
 * root, mirroring `features/evaluator/components/AarExportPanel.tsx`'s same
 * `top: 0, right: 56, bottom: 0` positioning against the shared toolstrip.
 *
 * CROSS-STORY NOTE (Integration B): "never above the participant-preview
 * stage" (AC1) is a coordination concern this component cannot resolve
 * alone — it has no seam onto story 04's preview-active state. This
 * component picks a moderate `zIndex` (30, matching `AarExportPanel`'s own
 * flyout-layer value) sufficient to sit above ordinary work-area content;
 * the orchestrator/story 04 must ensure the staged participant-shell preview
 * (when active) renders at an EQUAL-OR-HIGHER stacking context, or closes
 * shell-global flyouts on preview entry, so this tool never visually covers
 * the preview stage.
 *
 * ## Safety (AC5) — triage only, never a password field
 * This tool NEVER collects a participant's password — there is no text
 * input anywhere in this component. Quick actions ("Unlock" / "Resend") are
 * one-click triage actions that a real backend would perform out-of-band
 * (e.g. sending a reset link). Anything beyond this quick triage belongs to
 * the FULL participant-admin surface (out of scope here, E1
 * identity-auth-roles/08) — see below.
 *
 * ## The footer link to the full admin surface (staff-navigation/04, COR-073)
 * This flyout used to end with `<CobraLinkButton href="/staff/participant-admin">
 * Open full participant admin →</CobraLinkButton>`. That was a DEAD CONTROL
 * dressed as navigation, and worse than a broken link:
 *  - it was a raw `href`, i.e. a FULL PAGE RELOAD out of the SPA — every bit of
 *    client-side state (this flyout, the open toolstrip, any in-progress work
 *    in the surface behind it) discarded on click;
 *  - `/staff/participant-admin` is not in `STAFF_ROUTE_REGISTRY`
 *    (`@/features/staff/staffRouteRegistry`), so the reload landed in the
 *    `*` catch-all and `StaffRouteTree` bounced the staff member back to their
 *    role's default surface. Click → lose everything → end up somewhere else.
 *
 * The full participant-admin surface is one of the ~40 planned staff surfaces
 * and is NOT BUILT (identity-auth-roles/08, Not Started). Rather than invent it,
 * or fake it with a disabled-but-focusable button, the footer is ABSENT — the
 * same "absent, not a dead control" rule this component already applies to
 * role-gated quick actions (see "Role gating" above and
 * `../participantAdminMocks`'s header for why absent beat disabled). Nothing
 * here is focusable, so nothing here can be tabbed to and activated for no
 * effect (NFR-001).
 *
 * TO RESTORE IT (one small edit, once the surface exists): add the registry
 * entry in `@/features/staff/staffRouteRegistry`, then render a react-router
 * `<Link to={entry.path}>`-based control here — CLIENT-SIDE navigation, never a
 * raw `href`. Do not hardcode the path string: read it from the registry entry
 * so a rename can't resurrect this exact bug.
 *
 * ## Role gating (COR-017)
 * A quick action is entirely ABSENT (not disabled) when the current staff
 * session's role can't perform it — see `../participantAdminMocks`'s module
 * header for why "absent" was chosen over "disabled".
 *
 * ## Audit logging (XC-004) — telemetry actor-kind note
 * Each quick action calls `buildAndEmit(...)` to audit-log the action with
 * actor + scenario time. The locked v0 telemetry envelope's
 * `actor.kind` enum is `'participant' | 'persona' | 'system' | 'engine'` —
 * there is no dedicated `'controller'`/`'staff'` kind for a genuine staff
 * action performed as itself (as opposed to `origin: 'controller-as-persona'`,
 * which is a controller posting AS a participant persona — a different
 * case). This event therefore uses the closest valid combination:
 * `actor.kind: 'system'` (this is a system/console action, not
 * participant/persona content) plus the already-optional `actor.role` and
 * `actor.actingHumanId` fields to carry per-human staff attribution. Flagged
 * for the telemetry schema owner: a later wave may want to add a dedicated
 * staff/controller `actor.kind` (or `origin` value) for this case.
 *
 * World: staff (COBRA/Cadence) — `@/theme/styledComponents` (CobraLinkButton)
 * and `../staffShellTokens`; never a participant surface (XC-002).
 */

import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faCircleCheck,
  faLock,
  faUserClock,
  faUserGroup,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { useExerciseContext } from '@/core/exerciseContext'
import { scenarioNow } from '@/core/clock'
import { buildAndEmit } from '@/core/telemetry'
import { CobraLinkButton } from '@/theme/styledComponents'
import { staffShellTokens } from '../staffShellTokens'
import { useRegisterShellGlobalTool, useToolstrip } from '../toolRegistry'
import {
  useAdminAuthorization,
  useParticipantAdminRoster,
  type ParticipantAdminRow,
  type ParticipantLoginStatus,
} from '../participantAdminMocks'

/**
 * This tool's stable toolstrip-registry id — exported so callers/tests never
 * hand-copy the string.
 */
export const PARTICIPANT_ADMIN_TOOL_ID = 'participant-admin'

/** Flyout panel width (AC1: "a 330px flyout"). */
const FLYOUT_WIDTH_PX = 330

/** Statuses that count toward the toolstrip badge (pending triage — AC2). */
const PENDING_STATUSES: ReadonlySet<ParticipantLoginStatus> = new Set(['locked-out', 'no-login-yet'])

/** One status chip's text + icon + accent — NEVER color-only (NFR-001), text always renders. */
interface StatusChipConfig {
  label: string
  icon: IconDefinition
  color: string
}

const STATUS_CHIP_CONFIG: Record<ParticipantLoginStatus, StatusChipConfig> = {
  'locked-out': { label: 'LOCKED OUT', icon: faLock, color: staffShellTokens.accent.cadenceRed },
  'no-login-yet': { label: 'NO LOGIN YET', icon: faUserClock, color: '#8a5300' },
  active: { label: 'ACTIVE', icon: faCircleCheck, color: '#256b43' },
}

/** A row's quick action, keyed by its resulting audit-log `payload.action`. */
interface QuickActionConfig {
  action: 'unlock' | 'resend'
  label: string
}

/** Only LOCKED OUT / NO LOGIN YET rows have anything to triage; ACTIVE has no action. */
const QUICK_ACTION_BY_STATUS: Partial<Record<ParticipantLoginStatus, QuickActionConfig>> = {
  'locked-out': { action: 'unlock', label: 'Unlock' },
  'no-login-yet': { action: 'resend', label: 'Resend' },
}

function StatusChip({ status }: { status: ParticipantLoginStatus }) {
  const config = STATUS_CHIP_CONFIG[status]
  return (
    <Stack
      direction="row"
      role="status"
      data-testid={`participant-admin-status-chip-${status}`}
      aria-label={`Status: ${config.label}`}
      sx={{
        alignItems: 'center',
        gap: 0.625,
        color: config.color,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.04em',
      }}
    >
      <FontAwesomeIcon icon={config.icon} aria-hidden="true" size="xs" />
      <Box component="span">{config.label}</Box>
    </Stack>
  )
}

interface ParticipantAdminRowViewProps {
  row: ParticipantAdminRow
  canPerformAdminAction: boolean
  onQuickAction: (row: ParticipantAdminRow, quickAction: QuickActionConfig) => void
}

function ParticipantAdminRowView({
  row,
  canPerformAdminAction,
  onQuickAction,
}: ParticipantAdminRowViewProps) {
  const quickAction = QUICK_ACTION_BY_STATUS[row.status]

  return (
    <Stack
      component="li"
      data-testid={`participant-admin-row-${row.id}`}
      direction="row"
      sx={{
        alignItems: 'center',
        gap: 1,
        px: 1.75,
        py: 1.25,
        borderBottom: `1px solid ${staffShellTokens.toolstrip.borderColor}`,
      }}
    >
      <Stack sx={{ flex: 1, minWidth: 0, gap: '2px' }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.2 }}>
          {row.name}
        </Typography>
        <Typography
          sx={{ fontSize: 10.5, color: staffShellTokens.accent.secondaryText, lineHeight: 1.2 }}
        >
          {row.role}
        </Typography>
        <Box sx={{ mt: 0.375 }}>
          <StatusChip status={row.status} />
        </Box>
      </Stack>

      {/* Role-gated: the action is ABSENT (not disabled) when the current
          staff role can't perform it (COR-015 pattern) — see module header. */}
      {quickAction && canPerformAdminAction && (
        <CobraLinkButton
          size="small"
          data-testid={`participant-admin-action-${row.id}`}
          aria-label={`${quickAction.label} — ${row.name}`}
          onClick={() => onQuickAction(row, quickAction)}
          sx={{ minWidth: 0, px: 1.25, py: 0.25, fontSize: 11 }}
        >
          {quickAction.label}
        </CobraLinkButton>
      )}
    </Stack>
  )
}

/**
 * Registers the participant-admin shell-global tool and renders its 330px
 * login-triage flyout while active. Mount exactly once, inside the staff
 * frame, under `<ToolstripProvider>` + `<ExerciseContextProvider>` — see
 * module header. Throws (via `useToolstrip()` / `useExerciseContext()`) if
 * either ancestor is missing.
 */
export function ParticipantAdminFlyout() {
  const { exerciseId, timeZone } = useExerciseContext()
  const roster = useParticipantAdminRoster(exerciseId)
  const { role, actingHumanId, canPerformAdminAction } = useAdminAuthorization()
  const { isActive, toggleTool } = useToolstrip()

  const pendingCount = roster.filter(row => PENDING_STATUSES.has(row.status)).length

  useRegisterShellGlobalTool({
    id: PARTICIPANT_ADMIN_TOOL_ID,
    label: 'ADMIN',
    icon: faUserGroup,
    tooltip: 'Participant admin — login triage',
    badge: pendingCount > 0 ? { count: pendingCount } : undefined,
  })

  const handleQuickAction = (row: ParticipantAdminRow, quickAction: QuickActionConfig) => {
    // Audit-log the action (XC-004) — actor + scenario time recorded. Never
    // throws into this click handler (buildAndEmit swallows build/send
    // failures; see WAVE0-REVIEW precedent 4).
    buildAndEmit({
      exerciseId,
      eventType: 'staff-action',
      channel: 'system',
      actor: { kind: 'system', role, actingHumanId },
      wallClockTime: new Date().toISOString(),
      scenarioTime: scenarioNow().toISOString(),
      timeZone,
      target: { entityType: 'participant', entityId: row.id },
      payload: {
        action: quickAction.action,
        participantName: row.name,
        previousStatus: row.status,
      },
    })
  }

  if (!isActive(PARTICIPANT_ADMIN_TOOL_ID)) return null

  return (
    <Box
      data-testid="participant-admin-flyout"
      role="region"
      aria-label="Participant admin — login triage"
      sx={{
        position: 'absolute',
        top: 0,
        right: staffShellTokens.toolstrip.widthPx,
        bottom: 0,
        width: FLYOUT_WIDTH_PX,
        bgcolor: staffShellTokens.toolstrip.background,
        borderLeft: `1px solid ${staffShellTokens.toolstrip.borderColor}`,
        boxShadow: '-16px 0 40px rgba(0, 0, 0, 0.14)',
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.75,
          py: 1.5,
          borderBottom: `1px solid ${staffShellTokens.toolstrip.borderColor}`,
        }}
      >
        <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em' }}>
          PARTICIPANT ADMIN
        </Typography>
        <Tooltip title="Close">
          <IconButton
            size="small"
            aria-label="Close participant admin panel"
            onClick={() => toggleTool(PARTICIPANT_ADMIN_TOOL_ID)}
            sx={{ color: staffShellTokens.accent.secondaryText }}
          >
            <FontAwesomeIcon icon={faXmark} size="sm" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Stack
        component="ul"
        aria-label="Participants pending login triage or active"
        sx={{ flex: 1, overflowY: 'auto', m: 0, p: 0, listStyle: 'none' }}
      >
        {roster.length === 0 && (
          <Typography
            sx={{
              px: 1.75,
              py: 2,
              fontSize: 11.5,
              color: staffShellTokens.accent.secondaryText,
            }}
          >
            No participants found for this exercise.
          </Typography>
        )}
        {roster.map(row => (
          <ParticipantAdminRowView
            key={row.id}
            row={row}
            canPerformAdminAction={canPerformAdminAction}
            onQuickAction={handleQuickAction}
          />
        ))}
      </Stack>

      {/* NO FOOTER LINK — see "The footer link to the full admin surface" in
          the module header. `/staff/participant-admin` has no registry entry
          and no surface behind it, so there is deliberately nothing focusable
          here to activate. Restore this footer as a react-router `<Link>` (or
          a `useNavigate` control) to the registry entry's `path` the moment
          identity-auth-roles/08 declares one — never as a raw `href`. */}
    </Box>
  )
}
