# Story: Channel enablement gate (server + client)

**Feature:** Channels foundation  ·  **Epic:** E3 (shared with E4/E5/E6)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** In Review
**Requirements:** PRT-003 (disabled channels hide cleanly), PRT-020, COR-030 (enabled channels), XC-001  ·  **Design decisions:** D7-001, D2-005  ·  **Issue:** #704
**Stack:** fullstack  ·  **World:** participant  ·  **Wave:** 2  ·  **Effort:** M

## Context
exercise-configuration's open question (c): a planner can disable a channel and the nav drops it, but its routes keep serving. The foundation owns the answer for the new
channels: a shared filter, so E3–E6 get it for free and "disabled" means unreachable, not merely hidden.

## Acceptance Criteria
- [x] **One registry.** `ChannelCatalog` remains the single list of channel ids; `IChannelEnablement.IsEnabledAsync(channelId)` reads the **resolved** exercise's `EnabledChannels` (null → `DefaultEnabledIds`) and nothing from the client.
- [x] **Server gate.** Given a disabled channel, when any route inside `RequireChannelEnabled("news")` is called by a participant, then the response is the same 404 as an unknown route; for an enabled channel the request proceeds. A test covers news/press/weather/portal against the real host.
- [x] **Staff are not blocked.** Given a staff session (console, preview-as-participant), then staff authoring routes work for a disabled channel (planners prepare content before enabling), while participant read routes still 404 for a participant.
- [x] **Changes apply live.** Given a planner enabling or disabling a channel mid-session, when the participant next requests, then the new state applies without a restart (no per-process cache beyond one request); the nav config and the gate agree.
- [x] **Client guard.** `useEnabledChannels()` derives from `GET /api/channel-nav-config`; `<ChannelRoute channelId>` renders `ChannelNotFound` (participant world, story 12) for a disabled channel, never a COBRA 404 and never a blank page.
- [x] **Default is social-only** and a pilot exercise (only social enabled) behaves exactly as today: no new routes visible, landing unchanged (pilot mode, Master §4).
- [x] **Social is untouched** by this story (Q4): social routes keep serving; the filter exists so a follow-up can apply it.

## Out of Scope
Gating `/api/feed`, `/api/posts`, `/api/threads` (Q4); the settings UI that toggles channels (exists in exercise-configuration); per-outlet enablement (that is `Outlet.Enabled`, story 03).

## Technical Notes
Files: `Features/Channels/Enablement/**`, the `ChannelCatalog` edit in `ParticipantShellConfigService.cs` (no signature change), `features/channels/routing/enabled.ts*`. Pair with exercise-configuration story 01's "Known gap" note; tick AC3's route-gating clause for the new channels when this lands.

## Implementation notes (as built)
- **Server:** `Features/Channels/Enablement/` — `IChannelEnablement` (scoped `ChannelEnablement`, memoized per request
  only), `ChannelEnablementEndpointFilter`, and `RequireChannelEnabled<TBuilder>(channelId)` (works on an endpoint or a
  route group; an uncatalogued id throws at mapping time). Registered from `AddChannels()`. The catalog edit adds
  `ChannelCatalog.IsCatalogued` and `ChannelCatalog.ResolveEnabled`; `GetChannelNavConfigAsync` now resolves through
  `ResolveEnabled`, so the nav and the gate share one rule. A live **staff** session assigned to the resolved exercise passes the
  filter (the handler's own role and scope gates still apply); participant, shared read-only and unassigned staff
  sessions are gated.
  An unresolved scope 404s.
- **Interface location:** FC-7 places seam interfaces in `Contracts/`, but story 02 did not ship
  `IChannelEnablement`, so it lives in `Enablement/` with its implementation.
- **Client:** `features/channels/routing/` — `useEnabledChannels()` reads the shell's own nav-config query
  (`channelNavConfigQueryKey` + `fetchChannelNavConfig`, now exported from `participant-shell/channelNavConfig.ts`), with
  `staleTime: 0` so a toggle applies on the next guarded mount; on a first-fetch error it falls back to Social only (a
  failed refetch keeps the last answer; the server stays authoritative). `<ChannelRoute channelId>` shows a busy
  placeholder while loading, and while a cached "disabled" is being refetched, then the children or `ChannelNotFound`.
  Inside a staged staff "Preview as participant" (`useOptionalPreview()`) it renders the channel regardless (AC3).
- **`ChannelNotFound`:** story 12 owns the final skinned version; this story ships a fiction-safe baseline in
  `features/channels/routing/ChannelNotFound.tsx` (FC-8 `routing/`) that story 12 restyles in place. Handoff to 12: today an unknown participant path redirects to Social home
  (`SocialRoutes` catch-all) while a disabled channel renders `ChannelNotFound`; 12's participant not-found should
  converge the two so they are indistinguishable on the client as they are on the server.
- **Tests:** `ChannelEnablementTests` (service, nav agreement, mapping), `ChannelEnablementGateHostTests` (real
  `Program` host + SQL: probe routes for news/press/weather/portal, staff/read-only, live toggle, isolation, Social
  ungated), `ChannelsCompositionRootWiringTests`, `features/channels/routing/enabled.test.tsx`.

## Dependencies
02 (filter interface). Blocks 03/06 wiring assertions, 12.
