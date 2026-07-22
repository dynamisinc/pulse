/**
 * features/staff/types.ts
 * ---------------------------------------------------------------------------
 * Public domain types for the STAFF-world staff feature (feature:
 * exercise-isolation, story 05 — staff cross-exercise switcher; COR-005).
 *
 * `StaffAssignment` mirrors the FROZEN backend `StaffAssignmentDto` shape
 * (`src/Pulse.WebApi/Features/Identity/Staff/StaffAssignmentDto.cs`) built in
 * identity-auth-roles/05: one of a staff user's roles on one exercise
 * (`{ exerciseId, exerciseName, role }`). It is the response shape of BOTH
 * `GET /api/staff/assignments` (a list) and `POST /api/staff/active-exercise`
 * (a single confirmed assignment). The transport wire body is validated at the
 * service boundary (`services/staffAssignmentsService.ts`) before it is ever
 * surfaced as one of these, so a live backend swap fails closed on a
 * malformed body rather than casting garbage into this shape.
 *
 * `role` reuses the shared `ExerciseRole` vocabulary (`@/core/auth/roles`)
 * rather than a locally-invented string type — `StaffAssignmentDto.Role` is
 * documented server-side as "the `ExerciseRole` string vocabulary (verbatim)".
 *
 * World: STAFF (COBRA). `StaffAssignment` is an ACCESS RECORD (exercise id +
 * name + role) — never participant-visible content (XC-002) — and is exempt
 * from the participant scenario-time rule (COR-053): it carries no
 * participant-visible timestamps.
 */

import type { ExerciseRole } from '@/core/auth'

/**
 * One of the authenticated staff user's assignments: a role on one exercise.
 * `StaffAssignment` is the ONLY cross-exercise object in the Pulse data model
 * (COR-005) — reading a LIST of these (via `GET /api/staff/assignments`) is
 * therefore a deliberate, staff-only, own-only exception to the otherwise
 * universal single-exercise scoping rule (COR-001).
 */
export interface StaffAssignment {
  readonly exerciseId: string
  readonly exerciseName: string
  readonly role: ExerciseRole
}
