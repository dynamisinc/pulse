/**
 * features/social/components/Composer.readonly.test.tsx
 * ---------------------------------------------------------------------------
 * Covers story 01's observer-mode acceptance criterion (COR-015 / D1-011):
 * in a read-only session the composer is ABSENT — not a disabled form — so a
 * passive/shared-credential participant sees (and a screen reader announces)
 * no compose controls at all.
 *
 * The shared Wave-1 mock session is a normal writable participant, so this one
 * scenario forces a read-only session by mocking `useSession()`. It lives in
 * its own file precisely because `vi.mock` is hoisted to the whole module —
 * every other Composer test uses the REAL `SessionProvider`.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { Composer } from './Composer'

const READONLY_SESSION: Session = {
  exerciseId: 'ex-mock-0001',
  accountId: 'acct-observer',
  role: 'participant',
  personaId: 'persona-dreyes_fh',
  actingHumanId: 'human-observer',
  isReadOnly: true,
  expiresAt: '2999-01-01T00:00:00.000Z',
}

vi.mock('@/core/auth', () => ({
  useSession: () => READONLY_SESSION,
}))

describe('Composer — observer mode (COR-015, D1-011)', () => {
  it('renders nothing at all in a read-only session — absent, not disabled', async () => {
    render(
      <ExerciseContextProvider>
        <div data-testid="sentinel" />
        <Composer />
      </ExerciseContextProvider>,
    )

    // The sentinel appears once the exercise context resolves; by then the
    // composer has had its chance to render.
    await screen.findByTestId('sentinel')

    expect(screen.queryByTestId('composer')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Post text')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Post' })).not.toBeInTheDocument()
  })
})
