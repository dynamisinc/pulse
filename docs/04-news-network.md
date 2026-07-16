# E4 — News Network

> **Epic ID:** E4 · **Requirement prefix:** NWS
> **Depends on:** E1 · **Feeds:** E3 (top stories), E2 (link cards), E10 (telemetry)
> **Roles served:** Participants (readers), Controllers (publishers), Evaluators
> **Looking Glass parity target:** NewsNow (TV news site) + "Today's Paper" (and absorbs Utube via embedded video)

## 1. Epic summary

Simulated news media: one or more news outlets per exercise, each with a branded site, full articles at shareable permalinks, breaking-news treatment, and categories. News articles are the heavyweight injects of the information environment — where a rumor becomes "confirmed by media," where officials get quoted or misquoted, and where Beat-produced broadcast video lands.

Looking Glass demonstrated the pattern: NewsNow published "Emergency Call Delays" at a real URL participants could read and share on Tweeder. Pulse replicates that and tightens the loop: articles are first-class content with the same telemetry as everything else.

## 2. Features & requirements

### F4.1 Outlets

| ID | Requirement |
|---|---|
| NWS-001 | An exercise supports multiple news outlets, each a persona (E1) of type news-outlet with its own brand: name, logo, color scheme, tagline, category set. |
| NWS-002 | Outlet templates ship in the cast library with distinct visual identities — outlet credibility diversity is a training feature. Default template brands (screened, theme-configurable): **Newsline 7** (local TV), **The Courier-Ledger** (city paper), **The National Wire** (wire service), **The Scoop** (tabloid/low-credibility). |
| NWS-003 | Each outlet has a homepage: lead story, category sections, latest list — a scaled-down news site per Looking Glass's NewsNow layout. |
| NWS-004 | Outlets have paired social presences (E2 accounts) so a story can break as a post linking to the article — the real-world pattern. |

### F4.2 Articles

| ID | Requirement |
|---|---|
| NWS-010 | Article model: headline, dek/subhead, hero media (image or inline Beat video), rich body (text, embedded images/video, pull quotes, embedded social posts from E2), byline (persona reporter optional), category, publish timestamp (scenario + wall clock, rendered in scenario time per COR-053), outlet. |
| NWS-011 | Every article gets a stable, exercise-scoped permalink; opening it renders a full article page under the outlet's brand (Looking Glass parity: `/news-now/emergency-call-delays/`). |
| NWS-012 | Breaking-news treatment is authorial, not platform chrome: outlets can style headlines/banners within their own brand (consistent with the no-platform-badges principle — the *outlet* says BREAKING, not Pulse). |
| NWS-013 | Articles can be published immediately, scheduled, or held for controller fire (E7/E9 inject flow). Updates/corrections append an editor's note — correction behavior is itself a scenario lever (an outlet that quietly rewrites vs. transparently corrects). |
| NWS-014 | Embedded video plays inline with a broadcast-style player — this is the primary Utube-replacement surface for Beat news clips. |
| NWS-015 | Articles are link-previewable in E2 (SOC-004) and featurable on the portal (PRT-004). |

### F4.3 Authoring

| ID | Requirement |
|---|---|
| NWS-020 | Controller/planner article editor: rich text (sanitized per NFR-004), media insertion (upload or Beat asset picker via E9), outlet + byline selection, category, schedule/hold controls, preview-as-participant. |
| NWS-021 | Article templates by story type (breaking hard news, follow-up, human interest, press-conference recap) to speed authoring during conduct. |
| NWS-022 | E8 (adaptive engine) can draft articles for controller review in later phases; the authoring pipeline must accept programmatic drafts from day one (draft status + review queue). |

### F4.4 Reader experience & telemetry

| ID | Requirement |
|---|---|
| NWS-030 | Article views, dwell (best-effort), and share-outs to E2 are captured per session for E10. View/dwell telemetry is **session-level evidence, not person-level proof** (PIO teams share screens and projectors) and is labeled as such in evaluation outputs. |
| NWS-031 | Comments on articles are **out of scope at launch** (public discourse lives in E2); an outlet page links to "discussion" on its social post instead. |
| NWS-032 | Article pages are a high-risk leak class: in-content "EXERCISE" watermarking applies per NFR-008 once available (banners-only at launch). |

## 3. User experience

**The misquote cycle.** Mid-exercise, a controller fires a prepared article: "Emergency Call Delays," hero image, quotes an unnamed city official, embeds a Beat-produced anchor clip. It publishes to Newsline 7's site, auto-posts from Newsline 7's social account with a link card, and gets pinned to the portal's Top Stories. Citizens (E8/controllers) start quote-posting the scariest line. The PIO reads the article, spots the misquote, and has to respond — press release (E5), social thread (E2), or request a correction (a DM/roleplay path to the outlet persona). Every step is timestamped.

**Reading experience.** Clean, credible local-news design per outlet: masthead, category nav, headline typography, hero media, share affordances. The Scoop's tabloid template looks appropriately louder and less trustworthy — participants should be able to *feel* source quality, because assessing it is the skill being trained.

**Design notes.** One rendering system, multiple outlet skins (theme tokens per outlet). Article pages must look excellent on mobile — that's where shared links get opened.

> **Approved design proposal (D3, 2026-07):** the one-system/four-token-skins contract, the invariant article slot anatomy, the skin token surface (CAN/CANNOT), and the four outlet registers are decided — see [`design/D3-news-outlets/`](design/D3-news-outlets/DECISIONS.md) (`D3-P1…P4`). [`STORY-UPDATES.md`](design/D3-news-outlets/STORY-UPDATES.md) carries the requirement amendments; the E4 story decomposition folds them in. Approved at proposal fidelity (exhibits 1a/1b); the full clickable mockup is the next design deliverable.

## 4. Out of scope

Standalone video platform, article comment threads, participant-authored articles (participants publish via Press Room E5; if an exercise casts a participant *as* media, they get controller-style outlet access — edge case, config-level).

## 5. Open questions

1. ~~Reporter personas as bylines: required or optional per article? (Recommended: optional; outlets can byline "Staff.")~~ **Resolved (D3-P2/P3):** optional — byline/dateline format is a per-outlet skin token; org/staff bylines are legal ("BY THE NATIONAL WIRE", "By Scoop Staff"). See `design/D3-news-outlets/`.
2. Paywall/subscription theater for realism — almost certainly beyond the fidelity ceiling; recommend never.
3. ~~How many outlet templates at launch?~~ **Resolved:** 4 — Newsline 7, The Courier-Ledger, The National Wire, The Scoop (NWS-002).
