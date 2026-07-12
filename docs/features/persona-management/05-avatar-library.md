# Story: Bundled avatar library + upload

**Feature:** Persona management & cast libraries  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-024  ·  **Design decisions:** none  ·  **Issue:** #57

## Context
An avatar library: bundled, rights-cleared avatar/profile image sets organized by persona type, plus
upload (COR-024). Beat integration for generated avatars lands in E9 (Phase 4) — this story is the
bundled library + upload path.

## Acceptance Criteria
- [ ] A bundled, rights-cleared avatar/profile-image library is available, organized by persona type,
      selectable when creating a template (story 01) or mid-exercise persona (story 03).
- [ ] Custom avatar **upload** is supported; uploads are validated (MIME/size) and sanitized per
      NFR-004.
- [ ] Avatars are exercise-scoped where used and served via access-checked URLs (exercise-isolation
      story 02).

## Out of Scope
Beat-generated avatars (E9, Phase 4); the persona fields themselves (story 01).

## Technical Notes
Staff world + media storage. Upload path shares the content-security controls (NFR-004) and
access-checked media URLs (COR-002). See implementation.md (story 05).

## Dependencies
Stories 01/03 (avatar pick); exercise-isolation story 02 (media URLs); content-security (NFR-004).

## Tests
- Integration: avatar pick from library and validated upload; uploaded avatar served via access-checked
  URL.
