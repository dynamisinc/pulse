# Story: Content pack authoring (human + Claude)

**Feature:** Demo polish  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** COR-023, COR-024, XC-009, NFR-004 (rights/safety of media)  ·  **Design decisions:** plan decisions 2 and 6 (stock media; fictional county; names by 10/14)  ·  **Issue:** #444
**Story ID:** S2  ·  **Stack:** content (🧑 Tom + Claude; no builder agent)  ·  **Priority:** Must  ·  **Effort:** M  ·  **Wave:** seed (starts Fri 10/16; names fixed by Wed 10/14)
**Home story:** — (content for [`persona-management/04`](../persona-management/04-pre-exercise-post-history.md)'s "background noise" idea, but authored as a pack).

## Context
**As** the presenter, **I want** the opening feed, the run sheet and the media authored as a reviewable pack,
**so that** S1 can load it and the demo tells its story: breaking news with video, the impersonator's rumor, the
PIO's official photo post, citizen replies (plan §3). This story is **content, not code**. Claude drafts text
and structure against the `pulse.demopack.v1` schema (implementation.md §1.10); Tom picks/approves the stock
media and the fictional names. Constraint from plan §9: display names, bios and avatars can change freely,
**handles and the `#WaterIssues` hashtag cannot** (the engine matches on them), so handles stay neutral (e.g.
`KestrelCoEM`, `FairhavenWater`, `FairhavenWaterUpd`).

## Acceptance Criteria
- [ ] **Pack shape.** `docs/demo/pack/pack.json` validates against `docs/demo/pack/schema/` and S1's `-WhatIf`
      passes with zero warnings.
- [ ] **Volume and coverage.** ≈ 35 opening posts backdated over ~6 scenario hours; a ~15-item run sheet
      (`runSheet.items`: inject items, `kind: "post"` or `"burst"`, the shape below) covering plan beats 2–5
      (breaking-news video, impersonator photo post, citizen pile-on replies, the PIO statement context, a
      moderation target); 2–3 videos, ~10 photos, 9 avatars, 3–4 banners; threads with
      replies; engagement baselines that make the rumor outpace the official post; the verified agency beside
      its unverified lookalike.
- [ ] **Media rules.** Videos are H.264 MP4, 720p, ≤ 30 s and ≤ 20 MB; photos ≤ 5 MB (JPEG/PNG/WebP); every file
      passes the server's limits and magic-byte check (verified by S1's validator); royalty-free stock only
      (Pexels/Pixabay) with source and licence recorded in `docs/demo/pack/CREDITS.md`; **no real logos, real
      people's likeness or real news brands**.
- [ ] **Accessibility and fiction safety.** Every image and video has a meaningful `alt` (a description, not a
      filename); no out-of-fiction words ("simulation", "exercise", "training") in post text, bios or alt text;
      no real phone numbers, addresses or personal data.
- [ ] **Names fixed.** Fictional county, org and persona display names are approved by Tom by Wed 10/14 and
      recorded in the pack header; handles unchanged (or, if Tom decides to change them, the small backend
      seeder story is raised before the 10/15 freeze).
- [ ] **Reviewed twice.** Tom reviews the pack after the 10/16 walk and again before Rehearsal 2; changes are
      made in the pack, not by editing UAT.

## Out of Scope
Writing the seed script (S1), engine storyline content, real-world stock procurement beyond the free licences,
localisation, authoring more than the demo storyline needs.

## Technical Notes
- Files: `docs/demo/pack/pack.json`, `docs/demo/pack/media/**`, `docs/demo/pack/CREDITS.md` (everything under
  `docs/demo/pack/` except `schema/`, which S1 owns). Media files are committed as binary (`.gitattributes` gets
  `*.mp4`/`*.webm` from F0). Keep the repo light: the pack is the demo's source of truth, so large originals
  stay out of git (store ≤ 20 MB renditions).
- Use P3's test clips as the starting point for the video slots.
- **Run-sheet shape** *(amended 2026-10-13; C3's `runSheet.beats` is gone)*. `runSheet` is `{ "items": [ … ] }`.
  Each item maps 1:1 onto inject-queue 06's `InjectItemWrite`, with pack references where the wire has ids; S1
  creates it with `POST /api/injects`, pending, in pack order. An item is `{ key, kind, title, notes?,
  plannedMinute?, assignee?, burstWindowSeconds?, posts }`: `key` is a stable pack key; `kind` is `"post"`
  (exactly 1 post) or `"burst"` (2–20 posts released across `burstWindowSeconds`, 30–600, default 90, and at
  least 3 × (posts − 1)); `title` 1–120 and `notes` ≤ 500 are controller-facing; `plannedMinute` is the T+N
  hint; `assignee` is `"me"` or a staff display name. Each post is `{ persona, text, media?, replyTo?,
  engagementBaseline? }`: `persona` is a handle, `text` 1–280 (no markup), `media` uses pack media keys
  (`{ ref, alt? }`, ≤ 4 images or 1 video), and `replyTo` is one of `{ "postKey": "p07" }` (an opening-feed
  post), `{ "sequence": 1 }` (an earlier post of the same item) or `{ "item": "rs03", "sequence": 1 }` (a post of
  an earlier item). The pile-on replies fit a `burst`. The schema in `docs/demo/pack/schema/` and S1's
  `-WhatIf` check all of it; `scripts/uat/test-fixtures/demo-pack/pack.json` has one item of each kind. S1 is
  deliberately stricter than the server in two places: `burstWindowSeconds` on a `post` item is refused (the
  server ignores it), and so is an explicit `null` for an optional field (the server reads it as absent);
  only `"assignee": null` is accepted, meaning unassigned.

## Dependencies
P3 (clips), the names decision (10/14), S1's schema (for validation). Blocks the final seed run Mon 10/19.

## Tests
- S1 `-WhatIf` validation is the machine check. Manual: a read-through for fiction-safety and rights, an
  alt-text spot check, and a playback check of each video in Chrome and Safari.
