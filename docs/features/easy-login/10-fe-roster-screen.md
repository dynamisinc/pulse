# Story: Roster screen (staff)

**Feature:** Easy participant login  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** COR-011, COR-017 (part: roster, force-logout, credential reset, wrong-account diagnosis), COR-018, NFR-001  ·  **Design decisions:** none (EL-2, EL-3, EL-8, EL-13, EL-14)  ·  **Issue:** #475
**Stack:** frontend  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 1  ·  **Effort:** L

## Context

The first 30 minutes of StartEx is login triage, and it should not need a support ticket (COR-017). This is the
staff screen where a controller or planner adds people to the exercise, sees at a glance who is in, and fixes
whoever is not: **import a CSV roster, add one person, list everyone, copy a person's link, reissue or revoke it,
disable or re-enable the person.** It is the "full participant-admin surface" the staff-shell flyout has been
waiting for, and it replaces the persona-less planner "Import accounts" section as the way to provision people
(that older section is left in place; see Out of Scope).

**World: staff.** COBRA only (`@/theme/styledComponents`; MUI `Table`/`Dialog` under the COBRA theme the staff shell
mounts), desktop-first, dense on purpose, keyboard-first, never confusable with a participant view (D0 §2). It lives
at `/staff/participant-admin` as one staff-registry entry (EL-14), reachable by `planner` and `controller`.

The page is built **mock-first** against the frozen contract; it needs no backend to be developed and flips to live
with no change. It exposes **slots** for the day-word panel (11), the print-cards action (12) and the email action
(13), so those stories are disjoint from this one; the orchestrator composes them.

## Acceptance Criteria

- [ ] **Given** a `planner` or `controller` opens `/staff/participant-admin` (entry added by the orchestrator seam),
      **then** the screen mounts inside `StaffShellFrame` (`StaffHeader surfaceName="Participants"`, `Toolstrip`)
      and loads `GET /staff/roster`. **Given** a `403`/`401`, **then** a clear "You don't have access to the
      roster" state renders (never a blank page); evaluators and org admins never reach it (the registry's
      `allowedRoles` is the only gate).
