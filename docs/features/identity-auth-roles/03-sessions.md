# Story: Short-lived exercise-bound sessions

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** COR-012  ·  **Design decisions:** none  ·  **Issue:** #60
**Stack:** fullstack  ·  **Review:** Tier-1 (session↔scope binding rides the Tier-2 isolation seam it consumes)

## Context
Sessions are short-lived with refresh; a participant session is bound to **one exercise and one
account** (or one read-only session per COR-015) (COR-012). This keeps the session's exercise scope
unambiguous — the anchor the isolation guarantee (COR-001) relies on.

**Seed delivered (Social E2 prerequisite):** `core/auth/{session.tsx,sessionResolver.ts}` landed as a
minimal mock seed so the Social (E2) build has a session/identity to attribute posts to — it is **not**
a build of this story's full ACs. Delivered: a fail-closed, mock-behind-the-axios-client
`SessionProvider`/`useSession()` that resolves a short-lived session carrying exercise + account scope,
with expiry. Tests: `core/auth/session.test.tsx`, `core/auth/sessionResolver.test.ts`,
`core/auth/sessionResolver.default.test.ts`. Remaining before this story can flip to Complete: a real
session provider backed by an actual refresh mechanism/token lifecycle (today's "refresh" is mock
behavior only) and the .NET backend session endpoint — neither exists yet.

**Phase B2 backend build (`docs/BACKEND_ROADMAP.md` §4) — the hinge story.** This story builds the real
session tier and **flips the frozen `sessionResolver` seam live**: the session model + issuance +
short-lived-token/refresh lifecycle, the auth scheme, the `GET /api/session` endpoint returning the
frozen `Session` shape, and the **session → exercise → account binding**. It **sets
`ExerciseContext.CurrentExerciseId` from the authenticated session** — the session arm of the shared
scope seam, with **precedence over raw host resolution** (story 08). It is the hinge every other B2
login method calls to mint a session (story 02 participant, story 05 staff, story 06 shared read-only).

## Acceptance Criteria
- [ ] Authenticated sessions are short-lived with a refresh mechanism; expiry forces re-auth.
- [ ] A participant session is bound to exactly one exercise and one account (or one read-only session,
      story 06); the session carries the exercise scope used by central filtering (exercise-isolation
      story 01).
- [ ] Session tokens do not leak secrets to the browser beyond what's required; refresh is handled
      securely.

### Backend — session issuance, lifecycle, binding, scope population (COR-012)
- [ ] A session model + issuance mechanism exists: a session is created on a successful login (issued by
      whichever login method authenticated — story 02 / 05 / 06 call this), short-lived, with a refresh
      path; the auth scheme (cookie or token) is chosen and documented, and the browser never receives
      more than the session reference/refresh material required.
- [ ] `GET /api/session` returns the **frozen `Session` shape** field-for-field —
      `{ exerciseId, accountId, role, personaId?, actingHumanId, isReadOnly, expiresAt }` — for exactly
      one bound session; it accommodates all three login kinds (participant named account; staff, where
      `exerciseId` = the active-exercise selection and `personaId` is absent; read-only shared, where
      `isReadOnly` is true and `accountId`/`actingHumanId` are the ephemeral identity).
- [ ] The session **binds session ↔ exercise ↔ account**: the exercise comes from the host-resolved
      exercise (story 08) for participants / the active-exercise selection (story 05) for staff; the
      account is the authenticated principal. A refresh preserves the binding; it never re-scopes to a
      different exercise or account.
- [ ] **Scope population + precedence:** for an authenticated request, this story **sets
      `ExerciseContext.CurrentExerciseId` from the session's bound exercise**, taking precedence over the
      host middleware's earlier write (story 08 defines the ordering: `UseExerciseResolution()` first,
      then the auth/session layer). For a participant, the session's exercise must equal the host's
      resolved exercise or the request fails closed (401/403).
- [ ] Expiry forces re-auth: a request with an expired/absent session resolves **no** scope (fail-closed
      — zero rows), and `GET /api/session` returns 401 rather than a default/stale session.
