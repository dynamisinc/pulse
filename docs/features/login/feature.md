# Feature: Login & UAT go-live

**Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Feature ref:** cross-cutting
completion of F1.2 (COR-011/012/014/015) for a **live backend**  ·  **World:** both (see per-story)
**Issue:** #303

## A naming note (read before anything else)

Three already-**Complete** `identity-auth-roles` stories (02, 03, 06) and the `app-shell` routing glue
(`SignInFallback.tsx`, `routes.tsx`, `constants.ts`) all point at "**the login story, COR-030**" as the
place this remaining work would land. **That pointer is a misnomer already baked into the merged
codebase.** The epic's actual `COR-030` (`docs/01-platform-core-isolation.md` F1.4) is *"Per-exercise
settings: name, participant-visible world name/locale, time zone, schedule, enabled channels, theming,
compliance chrome config"* — it belongs to the **`exercise-configuration`** feature, is unrelated to
sign-in, and is not touched here. This feature is what those comments actually meant. It is filed under
its real requirements (COR-011, COR-012, COR-014, COR-015) instead. **Flagged for the user, not silently
fixed:** the stale `(COR-030)` comments in `identity-auth-roles/02-*.md`, `03-*.md`, `06-*.md`, and the
`app-shell` routing files should be corrected to point here once this feature exists — see the
`identity-auth-roles`/`app-shell` doc edits made alongside this feature and the frontend-code comment
follow-up noted in story 04.

## Summary

`identity-auth-roles` (E1/F1.2) already shipped a real, tested, reviewed **backend**: participant login
(`POST /api/auth/login`), staff login (`POST /api/auth/staff/login`), shared read-only login
(`POST /api/auth/shared`), and the session hinge (`GET /api/session`, refresh, logout) — stories 02, 03,
05, 06 are all **Complete**. What never got built is everything needed to actually *drive* that backend
from a deployed browser: the frontend never attaches a token to a request, there is no login form of any
kind (only a static, temporary `SignInFallback` placeholder), and the UAT environment has an empty
database, an empty staff allowlist, and defaults to `ASPNETCORE_ENVIRONMENT=Production` with no override.
The result: UAT still runs on `VITE_USE_MOCK_DATA=true` because turning it off produces a blank screen.

This feature closes that loop: frontend session/token plumbing (01), a participant sign-in surface (02),
a staff sign-in surface (03), the routing + logout integration that replaces the placeholder (04), a
guarded one-time bootstrap seam so a fresh environment's database isn't a chicken-and-egg problem (05),
and the UAT deployment config + runbook to flip the switch for real (06).

## Requirements covered

COR-011 (named participant account login), COR-012 (session binding — completes the deferred frontend
half of `identity-auth-roles/03`), COR-014 (staff login against the hybrid identity provider), COR-015
(shared read-only login). COR-008 (per-exercise hostname) is consumed, not built, by story 03's design
(see its Context) and by story 05 (the seeded exercise's `Hostname`). NFR-009 (abuse resistance / secrets
handling) applies to stories 01, 05, 06. XC-004 telemetry for every login/logout/refresh event is already
emitted **server-side** by the Complete backend stories — this feature triggers those calls, it does not
duplicate their telemetry.

**Not covered (explicitly out of scope, flagged above):** the epic's real COR-030 (per-exercise settings
screen, `exercise-configuration`); `identity-auth-roles/08` (participant admin panel) and `/09`
(org-account operation), both deferred; a friendlier multi-exercise picker for staff login (see story 03
Context) — Phase-1 ships the host-derived single-exercise case.

## Design references

No dedicated design brief exists for a login surface (`docs/design/` has none). Governing constraints
are pulled from `docs/design/D0-FOUNDATIONS.md` §2 (the two-worlds rule — a login surface is exactly the
kind of thing that quietly blurs them if not deliberate) and the existing, merged `app-shell`
architecture (`RoleAwareEntry.tsx`, `routes.tsx`) this feature must slot into without rearchitecting it.
`docs/00-MASTER-PRD.md` §4 pilot-mode framing (login lands on the Social feed pre-Portal) applies to
story 02's post-login redirect. No `STORY-UPDATES.md` amendment applies (no design-review pass has
touched auth).

## Stories

| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Frontend session & token wiring (live flip) | COR-012 | Complete (PR #311, merged) | #304 |
| 02 | Participant sign-in (named account + shared read-only code) | COR-011, COR-015 | In Review (PR #313) | #305 |
| 03 | Staff sign-in | COR-014 | In Review (PR #314) | #306 |
| 04 | Wire real login routes + logout (replaces `SignInFallback`) | COR-004, COR-005 (consumed) | Complete (PR #316, merged) | #307 |
| 05 | UAT bootstrap seam (guarded one-time seed endpoint) | COR-008, COR-011, COR-014, COR-015 (enablement) | Complete (PR #310 + wiring fix #317, merged) | #308 |
| 06 | UAT go-live config & runbook (allowlist, environment, mock-data flip) | NFR-009 | Not Started | #309 |

## Dependencies

**Already satisfied (Complete, do not rebuild):** `identity-auth-roles/02` (`POST /api/auth/login`),
`/03` (session hinge — `GET /api/session`, `POST /api/auth/refresh`, `POST /api/auth/logout`), `/05`
(`POST /api/auth/staff/login`, `GET /api/staff/assignments`, `POST /api/staff/active-exercise`), `/06`
(`POST /api/auth/shared`); `exercise-isolation/08` (host → exercise resolution, `GET /api/exercise-context`).
This feature is a **pure consumer** of all of those contracts — no story here edits `Pulse.WebApi`'s
existing identity slice, except story 05, which **adds** a new, narrowly-scoped slice alongside it.

**Internal:** 02 and 03 depend on 01 (the token store they persist into); 04 depends on 02 + 03 (the
pages it routes to); 06 depends on 04 (frontend) and 05 (backend) both being merged/deployable.

## Design notes

**Two worlds, in one route table.** Today's UAT deployment is a single hostname serving both audiences
(no per-exercise subdomain yet on the frontend side), and the existing `RoleAwareEntry` sends **every**
fail-closed case — participant or staff, expired or unresolved — to the same `LOGIN_PATH` (`/login`).
Rather than rearchitect that, this feature keeps `/login` as a **world-neutral** landing that hosts the
participant sign-in form directly (the majority-audience default) plus one clearly separated link to a
genuinely COBRA-styled `/staff/login` route for the minority staff audience — never COBRA on `/login`,
never a brand skin on `/staff/login` (D0 §2). See story 04 Context for the exact reasoning.

**The chicken-and-egg problem.** No endpoint in the Complete backend can create the *first* `Exercise`,
`StaffAssignment`, or `SharedCredential` row — `POST /api/staff/accounts` et al. all require an
**already-authenticated staff session with an active exercise**, and nothing bootstraps that from an
empty database. Story 05 is a new, narrowly-scoped, secret-gated backend seam to solve exactly that,
modeled on the same "documented Phase-1 stand-in, fails closed when unconfigured" pattern already used
for `DynamisIdentityProviderOptions` (the staff allowlist) — not a general-purpose admin API.

**Everything here is Phase-1, pilot-mode framing.** Per Master §4, pre-Portal, login lands on the Social
feed (COR-011/015's default landing is already built by `app-shell/01`/`exercise-isolation/04` — this
feature does not touch that routing decision, only what happens *before* it can run).
