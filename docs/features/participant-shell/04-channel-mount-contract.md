# Story: Channel-mount contract (content region, scenario time, variant)

**Feature:** Participant shell  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** COR-060 (COR-053, COR-062)  ·  **Design decisions:** D7-005  ·  **Issue:** #188

## Context
The seam between shell and channel. The shell hands each channel a rectangle (the content region
between nav and bottom chrome) and a small props contract — and then **imposes zero styling inside**
(COR-060): no inherited fonts, colors, or resets beyond the browser's. The shell is also the **single
source of scenario "now"** (COR-053/062): the strip dateline, alert timestamps, and the value channels
use for "2h ago"/datelines all come from the shell. Channels receive `{variant, scenarioNow}` and must
**not** render cross-channel nav or draw above the overlay layer.

## Acceptance Criteria
- [x] Given a mounted channel, when it renders, then the shell has applied **zero styling** inside the
      content region (no inherited fonts/colors/resets beyond the browser default) — the channel owns
      its typography, color, and layout entirely (COR-060).
- [x] The shell passes each channel `{variant, scenarioNow}` and is the **single source** of scenario
      time (COR-053/062): channels derive datelines and relative times from `scenarioNow`, never from
      wall-clock, and never label it "scenario time" in-fiction.
- [x] A channel **cannot** render cross-channel nav (that is the shell's strip, story 03) and
      **cannot** draw above the overlay layer (story 05) — the contract enforces the z-order.
- [x] The content region is exercise-scoped: a channel mounted in one exercise's shell can render no
      data from another exercise (XC-001); the shell never leaks exercise/admin concepts into it (XC-002).
- [x] The contract is stable across channels (social now; portal/news/press/weather later) so a new
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
AC-to-test mapping (all committed under `src/frontend/src/features/participant-shell/`):
- **AC1** (zero styling inside the content region — no inherited fonts/colors/resets beyond browser
  default): `ShellLayout.test.tsx` ("zero-styling reset boundary (AC1)" describe block — "applies the
  CSS reset directive and imposes no color/font/background of its own on the content region", "lets the
  channel set its own color/font untouched by the shell").
- **AC2** (shell passes `{variant, scenarioNow}`; single source of scenario time; never wall-clock;
  never labeled "scenario time" in-fiction): `ShellLayout.test.tsx` ("single scenario-time source
  (AC2)" describe block — "passes the mounted channel a scenarioNow that traces to the injected
  exercise clock, not wall-clock", "reflects a changed exercise-clock instant on the next mount
  (scenarioNow is not a hardcoded value)", "passes the mounted channel its variant via the same
  useShellContext() call as scenarioNow"); `mountContract.test.tsx` ("ShellContextProvider" describe —
  "hands a mounted channel exactly the {variant, scenarioNow} it was bound with", "rebinds to a
  different provider value for a differently-mounted subtree (not a hardcoded pass-through)"). The
  `variant` half of the props is resolved by the shell-state mock seam this story also owns:
  `shellState.test.tsx` (boundary-mocked resolve/pending/error-fallback branches) and
  `shellState.default.test.tsx` (the shipped real-axios-client + canned-adapter path).
- **AC3** (a channel cannot render cross-channel nav / cannot draw above the overlay layer — the
  contract enforces the z-order): `mountContract.test.tsx` ("SHELL_Z (AC3 z-order contract)" describe —
  "orders content below channelNav, alertBar, overlay, chrome, and breakFiction", "mounts a channel at
  the lowest layer (content), strictly below the overlay layer"); `ShellLayout.test.tsx` ("z-order /
  stacking-context contract (AC3)" describe — "mounts the content region at SHELL_Z.content inside its
  own CSS stacking context", asserting `isolation: isolate` + `position: relative` so a channel's own
  `z-index` values are structurally scoped inside that context).
- **AC4** (exercise-scoped content region; no cross-exercise data; no exercise/admin leak):
  `ShellLayout.test.tsx` ("exercise-scoped, no leak into the content region (AC4, XC-001/002)" describe
  — "never renders the exercise id, name, or any exercise/admin/picker concept into the content
  region"); `mountContract.test.tsx` ("module surface (AC4, WAVE0-REVIEW precedent 20)" describe —
  "never exports an exercise/admin/picker/list/selection concept"); `shellState.test.tsx` ("never sends
  the exerciseId as a request/query param to the server (COR-001, XC-002)" — `exerciseId` keys the
  React Query cache only, never sent as a client-supplied scoping parameter).
- **AC5** (the contract is stable across channels so a new channel mounts with no shell change): held
  to structurally by `mountContract.test.tsx`'s "rebinds to a different provider value for a
  differently-mounted subtree (not a hardcoded pass-through)" test — the same
  `ShellContextProvider`/`useShellContext()` seam serves two independently-shaped mount-props values
  with zero change to `mountContract.ts`/`ShellLayout.tsx`. No second real channel exists yet to mount
  against this contract (social is the first consumer, a later feature) — the contract's continued
  stability across future channels is enforced by the `code-review` gate going forward, not by an
  additional runtime test here.
