# Story: Channel nav — global strip + mobile tabs (config-driven)

**Feature:** Participant shell  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** COR-061, COR-062  ·  **Design decisions:** D7-001  ·  **Issue:** #187
**Delivered:** `ChannelNav.tsx` + `channelNavConfig.ts`

## Context
One shell-owned way to move between channels, so no channel re-implements a cross-channel switcher
(the anti-pattern D7-001 rejected). Desktop: a **38px global strip** under the alert bar — channel
names as plain links, current channel marked, scenario **dateline** right-aligned (COR-061/062).
Mobile: a **bottom tab bar** (5 slots, icon + label). It is deliberately quiet so it never competes
with a channel's own masthead. **Config-driven:** a disabled channel appears **nowhere**. In Phase 1
(pilot mode) the world is effectively single-channel (Social); the strip is the container that earns
its keep as E4/E5/E6 land (Phase 3).

## Acceptance Criteria
- [x] Given the enabled channel set, when the shell renders on desktop, then a 38px strip shows each
      enabled channel as a plain link with the current channel marked (weight + underline) and the
      **scenario dateline** right-aligned; on mobile, a bottom tab bar with the same channel set. —
      `ChannelNav.test.tsx`
- [x] **Config-driven visibility:** a disabled channel appears in **neither** the strip **nor** the
      mobile tabs — no dangling doors (matches D2-005); a single-channel deployment may hide the strip
      entirely (config). — `ChannelNav.test.tsx`, `channelNavConfig.test.tsx`
- [x] Channels **never** render their own cross-channel nav; switching a channel updates the mounted
      channel and **persists per shell instance**. — `ChannelNav.test.tsx`
- [x] The strip is **participant-world** styled (plain links, quiet grays) — never COBRA / default MUI
      (D0 §2) — and never carries instructional text (XC-002). — `ChannelNav.test.tsx`
- [x] Nav is keyboard-operable and screen-reader labelled; the current channel is programmatically
      marked (NFR-001); the dateline renders in scenario time (COR-053). — `ChannelNav.test.tsx`

## Out of Scope
A channel's own masthead / section nav (channel-owned); which channels exist (exercise-configuration);
multi-channel behavior **at scale** across E4/E5/E6 (**Phase 3** — this story delivers the Phase-1
container + single/degenerate-channel behavior, incl. the mobile tab bar's 5-slot cap; true
**>5-channel overflow** treatment is Phase 3, when E4/E5/E6 land); the **actual cross-channel
mount-switch** (Phase 3 — this story delivers the switch **mechanism** + per-shell-instance persisted
state; there is only one real channel, Social, to switch to in pilot mode); kiosk (nav stripped —
story 06).

## Technical Notes
Participant world. Reads the enabled-channel config + current channel (exercise-scoped). Anchor: the
network strip on real media properties (D7-001). Mobile bottom tabs = 56px, 5 slots. See
implementation.md (story 03).

## Dependencies
The channel set (exercise-configuration); the channel-mount contract (story 04). Ticks STORY-UPDATES §A;
Phase-3 multi-channel is a §D backlog note.

## Tests
- Component (RTL): enabled channels render as links, current marked; a disabled channel is absent from
  strip + tabs.
- Component (RTL): mobile renders the bottom tab bar; switching persists per instance; keyboard-operable.
