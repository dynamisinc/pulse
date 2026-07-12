# D2 — Design Brief: "[City] Today" (Exercise Portal)

> Epic: `../03-exercise-portal.md` · Anchor: **a local TV-station / local-news homepage** (think 11alive.com, patch.com) — everyone has used one; nobody was trained to.

## Purpose & users

The participant's front door (Phase 3+) and ambient "state of the world" display. All participants land here after login; many read-only participants live here. Also the navigation shell to every other channel.

## Key screens

1. **Homepage** — masthead ("[City] Today" templated brand, PRT-002) with scenario-time dateline; **alert bar** slot at top (PRT-010); lead story hero + Top Stories card grid (PRT-004); right rail: live social stream excerpt (PRT-005), weather widget, trending topics; press release list module (PRT-003). Modules hide cleanly when channels are disabled — the layout must look complete with any subset.
2. **Alert states** — informational / warning / emergency styling (PRT-011, never color-only). The homepage's mood should visibly shift when an emergency alert is active: this is the "world state change" moment (E3 §3).
3. **Alerts history page** (PRT-012) — simple reverse-chron list.
4. **Navigation shell** — persistent, unobtrusive channel nav (PRT-020). Beat Looking Glass here: their footer-icons + fly-out pattern needed an instructional banner. Recommend a visible top-level nav (site-header links: News · Pulse · Wire Room · Weather), the way real portals link their properties.
5. **Resources area** (PRT-022) — visually separated non-fiction shelf (quick-start, ground rules). The one place the fourth wall officially thins.
6. **Kiosk/TTX display mode** (PRT-040/041, Phase 3) — login-free full-screen rendering with facilitator-driven cycling. Design as "the newsroom wall display": zero chrome, large type, readable from the back of a conference room.

## States to design

- **Normal day** (Staged: filler stories, calm weather), **incident day** (Top Stories pinned to crisis, alert bar amber/red, social rail accelerating), **kiosk mode**.

## Constraints & cues

- News-portal visual language, deliberately distinct from Pulse (D1) and outlet sites (D3): the portal is an *aggregator* brand.
- Fully responsive; this is many participants' phone home screen.
- Compliance chrome frames everything (COR-031).
- Scenario-time dateline (COR-053) — the portal is where participants most often check "what time is it in the world."

## Anti-patterns

RIP Board's discoverability failure; cluttered module soup (clean-not-busy: fewer modules, stronger hierarchy); making the portal look like the social app.
