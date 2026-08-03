/**
 * features/staffShell/components/SurfaceLauncher.tsx
 * ---------------------------------------------------------------------------
 * The STAFF SURFACE LAUNCHER (feature: staff-navigation, story 02 — "Surface
 * launcher (header brand-lockup, role-gated)"; COR-071; see
 * docs/features/staff-navigation/02-surface-launcher.md). Turns
 * `StaffHeader`'s brand lockup ("PULSE" / surface name) into the one place a
 * staff human reaches another staff surface without knowing its URL.
 *
 * ## Why the lockup, not a new element
 * See the story doc for the full rejection of a left nav rail / toolstrip
 * tenant / new header strip — the short version is: the lockup is present on
 * every staff surface, was already inert, and turning it into a button adds
 * zero new elements to the shell's fixed three-part contract
 * (`SHELL-CONTRACT.md` §1).
 *
 * ## Inversion of control — no registry import, ever
 * This component NEVER imports `@/features/staff/staffRouteRegistry` (the
 * concrete table). That table imports each surface's own route composition
 * (`ControllerConsoleRoute`, `EvaluatorDashboardRoute`, `PlannerWorkspaceRoute`),
 * every one of which imports `StaffHeader` — which mounts this component. A
 * direct import here would close that loop into a genuine circular
 * dependency (registry -> a surface's route file -> StaffHeader ->
 * SurfaceLauncher -> registry).
 *
 * ## How the registry actually arrives: CONTEXT, not props (WR-003)
 * `StaffRouteTree` (`@/features/app-shell/StaffRouteTree.tsx`) wraps every
 * registered surface in `StaffNavigationProvider`, publishing `{registry, role}`
 * to any staff chrome rendered inside them — which is exactly where `StaffHeader`
 * (and therefore this launcher) lives. `useStaffNavigation()` below reads it. So
 * ALL THREE shipped surfaces are wired today, with no per-composition edit and
 * none needed for surface #4: adding a registry entry is the whole change.
 *
 * (An earlier version of this header said the opposite — "nothing wires the real
 * registry into `ControllerConsoleRoute` / `EvaluatorDashboardRoute` /
 * `PlannerWorkspaceRoute` today". That is false since the context seam landed,
 * and it is a dangerous thing to leave lying around: the degrade path below makes
 * WIRED and UNWIRED render pixel-identically, so a reader has no way to check the
 * claim on screen. `@/features/app-shell/staffLauncherWiring.test.tsx` is the
 * mechanical guard that the wire exists.)
 *
 * `registry` / `role` / `currentPath` remain OPTIONAL PROPS, but only as
 * OVERRIDES for a test or a composition that needs to inject something different
 * (mirrors `StaffRouteTree`'s own `routes`/`role` injection). Production supplies
 * none of them: the registry and role come from context, and the current path
 * comes from `useLocation()` — see below.
 *
 * ## `allowedRoles` is the only gate (no second visibility list)
 * Visibility is derived EXCLUSIVELY via `staffRoutesForRole(registry, role)`
 * (`@/features/app-shell`), the same resolver `StaffRouteTree` uses for
 * routing. There is no second allow/deny list here to drift out of sync — a
 * surface absent from `allowedRoles` for the caller's role is filtered out
 * before this component ever renders a menu item for it.
 *
 * ## Reading the CURRENT surface (WR-001)
 * `currentPath` defaults to `useLocation().pathname`. It used to be prop-only,
 * and nothing in production ever passed it — so `isCurrentEntry()` always
 * returned `false` and the whole current-surface treatment (`aria-current="page"`,
 * the disabled state, the "Current" chip) was unreachable outside tests. Reading
 * the location HERE is safe for COR-004: this is staff-only chrome that always
 * renders below `StaffRouteTree`, which is itself only reachable once the
 * resolved role has been narrowed to a staff role. The PARTICIPANT branch
 * (`RoleAwareEntry`) stays location-blind by construction and must never import a
 * location API — `participantLocationBlindness.test.ts` enforces that, and this
 * file is deliberately not on that path.
 *
 * ## Single-surface degrade (AC: "do not render a launcher that goes nowhere")
 * When no registry/role can be resolved (neither context nor props) OR the role
 * can reach at most one entry, this renders the ORIGINAL static,
 * non-interactive brand lockup — same markup, same `data-testid`, same text. A
 * menu with exactly one destination (the surface the caller is already on) is
 * worse than no menu: it invites a click that goes nowhere and announces a
 * disclosure affordance with nothing behind it. Every staff role today
 * (`controller` / `evaluator` / `planner`) maps to exactly one registry entry,
 * so this degrade path is what ships in production until a future surface (e.g.
 * exercise-management) gives a role a second destination.
 *
 * ## Accessibility (NFR-001)
 * A real disclosure menu, not a hand-rolled listbox: the trigger is a native
 * `<button>` with `aria-haspopup="menu"` / `aria-expanded`, opening MUI's
 * `<Menu>` (a `role="menu"` `MenuList` of `role="menuitem"` `MenuItem`s).
 * MUI's `Modal`/`Popover` stack gives this, unmodified: a focus trap while
 * open (`disableEnforceFocus` defaults `false`), auto-focus onto the active
 * item on open, `Escape` closing AND restoring focus to the trigger
 * (`disableRestoreFocus` defaults `false`), and arrow-key/type-ahead
 * navigation via `MenuList`'s roving-tabindex implementation — which
 * registers `MenuItem`s through React context (`useRovingTabIndexItem`), so
 * nesting them inside the group wrapper below does not break keyboard
 * navigation. Each group section is a real ARIA group (`role="group"` +
 * `aria-labelledby` pointing at its visible heading) per the WAI-ARIA APG
 * "menu with groups" pattern — never conveyed by layout/spacing alone. The
 * current surface is marked `aria-current="page"` AND rendered `disabled`
 * (excluded from the roving-tabindex focus order and unclickable) — "not
 * presented as a destination to re-navigate to" per the AC — with a
 * FontAwesome check icon PLUS the text "Current", never color alone.
 *
 * World: STAFF (COBRA/Cadence). `Menu`/`MenuItem`/`ListItemIcon`/`ListItemText`
 * are plain `@mui/material` — there is no COBRA-styled menu, and the story's
 * own Technical Notes sanction MUI's native `<Menu>`/`<MenuList>` here
 * (unlike `Button`/`TextField`, which DO have COBRA equivalents and must never
 * be used bare on a staff surface). FontAwesome only; MUI 9 `sx`-only.
 */

