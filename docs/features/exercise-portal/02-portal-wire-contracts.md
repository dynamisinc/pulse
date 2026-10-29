# Story: Portal wire contracts, fixtures and guards

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-002, PRT-003, PRT-022, XC-002, XC-004 (vocabulary), COR-053  ·  **Design decisions:** Q-35 (Tom, 10/29: display contracts Deferred)  ·  **Issue:** #768
**Stack:** fullstack  ·  **World:** foundation  ·  **Wave:** 1  ·  **Effort:** M

## Context
The demo-feedback / foundation "contract first" pattern for E3: freeze PC-1, PC-3, PC-5 names and the PC-6 payload shapes (the telemetry event-type strings are registered by foundation story 02, FC-6b) so the backend stories (03, 04) and the frontend stories can fan out in parallel against fixtures.

## Acceptance Criteria
- [ ] **Records and types.** Given PC-3, then C# `record`s exist in `Features/Portal/Contracts/` and TS types plus runtime guards in `features/portal/contract/` for `PortalDto` and `PortalResourceDto` (`DisplayStateDto` and `DisplayStaffDto` are **Deferred post-December**, Q-35); the guards reject (fail closed) an out-of-shape or unknown-enum response, so a consuming module renders nothing rather than a broken box.
- [ ] **Vocabulary.** Then `PortalVocabulary` / `vocabulary.ts` carry `PortalModuleId`, `PortalLayoutKey` and the PC-1 limits (`DisplayMode` / `DisplayTargetKind` are Deferred), and each module id maps to exactly one `ChannelId` from FC-1.
- [ ] **No leakage by construction (XC-002).** Given any participant-facing record, then a reflection test fails if it contains a property named like a token, hash, `version`, `actingHumanId`, `lastSeen`, wall-clock or `exerciseId`; (there is no staff `link` in December: `DisplayStaffDto` is Deferred).
- [ ] **Host-relative URLs (FC-9.3).** Given every participant fixture and record producer, then no absolute URL or hostname appears (a tripwire test; there is no exemption in December).
- [ ] **Fixtures.** Then `features/portal/mocks/` ships behind the axios client: *normal day / Staged* (filler only, calm weather), *incident day* (pinned lead, emergency alert, busy stream), *every subset of the four content modules*, *no resources*, *kiosk-lite* (the same portal fixtures rendered in the kiosk variant, including a retracted lead), each using scenario-time strings.
- [ ] **Telemetry vocabulary (FU-2 resolved).** Then a test asserts every PC-6 event type is present in `KNOWN_TELEMETRY_EVENT_TYPES` and the server vocabulary (registered once by **F02**, FC-6b — this story edits neither list) and that each has a declared payload/target shape; the v0 envelope schema test still passes unchanged.
- [ ] **Interfaces.** Then `IPortalConfigService` and `IPortalResourceService` exist in `Contracts/` with XML docs, so 03/04 implement against names (`IDisplayService` is Deferred with 05/08).

## Out of Scope
Implementations, endpoints, components. Anything already frozen by the foundation (FC-3 content/alert/media DTOs are imported, not copied).

## Technical Notes
Files: `Features/Portal/Contracts/**`, `features/portal/contract/**`, `features/portal/mocks/**`. Reuse FC-3 `ContentMediaDto` and its guard from `features/channels/contract/`. Same convention as `ParticipantPostDto.ScenarioTime`.

## Dependencies
F02. Can run with 01.
