/**
 * features/exerciseLifecycleAdmin/types.ts
 * ---------------------------------------------------------------------------
 * The typed vocabulary of the ORG-TIER exercise administration surface
 * (feature: exercise-lifecycle-admin, stories 01/02/03 — COR-074/075/076).
 *
 * ## What "org tier" means here, and why it is not the exercise tier
 * Every `/api/staff/*` read in this app is scoped to the ONE server-resolved
 * exercise. These types describe the tier ABOVE that: the caller's CUSTOMER
 * TENANT, which spans exercises. Nothing in this module carries an
 * organization id — the tenant is always the caller's own, resolved
 * server-side, so there is no field for a client to put someone else's in
 * (XC-002 / COR-001). The backend enforces the same absence structurally
 * (`OrganizationIsNotWireVisibleTests`); this file simply must not reintroduce
 * it.
 *
 * World: STAFF (COBRA). Pure type module — no UI, no theme, no network.
 */

/**
 * One exercise row on the org-administration surface — the mirror of the
 * backend's `OrgExerciseDto` (COR-075), field-for-field.
 *
 * `status` is the RAW wire literal, deliberately NOT narrowed to
 * {@link ExerciseStatus} here. The backend canonicalizes a legacy spelling onto
 * its COR-032 equivalent but emits an unrecognised value VERBATIM, precisely so
 * the client can refuse to claim a state it does not understand. Narrowing at
 * this boundary would force one of two bad options: cast blindly (render a
 * fabricated status to a staff human) or reject the whole response (one unknown
 * literal blanks the organization's entire portfolio — the failure mode
 * `core/exerciseContext/exerciseContextResolver.ts`'s own header warns about
 * for split deploys). Instead the narrowing happens PER ROW, at render time, in
 * `components/ExerciseStatusBadge.tsx` — a row whose status is unrecognised
 * renders as explicitly unrecognised, never as a guessed state.
 */
export interface OrgExercise {
  /** The exercise's id (lowercase GUID string). */
  readonly exerciseId: string
  /** The staff-facing internal name, already sanitized server-side (NFR-004). */
  readonly name: string
  /** The COR-032 lifecycle literal, canonicalized — or an unrecognised value, verbatim. */
  readonly status: string
  /** The provisioned host (COR-008), or `undefined` for an exercise with none. */
  readonly hostname?: string
  /** ISO-8601 creation instant, or `undefined` for a row that predates the column. */
  readonly createdAt?: string
}

/**
 * The `POST /api/org/exercises` success body (COR-074): the new exercise plus
 * the role of the `StaffAssignment` the server minted for its creator, so they
 * can reach the run through the exercise switcher with no extra provisioning.
 */
export interface CreateExerciseResult {
  readonly exercise: OrgExercise
  /** The creator's own role — `planner` or `orgAdmin`. */
  readonly assignedRole: string
}

/**
 * What the creation form submits. Both fields are optional on the wire
 * (`CreateExerciseRequest`) so a missing one is a server-side 400 rather than a
 * deserialization failure; `name` is required in practice and the form refuses
 * to submit without it.
 *
 * There is deliberately NO `organizationId`, NO `status` and NO `exerciseId`:
 * the tenant is the caller's own, the lifecycle state is always `build`
 * (COR-032), and the id is server-generated.
 */
export interface CreateExerciseInput {
  readonly name: string
  /** An optional proposed host. Omitted/blank → the server allocates one. */
  readonly hostname?: string
}
