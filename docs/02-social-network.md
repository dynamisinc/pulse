# E2 — Social Network

> **Epic ID:** E2 · **Requirement prefix:** SOC
> **Depends on:** E1 · **Feeds:** E3 (portal stream), E8 (adaptive engine surface), E10 (telemetry)
> **Roles served:** Participants (PIO + citizen roles), Controllers, Evaluators
> **Looking Glass parity target:** Tweeder (and absorbs the RIP Alerts notification role)

## 1. Epic summary

The Twitter/X-style social platform — Pulse's namesake and center of gravity. Short-form public posts from a cast of personas and participants, with threads, amplification, reactions, hashtags, trending, search, DMs, and notifications. This is where the public information chaos lives: repeated citizen reports in different voices, rumors, agency responses, and the PIO's fight for the narrative.

Design north star from the vision doc: **indistinguishable from a real platform to participants; a fully instrumented data stream to everyone else.**

## 2. Content model

### F2.1 Posts

| ID | Requirement |
|---|---|
| SOC-001 | A post: text (280-char default, per-exercise configurable), 0–4 images or 1 video (inline playback — this is the Utube replacement path), hashtags, @mentions, optional location tag. |
| SOC-002 | Posts render author identity: avatar, display name, handle, verified checkmark when applicable. **No platform-added editorial badges** (no "OFFICIAL," no "BREAKING" chrome) — authority lives in the author's identity and their own text/formatting. |
| SOC-003 | Every post records: author persona/participant (including the individual human behind a shared org account, COR-018), created wall-clock time, exercise scenario time (from the native exercise clock, COR-050 — available from Phase 1), origin (participant / controller-as-persona / adaptive engine / fired inject). Origin is never participant-visible. Participant-visible timestamps render in **scenario time** (COR-053). |
| SOC-004 | Posts support link previews for in-simulation URLs (news articles E4, press releases E5, weather alerts E6) — cards render title/image like real platforms. |
| SOC-005 | Deleting: participants can delete their own posts (soft delete, retained for AAR per XC-010); a deleted post shows a "post unavailable" tombstone in threads, mirroring real platforms. Controller takedowns per CTL-025. |
| SOC-006 | **Post-as-organization:** participants granted org-persona operation (COR-018) get an account switcher in the composer ("posting as: Fulton County EM") and can post, reply, and DM as that organization. Multiple humans on one org account is a supported, attributed pattern — the JIC reality. |

### F2.2 Threads & replies

| ID | Requirement |
|---|---|
| SOC-010 | Replies form branching threads of unlimited depth; thread view shows ancestry chain + nested/flattened descendants (design decides pattern; X-style flattened recommended). |
| SOC-011 | Reply counts display on posts; tapping opens the thread. |
| SOC-012 | Personas (via controllers or E8) can reply to participant posts — the "agency responds to citizen" pattern seen in Looking Glass, and its inverse: citizens piling onto official posts. |

### F2.3 Amplification (reposts & quotes)

| ID | Requirement |
|---|---|
| SOC-020 | Repost (share to own audience, attributed "X reposted") and quote-post (repost with commentary) both supported — quote-posting is how misinformation mutates, a core E8 mechanic. |
| SOC-021 | Repost/quote counts display and are queryable for spread analysis (E10 misinformation-containment metrics). |
| SOC-022 | A post's amplification chain (who spread it, when, in what order) is fully reconstructable from telemetry. |

### F2.4 Reactions

| ID | Requirement |
|---|---|
| SOC-030 | Baseline: like, with count. |
| SOC-031 | Sentiment-carrying reaction set (e.g., support / anger / fear / skepticism) is a per-exercise option; when enabled, reactions aggregate into the public-mood signal consumed by E8 and E10. Design must keep the participant-facing presentation indistinguishable from a normal reaction picker. |

### F2.5 Hashtags & topics

| ID | Requirement |
|---|---|
| SOC-040 | Hashtags are parsed from post text, linkified, and searchable; tapping a hashtag shows its feed (chronological + "top" tab). |
| SOC-041 | Trending list derives **organically from actual activity** (velocity-weighted usage within the exercise) — never manually declared. Controllers influence trends primarily by generating real activity (E7/E8); additionally, a controller **boost-weight lever** can bias a topic's trend weight for conduct-timing needs (#BoilWater trending at 14:00 sharp) — logged as a steering action (XC-004), never rendered as anything but an organic trend. |
| SOC-042 | Trending is exercise-scoped and recomputed at near-real-time cadence (≤60s staleness). |

### F2.6 Profiles & social graph

