# Implementation: Staff shell frame

> Bridge between planning and orchestration. The staff frame is a **Phase-1 foundation** — the
> controller console (and later the evaluator dashboard) render inside it, so it lands early on the
> staff side, alongside `console-shell` (which docks into it).

## Per-story tech notes

| Story | Approach | Key files it owns | Exports (that others import) |
|-------|----------|-------------------|------------------------------|
| 01 staff-header | Navy Cadence header: lockup, identity badge (static/conduct), clocks, state pill, FOUO tag, presence, preview button | `features/staffShell/components/StaffHeader.tsx` | `<StaffHeader>`, header action slot |
| 02 toolstrip-dock | 56px right dock, shell-global + surface zones; **tool-registration API** | `.../components/Toolstrip.tsx`, `.../toolRegistry.ts` | **`registerSurfaceTool()` / `<Toolstrip>`** — the seam console-shell + evaluator import |
| 03 participant-admin-flyout | Shell-global tool: 330px login-triage flyout + badge | `.../components/ParticipantAdminFlyout.tsx` | (registers itself as a shell-global tool) |
| 04 preview-as-participant | Stages `participant-shell` (variant: preview) + moment picker | `.../components/PreviewAsParticipant.tsx` | preview toggle (header button consumes) |
| 05 cadence-chrome-tokens | Applies the existing COBRA theme to the frame; enforces the hard gate | `.../StaffShellFrame.tsx` (theme boundary) | `<StaffShellFrame>`, Cadence token usage |

Backend .NET not present yet — header/identity/admin/preview state is the **contract seam**: React
Query + mock behind the axios client now; SignalR presence + real endpoints later.

## Reuse map
- **COBRA theme + `@/theme/styledComponents` + `CobraStyles`** (`src/frontend/src/theme/`) — this is
  the staff frame; story 05 applies it. The MUI 9 port (CLAUDE.md).
- Exercise-context / roles (E1) — Director/Controller/lead-controller gating (header switcher, admin
  actions); exercise identity + lifecycle (COR-005/032).
- Exercise clock (E1, COR-050) — the scenario+wall clock pair (story 01).
- **`participant-shell`** — the render target of Preview-as (story 04); imports its mount contract +
  preview variant.
- FontAwesome icons (`@fortawesome/react-fontawesome`) — **never** `@mui/icons-material`; React Query.
- Telemetry emitter (XC-004) — admin quick-action logging (story 03).

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 05 cadence-chrome-tokens | StaffShellFrame (theme boundary) | COBRA theme (exists) | — | 1 | S |
| 01 staff-header | StaffHeader | 05; E1 identity/clock | 02 | 1 | M |
| 02 toolstrip-dock | Toolstrip, toolRegistry | 05 | 01 | 1 | M |
| 03 participant-admin-flyout | ParticipantAdminFlyout | 02 (registers as tool); E1 admin API | 04 | 2 | M |
| 04 preview-as-participant | PreviewAsParticipant | 01 (button); participant-shell | 03 | 2 | M |

Wave 1 = the token foundation + the two structural containers (header, toolstrip) that export the
seams. Wave 2 = the two shell-global capabilities. **Cross-feature edges:** `console-shell` registers
its toolbox via story 02's `registerSurfaceTool()` (serial on story 02); story 04 depends on
`participant-shell` (serial on that feature's mount contract).
