# Feature: Identity, auth & roles

**Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Feature ref:** F1.2
**World:** platform/foundation  ·  **Issue:** #39

## Summary
Who can do what, and how they get in: the role set, exercise-provisioned named accounts for active
participants, the shared read-only credential for the "hundred passive participants," the hybrid
identity model (federated staff, Pulse-native participants), and post-as-organization with per-human
attribution. Identity providers stay behind an interface — Entra/SSO is a future direction.

## Requirements covered
COR-010, COR-011, COR-012, COR-013, COR-014, COR-015, COR-016, COR-017, COR-018 (with NFR-009 abuse
resistance and XC-004 attribution).

**COR-018 is split across two stories.** Story 10 delivers the **provisioning-time, single-persona,
ops-endpoint** half of story 09's first AC (Complete, #342) — relocated in from `login/07` (see
Dependencies below). Story 09 still owns the rest: multi-persona grants, the live staff-console action
path, per-human attribution behind a shared handle, concurrent multi-human operation, and the
participant-facing switcher (Not Started, #66) — see story 09's own boundary note.

## Design references
Master §3 scope decision 6 (hybrid identity), decision 6/COR-011 (no fake-signup theater). D0
non-negotiables (staff vs participant worlds).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Role set (Participant/PIO/Controller/Evaluator/Planner/OrgAdmin) | COR-010 | In Progress | #58 |
| 02 | Named participant accounts (provisioned, no self-signup) | COR-011 | Complete | #59 |
| 03 | Short-lived exercise-bound sessions | COR-012 | Complete | #60 |
| 04 | Evaluator read-everything, write-nothing | COR-013 | Not Started | #61 |
| 05 | Hybrid identity model behind a provider interface | COR-014 | Complete | #62 |
| 06 | Shared read-only access (view-only session) | COR-015 | Complete | #63 |
| 07 | Shared-credential lifecycle (rotate/revoke/lockout) | COR-016 | Complete | #64 |
| 08 | Participant admin panel (login triage) | COR-017 | Not Started | #65 |
| 09 | Organization-account operation (post-as-org, attribution) | COR-018 | Not Started | #66 |
| 10 | Participant persona binding (provision a participant account with a posting persona) | COR-018, SOC-001, SOC-003 (consumed), COR-011 | Complete | #342 |
| 11 | Default-deny session enforcement across the API surface | COR-012 (+COR-001, COR-015, COR-018, NFR-009) | Not Started | #361 |

## Dependencies

**Story 10 (#342) was relocated in from `login/07`.** It was built and Tier-2 reviewed under the
`login` feature because the gap surfaced during that feature's UAT rollout, but its requirements
(COR-018, SOC-001/SOC-003) belong here, not to `login`'s sign-in scope (COR-011/012/014/015). It extends
`login/05`'s bootstrap slice in place (additive edit, not a fork) and is a downstream consumer of that
feature's seam — see `docs/features/login/feature.md`'s note and story 10's own "Why this story lives
here" section for the full trail in both directions.

Exercise-isolation (session→exercise scoping, COR-001/008); telemetry (XC-004) for attribution. The
identity provider stays behind an interface (COR-014).

**The Organization tenant tier (`exercise-isolation/11`) — deferred to multi-customer go-live.** The customer
`Organization` that *owns* named accounts (story 02) and staff/`StaffAssignment` (story 05) is
designed-but-deferred — built in a dedicated wave gated on multi-customer go-live (Option B,
`exercise-isolation/11-organization-tenant-boundary.md`). B2 scopes accounts to an **exercise**
and staff to **exercises** (via `StaffAssignment`), not to a customer org — sufficient for participant
isolation, but staff/planner access is not customer-scoped until story 11 lands. This is the platform tenant,
**distinct** from story 09's in-fiction org-account (COR-018).

**Phase B2 backend build (`docs/BACKEND_ROADMAP.md` §4) — builds on B0.** The `Pulse.WebApi` host,
`PulseDbContext`, the `IExerciseContext`/`ExerciseContext` scope seam, `AddExerciseScoping`, and the
`Features/*` minimal-API endpoint pattern all landed in **Phase B0** (`backend-host`, merged). B2 adds the
real identity tier on top: stories **03** (session hinge — `/session`, refresh, binding, scope
population; `fullstack`, flips `sessionResolver`), **02** (named accounts + import + participant login;
`fullstack`), **05** (`IIdentityProvider` + `StaffUser`/`StaffAssignment` + staff login + active-exercise;
`backend`, **Tier-2**), **06** (shared read-only credential + view-only session; `backend`, **Tier-2**), and **07**
(shared-credential lifecycle; `backend`, **Tier-2**). New B2 scoped entities (`Account`,
`SharedCredential`) **extend** `PulseDbContext` via the create-then-extend pattern — they do not stand up
a second context. **`StaffUser`/`StaffAssignment` are deliberately NOT `IExerciseScoped`** (cross-exercise
by design, COR-005 — see implementation.md). Stories **01** (roles) and **04** (evaluator read-only) keep
their prior scope; stories **08** (participant admin, COR-017) and **09** (org-account, COR-018) are
**deferred out of the B2 slice**.

**Story 11 — the unbuilt half of COR-012 (#359).** Story 03 built the session *model*
(issuance/refresh/`GET /api/session`); it never enforced that a live session is *required* before
any other endpoint honors a request — every endpoint gated only on "is a scope resolved," which
`ExerciseResolutionMiddleware`'s anonymous host resolution (`exercise-isolation/08`) satisfies for
free. Confirmed live against UAT: `GET /api/personas`, `GET /api/feed`, and `POST /api/posts` all
succeeded with zero credentials presented. Story 11 adds the missing default-deny gate at the
composition root; see its own file for the full analysis and the correction it adds to story 03's
AC record.

## Design notes
Foundation, spanning staff and participant worlds. Read-only sessions still get an ephemeral identity
so telemetry can count views/reach without per-user provisioning (COR-015). The shared credential is
an internet-facing secret and is treated as such (COR-016/NFR-009). Fake sign-up UI is omitted
normatively — phishing-pattern optics on a government training site (COR-011).
