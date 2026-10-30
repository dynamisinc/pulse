# Story: E4 telemetry beyond FC-6 (video, embed) and invisibility

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-030, NWS-014, XC-004, XC-002  ·  **Design decisions:** D3-P2 (telemetry invisibility)  ·  **Issue:** #736
**Stack:** frontend  ·  **World:** participant (emits only; no UI)  ·  **Wave:** E4-2  ·  **Effort:** S

## Context
FC-6 already provides `article_view`, `content_dwell`, `content_share` (server), `content_published/revised/retracted` for every content kind (foundation 04/15/18). E4 adds only what is specific
to news: whether a participant **played the Beat clip** and whether they **opened an embedded Pulse post** from the article — both are meaningful signals in the misquote cycle. View/dwell are
**session-level evidence, not person-level proof** (NWS-030): events carry the session actor and are labeled so; **no reader-visible UI** (CANNOT list).

## Acceptance Criteria
- [ ] **Video events.** Given the broadcast player (05), when a participant first plays, reaches 50%/100%, then the client emits `content_video_play` / `content_video_progress` (`payload.pct` ∈ {50,100}) / best-effort only, once each per session+item, with `target { entityType: 'content_item', entityId }`, `channel: 'news'`, `payload.kind: 'article'`, scenario + wall time and actor via the XC-004 v0 envelope; no event fires on autoplay-muted preload or on poster render.
- [ ] **Embed open.** Given the embedded Pulse post (06), when the participant opens its thread, then the client emits `content_embed_open` with `payload.postId` and the article as `target`; the subsequent navigation is the social channel's own `view` event (no duplicate).
- [ ] **No double count.** The client emits **nothing** for events FC-6 assigns to the server (`content_share`, publish/revise/retract); `article_view`/`content_dwell` come only from foundation `useContentViewTelemetry` (this story adds no second emitter).
- [ ] **Vocabulary registration.** The new event types (`content_video_play`, `content_video_progress`, `content_embed_open`) are **already registered by foundation story 02** (FC-6b, news FU-7 resolved) — this story edits no vocabulary list and the v0 schema is unchanged; an event type absent from the known list is still accepted by the sink (so build ordering cannot drop data).
- [ ] **Invisibility.** A test mounts the article page, home and section pages in all four skins and asserts there is no element, `aria` text, tooltip, title or console output exposing view, dwell, play, or embed-open state to the reader; emission failures are swallowed silently (never a toast).
- [ ] **Session-level labeling.** Event payloads carry `sessionScope: 'session'` (not a person claim) so E10 can label them per NWS-030/D9; the acting human behind a shared org account is recorded only in the envelope's actor, never in a payload field readable by participants (XC-002).
- [ ] **Isolation.** Events carry no exercise id from the client; the server stamps it from the session (XC-001); a cross-exercise `entityId` is dropped by the sink validation.

## Out of Scope
E10 dashboards/labels (E10); share-out telemetry (foundation 18); scroll-depth; heatmaps; any reader-facing "popular" feature.

## Technical Notes
Participant world, no UI. Files: `src/frontend/src/features/news/telemetry/{useVideoTelemetry,useEmbedTelemetry}.ts` + tests; the player (05) and embed (06) accept optional `onPlayProgress`/`onEmbedOpen` callbacks that the article page (04) wires to these hooks, so 19 owns no file in 05/06. Reuse the `core/telemetry` emitter. Fire-and-forget; no retries beyond the emitter's own.

## Dependencies
E4 05, 06 (callback props); foundation 02 (vocabulary, FC-6b), foundation 15 (emitter conventions, `useContentViewTelemetry`). Can run with 04, 15, 18.
