# Feature: Social API (backend)

**Epic:** E2 — Social Network  ·  **Phase:** 1  ·  **Feature ref:** F2.1 Posts / §3 Feeds & discovery (backend)
**World:** backend — serves both participant-world and staff-world clients; no visual surface of its own  ·  **Issue:** #267

## Summary
The server behind the social channel's already-shipped, frozen frontend contracts. Today a
controller's post reaches the participant feed only through `postStore` — an in-memory,
single-browser-tab module singleton that evaporates on reload and never crosses sessions
(`postStore.ts:20-21`, "no cross-tab / cross-participant fan-out"). This feature is
`docs/BACKEND_ROADMAP.md` **Phase B1 — the walking skeleton**: it makes that exact loop real —
persisted, exercise-scoped, and pushed over SignalR to every session in the exercise. It is the
thinnest end-to-end slice that proves the whole backend tier: an exercise-scoped feed/thread read
API, the blessed `POST /posts` write ingest (participant compose **and** controller
compose-as-persona converge on the same endpoint), the SignalR fan-out that makes a controller's
post appear in a *different* participant's browser, and a persona-instance read API so the feed
has real authors. The frontend seams are already backend-shaped; this is "fill in the server
behind a frozen client contract" (`FEATURE_ORCHESTRATION_PLAYBOOK.md`).

This is a backend/service feature, a sibling to the E8 engine backend features
(`engine-generation-infra`, `engine-review-cockpit`), not a UI feature — it has no design brief and
mounts nothing new in `App.tsx`. It primarily realizes E2 (SOC-080/010/003) but also serves E7's
persona-operation write path (CTL-001, without implementing it — `composeAsPersona` is the caller)
and E1's isolation/attribution guarantees (COR-001/002/018) in real SQL for the first time.

## Requirements covered
SOC-080 (All Posts feed), SOC-010 (flattened thread) — read.
SOC-003 (post provenance & telemetry), COR-018 (per-human attribution) — write.
SOC-083 (real-time feed updates), NFR-003 (degraded-mode/polling fallback) — real-time.
XC-005 (personas belong to exactly one exercise instance), COR-003 (multi-instance, no collision) — personas.
Cross-cutting on every story: XC-002 (provenance never reaches a participant), COR-001/002/007
(isolation + the standing test suite), COR-053 (scenario time preserved), NFR-004 (content
security), XC-004 (telemetry v0).

## Design references
None — no design brief; this feature has no visual surface. It exists to serve the frozen
frontend contracts specified in `feedService.ts`, `useThread.ts`, `postService.ts`,
`composeService.ts`/`useComposeAsPersona.ts`, and `personaService.ts` **without changing their
shape**. The two-worlds rule (D0 §2) is enforced here as a **data-layer** guarantee — the XC-002
server-side provenance projection — rather than a chrome one; see Design notes.

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Feed & thread read API — `GET /feed`, `GET /threads/:id` | SOC-080, SOC-010 (XC-002, COR-001/002, COR-053) | Complete | #270 |
| 02 | Post write API — `POST /posts` | SOC-003, COR-018 (NFR-004, XC-004, XC-002) | Complete | #271 |
| 03 | SignalR feed host — real-time fan-out + polling fallback | SOC-083 (NFR-003, COR-001/002, XC-002) | Complete | #272 |
| 04 | Persona read API — `GET /personas` | XC-005, COR-003 (COR-018, XC-002) | Complete | #273 |
| 05 | Real-time role-scoped groups — keep staff-only pushes off participant connections (SECURITY / XC-002) | XC-002, SOC-052, COR-001 | Not Started | #346 |

## Dependencies
**Phase B0, hard prerequisite for all four stories:** `backend-host/01-webapi-host-bootstrap` (the
`Pulse.WebApi` host), `backend-host/02-persistence-efcore` (`PulseDbContext` + the **[Tier-2]**
write-time scope guard), and `exercise-isolation/01-exercise-scoped-queries`' central query filter,
realized in real SQL as the read-side filter extending that `PulseDbContext`. Story 02 additionally depends on
`telemetry/02-telemetry-sink-backend` (it emits the XC-004 event server-side). All of `backend-host/**`
is authored in parallel by a sibling effort — referenced here by name, not owned by this feature.

Sibling **frontend** feature docs this reconciles with but does not edit: `posts` (the `Post`
model + `postService.ts`), `feeds-discovery` (`feedService.ts`, `postStore.ts` — story
`07-live-feed-store`, Complete — and the still-`Not Started` `04-realtime-new-posts-pill`, which
this feature's story 03 unblocks), `persona-management` (persona authoring — this feature only
serves reads), and `exercise-isolation` (the filter every story here inherits). See
`docs/BACKEND_ROADMAP.md` §4 Phase B1 for the plan of record.

## Design notes
No visual surface — this is the server tier both worlds' clients call (a participant's own
composer, a controller's console, the future E8 engine runtime). The two-worlds rule is enforced
here as a **data-layer** guarantee, not a chrome one: `toParticipantView`'s structural
provenance-stripping (client-side only, today) becomes a **server-side projection** (XC-002), so a
participant-authenticated caller can never receive `origin`/`actingHumanId`/`createdWallClock`/
`injectId` in any response body — genuinely absent on the wire, not merely unread by the client.
`02-post-write-api`'s response is this feature's one deliberately **role-conditional** exception: a
staff/controller caller's own write response still carries `origin`, because the console's
`originConsoleLabel` origin line depends on it (`PersonaComposer.tsx:150-157`) — every other
response in this feature (01's reads, 03's broadcast, 04's personas) is unconditionally
provenance-free, because their only known consumers today are participant-world hooks.

Isolation (COR-001/002) is the other load-bearing guarantee: every read, write, and real-time
group in this feature inherits the central exercise-scoping filter — never a client-supplied
`exerciseId`. Two stories (01's cross-exercise thread-id probe, 03's cross-exercise group-join
probe) carry the always-Critical, Tier-2-sign-off isolation class per
`BACKEND_ROADMAP.md` §3.5/§6; 02 and 04 inherit the same server-stamping discipline as ordinary
(non-Tier-2-tagged) acceptance criteria this pass.
