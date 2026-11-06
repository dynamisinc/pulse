/**
 * StaffInvitePage tests (#575b): invite copy, awaiting-assignment, sign-in path (org login then
 * completeSignIn), sign-in failure / choice list fallback to the success state, invalid-link copy.
 * The page's own reset behaviour (204) is covered in StaffSetPasswordPage.test.tsx.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AxiosError, type AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { completeSignIn } from '@/features/login/completeSignIn'
import { StaffInvitePage } from './StaffSetPasswordPage'

vi.mock('@/core/services/api', () => ({ api: { post: vi.fn() } }))
vi.mock('@/features/login/completeSignIn', () => ({ completeSignIn: vi.fn() }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

const mockPost = vi.mocked(api.post)
const GOOD = 'correct horse battery'

function renderPage(hash = '#token=inv123') {
  window.history.replaceState(null, '', `/staff/invite${hash}`)
  return render(
    <MemoryRouter>
      <StaffInvitePage />
    </MemoryRouter>,
  )
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^New password/), GOOD)
  await user.type(screen.getByLabelText(/^Confirm new password/), GOOD)
  await user.click(screen.getByRole('button', { name: 'Set password' }))
}

const landing = (next: string) => ({
  status: 200,
  data: { next, orgSlug: 'acme', email: 'a@b.org' },
})

beforeEach(() => {
  vi.resetAllMocks()
})

describe('StaffInvitePage', () => {
  it('uses invite copy', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Set up your Pulse account' })).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Choose a password' })).toBeInTheDocument()
  })

  it('shows the invite-specific invalid-link copy', () => {
    renderPage('')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This invite link is invalid or has expired. Ask your organization admin to send a new invite.',
    )
  })

  it('awaiting-assignment shows the ready state with focus and never signs in', async () => {
    mockPost.mockResolvedValue(landing('awaiting-assignment'))
    const user = userEvent.setup()
    renderPage()
    await submit(user)
    const heading = await screen.findByRole('heading', { name: 'Your account is ready' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByRole('status')).toHaveTextContent('An administrator will add you')
    expect(mockPost).toHaveBeenCalledTimes(1)
    expect(completeSignIn).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(/^New password/)).toBeNull()
  })

  it('sign-in calls the org login then completeSignIn (staff => persist: false)', async () => {
    mockPost
      .mockResolvedValueOnce(landing('sign-in'))
      .mockResolvedValueOnce({ status: 200, data: { token: 'tok', refreshToken: 'ref', session: {} } })
    const user = userEvent.setup()
    renderPage()
    await submit(user)
    await waitFor(() => expect(completeSignIn).toHaveBeenCalledTimes(1))
    expect(mockPost).toHaveBeenLastCalledWith('/auth/staff/login', {
      orgSlug: 'acme',
      email: 'a@b.org',
      password: GOOD,
    })
    expect(vi.mocked(completeSignIn).mock.calls[0]?.[0]).toEqual({ token: 'tok', refreshToken: 'ref' })
    expect(vi.mocked(completeSignIn).mock.calls[0]?.[1]).toMatchObject({ persist: false })
    expect(document.body.textContent).not.toContain(GOOD)
  })

  it('a failed org login falls back to the success state', async () => {
    const error = new AxiosError('x')
    error.response = { status: 401, data: '' } as AxiosResponse
    mockPost.mockResolvedValueOnce(landing('sign-in')).mockRejectedValueOnce(error)
    const user = userEvent.setup()
    renderPage()
    await submit(user)
    const heading = await screen.findByRole('heading', { name: 'Your password is set.' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(completeSignIn).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Go to staff sign-in' }))
    expect(mockNavigate).toHaveBeenCalledWith('/staff/login')
  })

  it('a choice list from the org login falls back to the success state', async () => {
    mockPost.mockResolvedValueOnce(landing('sign-in')).mockResolvedValueOnce({
      status: 200,
      data: { choose: [{ slug: 'acme', orgName: 'Acme' }], choiceToken: 'c' },
    })
    const user = userEvent.setup()
    renderPage()
    await submit(user)
    expect(await screen.findByRole('heading', { name: 'Your password is set.' })).toBeInTheDocument()
    expect(completeSignIn).not.toHaveBeenCalled()
  })
})
