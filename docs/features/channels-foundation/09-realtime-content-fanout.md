# Story: Realtime fan-out for channel content

**Feature:** Channels foundation  ·  **Epic:** E3/E4/E5/E6 (shared)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-006 (live-updating without refresh), NWS-013, XC-001, XC-002, NFR-002 (burst), NFR-001 (live region)  ·  **Design decisions:** D7-002  ·  **Issue:** —
**Stack:** fullstack  ·  **World:** participant  ·  **Wave:** 2  ·  **Effort:** M

## Context
Channel content rides the **existing** SignalR connection and exercise group; no second hub. The four events in `implementation.md` FC-5 are added to `IFeedBroadcaster` as default no-op
methods by story 02; this story implements them and gives the client one typed subscription hook.

## Acceptance Criteria
- [ ] **Events.** Given a publish/revise/retract/alert change, when the broadcaster runs, then clients receive `ContentPublished`, `ContentRevised`, `ContentRetracted` and `AlertsChanged` with exactly the FC-5 payloads (no body in `ContentRevised`; the full active set in `AlertsChanged`); a `silent_rewrite` still sends `ContentRevised` carrying the moved `updatedScenarioTime` and **no** `revisions[]` entry (FC-1).
- [ ] **Scoped.** Given two exercises, then a frame for exercise A reaches only A's group (`ExerciseRealtimeHub.GroupNameFor`); a connection from exercise B receives nothing (XC-001). Frames carry no origin/acting human/wall clock (XC-002).
- [ ] **Lifecycle routing (#375).** Given an exercise that is not live-push-open (completed/archived), then frames go to the staff group only, via the same `ResolveTargetAsync` the post events use; a test mirrors `SignalRFeedBroadcaster`'s existing lifecycle tests.
- [ ] **Disabled channel is silent.** Given a disabled channel, then `ContentPublished` for it is not sent to participants (staff group still receives it), so a hidden channel never leaks a headline.
- [ ] **Client hook.** `useChannelStream({ channelId, outletSlug?, onPublished, onRevised, onRetracted })` subscribes on the shared `realtimeConnection`, unsubscribes on unmount, drops frames for other channels/outlets, and replays nothing (state converges via refetch on reconnect, as the feed does).
- [ ] **Live-region contract.** The hook exposes a `newItemCount` and an announce callback; it never announces in bulk — under burst it coalesces to one polite announcement per 5 s window (NFR-001/NFR-002); alerts are announced by the alert bar, not by this hook.
- [ ] **Burst.** Given 120 `ContentPublished` frames in a minute, then the hook batches state updates to ≤ 1 render per animation frame and the list does not jank (a unit test with fake timers asserts the batching).

## Out of Scope
Emitting the events (04, 05, 10 call the broadcaster); the "new stories" pill UI (channels render it); presence/typing; a polling fallback beyond the existing reconnect refetch.

## Technical Notes
Files: `Features/Realtime/SignalRFeedBroadcaster.cs` (add four implementations + event-name constants), `src/frontend/src/features/channels/data/useChannelStream.ts` (+ tests). Reuse `core/realtime/connection.ts`; mirror how social's live-engagement refresh subscribes.

## Dependencies
02. Can run with 03, 04, 08, 10, 13, 14. Blocks 11, 15.
