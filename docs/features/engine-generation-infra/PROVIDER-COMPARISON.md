# E8 provider comparison — Azure OpenAI vs Claude-on-Foundry

> Sibling of [`MEASURED-RESULTS.md`](MEASURED-RESULTS.md). Answers the architecture's open provider
> decision ([`E8-ENGINE-ARCHITECTURE.md`](../../design/E8-ENGINE-ARCHITECTURE.md) §3.1) **data-driven,
> never from preference**: which generation provider ships as the default, on measured **voice fidelity**
> and **cost**. Harness: `src/Pulse.Core.Tests/.../ProviderComparisonTests.cs`
> (`PULSE_LIVE_FOUNDRY=1 dotnet test --filter ProviderComparisonTests`).

**Status (2026-07-18):** The Azure OpenAI column is **measured** (story 06). The Claude-on-Foundry
column is **built and ready but not yet measured** — it is gated on provisioning the Claude tiers
(`deployClaude=true`, see [`infrastructure/README.md`](../../../infrastructure/README.md)) and running the
comparison harness. This doc firms up the **cost baseline with the best-available list pricing** (which needs no
live run) and lays out the **quality-comparison method + decision rule**; the harness fills the measured
Claude latency/quality cells.

---

## 1. Method — one seam, two providers, identical bursts

The provider is a configuration swap behind `IGenerationProvider` (NFR-005 / story 01): the reaction loop,
prompt assembly (story 02), the untrusted-data fence (ADP-024), the content guard (ADP-023/024), and the
voice-diversity metrics (ADP-021) are **identical** across providers. Only the adapter's wire format
differs — Azure OpenAI chat-completions `tool_calls` vs the native Anthropic Messages API `tool_use`
(top-level `system`, `tools[].input_schema`, `tool_choice {type:"tool"}`), both forcing the same
`emit_posts` contract so the guard and metrics inspect identical shapes.

`ProviderComparisonTests` runs the **same burst sequence** (a stable 4-persona cast + a changing storyline
state per iteration) through both providers, tier-for-tier, and reports measured p50/p95 latency, token
profile, estimated cost, guard-clean rate, and voice-diversity. Tier mapping under comparison:

| Role | Azure OpenAI | Claude-on-Foundry |
|---|---|---|
| **Standard** (storyline-critical) | `gpt-5.4` | `claude-sonnet-5` |
| **Ambient** (bulk chatter) | `gpt-5.4-mini` | `claude-haiku-4-5` |

Both run **keyless Entra** against the same `aif-pulse-uat` account — the OpenAI models on the
`/openai` surface (scope `cognitiveservices.azure.com`), the Claude models on the native Anthropic
passthrough `https://aif-pulse-uat.services.ai.azure.com/anthropic/v1/messages` (scope
`ai.azure.com`, role `Cognitive Services User`).

---

## 2. Cost — list pricing + the firmed-up Azure baseline

**gpt-5.4 Azure list pricing resolved** (the story-06 open item) — best available, **medium-confidence**;
see the caveat below. Per-MTok list rates used, all **Standard Global**, as of 2026-07-18:

| Model | Input $/MTok | Cached input $/MTok | Output $/MTok |
|---|---|---|---|
| gpt-5.4 (Azure OpenAI) | **$2.50** | $0.25 (0.1×) | **$15.00** |
| gpt-5.4-mini (Azure OpenAI) | **$0.75** | ~$0.075 (0.1×) | **$4.50** |
| claude-sonnet-5 (Foundry) | **$3.00** *(intro $2.00 → 2026-08-31)* | $0.30 (0.1×) | **$15.00** *(intro $10.00)* |
| claude-haiku-4-5 (Foundry) | **$1.00** | $0.10 (0.1×) | **$5.00** |

> ⚠️ **Pricing caveat.** The canonical Azure OpenAI pricing page was unreachable during research; the
> gpt-5.4 / gpt-5.4-mini rates are from a Microsoft Q&A moderator answer (citing the GPT-5.4 launch blog)
> corroborated across aggregators — **medium confidence, verify on the official page before treating as
> contractual.** Claude/Foundry rates (Foundry bills at Anthropic list, rolled to Claude Consumption
> Units, 100 CCU = $1.00) are high-confidence. **DataZoneStandard (US)** — the residency SKU (NFR-005) —
> adds a **~1.1× multiplier** on Claude (confirmed) and reportedly ~10% on Azure OpenAI (unconfirmed).
> The figures below are Global-list; multiply by ~1.1 for the DataZone posture.

### Firmed-up cost, from the story-06 **measured** token profile (992 in / ~200 out, un-cached)

