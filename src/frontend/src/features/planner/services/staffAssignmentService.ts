/**
 * features/planner/services/staffAssignmentService.ts
 * ---------------------------------------------------------------------------
 * The data seam for the planner Staff section (story 20, #575a). STAFF world; shared axios `api`.
 *
 * Routes (relative to the `/api` base): list/grant `org/exercises/{id}/enrollments`; change role
 * and remove `staff/enrollments/{id}`; make lead `staff/enrollments/{id}/lead`. Every failure is
 * translated into a {@link StaffAssignmentError} carrying the HTTP status and the server's
 * machine code (`last-planner`, `conflicting-enrollment`, ...), which `staffErrors.ts` maps to
 * words. The list body is validated fail-closed. No mock adapter: the backend is built.
 */

import axios from 'axios'
import { api } from '@/core/services/api'
import { STAFF_ROLES, type StaffRole, type StaffRoster } from '../types/staff'

/** A failed staff-assignment call: status plus the server's `{ error }` code, if any. */
export class StaffAssignmentError extends Error {
  readonly status?: number
  readonly code?: string

  constructor(message: string, status?: number, code?: string, cause?: unknown) {
    super(message)
    this.name = 'StaffAssignmentError'
    this.status = status
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

function toError(error: unknown): StaffAssignmentError {
  if (axios.isAxiosError(error)) {
    const data: unknown = error.response?.data
    const code =
      typeof data === 'object' && data !== null && 'error' in data
        && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : undefined
    return new StaffAssignmentError(error.message, error.response?.status, code, error)
  }
  return new StaffAssignmentError(
    error instanceof Error ? error.message : 'The staff request failed.',
    undefined,
    undefined,
    error,
  )
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isNullableString = (v: unknown): boolean => v === null || typeof v === 'string'

function isRole(v: unknown): v is StaffRole {
  return typeof v === 'string' && (STAFF_ROLES as readonly string[]).includes(v)
}

function isRoster(v: unknown): v is StaffRoster {
  if (!isRecord(v) || typeof v.exerciseId !== 'string') return false
  if (!Array.isArray(v.enrollments) || !Array.isArray(v.candidates)) return false
  const enrollmentsOk = v.enrollments.every(
    (e: unknown) =>
      isRecord(e) && typeof e.id === 'string' && typeof e.personId === 'string'
      && typeof e.displayName === 'string' && isNullableString(e.email) && isRole(e.role)
      && typeof e.isLead === 'boolean',
  )
  const candidatesOk = v.candidates.every(
    (c: unknown) =>
      isRecord(c) && typeof c.personId === 'string' && typeof c.displayName === 'string'
      && isNullableString(c.email),
  )
  return enrollmentsOk && candidatesOk
}

/** Reads the exercise's staff and the org people who could be added. */
export async function getStaffRoster(exerciseId: string): Promise<StaffRoster> {
  let data: unknown
  try {
    data = (await api.get<unknown>(`/org/exercises/${encodeURIComponent(exerciseId)}/enrollments`))
      .data
  } catch (error) {
    throw toError(error)
  }
  if (!isRoster(data)) throw new StaffAssignmentError('The staff response was malformed.')
  return data
}

/** Grants `personId` a staff `role` in the exercise. */
export async function grantStaffRole(
  exerciseId: string,
  personId: string,
  role: StaffRole,
): Promise<void> {
  try {
    await api.post(`/org/exercises/${encodeURIComponent(exerciseId)}/enrollments`, {
      personId,
      role,
    })
  } catch (error) {
    throw toError(error)
  }
}

/** Changes an enrollment's role. */
export async function changeStaffRole(enrollmentId: string, role: StaffRole): Promise<void> {
  try {
    await api.patch(`/staff/enrollments/${encodeURIComponent(enrollmentId)}`, { role })
  } catch (error) {
    throw toError(error)
  }
}

/** Removes an enrollment. */
export async function removeStaff(enrollmentId: string): Promise<void> {
  try {
    await api.delete(`/staff/enrollments/${encodeURIComponent(enrollmentId)}`)
  } catch (error) {
    throw toError(error)
  }
}

/** Makes the enrollment (a controller) the exercise's lead. */
export async function makeStaffLead(enrollmentId: string): Promise<void> {
  try {
    await api.put(`/staff/enrollments/${encodeURIComponent(enrollmentId)}/lead`)
  } catch (error) {
    throw toError(error)
  }
}
