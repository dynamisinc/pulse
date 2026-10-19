/**
 * OrgDirectoryPage tests (story 19, #574): table content, search and paging, each action with its
 * confirm dialog and error mapping, refetch after mutation, self-disable, self-revoke warning,
 * success announcements in a polite status region (W-003), reset-link availability with a visible
 * reason (S3), and role gating via `can('manageOrgPeople')`. The service is mocked; the session is
 * the role-selectable stub.
 */
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { resetStubSession, setStubSession } from '@/core/auth/rolePermissions.testUtils'
import { OrgDirectoryPage } from './OrgDirectoryPage'
import {
  issuePasswordResetLink,
  listOrgPeople,
  OrgPeopleError,
  updateOrgPerson,
} from '../services/orgPeopleService'
import type { OrgPeoplePage, OrgPerson } from '../types'

vi.mock('@/core/auth/session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  useOptionalSession: (await import('@/core/auth/rolePermissions.testUtils')).stubbedSession,
}))

vi.mock('../services/orgPeopleService', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/orgPeopleService')>()),
  listOrgPeople: vi.fn(),
  updateOrgPerson: vi.fn(),
  issuePasswordResetLink: vi.fn(),
}))

const person = (over: Partial<OrgPerson>): OrgPerson => ({
  id: 'p-1',
  displayName: 'Ada Admin',
  email: 'ada@example.org',
  orgRole: null,
  disabled: false,
  disabledAt: null,
  lockedOutUntil: null,
  enrollments: [],
  ...over,
})

const ADMIN = person({ id: 'p-admin', displayName: 'Ada Admin', orgRole: 'orgAdmin' })
const DISABLED = person({ id: 'p-dis', displayName: 'Dan Disabled', disabled: true, disabledAt: '2026-10-01T00:00:00Z' })
const LOCKED = person({
  id: 'p-lock',
  displayName: 'Lia Locked',
  lockedOutUntil: '2026-10-19T12:00:00Z',
  enrollments: [
    { exerciseId: 'e1', exerciseName: 'Coastal Surge', role: 'controller', isLead: true },
    { exerciseId: 'e2', exerciseName: 'Harbor', role: 'evaluator', isLead: false },
  ],
})
const PLAIN = person({ id: 'p-plain', displayName: 'Pat Plain', email: null })

const page = (items: OrgPerson[], over: Partial<OrgPeoplePage> = {}): OrgPeoplePage => ({
  items, page: 1, pageSize: 25, total: items.length, ...over,
})

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={cobraTheme}>{children}</ThemeProvider>
      </QueryClientProvider>
    )
  }
  return render(<OrgDirectoryPage />, { wrapper: Wrapper })
}

beforeEach(() => {
  vi.resetAllMocks()
  resetStubSession()
  setStubSession({ role: 'orgAdmin' })
  vi.mocked(listOrgPeople).mockResolvedValue(page([ADMIN, DISABLED, LOCKED, PLAIN]))
})

describe('role gating', () => {
  it.each(['planner', 'controller', 'evaluator'] as const)('%s never sees the directory and makes no request', role => {
    setStubSession({ role })
    renderPage()
    expect(screen.getByTestId('org-directory-denied')).toBeTruthy()
    expect(screen.queryByTestId('org-people-table')).toBeNull()
    expect(listOrgPeople).not.toHaveBeenCalled()
  })

  it('no session sees nothing', () => {
    setStubSession({ role: undefined })
    renderPage()
    expect(screen.getByTestId('org-directory-denied')).toBeTruthy()
    expect(listOrgPeople).not.toHaveBeenCalled()
  })
})

