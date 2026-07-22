# Story: Hashtags (parse / linkify / feed)

**Feature:** Hashtags & trending  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** SOC-040  ·  **Design decisions:** none  ·  **Issue:** #106

## Context
Hashtags are parsed from post text, linkified, and searchable; tapping a hashtag shows its feed
(chronological + "top" tab) (SOC-040).

## Acceptance Criteria
- [x] Hashtags in post text are parsed and rendered as links (participant-world styled).
- [x] Tapping a hashtag opens its feed with **chronological** and **top** tabs, exercise-scoped
      (COR-001).
- [x] Hashtags are searchable (feeds-discovery search SOC-082). *(this story ships the single reusable
      parse/index primitive — `extractHashtags()`, distinct/normalized/first-seen-order — that a
      search index consumes; the search UI itself is `feeds-discovery/03`, Not Started, and stays out
      of scope here — see Out of Scope.)*
- [x] Timestamps in the hashtag feed render in scenario time (COR-053).

## Out of Scope
Trending computation (story 02); search UI (feeds-discovery SOC-082).

## Deferred (tracked follow-ups, Gate-2)
- **SUG-002.** `HashtagFeed` cannot pivot tag-to-tag — its own `<PostCard>` rows don't have
  `onHashtagOpen` threaded to them, so tapping a second hashtag while already inside a hashtag feed is
  a no-op rather than re-pointing the feed at the new tag. Tracked as a follow-up polish pass on
  `HashtagFeed.tsx`.
- **SUG-001.** `SocialChannel`'s local view-state focus management (see its module header) only moves
  focus on a feed↔detail transition; a **detail-to-detail** swap — concretely, tapping a hashtag from
  inside an open `ThreadView` (`onHashtagOpen` → the hashtag view) or opening a post's thread from
  inside the hashtag feed (`onOpenThread`) — does not reposition focus into the newly-shown region
  (NFR-001). Tracked as a `SocialChannel.tsx` follow-up; also noted in `threads-replies/01`'s Deferred
  note for the ThreadView side of the same transition.

## Technical Notes
Participant world. Hashtag parse in the post render; hashtag-feed route reuses feed rendering. See
implementation.md (story 01).

## Dependencies
posts (text/PostCard); feeds-discovery (feed rendering).

## Tests
- Unit — `utils/hashtags.test.ts`: `parseHashtags`/`extractHashtags`/`textHasHashtag` — the token
  stream round-trips the original text exactly, case-insensitive de-duped first-seen-order extraction,
  and the "what counts as a hashtag" exclusions (`C#`, `##x`, HTML entities, pure-number,
  underscore-only) — covers AC1's parse rule and the reusable index AC3 depends on.
- Component (RTL) — `components/PostCard.hashtags.test.tsx`: a hashtag in post text renders as a
  keyboard-focusable link carrying the normalized tag when `onHashtagOpen` is wired (click/Enter fire
  the handler; stops propagation so a hashtag tap never also opens the card's thread — WR-001), and as
  an INERT non-focusable `<span>` when it is not wired (WR-002); non-hashtag look-alikes and
  script-like text stay inert (NFR-004) — covers AC1.
- Component (RTL) — `pages/HashtagFeed.test.tsx`: the feed shows only posts carrying the tag
  (case-insensitive) over the already exercise-scoped `useFeed()` read (COR-001); "Latest" is
  newest-first, "Top" is engagement-ranked with a newest-first tiebreak; every post's timestamp renders
  in scenario time from the injected exercise clock (COR-053); exactly one `'view'` XC-004 event fires
  per hashtag on mount/re-point, not on a Latest/Top tab switch; an honest empty state; read-only
  variant renders no interactive controls (D1-011); the tab affordance is an accessible, aria-live
  labelled region (NFR-001) — covers AC2/AC4.
- Component (RTL) — `SocialChannel.navigation.test.tsx` ("hashtag feed navigation"): tapping a
  linkified hashtag in a live feed post opens THAT hashtag's feed in-channel and "Back to feed"
  returns — end-to-end proof of AC2's "tapping a hashtag opens its feed", not just the page in
  isolation.
