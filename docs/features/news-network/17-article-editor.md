# Story: Article editor (registered kind editor)

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-020, NWS-012, NWS-013, NWS-022, NWS-004 (paired-post option surfaced), NFR-004, COR-041  ·  **Design decisions:** D5 console patterns; D3-P4 (correction choice)  ·  **Issue:** —
**Stack:** frontend  ·  **World:** staff (COBRA); preview shows the participant world  ·  **Wave:** E4-3  ·  **Effort:** L

## Context
NWS-020 is **editor-only** work: the foundation's `ContentAuthoringShell` (foundation 17) already provides list, status, schedule/publish/retract/revise, preview-as-participant, "attach to inject",
paired-post and alert options. E4 supplies the article form via `registerContentKindEditor('article', ArticleEditor)` (FC-8). D3 designed participant rendering only; authoring follows the console's
patterns (D5): dense, keyboard-first, COBRA.

## Acceptance Criteria
- [ ] **Registered.** Given the shell, then "New → Article" and editing an article render `ArticleEditor` in the shell's editor slot (replacing the "No editor for this kind" row); the editor fields map **1:1 to the D3-P1 slots**: outlet, kicker, headline, dek, byline (name or persona or none), category (from the outlet's categories), dateline/slug code (when the outlet's skin asks), hero media, body, breaking text.
- [ ] **Rich text, sanitized (NFR-004).** The body editor (a maintained rich-text library, not hand-rolled `contentEditable`) produces only the story-01 allowlist (paragraph, headings, lists, pull quote, figure, link, Pulse post embed); pasted HTML is normalized to it; the server's sanitizer is authoritative and its 400s display inline; a pasted `<script>` is neutralized and never executes in the editor or in preview.
- [ ] **Media insertion.** The controller can upload an image/video via the existing media library uploader (MIME/size/malware path, foundation FC-9.6) and insert it as hero or inline `figure`, with required alt text (save blocked without it for images) and caption; the **Beat asset picker is a disabled, labelled "Coming with E9" entry**, not a stub that fails.
- [ ] **Embed a Pulse post.** The controller can search/paste a post (in-exercise only) and insert a `<pulse-post data-id>` placeholder; the editor shows the D1-anatomy preview; a post from another exercise cannot be selected (XC-001).
- [ ] **Breaking and revision choices.** The editor exposes "Breaking banner text" (empty = none) and, on a published article, the Revise dialog options labelled by what participants see: *"Visible correction (editor's note)"*, *"Quiet rewrite (only 'Updated' changes)"*, *"Update"*; the rationale (credibility lever) is shown in help text (D3-P4, NWS-013).
- [ ] **Preview as participant (NWS-020, COR-041).** "Preview" renders the participant article page (04) in the participant world under the outlet's skin inside the staff frame via foundation `/preview`; the staff chrome never restyles it, switching outlet in the form re-skins only the preview subtree, and a mobile-width preview toggle exists.
- [ ] **Programmatic drafts (NWS-022).** Given an `origin: engine` draft, then the editor opens it with an "Engine draft" flag, all fields editable, and publish only by a controller action; editing never changes `origin` (staff/participant telemetry stays accurate).
- [ ] **Staff world only + a11y.** Uses `@/theme/styledComponents` and FontAwesome; keyboard-operable with shortcut hints; no participant skin leaks into the form chrome; severity/status never color-only; axe clean (NFR-001); read-only roles see fields disabled.

## Out of Scope
Story templates (18); bulk import; the paired-post/alert/inject/schedule controls themselves (foundation 17 owns them; this editor only supplies fields); Beat picker (E9); E8 drafting; multi-author collaboration.

## Technical Notes
Staff world. Files: `src/frontend/src/features/controller/content/article/{ArticleEditor,BodyEditor,MediaInserter,PostEmbedPicker,BreakingField}.tsx` — a subfolder the foundation story 17 does not own (E4 owns only this subfolder; the foundation shell imports nothing from it except through the registry). Picks the rich-text library already in the dependency set if one exists; otherwise the choice is an open question (see `feature.md`). Runs on foundation mocks until 07 lands.

## Dependencies
E4 01 (payload/validation), 18 (templates picker import); foundation 17 (shell + `registerContentKindEditor`), 07 (staff API), 14. Can run with 16, 19.
