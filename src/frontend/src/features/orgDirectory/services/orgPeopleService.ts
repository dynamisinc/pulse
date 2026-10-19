/**
 * features/orgDirectory/services/orgPeopleService.ts
 * ---------------------------------------------------------------------------
 * Data seam for the org people directory (identity-auth-roles story 19, #574). Live calls only
 * through the shared axios client (the backend slice exists; no mock flip point is needed).
 *
 *   GET   /api/org/people?search=&page=&pageSize=   -> { items, page, pageSize, total }
 *         400 { error: 'invalid-paging' | 'search-too-long' }
 *   PATCH /api/org/people/{id}  { isOrgAdmin } | { disabled }  -> OrgPerson
 *         400 invalid-request; 404 bare; 409 last-org-admin | cannot-disable-self
 *   POST  /api/org/people/{id}/password-reset (#576)           -> { resetUrl }
 *         404 bare; 409 target-is-org-admin | person-disabled; 503 reset-link-unavailable
 *
 * Every route is org-admin only; the tenant is the caller's own, resolved server-side (never sent).
 * The reset link is a one-time credential: it is returned to the caller, never logged, stored or
 * put in an error message. STAFF world, no UI.
 */

import axios from 'axios'
import { api } from '@/core/services/api'
import type { OrgPeoplePage, OrgPeopleQuery, OrgPerson, OrgPersonPatch } from '../types'

const PEOPLE_ENDPOINT = '/org/people'

/** Transport-agnostic failure: HTTP `status` (undefined = no response) + server `code`. */
export class OrgPeopleError extends Error {
  readonly status?: number
  readonly code?: string

  constructor(message: string, init: { status?: number; code?: string } = {}) {
    super(message)
    this.name = 'OrgPeopleError'
    this.status = init.status
    this.code = init.code
  }
}

function readCode(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const code = (data as Record<string, unknown>).error
  return typeof code === 'string' && code.length > 0 ? code : undefined
}

function toError(error: unknown, what: string): OrgPeopleError {
  if (axios.isAxiosError(error)) {
    return new OrgPeopleError(`${what} failed`, {
      status: error.response?.status,
      code: readCode(error.response?.data),
    })
  }
  return new OrgPeopleError(`${what} failed`)
}

function personEndpoint(personId: string): string {
  return `${PEOPLE_ENDPOINT}/${encodeURIComponent(personId)}`
}

/** Lists one page of the caller's organization's people. */
export async function listOrgPeople(query: OrgPeopleQuery): Promise<OrgPeoplePage> {
  try {
    const params: Record<string, string | number> = { page: query.page, pageSize: query.pageSize }
    if (query.search.length > 0) params.search = query.search
    const response = await api.get<OrgPeoplePage>(PEOPLE_ENDPOINT, { params })
    return response.data
  } catch (error) {
    throw toError(error, 'Listing people')
  }
}

/** Grants/revokes org admin or disables/enables one person. Returns the updated person. */
export async function updateOrgPerson(personId: string, patch: OrgPersonPatch): Promise<OrgPerson> {
  try {
    const response = await api.patch<OrgPerson>(personEndpoint(personId), patch)
    return response.data
  } catch (error) {
    throw toError(error, 'Updating the person')
  }
}

/** Issues a one-time password-reset link for a person (copy-link flow; email is off). */
export async function issuePasswordResetLink(personId: string): Promise<string> {
  try {
    const response = await api.post<{ resetUrl: string }>(`${personEndpoint(personId)}/password-reset`)
    return response.data.resetUrl
  } catch (error) {
    throw toError(error, 'Issuing the reset link')
  }
}
