# Implementation: Persona operation

> Bridge from the F7.1 stories to a build. Staff-world surface (COBRA), publishing into the SHIPPED
> `@/features/social` `createPost` pipeline. The Social API B1 backend now exists and is wired
> (`POST /api/posts`, `GET /api/feed`, `GET /api/personas`, SignalR `/hubs/exercise` — see
> `docs/features/social-api/`); stories 01–03 still call `createPost` synchronously against the
> in-memory `postStore`, so **story 06 owns flipping the frontend write path onto the live
> endpoint** — see its Wave Plan row below.

> **Wave-1 cross-feature integration composition (supersedes this doc's Wave-Plan ordering for this
> pass).** Stories 01–03 build **in parallel** as part of a 5-story cross-feature wave alongside
> `console-shell/01` (KEYSTONE — ⌘K palette, persona-dock host, mock controller identity) and
> `feeds-discovery/07` (shared live post store). Each story below builds to an INPUT/CALLBACK
> contract instead of importing its siblings directly: `01`'s `PersonaComposer` takes
> `activePersona`/`actingHumanId`/`callSign` as props and exposes `onPublished?(post)`; `02`'s
> `useActivePersona()`/`PersonaPicker` and `03`'s `PersonaContextPanel` (`persona` prop) are the
> providers of that persona/context. A serial integration step (not a builder) wires them together,
> creates the `features/controller` barrel, and adds the App.tsx `/console` route — see
> `docs/features/console-shell/01-toolstrip-flyouts.md`'s "Wave-1 integration seam" for the exact
> order. This doc's own Wave Plan table (below) reflects the feature's normal internal sequencing and
> still governs stories 04/05.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Post as persona | A compose service + `useComposeAsPersona` hook that calls the SHIPPED `createPost` (`@/features/social`) with `origin: 'controller-as-persona'`, an input `actingHumanId`, dual timestamps. Does not fork `createPost`. | `features/controller/services/composeService.ts`, `features/controller/hooks/useComposeAsPersona.ts`, `features/controller/components/PersonaComposer.tsx` | `composeAsPersona()`, `PersonaComposer` (takes `activePersona`/`actingHumanId`/`callSign` as props; exposes `onPublished?(post)`) |
| 02 Fast switching | A persona-picker store (recents, pinned, type filter) + ⌘K palette entry (mounts into `console-shell/01`'s persona-dock host at integration); reads the exercise cast via the shipped `usePersonas()`. | `features/controller/components/PersonaPicker.tsx`, `features/controller/hooks/useActivePersona.ts` | `useActivePersona()`, `PersonaPicker` |
| 03 Composer context | A `PersonaContextPanel` (takes `persona: Persona` as a prop) reading voice notes via the shipped `personaTemplateById(persona.templateId)` (voice notes live on the TEMPLATE, not the instance) + audience magnitude off `persona.audienceBand` + a category chip derived from `persona.personaType`. | `features/controller/components/PersonaContextPanel.tsx`, `features/controller/services/personaVoice.ts` | `PersonaContextPanel` |
| 04 Presence | SignalR presence channel keyed by persona; a presence badge in the picker/composer. | `features/controller/hooks/usePersonaPresence.ts`, `features/controller/components/PresenceBadge.tsx` | `usePersonaPresence()` |
| 05 Mid-exercise create | A ≤60s "+ New persona" quick-create dialog launched from the picker; writes a Persona in the active exercise. | `features/controller/components/QuickCreatePersonaDialog.tsx` | `QuickCreatePersonaDialog` |
| 06 Live write-path flip | Flips `composeAsPersona`/`useComposeAsPersona.publish()` (and the participant `useComposePost.publish()`) onto the now-built `POST /api/posts` when `USE_MOCK_DATA` is false, mirroring `feedService.ts`'s mock/live adapter pattern; `createPost` itself stays the synchronous mock/engine path (per `social-api/implementation.md`'s recommended integration approach). Live-path posts arrive back via the already-wired SignalR `PostReceived` push, not `postStore.appendPost`. | `features/controller/services/composeService.ts`, `features/controller/hooks/useComposeAsPersona.ts`, `features/social/hooks/useComposePost.ts`, `features/controller/components/PersonaComposer.tsx` (edits, not new files); `features/personas/personaService.ts`'s existing `USE_MOCK_PERSONAS` flip | async `publish()` contracts other composer callers (incl. the engine review-publish pipeline) must await |

