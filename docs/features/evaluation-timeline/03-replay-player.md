# Story: Replay player (honest fidelity)

**Feature:** Evaluation timeline & replay foundation  ·  **Epic:** E10  ·  **Phase:** 4  ·  **Status:** Not Started
**Requirements:** EVL-003, COR-053  ·  **Design decisions:** D6-005, D6-006  ·  **Issue:** —

## Context
EVL-003 is the fidelity contract: event ordering and content are **guaranteed exact**; derived state
shown in replay (trending, engagement counts, alert-bar state, storyline intensity) renders from
periodic snapshots (≤60s interval) and must be labeled snapshot-approximate; layout is approximate to
the current UI, not pixel-faithful; takedown-removed content (CTL-025) never re-renders;
scenario-time jumps (COR-051) render as labeled discontinuities. D6-005 gives the concrete video-player
model: transport bar with play/pause (space), 1×/4×/16× speeds, click-to-scrub; the track's horizontal
axis is **wall-elapsed** exercise time (not scenario time) so scrubbing stays physically smooth; the
+4h scenario-time jump renders as a narrow hazard-hatched seam with a "⟫ +4 HR" chip, honest both ways
(no wall time passed, fiction time did); crossing it while playing raises a "SCENARIO TIME ADVANCED"
toast; an activity ridgeline is drawn on the track; a staff lane above holds inject ▸ and
controller-dial ◆ markers, in their own labeled lane, never mixed into activity data; a bookmark ⚑
lane sits below; the stage renders participant surfaces (Portal/Pulse) with the real D1/D7 anatomy.
D6-006 adds the honesty chrome: a persistent "ORDER EXACT · COUNTS ≈ SNAPSHOT" chip, and every
derived-state number inside the fiction (like counts, trending rank) carries an amber ≈ mark with a
tooltip — no derived number pretends to be replayed exactly.

The **hotwash mode switch** that governs whether staff overlays appear on the projector (D6-007,
EVL-014 exclusion, EVL-033 latency) is a distinct, safety-critical behavior and is specced in its own
story, `04-hotwash-mode-switch` — it lives in this player's header but reaches across the stream and
metrics, so it earns separate ACs and a test. This story owns the player mechanics and honest-fidelity
chrome; it renders the staff lane + per-post origin lines in Evaluator view, and story 04 owns their
absence in Hotwash view.

## Acceptance Criteria
- [ ] Given the Replay view, when the evaluator interacts with it, then it behaves as a video player:
      **Space** toggles play/pause, **1×/4×/16×** buttons change playback rate, and clicking the
      track scrubs the playhead — per D6-005.
- [ ] Given the replay track, when it renders, then its horizontal axis is **wall-elapsed** exercise
      time (not scenario time) so scrubbing motion stays physically smooth, with an activity
      ridgeline showing posting volume over time — per D6-005.
- [ ] Given the exercise's scenario-time jump (+4 hr), when the track renders, then the jump shows as
      a narrow hazard-hatched seam labeled "⟫ +4 HR", and if playback crosses it while playing, a
      "SCENARIO TIME ADVANCED" toast appears — per D6-005 and EVL-003's discontinuity-labeling
      requirement.
- [ ] Given the replay stage, when it renders any moment, then a persistent "ORDER EXACT · COUNTS ≈
      SNAPSHOT" chip is visible, and any derived-state number shown in the fiction (like/reply/repost
      counts, trending rank) carries an amber ≈ mark with a tooltip explaining it is
      snapshot-approximate (≤60s interval) — per D6-006/EVL-003; ordering and content are never
      marked approximate.
- [ ] Given a post that was taken down (CTL-025 tombstone) before the replayed moment, when replay
      reaches that moment, then the removed content never re-renders — EVL-003's takedown guarantee,
      matching what participants actually saw.
- [ ] Given the replay stage, when it renders, then it hosts the participant surfaces (Portal/Pulse)
      using the real D1/D7 participant anatomy — compliance banners, alert bar, channel strip,
      scallop verification seal, reply·repost·like order — inside a bordered/shadowed "stage"
      container that never bleeds into the outer staff frame (the two-worlds rule).
- [ ] Given Evaluator-view mode is active, when the replay track renders, then a labeled staff lane
      above the track shows inject ▸ markers and controller-dial ◆ markers in their own lane, never
      mixed into the activity ridgeline data — per D6-005/D6-008's "own labeled lane" rule (the same
      vocabulary `evaluation-metrics`' dial overlay uses). Its removal in Hotwash view is owned by
      story `04-hotwash-mode-switch`.
- [ ] Scenario time (COR-053): the scenario-time readout in the transport bar and every in-stage
      timestamp renders in the exercise's configured time zone; wall-elapsed time drives scrub
      mechanics only and is never shown as a participant-visible label inside the stage.
- [ ] Accessibility (NFR-001): the transport controls and every chip (fidelity, jump seam) carry a
      text label in addition to color/shape; the player is fully keyboard-operable (space to
      play/pause, arrow-key scrub). (The hotwash/evaluator toggle's a11y is covered in story 04.)

## Out of Scope
Computing the derived snapshot values themselves (owned upstream by whatever produces the
trending/engagement snapshots — this story only renders and labels them); the sentiment chart's own
dial overlay (`evaluation-metrics/03` — this story owns only the replay-track staff lane, not the
chart); the **hotwash mode switch and staff-overlay hiding** (`04-hotwash-mode-switch`).

## Technical Notes
Staff world; `features/evaluator/components/replay/` (`ReplayPlayer.tsx`, `TransportBar.tsx`,
`ActivityTrack.tsx`, `StaffLane.tsx`, `BookmarkLane.tsx`, `ReplayStage.tsx`). The `HotwashToggle.tsx`
that shares this folder is owned by story 04. The
stage sub-renders the D1 social-app and D2 portal skins in a read-only preview mode — reuse them, do
not fork new copies. Snapshot/derived-value data model follows the reference DOM
(`design/handoffs/evaluator-dashboard/Evaluator Dashboard.dc.html`'s `stageFor`, `ridge`,
`staffMarks`, `bmMarks`). Mock data behind the shared axios client until the backend replay-snapshot
contract exists — that contract is a serial dependency for real playback. See `implementation.md`.

## Dependencies
Story 02 (deep-link sets the initial playhead/channel); `posts` (`soft-delete-tombstones`, CTL-025)
for takedown honoring; `world-steering`/`inject-queue` (E7) for inject-fire and dial-event staff-lane
sources; the D1/D2 participant skins this story renders read-only.

## Tests
- Component (RTL): transport controls (space/1×/4×/16×/click-scrub).
- Component (RTL): jump-seam rendering + crossing-while-playing toast.
- Component (RTL): snapshot ≈-marking on derived values, never on ordering/content.
- Component (RTL): tombstoned content never renders at its replayed moment.
- (Hotwash-toggle behavior — staff lane/origin absent from the DOM, no keyboard/hover path — is
  tested in story `04-hotwash-mode-switch`.)
