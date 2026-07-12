# E8 — Adaptive Content Engine · Dedicated Session Brief

> **Read this, then execute it.** This is the kickoff brief for a dedicated session on **E8, the
> Adaptive Content Engine** — the capability that differentiates Pulse from Looking Glass and every
> social-sim clone. **This is not a mechanical story-decomposition pass.** E8 is the "tech that makes
> us different": it must be **correct, believable, safe, and game-changing**. Design the engine
> first; decompose into stories second.

---

## 0. Session setup

- **Root Claude Code at `C:\Code\pulse`** so the repo subagents (`story-agent`, `code-review`,
  `frontend-agent`, `testing-agent`) are native. Use **Opus at high/max effort.**
- **Load the `claude-api` skill** before any LLM/model/cost/latency reasoning — do not answer model
  or pricing questions from memory.
- The whole Phase-1 backlog is already built (E1 #37, E2 #82, E7 #1 — 100 stories, issues #1–#125).
  **E8 issues continue from #126.** Do not redo Phase 1.

## 1. Read first (in order)

1. **`docs/08-adaptive-content-engine.md`** — the epic. This is the spec; treat its requirement IDs
   (ADP-*) as the source of truth.
2. **`docs/00-MASTER-PRD.md`** — §4 (engine-first phasing: E8 starts maturing right after the social
   core so it gets max polish; pilot exercises run on Social+engine before full parity), §5 (XC-004
   telemetry), §5b (**NFR-005 LLM governance**, **NFR-003 degraded modes**, NFR-002 scale).
3. **`docs/design/D0-FOUNDATIONS.md`** — the two worlds + non-negotiables.
4. **The Phase-1 surfaces E8 plugs into (its contracts — already storied):**
   - `docs/features/engine-review-cockpit/` (issues **#34–#36**) — the review queue E8 fills.
     **ADP-040 is amended: expired drafts auto-HOLD, never auto-send** (D5); swamped-mode is the only
     opt-in to timeout auto-send. E8 produces exactly what this cockpit consumes.
   - `docs/features/world-steering/02-escalation-dial.md` (**#25**) — E8 drives **actual intensity
     toward the controller-set target**.
   - `docs/features/world-steering/06-off-platform-response-marker.md` (**#29**), `03-tiered-pause.md`
     (**#26**), `05-content-takedown.md` (**#28**) — off-platform satisfies expectations; pause/freeze
     suspends the engine; takedowns are retractions.
   - `docs/features/feeds-discovery/` + `docs/features/posts/` + `amplification/` + `reactions/` (E2) —
     **E8 publishes through the same E2 pipeline as any post**; it consumes SOC-054 audience magnitude
     and SOC-031 sentiment.
   - E1: `persona-management` (COR-020 voice notes — the Phase-1-critical asset the engine's quality
     rests on), `exercise-clock` (COR-050/051 — **E8 timers run in scenario time**), telemetry (XC-004).
5. **`docs/design/D5-controller-console/STORY-UPDATES.md`** — the ADP-040 auto-HOLD amendment E8 must honor.
6. **Conventions:** `.claude/agents/story-agent.md`, `docs/features/_template/`, `docs/GITHUB_TRACKER.md`,
   `docs/FEATURE_ORCHESTRATION_PLAYBOOK.md`.

## 2. Phase A — the technical design spike (DO THIS BEFORE ANY STORIES)

Produce **`docs/design/E8-ENGINE-ARCHITECTURE.md`**. This is where game-changing-vs-gimmick is
decided. It must resolve the hard problems the epic flags:

1. **Generation architecture & provider.** A **tenant-bounded, no-training** endpoint with documented
   residency (NFR-005) — Azure OpenAI in-tenant (epic default) and/or Claude via a tenant-bounded
   endpoint (use the `claude-api` skill to compare). Define the prompt structure, context assembly
   (storyline state + persona voice profile + recent posts), and the **untrusted-data isolation
   boundary** (ADP-024 — participant/world content is *data, never instructions*; quoting/delimiting/
   role-separation).
2. **Cost & latency envelope** (epic open question 3 — *needs a spike before story-level commitment*).
   Model a realistic exercise-hour at NFR-002 volumes; choose a strategy (model tiering, batching,
   caching, rate caps + quiet floors ADP-011); set a budget and the **degraded-mode fallback to
   Suggest/manual** on outage or latency breach (NFR-003, ADP-042). **Strongly recommended: build a
   small throwaway prototype of the generate→review loop and *measure* real latency/cost/voice
   quality** before committing story estimates.
3. **Persona voice engine** (ADP-020/021) — how one persona stays *consistent* while personas stay
   *diverse* (voice profiles from COR-020, prior-post conditioning, n-gram-overlap diversity
   thresholds across a burst). Define the **acceptance metric** for "believable + diverse."
4. **Storyline state machine** (§2.1) — intensity (0–10), sentiment, participating personas,
   hashtags, expectation; escalation curves (ADP-010); the full reaction loop
   (observe → decide → generate → review → publish → measure).
5. **Response-matching** (ADP-002/002a) — controller-confirmed at launch; the **miss-safe default**
   (unmatched official content *slows but never pauses* escalation and prompts Y/N; off-platform
   marker CTL-026 satisfies expectations identically). Define the path to earning trust toward auto.
6. **Autonomy & safety state machine** — Suggest / Delayed-auto / Auto; **auto-HOLD on timeout (never
   auto-send)**; swamped-mode opt-in; kill switch (ADP-042); *automation never escalates its own
   autonomy.* The **workload contract (CTL-034): E8 must keep controller decisions ≤6/min — a design
   that multiplies controller decisions is wrong.**
7. **Content guardrails** (ADP-023) — never break fiction, never reference the real world or the
   exercise's simulated nature; automated filtering + the human gate. **Prompt-injection red-teaming
   is acceptance testing, not an edge case** (this population is literally trained in info manipulation).
8. **Misinformation / rumor model** (F8.4, v1.1) — rumor object (false claim + mutation budget +
   spread profile), propagation, counter-detection, full lineage (ADP-030–033). Design the object
   model *now* so v1 doesn't preclude it, even though it ships v1.1.
9. **Telemetry, observability & tuning** (ADP-041) — every engine action logged with its trigger +
   storyline for E10 and post-exercise tuning; consumes/extends the XC-004 v0 schema.
10. **The evaluation harness** — how do we *prove* the engine is believable and safe? Voice-diversity
    checks, an injection red-team suite, latency/cost SLOs, and scenario tests ("did the world react
    correctly to action *and inaction*?").

**Resolve the epic's 3 open questions with recommendations:** (1) storyline auto-detection —
controller-seeded/pre-seeded only for v1; (2) response-matching trust curve; (3) cost/latency
envelope (from the spike).

## 3. Phase B — decompose E8 into the backlog (via the story-agent)

Once the design is settled, hand decomposition to the **`story-agent`**, following the *exact*
established pattern (feature.md + implementation.md + `NN-*.md` stories + cross-cutting ACs + GH
Epic/Feature/Story sub-issues continuing from **#126**, `phase:2`). Scope discipline:

- **v1 (Phase 2):** storylines + escalation curves; **silence escalation (ADP-001)**; **response
  reaction (ADP-002/002a)**; **amplification (ADP-004)**; **ambient chatter (ADP-005)**; **Suggest +
  Delayed-auto**; persona fidelity + governance (ADP-020–025); wire E8 into the existing E7 review
  queue (ADP-040) and dial (CTL-022); kill switch (ADP-042); tuning/telemetry (ADP-041); **and the
  cost/latency spike + the prompt-injection red-team as first-class stories.**
- **v1.1 (fast-follow):** contradiction reaction (ADP-003); rumor objects (F8.4, ADP-030–033); **Auto
  mode.** Author as `feature.md` stubs or clearly-marked v1.1 stories.
- **Phase 4:** ADP-006 (Cadence `ExpectedAction` binding) — stub.
- **Suggested feature cut (let the design refine it):** `storyline-model` · `reaction-loop` ·
  `silence-escalation` · `response-reaction` · `amplification-engine` · `ambient-chatter` ·
  `persona-voice-engine` · `generation-infra` (provider/cost/injection-hardening/governance) ·
  `autonomy-safety` · `engine-telemetry-tuning` · `rumor-model` (v1.1).

## 4. Non-negotiables to enforce in every E8 story

- **NFR-005 LLM governance** (tenant-bounded, no-training, residency) — a Phase-2 gate, not "future."
- **ADP-024 prompt-injection isolation** — untrusted data, never instructions; red-team in acceptance.
- **ADP-023 content guard** — never breaks fiction / references the real world or the exercise.
- **Autonomy safety** — never removes controller authority; never self-escalates; **auto-HOLD, not
  auto-send** (D5).
- **CTL-034 workload** — E8 *reduces* controller decisions, never multiplies them (joint E7+E8 AC).
- **XC-004 telemetry** on every engine action; **scenario-time timers** (COR-050/051).
- **Two worlds** — output publishes through the E2 *participant* pipeline; controls are the E7 *staff*
  cockpit. Generated content is attributable to a persona (XC-005) and its origin is never
  participant-visible (SOC-003).

## 5. Deliverables of the session

1. `docs/design/E8-ENGINE-ARCHITECTURE.md` (design + resolved open questions + eval harness).
2. *(Recommended)* a throwaway generation-loop prototype + measured cost/latency/voice notes.
3. `docs/features/` E8 backlog (v1 fully specified, v1.1 stubs) + `implementation.md` each.
4. GitHub **Epic E8 → feature → story sub-issues** (from #126), `phase:2`.
5. A short **"what we're betting on and the risks"** summary.

## 6. The bar (restate)

Pulse's promise is *a world that talks back* — reacting to what participants do **and fail to do** —
and doing it **correctly, believably, safely, and while reducing controller load.** Optimize for
believability, safety, and controller trust over speed of shipping. If any decision trades
believability or safety for convenience, **flag it, don't bury it.** This is the differentiator; get
it right.
