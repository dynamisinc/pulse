# Story: Overlay layer — pause / EndEx / break-fiction rendering

**Feature:** Participant shell  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** COR-065 (CTL-023, CTL-024, COR-054)  ·  **Design decisions:** D7-003, D7-004  ·  **Issue:** #189
**Delivered:** `components/OverlayLayer/*`

## Context
The shell owns the layer that covers the world when the exercise is held or stopped, so no channel
re-implements it and the z-order is guaranteed. Two families: the **calm control pages** (pause +
EndEx, each with an in-fiction and an out-of-fiction register, D7-004) that render above content but
**below** compliance chrome; and the **break-fiction broadcast** (D7-003, canonized from CTL-024) —
the one alarm treatment — which covers **everything including chrome**. These are **server-pushed
states, not user actions**: world-steering (staff) **triggers** them (break-fiction #27, tiered-pause
#26); this shell **renders** them. Break-fiction is the only participant surface that ever shows
**wall-clock** time.

## Acceptance Criteria
- [x] Given an overlay state, when the shell renders, then the z-order is honored bottom→top: content
      · channel nav · alert bar · **pause/EndEx pages** · compliance chrome · **break-fiction**
      (COR-065); a channel can never draw above this layer. — `OverlayLayer.test.tsx`
- [x] **Break-fiction (CTL-024/D7-003):** a black `#0d0d0d` field with amber `#ffb300` hazard-stripe
      bars, monospace, "REAL-WORLD MESSAGE · EXERCISE CONTROL", the configured message, **wall-clock
      time**, a "remains until cleared" line, **no dismiss affordance**, and **no brand/type/color from
      either world** — it covers compliance chrome too. It clears only on the Director action (the
      console triggers; this shell renders). — `OverlayLayer.test.tsx`, `wallClock.test.ts`
- [x] **Pause (CTL-023/D7-004):** in-fiction = a neutral "We'll be right back" maintenance page
      (system-ui, zero exercise language); out-of-fiction = a slate `#1b232c`/mono "EXERCISE PAUSED"
      control page with a "scenario clock stopped" line. **EndEx (COR-054):** in-fiction = "This
      service is no longer available"; out-of-fiction = "ENDEX" + hot-wash logistics. —
      `OverlayLayer.test.tsx`
- [x] Only break-fiction gets the alarm treatment; pause/EndEx control pages share the calm slate/mono
      family. Overlays are **not user-dismissable**; break-fiction has **no** client-side dismiss path.
      — `OverlayLayer.test.tsx`
- [x] Accessibility: overlays trap focus and are announced (NFR-001); the break-fiction message is a
      high-risk content class and reserves the EXERCISE watermark slot where a channel is still visible
      beneath a non-covering register (NFR-008). Break-fiction's wall-clock is the sole COR-053
      exception. — `OverlayLayer.test.tsx`, `useOverlayFocusTrap.test.tsx`, `wallClock.test.ts`

## Out of Scope
The **triggers**: Break Fiction's guarded control + type-to-confirm + fan-out + audit
(world-steering #27) and the tiered-pause control + state machine (world-steering #26) — this story
**renders** what they push. The scenario-clock stop itself (E1 COR-050 / world-steering Freeze); the
holding-page **content authoring** (exercise lifecycle COR-032).

## Technical Notes
Participant world (except break-fiction, which is alien to both worlds by design). Consumes
`overlayState` (`none | pause | endex | broadcast` + `register: in-fiction | out-of-fiction`),
server-pushed via SignalR. Break-fiction is intentionally outside the participant skin. See
implementation.md (story 05). Amends world-steering #26/#27 per STORY-UPDATES §B (rendering here,
control there).

## Dependencies
world-steering break-fiction (#27) + tiered-pause (#26) as the **triggers** (STORY-UPDATES §B); E1
lifecycle/clock (COR-050/054); the SignalR push host; compliance chrome (story 01) for the z-order.

## Tests
- Component (RTL): z-order — break-fiction covers chrome; pause/EndEx render below chrome, above content.
- Component (RTL): break-fiction shows wall-clock, hazard treatment, and has no dismiss control.
- Component (RTL): pause/EndEx render the correct in-fiction vs out-of-fiction register.
