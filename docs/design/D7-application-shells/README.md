# Handoff: Pulse Application Shells (D7) — v1

## Overview
The two canonical container shells for Pulse, a simulated information environment for
emergency-management exercises (Dynamis ScenarioForge). Every participant-facing channel
(social app, news portal, TV station, PIO wire, weather) renders inside the **participant
shell**; every staff surface (controller console, evaluator dashboard) renders inside the
**staff shell frame**. This package is the design-of-record for both, plus the contract that
channel implementations and story agents build against.

## About the Design Files
The `.dc.html` files in this bundle are **design references created in HTML** — interactive
prototypes showing intended look and behavior, not production code to copy directly. The task
is to **recreate these designs in the target codebase's environment** (React etc.) using its
established patterns. If no frontend exists yet, choose the appropriate framework and
implement the shells there as shared layout components that channels/surfaces mount into.

**Read `SHELL-CONTRACT.md` first** — it is the normative spec (shell-owns vs channel-owns,
alert bar contract, overlay z-order, hard gates). `DECISIONS.md` carries rationale per
requirement ID (D7-001…D7-011). `RETROFIT-NOTES.md` maps the two pre-existing mockups
(social app, controller console) onto the shells.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and copy in the mockups are intended values.
Recreate pixel-perfectly, with two exceptions: (1) all "Fairhaven"/"BAY SHIELD" strings and
channel stubs are demo scenario config, not product copy; (2) the participant channel stubs
(portal, social, news, wire, weather) are placeholders proving brand independence — real
channels come from their own design sessions.

## The Two Shells

### 1. Participant shell — `Pulse Shell.dc.html`
Desktop (1180-wide frame) and mobile (390) side by side. Shell-owned layers, top→bottom:

- **Compliance chrome (COR-031):** two fixed 22px banners, top + bottom, green `#2e6b2e`,
  text `#eaf5e6`, Figtree 700 10px, letter-spacing .14em, centered caps. Top:
  `UNCLASSIFIED // EXERCISE · EXERCISE · EXERCISE — ALL CONTENT SIMULATED`. Bottom:
  `PULSE TRAINING ENVIRONMENT — SIMULATED INFORMATION SPACE — NOT REAL NEWS`. The app zone
  is inset between them. Config-driven strings; chrome-off is a legal state (layout must
  survive it).
- **Alert bar (PRT-010/011/012):** states none/info/advisory/emergency. **Default treatment:
  ticker** — dark `#14181c` one-line bar: severity tab (icon + LABEL, info `#3d6a96`,
  advisory `#8a5a00` (darkened from `#b97a00` for WCAG AA — D7-012), emergency `#c0271a`,
  white text) + monospace message + timestamp.
  **Emergency always escapes the ticker to the full band**: solid `#b3261e`, white text,
  chip = white bg / red text. Band treatment (info `#edf3f9`, advisory `#fff3dd`) retained
  as an alternate. Multi-alert in ticker: auto-rotate ~3.5s. Never color-only (NFR-001);
  never user-dismissable; alerts are in-fiction only.
- **Channel strip (COR-061/062):** 38px, `#fbfcfd`, bottom border `#e3e7ea`. Channel names
  as plain links (Figtree 600 12.5px `#5a6a76`; current: 800 `#101b23` + 2px underline).
  Scenario dateline right-aligned. Mobile: bottom tab bar, 56px, 5 slots, icon + 9.5px label.
- **Content region:** shell imposes zero styling inside.
- **Overlay layer (COR-065):** pause/EndEx pages (in-fiction = neutral gray maintenance
  page, system-ui; out-of-fiction = slate `#1b232c` mono control page) render above content,
  below chrome. **Break-fiction broadcast (CTL-024)** covers everything incl. chrome: black
  `#0d0d0d`, amber `#ffb300` hazard-stripe bars (repeating 45° stripes, 16px), monospace,
  wall-clock time, no dismiss affordance, no brand from either world.
- **Variants (COR-064):** read-only = affordances absent, never disabled (COR-015); kiosk =
  chrome + nav removed, alert bar persists (PRT-040).

All states are wired as Tweaks props in the mockup: `chrome`, `kiosk`, `readOnly`, `alert`,
`alertStyle`, `alertCollapsed`, `multiAlert`, `overlay`.

### 2. Staff shell frame — `Pulse Staff Shell.dc.html`
Cadence Design System (binding for staff surfaces): navy `#1e3a5f` chrome, light `#f8f8f8`
work area, white panels, red `#e42217` badges, gray `#848482` secondary text, pill buttons.

