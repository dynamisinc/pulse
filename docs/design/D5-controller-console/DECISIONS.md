# DECISIONS.md — Pulse Controller Console (D5)

Running log of design decisions for the Controller Console mockup. Each entry records the
choice, alternatives considered, and the requirement IDs it satisfies. This file goes back
to the story agents so design and requirements stay aligned.

Session 1 · Phase 1 build · sales-demo asset. Anchors: Cadence conduct views + TweetDeck +
command-palette (Ctrl+K). Hard budget: **CTL-034 ≤ ~6 controller decisions/min at burst.**

---

## D5-001 — Three-region desktop layout, fixed side rails
**Decision.** Left rail (fixed ~300px) = conduct timeline; center (fluid) = TweetDeck live-world
columns; right rail (fixed ~360px) = storyline board + escalation dial (top), review queue
(middle), persona dock (bottom).
**Alternatives.** (a) Queue on top of the right rail — rejected: the storyline board is the
"where do I look" glance and belongs at eye-top; the queue is worked with the keyboard, not the
eye, so its vertical position matters less. (b) Composer as a permanent right-rail panel —
rejected, see D5-004.
**Satisfies.** E7 §3 (layout), CTL-010…015 (timeline), CTL-030/031 (columns), CTL-001…005 (dock),
CTL-022 (dial). Anti-pattern avoided: enterprise sprawl → density *with hierarchy*.

## D5-002 — Dark operator chrome; COBRA light "paper" for modals/composer
**Decision.** The console shell is dark Cadence operator chrome. COBRA components (light navy/
silver MUI) carry the dialogs, composer, and confirmations — layered as light surfaces over the
dark shell, exactly as Cadence conduct views do. COBRA buttons appear on every action surface.
**Rationale.** The bound DS renders light; forcing it dark would "recreate/restyle" it (forbidden).
Layering light modals over dark chrome is idiomatic Cadence and keeps the console unmistakably a
staff surface. **Satisfies.** D0 §2 (never confusable w/ participant world), staff-world dark chrome.

## D5-003 — Live "decisions/min" HUD in header (governs CTL-034)
**Decision.** A compact meter in the header fills toward 6 and turns amber past it, reading a
rolling 60s window of controller decisions. **Rationale.** Turns the acceptance criterion into a
visible, self-regulating cue and a demo proof-point. **Satisfies.** CTL-034. Confirmed by user.

## D5-004 — Composer is a summoned overlay, not a standing panel
**Decision.** Ctrl+K → persona picker → composer opens as a focused light overlay near center,
dismisses on send. **Rationale.** Keeps the right rail from being a wall of form fields
(clean-not-busy); makes the <10s reply a single keyboard flow. **Satisfies.** CTL-001…003,
E7 §3 Darco Tripp moment, "≤3s to composing", zero-modal-friction on fire path.

## D5-005 — Review queue = the load throttle, built as inbox triage
**Decision.** One-key A (approve) / V (veto) / E (edit) / R (re-roll) on the focused row, B =
batch-approve-visible; delayed-auto items show a countdown ring and **auto-fire on expiry**
(inaction is a valid disposition, so ignoring them costs zero decisions). **Rationale.** This is
the mechanism that holds burst load ≤6 decisions/min. **Satisfies.** ADP-040, CTL-034,
critical-moment #3 (feels like inbox triage, not form-filling).

## D5-006 — Non-modal prompts on the fire path
**Decision.** Fire = one inline confirm chip (no modal). Response-match (ADP-002a) = lightweight
toast with Y/N. Takedown = ⋯ → 2 clicks + incident category. Off-platform marker = one click on a
storyline card. **Rationale.** Zero modal friction on routine actions (anti-pattern). **Satisfies.**
CTL-025, CTL-026, ADP-002a, critical moments #1/#4/#5/#6.

## D5-007 — Break-fiction broadcast is the one heavy gate; overlay is visually alien
**Decision.** REAL-WORLD BROADCAST is Director-gated (locked for Controller role), requires
type-to-confirm ("BROADCAST"), and its overlay is high-contrast amber/black hazard chrome,
monospace, full-bleed — deliberately unlike every other surface ("house lights"). **Satisfies.**
CTL-024, D0 §2 (alien to both worlds), CTL-023 (pause w/ in-/out-of-fiction page choice).

## D5-008 — Always-visible engine kill switch
**Decision.** Red engine control pinned in the header (never scrolls), one click → Suggest-only /
Stop. **Satisfies.** ADP-042 (kill switch always visible, one click).

