# Handoff: The Wire Room & The Weather Desk (D4) — full mockup v1

## Overview
Design session D4 covers Pulse's two institutional participant channels: **The Wire Room**
(municipal press-release wire, PIO-authored — the evaluation-critical composer lives here) and
**The Weather Desk** (weather.gov-anchor government weather service, staff-authored). Both
render inside the D7 participant shell; the Weather Desk feeds the shell alert bar.

## Status of this package
FULL CLICKABLE MOCKUP, user-approved, including 12 review sign-offs (D4-013). All brief
screens are built: wire, release permalink, org newsroom, composer (drop→publish flow),
JIC approval gate with draft-diff, weather site with per-zone data, warning product page,
and the WX-011 propagation storyboard (exported as `wx011-propagation-storyboard.png`).

## Files
- `CLAUDE-CODE-PROMPT.md` — paste into a new Claude Code session at the requirements repo
  to sync stories + GitHub to these decisions. Start here.
- `Wire Room + Weather Desk.dc.html` — the mockup (open in a browser; needs `support.js`).
  Tweaks drive states: `wireState` normal/staged/embargoed/returned · `weatherState`
  calm/watch/warning · `storyboard` on/off.
- `wx011-propagation-storyboard.png` — the propagation moment, four static frames.
- `D4-press-weather.md` — the surface brief (Part A Wire Room, Part B Weather Desk).
- `SHELL-CONTRACT.md` — shell owns chrome/alert bar/nav; channels own the content region.
- `../COMPONENTS.md` — cross-surface component inventory (canonical, at the `docs/design/` root; the
  copy bundled in this handoff was removed as a duplicate of it).
- `D0-FOUNDATIONS.md` — binding design foundations.
- `support.js` — runtime for the .dc.html file.

## The design in one paragraph
The composer is the letterhead sheet, not a form: letterhead + contact block prefilled per
org (switcher chip, COR-018), the PDF drop target IS the body area (PRS-002 PDF-first),
headline is the only required input (auto-suggested from the PDF), autosave ambient
(PRS-004), publish-now vs. embargo with a redundant amber "Scheduled — releases in 19m"
state (PRS-003), the Pulse cross-post as an explicit checkbox with link-card preview
(PRS-013), and exactly one confirmation gate before anything goes out. The Weather Desk
speaks NWS verbatim: zone selector (WX-004), IBW What/Where/When/Impacts on the warning
product (WX-010), monospace product text, AA-adjusted NWS severity hues with icon + text
chips (NFR-001), an EXERCISE watermark slot on the radar imagery (NFR-008/WX-013), and one
headline string propagated unchanged to the alert bar, @WeatherDesk post, and portal widget
(WX-011). Scenario time everywhere (COR-053).
