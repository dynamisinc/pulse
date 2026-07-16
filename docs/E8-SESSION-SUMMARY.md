# E8 — Session summary: what we're betting on, and the risks

> Closing summary of the E8 (Adaptive Content Engine) design + decomposition session (2026-07).
> Deliverables: the architecture spike [`design/E8-ENGINE-ARCHITECTURE.md`](design/E8-ENGINE-ARCHITECTURE.md),
> a throwaway generation-loop prototype [`../spikes/e8-generation-loop/`](../spikes/e8-generation-loop/),
> the `docs/features/` E8 backlog (11 v1 features + 4 stubs), and the GitHub Epic→Feature→Story
> hierarchy (#126 → #127–#141 → 37 story sub-issues).

## The bet

Looking Glass runs on scripts; the world says what it was told to say. Pulse's bet is **a world that
talks back** — content generated in response to what participants do *and fail to do*, governed by a
controller who directs rather than types. We're betting a controller-governed, persona-voiced
generation loop can be **correct** (reacts to the right trigger, never berates a PIO who answered),
**believable** (distinct human voices, no single authorial tell), **safe** (never breaks fiction,
never obeys a hijack attempt, never self-escalates), and **load-reducing** (cuts controller decisions,
doesn't multiply them) — and that it's cheap and fast enough to run all day.

The spike says the economics and mechanics hold: a realistic exercise-hour costs ~$1.50–3.60 in
generation (Sonnet-tier for storyline-critical work, Haiku for ambient), prompt caching is the
dominant lever, and generation sits off the participant hot path so a few seconds of latency is
invisible.

## The three open questions, resolved

1. **Storyline auto-detection** → deferred post-v1; v1/v1.1 use controller-created / pre-seeded
   storylines only (auto-detection risks the engine inventing pressure that isn't there).
2. **Response-matching trust curve** → suggestion-with-confirmation at launch; auto-match is earned
   by measured precision, opted into per exercise by a human, never self-escalated.
3. **Cost/latency envelope** → answered by the spike; cost is not a constraint. The load-bearing SLO
   is the degraded-mode trip (fall back to Suggest/manual on outage or p95 breach), not raw speed.

## What we're trading (flagged, not buried)

| Decision | Trade | Why |
|---|---|---|
| Auto mode is v1.1, not v1 | Slower to hands-off | Auto has no human gate; it ships only after the v1 guard + eval harness are proven. |
| Controller-seeded storylines only in v1 | No emergent auto-detection | Avoids the engine manufacturing pressure that isn't real. |
| Sonnet/Haiku tiers, not the flagship | Marginally less peak eloquence | No reviewer-visible believability gain at 3–10× cost; Fable's ZDR restriction conflicts with the governance posture. |
| Latency/voice numbers are modeled | Estimates pending a live key | The harness is built and self-validated; a live-key pass replaces them before estimates lock. |

## The risks we're watching

1. **Voice fidelity rests on the COR-020 dossiers.** Bad voice notes → one flat crowd. Mitigated by
   a diversity acceptance gate that *fails the build* on convergence.
2. **Prompt injection is an arms race.** This audience is trained in it. Mitigated by defense-in-depth
   isolation + a *maintained*, release-gating red-team suite + the human gate.
3. **The workload contract is make-or-break.** If real bursts push controller demand past ~6/min
   (CTL-034), "junior staffer" becomes "second job." It's a *measured* joint E7+E8 acceptance
   criterion, reduced by burst-level review, storyline-level autonomy, pre-filtering, and match
   suggestion.
4. **Sentiment circularity in the AAR.** The engine partly dials the mood it later reports. Mitigated
   by dial-input overlays on every E10 sentiment/intensity chart (EVL-014).
5. **Provider/governance drift across customers.** Different approved stacks and residency. Mitigated
   by a provider abstraction with a per-provider eval and a fixed governance contract every provider
   must satisfy.

## What shipped this session

- **Design:** [`design/E8-ENGINE-ARCHITECTURE.md`](design/E8-ENGINE-ARCHITECTURE.md) — generation
  architecture + provider comparison, cost/latency envelope, persona voice engine + acceptance metric,
  storyline state machine, response-matching + miss-safe default, autonomy/safety state machine,
  content guardrails + injection hardening, rumor object model (v1.1), telemetry, and the eval harness.
- **Spike:** [`../spikes/e8-generation-loop/`](../spikes/e8-generation-loop/) — a runnable
  generate→review prototype with the injection-isolation prompt structure and a self-validated metric
  harness (`FINDINGS.md` has the numbers; re-run with a key for measured latency/voice).
- **Backlog:** 11 fully-specified v1 features (37 stories + implementation.md each) and 4 later-phase
  `feature.md` stubs under `docs/features/`, with cross-cutting NFR-005/ADP-024/ADP-023/CTL-034/XC-004/
  scenario-time ACs attached where warranted.
- **GitHub:** Epic **#126** → 15 feature sub-issues (**#127–#141**) → 37 story sub-issues, labeled
  `phase:2` (`phase:4` for expected-action-binding), `world:staff`, `status:todo`.

## The bar (restated)

Pulse's promise is a world that reacts — correctly, believably, safely, and while *reducing* the load
on the one controller running it. That is the differentiator. The design optimizes for believability,
safety, and controller trust over speed of shipping; every trade against those is flagged above, not
buried.
