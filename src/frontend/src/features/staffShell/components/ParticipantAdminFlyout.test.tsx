/**
 * features/staffShell/components/ParticipantAdminFlyout.test.tsx
 * ---------------------------------------------------------------------------
 * Story 03 (Participant-admin flyout / login triage) — RTL coverage for the
 * Acceptance Criteria in docs/features/staff-shell/03-participant-admin-flyout.md:
 *
 *  - Registers a shell-global toolstrip tool with a pending-count badge
 *    (locked-out + no-login-yet, excluding active) — AC2.
 *  - Opening the tool renders a 330px flyout, absolutely positioned flush
 *    against the 56px toolstrip, listing rows (name/role/status chip/quick
 *    action) — AC1.
 *  - The footer link to the full participant-admin surface (staff-navigation/04,
 *    COR-073 AC3; NFR-001; easy-login W2-4): never a dead control. It exists only when
 *    the staff route registry offers the current role that surface (planner and
 *    controller), reads its path FROM the registry entry, navigates client-side (no
 *    reload), and is absent for everyone else and for a bare mount. The same against
 *    the REAL registry is in `ParticipantAdminFlyout.registry.test.tsx`.
 *  - Never a `createPortal`/`document.body` escape (AC1).
 *  - The status chip is TEXT + ICON for every status, never color-only
 *    (NFR-001).
 *  - A quick action is role-gated: ABSENT (not merely disabled) for a role
 *    that can't perform it (AC3, COR-017).
 *  - A quick action audit-logs actor + scenario time via `buildAndEmit`
 *    (AC3, XC-004), pinned by a divergent scenario-vs-wall clock (WAVE0-
 *    REVIEW precedent 18) so it can't pass by reading wall-clock instead.
 *  - The roster hook is called with the RESOLVED exerciseId, never a
 *    hardcoded one (exercise-scoped, XC-001).
 *  - No password (or any) input field anywhere (AC5 safety).
 *  - Keyboard-operable: the toolstrip tool, a quick action, and the close
 *    button are each reachable by Tab and activatable with Enter (NFR-001).
 *
 * `@/core/exerciseContext` and `../participantAdminMocks` are mocked at the
 * module boundary (mirrors `StaffHeader.test.tsx`) so each test controls the
 * exercise scope, roster, and role-authorization directly and
 * deterministically. The sibling `ParticipantAdminFlyout.default.test.tsx`
 * covers the REAL, un-mocked seams (WAVE0-REVIEW precedent 19).
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { faUsers } from '@fortawesome/free-solid-svg-icons'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ParticipantAdminFlyout, PARTICIPANT_ADMIN_TOOL_ID } from './ParticipantAdminFlyout'
import { Toolstrip } from './Toolstrip'
import { ToolstripProvider } from '../toolRegistry'
import { StaffNavigationProvider } from '@/features/app-shell'
import type {
  StaffRouteEntry,
  StaffRouteRegistry,
  StaffSurfaceRole,
} from '@/features/app-shell'
import { useExerciseContext } from '@/core/exerciseContext'
import type { ExerciseScope } from '@/core/exerciseContext'
import { useAdminAuthorization, useParticipantAdminRoster } from '../participantAdminMocks'
import type { AdminAuthorization, ParticipantAdminRow } from '../participantAdminMocks'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import type { TelemetryEventV0 } from '@/core/telemetry'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))

vi.mock('../participantAdminMocks', () => ({
  useParticipantAdminRoster: vi.fn(),
  useAdminAuthorization: vi.fn(),
}))

const BASE_SCOPE: ExerciseScope = {
  exerciseId: 'ex-test-admin-0001',
  exerciseName: 'Bay Shield 2026',
  timeZone: 'UTC',
  status: 'active',
}

const ROSTER_FIXTURE: ParticipantAdminRow[] = [
  { id: 'participant-1', name: 'Ada Lovelace', role: 'EOC Liaison', status: 'locked-out' },
  { id: 'participant-2', name: 'Grace Hopper', role: 'Public Information Officer', status: 'no-login-yet' },
  { id: 'participant-3', name: 'Alan Turing', role: 'Logistics Chief', status: 'active' },
]

const ALLOWED_AUTH: AdminAuthorization = {
  role: 'controller',
  actingHumanId: 'staff-test-0001',
  canPerformAdminAction: true,
}

const DENIED_AUTH: AdminAuthorization = {
  role: 'observer',
  actingHumanId: 'staff-test-0002',
  canPerformAdminAction: false,
}

function mockScope(overrides: Partial<ExerciseScope> = {}) {
  vi.mocked(useExerciseContext).mockReturnValue({ ...BASE_SCOPE, ...overrides })
}

function mockRoster(rows: readonly ParticipantAdminRow[]) {
  vi.mocked(useParticipantAdminRoster).mockReturnValue(rows)
}

function mockAuth(auth: AdminAuthorization) {
  vi.mocked(useAdminAuthorization).mockReturnValue(auth)
}

/**
 * Renders under the real COBRA theme (staff world, CLAUDE.md) — `CobraLinkButton`
 * reads custom `cobraTheme` palette keys (`linkButton`, `buttonPrimary`) that
 * MUI's bare default theme doesn't have, so every test needs this ancestor.
 */
