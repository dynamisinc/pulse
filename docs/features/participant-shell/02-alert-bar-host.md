# Story: Alert-bar host (4 states, ticker default, emergency escapes)

**Feature:** Participant shell  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** PRT-010, PRT-011, PRT-012  ·  **Design decisions:** D7-002  ·  **Issue:** #186

## Context
The EAS analog — one alert host directly below the top chrome that **persists across every channel**
(PRT-010). The shell supplies the container, severities, collapse, stacking, and the scenario
timestamp + Details link-through (PRT-012); channels supply alert **content**. The D7 review chose the
**ticker** as the default treatment (D7-002): a dark one-line bar with a severity tab + monospace
message. **Emergency always escapes the ticker to the full band** (solid `#b3261e`, white text).
Alerts are **in-fiction/simulated** — anything real-world is the break-fiction overlay (story 05),
never the alert bar. In pilot mode the content arrives via platform notifications (SOC-072).

## Acceptance Criteria
- [ ] Given an active alert, when the shell renders, then the alert-bar host shows the correct state —
      `none` (zero height, no reserved space) / `info` / `advisory` / `emergency` — with a severity
      **chip (icon + LABEL text) + color, never color-only** (NFR-001), the message, a **scenario
      timestamp**, and a **Details →** link to alerts history (PRT-012).
- [ ] Ticker is the **default** treatment (dark `#14181c` one-line, severity tab + mono message);
      **emergency escapes the ticker and forces the full band** (`#b3261e` solid, white text) and
      **never collapses**; info/advisory band treatments collapse-on-scroll to one line and re-expand
      on tap (D7-002).
- [ ] **Multi-alert:** the ticker auto-rotates active alerts (~3.5s, severity tab swaps per message);
      band/compact show highest severity + a "+N more" chip that expands the stack.
- [ ] The alert bar **persists across every channel** (PRT-010) and is **never user-dismissable**;
      alerts are in-fiction only (real-world messages are the break-fiction overlay, story 05).
- [ ] Accessibility: `role="status"`; severity carried by chip text; a live-region announce fires on
      state change (NFR-001). Timestamp renders in **scenario time** (COR-053), never wall-clock.

## Out of Scope
Alert **content** patterns and the alerts-history page (channel-side, PRT-012 stub, D2); publishing
an alert (world-steering CTL-020/CTL-021 attention levers / SOC-072 notifications); the break-fiction
overlay (story 05 — real-world, not an alert).

## Technical Notes
Participant world. Consumes `alerts[]` (`{severity, message, scenarioTime, id}`, server-driven,
exercise-scoped). Ticker is the shipped default; band/compact retained as an alternate treatment per
D7-002. See implementation.md (story 02). Palettes (chip = saturated color + white LABEL; pale tint
= alternate band bg): info chip `#3d6a96`, advisory chip `#8a5a00` (darkened from the D1/D2 `#b97a00`
for WCAG AA on the 11px LABEL — D7-012), emergency `#b3261e`.

## Dependencies
Compliance chrome (story 01, sits above it); notifications SOC-072 (pilot-mode alert delivery) / E3
alert publishing (Phase 3); the channel-mount contract (story 04) for scenario time. Ticks
STORY-UPDATES.md §A.

## Tests
- Component (RTL): each state renders its chip + message + timestamp + Details; `none` is zero-height.
- Component (RTL): emergency forces the full band and does not collapse; info/advisory collapse on scroll.
- Component (RTL): multi-alert ticker rotates; a11y `role="status"` + live-region announce on change.