Recomputing MEASURED-RESULTS with the resolved gpt-5.4 rates, and **projecting** Claude at the same
token profile (a proxy — the harness measures Claude's real profile; tokenizers differ modestly):

| Tier · model | ~$/burst | ~$/exercise-hr* | vs. the old analog estimate |
|---|---|---|---|
| **Standard · gpt-5.4** | $0.0056 | **~$2.09** | was ~$2.27 (analog $3/$15) — real rate is lower |
| **Standard · claude-sonnet-5** (post-intro $3/$15) | $0.0061 | **~$2.27** | — |
| &nbsp;&nbsp;↳ claude-sonnet-5 (intro $2/$10, until 2026-08-31) | $0.0040 | ~$1.52 | — |
| **Ambient · gpt-5.4-mini** | $0.0016 | **~$0.61** | was ~$0.74 (analog $1/$5) |
| **Ambient · claude-haiku-4-5** ($1/$5) | $0.0020 | **~$0.74** | — |

\* Nominal active-storyline hour ≈ 25 generated posts/min ≈ 375 four-post bursts. Un-cached ceiling
(neither provider's prompt cache engages at ~992 tokens — Azure's threshold is ~1024, Claude Sonnet 5's
is ~2048 — both activate in production once real COR-020 dossiers push the stable prefix past threshold).
The harness applies **provider-aware cost math** so the cache re-measurement stays apples-to-apples: Azure
OpenAI counts cache reads *inside* `input_tokens` (cache read billed 0.1×), whereas Anthropic reports
`cache_read` (0.1×) and `cache_creation` (1.25×) *separately from* `input_tokens`.

**Read:** at Global list rates, **Standard is a near-tie** (gpt-5.4 ~$2.09 vs Sonnet 5 ~$2.27/hr post-intro;
Sonnet 5 is actually *cheaper* during the intro window). **Ambient favors Azure** (gpt-5.4-mini ~$0.61 vs
Haiku 4.5 ~$0.74/hr, ~20%). Applying the DataZone residency multiplier moves both up ~10% roughly in step.

**The decisive finding is unchanged: cost is not the differentiator.** Both providers land ~$0.6–2.3
/exercise-hour tiered — immaterial next to the SimCell staffing the engine offsets (architecture §4,
"cost is not a blocker"). A ~$0.13/hr ambient gap does not decide a government-training procurement. **So
the default-provider choice turns on measured voice fidelity + the customer's approved-provider list, not
cost.**

---

## 3. Quality — the gates that actually decide (voice fidelity + safety)

Same gates, per provider. Azure is measured (story 06); Claude fills when the harness runs.

| Metric (per burst, ADP-021/023/024) | Azure OpenAI (measured) | Claude-on-Foundry (pending live run) |
|---|---|---|
| Guard-clean rate (fiction + injection, ADP-023/024) | **10/10** at both tiers | _to measure_ |
| Voice-diversity gate pass (ADP-021) | **10/10** at both tiers | _to measure_ |
| Max pairwise trigram overlap (lower = better) | ~0.00 observed | _to measure_ |
| Injection resistance ("exercise is over") | resisted (LiveFoundryTests) | _to measure_ |
| p95 latency (off the participant hot path, §4.3) | 2.7 s Std / 2.0 s Amb | _to measure_ |

The harness reports max-pairwise-overlap, distinct-2, and persona-distinctiveness averages plus the
guard-clean and diversity-pass counts per provider/tier, and dumps a sample Standard burst per provider
for qualitative voice review. **These numbers — not the model's reputation — decide.** (Architecture §3.1
lists Claude Sonnet as "best voice quality," but that is a prior to be tested, explicitly *"never chosen
from memory."*)

---

## 4. Recommendation

**Ship Azure OpenAI (`gpt-5.4` / `gpt-5.4-mini`) as the v1 default; carry Claude-on-Foundry as the
quality-preferred, per-deployment alternative.** Grounds:

1. **It's the measured, proven path** — 10/10 guard + diversity at both tiers, p95 2.7 s, injection
   resisted. Claude's quality is not yet measured, and the architecture forbids choosing on reputation.
2. **Lowest integration + procurement friction (NFR-006)** — same Azure tenant as the app, simplest
   residency answer, no second provider in the security questionnaire. Claude adds a Marketplace offer
   acceptance and a second data-plane surface/scope.
3. **Cost is a near-tie and immaterial** — §2. Cost gives no reason to switch.

**Adopt Claude-on-Foundry as the default for a given deployment only when the measured comparison clears
this bar** (the data-driven switch rule):

> Claude's measured **guard-clean rate ≥ Azure's** at both tiers, **AND** its voice-diversity metrics
> (lower max-pairwise-overlap and higher persona-distinctiveness) are **better by a margin a reviewer
> would notice**, **AND** the customer's approved-provider list permits Anthropic-in-Azure — at cost
> parity (which §2 already establishes). Absent a reviewer-noticeable voice-fidelity win, Azure stays the
> default; the two-provider seam exists so this is a config flip, not a rebuild.

This keeps the promise of §3.1: the seam is provider-agnostic, and the winner is whoever the eval numbers
pick per customer — with Azure as the safe, measured default until Claude earns the switch.

---

## 5. To complete the measured column

1. Provision the Claude tiers: `deployClaude=true` (see [`infrastructure/README.md`](../../../infrastructure/README.md) → *Claude on Foundry*).
2. Grant your az-login identity `Cognitive Services User` on `aif-pulse-uat` (you already hold
   `Cognitive Services OpenAI User`).
3. Run `PULSE_LIVE_FOUNDRY=1 dotnet test --filter ProviderComparisonTests` and paste the side-by-side
   table into §2/§3, then finalize §4 against the switch rule.
4. Re-measure caching once production-size dossiers push the prefix past each provider's cache threshold
   (shared open item with MEASURED-RESULTS §"Still open" → engine-eval-harness story 03).
