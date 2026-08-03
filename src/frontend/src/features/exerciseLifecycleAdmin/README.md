# `features/exerciseLifecycleAdmin` — org-tier exercise administration

**World:** STAFF (COBRA). **Epic:** E1. **Stories:** `docs/features/exercise-lifecycle-admin/`
(`01-exercise-creation`, `02-exercise-list-management`, `03-orgadmin-surface-family`).
**Requirements:** COR-074, COR-075, COR-076.

This is the surface that closed the original gap: **before it, nothing in the UI could create or
manage an exercise.** The only thing that made an `Exercise` row was `POST /api/ops/bootstrap-
exercise`, a deployment-secret-gated seam whose own doc comment says it must not be reachable in a
customer-facing deployment.

## The tier — read this before adding an endpoint

Every other staff read in the app is `/api/staff/*` and is scoped to the ONE server-resolved
exercise. These are `/api/org/*` and span the caller's **customer tenant**:

| Route | Who | This feature |
|---|---|---|
| `POST /api/org/exercises` | `planner` or `orgAdmin` | `createOrgExercise()` |
| `GET /api/org/exercises` | `planner` or `orgAdmin` | `getOrgExercises()` |
| `GET /api/org/staff-assignments` | `orgAdmin` **alone** | **not consumed yet** — see below |

**No org route takes a route or query parameter, and no body carries an organization id.** That is
deliberate: the tenant is always the caller's own, resolved server-side, so there is no IDOR surface
on the org axis at all. Do not add `/api/org/exercises/{id}`; the backend asserts its absence
structurally.

## Layout

```
ExerciseManagementRoute.tsx   the /staff/exercises route element (StaffShellFrame + page)
pages/ExerciseManagementPage  work-area content: heading, create form, list; the 4 read states
components/CreateExerciseForm self-contained; owns the 409 recovery
components/OrgExerciseTable   a real <table>: name / status / hostname / created
components/ExerciseStatusBadge icon + word + colour — never colour alone (NFR-001)
hooks/useOrgExercises         React Query read;  key ['org','exercises']
hooks/useCreateExercise       React Query write; invalidates that key on success
services/orgExercisesService  the ONE mock/live flip point + wire validation
types.ts                      OrgExercise / CreateExerciseInput / CreateExerciseResult
```

## Three decisions worth not re-deriving

1. **The 409 is a field error, not a toast.** Hostname uniqueness is global and enforced by the
   database, so "that host is taken" arrives *after* a well-formed submission. The form keeps every
   character the user typed, attaches the message to the hostname field, and moves focus there. A
   toast would evaporate and the natural "clear on settle" implementation would throw the input
   away. A blank hostname cannot 409 (the server allocates one), so recovery is always available.
2. **An unrecognised `status` fails closed per ROW, not per response.** The backend emits an
   unknown lifecycle literal verbatim precisely so the client can refuse it — but refusing the whole
   response would let one odd row blank the organization's entire portfolio on a backend-ahead
   deploy, the exact failure `core/exerciseContext/exerciseContextResolver.ts` warns about. The row
   renders "Unrecognised status (`<literal>`)" with a warning icon instead.
3. **The mock is stateful.** `createOrgExercise` really appends to the mock store, and the mock
   enforces the same 400 (blank name) and 409 (duplicate hostname) the server does. A read-only mock
   would make `POST` a silent no-op that still returned 201 — the mock/live divergence class this
   repo keeps shipping. Mocks are gated through `core/config/mockData`'s `USE_MOCK_DATA`; there is
   no second flag.

## Not built here (deliberate)

- **Row actions** (open settings / duplicate / readiness dashboard) — story 02's row-action AC is
  struck through as not built; every destination is a later story and the org tier exposes no by-id
  route to hang them off. `exerciseId` is on every row already.
- **The org-scoped staff-assignment view** (`GET /api/org/staff-assignments`, story 03 AC2's second
  half). The endpoint exists and is the only one gated on `orgAdmin` alone; no surface consumes it
  yet. **Flagged, not forgotten** — it is what would give `orgAdmin` a second destination and light
  its own launcher.
- **Client telemetry.** Creation's audit event is emitted server-side inside the same unit of work
  as the write. A client emit would double-count and could report a creation the server refused.

## Routing

Registered as ONE entry in `@/features/staff/staffRouteRegistry` (`id: 'exercise-management'`,
`path: '/staff/exercises'`, `group: 'administer'`, `allowedRoles: ['planner', 'orgAdmin']` — which
mirrors the server's `ExerciseAdministrators` gate exactly). `isDefaultFor: ['orgAdmin']`: this is
the org-admin's home page, and the first surface `orgAdmin` has ever had (before COR-076,
`RoleAwareEntry` fail-closed every org-admin session to `/login`).
