# DECISIONS.md — Pulse Social App (D1)

Consolidated decision log for the participant social-app mockup (sessions 2–3 + adversarial
review). Each entry = decision + requirement IDs (SOC-xxx, COR-xxx, PRT-xxx, NFR-xxx, D0/D1 §).
This file is the input for story updates. Mockup: `Pulse Social App.dc.html`.

Anchor: X/Twitter familiarity — original Pulse design, no cloned pixels. Desktop-first pass
(PIO hunting mode); the mobile citizen frame is a separate follow-up session.

## D1-001 — Session scope
All nine brief screens on desktop: Feed (All Posts / Following), Thread, Composer (inline +
modal + org switcher), Search (#WaterIssues, Top/Recent, People), Explore/Trending (+ sidebar),
Profile (@FulcoEM), Notifications, DMs (Newsline 7 reporter thread), PIO multi-column toggle.
Clickable navigation, static content. **Satisfies** D1 §Key screens, SOC-040/041/050/054/060/
070/080/081/082.

## D1-002 — Demo state machinery lives outside the fiction
World-state (normal / burst / alert), observer mode, org-grant presence, and per-exercise
accent are component props (host Tweaks panel) — never controls inside the app frame. Dark
mode and PIO Columns ARE in-fiction user settings, so they are real UI. **Satisfies** D0 §2
cardinal rule (nothing breaks fiction, XC-002).

## D1-003 — Visual identity: original "Pulse", not a skin of X
Figtree type, pill nav, heartbeat-line logomark. Accent is a CSS custom property
(`--pulse-ac`) — **default Cadence navy `#1e3a5f`** (user decision, session 3) with curated
per-exercise rebrand swatches (crimson / teal / violet) as the COR-030 theming hook.
**Verification mark is a fixed seal-blue `#2D9CDB`, independent of the exercise accent** —
rebranding an exercise must never alter the trust signal trainees are trained on (SOC-052).
Dark + light modes, light default, working toggle.

## D1-004 — Compliance chrome + alert bar layering
22px green EXERCISE banners fixed at both viewport edges, *outside* the app frame (COR-031).
The PRT-010 alert bar renders *inside* the app, sticky at the top of the scroll area, amber
with an "⚠ ADVISORY" text chip (severity never color-only, NFR-001). Persists across every
screen including PIO columns.

## D1-005 — Burst state: buffer pill + aggregated notifications
Bursts never live-insert into the reading stream: a sticky accent pill ("▲ 218 new posts",
aria-live=polite) buffers them; notifications collapse to aggregates ("Newsline 7 and 41
others liked…") with a one-line "grouped" notice. **Satisfies** SOC-070/071, NFR-002.

## D1-006 — Thread layout: flattened (q1 RESOLVED)
X-style flattened thread: ancestry above the focused post, replies below, "Replying to
@handle" lines. A flattened-vs-nested comparison was built and reviewed; the user chose
**flattened**; the compare toggle and nested view were removed. Nested rationale on record:
depth beyond ~3 levels truncates on real content.

## D1-007 — Org account switcher = "Posting as" chip (SOC-006), grant-gated
Composer (inline + modal) carries a "Posting as: {account} ▾" chip — accent-tinted for org
accounts, neutral for personal. Menu lists personal + granted org accounts ("granted for this
exercise" hint). **Renders only for users holding org grants** (adversarial review): citizens
get the stock X composer with no chip. One identity at a time — multi-persona posting is the
controller/SimCell job (Controller Console), never a participant feature.

## D1-008 — Impersonation pair woven through content (SOC-052)
@FairhavenWater (verified, measured copy) vs @FairhavenWaterUpd (no mark, gray avatar, urgency
copy). The pair appears in the feed, the thread (a citizen calls it out), and side-by-side
under People in search. The platform never flags the fake (SOC-002/003) — absence of the mark
is the only signal. The near-duplicate avatars are intentional.

## D1-009 — Tombstones thread-only (SOC-005, CTL-025)
"This post is unavailable." card appears inside threads where a reply was taken down. Feeds
show no tombstones — removed posts simply vanish, matching real platforms.

## D1-010 — PIO multi-column: grant-gated nav toggle, off by default
"Columns" switch in the nav rail footer, rendered **only for org-grant holders**. On:
center + sidebar are replaced by TweetDeck-style columns (All Posts · #WaterIssues · "boil
water" search · Mentions @FulcoEM) with compact rows, action bars suppressed. Nav persists;
one click back. **Satisfies** D1 §9.

## D1-011 — Observer mode: controls don't render (COR-015)
Observer prop hides composer, Post button, Follow buttons, DM input, and the new-posts pill;
action rows remain visible as counts but inert. No disabled buttons anywhere.

## D1-012 — Follower magnitude (SOC-054)
Profile counts show magnitude (48.2K); expanding Followers lists the 5 real edges then
"…and ~48.2K others" — never a fake scrollable list.

## D1-013 — Layout anchors left, not centered (user decision)
The frame is left-anchored in every mode (nav rail hugs the viewport edge) rather than
X-style centered — user preferred the columns-mode feel everywhere.

## Adversarial review — responses

### D1-R1 — "Official sources" → "Who to follow" (critical, ACCEPTED)
Platform-labeled authority violated SOC-002/052. Renamed to "Who to follow" (SOC-053); the
imposter's presence in the module is now a legitimate controller lever, not a platform lie.
**Story impact:** the suggested-follows module must never carry authority labels.

### D1-R2 — Org chip + Columns render only with org grants (ACCEPTED)
See D1-007/D1-010. New `orgGrants` demo prop, default on (demo persona Dana Reyes holds PIO
grants). **Story impact:** SOC-006 stories should specify conditional render, not universal chip.

### D1-R3 — "No alert bar / observer state" (REJECTED — reviewer missed it)
Both exist as Tweaks-driven world states (`worldState: alert`, `observer`), deliberately
outside the fiction per D1-002. Reviewer saw the normal state only.

### D1-R4 — Data contradiction resolved toward coherence (ACCEPTED)
Utility post now acknowledges the county advisory ("precautionary boil advisory stays in
effect while lab results are pending") — realistic tension without incoherence. Deliberate
ADP-003 contradiction injects remain a controller move, not default mock data.

### D1-R5 — Minor fixes (ACCEPTED)
Varied trend category labels; notification bell count badge (3 normal / 5 alert / 99+ burst);
X-style depleting ring character counter (count appears at ≤20 remaining); Dark mode moved
from primary nav into the account (…) menu.

### D1-R6 — Deferred (logged)
Photo avatars via avatar library (COR-024) — initials are placeholders. Mobile frame.
Spec note: feed updates use aria-live=polite regions (new-posts pill, grouping notice) —
NFR-001 launch gate.

## Open / deferred
- Mobile citizen frame (D0 §4.6 mobile-first) — own design session.
- Photo avatar library integration (COR-024).
- DM two-pane static beyond the featured conversation.
- Watermark slot (NFR-008) on media templates — placeholder media only in this pass.
- Media/quote-post composer states — text + attach affordance only.
- Screen-reader live-region spec for feed updates (NFR-001) — noted, needs full spec.
