# DECISIONS.md — Pulse design sessions

## D7 — Application Shells (session 5)

Session 5 · unifies the improvised chrome of D1 + D5 (COMPONENTS.md inventory, R-006).
Mockups: `Pulse Shell.dc.html` (participant, desktop + mobile side by side) ·
`Pulse Staff Shell.dc.html`. Contract: SHELL-CONTRACT.md · retrofits: RETROFIT-NOTES.md.

### D7-001 — Participant nav: one global channel strip; mobile bottom tabs (user: decide-for-me)
A 38px shell-owned strip under the alert bar — channel names as plain links, current channel
marked, scenario dateline at right (COR-061/062). Rejected per-channel headers + switcher: that
is the "channel-specific chrome re-implementations" anti-pattern, re-guessed every session.
Anchor: the network strip on real media properties. Deliberately quiet so it never competes
with channel mastheads; no instructional text. Mobile: shell bottom tab bar (COR-061 mobile).

### D7-002 — Alert bar: 4 states, chip anatomy, emergency never collapses (PRT-010/011/012)
none = zero height · info `#3d6a96` · advisory (D1/D2 amber, exact) · emergency solid `#b3261e`.
Icon + text chip + color, never color-only (NFR-001). Scenario timestamp + Details → history.
Info/advisory scroll-collapse to a compact line; emergency never collapses; never dismissable.
Multi-alert: highest severity + "+N more" expands stack. Per user "explore options": three
treatments built as a tweak (band / compact / ticker); **band recommended**; ticker noted as a
D3 outlet-skin option.

### D7-003 — Break-fiction overlay: hazard black/amber mono, canonized from D5-007 (CTL-024)
Full-bleed above ALL chrome incl. compliance banners (COR-065 top z). Wall-clock time — the only
real time a participant ever sees. No dismiss affordance, no brand, alien to both worlds.
Console keeps only the trigger.

### D7-004 — Pause/EndEx: two registers, only break-fiction gets the alarm (CTL-023, COR-054)
In-fiction = neutral maintenance/offline pages (system-ui, zero exercise language). Out-of-
fiction = calm slate/mono control pages (EXERCISE PAUSED / ENDEX + hot wash). Render below
compliance chrome (banners stay visible), above content.

### D7-005 — Containment models per world (resolves COMPONENTS.md divergences #1/#8)
Participant = D1's model: two fixed 22px green banners, app frame inset (COR-031 "outside the
frame"). Staff = D5's model: one 20px dark top bar in flow. The asymmetry is deliberate — it is
half of the thumbnail-distinguishability gate (D0 §2 / E1 §5).

### D7-006 — Classification strings stay per-world (user decision; divergence #2)
Participant `UNCLASSIFIED // EXERCISE`; staff `UNCLASSIFIED // FOUO`. Both are config tokens,
not hardcoded copy (COR-066).

### D7-007 — Staff shell extracted from D5 verbatim + the two missing COR items
exbar, brand lockup, identity badge (COR-005), clocks, state pill, presence adopted unchanged.
Added: Participant-admin quick panel as a toolstrip tool (COR-017, per D5-017 extension rule)
and header "Preview as participant" (COR-041) — opens the participant shell inside the staff
frame with a scenario-moment picker (StartEx/Advisory/Burst/Now), read-only, moment drives the
preview's alert state and portal content. Surface name/role line are frame config (evaluator
dashboard inherits, D6).

### D7-008 — Variants (COR-064): read-only removes, kiosk strips
Read-only: affordances absent, not disabled (COR-015) — composer, Post button vanish. Kiosk
(PRT-040): compliance chrome, channel strip, and tab bar all removed; alert bar persists
(PRT-010). Chrome-off is a legal state and layout survives it.

### D7 open / deferred
- Alert-bar treatment decision (band vs ticker) — user reviewing the exploration tweak.
- Shell as a real shared component (both mockups currently keep their own chrome) — retrofit
  is documented, execution deferred to the frontend build.
- Preview-as-participant channel coverage: portal stub only; other channels render in the
  real implementation.


## D2 — "Fairhaven Today" Portal (session 4)

Session 4 · anchor: local TV-station / local-news homepage. Mockup: `Fairhaven Today Portal.dc.html`.
Scope (user): homepage normal + incident/alert states + resources shelf; desktop-first (mobile
pass later, like D1); clickable nav, static content; Tweaks-driven states.

### D2-001 — Aggregator identity distinct from Pulse and the outlets
"Fairhaven Today" reads as the *aggregator*: story cards carry outlet source chips (Newsline 7,
Courier-Ledger, The National Wire, The Weather Desk) — the portal claims curation, not authorship.
Brand: Libre Franklin, station-blue masthead + gold "TODAY", red breaking accent. No Figtree, no
crimson (those are Pulse); no Cadence navy chrome (staff world).

### D2-002 — Three visual directions as a Tweaks enum (user: explore options)
`direction`: **broadcast** (deep station-blue band masthead, gold accent — recommended default),
**digital** (white masthead, teal accent, rounded), **print** (cream, Newsreader serifs, oxblood).
Print risks colliding with the D3 Courier-Ledger skin — noted; broadcast recommended.