- [ ] `POST /api/auth/refresh` (short-lived → renewed) and `POST /api/auth/logout` (invalidate the
      session) exist; logout invalidates server-side so a stolen reference cannot be replayed.

### Cross-cutting
- [ ] **Isolation (XC-001/COR-001):** the session is the authenticated anchor of the exercise scope; a
      session for exercise A can never yield exercise B rows, and an expired/absent session yields zero
      rows (never all exercises). Extends the standing suite (`exercise-isolation/07`) with a
      session-scope case.
- [ ] **Telemetry (XC-004):** session **issue** (on login), **refresh**, **expiry-forcing-re-auth**, and
      **logout** each emit an XC-004 event against the locked v0 envelope (wall + scenario time, actor,
      channel). Event types `login` / `logout` (known vocab) + `session.refreshed` / `session.expired`
      (open vocab, additive). Actor per session kind: participant → `actor.kind: 'participant'`,
      `participantId` = accountId, `channel: 'system'`; staff → `actor.kind: 'system'` + role +
      actingHumanId; read-only → `actor.kind: 'system'`, `actor.sessionId` = the ephemeral identity (no named
      account). (Per-method login
      success/failure is emitted at the login endpoints, stories 02/05/06 — this story owns the
      session-lifecycle events.) Scenario time uses the exercise's stored scenario time until the
      COR-050 backend clock (B3) lands.
- [ ] **Content security (NFR-004 / NFR-009):** the session/refresh endpoints are per-IP rate-limited;
      tokens are signed/opaque; no session material is logged.
- [ ] **Frozen-seam flip (fullstack):** flipping `sessionResolver`'s single `USE_MOCK_SESSION` point to
      live makes `GET /api/session` drive `useSession()` with **no consumer change** — the response
      matches `Session` field-for-field. Orchestrator-owned integration edit (implementation.md
      Integration seam).

## Out of Scope
The shared-credential lifecycle (story 07); the identity provider integration + staff login endpoint
(story 05); the participant login endpoint (story 02); the shared read-only login (story 06);
force-logout by controllers (story 08, deferred); host → exercise resolution itself + `/exercise-context`
(exercise-isolation story 08); the backend native scenario clock (COR-050, Phase B3) — session telemetry
uses the exercise's stored scenario time as a documented B2 placeholder until then.

## Technical Notes
Foundation + backend (spans both worlds via the single `Session` shape). Owns
`src/Pulse.WebApi/Features/Identity/Sessions/` (or `Auth/`): the session model, `SessionEndpoints`
(`GET /api/session`, `POST /api/auth/refresh`, `POST /api/auth/logout`), the issuance service the login
methods call, `AddSessions()`, and the auth-scheme registration (orchestrator wires it + the auth
middleware ordering in `Program.cs`, **after** `UseExerciseResolution()`). Writes the B0
`ExerciseContext.CurrentExerciseId` seam from the session (precedence over host). Frontend: the frozen
`session.tsx`/`sessionResolver.ts` stay untouched at the module level; only `USE_MOCK_SESSION` flips.
See implementation.md (story 03) + the Integration seam.

## Dependencies
`backend-host/02-persistence-efcore` + `AddExerciseScoping` (Phase B0, landed). Story 01 (roles).
exercise-isolation story 08 (host resolution + the scope seam + precedence ordering) — the participant
exercise binding comes from it. Consumed by stories 02/05/06 (they mint sessions through this) and every
authenticated request; `app-shell/01` consumes the live `useSession()`.

## Tests
- Integration: a session is bound to one exercise/account; refresh preserves the binding; expiry forces
  re-auth (401, zero-row scope).
- Integration: an authenticated session's exercise overrides host resolution (precedence); a participant
  session presented on the wrong host fails closed.
- Contract: `GET /api/session` returns the frozen `Session` shape for participant, staff, and read-only
  kinds.
- Integration: session issue/refresh/expiry/logout emit the expected XC-004 events.
