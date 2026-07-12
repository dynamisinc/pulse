# E3 — Exercise Portal

> **Epic ID:** E3 · **Requirement prefix:** PRT
> **Depends on:** E1; aggregates E2/E4/E5/E6 content
> **Roles served:** all participants (front door), evaluators
> **Looking Glass parity target:** the RIP Board landing page (and part of the RIP Alerts role)

## 1. Epic summary

The participant's front door and situational-awareness hub: a branded, local-news-portal-style landing page that aggregates everything happening across the simulated information environment — top stories, the live social stream, latest press releases, weather, and high-priority alerts. In Looking Glass this is the RIP Board; participants log in and land here, then fan out to the individual apps.

The portal does double duty: **navigation shell** for the whole simulated internet, and **an ambient "state of the world" display** that makes the exercise feel alive the moment a participant logs in.

## 2. Features & requirements

### F3.1 Landing page & aggregation

| ID | Requirement |
|---|---|
| PRT-001 | The portal is the post-login landing surface for all participants once it ships (per COR-004; in pilot mode the Social feed is the landing surface, Master §4). |
| PRT-002 | Configurable branded masthead: exercise-world portal name (default templated **"[City] Today"**, e.g., "Atlanta Today"), logo, dateline showing current date/time in **scenario time** (COR-053) in the exercise time zone. |
| PRT-003 | Modular section layout, planner-configurable per exercise: Top Stories (E4), Social Stream (E2 live excerpt), Press Room latest (E5), Weather widget (E6), Trending topics (E2). Sections for disabled channels hide cleanly. |
| PRT-004 | Top Stories: editorially ordered by controllers (pin/feature) with automatic fallback to most-recent; each card links to the full article on its outlet site (E4). |
| PRT-005 | Social Stream module: live-updating sample of recent public posts with deep links into E2 (post → thread, account → profile). |
| PRT-006 | All portal content is exercise-scoped (XC-001) and live-updating without refresh. |

### F3.2 Alert bar (RIP Alerts replacement, with SOC-072)

| ID | Requirement |
|---|---|
| PRT-010 | A high-priority alert bar/ticker renders on the portal **and persists across all enabled channels** (decided — the EAS analog), displaying controller-flagged alerts: emergency notifications, breaking-news flashes, weather warnings (E6 auto-feeds). |
| PRT-011 | Alerts carry severity styling (informational / warning / emergency) — never conveyed by color alone (NFR-001) — timestamp, and link-through to the underlying content. |
| PRT-012 | Alert history is reachable (bell icon / alerts page) so late-joining participants can catch up. |

### F3.3 Navigation shell

| ID | Requirement |
|---|---|
| PRT-020 | Persistent, unobtrusive navigation to every enabled channel (Looking Glass pattern: footer icons + fly-out menu). Design should improve discoverability over Looking Glass — their guidance banner ("click the LG resource tab...") signals users struggled to find apps. |
| PRT-021 | Compliance chrome (COR-031) renders here as on all channels. |
| PRT-022 | Optional "Resources" area for exercise-supplied non-fiction materials (quick-start guide, ground rules) — the one sanctioned immersion-adjacent surface, kept visually separate from fictional content. |

### F3.4 TTX display mode (Phase 3 — Master decision 10)

| ID | Requirement |
|---|---|
| PRT-040 | **Kiosk/big-screen mode:** a facilitator-driven, login-free display view for tabletop exercises — clean full-screen rendering of a chosen surface (portal, a feed, a specific article/post/warning), auto-cycling playlists, and facilitator remote control ("show this next"). Pairs with module-based time advancement (COR-052): advancing a module updates the display. TTXs outnumber functional exercises ~3:1 among target customers; without this, screenshots-in-PowerPoint remains cheaper for the majority use case. |
| PRT-041 | Kiosk sessions are read-only, exercise-scoped, and count in telemetry as a display session (not attributed person-level — shared screens, review finding D9). |

### F3.5 World texture

| ID | Requirement |
|---|---|
| PRT-030 | Planners can seed evergreen filler content — human-interest stories, business features, "Get to know" profiles (as seen on RIP Board) — so the world doesn't only contain crisis. Supports pre-StartEx normalcy (Staged state, COR-043) and pacing lulls. |
| PRT-031 | Filler content is authorable in the same pipeline as news articles (E4) and taggable as background vs. scenario-relevant for E10 signal/noise metrics. |

## 3. User experience

**Login → world.** A participant logs in and lands on "the local news homepage": masthead with the fictional city's portal brand, a lead story with hero image, a right rail of live social chatter, today's weather, and a press release list. It reads like a real local media portal on a normal day — until the exercise starts, when the alert bar lights up, Top Stories turn to the incident, and the social rail accelerates. The portal is where a participant *feels* the world state change.

**During conduct.** PIOs mostly live in Pulse (E2) and The Wire Room (E5), but the portal is the pulse-check: what's leading the news, what's trending, what alerts are active. Controllers use featured-story pinning (E7) to steer what the "public" is seeing first.

**Design notes.** News-portal visual language (think local TV station site: bold headlines, card grid, category chips) — deliberately distinct from E2's social app and E4's outlet sites. Fully responsive; the portal is many participants' phone home screen.

## 4. Out of scope

Article authoring/rendering (E4), press release authoring (E5), weather data (E6), alert *creation* (E7 controller surface).

## 5. Open questions

1. ~~Portal branding~~ **Resolved:** neutral aggregator distinct from E4 outlets, default brand **templated as "[City] Today"** (e.g., "Atlanta Today") — per-exercise by construction, zero fixed trademark surface.
2. ~~Alert bar scope~~ **Resolved:** persists across all channels (PRT-010).