## D5-009 — Status & severity never color-only
**Decision.** Timeline status chips and storyline severity carry a text label + shape/dot in
addition to color. **Satisfies.** NFR-001 (WCAG 2.1 AA), D0 §4.1.

## D5-010 — Progressive disclosure: calm Focus default + "Needs you now" action bar
**Decision.** Console defaults to a **Focus** mode that collapses completed injects behind a
"Show N completed" bar and foregrounds only actionable items; a persistent **"NEEDS YOU"** action
bar under the header names the current to-dos ("Fire BND-07…", "N awaiting review", "N auto-sending
soon") and carries a dismissible first-run shortcut hint. A **Focus ↔ Full view** header toggle
flips between the calm default and the dense mission-control view.
**Problem addressed.** First-glance legibility — the dense layout showed *state* well but didn't tell
a controller what they could *do*. **Rationale.** Density stays available (Full view) for trained
operators; the default answers "what needs me now" without hiding monitoring surfaces.
**Satisfies.** D0 §1 (clean, intuitive, not busy; density opt-in), CTL-034 (directs attention to the
few decisions that matter), critical-moment framing.

## D5-011 — One ambient pane for monitoring; views/tabs only for task & secondary surfaces
**Decision.** The three monitoring regions (timeline / live world / storyline+queue) stay on one
always-visible pane. **Task** surfaces (composer, takedown, batch disposition) are summoned overlays
that dismiss on completion — not panes. **Secondary workspaces** that don't need continuous
awareness (participant admin COR-017, evaluator analytics CTL-033/D6, deep MSEL editing) are the
right candidates for separate tabs/routes.
**Rationale / alternatives.** Full tabbing of the monitoring trio was considered and rejected: the
core promise (one controller believably running a world) fails if an emerging spike is missed while
heads-down in another tab ("out of sight, out of mind"). Ambient visibility is the defense, per the
burst-legibility requirement. A tabbed model remains viable *if* paired with cross-tab alerting
(badges/toasts that pull the controller back); that trades a little safety for calm and is a valid
future direction for lower-stakes deployments.
**Satisfies.** SOC-071/NFR-002 (burst legibility), CTL-034, D0 §2 (staff monitoring world).

## D5-012 — Legibility pass (user session feedback, round 2)
**Changes.** (a) Review queue reclaimed as the right rail's primary space: storyline cards are
compact one-liners (name + severity + intensity) that expand on click for steering (dial,
sentiment, expected action, off-platform); persona dock capped with internal scroll. (b) "CONDUCT ·
MSEL" → "INJECT SCHEDULE · MSEL". (c) Every header control and post hover-action carries a plain-
language tooltip; acting-role is an explicit "Role: Controller" button. (d) "NEEDS YOU" chips
locate-and-highlight, never act — nothing fires without an explicit Fire press. (e) Response-match
toast moved top-center with amber accent, copy names the expected action, and it is asked about
*trainee* posts (a simulated @FH_PIO post demonstrates it) — asking about the controller's own
reply was conceptually wrong. Own sends now get a quiet "Posted as @handle ✓" confirmation.
(f) "Off-platform logged" → "Log off-platform response" + tooltip (CTL-026). (g) Exercise switcher
is a static identity badge during live conduct (COR-005 identity intent kept; switching is a
pre-conduct concern). (h) Shortcut hints spelled out ("A approve · V veto").
**Satisfies.** D0 §1, CTL-034, ADP-002a, CTL-026, COR-005, NFR-001.

## D5-013 — Right rail: queue is the primary citizen; sections self-describe
**Changes (round 3 feedback: "right column still not useful").** (a) Persona dock reduced to a
single avatar strip + ⌘K pill (it's a launcher, not a monitor — full cards were redundant with the
palette and stole a third of the rail). (b) Storyline cards start fully collapsed (one line: name +
severity + intensity); steering expands on click. (c) The engine review queue gets all remaining
rail height — it is where most controller decisions happen and now reads that way. (d) Every region
carries a one-line plain-language caption (visible in Focus mode, hidden in Full view) that states
its job: schedule = "fire/hold/skip as due", live world = "the platform trainees are inside",
board = "how hot each arc is running — click to steer", queue = "engine drafts awaiting your call".
**Satisfies.** D0 §1 (density opt-in), CTL-034, ADP-040, CTL-001…005.

## D5-014 — Design review v1 response (safety + usability batch)
**P1 principle fixes.**
- **Timeout = auto-HOLD (default).** Expired timed drafts now hold for the controller ("timer
  expired — held for you", surfaces in NEEDS YOU) — silence is never approval. Auto-send exists
  only as an explicit **"swamped mode"** toggle in the engine menu (per-exercise setting; the
  controller raises autonomy deliberately, automation never escalates itself). [1.1, DECISION:
  auto-hold default, lead controller configures]
- **Break Fiction (renamed from Real-World Broadcast).** Clarified semantics: it replaces
  participant screens *inside the exercise*; nothing leaves the platform. Control moved into a
  visually distinct GUARDED group (dashed amber enclosure) physically separated from Pause by the
  engine control + divider; confirm dialog now states destination and that every use is logged.
  Director gate + type-to-confirm retained. [1.2]
- **Tiered pause.** Pause opens three tiers: *Pause injects* (world keeps living) / *Pause engine*
  (no new AI content) / *Freeze world* (guarded, participants notice, safety stops only). Header
  state pill reads INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN; scenario clock stops only on
  freeze. Broadcast implies world-freeze. [1.3, DECISION: 3 tiers as recommended]
**P2 usability fixes.**
- Counts reconciled: "2 of 5 need review" / "N timers under 60s" vs queue's "5 pending". [2.1]
- **Intensity = actual + target on one track.** Engine drives actual toward the controller's
  target; click the track to set target (white tick, "78 →60" readout). [2.2, DECISION: both]
- **Column flow control:** hover a column to pause it; new posts buffer behind a sticky "N new —
  paused while you read" pill; click to catch up, mouse-out resumes. [2.3]
- **Composer persona salience:** persona category (citizen / official / news) tints the composer
  header + border and labels it "POSTING AS CITIZEN VOICE / OFFICIAL ACCOUNT / NEWS". [2.4]
- **Overdue held injects** show "Held — N min past its scheduled time" and surface as a hot
  NEEDS YOU chip. [2.5]
- **Header decongested:** workload meter moved to the action bar; engine control no-wrap +
  no-shrink (was the truncation victim); Role sits with the guarded group it gates. [2.6]
- **Metric renamed "queue pressure"** — decisions demanded per minute, a design budget (CTL-034),
  explicitly *not* a controller-performance measure; tooltip states this. [2.7, DECISION: it is
  demand; staff-performance surveillance rejected]
**P3 (partial / placed).** Trainee signal line per storyline ("@FH_PIO posted 2 min ago" / "No
official post yet — 21 min") [3.1 partial — full PIO monitoring earmarked for its own surface];
sentiment already per-storyline, global mood deferred [3.2]; rumor-as-first-class-object deferred
to Storyline Board v2 [3.3]; **"Flag" hover action** on every post writes to the after-action
record [3.4].
**P4.** Duplicate #WaterIssues tag removed; INJ/BND legend tooltip on every id chip; metadata
type bumped ~1px across chips/labels for 8-hour legibility; **Time-jump guarded while RUNNING**
(requires pause first).

## D5-015 — Persona launcher is a button; laptop responsive clamps
**Changes.** (a) The persona dock's launcher looked like a search input; it is now an explicit
primary button ("Reply as a persona ⌘K") — it *starts an action* (opens the persona picker →
composer), it doesn't filter anything. (b) Laptop fit: ≤1420px the rails narrow (272/336), columns
284px, wall clock/presence/brand-sub collapse, scenario clock shrinks; ≤1180px further trims
(state pill, guard label, hint). Core loop verified to fit a 1280×800-class browser viewport with
2 live columns visible and horizontal scroll for the rest.
**Satisfies.** D0 §1 (intuitive affordances), NFR responsive-staff-surface intent.

## D5-016 — Toolstrip + flyouts for casually-used features; personas leave the rail
**Decision.** New 56px toolstrip on the right edge with three tools: **Reply** (opens the ⌘K
persona picker), **Cast** (personas flyout), **Trainees** (trainee-monitor flyout). Flyouts slide
over the right rail, Esc/✕ closes. The right rail is now just storylines + engine review queue.
**Rationale.** Trainee monitoring and the persona roster are *consulted at decision moments*, not
continuously watched — they don't earn permanent rail space (user direction; answers 3.1 as
"flyout"). Personas doubly so: it's a launcher and ⌘K already covers it. The queue — the actual
decision surface — gets the space.
**Trainee monitor content (3.1).** One card per trainee: role, live status (ACTIVE / IDLE 21M /
DRAFTING), last action, and the adaptive-loop metric (response time vs target, expected action
progress). The storyline cards keep their one-line trainee signal for at-a-glance use.
**Satisfies.** D0 §1 (progressive disclosure), CTL-034, ADP trainee-response loop (partial 3.1).

## D5-017 — Toolstrip semantics: Reply = verb, Cast = directory; toolbox is the extension point
**Clarification (user question).** Reply is the one-shot action (⌘K picker → composer, the <10s
path); Cast is the reference roster (voice cues, presence/ownership). Both can end in the
composer; captions now state the split. **Extension point (user direction, endorsed).** The
toolstrip is the designated home for future casually-used surfaces so the rail never re-bloats:
candidates = participant admin quick-panel (COR-017), evaluator flags/annotations (3.4 full),
rumor tracker (3.3), exercise settings (timeout mode etc.). Rule of thumb: continuous-watch
surfaces earn rail/column space; consult-on-demand surfaces get a tool + flyout.

## D5-018 — Reply/Cast merged into one Personas tool; Rumor Tracker mocked (3.3)
**Merge (user feedback: no perceivable difference).** Both tools ended at picker → composer, so
the Cast flyout is deleted. One **Personas** tool opens the ⌘K picker, which now carries the
roster info that justified Cast: presence dot per persona and "held by SimCell-2" on controlled
ones. One concept, one surface.
**Rumor Tracker (future-tool mock, replaces Cast in the toolstrip).** Rumors as first-class
objects per review 3.3: claim + lifecycle chip (SEEDED → SPREADING → COUNTERED → dead), origin
(inject-seeded vs organic), reach bar with trend, mutation line (“smell” → “toxic spill
cover-up”), countered-by credit, and a single action — "Draft counter as…" → persona picker.
Demonstrates the toolstrip extension pattern (D5-017).
**Satisfies.** D0 §1 (one concept, one surface), review 3.3 (mock).

## D5-019 — Storyline board moves to the toolbox (badged); queue is the rail's sole tenant
**Trigger.** At laptop widths the right rail crowded the live world ("overlapping" perception —
no actual overlap, but a rail nearly as wide as the world). User asked which rail sections must
be always-visible vs toolbox-with-badges.
**Decision.** (a) **Engine review queue stays permanently visible** — it is the decision surface;
the auto-hold loop and one-key triage cannot live behind a badge (CTL-034, ADP-040). It now owns
the whole rail, which also narrows (336/312/296 by breakpoint), returning width to the live world.
(b) **Storyline board → toolstrip flyout** ("Stories" tool, first position) with a status badge:
red + pulsing with the count of ESCALATING storylines, calm navy count otherwise — the visual cue
that pulls the controller in when state changes. Opens with the hottest storyline pre-expanded.
NEEDS YOU remains the cross-cutting urgency channel (overdue holds, expiring timers).
**Rule reaffirmed (D5-017).** Continuous-watch = rail/columns (queue, live world); steer/consult
= toolbox + badge (stories, rumors, trainees, personas).

## Known environment quirk (accepted)
`_ds_bundle.js` intermittently logs `TypeError: Cannot set properties of undefined (setting
'jsx')` at load (a JSX-runtime shim race inside the bundle). Benign: `window.CadenceDS` still
exposes all 9 exports and COBRA components render. Not fixable from the page side; accepted.

## D5-020 — Live-world columns: whole-column display, no slivers
**Trigger.** Persistent "queue overlaps the posts" perception: a partially-scrolled column was cut
mid-post at the rail edge. Edge fade + snap + rail shadow (first attempt) reduced but did not kill
it — the sliver itself was the problem.
**Decision.** Columns size to an exact fraction of the visible track (`--nvis = floor(track/300)`,
ResizeObserver-driven): you always see 1/2/3/4 *whole* columns and scroll by whole columns.
Nothing is ever clipped under the rail. Rail keeps its elevation shadow; posts/min caption hides
at narrow widths.
**Satisfies.** SOC-071/NFR-002 burst legibility, D0 §1.

## Open / deferred
- Evaluator read-only variant (CTL-033): steering controls *absent, not disabled* — noted, not in
  this mockup pass.
- Participant admin quick-panel (COR-017): StartEx login triage — noted, not in this pass.
- Watermark slot (NFR-008): participant-content concern, not the console.
