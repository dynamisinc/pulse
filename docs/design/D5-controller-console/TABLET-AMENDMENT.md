# D5 Tablet Amendment: Controller Console on iPad

> **Status:** DRAFT for Tom's sign-off (MT-D3). Proposed 2026-10-16. Gates stories 12 and 13 in
> `docs/features/mobile-tablet/`; also sets the rules for 14 and 15.
> **Scope:** brief C3, wave B3. Staff world: COBRA / Cadence chrome (D7-009). Nothing here may
> make the console look like a participant view. Desktop at 1280px and wider does not change.
> **Grounded in code as of `main`:** `controller/components/ControllerConsole.tsx`,
> `engine/console/EngineControlBar.tsx`, `engine/components/ReviewQueue.tsx`,
> `liveWorld/LiveWorldColumn.tsx`, `runSheet/RunSheetPanel.tsx`, `staffShell/*`.

## 1. Target viewports and bands

| Band | Viewport width | Targets (CSS px) | Work area (minus 56px toolstrip) |
|---|---|---|---|
| Desktop (unchanged) | 1280 and up | n/a | n/a |
| **Tablet landscape** | 1024 to 1279 | 1024x768, 1180x820 | 968 / 1124 |
| **Tablet portrait** | 768 to 1023 | 768x1024, 820x1180 | 712 / 764 |
| Below 768 | under 768 | not supported (staff phones out of scope) | portrait layout renders unchanged |

The band edges reuse breakpoints that already exist. 1280 is the console's
`SLOT_SPLIT_MIN_WIDTH_PX`. 1024 and 768 are COBRA `lg` / `md` (`theme/cobraTheme.ts`). Select the
band by **width only**. Touch affordances are a separate test: `(pointer: coarse)` (story 14), so
an iPad with a trackpad still gets the tablet layout, and a narrow desktop window gets the tablet
layout without touch sizing.

## 2. Layout

Today the main area is LIVE WORLD | RUN SHEET side by side from 1280px and stacked below that.
A permanent 336px `ReviewQueue` column sits to the right. Above them are the title row, the ⌘K
shortcut strip and the world-steering panel (`PausePill`, `NoiseControl`, `EscalationDial`).

| Region (from code) | Desktop | Tablet landscape | Tablet portrait |
|---|---|---|---|
| Live world (`console-slot-live-world`) | side by side | **pane tab** | **pane tab** |
| Run sheet (`console-slot-run-sheet`) | side by side | **pane tab** (same switcher) | **pane tab** |
| Review queue (`review-queue-column`) | docked 336px | **docked, 296px** (D5-015 clamp) | **pane tab** with count badge |
| Engine control bar | full-width strip | **command band** (sticky) | **command band** (sticky, may wrap to 2 rows) |
| PausePill + EndEx (`lifecycleSlot`) | title / steering rows | **moved into command band** | **moved into command band** |
| EscalationDial + NoiseControl | steering panel | "Steering" disclosure row, collapsed | "Steering" disclosure row, collapsed |
| Export posts, Exercise report | title row | "More" (⋯) menu in the title row | "More" (⋯) menu |
| Personas / ENGINE / USAGE / Participant admin | toolstrip flyouts | unchanged (one at a time, D7-011) | full-height flyouts over the pane |

**Signed variants (Tom, 10/16).** Two viewports get a different arrangement from the generic
band:
- **Large landscape (≥ 1180 wide, e.g. 1180×820): side by side.** Live world | Run sheet share the
  main area (about 414px each) next to the docked 296px Review queue. Tom expects to revisit this
  after hands-on use, so it is chosen by **one layout constant**, not a code fork (see D5-022).
- **Tall portrait (≥ 820 wide and ≥ 1100 tall, e.g. 820×1180): stacked.** Live world sits above
  a docked Review queue (split about 60/40). Run sheet is a tab beside Live world in the upper
  region. 768×1024 portrait keeps the full tab switcher.

Rules:
- **One pane switcher**, wherever panes collapse. It follows the ARIA tabs pattern, with tabs at least 44px tall. All panes
  stay mounted and are hidden when inactive, so scroll position, a half-typed edit, and the active
  tab survive a tab switch or a rotation.
- Every tab carries a **text badge**: Live world "N new" (from `useLiveWorldUnread`), Run sheet
  "N due", Review "N · M under 60s".
- Flyouts and the persona dock cover the **pane area only**. They never cover the header or the
  command band.
- When collapsed, the Steering row shows a one-line text summary of the current storyline target
  and the noise level. One tap expands it.