import { useId, useState } from 'react'
import { Box, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Typography } from '@mui/material'
import { useLocation, useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons'
import {
  STAFF_ROUTE_GROUP_LABELS,
  STAFF_ROUTE_GROUP_ORDER,
  staffRoutesForRole,
  useStaffNavigation,
  type StaffRouteEntry,
  type StaffRouteRegistry,
  type StaffSurfaceRole,
} from '@/features/app-shell'
import { staffShellTokens } from '../staffShellTokens'

export interface SurfaceLauncherProps {
  /** The staff surface mounting the header, e.g. "Controller Console" — the
   * lockup's second line either way (static or interactive). */
  surfaceName: string
  /**
   * OVERRIDE for the staff route registry (`@/features/app-shell`'s
   * `StaffRouteRegistry` shape; the concrete table lives at
   * `@/features/staff/staffRouteRegistry`). Production does NOT pass this — the
   * registry arrives from `StaffNavigationProvider` via `useStaffNavigation()`
   * (see module header). Supplied only by tests, or by a composition that needs
   * a different table. With neither context nor prop, the static lockup renders.
   */
  registry?: StaffRouteRegistry
  /** OVERRIDE for the resolved staff role gating `registry` visibility. Also
   * context-supplied in production; either half missing degrades to the static
   * lockup. */
  role?: StaffSurfaceRole
  /**
   * OVERRIDE for the current location's pathname — what marks (and excludes
   * from re-navigation) the matching registry entry via `aria-current`.
   * Defaults to `useLocation().pathname`; production relies on that default and
   * passes nothing. As a prop-only value it was never supplied by anything in
   * production, which made the entire current-surface treatment unreachable
   * outside tests (WR-001).
   */
  currentPath?: string
}

/** True when `path` names the surface the caller is already on. */
function isCurrentEntry(entry: StaffRouteEntry, currentPath: string | undefined): boolean {
  if (currentPath === undefined || currentPath === '') return false
  return currentPath === entry.path || currentPath.startsWith(`${entry.path}/`)
}

/** The lockup's two text lines — identical in both the static and interactive render. */
function LockupText({ surfaceName }: { surfaceName: string }) {
  return (
    <Stack sx={{ lineHeight: 1.05, alignItems: 'flex-start' }}>
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
  )
}

/** The original, non-interactive brand lockup — see "Single-surface degrade" above. */
function StaticLockup({ surfaceName }: { surfaceName: string }) {
  return (
    <Stack data-testid="staff-header-lockup" sx={{ lineHeight: 1.05, flex: 'none' }}>
      <LockupText surfaceName={surfaceName} />
    </Stack>
  )
}

/**
 * The staff surface launcher, mounted in `StaffHeader`'s brand-lockup slot.
 * See the module header for the degrade rule and the a11y contract.
 */
export function SurfaceLauncher({
  surfaceName,
  registry,
  role,
  currentPath,
}: SurfaceLauncherProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const menuId = useId()
  const open = anchorEl !== null

  // Scope comes from `StaffRouteTree` via context (the real app path — see
  // `staffNavigationContext.tsx`), with the explicit props kept as an override
  // so a composition or test can inject a different registry/role directly.
  // Props win when supplied; neither is required.
  const navScope = useStaffNavigation()
  const effectiveRegistry = registry ?? navScope?.registry
  const effectiveRole = role ?? navScope?.role
  // The current surface comes from the ROUTER, not from a caller (WR-001): as a
  // prop it was never passed in production, so `aria-current`/disabled/"Current"
  // could not be reached. Staff-only chrome, always below `StaffRouteTree` — the
  // participant branch is unaffected and stays location-blind (COR-004).
  const effectiveCurrentPath = currentPath ?? location.pathname
  void effectiveCurrentPath

  // `allowedRoles` (via `staffRoutesForRole`) is the ONLY visibility gate —
  // see module header. No second list is derived or maintained here.
  const entries =
    effectiveRegistry !== undefined && effectiveRole !== undefined
      ? staffRoutesForRole(effectiveRegistry, effectiveRole)
      : []

  if (entries.length <= 1) {
    return <StaticLockup surfaceName={surfaceName} />
  }

  const groups = STAFF_ROUTE_GROUP_ORDER
    .map(group => ({ group, entries: entries.filter(entry => entry.group === group) }))
    .filter(g => g.entries.length > 0)

  const handleClose = () => setAnchorEl(null)

  const handleSelect = (entry: StaffRouteEntry) => {
    handleClose()
    if (!isCurrentEntry(entry, effectiveCurrentPath)) {
      navigate(entry.path)
    }
  }

  return (
    <>
      <Box
        component="button"
        type="button"
        data-testid="staff-header-lockup"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Staff surfaces — currently ${surfaceName}`}
        onClick={event => setAnchorEl(event.currentTarget)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.625,
          flex: 'none',
          background: 'transparent',
          border: 'none',
          borderRadius: '6px',
          p: 0.25,
          m: 0,
          font: 'inherit',
          color: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          '&:hover': { background: 'rgba(255, 255, 255, 0.1)' },
          '&:focus-visible': {
            outline: '2px solid rgba(255, 255, 255, 0.65)',
            outlineOffset: '2px',
          },
        }}
      >
        <LockupText surfaceName={surfaceName} />
        <FontAwesomeIcon
          icon={open ? faChevronUp : faChevronDown}
          size="xs"
          aria-hidden="true"
          style={{ opacity: 0.75 }}
        />
      </Box>

      <Menu
        id={menuId}
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ list: { 'aria-label': 'Staff surfaces', dense: true, sx: { minWidth: 260, py: 0.5 } } }}
      >
        {groups.map(({ group, entries: groupEntries }) => {
          const headingId = `${menuId}-group-${group}`
          return (
            // A real ARIA group per WAI-ARIA APG "menu with groups": a
            // non-focusable `<li>` wrapper (valid inside the Menu's `<ul>`)
            // containing the visible heading plus a nested `<ul role="group">`
            // of the group's `MenuItem`s — never conveyed by spacing alone.
            <Box key={group} component="li" role="none" sx={{ listStyle: 'none' }}>
              <Typography
                id={headingId}
                component="div"
                role="presentation"
                sx={{
                  px: 2,
                  pt: 1,
                  pb: 0.5,
                  fontSize: 10.5,
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: staffShellTokens.accent.secondaryText,
                }}
              >
                {STAFF_ROUTE_GROUP_LABELS[group]}
              </Typography>
              <Box component="ul" role="group" aria-labelledby={headingId} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {groupEntries.map(entry => {
                  // MUST be `effectiveCurrentPath`, not the raw `currentPath`
                  // prop: production passes no prop and reads the location via
                  // the default (WR-001). Using the prop here left the marking
                  // dead in the real app while every prop-passing test still
                  // went green — the same half-wired shape WR-001 was raised
                  // for. `staffLauncherWiring.test.tsx` renders this component
                  // with NO props and is what pins it.
                  const isCurrent = isCurrentEntry(entry, effectiveCurrentPath)
                  return (
                    <MenuItem
                      key={entry.id}
                      data-testid={`surface-launcher-item-${entry.id}`}
                      disabled={isCurrent}
                      aria-current={isCurrent ? 'page' : undefined}
                      onClick={() => handleSelect(entry)}
                      sx={{ py: 0.875, alignItems: 'flex-start', gap: 1 }}
                    >
                      <ListItemIcon sx={{ minWidth: 28, mt: '2px', color: 'inherit' }}>
                        <FontAwesomeIcon icon={entry.icon} fixedWidth aria-hidden="true" />
                      </ListItemIcon>
                      <ListItemText
                        primary={entry.label}
                        secondary={entry.description}
                        slotProps={{
                          primary: { sx: { fontSize: 13, fontWeight: 600 } },
                          secondary: { sx: { fontSize: 11 } },
                        }}
                      />
                      {isCurrent && (
                        <Stack
                          direction="row"
                          sx={{ alignItems: 'center', gap: 0.5, flex: 'none', mt: '2px' }}
                        >
                          <FontAwesomeIcon icon={faCheck} size="xs" aria-hidden="true" />
                          <Typography component="span" sx={{ fontSize: 10, fontWeight: 700 }}>
                            Current
                          </Typography>
                        </Stack>
                      )}
                    </MenuItem>
                  )
                })}
              </Box>
            </Box>
          )
        })}
      </Menu>
    </>
  )
}