describe('table', () => {
  it('shows name, email, badges with text, and the enrollment summary', async () => {
    renderPage()
    await screen.findByTestId('org-people-table')
    const admin = within(screen.getByTestId('org-person-p-admin'))
    expect(admin.getByText('ada@example.org')).toBeTruthy()
    expect(admin.getByTestId('badge-org-admin').textContent).toBe('Org admin')
    expect(within(screen.getByTestId('org-person-p-dis')).getByTestId('badge-disabled').textContent).toBe('Disabled')
    const locked = within(screen.getByTestId('org-person-p-lock'))
    expect(locked.getByTestId('badge-locked-out').textContent).toBe('Locked out')
    expect(locked.getByText(/Coastal Surge: controller/).textContent).toContain('(lead)')
    expect(locked.getByText(/Harbor: evaluator/).textContent).not.toContain('(lead)')
    expect(within(screen.getByTestId('org-person-p-plain')).getByText('No email')).toBeTruthy()
    expect(screen.getByTestId('org-people-status').textContent).toContain('4 people')
  })

  it('shows an empty state', async () => {
    vi.mocked(listOrgPeople).mockResolvedValue(page([]))
    renderPage()
    expect(await screen.findByTestId('org-people-empty')).toBeTruthy()
  })

  it('announces a load failure in an alert', async () => {
    vi.mocked(listOrgPeople).mockRejectedValue(new OrgPeopleError('x', { status: 500 }))
    renderPage()
    expect((await screen.findByTestId('org-people-error')).getAttribute('role')).toBe('alert')
  })
})

