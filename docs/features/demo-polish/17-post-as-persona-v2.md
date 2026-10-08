# Story: Post as persona v2

**Feature:** Demo polish  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** CTL-001, CTL-003, SOC-012, COR-018, XC-004, NFR-001, NFR-004  ·  **Design decisions:** D5-014/2.4 (POSTING AS chip, unchanged), D5-016 (dock flyout)  ·  **Issue:** #436
**Story ID:** C1  ·  **Stack:** frontend  ·  **Priority:** Must  ·  **Effort:** M  ·  **Wave:** 3
**Home stories:** [`persona-operation/01`](../persona-operation/01-post-as-persona.md), [`threads-replies/03`](../threads-replies/03-persona-participant-replies.md).

## Context
**As** a controller, **I want** to post as a persona with a photo or video (uploaded or picked from the exercise
library), reply as a persona, and see clearly when a post fails, **so that** I can drop breaking news as the TV
station and have a citizen persona answer the PIO live (demo beats 2 and 4). Today the composer is text-only,
has no replies, and `useComposeAsPersona.ts:244` swallows the POST error with `.catch(() => {})`, so the console
shows success even when the post failed.
**World: staff (COBRA)** — `@/theme/styledComponents`, dense, keyboard-first, desktop-first. The preview below shows participant *content* inside *staff chrome* and must not look like a participant card.

## Acceptance Criteria
- [ ] **Attach by upload.** The composer accepts ≤ 4 images **or** 1 video through `useMediaUpload` (video via
      `uploadVideoWithPoster`): per-file progress (`role="progressbar"`), cancel/remove, a **required alt text**
      per item (Fire stays disabled until each has one — NFR-001), client validation messages with the hint "MP4
      (H.264)". Mixed image+video is refused.
- [ ] **Attach from the library.** `MediaLibraryPicker` (exported for C3) lists `useMediaLibrary()` assets as a
      keyboard-operable grid (filter All/Images/Videos; each tile shows thumbnail/poster, file name,
      `uploadedAtScenario`); selecting up to the same limits adds them to the post; props per implementation.md
      §1.11. A picked video keeps its poster.
- [ ] **Reply as persona.** When `replyTo: ReplyTarget` is supplied, the composer shows "Replying to @handle —
      "excerpt"" with a clear (✕) control and posts with `parentPostId`; clearing returns to a normal post. The
      reply target is **state held by the route** (orchestrator-wired), not by this component.
- [ ] **Engagement baseline.** An optional collapsed "Starting engagement" section takes Like/Repost/Reply
      (integers 0–1,000,000, quick presets such as 1.2K/2.3K) and sends `engagementBaseline`; default none;
      invalid values block Fire with an inline message.
- [ ] **Preview before Fire.** A "PREVIEW" frame in **staff styling** (labelled, bordered, monospaced meta; not
      a `PostCard`) shows author, text, media thumbnail/poster and "Replying to" line; the R-003 origin line
      (`SIMCELL · MANUAL`) and the POSTING-AS chip are unchanged.
- [ ] **Visible errors, no false success.** The swallowed `.catch` is removed: `publishPost` rejections show an
      error banner with the server message and a **Retry**, keep the draft, and never show the success state;
      success shows "Posted" with the new post's time. In live mode exactly **one** XC-004 event is emitted per
      post (the server's) — the former accepted double-count is retired now that attribution is server-derived.
- [ ] **Staff world only.** No participant skin or `PostCard` import; keyboard: `⌘/Ctrl+Enter` fires, `Esc`
      closes the dock, all controls reachable by Tab; no color-only state.

## Out of Scope
Run-sheet authoring (C3), persona edit (PE), the Live world column and its Reply-as trigger (C2), takedown (C5),
scheduled posts, multi-persona fan-out, DMs, quote/repost-as-persona, wiring the reply target through the route
(orchestrator).

## Technical Notes
- Files: implementation.md §4.1 row C1 — `controller/components/PersonaComposer.*`,
  `hooks/useComposeAsPersona.ts`, `services/composeService.ts`, new `controller/media/**` (`MediaLibraryPicker`,
  upload tray). Props added to `PersonaComposer`: `replyTo?: ReplyTarget`, `onClearReply?: () => void` (the
  orchestrator passes them through `dockSlots` in `ControllerConsoleRoute.tsx`).
- Reuse `core/media`, `publishPost` v2 (rejects on failure), `useControllerIdentity` (acting human),
  `useActivePersona`. In live mode do **not** also call `createPost` locally for telemetry; the 201
  `StaffPostDto` is the source for the "last published" line. Keep the draft-survives-unmount store (WR-103)
  behaviour.
- Scenario time: `scenarioNow()` for the post; the dock may show dual time as today.

## Dependencies
F0 (upload client, `ReplyTarget`, `publishPost`, mocks). Runs with C2, C4, PE-FE; **C3 imports this story's
picker (merge C1 first).** **Live check** once BM+BP+B2 are deployed.

## Tests
- Composer: attach/alt gating/progress/cancel (mock uploader), library picker (filter, select, limits,
  keyboard), reply banner set/clear + `parentPostId` sent, baseline validation + payload, preview content,
  failure → banner + draft kept + Retry, success state, live-mode single telemetry vs mock-mode.
- No `PostCard`/participant-theme import in `controller/**` (grep-style test); `Esc`/`⌘Enter` handling; existing
  `PersonaComposer.test.tsx`, `ControllerConsole.personaDraftDiscard.test.tsx`, `composeService.test.ts` green.
