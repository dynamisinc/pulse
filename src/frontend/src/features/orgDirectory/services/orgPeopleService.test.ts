/** orgPeopleService: wire shape of the three calls and error mapping (story 19, #574). */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError } from 'axios'
import { api } from '@/core/services/api'
import {
  inviteExistingOrgPerson,
  inviteOrgPerson,
  issuePasswordResetLink,
  listOrgPeople,
  OrgPeopleError,
  updateOrgPerson,
} from './orgPeopleService'

vi.mock('@/core/services/api', () => ({ api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }))

beforeEach(() => vi.resetAllMocks())

describe('orgPeopleService', () => {
  it('lists with paging params and omits an empty search', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { items: [], page: 2, pageSize: 25, total: 0 } })
    await listOrgPeople({ search: '', page: 2, pageSize: 25 })
    expect(api.get).toHaveBeenCalledWith('/org/people', { params: { page: 2, pageSize: 25 } })
    await listOrgPeople({ search: 'ada', page: 1, pageSize: 25 })
    expect(api.get).toHaveBeenLastCalledWith('/org/people', { params: { page: 1, pageSize: 25, search: 'ada' } })
  })

  it('patches exactly the given body at the encoded id', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: {} })
    await updateOrgPerson('a/b', { disabled: true })
    expect(api.patch).toHaveBeenCalledWith('/org/people/a%2Fb', { disabled: true })
  })

  it('returns the reset url', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { resetUrl: 'https://x/staff/reset#token=t' } })
    expect(await issuePasswordResetLink('p1')).toBe('https://x/staff/reset#token=t')
    expect(api.post).toHaveBeenCalledWith('/org/people/p1/password-reset')
  })

  it('wraps non-axios failures without leaking detail', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('boom'))
    await expect(listOrgPeople({ search: '', page: 1, pageSize: 25 })).rejects.toBeInstanceOf(OrgPeopleError)
  })

  it('invites with email and displayName and returns the link result', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { personId: 'p9', inviteUrl: 'https://x/staff/invite#token=t', emailed: false, created: true },
    })
    const result = await inviteOrgPerson({ email: 'a@b.org', displayName: 'Ann' })
    expect(api.post).toHaveBeenCalledWith('/org/people/invite', { email: 'a@b.org', displayName: 'Ann' })
    expect(result).toEqual({
      personId: 'p9', inviteUrl: 'https://x/staff/invite#token=t', emailed: false, created: true,
    })
  })

  it('invites an existing person at the encoded id with the email only (#849)', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { personId: 'a/b', inviteUrl: 'https://x/staff/invite#token=t', emailed: false, created: false },
    })
    const result = await inviteExistingOrgPerson({ personId: 'a/b', email: 'a@b.org' })
    expect(api.post).toHaveBeenCalledWith('/org/people/a%2Fb/invite', { email: 'a@b.org' })
    expect(result).toEqual({
      personId: 'a/b', inviteUrl: 'https://x/staff/invite#token=t', emailed: false, created: false,
    })
  })

  it('accepts inviteUrl null on the by-id route only (email-only once a mailer exists)', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { personId: 'p', inviteUrl: null, emailed: true, created: false },
    })
    expect(await inviteExistingOrgPerson({ personId: 'p', email: 'a@b.org' })).toEqual({
      personId: 'p', inviteUrl: null, emailed: true, created: false,
    })
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { personId: 'p', inviteUrl: null, emailed: true, created: true },
    })
    await expect(inviteOrgPerson({ email: 'a@b.org', displayName: 'Ann' })).rejects.toBeInstanceOf(OrgPeopleError)
  })

  it('carries status and code on a by-id invite failure and rejects a body without a link', async () => {
    const error = new AxiosError('x')
    error.response = { status: 409, data: { error: 'email-in-use' } } as never
    vi.mocked(api.post).mockRejectedValueOnce(error)
    const caught = await inviteExistingOrgPerson({ personId: 'p', email: 'a@b.org' }).catch((e: unknown) => e)
    expect(caught).toBeInstanceOf(OrgPeopleError)
    expect((caught as OrgPeopleError).status).toBe(409)
    expect((caught as OrgPeopleError).code).toBe('email-in-use')
    vi.mocked(api.post).mockResolvedValueOnce({ data: { personId: 'p' } })
    await expect(inviteExistingOrgPerson({ personId: 'p', email: 'a@b.org' })).rejects.toBeInstanceOf(OrgPeopleError)
  })

  it('carries status and code on an invite failure and rejects a body without a link', async () => {
    const error = new AxiosError('x')
    error.response = { status: 409, data: { error: 'already-active' } } as never
    vi.mocked(api.post).mockRejectedValueOnce(error)
    const caught = await inviteOrgPerson({ email: 'a@b.org', displayName: 'Ann' }).catch((e: unknown) => e)
    expect(caught).toBeInstanceOf(OrgPeopleError)
    expect((caught as OrgPeopleError).status).toBe(409)
    expect((caught as OrgPeopleError).code).toBe('already-active')
    vi.mocked(api.post).mockResolvedValueOnce({ data: { personId: 'p' } })
    await expect(inviteOrgPerson({ email: 'a@b.org', displayName: 'Ann' })).rejects.toBeInstanceOf(OrgPeopleError)
  })
})
