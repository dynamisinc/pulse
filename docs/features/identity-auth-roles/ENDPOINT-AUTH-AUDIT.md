# Endpoint authentication audit — evidence + scope of work

> **Superseded by the four-story split + inventory corrections (2026-07-25, same day).** The
> single story this document scoped (`11-api-session-enforcement.md`, #361) is now **four** stories per
> the one-story-per-file convention — do not re-derive the scope-of-work waves below as three sub-waves
> of one story; they are now:
> - **[`11-api-session-enforcement.md`](11-api-session-enforcement.md)** (#361) — Wave 1: the gate + allowlist + hub.
> - **[`12-post-attribution-server-side.md`](12-post-attribution-server-side.md)** (#366) — Wave 2a: `POST /api/posts` attribution.
> - **[`13-telemetry-exercise-scope-authority.md`](13-telemetry-exercise-scope-authority.md)** (#362, retitled) — Wave 2b: `POST /api/telemetry` scope authority.
> - **[`14-anonymous-access-regression-suite.md`](14-anonymous-access-regression-suite.md)** (#367) — Wave 3: the regression suite.
>
> **Two inventory corrections, validated against a live `EndpointDataSource` dump from a real
> `WebApplicationFactory<Program>` host** (the cross-check this audit's own "Limits" section asked for):
> - **The route count is 40, not 38.** The delta: `/hubs/exercise` and `/hubs/exercise/negotiate` are two
>   endpoints (SignalR expands the hub route — this audit's static grep counted the hub once), and
>   `POST /api/ops/bind-participant-persona` landed with story 10 (PR #364) after this audit ran. The
>   rest of the static inventory below is otherwise exactly right.
> - **The allowlist is 11 routes, not 8.** The three secret-gated `/api/ops/*` endpoints
>   (`bootstrap-exercise`, `seed-engine-content`, `bind-participant-persona`) must be added: this audit
>   classified them "correctly gated" (below) because their own secret check answers 404, but the
>   default-deny mechanism story 11 picked (`AuthorizationMiddleware`'s `FallbackPolicy`) runs **before**
>   that secret check ever executes — so a legitimate, secret-bearing, session-less bootstrap call
>   (which by definition runs against an empty database with no session to present) would 401 before
>   reaching the gate that was supposed to authorize it. See story 11's own file for the full reasoning.
>
> This document is otherwise left as originally written — it is evidence, not a living spec. Do not edit
> the sections below to match the four-story split; read them through this note.
>
> **Purpose.** The definitive in/out list that story `11-api-session-enforcement.md` (#361) builds its
> allowlist from, plus a scoped plan a dedicated fix session can start from without re-deriving anything.
> This is **evidence**, not requirements — the ACs live in the story.
>
> **Audited:** 2026-07-25 · **Against:** `app-pulse-api-uat-dynamis.azurewebsites.net` (the disposable UAT
> sandbox) · **Findings:** #359 (participant surface), #362 (telemetry) · **Story:** #361

## Method

1. **Static inventory** — every `MapGet/MapPost/MapPut/MapPatch/MapDelete/MapMethods/MapHub` call plus
   attribute-routed controllers (`[Route]`) and health endpoints across `src/Pulse.WebApi/`. **38 routes.**
2. **Probed each** against the deployed sandbox with **no `Authorization` header and no cookie**, using the
   correct verb.
3. **Non-destructive technique for writes:** POST an empty `{}` body. A **400** proves validation ran, i.e.
   *auth did not gate the request*; a **401/403/404** proves it did. Where a 400 was ambiguous (shape
   validated before the auth check) the route was re-probed with a well-formed body.
4. **Confirmed exploits** only where the finding required it, and only in the sandbox.

## Result: 12 of 38 routes are open to an unauthenticated caller

### ❌ OPEN — no credential required (12)

| Route | Verb | Probe | Notes |
|---|---|---|---|
| `/api/feed` | GET | **200** | the participant feed |
| `/api/personas` | GET | **200** | full roster incl. every persona `id` — the ids used by the write below |
| `/api/threads/{postId}` | GET | **200** | |
| `/api/shell-state` | GET | **200** | |
| `/api/chrome-config` | GET | **200** | |
| `/api/brand-tokens` | GET | **200** | |
| `/api/channel-nav-config` | GET | **200** | |
| `/api/alerts` | GET | **200** | |
| `/api/overlay-state` | GET | **200** | |
| `/api/posts` | POST | 400 on `{}` → **201 CONFIRMED** | **write.** Post injected as any persona, attacker-chosen `origin` + `scenarioTime`, blank `actingHumanId` |
| `/api/telemetry` | POST | 400 on `{}` → **202 CONFIRMED** | **write.** Arbitrary `exerciseId` accepted incl. one that does not exist; forged actor identity |
| `/hubs/exercise` | WS | **CONFIRMED** | **live stream.** Negotiate → handshake accepted → joined group → received a `PostReceived` frame |

### ✅ CORRECTLY GATED (18)

| Route(s) | Probe | Gate mechanism |
|---|---|---|
| `/api/session` | 401 | session required |
| `/api/staff/assignments` | 401 | `ICurrentStaffSessionAccessor` |
| `/api/staff/accounts` | 401 | " |
| `/api/staff/accounts/import` | 401 (multipart) | " — a bare `{}` gives 415, so probe with multipart |
| `/api/staff/active-exercise` | 401 | " — **note:** `{}` gives 400 because GUID shape is validated *before* the auth check. Not a hole; re-probed with a valid GUID → 401 |
| `/api/staff/shared-credential/rotate` · `/revoke` | 401 | " |
| `/api/engine/review-queue` | 401 | `EngineCockpitStaffAuthorizationFilter` |
| `/api/engine/review/batch-approve` | 401 | " |
| `/api/engine/review/{draftId}/approve` | 401 | " |
| `/api/engine/review/{draftId}/edit` · `/re-roll` · `/veto` | *inferred* | same `MapGroup` filter (`EngineReviewEndpoints.cs:74`) — **not individually probed** |
| `/api/engine/autonomy/kill-switch` · `/restore` · `/swamped-mode` | 401 | " |
| `/api/ops/bootstrap-exercise` · `/seed-engine-content` | 404 | `X-Bootstrap-Secret` — fails closed, reveals nothing |

### 🟡 INTENTIONALLY PRE-AUTH — the allowlist (8)

| Route | Verb | Why |
|---|---|---|
| `/api/exercise-context` | GET | `exercise-isolation/08` — the login pages need scope before a session exists. **Correct.** |
| `/api/auth/login` · `/auth/staff/login` · `/auth/shared` | POST | they *establish* the session; each fails closed with anti-enumeration 401s |
| `/api/auth/refresh` | POST | self-gating — the refresh token *is* the credential (401 without one) |
| `/api/auth/logout` | POST | returns **204** with no session. Harmless (nothing to invalidate) but see Wave 1 note |
| `/health` · `/health/ready` | GET | liveness probes |

## Confirmed exploit evidence

| # | What | Proof |
|---|---|---|
| 1 | Post injection | `POST /api/posts` → **201**, post `1b5c5160-…` as persona `mvega_fh`, `origin: engine`, `scenarioTime` 2033, `actingHumanId: ""` |
| 2 | Telemetry forgery | `POST /api/telemetry` → **202** twice: once for the real exercise, once for `deadbeef-0000-4000-8000-000000000001` (**nonexistent** — so there is no FK constraint on `TelemetryEvent.ExerciseId`) with `actor.kind: participant` + forged `actingHumanId` |
| 3 | Live stream read | negotiate 200 → WS handshake `{}` accepted (not aborted) → frame `{"type":1,"target":"PostReceived",…}` delivered to a client with no credential |

## Root cause — one mechanism, not twelve bugs

Endpoints gate on **exercise-scope resolution**, not on a session:

```csharp
if (exerciseContext.CurrentExerciseId is null) return Results.Unauthorized();
```

`ExerciseResolutionMiddleware` documents its precedence deliberately —
`authenticated session > host resolution (anonymous / pre-auth participant) > unset (fail-closed floor)` —
because `/api/exercise-context` and the login endpoints genuinely must work before a session exists. **The
flaw is that a mechanism needed for 8 pre-auth routes became the default scope for all 38**, and since every
endpoint asks only "is scope resolved?", each one silently inherited anonymous access.

`CurrentExerciseId is null` answers *"whose data is this?"* — the COR-001 isolation question, which this
codebase handles unusually well. It does **not** answer *"may this caller have any data?"* The two look
identical at the call site.

`ExerciseRealtimeHub.OnConnectedAsync` has the same shape: it joins `exercise:{hostResolvedExerciseId}` from
`Context.GetHttpContext()`, server-authoritatively (correct for isolation) and with no session check.

**Why nothing caught it:** the SPA always attaches a bearer token, and **every existing test authenticates
first**. Neither production use nor CI ever walked the anonymous path. The frontend was the security boundary.

## Scope of work

### Wave 1 — the gate (closes all 12 at once)

| Item | Detail |
|---|---|
| Files | `Program.cs` (composition root, orchestrator-owned); the new gate component; `Features/Realtime/RealtimeExtensions.cs` (hub) |
| Change | Default-deny baseline + the 8-route allowlist above. **Not** per-endpoint opt-in — that is precisely what failed. |
| Hub | The hub needs the *same* gate. `OnConnectedAsync` must require a live session in addition to a resolved scope, and abort otherwise (it already has an abort path for empty scope — extend it). |
| Decision needed | **Two viable approaches; pick deliberately.** (a) Promote `SessionAuthenticationMiddleware` to populate `HttpContext.User`, then use ASP.NET's native `FallbackPolicy` + `[AllowAnonymous]`. (b) An `IEndpointFilter` + `MapGroup` wrapper mirroring the existing `DenyReadOnlySessions` / `EngineCockpitStaffAuthorizationFilter` idiom. **(b) is lower-risk and more consistent with the codebase; (a) is more idiomatic ASP.NET and gets SignalR integration for free.** The hub requirement is a real argument for (a). |
| Also | `POST /api/auth/logout` returning 204 with no session — decide 401 vs harmless no-op, and write down which. |
| Telemetry | XC-004 event on rejected unauthenticated attempts, consistent with how the login endpoints already emit failures. |
| Effort | M. Serial — touches `Program.cs`, so it cannot fan out with other work. |

### Wave 2 — server-side attribution (#359 write + #362)

| Item | Detail |
|---|---|
| Files | `Features/Social/PostWriteEndpoints.cs`, `PostIngestService.cs`, `Telemetry/TelemetryController.cs` |
| `POST /api/posts` | Derive `authorPersonaId`, `origin`, `actingHumanId` **from the session**, never the body. A participant session may post only as its own bound persona; `engine` / `controller-as-persona` / `inject` must be unreachable from a participant session. |
| `POST /api/telemetry` | Stamp `exerciseId` server-side from the session (or host scope for allowlisted pre-auth emitters); reject a body-supplied value. Mirrors how `BootstrapService` already refuses a client-supplied scope. |
| Blocker to resolve first | `AuthenticatedSession` carries **no** `PersonaId`/`ActingHumanId` today — only `SessionId`/`ExerciseId`/`Kind`/`StaffUserId`. Needs a session-identity read; follow the existing `CurrentStaffSessionAccessor` / `ReadOnlySessionProbe` pattern rather than inventing a third mechanism. Worth considering consolidating the now 3+ parallel session-lookup seams. |
| Open question | **Legitimately pre-auth emitters.** A login-failure telemetry event has no session by definition. Decide explicitly rather than discovering it mid-build. |
| Consider | An FK on `TelemetryEvent.ExerciseId` (finding 2 proved none exists), and whether existing orphan rows need a cleanup. Separate migration; audit before constraining. |
| Effort | M. Depends on Wave 1. |

### Wave 3 — the regression suite (the highest-leverage item)

| Item | Detail |
|---|---|
| The test | **Every non-allowlisted route returns 401 with no credential presented.** |
| Critical design point | Enumerate routes from the live `EndpointDataSource` (as `CompositionRootWiringTests` already does) so a **newly added endpoint is covered automatically** without anyone writing a new test. A hand-maintained list would rot and reproduce this class of bug. |
| Plus | A hub test: an unauthenticated connection is aborted and joins no group. Plus an attribution test: a participant session cannot post as another persona or with a non-participant `origin`. |
| Why it matters most | This is the test #60's AC needed and never got. It converts an invisible class of defect into a caught one. |
| Effort | S–M. |

### Sequencing and gating

- Wave 1 → Wave 2 → Wave 3, in order. Wave 1 alone closes the exposure; 2 and 3 make it correct and permanent.
- **Recommend gating any production deployment on Waves 1–3.** No production environment exists today (only
  `app-pulse-api-uat-dynamis`; no prod hostname resolves), so this can be fixed before any exposure — which
  is the entire reason it is manageable.
- Review tier **Tier-2** throughout (auth surface + the isolation seam).

### Explicitly NOT in scope

- The staff (`/api/staff/*`) and engine (`/api/engine/*`) surfaces — they already fail closed by their own
  means. They must keep behaving identically under the new wrapper; do not rewrite them.
- The secret-gated ops endpoints — correct by design. **Do not "fix" them.**
- `#322` (same-origin topology).
- `EngineCockpitStaffAuthorizationFilter` — leave it. Read it as the in-repo precedent for Wave 1.

## Limits of this audit

- Route inventory is **static** (grep of mapping calls + controllers + hub + health). A route registered
  dynamically or by a convention I did not grep would be missed. Wave 3's `EndpointDataSource` enumeration is
  the authoritative cross-check and should be run early to validate this list.
- `/api/engine/review/{draftId}/edit`, `/re-roll`, `/veto` were **not individually probed** — inferred from
  the shared `MapGroup` filter with `approve` and `batch-approve`, both of which returned 401.
- Probes establish the **response status** for an anonymous caller. They do not establish which endpoints leak
  *cross-exercise* data; the COR-001 isolation guarantee is separately and well tested.
- Only the deployed UAT configuration was probed. A different environment's config could differ.

## Sandbox test artifacts to remove

No delete endpoint exists for either type (`posts/05-soft-delete-tombstones` is not built), so removal needs
SQL or a re-seed. All are labelled in their text/payload.

| Type | Identifier |
|---|---|
| Post | `1b5c5160-603f-4bcb-a2f8-d64db4d3da13` |
| Post (hub probe) | `90715b05-9f73-4af6-9a1e-f6e683a851c5` |
| Telemetry event | `11111111-1111-1111-1111-111111111111` |
| Telemetry event (orphan exercise) | `22222222-2222-2222-2222-222222222222` |
