# Story: Post as any persona into an enabled channel

**Feature:** Persona operation  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-001, COR-018  ·  **Design decisions:** R-001, R-003, R-004  ·  **Issue:** #14

## Context
The controller must be able to speak as the world. From the console composer, a controller posts
**as the active persona** into an enabled channel — no logging in/out per persona (CTL-001). In
Phase 1 the only enabled channel is Social, so this story is scoped to social; the "any channel"
surface generalizes as E4/E5/E6 land. The published content runs through the **same `createPost`
pipeline as any post** (`@/features/social`'s `postService.ts`), so it is indistinguishable to
participants; only the telemetry knows a controller sent it (SOC-003 origin, never
participant-visible). Where the persona is an org account operated by a human, the individual human
is recorded (COR-018).

> **Grounding correction (Wave-1 reconciliation).** The shipped `Post` model
> (`features/social/types/post.ts`) has **no `parentId`/thread/quote field** — reply, repost/quote,
> and DM are not representable yet (they are `threads-replies`/`direct-messages` features that extend
> the model). The originally-authored AC2 below listed post/reply/repost/DM as one bundle; **Wave 1 is
> scoped to POST-ONLY.** Reply-as-persona, repost/quote-as-persona, and DM-as-persona are deferred to a
> **Post-model extension follow-up** once the model carries a parent/thread reference — track as a
> `persona-operation` backlog note, not built this pass.

## Acceptance Criteria
- [ ] Given an active persona and the social channel, when the controller submits a post, then it
      publishes through `createPost` (`@/features/social`) authored by that persona
      (`authorPersonaId`) with `origin: 'controller-as-persona'` — avatar/handle/verified render per
      the persona (the canonical scallop seal and R-004 avatar treatment, identical everywhere the
      persona renders, incl. the console's composer identity header per R-001) with no controller
      identity visible to any participant. `createPost` is reused as-is, never forked.
- [ ] **POST-ONLY for Wave 1** (see the grounding correction above): the composer supports composing
      and publishing a new post as the active persona. Reply, repost/quote, and DM as a persona are
      explicitly OUT of scope this pass — the `Post` model cannot represent them yet.
- [ ] Given a published post, when telemetry is recorded (XC-004, via `createPost`'s
      `buildAndEmit` — never a raw build+emit call), then the event captures
      `origin: 'controller-as-persona'`, the **acting human** controller id (`actingHumanId`,
      COR-018 — the operating controller, supplied as an input, see Technical Notes), the persona id,
      the channel (`'social'`), and both wall-clock and scenario timestamps (SOC-003). On console post
      cards this provenance surfaces as the always-visible **SIMCELL-n · MANUAL** origin line
      (`originConsoleLabel(post)`, R-003, live-monitoring) — staff-only, never participant-visible
      (SOC-003/XC-002; `toParticipantView` is the structural guarantee elsewhere in the pipeline).
- [ ] The participant-visible post renders its time in **scenario time** in the exercise time zone
      (COR-053) — `scenarioTime: scenarioNow().toISOString()` from `@/core/clock`; wall-clock never
      appears in the participant view (`ParticipantPostView` has no `createdWallClock` field at all).
      The console's own composer shows **both** wall-clock and scenario time at the fire control
      (dual-time, staff-side only — the Cadence precedent for a controller-facing FIRE action).
- [ ] Post text/media is sanitized before publish (NFR-004, via `createPost`'s internal
      `sanitizeText` — this story does not re-implement sanitization) — a script in the composer never
      executes in a participant session.
- [ ] The action only targets personas and channels within the controller's **active exercise**
      (COR-001) — `exerciseId`/`timeZone` come from `useExerciseContext()` and stamp the post/telemetry
      only (never a client query-scoping param); a persona from another exercise is not selectable or
      postable here.

## Out of Scope
News/press/weather composing (Phase 3, as those channels land); the persona picker UX
(`persona-operation/02`); in-composer voice context (`persona-operation/03`); bundle/scheduled firing
(inject-queue F7.2); takedown of what was posted (CTL-025, world-steering); **reply, repost/quote, and
DM as a persona** (deferred — see the grounding correction; needs a `Post`-model parent/thread
extension); the persona picker's own component, the controller-identity mock, and the ⌘K
palette/persona-dock host (all `console-shell/01`) — this story CONSUMES them as inputs, it does not
build or import them.

## Technical Notes
Staff world (COBRA). Reuse the shipped **`createPost`** (`@/features/social`) — do not fork it;
posting-as-persona is that pipeline with a different `authorPersonaId` + `origin`. Files this story
owns (disjoint from every other Wave-1 story): `features/controller/services/composeService.ts`
(`composeAsPersona(...)` → calls `createPost`), `features/controller/hooks/useComposeAsPersona.ts`,
`features/controller/components/PersonaComposer.tsx`.

**Inputs, not imports (Wave-1 parallel-build contract — mirrors how the shipped `SocialChannel`
composed independently-built `Composer`+`Feed`+`ThreadView` via `onPosted`).** This story's
hook/component take, as props/params supplied by the caller:
- `activePersona: Persona` — from `persona-operation/02`'s `useActivePersona()`. This story does
  **not** import `PersonaPicker` or `useActivePersona`.
- `actingHumanId` + `callSign` — from `console-shell/01`'s `useControllerIdentity()`. This story does
  **not** import `controllerIdentity.ts`.

**Output seam.** `PersonaComposer` exposes `onPublished?(post: Post)` — mirrors the shipped
`Composer`'s `onPosted` prop exactly. This story does **not** import `postStore`
(`feeds-discovery/07`). The Wave-1 **integration step** (serial, owned by the orchestrator, not a
builder) wires: `console-shell/01`'s persona-dock host renders `persona-operation/02`'s picker →
`persona-operation/01`'s composer → `persona-operation/03`'s context panel, and wires
`onPublished` to `feeds-discovery/07`'s `postStore.appendPost`.

Publish endpoint is a mock (no `.NET` backend yet) — `createPost` already behaves this way (pure,
synchronous, in-memory), so there is no additional mock seam to add here.

See `implementation.md` (story 01) for the file-ownership map + cross-feature wave plan.

## Dependencies
`persona-operation/02` (active-persona selection, as an INPUT contract, not an import) for the
persona to post as; `console-shell/01` (controller identity + persona-dock host, as an INPUT
contract); the shipped `@/features/social` `createPost`/`Post` model; the XC-004 telemetry emitter
(via `createPost`).

## Tests
- Unit: `composeAsPersona`'s telemetry event (via `createPost`) carries `origin`, `actingHumanId`,
  `authorPersonaId`, dual time (wall + scenario).
- Unit: the participant-visible post (via `toParticipantView`) carries no `origin`/`actingHumanId`/
  `createdWallClock`/`injectId` field at all.
- Unit: a stored-XSS payload is stripped from the composed text before it reaches the created post.
- Component (RTL): `PersonaComposer` publishes as the supplied `activePersona`; the console origin
  line reads `SIMCELL-n · MANUAL` (via `originConsoleLabel`); `onPublished` fires with the created
  `Post`.
