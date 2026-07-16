# Pulse Design

Design foundations, per-surface briefs, and design-session handoffs for Pulse.
Start with the foundations, then the brief for the surface you're building.

## Documents

| Doc | Surface | Status |
|-----|---------|--------|
| [D0-FOUNDATIONS.md](D0-FOUNDATIONS.md) | Shared house rules, the two worlds, brand set, non-negotiables | Foundations |
| [D1-social-app.md](D1-social-app.md) | Social app (Pulse) — epic E2 | Brief |
| [D1-social-app/](D1-social-app/) | Social app (Pulse) — participant surface | Handoff v1 — ready to implement |
| [D2-portal.md](D2-portal.md) | Exercise portal ("[City] Today") — epic E3 | Brief |
| [D3-news-outlets.md](D3-news-outlets.md) | News outlets (TV / paper / wire / tabloid) — epic E4 | Brief |
| [D4-press-weather.md](D4-press-weather.md) | Press Room + Weather Desk — epics E5/E6 | Brief |
| [D4-press-weather/](D4-press-weather/) | The Wire Room (press) + The Weather Desk (weather) — participant surfaces + PIO composer | Handoff v1 — decisions synced to epics; E5/E6 stories not yet decomposed |
| [D5-controller-console.md](D5-controller-console.md) | Controller console — design brief (epic E7) | Brief |
| [D5-controller-console/](D5-controller-console/) | Controller console (SimCell operator surface) | Handoff v1 — ready to implement |
| [D6-evaluator-dashboard.md](D6-evaluator-dashboard.md) | Evaluator dashboard — epic E10 | Brief |

> The epic docs the briefs cite (`../00-MASTER-PRD.md`, `../01`…`../11`) live one level up in
> [`docs/`](../). Start any design session with the foundations, then the surface's brief.

Session order (from D0 §6): D5 Controller console · D1 Social app · D2 Portal ·
D3 News outlets · D4 Press + Weather · D6 Evaluator dashboard.

## About the design-session handoffs

Each handoff folder is the output of a Claude design session: a **clickable HTML
prototype** plus a **`DECISIONS.md`** decision log with requirement traceability.

**These are design references, not production code.** The prototypes were authored in
a design-canvas environment and load the Cadence design-system bundle (`cadence-design-system`)
from a `_ds/` path that is **not** included — so they do **not** render standalone in a
plain browser. Treat them as the source of truth for layout, interaction, and copy when
reimplementing the surface in `src/frontend` on the real stack (React 19 + MUI 9 + the
COBRA styled components + FontAwesome).

When implementing a surface:
1. Read [D0-FOUNDATIONS.md](D0-FOUNDATIONS.md), then the surface's `README.md`.
2. Read its `DECISIONS.md` — each entry cites the requirement IDs it satisfies or
   **amends**. Amendments (e.g. D5-014) are changes to the epic/stories, not just UI notes.
3. Rebuild in `src/frontend` using COBRA components; don't port the prototype HTML.

## D5 — Controller console (handoff v1)

The SimCell operator surface: one controller running a simulated social-media world during
an exercise (scenario: *Bay Shield 2026*). Dark operator chrome (staff world) with COBRA
light "paper" for dialogs/composer. Key decisions that **amend requirements** and need to
flow back to the stories (see [DECISIONS.md](D5-controller-console/DECISIONS.md)):

- **ADP-040** — engine-draft timeout defaults to **auto-HOLD**, never auto-send ("silence
  is never approval"); auto-send is an explicit opt-in "swamped mode".
- **CTL-024** — renamed **"Break Fiction"**; replaces participant screens *inside the
  exercise only*, Director-gated + type-to-confirm + fully logged.
- **CTL-023** — **tiered pause**: Pause injects / Pause engine / Freeze world.
- **CTL-034** — the visible meter is **queue pressure** (decisions demanded/min, budget ≤6),
  explicitly *not* a controller-performance measure.
- **CTL-022** — storyline intensity shows **actual + controller-set target** on one track.

The requirement amendments above are tracked as an actionable checklist for the story
agents in **[STORY-UPDATES.md](D5-controller-console/STORY-UPDATES.md)** (amend / add /
reconcile / backlog, with a traceability table).

Folder contents: `Controller Console.dc.html` (prototype), `DECISIONS.md` (D5-001…D5-020),
`README.md` (handoff spec), `STORY-UPDATES.md` (requirement-change checklist), `cobra.jsx`
(provider-wrap pattern reference), `support.js` (design-canvas runtime).

## D4 — The Wire Room (press) + The Weather Desk (weather) (handoff v1)

Pulse's two institutional participant channels: **The Wire Room** (municipal press-release wire,
PIO-authored — the evaluation-critical composer lives here, E5/PRS) and **The Weather Desk**
(weather.gov-anchored government weather service, staff-authored, E6/WX). Both render inside the D7
participant shell; the Weather Desk feeds the shell alert bar. Full clickable mockup, user-approved,
**12 sign-offs**. Key decisions that **amend requirements** and flow back to the stories (see
[DECISIONS.md](D4-press-weather/DECISIONS.md)):

- **D4-001/002** — the composer **is the letterhead sheet**, not a form/CMS: the PDF drop zone is the
  body, headline is the only required input (auto-suggested, one-click accept), and **nothing
  publishes on drop** — one confirmation gate.
- **D4-003** — scheduled/embargo state is **redundant** across composer, wire row, and permalink;
  the "FOR IMMEDIATE RELEASE" line flips to "EMBARGOED — HOLD UNTIL {time}".
- **D4-007** — the approval gate is **participant paper** (draft-diff, mandatory return note),
  per-exercise routing with per-org defaults.
- **D4-009** — the Weather Desk speaks **NWS verbatim** (IBW grid, NWS furniture, scenario-time
  stamps); severity is **icon + text + color, never color-only**; NWS hues **darkened for WCAG AA**.
- **D4-010** — a warning forces the **emergency band** on every channel (all warning types, for now);
  one multi-alert bar; the **same headline string** on bar, @WeatherDesk post, portal widget, and
  product page — no paraphrase.
- **D4-012** — the radar/imagery slot reserves the bottom-right **EXERCISE** watermark chip (NFR-008).

The amendments, three flagged **conflicts** (C-1 approver framing · C-2 warning-severity mapping ·
C-3 @WeatherDesk naming), the **open items** (return-notification reach, mobile pass, real PDF/paste,
PRT-012 alerts history), and the two **D5 console retrofit notes** are tracked as an actionable
checklist in **[STORY-UPDATES.md](D4-press-weather/STORY-UPDATES.md)**. ⚠ **E5/E6 are not yet
decomposed** into `docs/features/` backlogs (they are Phase 3, live only as epics), so this handoff's
decisions are pre-staged there and folded into the epics — the decomposition is the logged next step.

Folder contents: `Wire Room + Weather Desk.dc.html` (prototype — needs `support.js`; does not render
standalone), `wx011-propagation-storyboard.png` (the WX-011 four-surface propagation moment),
`DECISIONS.md` (D4-001…013 + the 12 sign-offs), `STORY-UPDATES.md` (requirement-change checklist),
`README.md` (handoff spec), `COMPONENTS.md` + `SHELL-CONTRACT.md` (cross-surface/shell briefs bundled
with this handoff — candidates to promote to `docs/design/` top-level later), `support.js`,
`CLAUDE-CODE-PROMPT.md` (the sync brief that produced this pass).
