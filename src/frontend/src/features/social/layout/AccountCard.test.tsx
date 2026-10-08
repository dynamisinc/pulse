/**
 * features/social/layout/AccountCard.test.tsx
 * ---------------------------------------------------------------------------
 * The account card's sign-out (demo-polish F1): it calls the shared
 * `endSession()` and THEN redirects to the login entry, exactly like the shell's
 * own `ParticipantSignOutControl` -- via React Router's own navigate, not the
 * channel's adapter, because signing out leaves the channel.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { personaById, personaIdForHandle, type Persona } from '@/features/personas'
import { LOGIN_PATH } from '@/features/app-shell/constants'
import { AccountCard } from './AccountCard'

const endSessionMock = vi.hoisted(() => vi.fn<() => Promise<void>>())
vi.mock('@/core/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth')>()),
  endSession: endSessionMock,
}))

afterEach(() => {
  endSessionMock.mockReset()
})

function persona(handle: string): Persona {
  const found = personaById(personaIdForHandle(handle))
  if (!found) throw new Error(`fixture missing seeded persona @${handle}`)
  return found
}

function setup(who: Persona | undefined) {
  endSessionMock.mockResolvedValue(undefined)
  render(
    <MemoryRouter initialEntries={['/home']}>
      <Routes>
        <Route path={LOGIN_PATH} element={<p data-testid="login-page">Sign in</p>} />
        <Route path="*" element={<AccountCard persona={who} />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AccountCard', () => {
  it('renders the persona\'s name and handle', () => {
    setup(persona('dreyes_fh'))
    expect(screen.getByText('Dana Reyes')).toBeInTheDocument()
    expect(screen.getByText('@dreyes_fh')).toBeInTheDocument()
  })

  it('signs out via endSession() and redirects to the login entry', async () => {
    const user = userEvent.setup()
    setup(persona('dreyes_fh'))
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(endSessionMock).toHaveBeenCalledTimes(1)
    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
  })

  it('does not wait on a slow endSession before redirecting', async () => {
    const user = userEvent.setup()
    setup(persona('dreyes_fh'))
    endSessionMock.mockReturnValue(new Promise<void>(() => undefined)) // never resolves
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
  })

  it('a persona-less session gets the Sign out button alone', async () => {
    const user = userEvent.setup()
    setup(undefined)
    const card = screen.getByTestId('account-card')
    expect(card).toHaveAttribute('data-has-persona', 'false')
    expect(screen.queryByTestId('post-avatar')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(endSessionMock).toHaveBeenCalledTimes(1)
  })
})
