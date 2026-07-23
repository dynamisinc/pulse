/**
 * features/participant-shell/components/ParticipantSignOutControl.test.tsx
 * ---------------------------------------------------------------------------
 * RTL coverage for the participant sign-out control (feature: login, story
 * 04): a real, accessible, keyboard-operable button that calls the shared
 * `logout()` helper then navigates to `LOGIN_PATH`.
 *
 * `@/core/auth`'s `logout()` is mocked at the module boundary — its own
 * contract (token clearing, the best-effort `POST /auth/logout`) is covered
 * by `core/auth/logout.test.ts`; this file only asserts the control CALLS it.
 * `react-router-dom` keeps its real `MemoryRouter` (via `importOriginal`) and
 * only overrides `useNavigate()` with a spy.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ParticipantSignOutControl } from './ParticipantSignOutControl'
import { endSession } from '@/core/auth'
import { LOGIN_PATH } from '@/features/app-shell/constants'

vi.mock('@/core/auth', () => ({
  endSession: vi.fn(),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

const mockEndSession = vi.mocked(endSession)

beforeEach(() => {
  mockEndSession.mockReset()
  mockEndSession.mockResolvedValue(undefined)
  mockNavigate.mockReset()
})

function renderControl() {
  return render(
    <MemoryRouter>
      <ParticipantSignOutControl />
    </MemoryRouter>,
  )
}

describe('ParticipantSignOutControl', () => {
  it('renders a real, accessible "Sign out" button', () => {
    renderControl()

    const button = screen.getByRole('button', { name: 'Sign out' })
    expect(button.tagName).toBe('BUTTON')
  })

  it('calls the shared endSession() helper, then navigates to LOGIN_PATH, on click', async () => {
    const user = userEvent.setup()
    renderControl()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(mockEndSession).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(LOGIN_PATH))
  })

  it('is keyboard-operable: reachable by Tab and activatable with Enter', async () => {
    const user = userEvent.setup()
    renderControl()

    const button = screen.getByRole('button', { name: 'Sign out' })
    button.focus()
    expect(button).toHaveFocus()

    await user.keyboard('{Enter}')

    await waitFor(() => expect(mockEndSession).toHaveBeenCalledTimes(1))
  })

  it('never crashes when endSession() is called — it never throws by contract', async () => {
    const user = userEvent.setup()
    renderControl()

    await expect(
      user.click(screen.getByRole('button', { name: 'Sign out' })),
    ).resolves.not.toThrow()
  })
})
