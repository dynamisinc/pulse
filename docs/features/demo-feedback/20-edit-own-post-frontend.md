# Story: Edit own post: participant UI and staff view

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** D1 parity (X edit), COR-053, NFR-001  ·  **Decisions:** DF-29..DF-33  ·  **Issue:** #538
**Stack:** frontend  ·  **World:** participant (+ one staff chip)  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 4  ·  **Effort:** M
**Owner:** planning session · **Branch:** `build/demo-feedback/20-edit-post-ui` → `feature/demo-feedback-w4`

## Context

The participant half of 19: an Edit action on your own posts and replies for 15 minutes, "Edited" on the card, an
X-style edit history, and the new text arriving live in every other browser. Staff see "Edited" and the history in
Live world. Builds against mocks behind the existing `USE_MOCK_*` switches from the WAVE-4 contract, then one live
check once 19 is deployed.

## Acceptance Criteria

### Participant (brand skin, never COBRA)

- [x] `PostActions` shows an **Edit** button (FontAwesome `faPen`, tooltip and accessible name "Edit post", same
      tooltip pattern as story 13) only when `post.viewer.editableForSeconds > 0`. The client counts the seconds down
      from when the post was read and hides Edit at 0 without a reload; no wall-clock time is ever rendered (COR-053).
- [x] Edit opens an in-skin dialog (new `social/edit/EditPostDialog.tsx`) prefilled with the text, the composer's
      length counter and emoji button (`core/emoji`), Save / Cancel, focus trapped and returned to the Edit button,
      Esc cancels. Media is shown read-only ("Media can't be changed").
- [x] Save calls `PATCH /api/posts/{id}`; on success the card shows the new text immediately (own-post optimistic
      update, rolled back on failure). 409 reasons map to plain messages: "The 15-minute edit window has closed",
      "You've reached the edit limit", "Posting is paused right now" (`frozen`: Freeze, or a paused/ended exercise). Other failures keep the dialog open with the error.
- [x] Every card (feed, thread, profile, Pinned) shows **"Edited"** after the time when `post.edited` is set
      (`PostHeader`); it is a button that opens **"Edit history"** (new `social/edit/EditHistoryDialog.tsx`), listing
      each version newest first with its scenario time ("Current" / "Original" labels). Text, not color, marks it.
- [x] Live: `realtimeFeed.ts` subscribes to `PostEdited` on the existing connection with a strict validator
      (`postId` string, `text` string, `edited.count` positive integer, `edited.scenarioTime` ISO string, `version`
      = count); a new leaf store `social/edit/editedPostsStore.ts` (`useSyncExternalStore`, version-gated, reset on
      sign-out in `core/auth/endSession.ts`) overrides text and `edited` for that post; `PostBody` and `PostHeader`
      read through it, so a mounted card anywhere updates without a reload. A stale or replayed frame is dropped.
- [x] Hashtags and mentions in the edited text render like any post body (existing `PostBody` parsing).
- [x] Mocks: the mock post service implements PATCH, history and emits `PostEdited`, so the mock demo shows it.

### Staff (COBRA)

- [x] `LiveWorldRow` shows an "Edited" chip (COBRA) when `edited` is set, opening the same history list rendered in
      COBRA styling (a staff-skinned wrapper; never the participant dialog's brand skin). Live world picks up
      `PostEdited` on its existing feed source.

### Cross-cutting

- [x] Two worlds: participant pieces live under `social/**` in the brand skin; the staff chip under
      `controller/liveWorld/**` in COBRA. FontAwesome only; MUI 9 `sx`-only.
- [x] Accessibility: dialogs labelled, keyboard operable, "Edited" announced as part of the post's accessible text.
- [x] `post.provenance.test.ts` updated for the `editableForSeconds` viewer key.

## Out of Scope

Editing media; staff editing (DF-32); an edit notification to others; console run-sheet changes.

## Technical Notes

Owned files per [`WAVE-4.md`](WAVE-4.md#wave-plan): `social/components/post/{PostActions,PostHeader,PostBody}.tsx`,
`social/types/post.ts`, `social/services/{realtimeFeed,postService}.ts`, new `social/edit/**`,
`controller/liveWorld/LiveWorldRow.tsx`. **Do not touch `PostCard.tsx`** (story 21 owns it). Follow
`postCountsStore.ts` (story 14) for the version-gated store and reset generation.

## Dependencies

17's contract (mocks); 19 deployed for the live check. Visual pass (25) runs after this merges.

## Tests

`social/edit/*.test.tsx`: Edit visible only with seconds left and hides at 0 (fake timers); dialog prefill, save,
optimistic update and rollback; 409 messages; Edited label and history dialog order; `PostEdited` validator (good and
malformed); store version gate and sign-out reset; a mounted feed card and thread card both update on a frame;
Live world chip renders and opens history; axe check on both dialogs.

## Build Notes (story 20 builder)

Live check against story 19's deployed API: **pending 19 deploy** (everything above was built and tested against
the frozen contract through the mock switches).

- Edit tooltip is a native `title` plus the accessible name; story 13's tooltip component is not on this branch, swap it in at merge.
- The `PostCard` is untouched (story 21 owns it), so `PostHeader` / `PostBody` find their post through the enclosing
  `<article data-post-id>` (`edit/useEnclosingPostId.ts`) and `PostActions` seeds `editedPostsStore` with the card's
  `post.edited`. Once 21 merges, `PostCard` can pass `postId` explicitly (both parts accept it) and the seed can go.
- Outside the owned list, minimal and necessary: `components/post/types.ts` (`PostView.edited`),
  `services/feedService.ts` (`toPostView` carries `edited`), `services/ownPostStore.ts` (an own just-published post keeps
  `editableForSeconds` / `edited`), `core/auth/endSession.ts` (store reset, as the AC says), and the
  `liveWorldTwoWorlds.test.ts` allowlist (two new leaf social modules).
- No axe dependency exists in the repo, so the dialogs' accessibility is pinned with explicit role/label/focus assertions.
