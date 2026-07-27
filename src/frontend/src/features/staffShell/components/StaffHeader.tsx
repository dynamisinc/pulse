/**
 * features/staffShell/components/StaffHeader.tsx
 * ---------------------------------------------------------------------------
 * The 56px navy Cadence header content (feature: staff-shell, story 01 —
 * "Staff header — lockup, identity badge, clocks, state pill, classification
 * tag"; COR-063, COR-005; see docs/features/staff-shell/01-staff-header.md
 * and docs/design/D7-application-shells/SHELL-CONTRACT.md §1 "Staff shell
 * owns").
 *
 * This component renders INTO `StaffShellFrame`'s `header` slot (story 05) —
 * the frame paints the 56px navy background/border/light-text color; this
 * component only lays out the header ROW content and never repaints that
 * chrome itself. Every color it sets explicitly comes from
 * `staffShellTokens` (or, for the two state-pill accents that must render
 * legibly specifically on navy — see the comment at their declaration — a
 * small local constant, exactly as `staffShellTokens.ts`'s own module header
 * justifies its navy-only tokens). Primary-emphasis text (the "PULSE"
 * lockup, exercise name, and the SCENARIO clock digits) is left uncolored and
 * simply INHERITS the light `textPrimary` color the frame already set on the
 * header element; secondary text (the LOCAL wall-clock digits, the preview
 * label) is explicitly set to `textMuted`. This is the same inherit-vs-
 * explicit-mute pattern the Evaluator Dashboard's own shell content follows.
 *
 * Left-to-right, per SHELL-CONTRACT §1 "Header":
 *   1. Brand lockup — PULSE (bold) over the surface name (small caps, muted).
 *   2. Exercise identity badge — exercise name + role/cell. STATIC DURING
 *      CONDUCT (COR-005): this is plain, non-interactive text — there is no
 *      switcher control here at all (the switcher UX is out of scope for
 *      this story; it is a separate, pre-conduct-only surface E1 owns), so a
 *      Live/active exercise can never show one, by construction.
 *   3. Dual clock pair — SCENARIO (from `useScenarioTime`, sourced from the
 *      exercise clock, never wall-clock) and LOCAL (real wall-clock time,
 *      ticking ~1s — staff surfaces are EXEMPT from the participant
 *      scenario-time-only lint ban, see eslint.config.js).
 *   4. Exercise state pill — dot + TEXT, never color-only (NFR-001).
 *   5. Classification tag — `STAFF_CLASSIFICATION`, persistent, mono,
 *      config-driven in exactly one place (D7-010: no separate exercise bar).
 *   6. Staff presence — a row of avatars. CONTRACT SEAM: backed by
 *      `staffHeaderMocks.ts` (role/cell + presence) until E1's roles/presence
 *      API lands; see that file's TODOs.
 *   7. Preview-as-participant button — DRIVEN ENTIRELY by `previewActive` /
 *      `onTogglePreview`. This story renders the control only; the preview
 *      behavior itself (staging the participant shell, moment picker) is
 *      story 04 and is deliberately NOT built here, so this component has no
 *      dependency on it. RENDERED ONLY WHEN `onTogglePreview` IS SUPPLIED:
 *      preview is a capability of the CONDUCT surfaces (evaluator today,
 *      controller when it wires the toggle), not of every staff surface — a
 *      planner configuring the world has no scenario moment to preview. With no
 *      handler the control would still be a real, focusable, keyboard-reachable
 *      `<button>` whose click does nothing, i.e. a dead control a staff user
 *      cannot distinguish from a broken feature (NFR-001: every control a
 *      keyboard reaches must do something). So the surface that owns the
 *      behavior opts IN by passing the handler; surfaces that do not simply
 *      never render it. Gate here, once, rather than in each route — that is
 *      the correct semantics for all three staff surfaces at the same time.
 *   8. Sign-out control (feature: login, story 04 — "Wire real login routes +
 *      logout"; COR-012). STYLING NUANCE: the story calls for "COBRA
 *      `styledComponents`, never a bare MUI button" — this header does NOT
 *      reach for a content-area `@/theme/styledComponents` button
 *      (`CobraLinkButton`/`CobraSecondaryButton`) here, because those are
 *      styled for the light content canvas and would look visually out of
 *      place against this navy header bar. Instead it matches THIS
 *      component's own established COBRA idiom for header controls — the
 *      Preview-as-participant button's `Box component="button"` treatment,
 *      hand-styled from `staffShellTokens` + FontAwesome, a real `<button>`
 *      with an accessible name — which IS this header's version of "the
 *      COBRA staff look" (see point 7 above). Calls the shared `endSession()`
 *      helper (`@/core/auth` — clears the React Query cache + logs out) then
 *      navigates to `LOGIN_PATH` — reachable by keyboard like every other
 *      control here.
 */

