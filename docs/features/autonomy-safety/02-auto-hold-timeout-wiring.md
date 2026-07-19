# Story: Auto-HOLD-on-timeout wiring (never auto-send)

**Feature:** Autonomy & safety  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Complete
**Requirements:** ADP-040  ·  **Design decisions:** D5-014/1.1 (supersedes D5-005)  ·  **Issue:** #170

> **Status: Complete.** Delivered as the pure `AutoHoldPolicy` over `(DelayedAutoCountdown, EffectiveAutonomy,
> current scenario minute, swamped) → {Hold | Publish | AwaitDecision}`. Silence resolves to HOLD; swamped
> mode is the only auto-send path and is suspended by any safety clamp. Covered by `AutoHoldPolicyTests`
> (incl. freeze / time-jump).

## Context
Safety-critical, and the exact behavior E8 must produce for the Phase-1 cockpit (engine-review-cockpit
#35). When a Delayed-auto draft's scenario-time countdown expires **with no controller decision**, the
draft **auto-HOLDs** ("timer expired — held for you", surfaces in NEEDS YOU) — it does **not**
auto-send. *Silence is never approval.* The **only** path to timeout auto-send is the explicit,
lead-controller-gated **swamped mode** (engine-review-cockpit #36). E8 produces the timed drafts;
the cockpit consumes them — the terminal action must be HOLD in the default configuration.

## Acceptance Criteria
- [x] Given a Delayed-auto draft, when its scenario-time countdown reaches zero **without** a
      controller decision, then the draft moves to **HELD** (not published) with a "timer expired —
      held for you" state and surfaces in the NEEDS-YOU bar. *(`Decide` → `Hold`; `DraftDisposition.Held`,
      `EngineReviewItem.NeedsController`.)*
- [x] Given the default configuration, when any timed draft expires, then **no draft is ever
      auto-published on timeout** — verified; the only timeout-auto-send path is swamped mode (#36).
      *(`AutoHoldPolicyTests.OnExpiry_WithNoDecision_AutoHolds` + time-jump variant.)*
- [x] Given swamped mode is enabled (lead-controller-gated, #36), when a timed draft expires, then it
      auto-sends within existing rate caps instead of holding — and only then. *(swamped && effective ==
      DelayedAuto is the sole `Publish`-on-expiry branch.)*
- [x] Given the engine, when it operates, then it **never turns swamped mode on by itself** — the
      autonomy level does not self-escalate. *(`SetSwampedMode` is the only flip; no automation path sets it.)*
- [x] **Telemetry (XC-004):** the expiry→HOLD (or, under swamped mode, expiry→auto-send) transition is
      logged with trigger + storyline + scenario time; the held item feeds the NEEDS-YOU to-dos.
      Countdown/expiry state is conveyed by text/number, not color alone (NFR-001). *(`AutoHoldPolicy.Evaluate`
      returns `DraftTimeoutResolved`; `DelayedAutoCountdown.MinutesRemaining` is numeric.)*

## Out of Scope
The swamped-mode toggle itself (engine-review-cockpit #36 owns it — this story honors it); the review
queue UI (#34/#35 own the rendering — this produces the timed draft + terminal action); the autonomy
levels (story 01).

## Technical Notes
Staff. The timer's terminal action is HOLD; the send path is gated behind the swamped-mode flag (#36),
off by default. This is E8's contract with engine-review-cockpit stories 02 (#35) + 03 (#36). See
implementation.md (story 02), architecture §8.2, and D5 `STORY-UPDATES.md` §A (ADP-040) + §C RECONCILE.

## Dependencies
Story 01 (Delayed-auto level); engine-review-cockpit #35 (HELD state + NEEDS-YOU) + #36 (swamped-mode
flag, the only auto-send path); E1 clock (countdown); reaction-loop (produces the timed draft).

## Tests
- Unit: a countdown expiring with no decision sets HELD and does not publish (default config).
- Unit: with swamped mode on, expiry auto-sends within caps; the engine never enables swamped mode
  itself; the transition logs.