```
TABLET LANDSCAPE  1024x768 / 1180x820
+----------------------------------------------------------------------+----+
| PULSE v | Bay Shield . SimCell-1 | SCN 09:33 | (o) RUNNING | FOUO | ..| T  |  shell header 56px
+----------------------------------------------------------------------+ O  |
| [ENGINE . LIVE v] | 4/6 demand | 2 need review . 1 <60s | [Pause v]    | O  |  command band
|                                                     [End exercise]   | L  |  (sticky)
+------------------------------------------------+---------------------+ S  |
| [Live world . 12 new] [Run sheet . 3 due]  (..)| REVIEW QUEUE (5)    | T  |
| > Steering: target 60 . noise Med              | [Batch approve]     | R  |
|                                                | draft card          | I  |
|   active pane (one at a time)                  | draft card          | P  |
|                                                | 296px, docked       |    |
+------------------------------------------------+---------------------+----+

TABLET LANDSCAPE, LARGE  1180x820  (initial choice; layout constant)
+---------------------------------------------------------------------------+----+
| header 56px                                                               | T  |
+---------------------------------------------------------------------------+ O  |
| command band (sticky): kill switch . demand . review counts . Pause . End | O  |
+------------------------+------------------------+-------------------------+ L  |
| LIVE WORLD . 12 new    | RUN SHEET . 3 due      | REVIEW QUEUE (5) 296px  | S  |
| ~414px                 | ~414px                 | docked                  | T  |
+------------------------+------------------------+-------------------------+----+

TABLET PORTRAIT, TALL  820x1180  (stacked)
+--------------------------------------------------+----+
| header / command band (sticky, 2 rows)           | T  |
+--------------------------------------------------+ O  |
| [Live world . 12 new] [Run sheet . 3 due]        | O  |
|   upper pane (~60%)                              | L  |
+--------------------------------------------------+ S  |
| REVIEW QUEUE (5) . docked lower (~40%)           | T  |
+--------------------------------------------------+----+

TABLET PORTRAIT  768x1024 (full tab switcher)
+--------------------------------------------------+----+
| PULSE v | Bay Shield | SCN 09:33 | (o) RUNNING |..| T  |  header (wall clock,
+--------------------------------------------------+ O  |  presence, preview -> ..)
| [ENGINE . LIVE v] | 4/6 | 2 review . 1 <60s     | O  |  command band
| [Pause v]                        [End exercise]  | L  |  (sticky, 2 rows)
+--------------------------------------------------+ S  |
| [Live world . 12 new][Run sheet . 3][Review 5.1!]| T  |  pane tabs, 44px
| > Steering: target 60 . noise Med                | R  |
|                                                  | I  |
|   active pane, full width                        | P  |
|                                                  |    |
+--------------------------------------------------+----+
```

## 3. Always-reachable controls

- The **command band** is a non-scrolling strip directly under the shell header. It holds the
  `EngineControlBar` (kill switch first, degrade indicator, CTL-034 demand meter, "N need review /
  N timers under 60s", swamped toggle), then **PausePill** (Pause injects / Pause engine / Freeze
  world), then **End exercise** at the far right end. It is never inside a tab, never in an
  overflow menu, and never covered by a flyout.
- The **kill switch** (ADP-042, D5-008) is always the first item in the band and stays one tap to
  Suggest-only / STOP. End exercise sits at the opposite end of the band, so the kill switch and
  EndEx are never neighbours.
- **Break Fiction** has no trigger in the console code yet. When it lands, it goes into the
  command band's guarded group (D5 header spec), never into a tab.
- **Shell header** (story 13): exercise identity, scenario clock, the state pill (dot plus text:
  RUNNING / INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN) and `UNCLASSIFIED // FOUO` never
  collapse. The wall clock, presence avatars and "Preview as participant" may move into a header
  "more" menu in portrait.

## 4. Touch and keyboard

- **Targets:** every interactive control is at least 44x44px under `(pointer: coarse)`, with at
  least 8px between adjacent actions. Today's toolstrip buttons are 40px and must grow.
- **No hover-only information.** Tooltips get a tap equivalent. The live world has no hover-only
  action today; keep it that way.
- **iPad hardware keyboard:** every shortcut works. ⌘K uses `metaKey`, which the console already
  accepts. Hints show **⌘ on Apple platforms, including iPadOS** (`MacIntel` with
  `maxTouchPoints > 1`) and Ctrl elsewhere. The shortcut strip shows one keycap, not both. On a
  coarse pointer it reads "Tap PERSONAS or press ⌘K". Check chords for Safari/iPadOS collisions
  on device (MT-D7).

| Shortcut (from code) | Where | Touch replacement (visible control) |
|---|---|---|
| ⌘K / Ctrl+K | console (`ControllerConsole.tsx`) | **PERSONAS** toolstrip tool; also "Reply as…" on a live-world row |
| Esc | palette, dock, flyouts, dialogs | visible ✕ / Cancel / Back on each |
| ↑ ↓ focus · Space select | Review queue | tap a card (focus) · select checkbox |
| A · V · E · R | Review queue (focused card) | Approve · Veto · Edit · Re-roll buttons (on the tapped card) |
| B | Review queue | "Batch approve" header button |
| J / K | Live world rows | scroll / tap a row |
| R | Live world row | "Reply as…" row button |
| N | Live world | "N new" pill |
| ↑ ↓ select | Run sheet | tap a row |
| F · H · S | Run sheet (selected row) | Fire · Hold/Release · Skip/Unskip row buttons |
| N · A | Run sheet | "Fire next" · "Add" header buttons |
| E | Run sheet | tap the row to open the editor |
| ⌘/Ctrl+Enter · Esc | Persona composer, draft edit composer | Send button · Cancel |
| Arrows / Home / End | EscalationDial (slider), NoiseControl | tap or drag the track · tap a level |
| Enter | EndEx dialog | Confirm button (enabled once END is typed) |

