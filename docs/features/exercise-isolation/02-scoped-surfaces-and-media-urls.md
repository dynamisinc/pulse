# Story: Scoped surfaces & non-guessable media URLs

**Feature:** Exercise isolation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-002  ·  **Design decisions:** none  ·  **Issue:** #45

## Context
Isolation must hold across every derived surface, not just row queries. Feeds, search, trending,
notifications, suggested follows, DMs, profiles, and **media URLs** are all exercise-scoped; media
URLs are non-guessable and access-checked so a leaked URL from exercise A returns 403/404 in exercise
B (COR-002).

## Acceptance Criteria
- [ ] Feeds, search, trending, notifications, suggested follows, DMs, and profiles return only the
      session's exercise's data (built on COR-001).
- [ ] Media URLs (images/video/audio) are non-guessable (unpredictable identifiers) and access-checked
      against the session's exercise.
- [ ] Given a valid media URL from exercise A, when it is requested in an exercise-B session (or
      unauthenticated), then it returns 403/404 — never the asset.
- [ ] These paths are included in the standing isolation suite (story 07), including stored-XSS
      payloads (NFR-004).

## Out of Scope
The individual channel surfaces themselves (E2–E6 build them; this story is the scoping guarantee they
inherit); malware scanning/sanitization internals (NFR-004 content-security is its own concern).

## Technical Notes
Foundation. Media served via access-checked, signed/opaque URLs (not by sequential id). See
implementation.md (story 02).

## Dependencies
Story 01 (central scoping); a media storage/serving path. Every channel's surfaces rely on this.

## Tests
- Integration: a cross-exercise media URL returns 403/404; search/trending/notifications are scoped.
- Part of the standing isolation suite (story 07).
