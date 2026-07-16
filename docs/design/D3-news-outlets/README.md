# Handoff: News Outlets (D3) — proposal stage v1

## Overview
Design session D3 covers Pulse's simulated news media: four outlet brands (Newsline 7,
The Courier-Ledger, The National Wire, The Scoop) rendered by ONE article/homepage system
with per-outlet skin token files (NWS-002). Outlet credibility diversity is a training
feature: participants must read source quality from design alone.

## Status of this package
**PROPOSAL STAGE, user-approved** (2026-07). Contains the normative shared-grid +
token-surface contract and the four approved outlet registers (`D3 Proposal.dc.html`,
exhibits 1a/1b — open in a browser; needs `support.js` alongside). The full clickable
mockup (article page, homepage, breaking state, both correction states, mobile view,
skin switcher) is the **next design deliverable** and ships as a follow-up package —
do not treat anything beyond exhibits 1a/1b as design-final.

## Files
- `D3 Proposal.dc.html` — the approved exhibit. **1a** = shared article grid + token
  surface (normative); **1b** = one headline block in all four outlet registers.
- `support.js` — prototype runtime for the `.dc.html` file (reference only).
- `../DECISIONS.md` — the D3-P1…P4 decision log with requirement traceability, in the canonical root
  log (`## D3` section); the per-folder copy was folded in and removed.
- `STORY-UPDATES.md` — distilled AMEND/ADD/RECONCILE checklist for the story/epic
  agents; folds into the E4 story decomposition when it happens (Phase 3).

The briefs this proposal answers live at their canonical repo paths (the handoff
package shipped snapshot copies; they are not duplicated here):
[`../D3-news-outlets.md`](../D3-news-outlets.md) (surface brief) ·
[`../D0-FOUNDATIONS.md`](../D0-FOUNDATIONS.md) (binding foundations) ·
`../D7-application-shells/SHELL-CONTRACT.md` (shell/channel boundary; lands with the
D7 shells package) · `../COMPONENTS.md` (cross-surface inventory; lands with the E8
reconciliation branch).

## The contract in one paragraph
Slot anatomy is invariant (masthead → breaking slot → kicker/hed/dek → byline + scenario
dateline + share → hero media with EXERCISE watermark chip → body with pull quote + Pulse
embed → correction slot → discussion-on-Pulse footer). Skins set type, palette, density,
media treatment, breaking vocabulary, byline format, and layout enums; The Scoop alone may
enable clutter modules. Skins can never touch slot order, the scenario-time source
(COR-053), the Pulse embed / link-card rendering (SOC-002/004), the watermark slot
(NFR-008), share behavior, the no-comments rule (NWS-031), the a11y floor (NFR-001), or
telemetry invisibility (NWS-030). Breaking is authorial only (NWS-012); corrections render
either as a visible editor's note or a silent rewrite (NWS-013).
