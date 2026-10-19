# Story: Go-live readiness dashboard

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-042 (COR-009, NFR-002)  ·  **Design decisions:** none  ·  **Issue:** #73

## Context
A go-live checklist aggregating world completeness: personas seeded, channels themed, scheduled content
counts by channel, participant accounts provisioned, shared credential set, hostname active + network
readiness verified (COR-009), compliance chrome configured, load rehearsal done (NFR-002) — with
per-item status (COR-042).

## Acceptance Criteria
- [ ] ~~The dashboard aggregates readiness items with per-item status: personas seeded, channels themed, scheduled-content counts by channel, accounts provisioned, shared credential set, hostname active + network readiness (COR-009), compliance chrome configured, load rehearsal done (NFR-002).~~ **Superseded by the §5.3 checklist** (Scope update + Currency check below). COR-009 network readiness and NFR-002 load rehearsal are DEFERRED (see note).
- [ ] Item status is conveyed by label/icon, not color alone (NFR-001).
- [ ] The dashboard is exercise-scoped, staff-only (XC-002), and reflects live state as build progresses.
- [ ] Incomplete critical items are visible so a ~~Director~~ planner/controller can judge go-live readiness (story 04).

### Orchestrator review fold (2026-10-16, ADMIN-IDENTITY-MODEL §5.3)
- [ ] Warning, not blocking: **no lead controller**. Swamped mode and autonomy raises are unavailable until a planner sets a lead.

## Out of Scope
The go-live action itself (story 04); the underlying items' own features (network readiness
exercise-isolation/09, provisioning identity-auth-roles, etc.) — this story aggregates their status.

## Technical Notes
Staff world (COBRA). Reads status from each contributing subsystem. See implementation.md (story 03).

## Dependencies
Stories 01/02; exercise-isolation/09 (network readiness); identity-auth-roles (provisioning, shared
cred); persona-management (seeding); exercise-configuration (chrome). Gates story 04.

## Tests
- Component: the dashboard reflects each item's status; incomplete items surface (not color-only).

## Scope update 2026-10-16 (ADMIN-IDENTITY-MODEL)

Source: [`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §5.3, §5.4a, §3.4, §8.4 (Tier-2 signed off by Tom, 2026-10-16). Wave A3. The readiness checklist (§5.3) is now defined; stage is refused with 409 and the list while any **blocking** item is open.
- [ ] **Blocking items:** (1) at least one controller enrollment; (2) a participant-facing name is set (story 09; *not evaluable until PR-4*); (3) at least one participant `Account`, or the view-only code is enabled; (4) every participant account is bound to a persona; (5) at least one participant sign-in method is on, if participant accounts exist (identity 22; *not evaluable yet, see Currency check*); (6) time zone and scenario start time set; (7) chrome and watermark valid (`ComplianceChromeGuard`); (8) no run-sheet item is `needs-repair` (§5.4a).
- [ ] **Warnings (shown, not blocking):** no run sheet items; no opening feed; empty noise pool; personas missing avatars; participants with no sign-in issued yet; no evaluator enrolled.
- [ ] Each item has a label and icon (never color-only), links to the fixing screen, and is exercise-scoped and planner/controller/evaluator-readable.
- [ ] ~~Foreign-exercise and foreign-org readiness reads return the bare 404.~~ Readiness is session-scoped (no exercise id in the route), so a foreign exercise is unreachable by construction; org-scope sessions are refused (see Currency check).
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` is updated in the same PR, or the PR states "no guide impact".

## Currency check 2026-10-19 (post-A1, Session D)

Audit of main after A1. Slice plan: **PR-2 = this story**, PR-3 = story 04, PR-4 = A3 migration + story 09, PR-5 = story 01. Nothing readiness-related exists on main (no endpoint, no `ParticipantName`, no `SignInMethods`, no `needs-repair`).

**Endpoint and wiring**
- [ ] `GET /api/staff/readiness`: readable by planner, controller, evaluator; participant, view-only and org-scope sessions are refused. Exercise comes from the session, so a foreign exercise is unreachable.
- [ ] Wired through the existing ExerciseLifecycle feature extensions (`AddExerciseLifecycle` / `MapExerciseLifecycleEndpoints`); **no `Program.cs` change**.
- [ ] Response: `{ ready: boolean, blocking: Item[], warnings: Item[] }`, `Item = { id, label, status: 'ok'|'open'|'notChecked', detail?, fixRoute? }`; `id` is a stable kebab key. This is a new contract, not a frozen shared type. `ready` = no blocking item is `open`.

**Blocking item rules (as evaluable on main)**
1. At least one controller enrollment.
2. Participant-facing name: shown as "Not checked yet - arrives with story 09", status `notChecked`, does not block in PR-2. PR-4 (story 09 adds `Exercises.ParticipantName`) flips it to blocking.
3. At least one participant `Account` or an enabled `SharedCredential` (view-only code = `SharedCredential.IsEnabled`).
4. Every participant account's enrollment has a `PersonaId` (`Enrollment.PersonaId`).
5. Sign-in methods: shown as "Not checked yet - needs identity-auth-roles 22 (SignInMethods)", `notChecked`, non-blocking until 22 lands.
6. Schedule: "set" = `ScheduledStartAt` non-null AND `TimeZone` is a valid IANA zone id (`UTC` counts as set; `TimeZone` is non-null, default `UTC`).
7. `ComplianceChromeGuard` passes.
8. Count of inject items with status `needs-repair` is 0. Blocking, but always 0 until story 07 introduces the status; the check reads the literal, and widening the inject vocabulary is story 07's frozen-type change.

**Warnings (non-blocking):** no run-sheet items; no opening feed (no posts visible at scenario start); empty noise pool; personas missing avatars; participants with no sign-in issued yet (no `ParticipantLink` / no password for an account); no evaluator enrolled; **no lead controller** (`Enrollment.IsLead`).

**Frontend (staff, COBRA)**
- [ ] A "Readiness" section in the `/staff/plan` workspace. Each item has label + icon + status words (never color-only), a link to the fixing screen where one exists, and refetches as build progresses (React Query refetch on focus and after saves). `notChecked` renders distinctly from `ok`/`open`.

**Tests**
- xUnit service test per item; role-matrix rows for `GET /api/staff/readiness`; cross-exercise isolation test (two exercises; A's readiness never counts B's rows); RTL component tests (not color-only; `notChecked` rendering).

**Deferred (later phase):** COR-009 network readiness and NFR-002 load rehearsal. No backing data and not in the signed-off §5.3 checklist; revisit when exercise-isolation/09 and a rehearsal mechanism exist.

**Dependencies (updated):** identity-auth-roles 17 role matrix; ExerciseLifecycle feature; story 09 (item 2) and identity 22 (item 5) arrive later and flip those items.
