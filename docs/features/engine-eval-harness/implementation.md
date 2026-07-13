# Implementation: Engine eval harness

> The acceptance gate for the engine (architecture §12). Four suites; the injection red-team (02) and
> the miss-safe/kill-switch scenario tests (04) are release-gating. Graduated from the self-validated
> spike `spikes/e8-generation-loop/`. Frontend harness is Vitest 4 + RTL (CLAUDE.md); no CI exists yet
> — these stories define the gate contracts; backend xUnit lands with the backend.

## Per-story tech notes

| Story | Approach | Key files it will own | Exports (the seam others import) |
|-------|----------|-----------------------|----------------------------------|
| 01 Voice-diversity checks | Run the shared §5.3 metric over a burst corpus as regression + human spot-check log. | `eval/voiceDiversity.test` | regression report; shares the metric with voice-engine 04 |
| 02 Injection red-team | Maintained gating suite of world-feed attacks; asserts isolation holds. | `eval/injectionRedteam.test`, attack fixtures | the release-gate contract |
| 03 Latency/cost SLO | p50/p95 + per-burst cost per provider/model vs the envelope. | `eval/latencyCostSlo` | SLO thresholds (validates the breaker threshold) |
| 04 Scenario reaction-correctness | Scripted end-to-end scenarios over the reaction loop. | `eval/scenarios/*.test` | the correctness gate (miss-safe + kill-switch gating) |

## Reuse map
- **`persona-voice-engine` story 04** — the shared believable+diverse metric (one implementation, two call sites).
- **`engine-generation-infra`** — provider + prompt + isolation boundary (02 tests it); tiering/breaker (03); the seeding cost/latency spike (story 06).
- **`reaction-loop` + `storyline-model` + `silence-escalation` + `response-reaction` + `autonomy-safety` + `amplification-engine`** — the behaviors the scenario suite (04) exercises.
- **The spike `spikes/e8-generation-loop/`** — `metrics.mjs` (voice metrics, `injectionResistance`, `fictionGuard`, `costUSD`), `index.mjs` (prompt + injection fixtures) — graduate into the eval suites.
- Vitest 4 + RTL (`src/frontend/vite.config.ts`) — the frontend test harness; off-platform marker (#29) for the parity scenario.

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Voice-diversity checks | eval/voiceDiversity.test | voice-engine 04 (metric) | 02, 03 | 1 | S |
| 02 Injection red-team | eval/injectionRedteam.test | generation-infra 03 (boundary) | 01, 03 | 1 | M |
| 03 Latency/cost SLO | eval/latencyCostSlo | generation-infra 01/04/05/06 | 01, 02 | 2 | S |
| 04 Scenario reaction-correctness | eval/scenarios/* | reaction-loop + behaviors + autonomy-safety | — | 3 | L |

01–03 can run once their targets exist (metric, boundary, provider). 04 is last — it needs the whole
reactive stack to script against. The suites are the gate; they don't ship product code, they gate it.