function renderFlyout() {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <ToolstripProvider>
        <ParticipantAdminFlyout />
        <Toolstrip />
      </ToolstripProvider>
    </ThemeProvider>,
  )
}

/** Opens the flyout via the real toolstrip button (drives the real toggle path). */
async function openFlyout(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId(`toolstrip-tool-${PARTICIPANT_ADMIN_TOOL_ID}`))
}

/**
 * Asserts the telemetry buffer holds EXACTLY one event and returns it,
 * narrowed to a defined value (never a bare `!` — `noUncheckedIndexedAccess`
 * types `array[0]` as possibly `undefined`; this guards it for real instead
 * of asserting past the type system).
 */
function expectSingleEmittedEvent(): TelemetryEventV0 {
  const events = getEmittedTelemetryEvents()
  expect(events).toHaveLength(1)
  const [event] = events
  if (!event) throw new Error('expected exactly one emitted telemetry event')
  return event
}

/** Tabs until `target` has focus, or fails loudly rather than silently passing. */
async function tabUntilFocused(
  user: ReturnType<typeof userEvent.setup>,
  target: HTMLElement,
  maxTabs = 20,
) {
  let guard = 0
  while (document.activeElement !== target && guard < maxTabs) {
    await user.tab()
    guard += 1
  }
  expect(document.activeElement).toBe(target)
}

beforeEach(() => {
  mockScope()
  mockRoster(ROSTER_FIXTURE)
  mockAuth(ALLOWED_AUTH)
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
  vi.useRealTimers()
})

describe('ParticipantAdminFlyout — shell-global tool + pending-count badge (AC2)', () => {
  it('shows a badge counting LOCKED OUT + NO LOGIN YET rows, excluding ACTIVE', () => {
    renderFlyout()

    expect(screen.getByRole('button', { name: 'ADMIN: 2 pending' })).toBeInTheDocument()
    expect(screen.getByTestId(`toolstrip-badge-${PARTICIPANT_ADMIN_TOOL_ID}`)).toHaveTextContent('2')
  })

  it('renders no badge when nothing is pending', () => {
    mockRoster([{ id: 'participant-3', name: 'Alan Turing', role: 'Logistics Chief', status: 'active' }])
    renderFlyout()

    expect(screen.getByRole('button', { name: 'ADMIN' })).toBeInTheDocument()
    expect(screen.queryByTestId(`toolstrip-badge-${PARTICIPANT_ADMIN_TOOL_ID}`)).not.toBeInTheDocument()
  })
})