- [ ] **Given** the list, **then** a real `<table>` shows per participant: name, agency, role, sign-in name,
      persona (`@handle` with a text+icon badge **Org** / **Auto citizen** / none), link status (**Active**,
      **Revoked**, **None**, **Needs reissue**, as text plus icon), last sign-in, live sessions, and access
      (**Enabled** / **Disabled**). A summary line reads like "42 participants · 38 signed in · 3 with no link".
      It has a text filter (name, agency, sign-in name), sortable column headers, an empty state that points at
      "Import CSV", and shows `joinLinksAvailable: false` as a warning banner ("Personal links are not configured on
      this server").
- [ ] **Given** the **Import CSV** panel, **then** it has a file picker (`.csv`, 1 MB, checked before upload with
      the server's wording), a **Download template** link (client-generated `name,agency,role,email,personaHandle,signInName`),
      and two buttons: **Validate** (`?dryRun=true`, nothing is written) and **Import**. The result shows the counts
      and a per-row table (row number, name, sign-in name, status as text plus icon: created / updated / unchanged /
      failed, the persona it bound or created, and the message). After a validate the chosen file is kept so
      **Import** needs no second pick. A real import refetches the list; a `400` shows the server's reason.
- [ ] **Given** **Add participant**, **then** a dialog with the same fields as `RosterRowWrite` validates before
      sending (name required; sign-in name `a-z 0-9 . _ -`, 3 to 32; email shape) and shows server `400`/`409` text
      inline ("already on the roster"). On success the dialog closes, the list refetches and the new row is
      focused.
- [ ] **Given** a row, **then** its actions are keyboard-operable buttons: **Copy link** (copies the `joinUrl`
      already in the list data, using `navigator.clipboard` with a `document.execCommand('copy')` fallback, inside
      the click handler so Safari allows it; success is announced as "Link copied" with **no URL in the message**),
      **Reissue link** and **Revoke link** and **Disable** (each behind a confirm dialog saying plainly what happens,
      e.g. "This signs {name} out everywhere and the old link stops working"), and **Enable**. A row with no link
      offers **Issue link** (reissue). A `needsReissue` row says so and offers Reissue instead of Copy. Each result
      reports `sessionsEnded`; the list refetches; focus returns to the row's action.
- [ ] **Given** row checkboxes and a select-all, **then** the page tracks the selected participant ids and renders
      the optional slots: `dayWordSlot` above the table, and `renderCardsAction(selection)` and
      `renderEmailAction(selection)` in the toolbar. With a slot absent nothing renders in its place. The exported
      props are frozen: `RosterPageProps { dayWordSlot?: ReactNode; renderCardsAction?: (selection: readonly string[]) => ReactNode; renderEmailAction?: (selection: readonly string[]) => ReactNode }`.
- [ ] **Given** `USE_MOCK_DATA`, **then** every call the page makes (list, add, import with and without dry-run, the
      four actions) is served by a mock adapter that follows the frozen contract, including a failed row, a
      `needsReissue` row, a `none`-link row, and a `403` switch, so the whole screen runs and is tested with no
      backend; with mock off the same service code hits the live endpoints unchanged.

### Cross-cutting
- [ ] **Two worlds (D0 §2):** COBRA buttons and text fields from `@/theme/styledComponents`, FontAwesome icons,
      MUI 9 `sx` props only; no participant skin, nothing that resembles a participant view. The folder is
      `features/participantAdmin/` (staff, despite the name), and this story adds `participantAdmin` to the forbidden
      specifiers in `staffShell/twoWorldsSeparation.test.ts` so any participant surface that imports it fails the suite.
- [ ] **Accessibility (NFR-001):** table headers with `scope`, sortable headers are buttons with `aria-sort`,
      status chips are text plus icon (never colour alone), confirm dialogs are `role="alertdialog"` with a focus
      trap and focus restore, results and errors go to an `aria-live` region, everything is operable by keyboard.
- [ ] **Isolation (XC-001/COR-001):** the page never sends or stores an exercise id; participant ids come only from
      the list response; every React Query key includes the active exercise id from `useExerciseContext()` so
      switching exercise never shows the previous exercise's people.
- [ ] **Secrets:** a `joinUrl` is held only in query data and passed to the clipboard; it is never rendered as DOM
      text, never put in a toast, log, `title`, or URL, and the list query uses `staleTime: 0` and a short `gcTime`.
- [ ] **Time (staff world):** instants (last sign-in, link issued) show in the exercise time zone with the zone
      named; the scenario-time-only rule (COR-053) binds the participant world, not this screen.

## Out of Scope

The day-word panel (11), the print preview and card sheet (12), the email action (13): this story renders their
slots only. The orchestrator's registry entry and slot composition (integration seam). Retiring the planner
"Import accounts" section in `ExerciseSettingsPage` (it still works, but creates people with no persona; retiring
it is a one-line follow-up and an open question for Tom). Restoring the participant-admin flyout's footer link
(`staff-shell/03`). Editing a single participant in place (re-import corrects them). Password reset and unlock
(`identity-auth-roles/08`). Any client-side role check beyond the registry's `allowedRoles`.

## Technical Notes

Frontend, staff world. New feature folder `src/frontend/src/features/participantAdmin/` with
`ParticipantAdminRoute.tsx` (frame + `RosterPage`, modelled on `PlannerWorkspaceRoute.tsx`), `pages/RosterPage.tsx`,
`components/people/*` (table, import panel, add dialog, row actions, confirm dialog), `services/rosterService.ts`
(axios under `/staff/roster…`, runtime guards, a typed `RosterError`; model: `planner/services/accountImportService.ts`),
`mocks/rosterMocks.ts`, `hooks/useRoster*.ts` (React Query), `types.ts` (the roster half of the frozen contract).
No CSV library: the template is a string and the server parses uploads. Make the page testable without the
frame. Keep the page a composition point (the planner page's header documents why). The slot props above are the
seam; do not import `dayWord/` or `cards/` from here. See `implementation.md` (story 10, gotchas 10, 12).

## Dependencies

None for development (the contract in `implementation.md`, mock-first). Live use needs backend stories 02 and 03.
Slots are filled by 11, 12, 13. The registry entry is an orchestrator seam edit.

## Tests

`features/participantAdmin/**.test.tsx`: `RosterPage` (loading, error, 403, empty, populated, summary, filter,
sort, join-links banner), `RosterImportPanel` (size check, validate vs import, kept file, result rendering, 400),
`AddParticipantDialog` (validation, 409), `RosterRowActions` (each action and confirm, clipboard path and fallback,
no URL in messages, focus restore, `needsReissue`/`none`), slot rendering (present and absent),
`rosterService` (paths, bodies, guards, error mapping), an exercise-id-in-query-key test, and an accessibility
pass (headers, `aria-sort`, `alertdialog`). Manual: walk-through steps 1, 2 and 6.