## 5. Deliberate confirms on touch (Takedown, Freeze, EndEx)

These rules apply to the existing flows: `TakedownAction` (category, then **Confirm take down**),
`PausePill` (Freeze world → **Back / Confirm freeze**), and `EndExerciseDialog` (type **END**).
They do not change what any flow does.

1. **Two taps minimum. A single tap never completes the action.** Long-press and the context menu
   never bypass the step.
2. **Nothing destructive gets autofocus.** Takedown keeps focus on the category. EndEx keeps focus
   on the END field. Freeze opens with no focused button.
3. **The confirm button is placed away from the trigger.** It never covers the trigger's on-screen
   rectangle, so a double-tap cannot land on it. Cancel/Back and Confirm are at least 8px apart
   and at least 44px tall. Confirm sits at the far edge of the step.
4. **Arming delay:** a confirm ignores taps for 400ms after the step opens. This blocks ghost taps
   and double-tap carry-over. Each confirm fires once (the existing in-flight guards stay).
5. Popovers flip or shift to stay fully on-screen at 768 and at 1180. The on-screen keyboard
   never hides the END field or its Confirm button, so lay these out against the visual viewport.
6. Break Fiction, when it is built, inherits all of the above plus BROADCAST type-to-confirm and
   Director gating.

## 6. Never colour-only (NFR-001)

Tab badges, toolstrip badges, the state pill, the demand meter ("N / 6"), the kill-switch mode,
timer warnings ("under 60s") and status chips all carry **text, plus an icon or dot where one
exists**. Colour and pulse only reinforce them. The active tab is marked by `aria-selected`, bold
text and an underline, not by colour alone.

## 7. Out of scope

- Evaluator on tablet (B4): waits for track 5 (real data) and Session A's role model. Today role
  guards (`canControl`) apply unchanged at every size.
- Phones for any staff surface; anything below 768px.
- New console features, swipe gestures, drag-and-drop reordering, hold-to-confirm (parked), and
  any change to desktop at 1280px and wider.

## 8. Proposed decisions (to append to `../DECISIONS.md` on sign-off)

- **D5-021: Tablet bands.** Landscape covers 1024–1279 and portrait covers 768–1023, selected by
  width. Touch sizing is gated separately by `(pointer: coarse)`. Desktop at 1280 and up does not
  change.
- **D5-022: Tablet pane layouts, chosen by one constant.** A single layout table (for example
  `CONSOLE_TABLET_LAYOUTS` keyed by viewport band) picks the arrangement, so changing a layout is
  a one-line config edit, not a code fork. Signed initial values:
  - 1024–1179 landscape: one switcher (Live world / Run sheet) plus docked 296px Review queue.
  - ≥ 1180 landscape: **side by side** (Live world | Run sheet, about 414px each) plus docked
    Review queue. Expected to be revisited after hands-on use.
  - Tall portrait (≥ 820 wide and ≥ 1100 tall): **stacked**, with the Live world / Run sheet
    switcher above a docked Review queue.
  - Other portrait (768–1023): full tab switcher, with Review as a badged tab.

  Panes stay mounted in every arrangement.
- **D5-023: Command band.** The kill switch, demand and needs-review readout, Pause/Freeze and
  EndEx share one sticky strip. It is never tabbed, never in overflow, and never covered.
  Kill switch and EndEx sit at opposite ends.
- **D5-024: Touch parity.** Every shortcut has a visible 44px control (table in §4). Hints show
  the platform modifier, ⌘ on iPadOS.
- **D5-025: Deliberate confirms on touch.** Two taps minimum, no destructive autofocus, confirm
  placed away from the trigger, 400ms arming delay. **The kill switch's STOP → Live re-arm needs a
  confirm on touch** (Tom, 10/16). Stopping stays one tap.
- **D5-026: Tablet secondary controls.** Steering (escalation dial and noise) becomes a disclosure
  row, **collapsed by default, one tap away** (Tom, 10/16). Export and Report go to a "More" menu.

## Answers from Tom (10/16), folded into §2 and D5-022/025/026

1. **820×1180 portrait:** "I think stacked view initially." Tall portrait uses the stacked layout
   (Live world / Run sheet above a docked Review queue).
2. **1180×820 landscape:** "side by side, probably will change after playing with it though."
   Side by side is the initial value of the layout constant (D5-022).
3. **STOP → Live confirm on touch:** "yes" (D5-025).
4. **Escalation dial one tap away by default:** "yes" (D5-026).