## Reuse map
- COBRA theme + `@/theme/styledComponents` (this is a staff surface) — `src/frontend/src/theme/`
- Shared axios client — `src/frontend/src/core/services/api.ts`
- React Query hooks pattern — `@tanstack/react-query`
- FontAwesome icons — `@fortawesome/react-fontawesome`
- **`createPost`/`toParticipantView`/`originConsoleLabel`** (SHIPPED,
  `src/frontend/src/features/social/services/postService.ts`) — reuse, do not fork; posting-as-persona
  is the same pipeline with a different `authorPersonaId` + `origin: 'controller-as-persona'`
- **Exercise-context** (`@/core/exerciseContext`'s `useExerciseContext()`, SHIPPED) — stamps
  `exerciseId`/`timeZone` only, never a client query-scoping param
- **Telemetry emitter (XC-004 v0, SHIPPED — `@/core/telemetry`'s `buildAndEmit`)** — emitted
  internally by `createPost`; this feature never calls the raw build+emit form itself
- **Persona model** (`@/features/personas`'s `Persona`/`PersonaTemplate`, `usePersonas()`,
  `personaTemplateById()`, SHIPPED) — `voiceNotes` (COR-020) is on the TEMPLATE, `audienceBand`
  (SOC-054) is on the INSTANCE; read both, don't redefine. Never import `SEEDED_PERSONAS`/
  `personaById` on a shipped path (mock-fixture-only exports).
- **`console-shell/01`'s ⌘K palette + persona-dock host** (this wave) — `02`'s `PersonaPicker` mounts
  its PERSONAS content there; `01`/`03` receive `activePersona`/`actingHumanId`/`callSign` as props
  rather than importing `console-shell`'s files (Wave-1 parallel-build contract, see the callout above)
- **Social API B1** (SHIPPED, `docs/features/social-api/` — `POST /api/posts`, `GET /api/feed`,
  `GET /api/personas`, SignalR `/hubs/exercise`) — story 06 is the frontend consumer of the write
  endpoint; it reuses the mock/live adapter pattern already shipped in `feedService.ts`/
  `personaService.ts` rather than inventing a new flip mechanism.

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Post as persona | composeService, useComposeAsPersona, PersonaComposer | shipped `createPost`; `console-shell/01`'s identity/dock-host contract (input, not import) | 02, 03 (this pass — Wave-1 cross-feature composition; normally follows 02) | 1 | M |
| 02 Fast switching | PersonaPicker, useActivePersona | shipped `usePersonas()`; `console-shell/01`'s palette/dock-host contract (input, not import) | 01, 03 | 1 | M |
| 03 Composer context | PersonaContextPanel, personaVoice | shipped `personaTemplateById()`/`Persona.audienceBand` | 01, 02 | 1 | S |
| 04 Presence | usePersonaPresence, PresenceBadge | SignalR host (later); 02 | 05 | 3 | M |
| 05 Mid-exercise create | QuickCreatePersonaDialog | E1 persona create; 02 | 04 | 3 | S |
| 06 Live write-path flip | composeService, useComposeAsPersona, useComposePost edits, PersonaComposer edits | Social API B1 (SHIPPED); Phase B2 per-request scope resolution; a deployed backend (`VITE_USE_MOCK_DATA=false` + `VITE_API_URL` + bootstrapped exercise) | — | 2 | M |

Notes: **for this pass**, 01/02/03 build in **Wave 1, in parallel**, as part of the 5-story
cross-feature Wave-1 composition (see the callout above) — they are decoupled via
props/inputs (`activePersona`, `actingHumanId`, `callSign`, `onPublished`) rather than a real
build-order dependency, mirroring the shipped `SocialChannel`'s independently-built
`Composer`+`Feed`+`ThreadView` composition. Outside this pass, the feature's normal internal
sequencing (02/03 before 01) still applies. Presence (04) waits on the SignalR host landing.
**Story 06 supersedes the earlier "no additional backend-contract seam" note below 01/02/03's
Wave 1**: the Social API B1 backend is now built, and 06 is the story that actually calls it —
it lands its own wave once a deployed backend + Phase B2 scope resolution exist to smoke it
against, per `social-api/implementation.md`'s "Post-B1 follow-ups" guidance.
