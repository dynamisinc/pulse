# Story: Generate → review → publish wiring

**Feature:** Reaction loop  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** F8.1, ADP-040  ·  **Design decisions:** none  ·  **Issue:** #159

## Context
The stage that turns an intent into published (or queued) content: call the generation infra
(engine-generation-infra) with the voice engine's burst (persona-voice-engine), pass it through the
pre-review guard, route it per autonomy level into the E7 review cockpit (#34–36) or a Delayed-auto
countdown, and on approval/auto-send publish it through the **E2 pipeline as a persona-authored
post** with origin hidden (SOC-003).

## Acceptance Criteria
- [ ] Given a generation intent, when the generate stage runs, then it produces a burst via the
      generation infra + voice engine, guard-filtered (engine-generation-infra story 03) before any
      human sees it.
- [ ] Given **Suggest**, when a burst is ready, then it lands in the E7 review queue (#34) with
      per-item persona + storyline context; nothing publishes without approval.
- [ ] Given **Delayed-auto**, when a burst is ready, then it publishes after a scenario-time countdown
      **unless a controller vetoes** — and on timeout it **auto-HOLDs, never auto-sends**
      (autonomy-safety story 02 / D5-014/1.1), surfacing in NEEDS YOU.
- [ ] Given an approved/edited/auto-sent burst, when it publishes, then each post goes through the
      **E2 pipeline** authored by its persona (XC-005), sanitized on the edit path (NFR-004), with
      origin (`engine`/`engine-edited`) recorded but **never participant-visible** (SOC-003).
- [ ] **Telemetry (XC-004):** `engine.generated` (draft, model, usage, guard result) and
      `engine.published` (post ref, origin, storyline) events are emitted.
- [ ] **Content security (NFR-004):** edited drafts are sanitized before publish; a stored script
      never executes in another session.

## Out of Scope
The intent formation (story 02); the measure stage (story 04); the review-queue UI + auto-HOLD/
swamped mechanics (engine-review-cockpit #34–36 + autonomy-safety own them — this story *routes into*
them); the E2 post rendering (E2).

## Technical Notes
Staff/backend. This is the integration seam between E8 and the existing Phase-1 cockpit (#34–36) +
E2 publish pipeline. Delayed-auto countdown runs in scenario time. The guard (engine-generation-infra
story 03) is mandatory pre-review. See implementation.md (story 03) and architecture §1.2/§2.

## Dependencies
engine-generation-infra (generate + guard); persona-voice-engine (burst + diversity gate);
autonomy-safety (levels + auto-HOLD); engine-review-cockpit (#34–36, review target); E2 publish
pipeline; engine-telemetry-tuning.

## Tests
- Unit: Suggest routes to the queue; Delayed-auto publishes on countdown unless vetoed and auto-HOLDs
  on timeout (default config).
- Unit: publish authors as the persona via E2 with origin hidden; edited drafts are sanitized;
  `engine.generated`/`engine.published` emitted.