import { useEffect, useState } from 'react'
import { Box, Stack, Tooltip, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faEye, faEyeSlash, faRightFromBracket } from '@fortawesome/free-solid-svg-icons'
import { useExerciseContext } from '@/core/exerciseContext'
import { useScenarioTime } from '@/core/clock'
import { endSession } from '@/core/auth'
import { LOGIN_PATH } from '@/features/app-shell/constants'
import { staffShellTokens } from '../staffShellTokens'
import { useStaffPresence, useStaffRoleCell } from '../staffHeaderMocks'
import { STATE_PILL_CONFIG, type StatePillConfig } from './statePillConfig'

/**
 * Classification marking shown in every staff header (SHELL-CONTRACT §1
 * "Header" / "Classification strings" — `UNCLASSIFIED // FOUO`, staff
 * world). Deployment-configurable in exactly ONE place: retargeting the
 * marking for a different deployment means changing this constant only —
 * nothing else in the header (or a consumer) needs to change.
 */
export const STAFF_CLASSIFICATION = 'UNCLASSIFIED // FOUO'

export interface StaffHeaderProps {
  /** The staff surface mounting this header, e.g. "Controller Console". */
  surfaceName: string
  /**
   * Whether "Preview as participant" is currently active. Defaults to `false`.
   * Only meaningful alongside `onTogglePreview` (the control is not rendered
   * without it).
   */
  previewActive?: boolean
  /**
   * Invoked when the Preview-as button is activated. Story 04 supplies the real
   * handler.
   *
   * SUPPLYING THIS IS WHAT RENDERS THE CONTROL — a surface with no preview
   * capability (the planner workspace; the controller console today) omits it
   * and gets no button, instead of a keyboard-reachable button that does
   * nothing. See module header point 7.
   */
  onTogglePreview?: () => void
  /**
   * Overrides the exercise-state pill's config (label + navy-safe accent), e.g.
   * the world-steering tiered-pause state (INJECTS PAUSED / ENGINE PAUSED /
   * WORLD FROZEN, D5-014/1.3 / D7-010). Left undefined, the pill shows the
   * lifecycle status (LIVE / STAGED / ENDEX / ARCHIVED). Passed in — this shared
   * header stays free of any surface-specific hook (a participant-role surface
   * mounting it must never pull in the controller identity/pause seam). The
   * `/console` route computes it from `usePauseState()` via
   * {@link pauseStatePillConfig}.
   */
  stateOverride?: StatePillConfig
}

const TIME_WITH_SECONDS: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}
const TIME_ONLY: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}
const DAY_MONTH: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
}

/**
 * Renders `instant` with `Intl.DateTimeFormat` — `timeZone` undefined uses
 * the runtime's local zone (wall clock only).
 */
function formatClock(
  instant: Date,
  timeZone: string | undefined,
  opts: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone }).format(instant)
}

/** How often both clocks refresh their displayed digits. */
const CLOCK_TICK_MS = 1000

/**
 * The LOCAL (wall-clock) side of the dual-clock pair. Staff surfaces are
 * explicitly EXEMPT from the participant scenario-time-only lint ban (see
 * eslint.config.js's `no-restricted-syntax` block, scoped to
 * `src/features/{social,portal,news,press,weather,participant-shell}/**`
 * only) — this is the one legitimate `new Date()` reader in this component.
 */
function useWallClockNow(): Date {
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => clearInterval(id)
  }, [])

  return now
}

