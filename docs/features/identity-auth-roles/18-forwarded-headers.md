# Story: Forwarded headers so the per-IP rate limiter sees the client (#480)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** NFR-009, COR-012 (+ #480)  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §3.2, §9  ·  **Issue:** #480
**Stack:** backend  ·  **Review tier:** Tier-2 (security)  ·  **Wave:** A1

## Context
Behind the platform proxy every request looks like it comes from one IP, so the per-IP limiter either blocks everyone
or no one. The lockout policy ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §3.2) and the org-choice login (§1.2) both rely on a working per-IP limiter.

## Acceptance Criteria
- [ ] Given a request through the trusted proxy with `X-Forwarded-For: <client>`, when it reaches the limiter, then the
      partition key is the client IP, not the proxy IP.
- [ ] Given a request from an untrusted source with a spoofed `X-Forwarded-For`, then the header is ignored (trusts only the platform proxy).
- [ ] Given forwarded headers middleware, then it is registered **before** the rate limiter in the pipeline (asserted by a test).
- [ ] Given `X-Forwarded-Proto`, then HTTPS redirection / secure-cookie logic sees the original scheme.
- [ ] Given 6 failed staff logins from one client IP, then the limiter trips for that IP only; a second client IP is unaffected.
- [ ] Isolation: the limiter partition never mixes exercises or orgs; no per-route foreign-exercise/org test is needed as no route is added (stated).
- [ ] User guide (C5 docs-as-done): `docs/OPERATE.md` (trusted-proxy config) is updated in the same PR; no `docs/guide/` page changes ("no guide impact").

## Out of Scope
New limiters; MFA; HIBP breach checks (#490).

## Technical Notes
Staff-world security plumbing. `Program.cs` placement is **orchestrator-owned**; builder supplies `AddPulseForwardedHeaders()`
and the options type. Config: known proxies / networks. **Orchestrator clearance required first (A1):** the EF migration `AdminIdentityFoundation`, `Program.cs` edits, `App.tsx` / `staffRouteRegistry.tsx` edits and every frozen-type change (`Session`/`SessionDto`, `ExerciseRole`, `StaffAssignment` -> `Enrollment`, the staff login request) go through the orchestrator; post the frozen-type changes on the feature issue before A1 merges (brief C1.4). Builders export one `Add*()`/`Map*()` line each; they do not edit `Program.cs`.

## Dependencies
Wave A1; independent of 16/17 (can run with them). Required before 15's login limiter claims hold.

## Tests
Integration tests with a test server and forged headers; pipeline-order test.

Linked (`src/Pulse.WebApi.Tests/Features/TrustedProxy/`):
- `ForwardedHeadersTests.TrustedProxy_ForwardedFor_BecomesTheClientIp` (AC-1)
- `ForwardedHeadersTests.TrustedProxy_ClientPrependedEntry_IsNotUsed` (AC-1, AC-2)
- `ForwardedHeadersTests.TrustedNetwork_Ipv4MappedPeer_IsTrusted` (AC-1)
- `ForwardedHeadersTests.UntrustedSource_SpoofedHeaders_AreIgnored` (AC-2)
- `ForwardedHeadersTests.NoConfiguration_TrustsNoOne_IncludingLoopback` (AC-2)
- `ForwardedHeadersTests.UntrustedSource_RotatingSpoofedForwardedFor_CannotEscapeItsBucket` (AC-2)
- `ForwardedHeadersTests.ClientsBehindTrustedProxy_GetSeparateStaffLoginBuckets` (AC-1, AC-5)
- `ForwardedHeadersTests.TrustedProxy_ForwardedProto_RestoresHttpsScheme` (AC-4)
- `ForwardedHeadersTests.InvalidConfiguration_FailsFast`, `ForwardedHeadersTests.UseWithoutAdd_Throws` (config safety)
- `ForwardedHeadersPipelineOrderTests.RealPipeline_ForwardedHeadersRunBeforeTheRateLimiter_SoClientsBehindTheProxyGetSeparateBuckets`
  (AC-3, AC-5 over the real `Program`) — **skipped until the orchestrator wires `Program.cs`**; remove the `Skip` in the
  wiring commit. Verified red against the current (unwired) `Program`.

AC-5 note: the staff-login limiter is 10 attempts/minute per IP (unchanged; new limiters are out of scope), so the tests
exhaust 10 and assert the 11th trips for that client only. The "6 failures" figure belongs to the A2 per-account lockout.

AC-6 (isolation, stated): no route is added and no data is read. The limiter partition key is the client IP only — it
carries no exercise or org identity, so it cannot mix exercises or orgs. `X-Forwarded-Host` is deliberately not honored
because the request host selects the exercise (COR-001).

`Program.cs` wiring (orchestrator): `builder.Services.AddPulseForwardedHeaders(builder.Configuration);` with the other
`Add*` calls, and `app.UsePulseForwardedHeaders();` as the FIRST middleware, directly after `builder.Build()` and before
`app.UseCors(...)` (so before exercise resolution, session auth and `UseRateLimiter()`).
