# Story: Channel enablement gate (server + client)

**Feature:** Channels foundation  ·  **Epic:** E3 (shared with E4/E5/E6)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-003 (disabled channels hide cleanly), PRT-020, COR-030 (enabled channels), XC-001  ·  **Design decisions:** D7-001, D2-005  ·  **Issue:** —
**Stack:** fullstack  ·  **World:** participant  ·  **Wave:** 2  ·  **Effort:** M

## Context
exercise-configuration's open question (c): a planner can disable a channel and the nav drops it, but its routes keep serving. The foundation owns the answer for the new
channels: a shared filter, so E3–E6 get it for free and "disabled" means unreachable, not merely hidden.

## Acceptance Criteria
- [ ] **One registry.** `ChannelCatalog` remains the single list of channel ids; `IChannelEnablement.IsEnabledAsync(channelId)` reads the **resolved** exercise's `EnabledChannels` (null → `DefaultEnabledIds`) and nothing from the client.
- [ ] **Server gate.** Given a disabled channel, when any route inside `RequireChannelEnabled("news")` is called by a participant, then the response is the same 404 as an unknown route; for an enabled channel the request proceeds. A test covers news/press/weather/portal against the real host.
- [ ] **Staff are not blocked.** Given a staff session (console, preview-as-participant), then staff authoring routes work for a disabled channel (planners prepare content before enabling), while participant read routes still 404 for a participant.
- [ ] **Changes apply live.** Given a planner enabling or disabling a channel mid-session, when the participant next requests, then the new state applies without a restart (no per-process cache beyond one request); the nav config and the gate agree.
- [ ] **Client guard.** `useEnabledChannels()` derives from `GET /api/channel-nav-config`; `<ChannelRoute channelId>` renders `ChannelNotFound` (participant world, story 12) for a disabled channel, never a COBRA 404 and never a blank page.
- [ ] **Default is social-only** and a pilot exercise (only social enabled) behaves exactly as today: no new routes visible, landing unchanged (pilot mode, Master §4).
- [ ] **Social is untouched** by this story (Q4): social routes keep serving; the filter exists so a follow-up can apply it.

## Out of Scope
Gating `/api/feed`, `/api/posts`, `/api/threads` (Q4); the settings UI that toggles channels (exists in exercise-configuration); per-outlet enablement (that is `Outlet.Enabled`, story 03).

## Technical Notes
Files: `Features/Channels/Enablement/**`, the `ChannelCatalog` edit in `ParticipantShellConfigService.cs` (no signature change), `features/channels/routing/enabled.ts*`. Pair with exercise-configuration story 01's "Known gap" note; tick AC3's route-gating clause for the new channels when this lands.

## Dependencies
02 (filter interface). Blocks 03/06 wiring assertions, 12.
