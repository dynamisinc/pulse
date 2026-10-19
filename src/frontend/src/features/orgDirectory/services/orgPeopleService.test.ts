/** orgPeopleService: wire shape of the three calls and error mapping (story 19, #574). */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { issuePasswordResetLink, listOrgPeople, OrgPeopleError, updateOrgPerson } from './orgPeopleService'

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
})
