# features/planner (STAFF world — COBRA)

Staff-console planner surfaces for Pulse. **This is the staff world (D0 §2):** COBRA
look via `@/theme/styledComponents` + `CobraStyles`, FontAwesome icons only, MUI
system props through `sx` (MUI 9). It must never read as a participant skin, and it
never mounts a participant/brand theme.

Everything the feature exports goes through `index.ts` (the barrel). This README
documents **every file in the surface**, grouped by the story that shipped it.

## Story 01b — Per-exercise settings editor (COR-030 / XC-008, feature: exercise-configuration)

The **exercise-settings workspace**: the planner's one place to see and change
everything that configures a single exercise — internal name, participant-visible
world name + locale, the exercise's single IANA time zone, the scheduled window, the
enabled channel set, and the theming block (brand name + colors, per-outlet display
names).

| File | Role |
|------|------|
| `pages/ExerciseSettingsPage.tsx` | The page mounted as the planner staff surface: a `<main>` landmark with one `h1` and a stack of panels. A **composition point** — wave 3 mounts `ComplianceChromePanel` (story 02) and `PracticeModePanel` (story 04) into it, one line each; it deliberately holds no state, no fetching and no cross-panel coordination. |
| `components/ExerciseSettingsPanel.tsx` | The COBRA settings editor itself: loads the settings, renders every settable field, and full-replaces them on save. `PUT` is a **full replace, not a patch**, so the form submits every managed field on every save (enforced structurally — see that file's header, rule 1). Re-renders from the server's response, never from local form state. |
| `hooks/useExerciseSettings.ts` | React Query 5 `useExerciseSettings()` (query) + `useSaveExerciseSettings()` (mutation, seeds the query cache with the server's re-projection). Exports `EXERCISE_SETTINGS_QUERY_KEY`; the key carries **no exercise id** — scope is server-resolved (COR-001). |
| `services/exerciseSettingsService.ts` | The data seam. Shared axios client, one env-guarded mock flip point (`USE_MOCK_SETTINGS = USE_MOCK_DATA`), fail-closed response validation, transport-agnostic `ExerciseSettingsError`. Owns the client contract types (`ExerciseSettings`, `ExerciseSettingsUpdate`) and the field-bound constants the panel validates against. |

### Backend contract consumed

`GET /api/staff/exercise-settings` → `200 ExerciseSettingsDto`
`PUT /api/staff/exercise-settings` → `200 ExerciseSettingsDto` (the freshly
re-projected settings). **No exercise id in the path or body** — the server resolves
the scope from the staff session (COR-001), so this surface cannot address another
exercise. `400` validation, `401` no staff session, `403` not assigned, `404` gone.
See `src/Pulse.WebApi/Features/ExerciseConfiguration/`.

## Story 02 — Named participant accounts (COR-011, feature: identity-auth-roles)

The **bulk account-import panel** a planner uses to provision named participant
accounts by CSV.

| File | Role |
|------|------|
| `components/AccountImport.tsx` | The COBRA import panel: choose a CSV, upload it, render the per-row result summary (total / created / failed, plus each failed row's reason). Status is never color-only (icon + text + color). **Not mounted anywhere yet — see "Mounting" below.** |
| `hooks/useAccountImport.ts` | React Query 5 mutation wrapping the import service. |
| `services/accountImportService.ts` | The data seam. Routes through the shared axios client with a mock adapter behind `USE_MOCK_DATA` (one env-guarded flip point); validates the response body fail-closed; throws a transport-agnostic `AccountImportError`. |
| `types.ts` | The `AccountImportResult` / `AccountImportRowResult` client contract (mirrors the backend DTOs). Deliberately **not** a shared seam: stories 02 and 04 of exercise-configuration keep their contract types in their own service modules. |

### Backend contract consumed

`POST /api/staff/accounts/import` — `multipart/form-data`, one file part named
`file` (`.csv`, ≤ 1 MB), staff bearer token in `Authorization`.
`200` → `AccountImportResultDto`; `400` malformed/oversized/empty; `401` no staff
session. See `src/Pulse.WebApi/Features/Identity/Accounts/`.

The staff bearer token is attached by the shared client's auth layer (wired by the
staff identity/session story), not by this feature.

## Mounting

Routing is **orchestrator-owned**: this feature exports components and never edits
the route table.

- **`ExerciseSettingsPage` IS mounted.** `App.tsx` mounts it as
  `PlannerWorkspaceRoute`, wired into `staffSurfaces.planner` in the role-aware route
  table — so a resolved `planner` session lands on it. (Before that slot was filled, a
  planner session fell through `RoleAwareEntry`'s fail-closed redirect to `/login`.)
  It renders inside `StaffShellFrame` (which mounts the COBRA `ThemeProvider`) and the
  app's React Query `QueryClientProvider`. That composition is covered by
  `src/frontend/src/App.integration.test.tsx`.
- **`AccountImport` is exported but NOT mounted anywhere.** It is reachable only by
  importing it from this barrel; no route, page or panel renders it today, so a
  planner has no way to reach the CSV import in the running app. This is a known
  open question, recorded here rather than resolved: it is not a decision this README
  makes. Whoever mounts it must do so inside a COBRA `ThemeProvider` (e.g. the shared
  staff shell) and a React Query `QueryClientProvider` — the same envelope
  `ExerciseSettingsPage` gets.

## Scope note

The identity-auth-roles story-02 primary AC names two provisioning paths (bulk import
**or** individually). The **frontend deliverable named in `implementation.md` is the
CSV import panel** — individual create is a backend endpoint
(`POST /api/staff/accounts`) and is not built as a frontend form here. A future story
can add an individual-create form following the same service/hook/panel pattern.