### D2-003 — Three homepage layouts as a Tweaks enum
`layout`: **anchor** (hero left + 336px rail), **band** (full-width dark hero band), **grid**
(stacked, 3-col stories, modules as a bottom row). Same DOM, grid-template-areas swap.

### D2-004 — World state shifts the whole page, not just the bar (E3 §3)
`worldState`: normal / informational / advisory / emergency. Each state swaps lead story, top
stories, Pulse rail, trending, press list, dateline. Emergency adds the mood shift: page bg cools,
masthead takes a red under-rule, WATCH LIVE goes red, lead kicker becomes "● EMERGENCY · LIVE
UPDATES". Alert bar severities styled per PRT-011: text chip (INFO/ADVISORY/EMERGENCY) + icon,
never color-only; advisory bar palette matches D1's alert bar exactly.

### D2-005 — Channel toggles hide module AND nav link (PRT-004/020)
`showSocial/showWeather/showPress` remove the rail module, its header-nav link, and its footer
link together — a disabled channel leaves no dangling doors. Trending is portal-native and always
renders, so the rail never empties. Nav is visible top-level links (brief's recommendation),
right-aligned Alerts link; alert-bar "Details →" routes to the same Alerts destination.

### D2-006 — Cross-surface consistency (R-001/R-004 applied)
Pulse rail uses the canonical scallop seal (#2D9CDB), duotone silhouettes for humans, monograms
for orgs, and the D1 cast (@FulcoEM, @FairhavenWater, @mvega_fh, @tbrandt41, @Newsline7). The
Pulse module header carries the crimson heartbeat mark. Compliance chrome: same 22px green
banners as D1. Advisory content = Zones 2–4, Millbrook plant, 6 PM lab results (D1 timeline).

### D2-007 — Resources shelf drops the news costume (PRT-022)
Resources renders in system-ui with exercise-green framing and an "EXERCISE MATERIALS" badge —
deliberately not news-styled. Copy states the schedule is the only page with real wall-clock
time (COR-053 kept everywhere else; the fiction is never annotated inside the fiction — no
"scenario time" labels on the news pages). Entry points: quiet hairline link + footer link.

### D2-008 — Watermark slot (NFR-008)
Hero photo placeholder reserves a bottom-right "EXERCISE" corner chip — the in-content mark slot,
designed now per D0 §4.7.

### D2 open / deferred
- Alerts history page (PRT-012) — stub only; content pass later.
- Kiosk/TTX mode (PRT-040/041) — not this session (user scope).
- Mobile pass — portal is many participants' phone home; own frame later, like D1.
- VERIFY-desk story cards tease the SOC-052 impersonation arc (advisory/emergency sets) — kept,
  flag for story-agent review.


## D1 — Pulse Social App (session 2)

### D1-001 — Accent = Cadence navy `#1e3a5f` (default)
User direction: the Pulse accent matches Cadence's primary navy rather than a consumer-brand
color. Per-exercise rebrand swatches (COR-030) retained as alternates. Applied to the accent
prop default + fallback.

### D1-002 — Thread view: flattened (q1 RESOLVED)
User reviewed the flattened vs nested comparison and chose **X-style flattened** (ancestry
above the focused post, replies below). Compare toggle and nested view removed from the mockup.

### D1-005 — Layout anchors left, not centered
User preferred the left-panel feel of columns mode: the frame is now left-anchored in every
mode (nav rail hugs the viewport edge), instead of X-style centered.

### D1-003 — Org account switcher is one-identity-at-a-time (SOC-006)
Participants switch the "Posting as" chip (personal ↔ granted org accounts); never multiple
personas simultaneously. Many-personas-at-once is the controller/SimCell job and lives in the
Controller Console persona picker, not the participant app. Observer role renders no composer.

### D1-004 — Desktop-first pass; mobile is a separate frame
This mockup is fixed desktop (per user's "desktop first / PIO hunting" answer), no breakpoints.
The mobile citizen experience (D0 §4.6 mobile-first) is planned as its own frame in a follow-up.

## Adversarial review — responses (session 3)

### D1-R1 — "Official sources" → "Who to follow" (critical, ACCEPTED)
Platform-labeled authority violated SOC-002/052. Renamed to the familiar "Who to follow"
(SOC-053); the imposter's presence there is now a legitimate controller lever, not a platform
lie. Checkmark absence remains the only credibility signal.

### D1-R2 — Org chip renders only with org grants (ACCEPTED)
"Posting as" chip + Columns toggle now render only when the user holds org grants
(new `orgGrants` tweak, default on — demo persona Dana holds PIO grants). Citizens get the
clean X composer and no Columns toggle: no fiction leak.

### D1-R3 — Alert bar / observer state (REJECTED — reviewer missed it)
Both already exist as Tweaks-driven world states (`worldState: alert`, `observer`), by design
outside the fiction (D1-002, session 2). Reviewer saw the normal state only.

### D1-R4 — Data contradiction made coherent (ACCEPTED, resolved toward coherence)
Utility post now acknowledges the county advisory ("precautionary boil advisory stays in
effect while lab results are pending") — real-world-consistent tension (utility cautious, EM
decisive) without incoherence. A deliberate ADP-003 contradiction inject remains a controller
move, not baked into default mock data.

### D1-R5 — Minor fixes (ACCEPTED)
Trend rows: varied category labels. Notifications bell: count badge (3 / 5 alert / 99+ burst).
Character counter: X-style depleting ring, count appears at ≤20 remaining. Dark mode moved from
primary nav into the account (…) menu; Columns gated per D1-R2.

### D1-R6 — Deferred (logged, not this pass)
Photo avatars via avatar library (COR-024) — initials are placeholders; the near-duplicate FW
avatars are intentional for the impersonation pair. Mobile frame. Spec note: feed updates use
aria-live=polite regions (new-posts pill, notification grouping notice) — NFR-001 launch gate.

---

# Pulse Controller Console (D5)

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

---

# DECISIONS.md — Pulse Social App (D1)

Session 2 · Phase 1 build · the flagship participant surface. Anchor: X/Twitter familiarity
(original Pulse design — no cloned pixels). Desktop-first this session (PIO hunting mode);
mobile pass to follow. Mockup: `Pulse Social App.dc.html`.

## D1-001 — Session scope (screens chosen for the user)
**Decision.** All nine brief screens except a dedicated mobile pass: Feed (All Posts /
Following), Thread (flattened + nested comparison), Composer (inline + modal + org switcher),
Search (#WaterIssues, Top/Recent, People), Explore/Trending (+ desktop sidebar), Profile
(@FulcoEM), Notifications, DMs (Newsline 7 reporter thread), and the PIO multi-column toggle.
Clickable navigation, static content (user's interactivity choice).
**Satisfies.** D1 §Key screens, SOC-080/081/082, SOC-040/041/050/054/060/070.

## D1-002 — Demo state machinery lives in Tweaks, not in the fiction
**Decision.** World-state (normal / burst / alert) and read-only observer mode are component
props surfaced in the host Tweaks panel — never controls inside the app frame. Dark/light and
PIO columns ARE in-fiction user settings, so they are real toggles in the nav rail.
**Rationale.** Nothing breaks fiction (XC-002); demo scaffolding stays out of the participant
world. **Satisfies.** COR-053-adjacent hygiene, D0 §2 cardinal rule.

## D1-003 — Visual identity: original "Pulse", not a skin of X
**Decision.** Figtree type, pill nav, heartbeat-line logomark, crimson accent `#DB3A54` as a
CSS custom property with curated per-exercise swatches (crimson / blue / teal / violet) —
the COR-030 theming hook. Verification mark is a fixed seal-blue (#2D9CDB) independent of the
exercise accent: rebranding an exercise must never alter the trust signal trainees are being
trained on (SOC-052). Dark + light modes, working toggle, light default.

## D1-004 — Compliance chrome + alert bar layering
**Decision.** 22px green EXERCISE banners fixed at both viewport edges, outside the app frame
(COR-031, Looking Glass precedent). The PRT-010 alert bar renders *inside* the app at the top
of the scroll area, sticky, amber with an "⚠ ADVISORY" text chip — severity never color-only
(NFR-001). It persists across every screen including PIO columns.

## D1-005 — Burst state: "New posts" pill, aggregated notifications
**Decision.** Bursts never live-insert into the reading stream: a sticky accent pill ("▲ 218
new posts", aria-live=polite) buffers them; notifications collapse to aggregates ("Newsline 7
and 41 others liked…") with a one-line "grouped" notice. **Satisfies.** SOC-070/071, NFR-002;
calmer than live-insert per the brief.

## D1-006 — Thread: flattened recommended; nested built for comparison (q1)
**Decision.** Thread view defaults to X-style flattened (ancestry above the focused post,
replies below). A "Flattened | Nested" segmented control (tagged COMPARE · q1) renders the same
conversation as an indented tree for the design review. The nested view carries an inline note:
depth beyond ~3 levels truncates on real content — the argument for the flattened default.
Recommendation stands: **flattened**; the toggle is review scaffolding to be deleted once q1
closes.

## D1-007 — Org account switcher = "Posting as" chip (SOC-006)
**Decision.** Composer (inline + modal) carries a "Posting as: {account} ▾" chip above the
text field — accent-tinted when an org account is selected, neutral for the personal account.
Menu lists personal + granted org accounts with a hint line ("granted for this exercise").
Anchor: Instagram/Gmail account switching, per the brief — visible before you type, so you
can't post as the wrong principal by muscle memory.

## D1-008 — Impersonation pair woven through the content (SOC-052)
**Decision.** @FairhavenWater (verified, measured copy) vs @FairhavenWaterUpd (no mark, gray
avatar, urgency copy: "share before this gets deleted"). The pair appears in the feed, the
thread (where a citizen calls it out), and side-by-side under People in search results — the
clearest teaching frame. The platform never flags the fake (SOC-002/003): the absence of the
mark is the only signal, as required.

## D1-009 — Tombstone placement (SOC-005, CTL-025)
**Decision.** "This post is unavailable." card appears inside the thread (both layouts), where
takedowns actually read on real platforms. Feed shows no tombstones — removed posts simply
vanish from feeds, matching real behavior.

## D1-010 — PIO multi-column: off-by-default nav toggle
**Decision.** "Columns" switch in the nav rail footer (with dark mode — both are user
settings). On: center+sidebar replaced by TweetDeck-style columns (All Posts · #WaterIssues ·
"boil water" search · Mentions @FulcoEM) with compact post rows, action bar suppressed.
Nav rail persists; toggling back is one click. **Satisfies.** D1 §9, clean-not-busy default.

## D1-011 — Observer mode: controls don't render (COR-015)
**Decision.** Observer prop hides composer, Post button, Follow buttons, DM input, and the
new-posts pill; action rows stay visible as counts (information) but are inert. No disabled
buttons anywhere.

## D1-012 — Follower magnitude (SOC-054)
**Decision.** Profile counts show magnitude (48.2K); expanding Followers lists the 5 real
edges then "…and ~48.2K others" — never a fake scrollable list.

## Open / deferred (D1)
- Mobile pass (citizen experience) — next session; this mockup is the desktop frame.
- DM two-pane is static beyond the featured Newsline 7 conversation.
- q1 (thread layout) — comparison built; awaiting decision, then remove the toggle.
- Watermark slot (NFR-008) on media templates — placeholder media only in this pass.
- Media/quote-post composer states — text + attach affordance only in this pass.


## R — Cross-surface reconciliation (D1 ↔ D5), session 3

### R-001 — Verified mark unified to the D1 scallop seal
The console rendered three ad-hoc star-shaped marks (two #4d97d1, one accent-navy — the exact
failure SOC-052 exists to prevent: the trust mark must never derive from theme color). All three
replaced with the canonical D1 scallop-with-check, fixed seal-blue #2D9CDB, on post cards,
persona palette, and composer identity header. Satisfies SOC-052, D1-003.

### R-002 — Engagement row order unified: reply · repost · like
Console post cards showed ↺ ♡ ↩; the participant app renders reply → repost → like. Console
reordered to match — controllers read the same anatomy participants see.

### R-003 — Console staff overlay: always-visible origin line (user: decide-for-me)
Each console post card now carries one compact mono line participants never see:
`{origin} · FIRED {scenario clock}`. Origin vocabulary: ENGINE · AUTO, SIMCELL-1/2 · MANUAL,
INJ-nnn (matches MSEL inject ids; gov advisory post tagged INJ-042, consistent with the fired
timeline item). Always visible rather than hover-only: hover already carries actions, and
glanceable provenance is the point. Fired time derived from scenario clock minus post age.

### R-004 — Avatars: duotone human silhouettes; orgs keep monograms (user: decide-for-me)
Human accounts on both surfaces render a duotone head-and-shoulders silhouette (white .85 mask
over the persona color — offline-safe, no photo dependency). Org/institutional accounts keep
monograms (logo-analog; also preserves the intentional near-identical imposter pair, both orgs).
Humans — D1: @mvega_fh, @tbrandt41, @kwardFH, @dreyes_fh. D5: darco, maria, aisha, tommy, coral,
ray + the three trainee roster rows. Photo avatar library (COR-024) remains deferred (D1-R6);
this replaces raw initials as the interim treatment.

### R-005 — Worlds NOT merged; mapping documented (user decision)
Each mockup keeps its own demo data; no shared data module. Role-equivalence mapping between the
two Fairhaven water-crisis casts, for anyone reading them side by side:

| D1 (participant app) | D5 (console) | Role |
|---|---|---|
| Fairhaven Water Utility @FairhavenWater | Fairhaven Water Dept @FHWaterDept | official utility voice |
| The Scoop @TheScoopHQ | The Scoop @thescoop | sensational outlet (handle mismatch, left as-is) |
| Newsline 7 @Newsline7 | Maria Solano @maria_solano7 | broadcast news (org account vs anchor persona) |
| Marisol Vega / Tom Brandt / Keisha Ward | Coral Nguyen / Tommy Rourke / Ray Osei / Darco Tripp | citizen archetypes |
| Fulton County EM @FulcoEM | City of Fairhaven @FairhavenGov + Fairhaven Dispatch @FairhavenPSAP | official government voice (split in D5) |

Known divergences, intentional and retained: advisory zones (D1: 2–4; D5: 3–7), scenario clock
(D5 console at 09:33 run-up; D1 feed reads mid-advisory), D5 adds the 911-outage storyline.
These are different exercise sessions in the same fiction family, not one timeline.


### R-006 — Shell extraction: improvised chrome inventoried, frozen pending D7
Both mockups improvised container chrome (exercise banners, brand lockups, identity/role
chrome, alert bar, clock cluster). Full inventory with markup anchors and 8 documented
divergences now lives in COMPONENTS.md ("Shell extraction"). All inventoried elements are
marked "replaced by shell — see D7". No shell design was done in this session; both mockups
keep their improvised chrome untouched so D7 starts from evidence, not memory.


## D3 — Pulse News Outlets (proposal stage)

Per-surface decision log (convention per the D1/D5 handoff dirs). Proposal-stage session:
the shared-grid + token-surface contract and the four outlet registers were reviewed and
**approved**; the full clickable mockup follows as its own deliverable. Anchor per the D3
brief: **real local news sites** — a TV station site, a newspaper site, a wire feed, a
gossip site. Credibility is conveyed by design, and *reading* credibility is the skill
being trained.


---

### D3-P1 — ONE rendering system; four outlet skins as token files (NWS-002)

**Decision.** One article/homepage rendering system; each outlet is a **skin token file**
over it. A fifth outlet is a token file, not a new build. The article page's slot anatomy
is **invariant** across all skins:

1. Shell chrome — owned by the shell, never re-implemented (SHELL-CONTRACT §1: compliance
   chrome, alert bar, channel strip; outlet pages render in the content region only)
2. Outlet masthead + section nav *(skin)*
3. Breaking slot — authorial, **empty by default** (NWS-012)
4. Kicker → headline → dek *(skin type/case/scale; order fixed)*
5. Byline · scenario dateline · share *(fixed: persona block + COR-053 time — skins format,
   never source; share → Pulse link card)*
6. Hero media — image or Beat video, broadcast-style player (NWS-014) — with reserved
   **EXERCISE watermark chip, bottom-right** (NWS-032/NFR-008, matches portal D2-008)
7. Body + pull quote *(skin)*, with **embedded Pulse post** rendered to D1 anatomy
   verbatim (SOC-002/004)
8. Correction slot (NWS-013)
9. Footer: **"Join the discussion on Pulse"** → the outlet's paired post (NWS-031 — no
   comments, ever)

Grid (exhibit 1a): desktop 12-col well, max 1140px; body column 680px (~66ch); optional
340px rail is a skin token. Mobile: one column; rail folds below the body.

**Alternatives rejected.** Bespoke per-outlet layouts — kills the fifth-outlet promise and
re-implements the shell boundary per outlet; the brief's anti-pattern list names
one-skin-fits-all *and* per-outlet builds as the two failure modes.
**Satisfies.** NWS-002/003/010/011/012/013/014/031/032, SHELL-CONTRACT §1, D2-008 parity.

### D3-P2 — The token surface: what a skin CAN and CANNOT touch

**Decision.** A skin **CAN** set: type stack (masthead/hed/dek/body/kicker — face, weight,
case, condensation) · palette (accent, link, bg, rules, breaking color) · density (spacing
scale, rule weights, corner radius) · media treatment (crop aggression, caption style,
player chrome tint) · breaking treatment (banner style + vocabulary) · byline/dateline
format · layout enums (rail on/off; homepage lead mode: `video-lead / text-lead /
list-lead / clutter`) · clutter modules (sanctioned set, **The Scoop only** — busyness as
untrustworthiness signal).

A skin **CANNOT** touch: slot order/anatomy · the scenario-time source (COR-053 — formats
vary, the clock doesn't) · Pulse embed + link-card rendering (D1 anatomy verbatim, seal
`#2D9CDB` fixed — SOC-002/004) · the watermark slot (NFR-008) · share behavior (always
posts an outlet link card to Pulse) · the no-comments rule (NWS-031) · the a11y floor
(NFR-001: AA contrast, ≥16px mobile body, correction-slot semantics) · telemetry
invisibility (NWS-030 — zero reader-visible UI).

**Rationale.** The CAN list is exactly the credibility-register surface (what makes The
Scoop read untrustworthy); the CANNOT list is every trainable signal and compliance
guarantee — those must survive any rebrand, exactly as the verified seal survives exercise
accent theming (D1-003/R-001 precedent).
**Satisfies.** NWS-001/002/030/031, COR-053, SOC-002/004, NFR-001/008.

### D3-P3 — The four approved registers (exhibit 1b)

**Decision.** Approved type/palette per outlet token file:

| Outlet | Register | Type | Palette / idiom |
|---|---|---|---|
| **Newsline 7** | Local TV | Oswald (condensed heds) + Source Sans 3 | Navy `#0f2749`, red `#c8102e`; ● LIVE chip; kicker "BREAKING · WATER CRISIS"; video-forward |
| **The Courier-Ledger** | Newspaper | Newsreader serif (+ Source Sans 3 meta) | Centered nameplate with double rule; restrained grays; small-caps kicker; "By X, Staff Writer" byline; text-forward |
| **The National Wire** | Wire service | IBM Plex Sans + IBM Plex Mono | Timestamp-first (mono, rust `#9a3412`); slug codes (`NW-FAIRHAVEN-WATER-0142`); wire dateline "**FAIRHAVEN, Fulton County (NW) —**"; "BY THE NATIONAL WIRE"; terse heds, minimal art |
| **The Scoop** | Tabloid | Anton (ALL-CAPS heds) + Figtree | Yellow `#ffd400`, magenta `#e6007e`, black; rotated flags ("EXCLUSIVE!!"); yellow highlight marks in heds; chip clutter (TRENDING / SHOCKING / MUST SEE) |

Reading the grid of four: trust decays through type discipline (condensed-urgent →
serif-measured → mono-austere → display-screaming), palette restraint, and clutter count.
The Scoop's chips/rotation/highlights come from its sanctioned clutter-module set — no
other skin can enable them.

**Satisfies.** NWS-002 (credibility diversity as a training feature), D3 brief §"The four
skins", E4 §3 ("participants should be able to *feel* source quality").

### D3-P4 — Breaking is authorial only; corrections have exactly two renderings

**Decision.** **Breaking (NWS-012):** the outlet's own banner in the outlet's own
vocabulary, in the breaking slot, which is empty by default and fills only by
controller/authorial action. The platform never adds badges (SOC-002 parity — the *outlet*
screams BREAKING, Pulse never does). Banner style + vocabulary are skin tokens
("BREAKING NEWS" / "News Alert" / "EXCLUSIVE!!").

**Corrections (NWS-013):** two renderings, both scenario levers, controller-selectable per
correction: **visible editor's-note append** (skin-styled; slot position and semantics
fixed) or **silent rewrite** (body text changes; only the "Updated" scenario-time stamp
changes). An outlet that quietly rewrites vs. transparently corrects is itself a
credibility signal participants can learn.

**Satisfies.** NWS-012/013, SOC-002, COR-053 (the Updated stamp is scenario time).

---

### Status caveat / open / deferred

- **Approved = exhibits 1a/1b only** (grid contract + registers). Article page, homepage,
  breaking state, both correction states, mobile view, and the skin switcher arrive in the
  full-mockup package; do not mark implementation-ready ACs "design final" beyond 1a/1b.
- **Authoring UI (NWS-020…022)** is controller-console territory (E7/D5 patterns); D3
  designed the participant-facing rendering only.
- **Homepage** (NWS-003): lead-mode enum decided (D3-P2); the module set and per-skin
  homepage compositions are full-mockup work.
- **D2 cross-surface note:** the portal's "print" direction (D2-002) risks reading as the
  Courier-Ledger register; portal default remains broadcast (already noted in the D2 log).


## D4 — The Wire Room & The Weather Desk

Running log of design decisions for the Press wire (**The Wire Room**, E5/PRS) and Weather
service (**The Weather Desk**, E6/WX) mockup. Each entry records the choice and the requirement
IDs it satisfies or **amends**. This file goes back to the story/epic agents so design and
requirements stay aligned — see [`STORY-UPDATES.md`](D4-press-weather/STORY-UPDATES.md) for the actionable
amend/add/reconcile/backlog checklist.

Session 5 (D0 §6 order) · Phase 3 surfaces, smaller & institutional · both channels render
inside the D7 participant shell ([`SHELL-CONTRACT.md`](D4-press-weather/SHELL-CONTRACT.md)); the Weather Desk feeds
the shell alert bar. Anchors: municipal newsroom / PR Newswire (Wire Room) and weather.gov / NWS
(Weather Desk). **Status: full clickable mockup, user-approved, including 12 review sign-offs
(D4-013).** Evidence anchors below are class/handler names in
[`Wire Room + Weather Desk.dc.html`](D4-press-weather/Wire%20Room%20%2B%20Weather%20Desk.dc.html).

---

### Part A — The Wire Room (PRS)

### D4-001 — The composer is the letterhead sheet, not a form/CMS
**Decision.** The release composer renders as the finished release artifact: org letterhead +
contact block prefilled and shown as the sheet. The **PDF drop zone IS the body area** (PDF-first,
PRS-002); **headline is the only required input**, auto-suggested from the dropped PDF with a
one-click **"Use as headline"** accept. Rich-text **"Paste from Word"** (formatting kept, sanitized
per NFR-004) is the quiet *secondary* path, not a co-equal tab.
**Sign-off.** Headline **auto-suggest IS in scope** (not a later nicety). Verified against a
stressed-PIO walkthrough: **drop → publish in under 60 seconds.**
**Evidence.** `placeholder="Release headline"`, `From the PDF: "{{sug}}"` + `Use as headline`
(`{{useSug}}`), `Paste from Word instead →` (`{{toRich}}`), `back to PDF drop` (`{{toDrop}}`).
**Satisfies / amends.** PRS-002 (AMEND: adds headline-only-required + auto-suggest + one-click
accept; confirms PDF-first primary, paste-from-Word secondary), PRS-004, NFR-004. Anti-pattern
avoided: CMS admin panel (D4 brief §Anti-patterns).

### D4-002 — Exactly one confirmation gate; nothing publishes on drop
**Decision.** Dropping a PDF never publishes. **Publish** opens a single confirm sheet restating
**org / headline / timing / cross-post** before anything goes out. **Cancel-scheduled** and
**return-to-author** also confirm. No destructive action without confirmation.
**Sign-off (#2).** Cancelling an embargo **notifies approvers and leaves a wire audit trace.**
**Evidence.** `Confirm …` gates; `Publish now` / `Schedule (embargo)` (`{{setNow}}`/`{{setSched}}`).
**Satisfies / amends.** PRS-002, PRS-020 (AMEND: one-gate model; cancel-embargo → approver
notification + audit trace). Aligns with E5 §3 design note "no destructive actions without
confirmation."

### D4-003 — Embargo state is unmistakable by redundancy
**Decision.** A scheduled (embargoed) release shows an amber **"⏱ SCHEDULED — releases in 19m"**
treatment in **three** places: the composer, the author-view wire row, and the release permalink.
On the sheet, the **"FOR IMMEDIATE RELEASE"** line flips to **"EMBARGOED — HOLD UNTIL {time}"**.
Scheduled releases are visible to the author + staff/JIC approvers only, invisible to the public
until release.
**Evidence.** `⏱ SCHEDULED` + `releases at 3:06 PM · in 19m` (wire row), permalink banner
"Releases at 3:06 PM — in 19m. Visible to your organization and JIC approvers only.",
`FOR IMMEDIATE RELEASE` / `EMBARGOED`.
**Satisfies / amends.** PRS-003 (AMEND: the redundant, three-surface scheduled-state treatment +
the sheet headline flip).

### D4-004 — Pulse cross-post is an explicit, unchecked-by-default checkbox with a live card
**Decision.** The "post to our social account" decision (PRS-013) is an **explicit checkbox naming
the org handle, unchecked by default**, and it renders the **exact link card** that will post
(card anatomy per the canonical [`COMPONENTS.md`](COMPONENTS.md) / D1). Deciding *whether and how* to socialize a
release is PIO craft being evaluated, so it is a visible decision, never an implicit side effect.
**Evidence.** `cross-post` toggle + `link card` preview.
**Satisfies / amends.** PRS-013 (AMEND: unchecked default; names the handle; live link-card
preview).

### D4-005 — Org switcher reuses the D1 "Posting as" chip, as "Releasing as {org} ▾"
**Decision.** Multi-org / JIC authors switch org identity via the **same D1 chip pattern** (COR-018)
— labelled **"Releasing as {org} ▾"** — granted orgs only; letterhead, contact block, and paired
handle swap live. **One identity at a time** (SOC-006).
**Evidence.** `Releasing as {{curOrg.name}} ▾` (`{{toggleOrgMenu}}`); letterhead/`MEDIA CONTACT`
bound to `{{curOrg.*}}`.
**Satisfies.** PRS-001, COR-018, SOC-006. Reuses E1 org-grant + attribution and the E2/D1 chip
(see [`../features/posts/06-post-as-organization.md`](../features/posts/06-post-as-organization.md),
[`../features/identity-auth-roles/09-org-account-operation.md`](../features/identity-auth-roles/09-org-account-operation.md)).

### D4-006 — Autosave is ambient state in the sheet header, never a control
**Decision.** Autosave shows as a passive status line (dot + "Saved …") in the sheet header; there
is no Save button. The draft edit timeline is retained for evaluation (PRS-004, disclosed per
NFR-007).
**Evidence.** `{{autosave}}` with a green status dot in the composer header.
**Satisfies / amends.** PRS-004 (AMEND: autosave is presented as ambient state, not an action).

### D4-007 — The approval gate is participant paper, not staff chrome
**Decision.** The JIC/legal approval gate (PRS-021) renders in the **wire's letterhead world**, not
staff console chrome: a **pending list** + a **draft-diff** (struck removals, shaded additions).
**Approve** = a confirm chip, then it releases. **Return REQUIRES a note**; the returned note
surfaces in the author's composer as a **"↩ RETURNED FOR REVISION"** banner.
**Sign-offs.** **(#1)** Approval routing is **per-exercise config with per-org defaults** (off by
default stays true). **(#3)** Returns stay **wire-internal — no Pulse/portal notification** — this
is flagged **open to explore** (see STORY-UPDATES open items), not a shipped guarantee.
**Evidence.** `Approvals` (JIC) tab, `↩ RETURNED FOR REVISION` banner + returner/time, `diff`.
**Satisfies / amends.** PRS-021 (AMEND: participant-surface gate; mandatory return note; returned
note surfaces to author; per-exercise routing + per-org defaults), EVL-010 (approval latency still
captured). **Reconcile:** E5/PRS-021 currently frames the approver as "a participant role or a
controller playing that role" — the *gate UI* is participant paper regardless of who operates it
(a controller uses preview-as-participant / the participant approval view).

### D4-008 — The wire is public to ALL participants, citizens included
**Decision.** The Wire Room is a public destination for every participant, not a
PIO/media-only surface.
**Sign-off (#5).** Confirmed: citizens can read the wire.
**Satisfies.** PRS-010, PRS-011, PRS-012.

---

### Part B — The Weather Desk (WX)

### D4-009 — The Weather Desk speaks NWS verbatim
**Decision.** weather.gov anatomy: zone selector (WX-004), the IBW **What / Where / When / Impacts**
grid on the warning product (WX-010), monospace product text with NWS furniture (`...HEADLINE...`,
`PRECAUTIONARY/PREPAREDNESS ACTIONS`, `&&` / `$$`), and **Issued / Effective / Expires** in scenario
time (COR-053). Severity is **always icon + WATCH/WARNING text chip + color — never color-only**.
**Sign-off (#8).** NWS hues **darkened slightly** so white text clears **WCAG AA** contrast
(warning renders `#8b0000`; watch `#2e6b4f`), while staying recognizably NWS so participants'
instincts transfer.
**Evidence.** `⚠ WARNING`/`WATCH` chips, `Public Sans` product type, `What:`/`Where:`/`When:`/
`Impacts:`, `PRECAUTIONARY`, `#8b0000` warning / `#2e6b4f` watch.
**Satisfies / amends.** WX-001, WX-004, WX-010 (AMEND: IBW grid + NWS furniture specifics),
NFR-001 (icon+text+color; AA-adjusted hues), COR-053.

### D4-010 — A warning feeds the shell alert bar per SHELL-CONTRACT §2
**Decision.** Watch = **advisory ticker**; warning = **emergency band that escapes the ticker** and
forces the full band on **every** channel (portal, Pulse, Wire Room alike). The bar carries **all**
alerts together — weather and non-weather **rotate/stack in one multi-alert bar**. The **same
headline string** appears on the bar, the @WeatherDesk post, the portal widget, and the product
page — **no paraphrase**.
**Sign-offs.** **(#6)** For now, **every warning type forces the emergency band** (no per-type
severity mapping yet — a deliberate, revisit-later simplification). **(#7)** One shared multi-alert
bar for weather + non-weather.
**Evidence.** `wx011-propagation-storyboard.png` (four surfaces, one string); alert-bar cards
`abTicker`/`abBand`; "emergency escapes the ticker and forces the full band … (PRT-010)".
**Satisfies / amends.** WX-011 (AMEND: warning⇒emergency-band "for now"; multi-alert shared bar;
verbatim headline propagation), PRT-010, PRT-011, SHELL-CONTRACT §2.

### D4-011 — @WeatherDesk auto-post is editable pre-publish and console-side; weather is staff-authored only
**Decision.** The @WeatherDesk auto-post (WX-011/WX-020) is **editable before publish, on the
console side**; default text is the **product headline verbatim**. Weather authoring is
**staff-side only via the controller console** — the Weather Desk has **NO participant composer**.
**Sign-offs.** **(#9)** No participant weather authoring. **(#10)** Auto-post text is editable
pre-publish (console-side).
**Satisfies.** WX-011, WX-020, WX-002/WX-012 (staff authoring). **Routing:** both are **D5
controller-console retrofit notes**, not participant-surface stories — routed to
[`D5-controller-console/STORY-UPDATES.md`](D5-controller-console/STORY-UPDATES.md) §E.

### D4-012 — The radar/cone imagery slot reserves the EXERCISE watermark chip
**Decision.** The WX-013 imagery slot reserves the bottom-right **EXERCISE** watermark chip
(NFR-008), matching portal D2-008. Warning products are the highest-risk leak class in the product,
so this is the template that is covered first.
**Evidence.** RADAR tile with absolute bottom-right `EXERCISE` chip (`rgba(46,107,46,.92)`).
**Satisfies / amends.** WX-013, WX-002 (watermark-on-warning), NFR-008 (AMEND: names the reserved
slot + placement).

---

### D4-013 — Package sign-off (12 review sign-offs)
**Decision.** The mockup is user-approved with 12 explicit review sign-offs, folded into the
decisions above. Roster (anchor → decision):

| # | Sign-off | Home |
|---|----------|------|
| 1 | Approval routing = per-exercise config, per-org defaults | D4-007 |
| 2 | Cancel-embargo notifies approvers + wire audit trace | D4-002 |
| 3 | Returns stay wire-internal (no Pulse/portal notification) — **open to explore** | D4-007 |
| 4 | Cross-post is opt-in (unchecked default), names handle, live card | D4-004 |
| 5 | The wire is public to all participants, citizens included | D4-008 |
| 6 | Every warning type forces the emergency band, **for now** | D4-010 |
| 7 | One multi-alert bar carries weather + non-weather together | D4-010 |
| 8 | NWS hues darkened for WCAG AA white-text contrast | D4-009 |
| 9 | Weather authoring is staff-side only (no participant composer) | D4-011 |
| 10 | @WeatherDesk auto-post is editable pre-publish (console-side) | D4-011 |
| 11 | Headline auto-suggest from the PDF is in scope | D4-001 |
| 12 | Autosave is ambient state, never a control | D4-006 |

> Sign-offs #3 and #6 are explicitly provisional ("open to explore", "for now") and are logged as
> open items in [`STORY-UPDATES.md`](D4-press-weather/STORY-UPDATES.md), not as settled guarantees.