- **Header (56px, navy):** brand lockup (PULSE / SURFACE NAME) · exercise identity badge
  (name + role/cell, static during conduct, COR-005) · scenario clock (mono 20px) + wall
  clock pair · state pill (dot + text, green running / amber paused) · classification tag
  `UNCLASSIFIED // FOUO` (mono 9px, persistent — there is deliberately NO separate exercise
  bar, D7-010) · presence avatars · **Preview as participant** pill button (COR-041).
- **Toolstrip (56px right dock, D7-011):** ONE dock, two zones — shell-global tools
  (Participant Admin w/ badge, COR-017) above a divider; surface-registered tools below
  (the controller toolbox docks here; surfaces never draw their own strip).
- **Participant admin flyout (COR-017):** 330px right panel — login triage rows (name, role,
  status chip LOCKED OUT/NO LOGIN YET/ACTIVE, action link), link to full admin.
- **Preview as participant (COR-041):** replaces work area with the participant shell in a
  stage, read-only, with a scenario-moment picker (STARTEX/ADVISORY/BURST/NOW) that drives
  the preview's alert state + content.
- **Hard gate:** staff surfaces must be thumbnail-distinguishable from participant surfaces —
  navy chrome + light work area vs light world framed by two green banners. Never mix.

Frame props: `surface` (Controller Console / Evaluator Dashboard), `exName`, `exerciseState`.

## Interactions & Behavior
- Channel strip / tabs switch the mounted channel; state persists per shell instance.
- Ticker rotation: 3.5s interval, severity tab swaps per message.
- Band alerts (info/advisory) collapse on scroll to one compact line; tap re-expands;
  emergency never collapses.
- "Details →" on any alert routes to the alerts history (channel-side).
- Preview-as toggles header button on-state; moment chips are mutually exclusive.
- Admin flyout toggles from the toolstrip tool; badge shows pending count.
- Break-fiction/pause/EndEx are server-pushed states, not user actions; break-fiction has
  no client-side dismiss path.

## State Management (implementation)
Shell state is exercise-scoped and server-driven: `chromeConfig`, `alerts[]` (severity,
message, scenarioTime, id), `overlayState` (none/pause/endex/broadcast + register),
`variant` (full/readOnly/kiosk/preview), `scenarioNow`. The shell is the single source of
scenario time for channels (COR-053/062). Channels receive `{variant, scenarioNow}` and must
not render cross-channel nav or draw above the overlay layer.

## Design Tokens
Participant world: chrome green `#2e6b2e`/`#eaf5e6`; alert palettes above; strip grays
`#fbfcfd`/`#e3e7ea`/`#5a6a76`/`#101b23`; broadcast `#0d0d0d`/`#ffb300`/`#ffd97a`; pause
slate `#1b232c`/`#aebfd2`. Font: Figtree (shell chrome only); channels bring their own.
Staff world (Cadence): navy `#1e3a5f`, dark navy `#16293f`, bg `#f8f8f8`, panel `#fff`,
lines `#dcdcdc`/`#c4c4c4`, ink `#1a1a1a`/`#4a4f55`/`#848482`, red `#e42217`, running green
`#2e7d4f`, paused amber `#b26a00`. Header text tints `#eef3f9`/`#b9c7d8`/`#7d93ad`. Mono:
ui-monospace stack. Staff UI font: system-ui stack. Use Cadence/Cobra components
(CobraPrimaryButton etc.) where they map (admin actions, forms).

## For Story Agents
Story/scenario content NEVER touches shell chrome. Agents write: channel content, alert
content (severity + message + scenario timestamp → the shell renders it), and overlay
triggers (pause/EndEx/break-fiction via Exercise Control). Agents must not: add
instructional banners, real-world time, or exercise language inside the fiction (the
compliance chrome and overlays are the only exercise signals participants see).

## Files
- `Pulse Shell.dc.html` — participant shell, desktop + mobile, all states tweakable
- `Pulse Staff Shell.dc.html` — staff frame, preview-as-participant, admin flyout
- `SHELL-CONTRACT.md` — normative interface spec
- `DECISIONS.md` — full decision log w/ requirement IDs (D7 section on top)
- `RETROFIT-NOTES.md` — container swaps for the existing social-app + console mockups
- `Pulse Social App.dc.html`, `Controller Console.dc.html` — the two finished surfaces the
  retrofit notes apply to (reference only)

The `.dc.html` files open directly in a browser (they need `support.js` alongside, included).
