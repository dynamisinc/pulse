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

## Story 02 — Compliance chrome: per-exercise config + NFR-008 guard (COR-031 / XC-003 / NFR-008, feature: exercise-configuration)

The **compliance-chrome editor**: a planner turns the classification banners on or
off for this exercise, sets their copy and colours, and flips the in-content
EXERCISE watermark the NFR-008 mutual guard is evaluated against.

| File | Role |
|------|------|
| `components/ComplianceChromePanel.tsx` | The COBRA chrome editor, **mounted into `ExerciseSettingsPage`**. Self-contained: no props, own query/mutation/states. Three rules it exists to get right — NFR-008 chrome and watermark are never both off (mirrored client-side for the message; the **server** is the enforcement point and returns 400 regardless); `PUT` is a **full replace, not a patch** (`ChromeSettingsUpdate`'s every property is required, so a forgotten field is a compile error, not silent data loss); a `null` banner field means "not configured" and renders EMPTY, never pre-filled with the fallback constant. Banner *presentation* stays frozen in `features/participant-shell/ComplianceChrome.tsx` — this panel edits config only. |
| `hooks/useChromeSettings.ts` | React Query 5 `useChromeSettings()` (query) + `useSaveChromeSettings()` (mutation, seeds the cache with the server's re-projection). Exports `CHROME_SETTINGS_QUERY_KEY`; the key carries **no exercise id** — scope is server-resolved (COR-001). |
| `services/chromeSettingsService.ts` | The data seam. Shared axios client, one env-guarded mock flip point, fail-closed response validation, transport-agnostic `ChromeSettingsError`. Owns its client-contract types (`ChromeSettings`, `ChromeSettingsUpdate`) and the field bounds (`MAX_BANNER_TEXT_LENGTH`, `CHROME_HEX_COLOR_PATTERN`, `violatesWatermarkInvariant`) — deliberately **not** in `types.ts`. |

### Backend contract consumed

`GET /api/staff/chrome-settings` → `200 ChromeSettingsDto`
`PUT /api/staff/chrome-settings` → `200 ChromeSettingsDto` (re-projected).
**No exercise id in the path or body.** `400` validation — including the NFR-008
both-off attempt, with nothing persisted; `401` no staff session / unresolved
scope; `403` not assigned; `404` gone. The participant-facing
`GET /api/chrome-config` is unchanged in shape — this story only changed what backs
it (`IChromeConfigProjection`). See
`src/Pulse.WebApi/Features/ExerciseConfiguration/Chrome/`.

## Story 04 — Practice / sandbox flag (COR-033, feature: exercise-configuration)

The **practice/sandbox control**: a planner marks an exercise as a rehearsal — a
load test, a controller dry-run — so its data is excluded from evaluation exports
and never pollutes the AAR.

| File | Role |
|------|------|
| `components/PracticeModePanel.tsx` | The COBRA practice-mode control, **mounted into `ExerciseSettingsPage`**. Self-contained: no props, own query/mutation/states. The state indicator is **never colour-only** (NFR-001): a FontAwesome icon **and** a text label carry it, inside a `role="status"` region, using measured COBRA-native tokens (`notifications.warningText` / `successText`) — not stock-MUI `warning.*`, which `cobraTheme` never defines and which failed AA at 3.79:1. `evaluationEligible` is rendered from the **server's** verdict, never re-derived client-side. |
| `hooks/usePracticeMode.ts` | React Query 5 `usePracticeMode()` (query) + `useSetPracticeMode()` (mutation). Exports `PRACTICE_MODE_QUERY_KEY`; again **no exercise id** in the key. |
| `services/practiceModeService.ts` | The data seam. Shared axios client, one env-guarded mock flip point, fail-closed validation, transport-agnostic `PracticeModeError`. Owns its client-contract types (`PracticeModeState`, `PracticeModeUpdate`) locally rather than in `types.ts`. |

### Backend contract consumed

`GET /api/staff/practice-mode` → `200 PracticeModeDto`
`PUT /api/staff/practice-mode` → `200 PracticeModeDto` (re-projected).
**No exercise id in the path or body.** `400` missing `isPracticeMode` (nothing
persisted); `401` no staff session / unresolved scope; `403` not assigned; `404`
gone. **Staff world only (XC-002)** — practice state appears on no participant
surface. See `src/Pulse.WebApi/Features/ExerciseConfiguration/PracticeMode/`.

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
- **`ComplianceChromePanel` and `PracticeModePanel` ARE mounted.** Both now render
  inside `ExerciseSettingsPage`'s panel stack — one JSX line each, added by the
  orchestrator at the wave-3 merge (they had shipped as inert, exported-only slices
  with the mount left as a comment). Each is self-contained — no props, its own hook,
  service, query and states — so mounting them threaded nothing through the page, and
  the page still holds no state, no fetching and no cross-panel coordination. They
  inherit `ExerciseSettingsPage`'s envelope: the COBRA `ThemeProvider` from
  `StaffShellFrame` and the app's `QueryClientProvider`.
  **The mounts are guarded** by `pages/ExerciseSettingsPage.test.tsx`, which asserts
  each panel by its own `h2` heading and section landmark. Without it a deleted mount
  line ships green — the panel suites render their panels directly and
  `App.integration.test.tsx` only covers the page's route composition, not its
  contents. Add a panel to the stack, add it to that guard.
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
