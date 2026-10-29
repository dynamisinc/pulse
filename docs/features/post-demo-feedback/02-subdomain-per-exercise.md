# Story: Subdomain per exercise on an environment (PDF-11)

**Feature:** Post-demo customer feedback  ·  **Epic:** E1  ·  **Phase:** 2  ·  **Status:** Not Started
**Requirements:** COR-008 (finishes its unticked provisioning AC), COR-001/XC-001 (isolation), COR-005  ·  **Design decisions:** PDF-D6 (Tom, 10/21)  ·  **Issue:** #679
**Stack:** fullstack + infra  ·  **World:** both (participant entry + staff switcher)  ·  **Review:** Tier-2 (scope-resolution seam; always-Critical isolation)  ·  **Priority:** Must  ·  **Effort:** L

## Context
10/20 demo: the customer liked `exercise-a.<env-host>` and it needs to be built. Source: Tom's demo notes.

**What exists today.** `exercise-isolation/08` (Complete) built the application half: `UseExerciseResolution()` maps the
`Host` header to an `Exercise` (subdomain or branded domain), sets `IExerciseContext`/`ExerciseContext.CurrentExerciseId`,
fails closed on an unknown host, lets an authenticated session override host scope, and returns 401/403 when a participant
session's exercise differs from the host's. **Its provisioning AC is unticked**: there is no wildcard cert, no DNS
automation, no lead-time SLA, and no infra for per-exercise hostnames. The load test (01 build notes) shows the cost:
binding one extra host on UAT is manual (CNAME, `asuid` TXT, `az webapp config hostname add`, managed cert), and an
exercise cannot change its host name after creation. UAT serves one host, bound to the demo exercise.

This story makes the subdomain the normal way an exercise is addressed, with no manual infra step per exercise.

## Acceptance Criteria
- [ ] Given an environment with a configured base domain, when a controller creates an exercise with slug `exercise-a`,
      then `exercise-a.<env-host>` resolves to that exercise with no manual DNS or certificate step (wildcard DNS record
      and wildcard certificate for `*.<env-host>`, provisioned through **Azure Front Door**; one cert, not one binding per exercise).
- [ ] Given a wildcard cert and DNS in place, when an exercise is created, then the host name is validated (DNS-label
      rules, reserved names blocked such as `www`, `api`, `staff`, `admin`; unique per environment) and stored on
      `Exercise.Hostname`; the host lifecycle is decided (Tom, 10/21): kept while the exercise is
      archived, freed when it is deleted, and a rename keeps the old host as an alias that still resolves to the same exercise.
- [ ] Given a request on an unknown or deleted exercise subdomain, when it reaches the API, then scope stays unset
      (fail closed, zero rows; an archived exercise's host still resolves and keeps its existing archived behavior) and the participant sees a neutral "exercise not found" page with no exercise list and no
      platform branding (COR-004, COR-008).
- [ ] Given a participant who joins through a personal link or day-word sign-in (easy-login `03`/`05`/`08`/`09`) on
      `exercise-a.<env-host>`, when the join call is made, then it scopes to exercise A from the host, and a link or session
      from exercise B presented on A's host is a uniform 401/403 (existing behavior, now covered by a host-based test).
- [ ] Given a participant link or QR card (easy-login `04`/`12`) is generated, when it is rendered, then it carries the
      exercise's subdomain URL, not a shared host.
- [ ] Given a staff user on the console, when they use the exercise switcher (`exercise-isolation/05`, app-shell `01`),
      then switching still scopes by server-side active exercise and the staff host is a non-exercise host; the switcher
      offers a link to the exercise's participant subdomain but never navigates staff into a participant view.
- [ ] **Isolation (XC-001/002):** the standing isolation suite (`exercise-isolation/07`) gains subdomain cases: A-subdomain
      session on B-subdomain returns 403; spoofed `Host`/`X-Forwarded-Host` yields zero rows; SignalR group join uses the
      host-resolved exercise (the load-test finding, 01 build notes) and rejects a cross-host connection.
- [ ] **Content security (NFR-004):** host validation is exact and case-normalized; no Host-header value is reflected in a
      redirect or rendered value; CORS and token origins accept only the environment's base domain and its subdomains.

## Out of Scope
Customer-branded custom domains beyond what 08 already supports (their cert automation is a follow-up); changing an
exercise's slug after creation beyond the rename-with-alias rule; multi-region DNS; the Cadence connection (PDF-06).

## Technical Notes
Backend: reuse `Features/ExerciseResolution/` and `IExerciseContext`; do not add a second resolver. Infra: wildcard cert
and DNS through **Azure Front Door** (decided, Tom 10/21; App Service managed certs do not issue wildcards). Alias hosts
need a small alias table checked by the resolver. Frontend: the API base URL must follow the page origin (today
`VITE_API_URL` is fixed), or the API must be served from each subdomain; this is the main open design point. See
`implementation.md`, Decision PDF-D6 (decided).

## Dependencies
`exercise-isolation/08` (landed), `login`, `easy-login`, `app-shell/01`. Coordinates with the PDF-03 backup site (can sit behind the same Front Door) and `exercise-isolation/09` (network readiness: customer networks must allow the wildcard).
