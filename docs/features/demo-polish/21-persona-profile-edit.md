# Story: Persona profile edit (staff)

**Feature:** Demo polish  ·  **Epic:** E1 / E7  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** COR-020, COR-022 (edit, not create), COR-024, NFR-004, XC-001, XC-002  ·  **Design decisions:** DP-4, DP-9 (implementation.md §0), D1-008  ·  **Issue:** #440
**Story ID:** PE  ·  **Stack:** fullstack (BE half **PE-BE** in Wave 2; FE half **PE-FE** in Wave 3)  ·  **Priority:** Should  ·  **Effort:** M  ·  **Review:** Tier 1
**Home stories:** [`persona-management/03`](../persona-management/03-mid-exercise-persona-creation.md) (slice — edit only), [`persona-management/05`](../persona-management/05-avatar-library.md).

## Context
**As** a controller, **I want** to rename a persona and set its bio, location, verified mark, avatar and banner
from the console, **so that** the fictional county's names and stock avatars go in through the UI (plan decision
6) and the seed script (S1) can do the same through an API. Today the 9 personas are hard-coded in
`PersonaCastSeeder.cs` and binding goes through `/api/ops/*` scripts only. **Handles are not editable** (plan
§9): the engine matches on them. The backend half must merge before the Thu 10/15 backend freeze, so it runs in
Wave 2 on idle backend capacity (DP-13).
**World: staff (COBRA)** for the UI; the edited fields reach participants through the normal persona read.

## Acceptance Criteria
**PE-BE (backend)**
- [ ] **Merge-patch endpoint.** `PATCH /api/staff/personas/{personaId:guid}` (controller role, assigned to the
      resolved exercise) applies RFC 7396 semantics: absent = unchanged; `null` clears only `bio`, `location`,
      `avatarMediaId`, `bannerMediaId`; `displayName` (1..100) and `verified` cannot be null; text fields are
      sanitized with `PostSanitizer` (NFR-004) and bounded (`bio` ≤ 512, `location` ≤ 100); returns 200 with the
      updated `StaffPersonaResponseDto` (incl. `avatarUrl`/`bannerUrl`).
- [ ] **Immutable fields are loud.** A body naming `handle`, `kind`, `personaType`, `exerciseId` or any unknown
      field is **400** (never silently ignored); the unique per-exercise handle index is untouched.
- [ ] **Media must be in-scope images.** `avatarMediaId`/`bannerMediaId` must resolve to **image** `MediaAsset`s
      in the same exercise; otherwise 400 with identical text for unknown and cross-exercise ids.
- [ ] **Isolation and authz (always-Critical).** A persona of another exercise returns 404 and changes nothing;
      anonymous/participant/shared → 401, non-controller or unassigned staff → 403; the edit is visible on the
      next `GET /api/personas` for participants and staff, and the participant projection still carries no
      `personaType`/`castable`.

**PE-FE (frontend)**
- [ ] **Dialog.** `PersonaEditButton` (self-contained, takes `persona: StaffPersona`) opens a COBRA dialog with
      display name, bio (counter), location, a **Verified** checkbox with helper text "Changes the trust mark
      participants see" (never color-only), and avatar/banner chooser — upload via `useMediaUpload` or pick from
      the library — with an image preview; handle is shown read-only; Save is disabled while invalid or
      uploading, errors are visible (server message), focus is trapped and returns to the button.
- [ ] **Refresh and telemetry.** On success the dialog closes, `invalidatePersonas()` is called, the active
      persona snapshot is refreshed (`selectPersona(updated)`), and exactly one `steering_action` event
      (`payload { action: 'persona_edit', fields }`, `target {persona, id}`, acting human) is emitted by the
      console; mock mode edits the mock directory.

## Out of Scope
Persona create/delete, handle edits, kind/archetype/audience-band edits, voice notes, bulk edit, history/undo,
an avatar library (COR-024's bundled set), mounting the button (orchestrator, through C4's `actionsSlot`),
server-side telemetry (DP-9).

## Technical Notes
- Files: implementation.md §4.1 rows PE-BE (`Features/Social/PersonaAdmin/**`) and PE-FE
  (`controller/personaEdit/**`). PE-BE reuses `EngineCockpitStaffAuthorizationFilter` +
  `EngineCockpitControllerRoleFilter`, `PostSanitizer`, `PersonaReadService.GetStaffPersonaAsync` (added by BP),
  `IExerciseClock` not needed. Ships `AddPersonaAdmin()`/`MapPersonaAdminEndpoints()` for the orchestrator's
  `Program.cs` wiring. Bind the body as `JsonElement` and inspect property presence for merge-patch.
- PE-FE: staff COBRA only (`CobraTextField`, `CobraPrimaryButton`, …); FontAwesome; MUI 9 `sx`-only. It must not
  import participant `Avatar` styling beyond the shared `Avatar` primitive.

## Dependencies
PE-BE: B1, BM (media assets), BP (persona DTOs + `GetStaffPersonaAsync`) merged. PE-FE: F0 (`core/media`,
`invalidatePersonas`), PE-BE for the live check. S1 depends on PE-BE being live in UAT.

## Tests
- **PE-BE (isolation first):** cross-exercise persona and media → 404/400 and no change (real SQL); merge-patch
  matrix (absent/null/value per field), immutable-field 400s, sanitization (`<script>` in bio stripped), bounds,
  authz matrix, participant/staff read after edit, handle uniqueness untouched, wiring test (401 not 404).
- **PE-FE:** validation, upload/library choose, success path (invalidate + select + one telemetry), failure
  banner, focus trap/return, Verified helper text, no participant-style import.
