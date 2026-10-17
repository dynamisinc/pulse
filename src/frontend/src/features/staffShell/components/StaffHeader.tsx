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
 *      THE STAFF SURFACE LAUNCHER (feature: staff-navigation, story 02;
 *      COR-071) lives here: `SurfaceLauncher` (`./SurfaceLauncher.tsx`) owns
 *      this slot entirely, and wires ITSELF — it reads `{registry, role}` from
 *      `StaffNavigationProvider` (published by `StaffRouteTree`, so every staff
 *      surface is covered with no per-composition edit) and the current path
 *      from `useLocation()`. The `staffRoutes` / `role` / `currentPath` props
 *      below are OVERRIDES only; nothing in production passes them. It renders
 *      an interactive, role-gated, grouped disclosure menu when the role can
 *      reach two or more surfaces, and the original static, non-interactive
 *      lockup otherwise — see that file's module header for the full IoC
 *      rationale (no registry import here, ever) and the degrade rule.
 *   2. Exercise identity badge — exercise name + role/cell. With ONE exercise
 *      assignment it is plain, non-interactive text (COR-005). With TWO OR MORE
 *      it becomes the exercise SWITCHER: a menu button (chevron, `aria-haspopup`)
 *      listing each assignment, the active one marked "Active" in text + a check.
 *      It reuses `features/staff`'s `useStaffAssignments` / `useSetActiveExercise`
 *      — see `ExerciseIdentityBadge.tsx`. (Replaces the old panel that was
 *      mounted above the console.)
 *   3. Dual clock pair — SCENARIO (from `useScenarioTime`, sourced from the
 *      exercise clock, never wall-clock) and LOCAL (real wall-clock time,
 *      ticking ~1s — staff surfaces are EXEMPT from the participant
 *      scenario-time-only lint ban, see eslint.config.js).
 *   4. Exercise state pill — dot + TEXT, never color-only (NFR-001).
 *   5. Classification tag — `STAFF_CLASSIFICATION`, persistent, mono,
 *      config-driven in exactly one place (D7-010: no separate exercise bar).
 *   6. Staff presence — a row of avatars. CONTRACT SEAM: backed by
 *      `staffHeaderMocks.ts` until the live presence channel (CTL-004) exists.
 *      That roster is EMPTY today (demo-polish C4: no invented colleagues), and
 *      an empty roster renders NOTHING — not an empty labelled "Staff presence"
 *      group a screen reader would announce with no members in it. The group
 *      appears only when the seam returns at least one member.
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

