# Story: Repost & quote-post

**Feature:** Amplification (reposts & quotes)  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** SOC-020  ·  **Design decisions:** none  ·  **Issue:** #101

## Context
Repost (share to own audience, attributed "X reposted") and quote-post (repost with commentary) are
both supported — quote-posting is how misinformation mutates, a core E8 mechanic (SOC-020).

## Acceptance Criteria
- [ ] A participant/persona can **repost** a post (it appears in their audience's feed attributed "X
      reposted") and **quote-post** it (repost with added commentary that renders the original as an
      embedded card). *(partial — see Deferred below: the repost/quote compose flow, telemetry, and
      the "X reposted"/embedded-card presentation are built and tested; a repost/quote does not yet
      actually appear as a new entry in anyone's rendered feed — that propagation, plus the count
      bump, lands in `amplification/02`.)*
- [x] Quote commentary goes through the sanitized compose path (NFR-004) and records provenance
      (posts SOC-003, XC-004).
- [x] Repost/quote render in scenario time (COR-053), participant-world styled.
- [x] Observer mode: repost/quote controls are **absent** (D1-011).

## Deferred (tracked follow-up — Gate-2 finding WR-004)
`repost()`/`quotePost()` (`services/amplify.ts`) and `<QuotePostCard>` are built and independently
tested — a repost attributes "X reposted" and a quote embeds the original + commentary when rendered
directly (`QuotePostCard.test.tsx`), and the live action-row Repost/Quote buttons each emit exactly one
XC-004 `repost`/`quote` event (`Feed.actions.test.tsx`). What is **not** yet wired: clicking
Repost/Quote does not insert a new `<QuotePostCard>` row into the feed (the amplifier's own audience,
or anyone else's), and the original post's repost/quote counts do not increment —
`Feed.actions.test.tsx` explicitly asserts "no count mutation — amplification counts are story 02" for
the repost path. So AC1's parenthetical ("it appears in the audience's feed attributed 'X reposted'")
is demonstrated only at the component-presentation level, not end-to-end from the action row. Do not
mark this story Complete until that gap closes (tracked to land with
`amplification/02-amplification-counts`, which owns the queryable counts + is the natural home for the
feed-insertion wiring).

## Out of Scope
Counts/queryability (story 02); chain reconstruction (story 03); engine-driven amplification (E8
ADP-004).

## Technical Notes
Participant world. Repost is a lightweight amplification record; quote is a post embedding another.
Reuses `<PostCard>` + `<Composer>`. See implementation.md (story 01).

## Dependencies
posts (PostCard, Composer, provenance); telemetry (XC-004).

## Tests
- Unit — `services/amplify.test.ts`: `repost()` emits exactly one XC-004 `'repost'` event (persona
  actor, provenance/origin incl. `inject`/`controller-as-persona`, target at the original post) and
  returns a participant-safe record with no leaked provenance field (XC-002); `quotePost()` sanitizes
  the commentary on ingest (NFR-004 — strips `<script>`), emits one `'quote'` event, and threads a
  `causationId` when supplied (SOC-022 seam); both stamp the caller's `exerciseId` on the record AND
  the telemetry envelope, never a different one (COR-001) — covers AC2.
- Component (RTL) — `components/QuotePostCard.test.tsx`: a repost attributes "X reposted" above the
  original (rendered verbatim via `<PostCard>`) with no commentary block; a quote embeds the original
  (`quoted-embed`, no action row) and renders the added commentary, including an empty-string
  commentary still rendering as "quote" (not repost); the embedded original's timestamp renders in
  scenario time from the injected exercise clock (COR-053); observer mode (`readOnly`) hides the
  reposted post's interactive controls (D1-011); script-like commentary renders as inert text, never
  parsed HTML (NFR-004) — covers AC1's presentation claim (given a repost/quote rendered directly),
  AC3, AC4.
- Component (RTL) — `pages/Feed.actions.test.tsx` ("Feed — repost/quote wiring"): the live action row
  proves the Repost button emits exactly one `repost` telemetry event targeting the top post with NO
  count mutation; the Quote trigger opens an inline commentary composer, disables Quote on
  empty/whitespace input, and submitting emits exactly one `quote` event carrying the typed commentary;
  a read-only session renders no repost/quote controls at all — covers AC2/AC4 end-to-end and AC1's
  telemetry clause, but — see Deferred — not AC1's feed-appearance clause.
