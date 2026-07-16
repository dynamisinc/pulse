# Story: Channel-mount contract (content region, scenario time, variant)

**Feature:** Participant shell  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-060 (COR-053, COR-062)  ·  **Design decisions:** D7-005  ·  **Issue:** #188

## Context
The seam between shell and channel. The shell hands each channel a rectangle (the content region
between nav and bottom chrome) and a small props contract — and then **imposes zero styling inside**
(COR-060): no inherited fonts, colors, or resets beyond the browser's. The shell is also the **single
source of scenario "now"** (COR-053/062): the strip dateline, alert timestamps, and the value channels
use for "2h ago"/datelines all come from the shell. Channels receive `{variant, scenarioNow}` and must
**not** render cross-channel nav or draw above the overlay layer.

## Acceptance Criteria
- [ ] Given a mounted channel, when it renders, then the shell has applied **zero styling** inside the
      content region (no inherited fonts/colors/resets beyond the browser default) — the channel owns
      its typography, color, and layout entirely (COR-060).
- [ ] The shell passes each channel `{variant, scenarioNow}` and is the **single source** of scenario
      time (COR-053/062): channels derive datelines and relative times from `scenarioNow`, never from
      wall-clock, and never label it "scenario time" in-fiction.
- [ ] A channel **cannot** render cross-channel nav (that is the shell's strip, story 03) and
      **cannot** draw above the overlay layer (story 05) — the contract enforces the z-order.
- [ ] The content region is exercise-scoped: a channel mounted in one exercise's shell can render no
      data from another exercise (XC-001); the shell never leaks exercise/admin concepts into it (XC-002).
- [ ] The contract is stable across channels (social now; portal/news/press/weather later) so a new
      channel mounts with no shell change.

## Out of Scope
Any individual channel's content (E2/E3/E4/E5/E6); the scenario **clock** mechanics themselves (E1
exercise-clock COR-050); the overlay layer (story 05) and nav (story 03) — this story defines the
contract they participate in.

## Technical Notes
Participant world. Defines the channel-mount props (`{variant: full|readOnly|kiosk|preview,
scenarioNow}`) and the content-region container with a CSS reset boundary (styling stops at the
channel edge). `scenarioNow` is fed from the E1 clock (COR-050) via server-driven shell state. See
implementation.md (story 04). This is the exported contract other channel features import.

## Dependencies
E1 exercise-clock (COR-050) as the scenario-time provider; nav (story 03) + overlay layer (story 05)
which the contract bounds; every participant channel consumes this contract. Ticks STORY-UPDATES §A.

## Tests
- Unit: a mounted channel receives `{variant, scenarioNow}`; `scenarioNow` traces to the exercise clock.
- Component (RTL): the content region applies no font/color inheritance to a probe child.
- Unit: a channel's attempt to render another exercise's data is not possible (scoped context).
