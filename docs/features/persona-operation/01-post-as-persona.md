# Story: Post as any persona into an enabled channel

**Feature:** Persona operation  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-001, COR-018  ·  **Design decisions:** none  ·  **Issue:** #14

## Context
The controller must be able to speak as the world. From the console composer, a controller posts,
replies, reposts, or DMs **as the active persona** into an enabled channel — no logging in/out per
persona (CTL-001). In Phase 1 the only enabled channel is Social, so this story is scoped to social
post/reply/repost/DM; the "any channel" surface generalizes as E4/E5/E6 land. The published content
runs through the **same E2 pipeline as any post**, so it is indistinguishable to participants; only
the telemetry knows a controller sent it (SOC-003 origin, never participant-visible). Where the
persona is an org account operated by a human, the individual human is recorded (COR-018).

## Acceptance Criteria
- [ ] Given an active persona and the social channel, when the controller submits a post, then it
      publishes through the E2 social pipeline authored by that persona (avatar/handle/verified per
      the persona) with no controller identity visible to any participant.
- [ ] The composer supports post, reply, repost/quote, and DM as the active persona (the social
      actions available to a participant, per E2).
- [ ] Given a published post, when telemetry is recorded (XC-004), then the event captures
      `origin=controller-as-persona`, the **acting human** controller id (COR-018), the persona id,
      the channel, and both wall-clock and scenario timestamps (SOC-003).
- [ ] The participant-visible post renders its time in **scenario time** in the exercise time zone
      (COR-053); wall-clock never appears in the participant view.
- [ ] Post text/media is sanitized before publish (NFR-004) — a script in the composer never
      executes in a participant session.
- [ ] The action only targets personas and channels within the controller's **active exercise**
      (COR-001); a persona from another exercise is not selectable or postable here.

## Out of Scope
News/press/weather composing (Phase 3, as those channels land); the persona picker UX (story 02);
in-composer voice context (story 03); bundle/scheduled firing (inject-queue F7.2); takedown of what
was posted (CTL-025, world-steering).

## Technical Notes
Staff world (COBRA). Reuse the **E2 compose/publish pipeline** — do not fork it; posting-as-persona
is that pipeline with a different author + `origin`. Emit via the shared telemetry emitter. Publish
endpoint is the backend-contract seam — mock behind the axios client now. See implementation.md
(story 01).

## Dependencies
Story 02 (active-persona selection) for the persona to post as; E1 persona model + COR-018
attribution; E2 social pipeline; the XC-004 telemetry emitter.

## Tests
- Unit: telemetry event for a persona post carries origin + acting-human + persona + dual time.
- Unit: scenario-time formatter renders the participant-visible timestamp; no wall-clock leak.
- Unit: sanitizer strips a stored-XSS payload from composed content.
- Component (RTL): composer publishes as the active persona; no controller identity in the rendered
  post.