describe('ParticipantAdminFlyout — flyout content, closed by default (AC1)', () => {
  it('renders no flyout until the toolstrip tool is activated', () => {
    renderFlyout()
    expect(screen.queryByTestId('participant-admin-flyout')).not.toBeInTheDocument()
  })

  it('opens a 330px flyout listing rows (name/role/status chip/quick action)', async () => {
    const user = userEvent.setup()
    renderFlyout()

    await openFlyout(user)

    const flyout = screen.getByTestId('participant-admin-flyout')
    expect(flyout).toHaveStyle({ width: '330px' })

    const lockedOutRow = within(flyout).getByTestId('participant-admin-row-participant-1')
    expect(within(lockedOutRow).getByText('Ada Lovelace')).toBeInTheDocument()
    expect(within(lockedOutRow).getByText('EOC Liaison')).toBeInTheDocument()
    expect(within(lockedOutRow).getByTestId('participant-admin-status-chip-locked-out')).toHaveTextContent('LOCKED OUT')
    expect(within(lockedOutRow).getByRole('button', { name: 'Unlock — Ada Lovelace' })).toBeInTheDocument()

    const noLoginRow = within(flyout).getByTestId('participant-admin-row-participant-2')
    expect(within(noLoginRow).getByRole('button', { name: 'Resend — Grace Hopper' })).toBeInTheDocument()

    const activeRow = within(flyout).getByTestId('participant-admin-row-participant-3')
    expect(within(activeRow).getByTestId('participant-admin-status-chip-active')).toHaveTextContent('ACTIVE')
    // Active participants have nothing to triage — no quick action at all.
    expect(within(activeRow).queryByRole('button')).not.toBeInTheDocument()

  })

  // staff-navigation/04 (COR-073), AC3 + NFR-001. This control once PINNED a defect: a raw
  // `href="/staff/participant-admin"` to a path no registry entry declared, i.e. a full page
  // reload out of the SPA that landed in the catch-all and bounced the staff member to their
  // default surface. The footer was removed while the surface did not exist; it is back now
  // (easy-login W2-4) and the describe below pins its replacement. What must stay true with no
  // registry in reach is the original property: a link we cannot resolve is not offered.
  it('offers no footer link, and no raw anchor, when there is no navigation context (AC3, NFR-001)', async () => {
    const user = userEvent.setup()
    renderFlyout()

    await openFlyout(user)

    const flyout = screen.getByTestId('participant-admin-flyout')
    expect(within(flyout).queryByTestId('participant-admin-full-link')).not.toBeInTheDocument()
    expect(within(flyout).queryByText(/open full participant admin/i)).not.toBeInTheDocument()
    expect(flyout.querySelectorAll('a[href]')).toHaveLength(0)
    // Every remaining focusable control is a real, live quick action — nothing
    // is tabbable-but-inert (NFR-001).
    for (const button of within(flyout).getAllByRole('button')) {
      expect(button).not.toBeDisabled()
      expect(button).not.toHaveAttribute('aria-disabled', 'true')
    }
  })

  it('positions the flyout absolutely, flush against the 56px toolstrip', async () => {
    const user = userEvent.setup()
    renderFlyout()
    await openFlyout(user)

    expect(screen.getByTestId('participant-admin-flyout')).toHaveStyle({
      position: 'absolute',
      right: '56px',
    })
  })

  it('the close button closes the flyout; the toolstrip tool re-opens it', async () => {
    const user = userEvent.setup()
    renderFlyout()
    await openFlyout(user)

    await user.click(screen.getByRole('button', { name: 'Close participant admin panel' }))
    expect(screen.queryByTestId('participant-admin-flyout')).not.toBeInTheDocument()

    await openFlyout(user)
    expect(screen.getByTestId('participant-admin-flyout')).toBeInTheDocument()
  })
})

