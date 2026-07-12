# Handoff: Pulse Controller Console (D5) — v1

## Overview
Clickable design mockup of the **Pulse Controller Console** — the SimCell operator surface where
ONE controller runs a believable simulated social-media world during an emergency-management
training exercise (ScenarioForge family: Cadence conduct + Pulse world + Beat media). Scenario
data: Bay Shield 2026 (water-contamination + 911-outage storylines, 10 personas).

This package exists to (a) update the epic/user stories to match the design decisions made in
review (see `DECISIONS.md` — every decision cites the requirement IDs it satisfies or amends) and
(b) let a Claude Code session implement the console in the real codebase.

## About the Design Files
The files here are **design references created in HTML** — a working prototype showing intended
look and behavior, not production code. The task is to **recreate this design in the target
codebase's environment** (the Cadence platform stack: React + MUI v7 + the COBRA styled
components + FontAwesome) using its established patterns — not to ship this HTML.

`Controller Console.dc.html` is a self-contained prototype: the markup template and a logic class
(plain React-style class named `Component`) with all interaction behavior. `cobra.jsx` shows how
the prototype wrapped each COBRA component in `CobraThemeProvider`; in the real codebase, wrap
the app root once instead.

## Fidelity
**High-fidelity** for layout, hierarchy, interaction design, copy, and the dark operator chrome
(colors/type below). The COBRA components (buttons, text fields) in dialogs/composer are the real
`cadence-design-system@2.16.0` components and must come from that library in production.
Simulated in the prototype (replace with real systems): post feed + bundle pacing, queue
countdowns, presence, trainee signals, decisions/queue-pressure metric.

## Requirements traceability — READ `DECISIONS.md` FIRST
`DECISIONS.md` (D5-001 … D5-020) is the running log: each entry = decision, alternatives
considered, requirement IDs (CTL-xxx, ADP-xxx, COR-xxx, NFR-xxx, D0 §). **Story updates needed —
decisions that AMEND requirements as written:**
- **ADP-040 amended (D5-014/1.1):** engine-draft timeout default is **auto-HOLD**, never
  auto-send. Silence is never approval. Auto-send exists only as an explicit per-exercise
  "swamped mode" setting the lead controller enables.
- **CTL-024 amended (D5-014/1.2):** control renamed **"Break Fiction"**; it replaces participant
  screens *inside the exercise only* (nothing external). Director-gated + type-to-confirm
  ("BROADCAST") + guarded/latched visual group + every use logged to the exercise record.
- **CTL-023 amended (D5-014/1.3):** pause is **tiered**: Pause injects / Pause engine / Freeze
  world (guarded; only tier participants notice; only tier that stops the scenario clock).
- **CTL-034 metric (D5-014/2.7):** the visible meter is **queue pressure** (decisions demanded
  per minute, budget ≤6) — explicitly NOT a controller-performance measure.
- **CTL-022 amended (D5-014/2.2):** storyline intensity = **actual + controller-set target** on
  one track; engine drives actual toward target.
- **New pattern (D5-017/D5-019):** toolstrip + flyouts. Continuous-watch surfaces (review queue,
  live world) get permanent space; consult-on-demand surfaces (storylines, personas, trainees,
  rumors) are toolbox tools with status badges (red pulsing count when escalating).
- **Rumor tracker mocked (review 3.3, D5-018):** rumors as first-class objects with lifecycle
  SEEDED → SPREADING → COUNTERED → DEAD, reach, mutation, countered-by, "draft counter as…".
- **Time-jump (CTL-015) guarded while RUNNING** — requires pause first (D5-014/P4).

## Screens / Views

### Main console (single view + overlays)
Full-viewport dark operator chrome. Grid rows: 20px exercise banner / 56px header / auto
NEEDS-YOU action bar / remaining body. Body grid columns: `302px | 1fr | 336px | 56px`
(breakpoints: ≤1420px → 272/1fr/312/56, columns adapt; ≤1180px → 250/1fr/296/56).

**1. Exercise banner (top, 20px)** — mono 10px: "EXERCISE — TRAINING USE ONLY · SIMULATED
CONTENT" · exercise name · "UNCLASSIFIED // FOUO". Never participant-facing chrome.

**2. Header (56px)** — left→right: PULSE brand block; exercise identity badge (static during
conduct, no switcher — COR-005); dual clocks (scenario time 22px mono white + wall clock 13px;
labels 9px letterspaced); state pill (RUNNING green / INJECTS PAUSED / ENGINE PAUSED / WORLD
FROZEN amber); spacer; presence avatars (S1/S2/DP, 26px circles); Focus/Full-view toggle; Pause
(opens 3-tier popover); divider; **GUARDED group** (dashed amber border): "Break Fiction" warn
button + "Role: Controller" toggle; **Engine control** (always visible kill switch): dark red
button "ENGINE · LIVE" with dot, menu = Live / Suggest-only / STOP ENGINE / "On timeout:
Hold drafts (default) ⇄ Auto-send (swamped mode)".

