/**
 * features/orgDirectory/hooks/useOrgPeople.ts
 * ---------------------------------------------------------------------------
 * React Query hooks for the org people directory (story 19, #574): the paged/searchable list and
 * the three actions. Every mutation settles by invalidating the whole `['org','people']` family, so
 * the table refetches after success AND after a 409/404 (the row on screen is then stale). STAFF
 * world; pure data hooks.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  issuePasswordResetLink,
  listOrgPeople,
  updateOrgPerson,
  type OrgPeopleError,
} from '../services/orgPeopleService'
import type { OrgPeoplePage, OrgPeopleQuery, OrgPerson, OrgPersonPatch } from '../types'

/** Prefix of every directory query; invalidating it refetches the visible page. */
export const ORG_PEOPLE_QUERY_KEY = ['org', 'people'] as const

/** One page of the directory; the previous page stays on screen while the next loads. */
export function useOrgPeople(query: OrgPeopleQuery): UseQueryResult<OrgPeoplePage, OrgPeopleError> {
  return useQuery<OrgPeoplePage, OrgPeopleError>({
    queryKey: [...ORG_PEOPLE_QUERY_KEY, query.search, query.page, query.pageSize],
    queryFn: () => listOrgPeople(query),
    placeholderData: keepPreviousData,
  })
}

/** PATCH one person (grant/revoke org admin, disable/enable). */
export function useUpdateOrgPerson(): UseMutationResult<
  OrgPerson,
  OrgPeopleError,
  { personId: string; patch: OrgPersonPatch }
> {
  const queryClient = useQueryClient()
  return useMutation<OrgPerson, OrgPeopleError, { personId: string; patch: OrgPersonPatch }>({
    mutationFn: ({ personId, patch }) => updateOrgPerson(personId, patch),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ORG_PEOPLE_QUERY_KEY }),
  })
}

/**
 * Issues a reset link. Resolves to the one-time URL. `gcTime: 0` so the link is dropped from the
 * mutation cache as soon as the dialog that shows it unmounts, instead of lingering for the default
 * five minutes (the link is a bearer credential, shown once).
 */
export function useIssuePasswordReset(): UseMutationResult<string, OrgPeopleError, string> {
  return useMutation<string, OrgPeopleError, string>({
    mutationFn: (personId: string) => issuePasswordResetLink(personId),
    gcTime: 0,
  })
}
