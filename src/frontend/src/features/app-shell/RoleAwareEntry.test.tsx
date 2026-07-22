/**
 * features/app-shell/RoleAwareEntry.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the role-aware entry's branching, two-worlds separation, fail-closed
 * behaviour, and route-change focus management (story 01 ACs; COR-004/COR-005,
 * XC-002, NFR-001).
 *
 * The identity seams are mocked at the hook boundary (`useSession`/`useRole`/
 * `useExerciseContext`) to drive each case; the PURE role/expiry helpers
 * (`isParticipantRole`/`isStaffRole`/`isSessionExpired`) are kept REAL so the
 * test exercises the real predicates, not a re-implementation.
 *
 * The two composed cross-story seams (`ParticipantLandingGuard` from
 * exercise-isolation/04, `ExerciseSwitcher` from exercise-isolation/05) are NOT
 * on this branch yet, and are INJECTED into `RoleAwareEntry` as props (IoC), so
 * the tests supply stubs directly — no `vi.mock` of a not-yet-resolvable module
 * (which Vite's import-analysis would reject before the mock could intercept).
 */
import type { ComponentType, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { useTheme } from '@mui/material/styles'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSession, useRole } from '@/core/auth'
import type { Session } from '@/core/auth'
import { useExerciseContext } from '@/core/exerciseContext'
import type { ExerciseScope } from '@/core/exerciseContext'
import { RoleAwareEntry, type RoleAwareEntryProps } from './RoleAwareEntry'

// Avoid the shared axios client's teardown race (a real POST rejecting after
// the worker exits) — no network is used here anyway.
vi.mock('@/core/services/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

// Keep the pure helpers real; drive only the hooks.
vi.mock('@/core/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/auth')>()
  return { ...actual, useSession: vi.fn(), useRole: vi.fn() }
})
vi.mock('@/core/exerciseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext')>()
  return { ...actual, useExerciseContext: vi.fn() }
})

// Stubs for the injected (contract-first) composed seams.
const StubGuard: ComponentType<{ children: ReactNode }> = ({ children }) => (
  <div data-testid="participant-guard">{children}</div>
)
const stubSwitcher = <div data-testid="exercise-switcher" />

const BASE_SESSION: Session = {
  exerciseId: 'ex-mock-0001',
  accountId: 'acct-test',
  role: 'participant',
  personaId: 'persona-test',
  actingHumanId: 'human-test',
  isReadOnly: false,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
}

const SCOPE: ExerciseScope = {
  exerciseId: 'ex-mock-0001',
  exerciseName: 'Mock Exercise',
  timeZone: 'UTC',
  status: 'active',
}

/** Drives the mocked hooks to a resolved session for `role` (default: valid). */
function primeSession(overrides: Partial<Session> = {}) {
  const session: Session = { ...BASE_SESSION, ...overrides }
  vi.mocked(useSession).mockReturnValue(session)
  vi.mocked(useRole).mockReturnValue(session.role)
  vi.mocked(useExerciseContext).mockReturnValue(SCOPE)
  return session
}

/** A probe that reports whether it renders under the COBRA theme (two-worlds). */
function ThemeProbe() {
  const theme = useTheme()
  return (
    <div
      data-testid="theme-probe"
      data-theme-cobra={String(theme.cssStyling !== undefined)}
    />
  )
}

