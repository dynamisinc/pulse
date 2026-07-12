# Handoff: Pulse Social App (D1) — v1

## Overview
Clickable design mockup of **Pulse** — the flagship *participant* surface of the ScenarioForge
family (Cadence conduct + Pulse world + Beat media): the simulated X/Twitter-like social
platform that trainees (PIOs, citizens-role-players, observers) live inside during an
emergency-management training exercise. Scenario data: the Fairhaven water-contamination arc
(#WaterIssues / boil-water advisory), continuous with the Controller Console (D5) package.

This package exists to (a) update the epic/user stories to match the design decisions made in
sessions 2–3 and the adversarial review (see `DECISIONS.md` — every decision cites the
requirement IDs it satisfies or amends) and (b) let a Claude Code session implement the app in
the real codebase.

Anchor per D1: **X/Twitter familiarity** — if a user has to think about how the platform works,
the design has failed. Original Pulse identity, no cloned pixels.

## About the Design Files
The files here are **design references created in HTML** — a working prototype showing intended
look and behavior, not production code. Recreate this design in the target codebase's
environment using its established patterns — do not ship this HTML.

`Pulse Social App.dc.html` is self-contained: a markup template plus a logic class (plain
React-style class named `Component`) holding all navigation state and mock data. `support.js`
is the prototype runtime — open the HTML in a browser to click through.

## Fidelity
**High-fidelity** for layout, hierarchy, navigation, interaction patterns, copy, and both color
modes. Simulated (replace with real systems): all feed/thread/notification/DM content (static
mock data), post/like/reply actions (visual only), the burst simulation (state swap, not a
stream), avatars (initials placeholders — production uses the COR-024 avatar library).
Note: Pulse is an **in-fiction consumer surface** — it deliberately does NOT use the COBRA/
Cadence staff components (those mark staff surfaces like the Controller Console). Brand link to
the platform is the accent color only (Cadence navy default, see Tokens).

## Requirements traceability — READ `DECISIONS.md` FIRST
`DECISIONS.md` (D1-001 … D1-013 + review responses D1-R1 … R6) is the log. **Story updates
needed — decisions that AMEND or sharpen requirements as written:**
- **q1 RESOLVED (D1-006):** thread layout is **X-style flattened** (ancestry above, replies
  below). Nested/indented rejected.
- **SOC-006 sharpened (D1-007/R2):** the org-account "Posting as" chip renders **only for
  users holding org grants**, and switching is one-identity-at-a-time. Citizens see the stock
  composer. Multi-persona posting is a Controller Console capability, never a participant one.
- **SOC-053 sharpened (D1-R1):** the suggested-follows module is titled **"Who to follow"** —
  the platform must never label accounts "official" or authoritative. The verified mark (and
  its absence) is the only credibility signal (SOC-002/052).
- **SOC-052 (D1-003):** the verification mark color is **fixed seal-blue `#2D9CDB`**,
  independent of per-exercise accent theming (COR-030). Rebranding never alters trust signals.
- **PIO columns grant-gated (D1-010/R2):** the Columns toggle renders only for org-grant
  holders; off by default.
- **COR-015 (D1-011):** observer/read-only = controls **absent, not disabled**.
- **SOC-070/071 (D1-005):** bursts buffer behind a "new posts" pill (aria-live=polite);
  notifications aggregate under load. Never live-insert into the reading stream.
- **SOC-054 (D1-012):** follower counts are magnitude ("48.2K"); follower lists show real
  edges + "…and ~48.2K others", never fake scrollable lists.
- **SOC-005 (D1-009):** takedown tombstones appear in threads only; feeds silently omit.
- **Demo/world state is out-of-fiction (D1-002):** normal/burst/alert, observer, orgGrants,
  accent are exercise-config props — no in-app controls for them.

## Screens / Views
Global chrome on every screen: 22px green EXERCISE banners fixed at top+bottom viewport edges
(outside the app frame, COR-031); when `worldState=alert`, a sticky amber advisory bar
("⚠ ADVISORY · Boil Water Advisory — Zones 2–4 · Guidance from @FulcoEM →") inside the app
above all content, persisting across screens (PRT-010, NFR-001 text+icon severity).

Frame is **left-anchored** (D1-013): `240px nav rail | 600px main | 344px sidebar`
(main is 952px on Messages; sidebar hidden there and in columns mode).

**1. Nav rail (240px)** — Pulse heartbeat logomark; pill nav items Home / Explore(#) /
Notifications (count badge: 3 normal · 5 alert · 99+ burst) / Messages / Profile; navy "Post"
button (opens composer modal). Footer: "Columns" switch (org-grant holders only), account card
Dana Reyes @dreyes_fh with (…) menu → Dark mode switch, Settings and privacy, Log out.

**2. Feed (Home)** — sticky header, All Posts / Following tabs (accent underline). Inline
composer: avatar, grant-gated "Posting as: {account} ▾" chip (accent-tinted when org account
selected; menu = personal + org accounts + "granted for this exercise" hint), textarea
("What's happening in Fairhaven?"), image-attach icon, depleting ring counter (280 chars,
count text appears ≤20 left), Post button. Burst state: sticky "▲ 218 new posts" pill
(aria-live=polite) — posts never live-insert. Post cards: 42px avatar, name + optional
seal-blue verified check + handle + relative time, text, optional media placeholder or link
card, action row (reply / repost / like / share, counts, accent hover).

**3. Thread** — flattened (q1 resolved): ancestor post → focused post enlarged (22px text,
timestamp line, repost/quote/like stat row) → replies with "Replying to @handle". Contains a
takedown tombstone ("This post is unavailable.") and the impersonation-callout beat.

**4. Explore / Trending** — search box, trend rows with varied category labels ("Trending",
"Public safety · Trending", "Fairhaven · East side", "News · Newsline 7"), name, post count.

**5. Search results (#WaterIssues)** — Top / Recent tabs; **People** section showing the
impersonation pair side-by-side (@FairhavenWater verified vs @FairhavenWaterUpd unmarked);
Posts list.

**6. Notifications** — Pulse Safety Notice card (alert state, platform-branded, points to
@FulcoEM); rows with typed symbols (♥ like pink / ⇄ repost green / @ mention accent / + follow
violet). Burst: aggregated rows ("Newsline 7 and 41 others…") + "High activity — similar
notifications are grouped." notice.

**7. Messages (two-pane, 952px)** — conversation list (340px) + chat: Newsline 7 reporter
verification exchange (bubbles, own = accent). Other conversations static.

**8. Profile (@FulcoEM)** — accent-tinted banner, 110px avatar, Following button, verified
name, bio, meta row (location/link/joined), Following/Followers counts; expanding Followers
shows 5 real edges + italic "…and ~48.2K others" (SOC-054). Posts/Replies/Media tabs; posts
include the advisory with map placeholder.

**9. PIO multi-column mode** — replaces main+sidebar with horizontally-scrolling 352px
columns: All Posts · #WaterIssues (saved hashtag) · "boil water" (saved search) · Mentions
@FulcoEM. Compact rows (32px avatars, no action bars). Nav rail persists.

**10. Composer modal** — 600px overlay: ✕/Drafts header, same posting-as chip + textarea +
attach + ring counter + Post as the inline composer.

## Demo/world states (component props — the Tweaks panel, NOT in-fiction UI)
- `worldState`: `normal` | `burst` (new-posts pill, aggregated notifications, 99+ badge) |
  `alert` (advisory bar + safety notice + 5 badge)
- `observer`: boolean — hides composer/Post/Follow/DM input/pill; counts inert (COR-015)
- `orgGrants`: boolean — gates the posting-as chip and Columns toggle (SOC-006)
- `accent`: per-exercise brand color (COR-030); default Cadence navy

## Interactions & Behavior
- All nav is clickable: rail items, back arrows, posts → thread, search box → results,
  trends → results, tabs, Followers expand, account/org menus, composer open/close/send.
- Dark/light toggle (account menu) restyles via CSS custom properties; light default.
- Ring counter depletes as you type; count text at ≤20 remaining, amber low state.
- Org switcher: selecting an account updates both composers; accent chip = org identity cue.
- Content beats to preserve: rumor post outpacing official (640 vs 298 reposts); utility post
  acknowledging the county advisory (coherent tension, D1-R4); citizen calling out the
  imposter in-thread; reporter DM verification exchange.

## State Management (production)
Session/identity (user, org grants, active posting identity); feeds (All/Following, buffered
burst inserts + pill count); threads (flattened ancestry/replies, tombstones); search (query,
Top/Recent, people + posts); notifications (typed, aggregation under load); DMs; profiles
(magnitude counts + real edges); saved columns (PIO mode); world/alert state pushed by the
exercise engine (advisory bar + safety notice); observer flag from exercise role; theme.

## Design Tokens (prototype values)
- Type: **Figtree** (400–800); 15px post text, 22px focused post, 19px nav/heads.
- Accent: `--pulse-ac` default **`#1e3a5f` (Cadence navy)**; swatches `#DB3A54` crimson,
  `#0F9182` teal, `#7C4DD8` violet (COR-030).
- **Verified seal: `#2D9CDB` fixed** (never themed). Notification hues: like `#e0245e`,
  repost `#17a06b`, follow `#7c5cd6`.
- Light: bg `#fff`, panel `#f3f5f6`, line `#e5e8ea`, ink `#0e1518` / `#61707a`.
- Dark: bg `#0c1116`, panel `#161e25`, line `#233039`, ink `#e9eef1` / `#8aa0ac`.
- Alert bar: light `#fff3dd`/`#e3b25f`/`#6b4300`, dark `#33270e`/`#f2cf8a`; chip `#b97a00`.
- Exercise banners: `#2e6b2e` bg, `#eaf5e6` text, 22px, letterspaced 700 caps.
- Radii: pills 999px, cards/media 14–16px, menus 14px. Hover: 4.5% ink wash.

## Assets
None external (Figtree via Google Fonts). Icons are inline SVG strokes; avatars are initials
placeholders — production uses the avatar library (COR-024) and real media with the NFR-008
watermark slot (deferred, see DECISIONS).

## Files
- `Pulse Social App.dc.html` — the full prototype (template + logic + all mock data).
- `DECISIONS.md` — consolidated decision log with requirement traceability (input for story
  updates).
- `support.js` — prototype runtime; lets the HTML run standalone (reference only).
- Related package: `design_handoff_controller_console/` (D5) — the staff surface running the
  same Fairhaven scenario.
