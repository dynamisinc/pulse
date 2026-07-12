# Pulse Design

Design foundations, per-surface briefs, and design-session handoffs for Pulse.
Start with the foundations, then the brief for the surface you're building.

## Documents

| Doc | Surface | Status |
|-----|---------|--------|
| [D0-FOUNDATIONS.md](D0-FOUNDATIONS.md) | Shared house rules, the two worlds, brand set, non-negotiables | Foundations |
| [D1-social-app.md](D1-social-app.md) | Social app (Pulse) — epic E2 | Brief |
| [D2-portal.md](D2-portal.md) | Exercise portal ("[City] Today") — epic E3 | Brief |
| [D3-news-outlets.md](D3-news-outlets.md) | News outlets (TV / paper / wire / tabloid) — epic E4 | Brief |
| [D4-press-weather.md](D4-press-weather.md) | Press Room + Weather Desk — epics E5/E6 | Brief |
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
