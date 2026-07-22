# features/planner (STAFF world — COBRA)

Staff-console planner surfaces for Pulse. **This is the staff world (D0 §2):** COBRA
look via `@/theme/styledComponents` + `CobraStyles`, FontAwesome icons only, MUI
system props through `sx` (MUI 9). It must never read as a participant skin, and it
never mounts a participant/brand theme.

## Story 02 — Named participant accounts (COR-011)

The **bulk account-import panel** a planner uses to provision named participant
accounts by CSV.

| File | Role |
|------|------|
| `components/AccountImport.tsx` | The COBRA import panel: choose a CSV, upload it, render the per-row result summary (total / created / failed, plus each failed row's reason). Status is never color-only (icon + text + color). |
| `hooks/useAccountImport.ts` | React Query 5 mutation wrapping the import service. |
| `services/accountImportService.ts` | The data seam. Routes through the shared axios client with a mock adapter behind `USE_MOCK_DATA` (one env-guarded flip point); validates the response body fail-closed; throws a transport-agnostic `AccountImportError`. |
| `types.ts` | The `AccountImportResult` / `AccountImportRowResult` client contract (mirrors the backend DTOs). |

### Backend contract consumed

`POST /api/staff/accounts/import` — `multipart/form-data`, one file part named
`file` (`.csv`, ≤ 1 MB), staff bearer token in `Authorization`.
`200` → `AccountImportResultDto`; `400` malformed/oversized/empty; `401` no staff
session. See `src/Pulse.WebApi/Features/Identity/Accounts/`.

The staff bearer token is attached by the shared client's auth layer (wired by the
staff identity/session story), not by this feature.

### Mounting

`App.tsx` (orchestrator-owned) mounts this into a planner route in a later story.
Mount it inside a COBRA `ThemeProvider` (e.g. the shared staff shell) and a React
Query `QueryClientProvider`.

## Scope note

The story-02 primary AC names two provisioning paths (bulk import **or**
individually). The **frontend deliverable named in `implementation.md` is the CSV
import panel** — individual create is a backend endpoint (`POST /api/staff/accounts`)
and is not built as a frontend form here. A future story can add an individual-create
form following the same service/hook/panel pattern.
