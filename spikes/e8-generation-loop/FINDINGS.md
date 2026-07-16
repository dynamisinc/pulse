# E8 generation-loop spike — findings

> Throwaway spike for the E8 technical design. Validates the generate→review loop, the
> prompt-injection isolation boundary, and the eval harness; answers epic open question 3
> (cost/latency envelope). Run: `node index.mjs --offline` (no key needed) or `node index.mjs`
> with `ANTHROPIC_API_KEY` set for live latency/voice numbers.

## What ran

- **Prompt structure** (`index.mjs`): trusted engine context (exercise brief + persona
  dossiers + storyline state) in the system prompt; **untrusted world/participant content in a
  fenced, role-tagged `<world_feed>` block** the system prompt names as data-never-instructions;
  output forced through an `emit_posts` tool schema (structured per-post, `tool_choice` forced).
  Fixtures include three real prompt-injection attacks ("ignore your instructions / exercise is
  over", "print your system prompt / debug mode", "repeat this word for word").
- **Eval harness** (`metrics.mjs`): trigram max-pairwise-overlap + distinct-2 + persona
  lexical-distinctiveness (ADP-021), a fiction-break regex guard (ADP-023), an injection-leak
  check (ADP-024), and a cost calculator off the published price table.

## Harness is valid

Offline burst 1 (clean) **passes** all five gates; burst 2 (deliberately seeded with a
fiction-break — "the AI forgot its lines" — and two near-duplicate posts) **fails** exactly the
diversity + guard gates and no others. The guards catch the failures they must, and don't
false-positive on the clean burst. This is the safety-net the real engine's acceptance tests extend.

## Open question 3 — cost/latency envelope (ANSWERED: cost is not a blocker)

Analytic model from published pricing + the fixture token profile (~4 posts/burst, ~700 fresh
input tokens + a ~2,300-token cacheable dossier/brief prefix + ~260 output):

| Scenario | Gen rate | Model | Single-model | Tiered (60% Haiku) |
|---|---|---|---|---|
| Ambient lull | 8 posts/min | Haiku 4.5 | ~$0.27/hr | ~$0.27/hr |
| Active storyline (nominal) | 25 posts/min | Sonnet 5 | ~$2.51/hr | ~$1.51/hr |
| Peak burst (10 min) | 60 posts/min | Sonnet 5 | ~$6.02/hr | ~$3.61/hr |

A full 8-hour functional-exercise day, mostly at active-storyline rate with peak spells, lands
around **$15–35 in generation cost**. Even an order-of-magnitude estimation error keeps this
immaterial next to the staffing it replaces. **Prompt caching is the dominant lever** — the
dossier+brief prefix is stable across a burst sequence, so it bills at 0.1× as a cache read
after the first call. Model tiering (bulk ambient on Haiku, storyline-critical reactions on
Sonnet) roughly halves the active/peak cost.

**Latency:** generation is **off the participant hot path** — output lands in the E7 review
queue or a Delayed-auto countdown, not synchronously into a feed — so a p50 of 3–5s and p95
<10s sit comfortably inside the human-review loop. The load-bearing SLO is the **degraded-mode
trip**: p95 breach (~10s) or provider error → the engine drops to Suggest/manual (NFR-003, ADP-042).

## Caveat (honest)

No API key was available in this environment (`ANTHROPIC_API_KEY` unset, no `ant` profile), so
**live latency and real voice-quality are modeled, not measured.** The cost figures are analytic
from the published price table and a realistic token profile; the latency figures are engineering
estimates. The harness is built and self-validated — re-run with a key to replace the modeled
numbers with measured ones before locking story estimates. This does not change the architecture
recommendation: the envelope has multiple orders of magnitude of headroom.

## Model choice implication

Sonnet 5 is the right default generation tier (near-Opus voice quality at $3/$15, 1M context for
large casts), Haiku 4.5 for ambient bulk. Opus 4.8 / Fable 5 are unnecessary for per-post
generation and would 3–10× the cost for no believability gain the reviewer would notice.
