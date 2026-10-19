/**
 * features/planner/pages/ExerciseSettingsPage.roleGating.test.tsx
 * ---------------------------------------------------------------------------
 * identity-auth-roles story 17 (issue #573): exercise settings, compliance chrome and practice
 * mode are PLANNER-only on the server (a controller or evaluator gets 403 on every save). The
 * page therefore shows the workspace to a planner and a read-only text notice (icon + words) to
 * everyone else. The panels are stubbed: this suite is about the role gate, not the forms.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionRole } from '@/core/auth'
import { resetStubSession, setStubSession } from '@/core/auth/rolePermissions.testUtils'
import { ExerciseSettingsPage } from './ExerciseSettingsPage'

vi.mock('@/core/auth/session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  useOptionalSession: (await import('@/core/auth/rolePermissions.testUtils')).stubbedSession,
}))
vi.mock('../components/ExerciseSettingsPanel', () => ({
  ExerciseSettingsPanel: () => <div data-testid="stub-settings-panel" />,
}))
vi.mock('../components/ComplianceChromePanel', () => ({
  ComplianceChromePanel: () => <div data-testid="stub-chrome-panel" />,
}))
vi.mock('../components/PracticeModePanel', () => ({
  PracticeModePanel: () => <div data-testid="stub-practice-panel" />,
}))
vi.mock('../components/StaffPanel', () => ({
  StaffPanel: () => <div data-testid="stub-staff-panel" />,
}))
vi.mock('../components/AccountImport', () => ({
  AccountImport: () => <div data-testid="stub-account-import" />,
}))

beforeEach(() => resetStubSession())

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/staff/plan']}>
      <ExerciseSettingsPage />
    </MemoryRouter>,
  )
}

describe('ExerciseSettingsPage by role', () => {
  it('a planner gets the workspace and no read-only notice', () => {
    setStubSession({ role: 'planner', isLead: false })
    renderPage()
    expect(screen.getByTestId('stub-settings-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('exercise-settings-read-only')).not.toBeInTheDocument()
  })

  const REFUSED: readonly SessionRole[] = ['controller', 'evaluator', 'orgAdmin']
  for (const role of REFUSED) {
    it(`${role}: no panels, a read-only notice in words`, () => {
      setStubSession({ role, isLead: true })
      renderPage()
      expect(screen.queryByTestId('stub-settings-panel')).not.toBeInTheDocument()
      expect(screen.queryByTestId('stub-chrome-panel')).not.toBeInTheDocument()
      expect(screen.queryByTestId('stub-practice-panel')).not.toBeInTheDocument()
      const notice = screen.getByTestId('exercise-settings-read-only')
      expect(notice).toHaveTextContent('Read-only')
      expect(notice).toHaveTextContent('Only the planner can change')
      expect(notice.querySelector('svg')).not.toBeNull()
    })
  }

  it('no session at all fails closed to the notice', () => {
    setStubSession({ role: undefined })
    renderPage()
    expect(screen.getByTestId('exercise-settings-read-only')).toBeInTheDocument()
  })
})

describe('ExerciseSettingsPage Staff section by role (story 20)', () => {
  it('a planner sees the Staff nav item', () => {
    setStubSession({ role: 'planner', isLead: false })
    renderPage()
    expect(screen.getByTestId('exercise-config-nav-staff')).toHaveTextContent('Staff')
  })

  for (const role of ['controller', 'evaluator', 'orgAdmin'] as const) {
    it(`${role} does not see the Staff nav item`, () => {
      setStubSession({ role, isLead: true })
      renderPage()
      expect(screen.queryByTestId('exercise-config-nav-staff')).not.toBeInTheDocument()
    })
  }
})
