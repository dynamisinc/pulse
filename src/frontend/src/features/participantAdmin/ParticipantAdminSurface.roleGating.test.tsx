/**
 * features/participantAdmin/ParticipantAdminSurface.roleGating.test.tsx
 * ---------------------------------------------------------------------------
 * identity-auth-roles story 17 (issue #573): roster provisioning/import and the view-only /
 * day-word codes are planner + controller on the server (`manageAccounts`); an evaluator would
 * get a 403 on every call. The surface mounts the route for planner and controller and shows a
 * text notice (icon + words) to everyone else. The route itself is stubbed.
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionRole } from '@/core/auth'
import { resetStubSession, setStubSession } from '@/core/auth/rolePermissions.testUtils'
import { ParticipantAdminSurface } from './ParticipantAdminSurface'

vi.mock('@/core/auth/session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  useOptionalSession: (await import('@/core/auth/rolePermissions.testUtils')).stubbedSession,
}))
vi.mock('./ParticipantAdminRoute', () => ({
  ParticipantAdminRoute: () => <div data-testid="stub-participant-admin-route" />,
}))
vi.mock('./dayWord', () => ({ DayWordPanel: () => null }))
vi.mock('./cards', () => ({ PrintCardsButton: () => null }))
vi.mock('./email', () => ({ EmailLinksButton: () => null }))

beforeEach(() => resetStubSession())

describe('ParticipantAdminSurface by role', () => {
  const ALLOWED: readonly SessionRole[] = ['planner', 'controller']
  const REFUSED: readonly SessionRole[] = ['evaluator', 'orgAdmin', 'participant', 'pio']

  for (const role of ALLOWED) {
    it(`${role}: the roster surface mounts`, () => {
      setStubSession({ role, isLead: false })
      render(<ParticipantAdminSurface />)
      expect(screen.getByTestId('stub-participant-admin-route')).toBeInTheDocument()
    })
  }

  for (const role of REFUSED) {
    it(`${role}: a text notice, no write controls`, () => {
      setStubSession({ role, isLead: false })
      render(<ParticipantAdminSurface />)
      expect(screen.queryByTestId('stub-participant-admin-route')).not.toBeInTheDocument()
      const notice = screen.getByTestId('participant-admin-no-access')
      expect(notice).toHaveTextContent('Not available for your role.')
      expect(notice).toHaveTextContent('Only a planner or controller')
    })
  }
})
