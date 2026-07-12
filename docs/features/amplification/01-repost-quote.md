# Story: Repost & quote-post

**Feature:** Amplification (reposts & quotes)  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-020  ·  **Design decisions:** none  ·  **Issue:** #101

## Context
Repost (share to own audience, attributed "X reposted") and quote-post (repost with commentary) are
both supported — quote-posting is how misinformation mutates, a core E8 mechanic (SOC-020).

## Acceptance Criteria
- [ ] A participant/persona can **repost** a post (it appears in their audience's feed attributed "X
      reposted") and **quote-post** it (repost with added commentary that renders the original as an
      embedded card).
- [ ] Quote commentary goes through the sanitized compose path (NFR-004) and records provenance
      (posts SOC-003, XC-004).
- [ ] Repost/quote render in scenario time (COR-053), participant-world styled.
- [ ] Observer mode: repost/quote controls are **absent** (D1-011).

## Out of Scope
Counts/queryability (story 02); chain reconstruction (story 03); engine-driven amplification (E8
ADP-004).

## Technical Notes
Participant world. Repost is a lightweight amplification record; quote is a post embedding another.
Reuses `<PostCard>` + `<Composer>`. See implementation.md (story 01).

## Dependencies
posts (PostCard, Composer, provenance); telemetry (XC-004).

## Tests
- Component (RTL): repost attributes "X reposted"; quote embeds the original + adds commentary; observer
  hides the controls.
