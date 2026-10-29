# Story: Content data hooks and reader telemetry

**Feature:** Channels foundation  ·  **Epic:** E4/E5/E6 (shared)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-030, WX-022, PRT-006, XC-004, XC-001, COR-015  ·  **Design decisions:** D3-P2 (telemetry invisibility)  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 4  ·  **Effort:** M

## Context
One set of React Query hooks over the participant read API, merged with the realtime stream, plus the **reader telemetry** the evaluation needs (did participants see the warning /
article before acting?). Views and dwell are session-level evidence, not person-level proof (PIO teams share screens), and the reader sees none of it.

## Acceptance Criteria
- [ ] **Hooks.** `useOutlets(channelId)`, `useContentList({ channelId, outletSlug?, category?, featured? })` (infinite, cursor) and `useContentItem(channelId, outletSlug, contentSlug)` call the FC-4 routes through the shared axios client with runtime guards from story 02; keys are scoped by exercise (`exerciseId` keys the cache only and is never sent as a parameter, the `shellState.ts` rule).
- [ ] **Stream merge.** Given `ContentPublished` / `ContentRevised` / `ContentRetracted` (story 09), then lists insert/update/tombstone items without a refetch of the page, a revised item refetches its body, and a retracted open article swaps to the tombstone in place.
- [ ] **View telemetry (XC-004).** Given an article/release/product page is shown, when it has been visible, then exactly one `article_view` event (FC-6) is emitted per session+item (re-mount and re-render do not re-emit), with scenario + wall time, `channel`, `target { entityType: 'content_item', entityId }`, `payload.kind` (plus allow-listed `extraPayload` from the caller, today only `productType` for weather), and the actor's `participantId`/`sessionId` (a view requires one, COR-015); list scans emit nothing.
- [ ] **Dwell.** Given the page was visible, when it unmounts or the tab hides, then one `content_dwell` event with `payload.seconds` (visible time only, clamped to a sane maximum, best-effort) is emitted; failure to send never surfaces to the reader.
- [ ] **Invisible to the reader.** No UI, toast, attribute or console message in production reveals telemetry; read-only (shared-credential) sessions still emit session-level views.
- [ ] **Shared screens.** Telemetry never claims person-level attribution for a view on a shared/read-only session (the payload carries `sessionLevel: true` when the session is read-only or shared, NWS-030).
- [ ] **Retries and offline.** Hooks use the app's `queryClient` defaults; a 404 on a permalink renders `ChannelNotFound` through the returned status, never a thrown error boundary.
- [ ] **Isolation.** A hook never constructs a URL with an exercise id; switching exercise (staff switcher/reconnect) clears channel caches (the existing exercise-scope refresh).

## Out of Scope
Share-out events (server side via story 18's path); channel page UIs; offline cache (PDF-02); list scroll virtualization policy (each channel).

## Technical Notes
Files: `features/channels/data/**` (except `useChannelStream.ts`), tests. Reuse `core/telemetry/emitter`, `core/services/api.ts`, `core/exerciseContext`. `article_view` and `press_release` are already in `KNOWN_TELEMETRY_EVENT_TYPES`; every new type (`content_dwell`, `content_published`, … and all channel types) is registered once by **story 02** (FC-6b), so this story edits no vocabulary list.

## Dependencies
06 (live routes; mock fixtures until then), 09 (stream), 14. Can run with 16, 17, 18, 19.
