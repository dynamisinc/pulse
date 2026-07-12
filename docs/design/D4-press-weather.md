# D4 — Design Brief: The Wire Room (Press) & The Weather Desk (Weather)

> Epics: `../05-press-room.md`, `../06-weather-source.md` · Anchors: **a municipal newsroom / PR Newswire** and **weather.gov**. Both deliberately institutional — the two "government-grade" designs in the fiction.

## Part A — The Wire Room

**Purpose:** the PIO's formal publishing surface; primarily participant-authored. Austere, credible, letterhead-forward — a tonal contrast with Pulse's noise.

**Key screens:**

1. **The wire** (PRS-010): reverse-chron release list, org letterhead branding per item, org filter. Reads like a real wire feed.
2. **Org newsroom page** (PRS-012): one organization's releases — "the county website's newsroom."
3. **Release page** (PRS-011): letterhead, headline, contact block, inline-rendered PDF pages (PDF-first, PRS-002) or rich text; revision markers ("Updated 14:32" — scenario time; PRS-005).
4. **Composer — the critical screen** (PRS-002/003/004): designed for a stressed PIO. Letterhead + contact block prefilled; a big PDF drop target as the primary path, rich-text editor secondary; autosave state always visible; publish-now vs. embargo with unmistakable scheduled state ("Scheduled — releases in 19m"); the "post to our social account" checkbox (PRS-013) as an explicit, visible decision; org switcher for multi-org/JIC users (COR-018). No destructive action without confirmation.
5. **Approval gate view** (PRS-021, optional): approver sees pending releases with diff-from-last-draft; approve/return actions.

**States:** empty wire (Staged) · normal · embargoed item (author/staff view) · returned-for-revision.

## Part B — The Weather Desk

**Purpose:** the authoritative weather channel. The one participant surface that *should* feel like a government data site — high information density is authentic here, but organized NWS-style, not busy.

**Key screens:**

1. **Weather site** (WX-001): current conditions, multi-day forecast, active-alerts panel, per-zone selector (WX-004).
2. **Warning product page** (WX-010): NWS-conventional formatting — type/hazard/zones/effective-expiry (scenario time), headline, body in the familiar all-caps-adjacent NWS register. Real NWS severity color conventions (participants' instincts must transfer) with non-color severity indicators too (NFR-001). Reserve the NFR-008 watermark slot — this is the highest-risk leak class in the product.
3. **Alert propagation moment:** issuing a warning lights the portal alert bar + posts from @WeatherDesk (WX-011) — design the cross-channel arrival so it feels like real weather: everywhere at once.

**States:** calm day · watch active · warning active (with Beat radar/cone imagery, WX-013).

## Shared constraints

- Staff-side authoring of both channels happens in the controller console (D5) — these briefs cover participant-facing surfaces plus the PIO composer (Wire Room only).
- Scenario time everywhere (COR-053); compliance chrome frames both.

## Anti-patterns

Making the Wire Room look like a CMS admin panel (it's a newsroom); consumer-app-styling the Weather Desk (institutional is the point); inventing novel weather-alert visual language when NWS conventions exist.
