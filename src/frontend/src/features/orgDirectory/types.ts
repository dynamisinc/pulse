/**
 * features/orgDirectory/types.ts
 * ---------------------------------------------------------------------------
 * Wire/domain types for the org people directory (identity-auth-roles story 19, #574).
 * Mirrors `Pulse.WebApi/Features/Org/PeopleDirectory/OrgPeopleDtos.cs` verbatim.
 * STAFF world. Instants are SERVER WALL-CLOCK admin metadata (COR-053 binds only participant UI).
 */

/** One live enrollment line of a person (exercise name + role, lead marker). */
export interface OrgPersonEnrollment {
  readonly exerciseId: string
  readonly exerciseName: string
  readonly role: string
  readonly isLead: boolean
}

/** One person of the caller's organization. Carries no credential material. */
export interface OrgPerson {
  readonly id: string
  readonly displayName: string
  readonly email: string | null
  readonly orgRole: 'orgAdmin' | null
  readonly disabled: boolean
  readonly disabledAt: string | null
  /** Non-null only while a lockout is active NOW. */
  readonly lockedOutUntil: string | null
  readonly enrollments: readonly OrgPersonEnrollment[]
}

/** One page of the directory. */
export interface OrgPeoplePage {
  readonly items: readonly OrgPerson[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

/** Query for the list. `search` is trimmed by the caller; the server bounds it to 200 chars. */
export interface OrgPeopleQuery {
  readonly search: string
  readonly page: number
  readonly pageSize: number
}

/** PATCH body: exactly one member. */
export type OrgPersonPatch = { readonly isOrgAdmin: boolean } | { readonly disabled: boolean }
