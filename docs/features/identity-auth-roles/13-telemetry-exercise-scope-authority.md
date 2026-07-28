# Story: `POST /api/telemetry` server-stamps `exerciseId` from session scope

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** XC-004 (with COR-001 implicated)  ·  **Design decisions:** none  ·  **Issue:** #362
**Stack:** backend  ·  **Review:** Tier-2 (auth surface + the isolation seam — always-Critical class)

> **Split from [`11-api-session-enforcement.md`](11-api-session-enforcement.md) (#361), Wave 2** — a
> different file (`Telemetry/TelemetryController.cs`, not `Features/Social/*`) and a genuinely distinct
> open question (below) from story 12's `POST /api/posts` attribution, which is why it is kept as its own
> story rather than folded in. Previously tracked standalone as **#362**; retitled and rescoped here.

## Context
`TelemetryController`'s own doc comment (`Telemetry/TelemetryController.cs:18-19`) records this as
a known, explicit carve-out: *"Out of scope (by story): per-session/hostname authority of the
`exerciseId` claim."* The controller accepts `exerciseId` **as a string traveling in the client's
event envelope** (`:94-100`) and persists it verbatim after only a `Guid.TryParse`/non-empty
check — no comparison against any server-resolved scope.

**Confirmed exploit (audit finding #2), against the sandbox, no credential:** two `POST
/api/telemetry` calls both returned **202** — one naming the exercise's real id, and one naming
`deadbeef-0000-4000-8000-000000000001`, an exercise **that does not exist**, with a forged
`actor.kind: 'participant'` and a forged `actingHumanId`. Because there is **no FK constraint on
`TelemetryEvent.ExerciseId`**, the orphan row is storable, not merely rejected-but-logged.

**Why it matters more than it looks.** XC-004 is not incidental telemetry — it is Pulse's
evaluation record. Per COR-018 it is the mechanism that attributes actions to individual humans
behind shared org handles, and AAR/evaluator scoring reads it directly. An untrusted write path
into it means fabricated evaluation data, cross-exercise pollution (the exact COR-001 property the
rest of the codebase — `IExerciseScoped` + the central query filter — defends carefully), and
diluted audit value everywhere a story leans on telemetry as the durable, harder-to-tamper record
(e.g. `identity-auth-roles/10` records `participantPersonaId` on its event specifically because
table columns are mutable and telemetry was assumed trustworthy).

### Decided this session — the open question is answered, do not re-open

**There are no legitimately pre-auth telemetry emitters.** Verified this session:
- The only `POST /api/telemetry` caller in the frontend is `core/telemetry/mockSink.ts:66`.
- `src/frontend/src/features/login/**` contains **zero** telemetry references.
- All login-outcome telemetry (`ParticipantLoginService`'s `BuildLoginTelemetry`/
  `FailureOutcomePayload`) is emitted **server-side, in-process** — never over HTTP, so a
  login-failure event (the textbook "no session by definition" case) never touches this endpoint
  at all.

So `POST /api/telemetry` gets **no pre-auth carve-out**: it is fully session-gated (via story 11's
`FallbackPolicy` — see Dependencies), and `exerciseId` is stamped from the resolved session scope,
full stop. **If a genuinely pre-auth emitter is ever needed in the future, it gets its own,
explicitly allowlisted route with its own server-stamped scope — never a reopened,
body-supplied `exerciseId` on this endpoint.**

**Also decided: reject, never silently overwrite.** A client-supplied `exerciseId` that disagrees
with the session's own scope is **rejected with 400**, not silently replaced with the correct one.
A caller whose body disagrees with its own session is either a bug worth surfacing to the client or
an attempted forgery; silently overwriting hides a misconfigured client either way and gives the
caller no signal that something is wrong. This mirrors how `BootstrapService` already refuses to
trust a client-supplied scope rather than "fixing" it quietly.

## Acceptance Criteria

### `exerciseId` is server-authoritative
- [x] Given a live session, when `POST /api/telemetry` is called, then the persisted
      `TelemetryEvent.ExerciseId` is stamped from the resolved session scope
      (`SessionPrincipal.Read` — see Decision 3; no second, parallel accessor), **never**
      trusted from `TelemetryEventRequest.ExerciseId` even when the two agree.
- [x] Given a live session, when the request body's `exerciseId` **disagrees** with the session's
      own bound exercise, then the request is rejected with **400** (not silently overwritten with
      the session's value, and not persisted).
- [x] Given no live session, when `POST /api/telemetry` is called, then it is rejected (401) —
      this endpoint carries **no pre-auth allowlist entry** (Decision, above); it is not on story
      11's 11-route allowlist. *(Delivered by story 11's gate; re-checked in the controller, and
      asserted by `DefaultDenySessionGateTests.PreviouslyOpenRoute_WithNoCredential_Returns401`.)*

### Actor identity is server-authoritative, not a body claim
- [x] Given a live session, when `POST /api/telemetry` is called, then `actor.kind`,
      `actor.personaId`/`actor.sessionId`, and `actor.actingHumanId` are populated from the
      session's own resolved identity — a body-supplied `actor.kind: 'participant'` (or any other
      forged actor claim, per the audit's confirmed exploit) is not trusted verbatim.
      *(`actor.sessionId` / `actor.actingHumanId` / `actor.participantId` are stamped; a
      `actor.kind: 'participant'` claim from a non-participant session and an `actor.personaId`
      that is not a non-staff caller's own binding are refused with 403. `actor.kind` itself is
      otherwise left caller-stated — see Decision 4.)*

### Cross-cutting
- [x] **Isolation (XC-001/COR-001):** a telemetry write can never be attributed to an exercise
      other than the caller's own session scope — closing the "attribute to any exercise it names"
      gap the audit confirmed, including the case of a nonexistent exercise id.

## Decisions made during the build

**3. The session identity is read from the PRINCIPAL, not re-resolved through an endpoint-time accessor.**
The audit named the real blocker: `AuthenticatedSession` carried no `PersonaId`/`ActingHumanId`. That is now
fixed *at that level* — `AuthenticatedSession` carries `PrincipalId`, `ActingHumanId` and `PersonaId`,
`SessionPrincipal.Create` projects them onto `HttpContext.User`, and `SessionPrincipal.Read` reads them back
(fail-closed: any missing or unusable required claim yields `null`, never a partial identity). **No fourth
session-lookup seam** — the three endpoint-time accessors are untouched, and consolidating them stays story
12's follow-up. Chosen over calling `ICurrentSessionPersonaAccessor`/`ICurrentStaffSessionAccessor` for three
reasons: (a) **cost** — telemetry is the burst-rate path (SOC-071), and those accessors each add a
token→session query *per event*, whereas the claims are already in hand for free; (b) **completeness** —
neither accessor exposes `Session.PrincipalId`, so `actor.participantId` would have had to stay body-trusted,
leaving an authenticated participant able to attribute a view to another trainee; (c)
`ICurrentSessionPersonaAccessor` fails closed for a session with no persona binding, which would have made
telemetry unwritable for exactly the persona-less participant account story 12's UAT precondition is about.

**4. `actor.kind` is NOT derived from the session kind — only the `participant` claim is policed.** The v0
actor kinds are *fiction-level* descriptors, not session kinds, and real emitters legitimately cross them: a
participant session emits `kind: 'persona'` for a reaction (`useReaction.ts`), and a staff console emits
`kind: 'engine'` / `'system'` (`useEngineControl.ts`, `usePauseState.ts`, `reviewActions.ts`). Deriving the
kind would 403 every one of those. What *is* refused is the audit's actual forgery — a non-participant session
claiming `actor.kind: 'participant'`, which is the one claim that makes an operator's or observer's event
indistinguishable from a trainee's in the evaluation record (COR-018). `actor.role` is likewise left
caller-stated: a display/filter string, not an attribution or authorization input, and no AC covers it.

**4a. But a READ-ONLY observer's `actor.kind: 'participant'` is CORRECTED, not refused (COR-015).** The Tier-2
review's Critical, and it was right. Every shipped view emitter hardcodes
`actor: { kind: 'participant', participantId: session.accountId }` with no read-only branch
(`Feed.tsx:378`/`:400`, `HashtagFeed.tsx:160`, `Profile.tsx:214`/`:319`, `ThreadView.tsx:210`), and a shared
observer reaches every one of those surfaces. A blanket 403 would have silently deleted view/reach telemetry for
the largest cohort in an exercise — `mockSink` swallows the rejection into one generic log line — against a
COR-015 requirement that exists precisely for the "hundred passive participants" case. Unlike a staff session's
claim, this one *is* correctable, and the correction is not invented: `SharedReadOnlyLoginService` already stamps
`actor.kind: 'system'` on the telemetry **it** writes for the very same session, with the session id as the reach
key. Fixing the six emitters instead was rejected on principle — making the SPA self-report its own privilege
level correctly is the "frontend as the security boundary" posture that caused #359. An unknown future session
kind gets no such benefit and still 403s: nothing tells us whether it is observer-like or operator-like.

**5. Scope rejects; actor identity overwrites.** Deliberately asymmetric, and consistent with story 12. A
body `exerciseId` that disagrees is a 400 (the settled decision above). The actor's *identity fields* are
overwritten silently, exactly as `PostAttributionResolver`'s staff arm does: the server does not trust the body
for them at all, so refusing the write over a disagreement would break a legitimate console — which sends
whatever identity string it holds — for no security gain. Only a claim that cannot be *corrected* (there is no
participant to substitute for a staff session; no persona to substitute for an unbound one) is refused.

**5a. `origin` is policed too, though no AC named it.** Folded in from the Tier-2 review (WR-002). A non-staff
session may only state `origin: 'participant'`, or omit it; a privileged origin is refused with 403. This is the
same forgery class the ACs cover for `actor.kind` and the same harm — the evaluator surfaces render `engine` /
`controller-as-persona` events as machine- or operator-generated, so a trainee stating either writes fabricated
provenance into the evaluation record, exactly how the audit's exploit 1 dressed an injected post up as
engine-generated content. Verified safe against every shipped emitter first: only `features/controller/**` states
a privileged origin (`useEngineControl`, `useSwampedMode`, `useDraftTimer`, `reviewActions`, `composeService`),
and participant surfaces state `participant` or nothing. `actor.role` was left alone by contrast — a display/filter
string with no attribution or authorization meaning.

**5b. `actor.personaId` is verified but never COMPLETED, and a staff session's choice is not cast-validated.**
Asymmetric with `participantId` on purpose. `participantId` is unambiguous (a participant session has exactly one
account), so an omitted one is stamped; *which persona an event concerns* is the emitter's knowledge, so
completing it would be guessing rather than stamping. And a staff session's persona choice is deliberately not
checked against the exercise cast: that would be a `Personas` query **per event** on the burst-rate path, which is
the cost this whole design exists to avoid. The residual is bounded and non-disclosing — the row's `ExerciseId` is
still the session's, so a bogus value is a dangling reference inside the caller's own exercise, never a
cross-exercise read. (`PostAttributionResolver` validates the equivalent choice on `POST /api/posts`, where one
query per post is affordable; it does **not** run on this path, and the code comment that implied otherwise has
been corrected.)

**6. The FK on `TelemetryEvent.ExerciseId` was considered and deliberately NOT added.** No `IExerciseScoped`
entity in this model has one — there is not a single `HasOne`/`WithMany` to `Exercise` in `PulseDbContext`;
house style is a plain, required, indexed `ExerciseId` guarded by the central query filter plus the write-time
scope guard. A lone FK here would be a one-off deviation, and would have to be `NoAction` anyway (a cascade
would delete evaluation data on exercise deletion — worse than the gap). Orphan rows are now exactly 0 in UAT,
and an orphan is structurally unreachable through this endpoint now that the route is gated and the scope is
stamped from a session bound to a real exercise. If an FK is wanted it belongs to a **model-wide** convention
change, not to this story. **No migration was authored** — no schema change was needed.

**7. One deliberate behaviour change, wider than a pure tightening.** An `actor.kind: 'participant'` envelope
that omits `participantId` used to be a 400 (a v0 conditional-rule violation); it is now **completed
server-side and accepted**, because the authority pass runs *ahead* of validation, so what `Validate()` checks
is what will actually be stored. The same applies to a `view` event arriving with no reach key at all (COR-015)
— the stamped `sessionId` satisfies it. Rejecting a caller for omitting a field the server is the sole
authority on would be pedantry, not security. The conditional rules stay enforced for every field the server
*cannot* complete (`injectId` for `origin: 'inject'`, covered by test).

## Out of Scope
The default-deny session gate itself (story 11 — this story's "no live session → 401" AC relies on
it; `TelemetryController` is an MVC controller, so it is `AuthorizationMiddleware`'s `FallbackPolicy`
that gates it, not anything this story adds directly). `POST /api/posts` attribution (story 12) —
a different endpoint, a different file, though this story reuses story 12's
`ICurrentSessionAccessor` rather than inventing a second telemetry-specific one. The anonymous-401
regression suite (story 14). Any read/query API over stored telemetry, rate limiting beyond the
existing 64 KiB body cap (`TelemetryController.cs:30`), and SignalR fan-out for telemetry — all
already out of scope per the controller's own doc comment and unaffected by this story.

**Consider, not a hard AC:** an FK constraint on `TelemetryEvent.ExerciseId` (the audit proved none
exists — a write naming a nonexistent exercise was accepted). **Audit for existing orphan rows
first** before adding the constraint (the sandbox already has at least one:
`22222222-2222-2222-2222-222222222222`, per the audit's cleanup table) — a migration that adds the
FK without first resolving orphans would fail to apply or silently cascade-delete evaluation data,
either of which is worse than the current gap. Track as a follow-up migration, not this story's AC.

> **Resolved: not added.** Orphans are now exactly 0 (verified in UAT), so the data-migration hazard is
> gone — but the FK was declined on model-consistency grounds instead. See **Decision 6** above.

## Technical Notes
**Backend only. No `Program.cs` edit** — `IExerciseContext` (the controller's one new constructor
dependency) is already registered by `AddPulsePersistence`, and the authority itself is a static over the
principal, so nothing needed wiring at the composition root.

**As built:**
- `Telemetry/TelemetryEnvelopeAuthority.cs` (new) — the rule set: stamps the scope and the actor's identity
  fields, refuses a claim about who the caller is. Static, no DI, no I/O.
- `Telemetry/TelemetryController.cs` — identifies the caller (401) **before** the bounded body read, then
  applies the authority **before** `Validate()` so what is validated is what is stored (see Decision 7), then
  the existing size-cap/JSON/schema/dedup path unchanged. The "Out of scope: per-session/hostname authority of
  the `exerciseId` claim" line is gone from the class doc comment — it would have misdirected the next reader
  exactly as it misdirected this audit's own scoping.
- `Features/Identity/Sessions/ISessionAuthenticator.cs`, `SessionAuthenticator.cs`, `SessionPrincipal.cs` —
  `AuthenticatedSession` gains `PrincipalId` / `ActingHumanId` (both `required`, so no resolver or test double
  can silently default them) and `PersonaId`; `SessionPrincipal` projects them as three new claims and gains
  the fail-closed `Read` reader plus the `SessionIdentity` it returns.
- Tests: `Telemetry/TelemetryEnvelopeAuthorityTests.cs` (host-free), `Features/Identity/Sessions/
  SessionPrincipalTests.cs` (the new fail-closed boundary, including a foreign `authenticationType` carrying
  identical claim types), and `Telemetry/TelemetryIngestTests.cs` extended with the end-to-end persisted
  assertions. Suite: **1494 passing / 0 skipped** (from 1424 on `main`).

**Tier-2 review folded** (1 Critical, 3 Warnings, 3 Suggestions — all addressed): the read-only Critical
(Decision 4a), the `origin` gap (5a), the misleading persona-validation comment (5b), one genuinely
non-discriminating test of my own (the "absent `exerciseId`" case was passing the session's own id through a
helper default, so the branch had no coverage at all), `IsNullOrWhiteSpace` on the required claims, and two doc
wording corrections. The review also confirmed independently that `Program.cs`, the model snapshot, and the three
endpoint-time accessors are untouched.

**Why this needs story 11's `FallbackPolicy` specifically, not just "any" session requirement:**
`TelemetryController` is an MVC controller (`[ApiController]`, self-registered via
`MapControllers()`), so a minimal-API `IEndpointFilter` (the pattern
`ReadOnlySessionWriteFilter`/`EngineCockpitStaffAuthorizationFilter` use) would never run for it —
see story 11's Decision 1 for the full reasoning. This story's own AC3 ("no live session → 401")
is therefore delivered by story 11's gate, not by new code in this story; this story's own new code
is the scope/actor **derivation and mismatch-rejection**, which requires a session to already be
guaranteed present.

Cross-reference `implementation.md`'s per-story tech notes and Wave Plan.

## Dependencies
`identity-auth-roles/11` (the `FallbackPolicy` default-deny gate — required for this story's
"no session → 401" AC; an `IEndpointFilter`-only approach could not have gated this MVC
controller). `identity-auth-roles/12` (reuses its `ICurrentSessionAccessor` — do not invent a
third parallel session-lookup shape; see story 12's own Out of Scope on consolidation as a
follow-up). `identity-auth-roles/03` (`Session.PersonaId`/`ActingHumanId`, the data the accessor
reads).

## Tests
- A live session's telemetry write is stamped with the session's own `exerciseId`, ignoring an
  agreeing body value. *(An ABSENT one is not "ignored" at the endpoint level — it still 400s at
  `Validate()` as a v0 shape error, which `MissingExerciseId_Returns400_AndPersistsNothing`
  asserts. The authority pass itself defers rather than rejecting, so the caller gets the shape
  error and not a misleading "disagrees with your session".)*
- A live session's telemetry write with a **disagreeing** body `exerciseId` is rejected (400), not
  persisted, not silently corrected.
- A telemetry write with no live session is rejected (401) — the MVC-controller proof point for
  story 11's `FallbackPolicy` mechanism choice.
- A telemetry write's `actor.kind`/`actingHumanId` reflects the session's own identity regardless
  of a divergent or forged body claim.
- Regression: the existing size-cap/malformed-JSON/schema/dedup 400 paths (`TelemetryController.cs`
  tests already covering `:52-117`) are unaffected by the new scope/actor checks running ahead of
  them.
