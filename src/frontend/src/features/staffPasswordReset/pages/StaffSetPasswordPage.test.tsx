/**
 * StaffSetPasswordPage tests (story 21, #576): fragment read + strip, success, invalid
 * token, policy error, 429, no token, confirm mismatch, a11y basics.
 * `@/core/services/api` is mocked so no real axios sink is touched.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AxiosError, type AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { StaffSetPasswordPage } from './StaffSetPasswordPage'

vi.mock('@/core/services/api', () => ({ api: { post: vi.fn() } }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

const mockPost = vi.mocked(api.post)
const GOOD = 'correct horse battery'

function httpError(status: number, data?: unknown): AxiosError {
  const error = new AxiosError('failed')
  error.response = { status, data } as AxiosResponse
  return error
}

function renderPage(hash: string | null = '#token=abc123') {
  window.history.replaceState(null, '', `/staff/reset${hash ?? ''}`)
  return render(
    <MemoryRouter>
      <StaffSetPasswordPage />
    </MemoryRouter>,
  )
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, a = GOOD, b = GOOD) {
  await user.type(screen.getByLabelText(/^New password/), a)
  await user.type(screen.getByLabelText(/^Confirm new password/), b)
  await user.click(screen.getByRole('button', { name: 'Set password' }))
}

describe('StaffSetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads the token from the fragment, strips it, and POSTs it only in the body', async () => {
    mockPost.mockResolvedValue({ status: 204 })
    const user = userEvent.setup()
    renderPage()
    expect(window.location.hash).toBe('')
    expect(window.location.href).not.toContain('abc123')
    await fillAndSubmit(user)
    expect(mockPost).toHaveBeenCalledWith('/auth/password/reset', {
      token: 'abc123',
      newPassword: GOOD,
    })
  })

  it('shows success, focuses the heading, and links to staff sign-in', async () => {
    mockPost.mockResolvedValue({ status: 204 })
    const user = userEvent.setup()
    renderPage()
    await fillAndSubmit(user)
    const heading = await screen.findByRole('heading', { name: 'Your password is set.' })
    await waitFor(() => expect(heading).toHaveFocus())
    await user.click(screen.getByRole('button', { name: 'Go to staff sign-in' }))
    expect(mockNavigate).toHaveBeenCalledWith('/staff/login')
  })

  it('invalid-token 400 shows the invalid-link state with no form', async () => {
    mockPost.mockRejectedValue(httpError(400, { error: 'invalid-token' }))
    const user = userEvent.setup()
    renderPage()
    await fillAndSubmit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This link is invalid or has expired. Ask your organization admin for a new one.',
    )
    expect(screen.queryByLabelText(/^New password/)).toBeNull()
    expect(screen.getByRole('heading', { name: 'Link not valid' })).toHaveFocus()
  })

  it('maps a known policy code and keeps the form', async () => {
    mockPost.mockRejectedValue(httpError(400, { error: 'password-too-common' }))
    const user = userEvent.setup()
    renderPage()
    await fillAndSubmit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('too common')
    expect(screen.getByLabelText(/^New password/)).toBeInTheDocument()
  })

  it('falls back to a generic message for an unknown policy code', async () => {
    mockPost.mockRejectedValue(httpError(400, { error: 'weird-new-code' }))
    const user = userEvent.setup()
    renderPage()
    await fillAndSubmit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a different password.')
  })

  it('429 shows the rate-limit message', async () => {
    mockPost.mockRejectedValue(httpError(429))
    const user = userEvent.setup()
    renderPage()
    await fillAndSubmit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Wait a minute and try again.',
    )
  })

  it('no token in the fragment shows the invalid-link state and never POSTs', () => {
    renderPage(null)
    expect(screen.getByRole('alert')).toHaveTextContent('This link is invalid or has expired.')
    expect(screen.queryByLabelText(/^New password/)).toBeNull()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('ignores a token in the query string', () => {
    window.history.replaceState(null, '', '/staff/reset?token=abc')
    render(
      <MemoryRouter>
        <StaffSetPasswordPage />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('set-password-invalid')).toBeInTheDocument()
  })

  it('blocks submit when the confirmation differs', async () => {
    const user = userEvent.setup()
    renderPage()
    await fillAndSubmit(user, GOOD, GOOD + 'x')
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('has labelled fields, the length hint, and a working show/hide toggle', async () => {
    const user = userEvent.setup()
    renderPage()
    const field = screen.getByLabelText(/^New password/)
    expect(field).toHaveAttribute('type', 'password')
    expect(screen.getByText('At least 12 characters')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show passwords' }))
    expect(field).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide passwords' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
