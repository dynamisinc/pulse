# Implementation: Persona operation

> Bridge from the F7.1 stories to a build. Staff-world surface (COBRA), publishing into the E2
> social pipeline. Backend is not present yet — Phase 1 uses React Query + mock data behind the
> shared axios client; the persona and compose endpoints are the serial backend-contract seam.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Post as persona | A compose service + `useComposeAsPersona` mutation that posts through the E2 pipeline with `origin=controller-as-persona`, `actingHumanId`, dual timestamps. | `features/controller/services/composeService.ts`, `features/controller/hooks/useComposeAsPersona.ts`, `features/controller/components/PersonaComposer.tsx` | `composeAsPersona()`, `PersonaComposer` |
| 02 Fast switching | A persona-picker store (recents, pinned, type filter) + command-palette entry; drives the active persona in the composer. | `features/controller/components/PersonaPicker.tsx`, `features/controller/hooks/useActivePersona.ts` | `useActivePersona()`, `PersonaPicker` |
| 03 Composer context | A `PersonaContextPanel` reading voice notes / recents / audience magnitude for the active persona. | `features/controller/components/PersonaContextPanel.tsx`, `features/controller/services/personaService.ts` | `usePersona(id)`, `PersonaContextPanel` |
| 04 Presence | SignalR presence channel keyed by persona; a presence badge in the picker/composer. | `features/controller/hooks/usePersonaPresence.ts`, `features/controller/components/PresenceBadge.tsx` | `usePersonaPresence()` |
| 05 Mid-exercise create | A ≤60s "+ New persona" quick-create dialog launched from the picker; writes a Persona in the active exercise. | `features/controller/components/QuickCreatePersonaDialog.tsx` | `QuickCreatePersonaDialog` |

## Reuse map
- COBRA theme + `@/theme/styledComponents` (this is a staff surface) — `src/frontend/src/theme/`
- Shared axios client — `src/frontend/src/core/services/api.ts`
- React Query hooks pattern — `@tanstack/react-query`
- FontAwesome icons — `@fortawesome/react-fontawesome`
- **E2 social post pipeline** (compose/publish, link previews, thread model) — reuse, do not fork;
  posting-as-persona is the same pipeline with a different author + origin
- **Exercise-context / active-exercise selector** (E1) — the picker and all queries scope to it
- **Telemetry emitter (XC-004 v0)** — emit on send, capturing `actingHumanId` (COR-018)
- **Persona model + voice notes (COR-020), audience magnitude (SOC-054)** (E1) — read, don't redefine
- **console-shell** command palette (Ctrl+K) + persona dock host — register the picker as a tool

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 02 Fast switching | PersonaPicker, useActivePersona | E1 persona model; console-shell palette | 03 | 1 | M |
| 03 Composer context | PersonaContextPanel, personaService | E1 persona voice/audience fields | 02 | 1 | S |
| 01 Post as persona | composeService, useComposeAsPersona, PersonaComposer | 02 (active persona); E2 pipeline; telemetry emitter | — | 2 | M |
| 04 Presence | usePersonaPresence, PresenceBadge | SignalR host (later); 02 | 05 | 3 | M |
| 05 Mid-exercise create | QuickCreatePersonaDialog | E1 persona create; 02 | 04 | 3 | S |

Notes: waves 1→2 are serial on the active-persona contract; presence (04) waits on the SignalR
host landing. Story 01's publish path is the backend-contract seam — mockable now, serial on the
real E2 compose endpoint later.
