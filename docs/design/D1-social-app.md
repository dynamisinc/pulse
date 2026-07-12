# D1 — Design Brief: Pulse (Social App)

> Epic: `../02-social-network.md` · Anchor: **X/Twitter** — if a user has to think about how to post, reply, or search, the design has failed the familiarity test.

## Purpose & users

The flagship participant surface: where the public information chaos lives. Three usage modes, one app: **citizen** (phone, Following feed, casual), **PIO/monitor** (desktop, All Posts firehose, hunting), **read-only observer** (shared credential, browse-only — controls they can't use simply don't render, no disabled-button clutter; COR-015).

## Key screens

1. **Feed** — All Posts / Following tabs (SOC-080/081). Chronological. Real-time updates via a "New posts" pill (calmer than live-insert; predictable under bursts). Post card: avatar, name, handle, checkmark, scenario-relative time, text, media, link cards, reply/repost/like counts. Nothing else — no badges, no origin hints (SOC-002/003).
2. **Thread view** — X-style flattened (recommended, open q1): ancestry chain above, replies below.
3. **Composer** — inline + modal. Char counter, media attach, and the **org account switcher** (SOC-006): a clearly visible "Posting as: Fulton County EM ▾" chip when the user holds org grants. This is the one element with no everyday-X analog — design it like account switching in Instagram/Gmail, which people do know.
4. **Search & hashtag feeds** (SOC-082, SOC-040) — recency/top tabs. The PIO's rumor-hunting tool; search must be one tap from anywhere.
5. **Trending** (SOC-041) — sidebar on desktop, Explore tab on mobile.
6. **Profile** (SOC-050, SOC-054) — banner, bio, counts (audience magnitude + edges), post tabs. Follower lists: real edges + "and ~48.2K others" (never a fake scrollable list).
7. **Notifications** (SOC-070/071) — aggregation under storms ("42 people liked…"). Platform alerts (SOC-072) render distinctly but in-fiction.
8. **DMs** (SOC-060) — standard two-pane messaging.
9. **PIO monitor layout** *(desktop option)* — TweetDeck-style multi-column: All Posts + saved searches/hashtags. Off by default; a power-user toggle, not the default experience (clean-not-busy).

## States to design

- **Normal day** (Staged/ambient), **burst/storm** (feed at 120 posts/min stays legible — NFR-002), **alert active** (cross-channel alert bar present, PRT-010).

## Constraints & cues

- Brand: **Pulse**; theming hooks for per-exercise rebrand. Dark/light modes.
- Verified checkmark styling supports impersonation scenarios (SOC-052): the *absence* of a mark must be noticeable to a trained eye but not flagged by the platform.
- Deleted/taken-down content: "post unavailable" tombstone (SOC-005, CTL-025), exactly like real platforms.
- All timestamps scenario time (COR-053).
- Live-region behavior for feed updates is part of this design (NFR-001).
- Mobile-first; the citizen experience is the phone experience.

## Anti-patterns

Tweeder's dated look; MUI-default appearance; any "FOR EXERCISE" marking inside the app frame (that's chrome/watermark territory); engagement-bait UI we'd have to train around.
