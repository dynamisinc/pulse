# Story: Article templates by story type

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-021, NWS-010  ·  **Design decisions:** none  ·  **Issue:** —
**Stack:** frontend  ·  **World:** staff  ·  **Wave:** E4-2  ·  **Effort:** S

## Context
NWS-021: templates by story type to speed authoring during conduct: breaking hard news, follow-up, human interest, press-conference recap. A template is **seed data for a draft** (field defaults,
a structured body skeleton, a suggested `storyType`), not a layout: all participant rendering is the one system (D3-P1).

## Acceptance Criteria
- [ ] **Four templates.** Given the template set, then it contains `breaking_hard_news`, `follow_up`, `human_interest`, `press_conference_recap`, each a pure-data record `{ id, label, description, storyType, payloadDefaults, bodySkeletonHtml, suggestedCategory?, suggestedBreaking? }`; `bodySkeletonHtml` passes the story-01 allowlist (test via the same sanitizer fixtures).
- [ ] **Apply.** Given `applyTemplate(template, draftFields)`, then it fills only **empty** fields (never overwrites authored text), sets `payload.storyType`, and returns a new draft object; applying twice is idempotent; breaking_hard_news pre-fills "breaking" **only as a suggestion the controller must confirm**, never auto-set (NWS-012 authorial).
- [ ] **Picker.** Given the editor (17), then a `TemplatePicker` (COBRA, keyboard-first) lists the four with one-line descriptions and is optional: "Blank article" is the default and first option; choosing one before first save never publishes anything.
- [ ] **Skeleton guidance is placeholder-safe.** Skeleton copy uses obvious bracketed placeholders ("[Official name]") so an unedited template cannot publish plausible-looking fiction by accident; the publish action warns if bracketed placeholders remain (a soft warning, not a block).
- [ ] **Neutral voice.** Templates carry no outlet-specific skin or credibility language, and no real-world names or places; the Scoop register comes from skin tokens, never from template text.

## Out of Scope
Custom/user-defined templates; per-outlet template libraries; E8-generated templates; localization.

## Technical Notes
Staff world; pure data + a small picker. Files: `src/frontend/src/features/controller/content/article/templates/{templates.ts,applyTemplate.ts,TemplatePicker.tsx}` + tests. Imported by 17.

## Dependencies
E4 01 (storyType enum, allowlist). Can run with 04, 15, 19. Blocks 17.