import { useEffect, useRef, useState } from 'react'
import { Box, Popover, Stack, Tooltip, Typography, useMediaQuery } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faEllipsis,
  faEye,
  faEyeSlash,
  faRightFromBracket,
} from '@fortawesome/free-solid-svg-icons'
import { useExerciseContext } from '@/core/exerciseContext'
import { useScenarioTime } from '@/core/clock'
import { endSession } from '@/core/auth'
import { LOGIN_PATH } from '@/features/app-shell/constants'
import type { StaffRouteRegistry, StaffSurfaceRole } from '@/features/app-shell'
import {
  STAFF_COARSE_POINTER_MEDIA,
  STAFF_TABLET_PORTRAIT_QUERY,
  STAFF_TABLET_QUERY,
  STAFF_TOUCH_TARGET_PX,
  staffShellTokens,
} from '../staffShellTokens'
import { useStaffPresence, useStaffRoleCell } from '../staffHeaderMocks'
import { STATE_PILL_CONFIG, type StatePillConfig } from './statePillConfig'
import { SurfaceLauncher } from './SurfaceLauncher'
import { ExerciseIdentityBadge } from './ExerciseIdentityBadge'

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
  /**
   * OVERRIDE for the staff surface launcher's registry (feature:
   * staff-navigation, story 02; COR-071), forwarded verbatim to
   * `SurfaceLauncher`. NO COMPOSITION PASSES THIS, and none needs to: the
   * launcher reads `{registry, role}` from `StaffNavigationProvider`
   * (`StaffRouteTree`) via context. Kept only so a test — or a future
   * composition needing a different table — can inject one; see
   * `SurfaceLauncher.tsx`'s module header for why this header never imports the
   * concrete registry itself.
   */
  staffRoutes?: StaffRouteRegistry
  /** OVERRIDE for the resolved staff role gating `staffRoutes`. Context-supplied
   * in production, exactly like `staffRoutes`. */
  role?: StaffSurfaceRole
  /**
   * OVERRIDE for the current location's pathname — which launcher entry is
   * marked as the current surface. Defaults, inside `SurfaceLauncher`, to
   * `useLocation().pathname` (WR-001); this header passes nothing in production.
   */
  currentPath?: string
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
  staffRoutes,
  role: launcherRole,
  currentPath,
}: StaffHeaderProps) {
  const { timeZone, status } = useExerciseContext()
  // NOTE: this `role`/`cell` pair is the identity-badge's display seam (e.g.
  // "CONTROLLER" / "SIMCELL-1", derived from the controller identity's call sign —
  // see staffHeaderMocks.ts) — a different thing from the launcher's
  // `StaffSurfaceRole` prop above (renamed `launcherRole` to avoid shadowing it).
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

  // --- Tablet bands (story 13; D5-021). Chosen by WIDTH ONLY; `noSsr` so the first paint is
  // already the right layout (no desktop flash on an iPad). With no `matchMedia` (jsdom) both are
  // false and
  // the desktop header renders, byte-for-byte as before. ---
  const tablet = useMediaQuery(STAFF_TABLET_QUERY, { noSsr: true })
  const portrait = useMediaQuery(STAFF_TABLET_PORTRAIT_QUERY, { noSsr: true })
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null)
  const moreButtonRef = useRef<HTMLButtonElement | null>(null)
  const moreOpen = moreAnchor !== null
  const closeMore = () => setMoreAnchor(null)

  // Under a coarse pointer every header control is at least 44px tall (real layout space, never
  // ::before/::after slop). Width follows content; adjacent controls are >= 8px apart (gap).
  const headerButtonTouchSx = {
    [STAFF_COARSE_POINTER_MEDIA]: { minHeight: STAFF_TOUCH_TARGET_PX },
  } as const

  const scenarioClock = (
    <Stack
      data-testid="staff-header-scenario-clock"
      sx={{ alignItems: 'flex-start', lineHeight: 1, gap: '3px', flex: 'none' }}
    >
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
  )

  const wallClock = (
    <Stack
      data-testid="staff-header-wall-clock"
      sx={{ alignItems: 'flex-start', lineHeight: 1, gap: '3px' }}
    >
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
  )

  // State pill — dot AND text, never color-only (NFR-001). Never collapses at any width.
  const pill = (
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
        whiteSpace: 'nowrap',
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
  )

  // Classification tag — persistent, mono, config-driven (D7-010). Never collapses at any width.
  const classificationTag = (
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
  )

  const presenceAvatars =
    presence.length > 0 ? (
      <Stack
        direction="row"
        role="group"
        aria-label="Staff presence"
        data-testid="staff-header-presence"
        sx={{ gap: 0.75, flex: 'none', flexWrap: 'wrap' }}
      >
        {presence.map(member => (
          // Touch equivalent for the hover tooltip: a held touch shows it (and it lingers); on a
          // tablet the avatars live in the header "more" menu with their names as TEXT.
          <Tooltip
            key={member.id}
            title={member.label}
            enterTouchDelay={400}
            leaveTouchDelay={3000}
            disableInteractive
          >
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
    ) : null

  // Preview-as-participant button — behavior is story 04's; HANDLER-GATED (see module header
  // point 7). In the tablet "more" menu it keeps the same testid/aria-pressed contract.
  const previewButton =
    onTogglePreview !== undefined ? (
      <Box
        component="button"
        type="button"
        data-testid="staff-header-preview-toggle"
        aria-pressed={previewActive}
        onClick={() => {
          if (moreOpen) {
            // Entering preview remembers `document.activeElement` as the opener to return focus
            // to on exit. A control inside the menu unmounts when the menu closes, so hand focus
            // to the always-mounted "more" button FIRST (the menu does not trap focus; see below).
            moreButtonRef.current?.focus()
            closeMore()
          }
          onTogglePreview()
        }}
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
          ...headerButtonTouchSx,
        }}
      >
        <FontAwesomeIcon icon={previewActive ? faEyeSlash : faEye} size="sm" />
        {previewActive ? 'Exit preview' : 'Preview as participant'}
      </Box>
    ) : null

  // Sign-out control — see module header point 8. Tablet portrait shows it icon-only (the row has
  // no room for the word); the accessible name stays "Sign out".
  const signOutIconOnly = portrait
  const signOutButton = (
    <Box
      component="button"
      type="button"
      data-testid="staff-header-sign-out"
      aria-label={signOutIconOnly ? 'Sign out' : undefined}
      onClick={handleSignOut}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.875,
        background: 'transparent',
        border: '1px solid rgba(255, 255, 255, 0.35)',
        borderRadius: '999px',
        color: staffShellTokens.header.textMuted,
        font: '600 12px ui-sans-serif, system-ui, sans-serif',
        px: signOutIconOnly ? 1.25 : 1.75,
        py: 0.875,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flex: 'none',
        '&:hover': {
          background: 'rgba(255, 255, 255, 0.12)',
        },
        ...(signOutIconOnly
          ? {
            [STAFF_COARSE_POINTER_MEDIA]: {
              minHeight: STAFF_TOUCH_TARGET_PX,
              minWidth: STAFF_TOUCH_TARGET_PX,
            },
          }
          : headerButtonTouchSx),
      }}
    >
      <FontAwesomeIcon icon={faRightFromBracket} size="sm" />
      {!signOutIconOnly && 'Sign out'}
    </Box>
  )

  // ---------------------------------------------------------------------------------------------
  // TABLET (< 1280): the wall clock, presence avatars and "Preview as participant" move into a
  // header "more" popover. Exercise identity, the scenario clock, the state pill, the
  // classification tag and sign-out stay in the row, never collapsed (TABLET-AMENDMENT §3).
  // In portrait (< 1024) the pill and tag stack in one cell so the row fits 768px.
  // ---------------------------------------------------------------------------------------------
  if (tablet) {
    return (
      <Box
        data-testid="staff-header"
        data-header-band={portrait ? 'tablet-portrait' : 'tablet-landscape'}
        sx={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: portrait ? 1 : 1.5,
          px: portrait ? 1.5 : 2,
          minWidth: 0,
        }}
      >
        <SurfaceLauncher
          surfaceName={surfaceName}
          registry={staffRoutes}
          role={launcherRole}
          currentPath={currentPath}
        />
        <ExerciseIdentityBadge role={role} cell={cell} />
        {scenarioClock}

        {portrait ? (
          <Stack
            data-testid="staff-header-status-group"
            sx={{ alignItems: 'flex-start', gap: '3px', flex: 'none' }}
          >
            {pill}
            {classificationTag}
          </Stack>
        ) : (
          <>
            {pill}
            <Box sx={{ flex: 1 }} />
            {classificationTag}
          </>
        )}

        {portrait && <Box sx={{ flex: 1, minWidth: 0 }} />}

        <Box
          component="button"
          type="button"
          ref={moreButtonRef}
          data-testid="staff-header-more"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-label={
            previewActive ? 'More header options — preview is on' : 'More header options'
          }
          onClick={event => setMoreAnchor(event.currentTarget)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.75,
            background: previewActive ? 'rgba(255, 255, 255, 0.16)' : 'transparent',
            border: previewActive
              ? '1px solid rgba(255, 255, 255, 0.55)'
              : '1px solid rgba(255, 255, 255, 0.35)',
            borderRadius: '999px',
            color: staffShellTokens.header.textMuted,
            font: '600 12px ui-sans-serif, system-ui, sans-serif',
            px: 1.25,
            py: 0.875,
            minWidth: 36,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flex: 'none',
            '&:hover': { background: 'rgba(255, 255, 255, 0.12)' },
            '&:focus-visible': {
              outline: '2px solid rgba(255, 255, 255, 0.85)',
              outlineOffset: '2px',
            },
            [STAFF_COARSE_POINTER_MEDIA]: {
              minHeight: STAFF_TOUCH_TARGET_PX,
              minWidth: STAFF_TOUCH_TARGET_PX,
            },
          }}
        >
          <FontAwesomeIcon icon={faEllipsis} size="sm" aria-hidden="true" />
          {/* Text, not just a tint, says the preview is on (never color-only, NFR-001). */}
          {previewActive && (
            <Box component="span" sx={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em' }}>
              PREVIEW
            </Box>
          )}
        </Box>

        <Popover
          open={moreOpen}
          anchorEl={moreAnchor}
          onClose={closeMore}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          // Do not trap focus: the preview toggle hands focus to the "more" button before the menu
          // closes (see its onClick). Escape and the backdrop still close it.
          disableEnforceFocus
          slotProps={{
            paper: {
              'aria-label': 'More header options',
              'data-testid': 'staff-header-more-menu',
              // Navy like the header it extends, so header-styled controls inside keep contrast.
              sx: {
                width: 'min(320px, calc(100vw - 16px))',
                p: 1.5,
                mt: 0.5,
                bgcolor: staffShellTokens.header.background,
                color: staffShellTokens.header.textPrimary,
                border: `1px solid ${staffShellTokens.header.borderColor}`,
              },
            } as object,
          }}
        >
          <Stack sx={{ gap: 1.5, alignItems: 'stretch' }}>
            <Stack sx={{ gap: 0.5 }}>
              <Typography sx={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em' }}>
                WALL CLOCK
              </Typography>
              {wallClock}
            </Stack>
            {presenceAvatars !== null && (
              <Stack sx={{ gap: 0.75 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em' }}>
                  STAFF ONLINE
                </Typography>
                {presenceAvatars}
                <Typography
                  component="ul"
                  sx={{ m: 0, p: 0, listStyle: 'none', fontSize: 12, color: staffShellTokens.header.textMuted }}
                >
                  {presence.map(member => (
                    <li key={member.id}>{member.label}</li>
                  ))}
                </Typography>
              </Stack>
            )}
            {previewButton}
            <Typography sx={{ fontSize: 11, color: staffShellTokens.header.textMuted }}>
              Training use only — all content simulated
            </Typography>
          </Stack>
        </Popover>

        {signOutButton}
      </Box>
    )
  }

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
      {/* 1. Brand lockup — the staff surface launcher (COR-071). See module
          header point 1 and SurfaceLauncher.tsx for the full contract. */}
      <SurfaceLauncher
        surfaceName={surfaceName}
        registry={staffRoutes}
        role={launcherRole}
        currentPath={currentPath}
      />

      {/* 2. Exercise identity badge — static text with one assignment; the
          exercise switcher menu button with two or more (see
          ExerciseIdentityBadge.tsx). */}
      <ExerciseIdentityBadge role={role} cell={cell} />

      {/* 3. Dual clock pair — SCENARIO (COR-053) + LOCAL (wall, staff-exempt). */}
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.75, px: 0.5, flex: 'none' }}>
        {scenarioClock}
        {wallClock}
      </Stack>

      {/* 4. Exercise state pill — dot AND text, never color-only (NFR-001). */}
      {pill}

      <Box sx={{ flex: 1 }} />

      {/* 5. Classification tag — persistent, mono, config-driven (D7-010). */}
      {classificationTag}

      {/* 6. Staff presence — contract seam, see staffHeaderMocks.ts. Rendered
          only for a NON-EMPTY roster: no members means no group at all. */}
      {presenceAvatars}

      {/* 7. Preview-as-participant button (handler-gated). */}
      {previewButton}

      {/* 8. Sign-out control. */}
      {signOutButton}
    </Box>
  )
}