function renderEntry(props: Partial<RoleAwareEntryProps> = {}) {
  const merged: RoleAwareEntryProps = {
    participantSurface: <div data-testid="participant-surface" />,
    staffSurfaces: {
      controller: <div data-testid="staff-surface-controller" />,
      evaluator: <div data-testid="staff-surface-evaluator" />,
    },
    participantGuard: StubGuard,
    staffSwitcher: stubSwitcher,
    ...props,
  }
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<RoleAwareEntry {...merged} />} />
        <Route path="/login" element={<div data-testid="login-sentinel" />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('RoleAwareEntry — participant / pio', () => {
  it.each(['participant', 'pio'] as const)(
    'routes a %s session to the guarded participant landing (no picker, no staff surface, no switcher)',
    role => {
      primeSession({ role })
      renderEntry()

      expect(screen.getByTestId('participant-guard')).toBeInTheDocument()
      expect(screen.getByTestId('participant-surface')).toBeInTheDocument()

      // No staff surface is reachable, and the staff-only switcher is absent.
      expect(screen.queryByTestId('exercise-switcher')).not.toBeInTheDocument()
      expect(screen.queryByTestId('staff-surface-controller')).not.toBeInTheDocument()
      expect(screen.queryByTestId('staff-surface-evaluator')).not.toBeInTheDocument()
      expect(screen.queryByTestId('login-sentinel')).not.toBeInTheDocument()
    },
  )

  it('renders the participant surface with NO COBRA ancestor (two-worlds)', () => {
    primeSession({ role: 'participant' })
    renderEntry({ participantSurface: <ThemeProbe /> })

    expect(screen.getByTestId('theme-probe')).toHaveAttribute('data-theme-cobra', 'false')
  })
})

describe('RoleAwareEntry — staff', () => {
  it('routes a controller to the console surface WITH the switcher', () => {
    primeSession({ role: 'controller' })
    renderEntry()

    expect(screen.getByTestId('staff-surface-controller')).toBeInTheDocument()
    expect(screen.getByTestId('exercise-switcher')).toBeInTheDocument()
    // No participant world leaks in.
    expect(screen.queryByTestId('participant-guard')).not.toBeInTheDocument()
    expect(screen.queryByTestId('participant-surface')).not.toBeInTheDocument()
  })

  it('routes an evaluator to the evaluator surface WITH the switcher', () => {
    primeSession({ role: 'evaluator' })
    renderEntry()

    expect(screen.getByTestId('staff-surface-evaluator')).toBeInTheDocument()
    expect(screen.getByTestId('exercise-switcher')).toBeInTheDocument()
  })

  it('mounts the staff surface UNDER the COBRA theme (two-worlds)', () => {
    primeSession({ role: 'controller' })
    renderEntry({ staffSurfaces: { controller: <ThemeProbe /> } })

    expect(screen.getByTestId('theme-probe')).toHaveAttribute('data-theme-cobra', 'true')
  })

  it('fails closed for a staff role with no built surface', () => {
    primeSession({ role: 'planner' })
    renderEntry({ staffSurfaces: {} })

    expect(screen.getByTestId('login-sentinel')).toBeInTheDocument()
    expect(screen.queryByTestId('exercise-switcher')).not.toBeInTheDocument()
  })
})

describe('RoleAwareEntry — fail closed', () => {
  it('redirects an expired session to the login entry', () => {
    primeSession({ role: 'participant', expiresAt: new Date(Date.now() - 1000).toISOString() })
    renderEntry()

    expect(screen.getByTestId('login-sentinel')).toBeInTheDocument()
    expect(screen.queryByTestId('participant-guard')).not.toBeInTheDocument()
    expect(screen.queryByTestId('exercise-switcher')).not.toBeInTheDocument()
  })

  it('redirects an unsupported role (orgAdmin) to the login entry — never a default/cross-world surface', () => {
    primeSession({ role: 'orgAdmin' })
    renderEntry()

    expect(screen.getByTestId('login-sentinel')).toBeInTheDocument()
    expect(screen.queryByTestId('participant-guard')).not.toBeInTheDocument()
    expect(screen.queryByTestId('staff-surface-controller')).not.toBeInTheDocument()
    expect(screen.queryByTestId('exercise-switcher')).not.toBeInTheDocument()
  })

  it('redirects an unresolved session (hook throws) to the login entry', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(useSession).mockImplementation(() => {
      throw new Error('useSession() outside a resolved provider (unresolved)')
    })
    vi.mocked(useRole).mockReturnValue('participant')
    vi.mocked(useExerciseContext).mockReturnValue(SCOPE)

    renderEntry()

    expect(screen.getByTestId('login-sentinel')).toBeInTheDocument()
    consoleSpy.mockRestore()
  })
})

describe('RoleAwareEntry — focus management (NFR-001)', () => {
  it('moves focus to the new participant surface, not <body>, on entry', () => {
    primeSession({ role: 'participant' })
    renderEntry()

    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toHaveAttribute('data-app-shell-focus-scope', 'participant')
  })

  it('moves focus to the new staff surface on entry', () => {
    primeSession({ role: 'controller' })
    renderEntry()

    expect(document.activeElement).toHaveAttribute('data-app-shell-focus-scope', 'staff:controller')
  })
})
