# Implementation: Persona voice engine

> The believability core. Backend .NET absent; these stories define the persona-context contract and
> the diversity/consistency metric (already prototyped in `spikes/e8-generation-loop/metrics.mjs`).
> Feeds every reactive-behavior feature.

## Per-story tech notes

| Story | Approach | Key files it will own | Exports (the seam others import) |
|-------|----------|-----------------------|----------------------------------|
| 01 Voice consistency | Style-param extraction (heuristics over dossier + recent posts) + prior-post selection. | `services/voice/styleParams`, `services/voice/priorPosts` | `personaContext(persona) → {voiceNotes, styleParams, exemplars}` fed to prompt assembly |
| 02 Cross-persona diversity | One-call burst; score with the metric; re-roll/resample outliers before enqueue. | `services/voice/burstGate` | `enforceDiversity(burst) → burst \| reroll \| drop` |
| 03 Persona-type behavior + bad-actor gating | Type→behavior mapping in prompt context; eligibility filter reads the scenario bad-actor flag. | `services/voice/typeBehavior`, `services/voice/eligibility` | `eligiblePersonas(storyline) → persona[]`; type-behavior context |
| 04 Believable+diverse metric | Pure functions (trigram overlap, distinct-2, distinctiveness, style conformance) + combined gate. | `services/voice/metrics` (shared) | `scoreBurst(burst) → {pass, checks}`; the shared metric lib |

## Reuse map
- **Persona dossiers (COR-020)** — from `persona-management` (voice notes, type, SOC-054 audience band).
- E2 persona post history — for prior-post conditioning + style-param refresh (exercise-scoped, XC-001).
- `engine-generation-infra` — prompt assembly (story 02) consumes `personaContext`; the burst is one `emit_posts` call.
- Telemetry emitter (`XC-004`) — re-roll/drop events.
- The metric prototype `spikes/e8-generation-loop/metrics.mjs` — graduate into `services/voice/metrics`.
- `storyline-model` — supplies `participatingPersonas` + the bad-actor enablement flag.

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 04 Believable+diverse metric | services/voice/metrics | spike prototype | — | 1 | S |
| 01 Voice consistency | styleParams, priorPosts | persona dossiers, E2 history | 03 | 2 | M |
| 03 Persona-type + bad-actor | typeBehavior, eligibility | persona type, storyline flag | 01 | 2 | S |
| 02 Cross-persona diversity | burstGate | 04 (metric), generation-infra 02/03 | — | 3 | M |

Metric first (04) — it's the shared dependency for the gate. 01+03 are the per-persona context pair.
02 wires the gate once the metric and burst generation exist. Frontend→backend edge serial; the
`personaContext` + `scoreBurst` signatures are the seams.
