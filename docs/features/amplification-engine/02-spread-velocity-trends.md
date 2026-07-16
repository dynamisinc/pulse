# Story: Spread velocity + organic trend push

**Feature:** Amplification engine  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-004, SOC-054, SOC-041  ·  **Design decisions:** none  ·  **Issue:** #167

## Context
Amplification velocity is **shaped by storyline intensity and audience magnitude** (SOC-054): a
high-intensity storyline with large-audience personas spreads fast; a low-intensity one trickles.
This is also how the engine **organically pushes trends** (SOC-041) — by biasing input weight through
real amplification, never by fabricating a trend (SOC-041's "never manually declared" rule holds; the
controller boost-weight lever is the only manual bias, logged as steering).

## Acceptance Criteria
- [ ] Given a storyline's intensity + the amplifying personas' audience magnitudes (SOC-054), when the
      engine amplifies, then spread **velocity** (rate + reach of reposts/quotes) scales with them.
- [ ] Given amplification, when it drives trend signals, then trends remain **organically computed**
      (SOC-041) — the engine increases genuine amplification, it does **not** fabricate or manually
      declare a trend.
- [ ] Given rising amplification on a storyline, when measured, then it **bends storyline intensity
      up** (storyline-model story 02) — spread feeds back into the state.
- [ ] Given rate caps (ADP-011), when amplification would exceed `maxEnginePostsPerMinute`, then it is
      throttled — amplification counts against the cap.
- [ ] **Telemetry (XC-004):** velocity/spread events are logged (feeds E10 spread metrics + v1.1 rumor
      spread profile); staff-only (XC-002). Trends never surface as anything but organic to
      participants (SOC-041).

## Out of Scope
The repost/quote mechanics (story 01); the controller boost-weight UI (world-steering/hashtags-trending
own it — this respects it); rumor spread profiles (rumor-model, v1.1 — this is the substrate they use).

## Technical Notes
Staff/backend. Velocity = f(intensity, audience magnitude), bounded by rate caps. Trend push is
emergent from real amplification (SOC-041) — no fabricated trends. The v1.1 rumor `spreadProfile`
(velocity curve + reach ceiling) builds directly on this. See implementation.md (story 02) and
architecture §6.2/§10.

## Dependencies
Story 01 (amplification mechanics); storyline-model (intensity in + intensity-up out); SOC-054
audience magnitude; hashtags-trending (SOC-041); rate caps (storyline-model story 04). Feeds E10 +
rumor-model.

## Tests
- Unit: velocity scales with intensity + audience magnitude; amplification is throttled by the rate
  cap; rising amplification bends intensity up.
- Unit: trend push is organic (no fabricated/declared trend); spread events logged.