describe('ParticipantAdminFlyout — the footer link to the full surface (W2-4)', () => {
  const FULL_ENTRY: StaffRouteEntry = {
    id: 'participant-admin',
    path: '/staff/participant-admin',
    label: 'Participants',
    icon: faUsers,
    element: <div />,
    allowedRoles: ['planner', 'controller'],
    group: 'administer',
  }
  const OTHER_ENTRY: StaffRouteEntry = {
    id: 'evaluator-dashboard',
    path: '/staff/evaluate',
    label: 'Evaluator Dashboard',
    icon: faUsers,
    element: <div />,
    allowedRoles: ['evaluator'],
    group: 'evaluate',
  }

  function LocationProbe() {
    return <div data-testid="pathname">{useLocation().pathname}</div>
  }

  /** The flyout under the router and the navigation context `StaffRouteTree` publishes. */
  function renderWithNavigation(
    role: StaffSurfaceRole,
    registry: StaffRouteRegistry = [FULL_ENTRY, OTHER_ENTRY],
    at = '/staff/console',
  ) {
    return render(
      <ThemeProvider theme={cobraTheme}>
        <MemoryRouter initialEntries={[at]}>
          <LocationProbe />
          <StaffNavigationProvider registry={registry} role={role}>
            <ToolstripProvider>
              <ParticipantAdminFlyout />
              <Toolstrip />
            </ToolstripProvider>
          </StaffNavigationProvider>
        </MemoryRouter>
      </ThemeProvider>,
    )
  }

  it.each(['planner', 'controller'] as const)('shows a %s the link, as a real anchor to the registry path', async role => {
    const user = userEvent.setup()
    renderWithNavigation(role)
    await openFlyout(user)

    const link = within(screen.getByTestId('participant-admin-flyout'))
      .getByRole('link', { name: 'Open full participant admin' })
    expect(link).toHaveAttribute('href', '/staff/participant-admin')
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('navigation', { name: 'Full participant admin' })).toContainElement(link)
  })

  it.each(['evaluator', 'orgAdmin'] as const)('hides it from a %s: the footer is ABSENT, not disabled', async role => {
    const user = userEvent.setup()
    renderWithNavigation(role)
    await openFlyout(user)

    const flyout = screen.getByTestId('participant-admin-flyout')
    expect(within(flyout).queryByRole('link')).not.toBeInTheDocument()
    expect(within(flyout).queryByTestId('participant-admin-footer')).not.toBeInTheDocument()
    expect(within(flyout).queryByText(/open full participant admin/i)).not.toBeInTheDocument()
  })

  it('reads the path from the registry entry, never a hardcoded string', async () => {
    const user = userEvent.setup()
    renderWithNavigation('controller', [{ ...FULL_ENTRY, path: '/staff/participants-renamed' }])
    await openFlyout(user)

    expect(screen.getByRole('link', { name: 'Open full participant admin' }))
      .toHaveAttribute('href', '/staff/participants-renamed')
  })

  it('offers nothing when the registry has no such entry', async () => {
    const user = userEvent.setup()
    renderWithNavigation('controller', [OTHER_ENTRY])
    await openFlyout(user)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  /**
   * Records, at the DOCUMENT (after React's root handler has run), whether the router
   * cancelled the click's default action, then cancels it so jsdom does not try to navigate.
   */
  function watchClickDefault(): { prevented: boolean[]; stop: () => void } {
    const prevented: boolean[] = []
    const onClick = (event: MouseEvent) => {
      prevented.push(event.defaultPrevented)
      event.preventDefault()
    }
    document.addEventListener('click', onClick)
    return { prevented, stop: () => document.removeEventListener('click', onClick) }
  }

  it('navigates CLIENT-SIDE on a plain click: the router moves, the page does not reload', async () => {
    const user = userEvent.setup()
    renderWithNavigation('planner')
    await openFlyout(user)
    const link = screen.getByRole('link', { name: 'Open full participant admin' })
    const watch = watchClickDefault()

    await user.click(link)
    watch.stop()

    expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/participant-admin')
    // The router cancelled the browser's own navigation (a raw href would have reloaded the page).
    expect(watch.prevented).toEqual([true])
  })

  it('leaves a modified click (open in a new tab) to the browser', async () => {
    const user = userEvent.setup()
    renderWithNavigation('controller')
    await openFlyout(user)
    const link = screen.getByRole('link', { name: 'Open full participant admin' })
    const watch = watchClickDefault()

    fireEvent.click(link, { ctrlKey: true })
    watch.stop()

    // Not intercepted: the router did not cancel it, so the browser opens the href in a new tab.
    expect(watch.prevented).toEqual([false])
    expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/console')
  })

  it('is keyboard-operable: reachable by Tab and activated with Enter', async () => {
    const user = userEvent.setup()
    renderWithNavigation('controller')
    await openFlyout(user)
    const link = screen.getByRole('link', { name: 'Open full participant admin' })

    await tabUntilFocused(user, link)
    await user.keyboard('{Enter}')

    expect(screen.getByTestId('pathname')).toHaveTextContent('/staff/participant-admin')
  })

  it('is absent when the staff member is already ON that page (it would go nowhere)', async () => {
    const user = userEvent.setup()
    renderWithNavigation('controller', [FULL_ENTRY], '/staff/participant-admin')
    await openFlyout(user)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('ParticipantAdminFlyout — never portals to document.body (AC1)', () => {
  it('has no createPortal(...) CALL in its own source', () => {
    // Matches the CALL form only (`createPortal(`), never a bare `createPortal`
    // substring — this file's own module-header comment legitimately mentions
    // "createPortal" in prose (documenting the deliberate absence), which a
    // bare-word match would false-positive on (mirrors
    // `twoWorldsSeparation.test.ts`'s "never matches prose in comments" note).
    const files = import.meta.glob('./ParticipantAdminFlyout.tsx', {
      eager: true, query: '?raw', import: 'default',
    })
    const sources = Object.values(files) as string[]
    expect(sources).toHaveLength(1)
    const [source] = sources
    expect(source).not.toMatch(/createPortal\s*\(/)
  })
})

describe('ParticipantAdminFlyout — status chip is TEXT + ICON, never color-only (NFR-001)', () => {
  const EXPECTED_LABELS: Record<ParticipantAdminRow['status'], string> = {
    'locked-out': 'LOCKED OUT',
    'no-login-yet': 'NO LOGIN YET',
    active: 'ACTIVE',
  }

  it.each(Object.entries(EXPECTED_LABELS) as Array<[ParticipantAdminRow['status'], string]>)(
    'status "%s" renders an aria-hidden icon AND the visible text label "%s"',
    async (status, expectedLabel) => {
      mockRoster([{ id: 'participant-x', name: 'Test Participant', role: 'Observer', status }])
      const user = userEvent.setup()
      renderFlyout()
      await openFlyout(user)

      const chip = screen.getByTestId(`participant-admin-status-chip-${status}`)
      expect(chip).toHaveTextContent(expectedLabel)
      // A screen reader gets the label from the chip's own accessible name,
      // not merely from a color it can't perceive.
      expect(screen.getByRole('status', { name: `Status: ${expectedLabel}` })).toBe(chip)

      const icon = chip.querySelector('svg')
      expect(icon).not.toBeNull()
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    },
  )
})

describe('ParticipantAdminFlyout — role-gated quick actions (AC3, COR-017)', () => {
  it('a role that CANNOT perform admin actions sees no quick action at all (absent, not disabled)', async () => {
    mockAuth(DENIED_AUTH)
    const user = userEvent.setup()
    renderFlyout()
    await openFlyout(user)

    const flyout = screen.getByTestId('participant-admin-flyout')
    expect(within(flyout).queryByRole('button', { name: /Unlock/ })).not.toBeInTheDocument()
    expect(within(flyout).queryByRole('button', { name: /Resend/ })).not.toBeInTheDocument()
    // The rows themselves, and their status chips, still render — only the
    // action affordance is gated.
    expect(within(flyout).getByText('Ada Lovelace')).toBeInTheDocument()
    expect(within(flyout).getByTestId('participant-admin-status-chip-locked-out')).toBeInTheDocument()
  })

  it('a role that CAN perform admin actions sees the quick action (already covered in the AC1 content test)', async () => {
    const user = userEvent.setup()
    renderFlyout()
    await openFlyout(user)

    expect(screen.getByRole('button', { name: 'Unlock — Ada Lovelace' })).toBeInTheDocument()
  })
})

describe('ParticipantAdminFlyout — quick action audit-logs actor + scenario time (AC3, XC-004)', () => {
  it('emits exactly one staff-action telemetry event with the resolved exerciseId/timeZone, actor role + actingHumanId, and target participant on click', async () => {
    mockScope({ exerciseId: 'ex-test-admin-0001', timeZone: 'America/Chicago' })
    const user = userEvent.setup()
    renderFlyout()
    await openFlyout(user)

    await user.click(screen.getByRole('button', { name: 'Unlock — Ada Lovelace' }))

    const event = expectSingleEmittedEvent()

    expect(event.eventType).toBe('staff-action')
    expect(event.channel).toBe('system')
    expect(event.exerciseId).toBe('ex-test-admin-0001')
    expect(event.timeZone).toBe('America/Chicago')
    expect(event.actor).toEqual({
      kind: 'system',
      role: 'controller',
      actingHumanId: 'staff-test-0001',
    })
    expect(event.target).toEqual({ entityType: 'participant', entityId: 'participant-1' })
    expect(event.payload).toMatchObject({
      action: 'unlock',
      participantName: 'Ada Lovelace',
      previousStatus: 'locked-out',
    })
  })

  it('a denied role never emits a telemetry event (there is no action affordance to click)', async () => {
    mockAuth(DENIED_AUTH)
    const user = userEvent.setup()
    renderFlyout()
    await openFlyout(user)

    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })

  it('scenarioTime is sourced from the scenario clock, not the wall clock (WAVE0-REVIEW precedent 18)', async () => {
    const scenarioInstant = new Date('2031-05-04T10:00:00Z')
    setExerciseClock({ scenarioNow: () => scenarioInstant })
    const user = userEvent.setup()
    renderFlyout()
    await openFlyout(user)

    await user.click(screen.getByRole('button', { name: 'Resend — Grace Hopper' }))

    const event = expectSingleEmittedEvent()
    expect(event.scenarioTime).toBe('2031-05-04T10:00:00.000Z')
    // wallClockTime is genuine "now" (real time), not a copy of scenarioTime.
    expect(event.wallClockTime).not.toBe(event.scenarioTime)
    expect(Math.abs(Date.now() - new Date(event.wallClockTime).getTime())).toBeLessThan(5_000)
  })
})

describe('ParticipantAdminFlyout — exercise-scoped roster (XC-001)', () => {
  it('reads the roster for the RESOLVED exerciseId, never a hardcoded one', () => {
    mockScope({ exerciseId: 'ex-different-0002' })
    renderFlyout()

    expect(useParticipantAdminRoster).toHaveBeenCalledWith('ex-different-0002')
  })
})

describe('ParticipantAdminFlyout — safety: never a password (or any) input field (AC5)', () => {
  it('renders zero <input> elements anywhere in the open flyout', async () => {
    const user = userEvent.setup()
    renderFlyout()
    await openFlyout(user)

    const flyout = screen.getByTestId('participant-admin-flyout')
    expect(flyout.querySelectorAll('input')).toHaveLength(0)
    expect(within(flyout).queryAllByRole('textbox')).toHaveLength(0)
  })
})

describe('ParticipantAdminFlyout — keyboard operability (NFR-001)', () => {
  it('the toolstrip tool button is reachable by Tab and opens the flyout on Enter', async () => {
    const user = userEvent.setup()
    renderFlyout()

    const toolButton = screen.getByTestId(`toolstrip-tool-${PARTICIPANT_ADMIN_TOOL_ID}`)
    await tabUntilFocused(user, toolButton)

    await user.keyboard('{Enter}')
    expect(screen.getByTestId('participant-admin-flyout')).toBeInTheDocument()
  })

  it('a quick-action button inside the open flyout is reachable by Tab and activatable with Enter', async () => {
    const user = userEvent.setup()
    renderFlyout()
    await openFlyout(user)

    const unlockButton = screen.getByRole('button', { name: 'Unlock — Ada Lovelace' })
    await tabUntilFocused(user, unlockButton)

    await user.keyboard('{Enter}')
    expect(getEmittedTelemetryEvents()).toHaveLength(1)
  })

  it('the close button is reachable by Tab and closes the flyout on Enter', async () => {
    const user = userEvent.setup()
    renderFlyout()
    await openFlyout(user)

    const closeButton = screen.getByRole('button', { name: 'Close participant admin panel' })
    await tabUntilFocused(user, closeButton)

    await user.keyboard('{Enter}')
    expect(screen.queryByTestId('participant-admin-flyout')).not.toBeInTheDocument()
  })
})
