# D3 — Design Brief: News Outlets (Newsline 7 · Courier-Ledger · National Wire · The Scoop)

> Epic: `../04-news-network.md` · Anchor: **real local news sites** — a TV station site, a newspaper site, a wire feed, a gossip site. Credibility is conveyed by design, and *reading* credibility is the skill being trained.

## Purpose & users

Simulated news media. Participants read and share; controllers publish. One rendering system, four outlet skins (NWS-002) whose visual quality *is* content: The Scoop should feel less trustworthy than The Courier-Ledger before a word is read.

## Key screens

1. **Article page** (the core unit — NWS-010/011): outlet masthead, headline/dek, byline + scenario-time dateline, hero media (image or inline Beat video with broadcast-style player, NWS-014), rich body with pull quotes and embedded social posts, share affordance (posts a link card to Pulse). Must be excellent on mobile — shared links open there. Reserve the NFR-008 watermark slot (NWS-032).
2. **Outlet homepage** (NWS-003): lead story, category sections, latest list. Scaled-down real news site.
3. **Breaking treatment** (NWS-012): banner/styling *within the outlet's brand* — the outlet screams BREAKING, the platform never does.
4. **Corrections** (NWS-013): editor's-note pattern (visible appended note vs. silent rewrite is a scenario lever — design both renderings).

## The four skins

| Outlet | Design register |
|---|---|
| **Newsline 7** | Local TV: bold condensed headlines, red/blue accents, video-forward, LIVE badges |
| **The Courier-Ledger** | Newspaper: serif headlines, restrained palette, text-forward, traditional grid |
| **The National Wire** | Wire service: austere, timestamp-forward, minimal art, terse heds |
| **The Scoop** | Tabloid: loud colors, ALL-CAPS heds, aggressive crops, cluttered-on-purpose (the one sanctioned "busy" design in the product — busyness as untrustworthiness signal) |

Build as theme tokens over one article/homepage system (E4 design notes) — a fifth outlet should be a token file, not a new build.

## States to design

- Normal article · breaking article · corrected article · video-lead article (Beat clip) · filler/human-interest (PRT-031 world texture runs through this same pipeline).

## Constraints & cues

- Scenario-time datelines (COR-053); permalinks match outlet brand (NWS-011).
- Article view/dwell telemetry is invisible to readers (NWS-030).
- No comments (NWS-031) — link to "the discussion" on the outlet's Pulse post instead.

## Anti-patterns

One-skin-fits-all outlets (kills the credibility-reading training); platform-added BREAKING chrome; desktop-only article layouts.
