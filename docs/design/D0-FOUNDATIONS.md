# Pulse Design Foundations

> Shared context for every Pulse design session. Read this first; then the surface brief for the session. Full requirements live in the epic docs (`../0X-*.md`) — briefs cite requirement IDs where a design decision is constrained.

## 1. Design philosophy (Dynamis house rules)

- **Clean, intuitive, not busy.** Every screen earns its elements. Density is opt-in (staff surfaces), never default.
- **Minimize training via familiarity.** UX mirrors applications people already use every day. For Pulse this splits two ways:
  - **Participant surfaces mirror the real consumer apps they simulate.** The social app should feel like X/Twitter, the portal like a local TV-station news site, the weather service like weather.gov. This is both the training-minimization principle *and* the immersion requirement — if a PIO needs training to use a fake Twitter, we've failed twice.
  - **Staff surfaces mirror Cadence.** Controllers, evaluators, and planners are Cadence users; Pulse's staff consoles reuse Cadence's patterns, vocabulary (fire/skip/defer, dual time), and visual conventions so a Cadence-trained controller is productive immediately.
- **Framework:** React 19 + TypeScript + Vite, MUI 7 with the in-house COBRA styling system, FontAwesome — same as Cadence. Participant surfaces are heavily themed/skinned MUI: they must *never* read as an enterprise app (no default MUI look on any participant path).

## 2. The two visual worlds

| | Participant world (the fiction) | Staff world (the machine) |
|---|---|---|
| Feel | Consumer apps: warm, familiar, brandable | Cadence-family operator tooling: dark chrome, dense-on-purpose |
| Anchors | X/Twitter, local news portals, PR newsrooms, weather.gov | Cadence conduct views, TweetDeck-style columns |
| Theming | Per-exercise brands (COR-030); per-outlet skins (NWS-002) | Fixed COBRA system look |
| Cardinal rule | Nothing breaks fiction (XC-002); no platform-added badges (SOC-002) | Never confusable with a participant view (E1 §5) |

The **compliance chrome** (COR-031) frames the participant world: thin classification/exercise banners at the very top and bottom viewport edges, visually *outside* the app frame — Looking Glass's green bars are the precedent. The **real-world broadcast** (CTL-024) must be designed as visually alien to both worlds: it's the house lights.

## 3. Brand set (screened defaults, theme-configurable)

| Surface | Brand | Anchor app |
|---|---|---|
| Social | **Pulse** (product name in-fiction) | X/Twitter |
| Portal | **"[City] Today"** (templated) | Local TV-station site |
| TV outlet | **Newsline 7** | Local broadcast news site |
| Paper | **The Courier-Ledger** | Local newspaper site |
| Wire | **The National Wire** | AP/wire service |
| Tabloid | **The Scoop** | Celebrity/gossip site (deliberately less trustworthy) |
| Press wire | **The Wire Room** | Municipal newsroom / PR Newswire |
| Weather | **The Weather Desk** | weather.gov / NWS |

## 4. Non-negotiables in every design

1. **Accessibility (NFR-001):** WCAG 2.1 AA on participant + evaluator surfaces. Severity/alert states never color-only. Live feeds need specified screen-reader live-region behavior. Staff console fully keyboard-operable.
2. **Scenario time is the only time participants see (COR-053).** Timestamps, datelines, "2h ago" — all scenario time.
3. **Verification semantics (SOC-052):** the checkmark is a *trainable signal*, and impersonation (lookalike unverified accounts) must be visually possible.
4. **Alert bar persists across all channels (PRT-010)** — the EAS analog; severity-styled, not color-only.
5. **Burst legibility (SOC-071, NFR-002):** feeds and notifications must stay smooth and readable at 120 posts/min. The stress is the training; jank is not.
6. **Mobile:** participant surfaces mobile-first (citizens live on phones; shared article links open on phones). Staff surfaces desktop-first.
7. **Watermark readiness (NFR-008):** high-risk content templates (warnings, alerts, articles) reserve an unobtrusive slot for the in-content "EXERCISE" mark — designed now, shipped fast-follow.

## 5. Looking Glass: not a design input

**Looking Glass screenshots are deliberately excluded from design sessions.** Examples anchor, and we are not building a better Tweeder — we're building the real thing's equal. Every functional lesson LG taught is already encoded in these briefs and the epics (repeated-voices pattern, banner chrome precedent, multi-app structure, their discoverability failure). Functional parity with LG is enforced by the requirements docs and story agents, not by looking at their pixels.

**Design references are the real anchors named in each brief:** X/Twitter for the social app, actual local-news sites for the portal and outlets, weather.gov for The Weather Desk, PR newswires for The Wire Room, and Cadence for staff surfaces. If a designer wants a competitive reference, the answer is "open the real app," never "open Looking Glass."

## 6. Session plan

| # | Session | Brief | Priority rationale |
|---|---|---|---|
| 1 | Controller console | D5 | Phase 1 build; sales demo asset |
| 2 | Social app (Pulse) | D1 | Phase 1 build; the flagship |
| 3 | Portal ("[City] Today") | D2 | Phase 3 but shapes the world's first impression |
| 4 | News outlets | D3 | Phase 3; four skins, one system |
| 5 | Press + Weather | D4 | Phase 3; smaller, institutional |
| 6 | Evaluator dashboard | D6 | Phase 4; chart-forward analytics |

Each session output: clickable HTML/React mockup + decisions log. Mockups structured for component reuse (MUI-based) so approved designs seed the real frontend.
