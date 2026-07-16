# Story: Engine repost / quote / react to spread

**Feature:** Amplification engine  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-004  ·  **Design decisions:** none  ·  **Issue:** #166

## Context
Engine personas repost, quote-post, and react to selected content so it spreads believably (ADP-004)
— the Looking Glass "many voices repeat the same event" pattern, automated and reactive. It uses the
**same E2 amplification substrate** (#85) as any participant repost/quote, so the spread chain is
fully reconstructable from telemetry (the raw material for E10 and, in v1.1, rumor lineage).

## Acceptance Criteria
- [ ] Given a piece of content the engine should spread, when it amplifies, then engine personas
      repost/quote/react to it via the **E2 amplification pipeline** (#85) — not a parallel mechanism.
- [ ] Given a quote-post, when generated, then it carries a persona-voiced comment (persona-voice-engine)
      and links to the amplified post (the E2 amplification chain, SOC-022).
- [ ] Given amplification, when it happens, then which personas amplified, when, and in what order is
      captured via E2 telemetry so the spread chain is reconstructable (feeds E10; v1.1 rumor lineage
      reserves `mutationOf`).
- [ ] Given a bad-actor persona, when it would amplify, then it participates only if scenario-enabled
      (persona-voice-engine story 03).
- [ ] **LLM governance (NFR-005/ADP-024) + content guard (ADP-023):** quote-post text via the
      tenant-bounded provider with isolation; never breaks fiction. **Telemetry (XC-004):** amplification
      emits engine events; **Content security (NFR-004):** quote text sanitized on publish. Staff-only
      origin (SOC-003).

## Out of Scope
Spread velocity + trend push (story 02); the E2 repost/quote mechanics themselves (#85 owns them —
this drives them); rumor mutation (rumor-model, v1.1 — this reserves the `mutationOf` hook).

## Technical Notes
Staff/backend. Registers a decide-stage policy: "amplify content C via N personas." Publishes through
E2 amplification (#85). The `mutationOf` link is reserved on quote-posts for v1.1 rumor lineage
(architecture §10.1 schema-now note). See implementation.md (story 01) and architecture §6.2/§10.

## Dependencies
reaction-loop (decide/generate/publish); E2 amplification (#85); persona-voice-engine (quote voice +
eligibility); storyline-model (what to amplify). Feeds story 02 + E10 + rumor-model (v1.1).

## Tests
- Unit: engine amplification uses the E2 repost/quote pipeline and records the chain.
- Unit: a quote-post carries voiced comment + link; bad-actor amplification gated by scenario
  enablement.
