# Story: Article kind descriptor (payload, body policy, alert suggestion)

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** In Review
**Requirements:** NWS-010, NWS-012, NWS-013, NWS-022, NWS-032, NFR-004  ·  **Design decisions:** D3-P1, D3-P4  ·  **Issue:** #718
**Stack:** backend  ·  **World:** data (no UI)  ·  **Wave:** E4-1  ·  **Effort:** M

## Context
The foundation stores every article as a `ContentItem` of `ContentKind: article` (FC-1/FC-2) and lets a channel add only its kind-specific rules through `IContentKindDescriptor` (FC-7;
interface from foundation 02, funnel from foundation 04). This story is that registration for E4: what an article's `PayloadJson` may contain, how the body is sanitized, which media kinds it
accepts, and what is projected to participants. It adds **no column and no migration** (FC-2 is additive-only). The D3-P1 slot anatomy is the rendering contract; this is its data contract.

## Acceptance Criteria
- [x] **Registration.** Given the app boots, when `IContentKindDescriptor` implementations resolve, then one has `Kind = article`, `ChannelId = news`, and the foundation funnel accepts `POST /api/content-items` with `kind: "article"`; an unregistered kind still 400s (no regression). Covered by a `WebApplicationFactory<Program>` wiring test (FC-9.10).
- [x] **Payload schema.** Given `payload` on a write, then `ValidatePayload` accepts only `{ breaking?: { text: string(1..120) } | null, dateline?: { place: string(1..80), agency?: string(1..40) } | null, slugCode?: string(1..48), storyType?: "breaking_hard_news"|"follow_up"|"human_interest"|"press_conference_recap" }`; unknown keys, over-length strings and markup in any string are rejected with a field-level 400 (no silent strip). The kicker is **not** in the payload (it is the `ContentItem.Kicker` column).
- [x] **Body policy.** Given untrusted `bodyHtml`, then the `article-rich` sanitizer profile (extending `PostSanitizer` by profile, not forking it) allows paragraphs, `h2/h3`, lists, `blockquote.pull-quote`, `figure[data-media-id]` / `figcaption`, links and the `<pulse-post data-id>` placeholder; it strips scripts, event handlers, `javascript:` URLs, iframes and inline styles. A stored `<script>`/`onerror` payload never survives to a participant read (NFR-004).
- [x] **Media rules.** `AllowedMediaKinds = image, video`; a `document` media item is rejected for `article`. At most one `hero` role; a video hero without a poster frame (pipeline poster) is rejected with a clear 400.
- [x] **Participant projection.** `ProjectPayload` returns only `{ breaking: { text } | null, dateline, slugCode }`; `storyType` and any unknown stored key are never projected (XC-002).
- [x] **Alert suggestion, never automatic (NWS-012).** `DefaultAlertMapping` returns an `advisory` suggestion (headline = article headline verbatim, `href` = permalink) **only when** `payload.breaking` is set; the descriptor never raises an alert itself. Raising stays an explicit publish option (foundation 17), so a breaking *banner* does not imply an alert-bar entry.
- [x] **Engine drafts (NWS-022).** Given a write with `origin: engine`, then the article validates by the same rules and lands as `draft` (foundation 04 enforces the status); a malformed engine payload is rejected, not repaired.

## Out of Scope
Any UI; the article editor (17); breaking/correction rendering (07/08); templates (18); a Beat asset picker (E9, Phase 4); engine article generation (E8).

## Technical Notes
Data contract only, no participant UI. Files: `src/Pulse.WebApi/Features/News/ArticleKindDescriptor.cs`, `Features/News/ArticlePayload.cs`, DI extension `AddNewsChannel()` (the `Program.cs` line is orchestrator-owned). The `article-rich` profile is **registered through F04's `ISanitizerProfileRegistry`** at DI time (FU-8, resolved in the foundation: the registry and built-ins `plain`/`rich-basic`/`rich-tables` are F04's; this descriptor adds one named profile and never edits `PostSanitizer`). `ValidatePayload` below is the foundation's async `ValidatePayloadAsync` (shape-only for news); `DefaultAlertMapping` is a suggestion only (FC-7a: the funnel never raises an alert from it). See `implementation.md` § Per-story tech notes.

## Dependencies
Foundation 02 (interface, `ChannelVocabulary`) and 04 (funnel resolves descriptors). Can run with 03, 05–14, 18.

## Implementation notes (as built)
- Files: `src/Pulse.WebApi/Features/News/{ArticleKindDescriptor,ArticlePayload,ArticlePayloadReader,ArticleBodyProfile,NewsServiceCollectionExtensions}.cs`
  and `README.md` there, which is the seam contract for stories 03–19 (payload, projection, body markup). One `AddNewsChannel()` line is in `Program.cs`.
- **Alert suggestion:** `DefaultAlertMapping` is a property and cannot see the item. It returns the kind-level shape (`advisory`, headline null =
  the item's). The item-conditional rule ("only when breaking") is `SuggestAlert(ContentItem)`, a new default member on `IContentKindDescriptor`.
  The F17 dialog must call `SuggestAlert`. `href` = the permalink is filled by the funnel when the controller raises it.
- **Foundation additions (additive, defaults unchanged).** The descriptor could not see the write's media, so `PayloadValidationContext`
  gained `Media` and `HeroMediaId`. `SanitizerProfile` gained `AttributeValuePatterns`, which holds `blockquote` to `class="pull-quote"`
  and the `data-*` ids to GUIDs.
- **Registration test:** `NewsCompositionRootWiringTests` boots the real `Program` host. It checks that the descriptor resolves and that the
  real funnel dispatches `kind: "article"` while still refusing an unknown kind. The full HTTP `POST /api/content-items` round trip rides
  F07's endpoint tests. `ArticleFunnelTests` covers every other AC through the real funnel.
- Explicit `null` for `slugCode` and `storyType` is accepted as "unset", which matches the projection shape.