describe('search and paging', () => {
  it('submits a trimmed search and returns to page 1', async () => {
    renderPage()
    await screen.findByTestId('org-people-table')
    fireEvent.change(screen.getByLabelText('Search by name or email'), { target: { value: '  lia ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(listOrgPeople).toHaveBeenLastCalledWith({ search: 'lia', page: 1, pageSize: 25 }))
  })

  it('pages with Next and Previous', async () => {
    vi.mocked(listOrgPeople).mockResolvedValue(page([ADMIN], { total: 60 }))
    renderPage()
    await screen.findByTestId('org-people-table')
    expect(screen.getByTestId('org-people-status').textContent).toContain('Page 1 of 3')
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() =>
      expect(listOrgPeople).toHaveBeenLastCalledWith({ search: '', page: 2, pageSize: 25 }))
    fireEvent.click(await screen.findByRole('button', { name: 'Previous' }))
    await waitFor(() => expect(listOrgPeople).toHaveBeenLastCalledWith({ search: '', page: 1, pageSize: 25 }))
  })
})

describe('actions', () => {
  it('grants org admin after confirm, then refetches', async () => {
    vi.mocked(updateOrgPerson).mockResolvedValue(PLAIN)
    renderPage()
    await screen.findByTestId('org-people-table')
    const calls = vi.mocked(listOrgPeople).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Make org admin Pat Plain' }))
    expect(screen.getByTestId('person-action-name').textContent).toBe('Pat Plain')
    expect(updateOrgPerson).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('person-action-confirm'))
    await waitFor(() => expect(updateOrgPerson).toHaveBeenCalledWith('p-plain', { isOrgAdmin: true }))
    await waitFor(() => expect(vi.mocked(listOrgPeople).mock.calls.length).toBeGreaterThan(calls))
    await waitFor(() => expect(screen.queryByTestId('person-action-dialog')).toBeNull())
    const announced = screen.getByTestId('org-people-action-status')
    expect(announced.getAttribute('role')).toBe('status')
    expect(announced.getAttribute('aria-live')).toBe('polite')
    expect(announced.textContent).toBe('Pat Plain is now an org admin.')
  })

  it('revokes org admin', async () => {
    vi.mocked(updateOrgPerson).mockResolvedValue(ADMIN)
    renderPage()
    await screen.findByTestId('org-people-table')
    fireEvent.click(screen.getByRole('button', { name: 'Remove org admin from Ada Admin' }))
    fireEvent.click(screen.getByTestId('person-action-confirm'))
    await waitFor(() => expect(updateOrgPerson).toHaveBeenCalledWith('p-admin', { isOrgAdmin: false }))
    await waitFor(() =>
      expect(screen.getByTestId('org-people-action-status').textContent).toBe('Ada Admin is no longer an org admin.'))
  })

  it('maps 409 last-org-admin into an alert with the dialog kept open and the list refetched', async () => {
    vi.mocked(updateOrgPerson).mockRejectedValue(new OrgPeopleError('x', { status: 409, code: 'last-org-admin' }))
    renderPage()
    await screen.findByTestId('org-people-table')
    const calls = vi.mocked(listOrgPeople).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Remove org admin from Ada Admin' }))
    fireEvent.click(screen.getByTestId('person-action-confirm'))
    const alert = await screen.findByTestId('person-action-error')
    await waitFor(() => expect(alert.textContent).toContain('at least one enabled admin'))
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.querySelector('svg')).not.toBeNull()
    expect(screen.getByTestId('person-action-dialog')).toBeTruthy()
    await waitFor(() => expect(vi.mocked(listOrgPeople).mock.calls.length).toBeGreaterThan(calls))
    // A failure announces no success.
    expect(screen.getByTestId('org-people-action-status').textContent).toBe('')
  })

  it('disables and enables', async () => {
    vi.mocked(updateOrgPerson).mockResolvedValue(PLAIN)
    renderPage()
    await screen.findByTestId('org-people-table')
    fireEvent.click(screen.getByRole('button', { name: 'Disable Pat Plain' }))
    fireEvent.click(screen.getByTestId('person-action-confirm'))
    await waitFor(() => expect(updateOrgPerson).toHaveBeenCalledWith('p-plain', { disabled: true }))
    await waitFor(() => expect(screen.queryByTestId('person-action-dialog')).toBeNull())
    expect(screen.getByTestId('org-people-action-status').textContent).toBe('Pat Plain was disabled.')
    fireEvent.click(screen.getByRole('button', { name: 'Enable Dan Disabled' }))
    fireEvent.click(screen.getByTestId('person-action-confirm'))
    await waitFor(() => expect(updateOrgPerson).toHaveBeenCalledWith('p-dis', { disabled: false }))
    await waitFor(() =>
      expect(screen.getByTestId('org-people-action-status').textContent).toBe('Dan Disabled was enabled.'))
  })

  it('Cancel makes no call', async () => {
    renderPage()
    await screen.findByTestId('org-people-table')
    fireEvent.click(screen.getByRole('button', { name: 'Disable Pat Plain' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByTestId('person-action-dialog')).toBeNull())
    expect(updateOrgPerson).not.toHaveBeenCalled()
  })

  it('does not offer Disable on the caller\'s own row, and still maps cannot-disable-self', async () => {
    // the stub session's personId
    const { stubbedSession } = await import('@/core/auth/rolePermissions.testUtils')
    const selfId = stubbedSession()?.personId
    // Fail loudly if the shared stub ever loses its personId, rather than skipping the self check.
    expect(selfId).toBeTruthy()
    const self = person({ id: selfId as string, displayName: 'Sam Self' })
    vi.mocked(listOrgPeople).mockResolvedValue(page([self, PLAIN]))
    renderPage()
    await screen.findByTestId('org-people-table')
    expect(screen.queryByRole('button', { name: 'Disable Sam Self' })).toBeNull()
    expect(screen.getByText('Sam Self (you)')).toBeTruthy()
    vi.mocked(updateOrgPerson).mockRejectedValue(new OrgPeopleError('x', { status: 409, code: 'cannot-disable-self' }))
    fireEvent.click(screen.getByRole('button', { name: 'Disable Pat Plain' }))
    fireEvent.click(screen.getByTestId('person-action-confirm'))
    await waitFor(() =>
      expect(screen.getByTestId('person-action-error').textContent).toContain('cannot disable your own'))
  })

  it('creates a reset link, shows it and copies it', async () => {
    vi.mocked(issuePasswordResetLink).mockResolvedValue('https://app.example/staff/reset#token=abc')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPage()
    await screen.findByTestId('org-people-table')
    fireEvent.click(screen.getByRole('button', { name: 'Copy password-reset link for Pat Plain' }))
    fireEvent.click(screen.getByTestId('person-action-confirm'))
    expect((await screen.findByTestId('reset-link')).textContent).toBe('https://app.example/staff/reset#token=abc')
    expect(issuePasswordResetLink).toHaveBeenCalledWith('p-plain')
    // Announced on the page AND inside the modal (which hides the page from assistive tech).
    expect(screen.getByTestId('org-people-action-status').textContent).toBe('Reset link created for Pat Plain.')
    expect(screen.getByTestId('copy-status').textContent).toBe('Reset link created for Pat Plain.')
    expect(screen.getByTestId('copy-status').getAttribute('role')).toBe('status')
    fireEvent.click(screen.getByTestId('copy-reset-link'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://app.example/staff/reset#token=abc'))
    await waitFor(() => expect(screen.getByTestId('copy-status').textContent).toContain('copied'))
  })

  it('disables Reset link on org-admin and disabled rows with a visible text reason', async () => {
    renderPage()
    await screen.findByTestId('org-people-table')
    const adminReset = screen.getByRole('button', { name: 'Copy password-reset link for Ada Admin' })
    expect((adminReset as HTMLButtonElement).disabled).toBe(true)
    const adminReason = within(screen.getByTestId('org-person-p-admin')).getByTestId('reset-unavailable-reason')
    expect(adminReason.textContent).toContain('org admins')
    expect(adminReset.getAttribute('aria-describedby')).toBe(adminReason.id)
    const disabledReset = screen.getByRole('button', { name: 'Copy password-reset link for Dan Disabled' })
    expect((disabledReset as HTMLButtonElement).disabled).toBe(true)
    expect(within(screen.getByTestId('org-person-p-dis')).getByTestId('reset-unavailable-reason').textContent)
      .toContain('enable them first')
    const plainReset = screen.getByRole('button', { name: 'Copy password-reset link for Pat Plain' })
    expect((plainReset as HTMLButtonElement).disabled).toBe(false)
    expect(within(screen.getByTestId('org-person-p-plain')).queryByTestId('reset-unavailable-reason')).toBeNull()
  })

  it('still maps 409 target-is-org-admin on the reset link (a stale row)', async () => {
    vi.mocked(issuePasswordResetLink).mockRejectedValue(
      new OrgPeopleError('x', { status: 409, code: 'target-is-org-admin' }))
    renderPage()
    await screen.findByTestId('org-people-table')
    fireEvent.click(screen.getByRole('button', { name: 'Copy password-reset link for Pat Plain' }))
    fireEvent.click(screen.getByTestId('person-action-confirm'))
    await waitFor(() =>
      expect(screen.getByTestId('person-action-error').textContent).toContain('another organization admin'))
    expect(screen.queryByTestId('reset-link')).toBeNull()
    expect(screen.getByTestId('org-people-action-status').textContent).toBe('')
  })

  it('warns that removing your own org admin signs you out of the organization view', async () => {
    const { stubbedSession } = await import('@/core/auth/rolePermissions.testUtils')
    const selfId = stubbedSession()?.personId
    expect(selfId).toBeTruthy()
    const self = person({ id: selfId as string, displayName: 'Sam Self', orgRole: 'orgAdmin' })
    vi.mocked(listOrgPeople).mockResolvedValue(page([self, ADMIN]))
    renderPage()
    await screen.findByTestId('org-people-table')
    fireEvent.click(screen.getByRole('button', { name: 'Remove org admin from Sam Self' }))
    expect(screen.getByTestId('person-action-self-note').textContent)
      .toBe('You will be signed out of the organization view.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByTestId('person-action-dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Remove org admin from Ada Admin' }))
    expect(screen.queryByTestId('person-action-self-note')).toBeNull()
  })

  it('maps a 404 to the person-gone message', async () => {
    vi.mocked(updateOrgPerson).mockRejectedValue(new OrgPeopleError('x', { status: 404 }))
    renderPage()
    await screen.findByTestId('org-people-table')
    fireEvent.click(screen.getByRole('button', { name: 'Disable Pat Plain' }))
    fireEvent.click(screen.getByTestId('person-action-confirm'))
    await waitFor(() =>
      expect(screen.getByTestId('person-action-error').textContent).toContain('no longer in your organization'))
  })
})
