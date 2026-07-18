# Story 06 — measured cost/latency pass (results)

> Replaces the *modeled* numbers in [`spikes/e8-generation-loop/FINDINGS.md`](../../../spikes/e8-generation-loop/FINDINGS.md)
> with **measured** ones. Harness: `src/Pulse.Core.Tests/.../MeasuredCostLatencyTests.cs`
> (`PULSE_LIVE_FOUNDRY=1 dotnet test --filter MeasuredCostLatencyTests`).

**Run:** 2026-07-18 · endpoint `aif-pulse-uat` (Foundry, keyless) · api-version `2025-04-01-preview` ·
5 iterations/tier · 4-persona bursts · `AzureCliCredential` (tbull@dynamiscobra.com).

| Tier | Model | p50 | p95 | in tok | out tok | cached | guard | diversity | ~$/burst | ~$/exercise-hr* |
|---|---|---|---|---|---|---|---|---|---|---|
| Standard | gpt-5.4 | 2433 ms | 2655 ms | 992 | 206 | 0 | 5/5 | 5/5 | $0.0061 | ~$2.27 |
| Ambient | gpt-5.4-mini | 1682 ms | 1983 ms | 992 | 196 | 0 | 5/5 | 5/5 | $0.0020 | ~$0.74 |

\* At a nominal active-storyline hour (~25 generated posts/min ≈ 375 four-post bursts), using **analog
Sonnet/Haiku per-MTok pricing** ($3/$15 Standard, $1/$5 Ambient) — the **actual gpt-5.4 Azure rates are
still to confirm**; the *token profile* is measured.

## Findings

1. **Latency is well inside the SLO.** Measured p95 ≤ 2.7 s vs the modeled p95 < 10 s and the ~10 s
   degraded-mode breach point. Generation is off the participant hot path (§4.3), so 2–3 s is invisible
   in the review loop. **Degraded-mode trip set from data:** per-attempt timeout default lowered 30 s →
   **10 s** (≈3.7× the measured p95) — a call slower than that is treated as a failure and feeds the breaker.
2. **Cost confirms the analytic model.** ~$0.74–2.27/exercise-hour tiered, against the modeled
   ~$1.50–3.60/hr — immaterial next to the SimCell staffing it offsets. Ambient is ~3× cheaper than
   Standard, so model tiering (story 04) pays off.
3. **Prompt caching didn't engage yet — expected.** `cached = 0` because the burst prompt (~992 tokens)
   sits just under Azure OpenAI's ~1024-token automatic-caching threshold. The cache-prefix reorder
   (story 04) is correct but only activates once the **stable prefix exceeds ~1024 tokens**, which it will
   in production (real COR-020 dossiers + 2–3 prior-post exemplars per persona + larger casts).
   **Action:** re-measure caching with production-size dossiers; the cost figures above are therefore a
   conservative (un-cached) ceiling.
4. **Quality holds at both tiers.** 10/10 live bursts passed BOTH the fiction/injection guard (ADP-023/024)
   and the voice-diversity gate (ADP-021) — including gpt-5.4-mini. Believability + safety are not traded
   for the cheaper tier.

## Still open (→ engine-eval-harness story 03)

Ongoing SLO monitoring, and re-running §2's cost line once (a) gpt-5.4 Azure list prices are confirmed and
(b) production-size dossiers push the prefix past the cache threshold.