export function StaffHeader({
  surfaceName,
  previewActive = false,
  onTogglePreview,
  stateOverride,
}: StaffHeaderProps) {
  const { exerciseName, timeZone, status } = useExerciseContext()
  const { role, cell } = useStaffRoleCell()
  const presence = useStaffPresence()
  const navigate = useNavigate()

  const { now: scenarioInstant } = useScenarioTime(timeZone, CLOCK_TICK_MS)
  const wallInstant = useWallClockNow()

  // Sign-out (point 8, module header). See the inline note below for the
  // ordering/why; the shared teardown lives in core/auth/endSession.ts.
  const handleSignOut = () => {
    // endSession() clears the token store AND the React Query cache
    // SYNCHRONOUSLY before it awaits the best-effort POST /auth/logout (see
    // core/auth/endSession.ts), so navigate IMMEDIATELY — the redirect must
    // never block on a slow/hung request, and no prior-user cached data can
    // survive into the next session on this tab.
    void endSession()
    navigate(LOGIN_PATH)
  }

  // The steering pause tier (when active) overrides the lifecycle status pill
  // (D7-010); otherwise the lifecycle status drives it (LIVE / STAGED / ...).
  const statePill = stateOverride ?? STATE_PILL_CONFIG[status]
  const scenarioTimeText = formatClock(scenarioInstant, timeZone, TIME_WITH_SECONDS)
  const wallTimeText = formatClock(wallInstant, undefined, TIME_ONLY)
  const wallDateText = formatClock(wallInstant, undefined, DAY_MONTH).toUpperCase()

  return (
    <Box
      data-testid="staff-header"
      sx={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 1.75,
        px: 1.75,
        minWidth: 0,
      }}
    >
      {/* 1. Brand lockup */}
      <Stack data-testid="staff-header-lockup" sx={{ lineHeight: 1.05, flex: 'none' }}>
        <Typography sx={{ fontSize: 15, fontWeight: 800, letterSpacing: '0.02em' }}>
          PULSE
        </Typography>
        <Typography
          sx={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: '0.16em',
            color: staffShellTokens.header.textMuted,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          {surfaceName}
        </Typography>
      </Stack>

      {/* 2. Exercise identity badge — static during conduct (COR-005): plain
          text only, never a switcher control (out of scope for this story). */}
      <Box
        data-testid="staff-header-identity-badge"
        title="Exercise identity — static while conduct is live (COR-005)"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '1px',
          background: 'rgba(255, 255, 255, 0.08)',
          border: '1px solid rgba(255, 255, 255, 0.22)',
          borderRadius: '8px',
          px: 1.375,
          py: 0.625,
          minWidth: 0,
        }}
      >
        <Typography sx={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {exerciseName}
        </Typography>
        <Typography
          sx={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: staffShellTokens.header.textMuted,
            whiteSpace: 'nowrap',
          }}
        >
          {role} · {cell}
        </Typography>
      </Box>

      {/* 3. Dual clock pair — SCENARIO (COR-053) + LOCAL (wall, staff-exempt). */}
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.75, px: 0.5, flex: 'none' }}>
        <Stack data-testid="staff-header-scenario-clock" sx={{ alignItems: 'flex-start', lineHeight: 1, gap: '3px' }}>
          <Typography
            id="staff-header-scenario-clock-label"
            sx={{
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: staffShellTokens.header.textMuted,
            }}
          >
            SCENARIO
          </Typography>
          <Typography
            aria-labelledby="staff-header-scenario-clock-label"
            sx={{
              fontFamily: staffShellTokens.classificationTag.fontFamily,
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            {scenarioTimeText}
          </Typography>
        </Stack>
        <Stack data-testid="staff-header-wall-clock" sx={{ alignItems: 'flex-start', lineHeight: 1, gap: '3px' }}>
          <Typography
            id="staff-header-wall-clock-label"
            sx={{
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: staffShellTokens.header.textMuted,
              whiteSpace: 'nowrap',
            }}
          >
            LOCAL · {wallDateText}
          </Typography>
          <Typography
            aria-labelledby="staff-header-wall-clock-label"
            sx={{
              fontFamily: staffShellTokens.classificationTag.fontFamily,
              fontSize: 13,
              fontWeight: 700,
              color: staffShellTokens.header.textMuted,
            }}
          >
            {wallTimeText}
          </Typography>
        </Stack>
      </Stack>

      {/* 4. Exercise state pill — dot AND text, never color-only (NFR-001). */}
      <Box
        role="status"
        data-testid="staff-header-state-pill"
        aria-label={`Exercise state: ${statePill.label}`}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.08em',
          px: 1.125,
          py: 0.5,
          borderRadius: '20px',
          background: statePill.background,
          color: statePill.accentColor,
          border: `1px solid ${statePill.borderColor}`,
          flex: 'none',
        }}
      >
        <Box
          aria-hidden="true"
          data-testid="staff-header-state-pill-dot"
          sx={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor', flex: 'none' }}
        />
        <Box component="span" data-testid="staff-header-state-pill-label">
          {statePill.label}
        </Box>
      </Box>

      <Box sx={{ flex: 1 }} />

      {/* 5. Classification tag — persistent, mono, config-driven (D7-010). */}
      <Box
        data-testid="staff-header-classification-tag"
        title="Training use only — all content simulated"
        sx={{
          fontFamily: staffShellTokens.classificationTag.fontFamily,
          fontWeight: 700,
          fontSize: 9,
          letterSpacing: staffShellTokens.classificationTag.letterSpacing,
          color: staffShellTokens.classificationTag.color,
          border: `1px solid ${staffShellTokens.classificationTag.borderColor}`,
          borderRadius: '5px',
          px: 1,
          py: 0.375,
          whiteSpace: 'nowrap',
          flex: 'none',
        }}
      >
        {STAFF_CLASSIFICATION}
      </Box>

      {/* 6. Staff presence — contract seam, see staffHeaderMocks.ts. */}
      <Stack
        direction="row"
        role="group"
        aria-label="Staff presence"
        data-testid="staff-header-presence"
        sx={{ gap: 0.75, flex: 'none' }}
      >
        {presence.map(member => (
          <Tooltip key={member.id} title={member.label}>
            <Box
              aria-label={member.label}
              sx={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 800,
                color: '#fff',
                background: member.color,
              }}
            >
              {member.initials}
            </Box>
          </Tooltip>
        ))}
      </Stack>

      {/* 7. Preview-as-participant button — behavior is story 04's; renders
          the control only, driven entirely by props (COR-041). HANDLER-GATED:
          a surface that wires no `onTogglePreview` (the planner workspace, and
          the controller console until it wires one) ships NO button at all
          rather than a focusable dead control — see module header point 7. */}
      {onTogglePreview !== undefined && (
        <Box
          component="button"
          type="button"
          data-testid="staff-header-preview-toggle"
          aria-pressed={previewActive}
          onClick={onTogglePreview}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.875,
            background: previewActive ? 'rgba(255, 255, 255, 0.16)' : 'transparent',
            border: previewActive ? '1px solid rgba(255, 255, 255, 0.55)' : '1px solid rgba(255, 255, 255, 0.35)',
            borderRadius: '999px',
            color: staffShellTokens.header.textMuted,
            font: '600 12px ui-sans-serif, system-ui, sans-serif',
            px: 1.75,
            py: 0.875,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flex: 'none',
            '&:hover': {
              background: 'rgba(255, 255, 255, 0.12)',
            },
          }}
        >
          <FontAwesomeIcon icon={previewActive ? faEyeSlash : faEye} size="sm" />
          {previewActive ? 'Exit preview' : 'Preview as participant'}
        </Box>
      )}

      {/* 8. Sign-out control — see module header point 8 for the styling
          nuance (this idiom IS the COBRA staff look for header controls). */}
      <Box
        component="button"
        type="button"
        data-testid="staff-header-sign-out"
        onClick={handleSignOut}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.875,
          background: 'transparent',
          border: '1px solid rgba(255, 255, 255, 0.35)',
          borderRadius: '999px',
          color: staffShellTokens.header.textMuted,
          font: '600 12px ui-sans-serif, system-ui, sans-serif',
          px: 1.75,
          py: 0.875,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          flex: 'none',
          '&:hover': {
            background: 'rgba(255, 255, 255, 0.12)',
          },
        }}
      >
        <FontAwesomeIcon icon={faRightFromBracket} size="sm" />
        Sign out
      </Box>
    </Box>
  )
}