| ID | Requirement |
|---|---|
| SOC-050 | Profile page per persona/participant: banner, avatar, bio, join date, follower/following counts, tabs for Posts / Posts & replies / Media / Likes. |
| SOC-051 | Follow/unfollow with follower-count effects; participants can follow any account in their exercise. |
| SOC-052 | Verified checkmark renders on qualifying personas (E1 flag). Impersonation scenarios (unverified lookalike accounts) must be fully supportable — near-duplicate names/avatars are allowed by design. |
| SOC-053 | Suggested follows: surfaced on social onboarding (and portal, Phase 3), seeded by planners (key agencies, outlets) and adjustable live by controllers as an attention-steering lever. |
| SOC-054 | **Audience model (definitional — E8 spread and E10 reach compute over this):** every account has an **audience magnitude** (from the E1 template band, evolving with activity) *distinct from* the real follow graph (actual follow edges). Displayed follower **count** = audience magnitude + real edges. Follower **lists** render real edges plus a "and ~48.2K others" affordance — never a fabricated scrollable list. Reach/impressions proxies (EVL-012) and amplification velocity (ADP-004) are defined as functions of audience magnitude; the formula lives with this requirement and is shared by E8/E10. |

### F2.7 Direct messages

| ID | Requirement |
|---|---|
| SOC-060 | 1:1 DMs between any accounts in the exercise; group DMs are stretch. |
| SOC-061 | DM use cases to support: citizen tips to official accounts, coordination between participants, and targeted misinformation/social-engineering vectors (persona DMs a participant). |
| SOC-062 | DMs are visible to evaluators/controllers in staff surfaces (participants are told observability applies to the whole environment via exercise ground rules — product-supplied boilerplate, NFR-007). |

### F2.8 Notifications

| ID | Requirement |
|---|---|
| SOC-070 | In-app notification center + badge: mentions, replies, reposts, likes, follows, DMs. |
| SOC-071 | Notification volume is a training lever: controllers/E8 can generate mention-storms; the design must stay performant and legible under bursts (aggregation: "42 people liked your post"; NFR-002 load targets). |
| SOC-072 | Absorbs the RIP-Alerts role together with E3's portal alert bar: high-priority official broadcasts can be pushed as platform-wide notifications when a controller flags an inject as an alert. In pilot mode (pre-E3) this is the sole alert delivery path (Master §4). |

## 3. Feeds & discovery

| ID | Requirement |
|---|---|
| SOC-080 | **All Posts feed** (global): every public post in the exercise, chronological. Default view for PIO-role accounts. |
| SOC-081 | **Following feed**: posts from followed accounts. Default for citizen-role participants *with named accounts*; read-only sessions (COR-015) default to All Posts (they cannot follow). |
| SOC-082 | Full-text search across posts, hashtags, and accounts (exercise-scoped), with recency/top sort. PIO workflow: find first mention of a rumor. |
| SOC-083 | Feeds update in real time (new-posts pill or live insert; design decides) without manual refresh. |
| SOC-084 | *Stretch:* engagement-weighted "For You" feed mode (per-exercise toggle) that amplifies sensational content — the feed-algorithm-as-teaching-mechanic from the vision doc. Chronological remains the launch default. |

## 4. User experience

**The PIO's morning.** StartEx. The PIO opens Pulse — defaulted to the All Posts firehose. Scattered normalcy: brunch photos, traffic gripes. Then the same complaint starts arriving in different voices — "did they change trash pickup?", "my street got missed," "who do I even call?" — the Looking Glass repeated-voices pattern. The PIO searches `#DPW`, sees a cluster forming, watches it hit Trending, and drafts an official post from their agency account (SOC-006 account switcher). Replies land within minutes; some grateful, one quote-post twisting the message. The PIO now has to decide whether to engage the distortion. Every timestamp of that decision chain is captured — attributed to the individual human behind the shared handle.

**The citizen participant.** A participant playing a community member lives in the Following feed on their phone. They see what an ordinary resident sees — which does *not* include the official account they never followed. That gap (official message sent ≠ public reached) is the teaching moment, and E10 measures it.

**Bursts and storms.** When E8 or controllers escalate, the feed accelerates: posts every few seconds, notification storms on the official account. The UI must stay smooth and legible — the stress is the training, jank is not.

**Evaluator lens.** Evaluators browse the same surfaces read-only, plus staff overlays (E10): hover a post for origin, timing offsets, spread stats.

## 5. Design notes

- Visual language: contemporary X/Twitter-class product, distinct enough to be its own brand. **The in-fiction brand is "Pulse" (decided)** — the product name doubles as the participant-visible app name; per-exercise rebranding remains possible via theming. MUI-based but should not read as "enterprise app."
- Dark/light per user preference; theming hooks for the participant-visible brand.
- Mobile-first for citizen roles; information-dense multi-column optional layout for PIO/monitor desktop use (consider a TweetDeck-style monitoring layout as a PIO-mode option — strong candidate given "monitoring-first for PIOs").
- Accessibility per NFR-001: live-region behavior for real-time feed updates is a design deliverable, not an afterthought.

## 6. Out of scope

Standalone video site, stories/live/polls formats (revisit post-launch), Lookbook-style second network, content-generation automation (E8), controller posting surface (E7 — though it posts *into* this channel).

## 7. Open questions

1. Flattened vs. nested thread rendering.
2. Are participant "citizen" accounts pre-seeded with followings/history so their feed isn't empty at StartEx? (Recommended: yes, planner-configurable starter graph.)
3. Post editing: real platforms allow edits with history; training value vs. build cost — recommend no edit at launch.