**3. NEEDS YOU action bar** — amber "NEEDS YOU" tag + pill chips that **locate & highlight, never
act**: "BND-07 ready · …" (green), "2 of 5 need review" (blue), "1 timer under 60s" (amber,
pulsing dot), "INJ-039 held past its time" (amber). Right side: queue-pressure meter (N / 6,
fill bar, amber past 6, tooltip states it's demand not performance) + dismissible first-run
keyboard hint. Empty state: "All clear — monitoring the world".

**4. Left rail — INJECT SCHEDULE · MSEL (302px)** — caption (Focus mode only): "Scripted events
in scenario time. Fire, hold, or skip each as it comes due." Completed injects collapse behind
"Show N completed injects". Inject cards: time (mono), id chip (INJ-/BND- with legend tooltip),
status chip w/ dot (Pending/Ready/Fired/Skipped/Held/Firing — never color-only), title, bundle
meta ("12 posts · 8 personas · 10 min"), actions Fire (primary) / Hold / Skip. Cadence-locked
items: left border + lock icon + "Take local control". Held-overdue: amber "Held — Nm past its
scheduled time". Firing bundles show a pacing progress bar ("Pacing 4 / 12"). "NOW · 09:33"
divider between past and future. "Time-jump" button in section header (guarded while RUNNING).

**5. Center — THE LIVE WORLD (fluid)** — caption: "The simulated platform the trainees are
inside — one feed, sliced into columns." TweetDeck columns: All Posts / #WaterIssues / 911-Outage
/ Participant Activity, "+ Column" to add. **Columns always render whole**: width = track /
floor(track/300) via ResizeObserver CSS var `--nvis`; horizontal scroll-snap by whole columns;
34px right-edge gradient fade. **Pause-on-hover**: hovering a column freezes it; new posts buffer
behind sticky pill "N new — paused while you read · click to catch up"; mouse-out resumes. Post
card: avatar (colored circle, initials), name + verified check, handle, relative time, text,
engagement counts (mono), hover actions: "Reply as…", "Response match", "Flag", "Takedown" (red).
Participant Activity column: dashed activity rows (trainee actions).

**6. Right rail — REVIEW QUEUE (336px, sole tenant)** — caption: "Engine drafts awaiting your
call — approve (A) or veto (V). Expired timers hold the draft for you; nothing posts without a
decision." Header: count + "Batch approve [B]". Draft cards: persona avatar/name/handle, action
("reply → @tommyr_fh"), preview text, storyline tag, countdown ("holds in 1:48" + depleting bar)
or "needs review" / "timer expired — held for you"; focused card = blue ring + A/V/E/R buttons.
Keyboard: ↑↓ focus, A approve, V veto, E edit (opens composer), R re-roll, B batch-approve.
Priority items: red left border. Auto-expired items become held + priority.

**7. Toolstrip (56px, right edge)** — icon+label tools, flyouts (322px, slide-over, Esc/✕):
- **Stories** (badge: red pulsing count of ESCALATING storylines, calm navy total otherwise) →
  Storyline board flyout: cards w/ name, tag, severity chip; intensity bar with **actual fill +
  target tick** (click track to set target, "78 →60"); expand for sentiment bar, 6-segment
  escalation dial (blue→amber→red), expected action (met green / waiting amber), trainee signal,
  "Log off-platform response" → "Off-platform response logged" badge.
- **Personas** → opens the ⌘K picker directly (no separate roster; picker rows carry presence
  dot + "held by SimCell-2").
- **Trainees** → trainee monitor flyout: card per trainee (@FH_PIO etc.): role, status chip
  (ACTIVE/IDLE 21M/DRAFTING), last action, metric (response time vs target ✓ / expected action).
- **Rumors** → rumor tracker flyout: claim, lifecycle chip (SEEDED/SPREADING/COUNTERED), origin
  (inject-seeded vs organic), reach bar + trend, mutation line, countered-by, "Draft counter
  as…" → persona picker.

### Overlays
**⌘K palette** (dark, 560px, top-centered): search input; PERSONAS section (avatar, name,
verified, handle · voice cue · held-by, presence dot, "↵ compose"); COMMANDS section (Fire next
bundle / Pause exercise / Break Fiction). ↑↓ + Enter.

**Composer** (light COBRA paper, 600px, centered): header tinted by persona category —
citizen `#fbf3e4`/`#c98a2b` top border, official `#e8f0fa`/`#1e3a5f`, news `#faeaf0`/`#c23b6b` —
with avatar, name, handle and category chip "POSTING AS CITIZEN VOICE / OFFICIAL ACCOUNT /
NEWS / MEDIA" (wrong-persona-error defense; unmissable at compose time). Context strip
(storyline + scenario time + voice reminder). CobraTextField multiline. Right sidebar: VOICE
NOTES bullets. Footer: char count, CobraLinkButton Cancel, CobraPrimaryButton "Send in-character
⌘↵". On send: quiet confirm toast "Posted to the live world as @handle ✓".

**Response-match toast** (non-modal, top-center; docks bottom-center while any overlay is open so
it never covers the composer header): amber left border, "RESPONSE MATCH · EVALUATOR LOG",
"Does @FH_PIO (trainee)'s post address the expected action for #WaterIssues — 'Boil-water
advisory acknowledged'?" Buttons "Yes · Y" / "No · N" (keyboard works). Asked about TRAINEE
posts (never the controller's own).

**Takedown dialog** (light, 460px): post preview + incident category radio list (Misinformation /
Incitement / Impersonation / Out-of-character) + CobraDeleteButton "Remove content". 2 clicks.

**Break Fiction gate** (light, 460px): red warnbox stating scope ("nothing leaves the platform…
every use is logged"), participant-screen options, type **BROADCAST** to arm, CobraDeleteButton
"Arm & broadcast" disabled until typed. Locked for non-Director roles (warn toast).

**Broadcast overlay** (deliberately alien to ALL other chrome): full-bleed black/amber hazard
diagonal stripes, mono type, 4px amber frame box, "ATTENTION ALL PARTICIPANTS / This is a real
message from Exercise Control", pulsing "◄ REAL-WORLD BROADCAST ►", "■ END BROADCAST" button.
Implies world-freeze.

**Pause popover**: 3 radio tiers (injects / engine / freeze world — last styled amber) +
Cancel/Pause; button becomes "Resume" while paused.

**Time-jump dialog**: batch disposition of spanned injects (fire all / fire+hold rumor wave /
skip all). Only reachable while paused.

## Interactions & Behavior
- **<10s reply flow**: ⌘K → type persona name → Enter → composer (voice notes visible) → ⌘Enter.
- Fire bundle → status Firing + pacing bar; posts stream into columns ~1/sec with slide-in
  animation (0.45s cubic-bezier(.2,.7,.3,1)); storyline intensity bumps.
- Focus ↔ Full view toggle: Focus shows captions + collapses completed injects.
- NEEDS YOU chips highlight target (amber ring 2.6s) — never execute.
- Esc closes any overlay/flyout. One flyout at a time.
- Confirmation toasts (bottom-center, green ok / amber warn, 3.2s auto-dismiss).

## State Management (production)
Exercise state (running/paused+tier, scenario clock, engine mode live/suggest/stopped, timeout
mode hold/send, role); MSEL items (status machine pending→ready→firing→fired / held / skipped,
lock flag, overdue derivation); queue items (auto+expiry / needs-review / expired-held, focus
index); posts (tags→columns, per-column freeze snapshots); storylines (intensity actual+target,
sentiment, escalation 0–5, expected action met, off-platform flag); rumors (lifecycle, reach,
mutation); presence; rolling 60s queue-pressure window.

## Design Tokens (dark operator chrome — prototype values)
Backgrounds: `#0a1017` bg, `#0f1826` panel, `#0d1420` panel2, `#111c2b` card, `#0b121d` toolstrip.
Lines: `#1c2a3a`, `#28384b`. Ink: `#e9eff7` / `#9db1c8` / `#63758b`.
Accents: navy `#3b6fa8` (+COBRA `#1e3a5f`), blue `#4d97d1`, red `#e42217` (COBRA delete), amber
`#f5a623`, green `#33a06f`. Broadcast alien: `#ffcf33` on `#0a0a0a`.
Type: system sans stack; mono for time/ids/counts. Sizes 10–13px chrome (min 10px), 22px scenario
clock, 44px broadcast headline. Radii: 7–14px (cards 9, dialogs 14, pills 20). Status chips
always dot + label (never color-only, NFR-001).
Light surfaces (dialogs/composer): COBRA/MUI defaults — `#f6f7f9`/`#fff`, text `#1a1a1a`/`#374151`.

## Assets
None external. All icons are inline SVG strokes in the prototype — production should use
**FontAwesome** equivalents per the Cadence DS. Avatars are initials + brand-adjacent color fills.

## Files
- `Controller Console.dc.html` — the full prototype (template + logic + all data).
- `DECISIONS.md` — decision log with requirement traceability (input for story updates).
- `cobra.jsx` — provider-wrapping shim used by the prototype (pattern reference only).
- Design-system source: `cadence-design-system@2.16.0` (COBRA components) — use the real package.
