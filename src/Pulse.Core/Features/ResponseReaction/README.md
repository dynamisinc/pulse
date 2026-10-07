# Feature: Response reaction

**Epic:** E8 — Adaptive Content Engine · **Phase:** 2 (v1) · **World:** staff / backend
**Feature doc:** `docs/features/response-reaction/` · **Design:** `docs/design/E8-ENGINE-ARCHITECTURE.md` §7 (+ adversarial review D4)
**Issue:** #132 (stories #163–#165)

How the world reacts when officials *do* respond — and, safety-critically, how it behaves when an official
post doesn't clearly address anything. Pure backend domain logic; no E2/E7 dependency. Builds on the merged
`Storylines` (`RecordMatchedResponse`), `ReactionLoop` (the decide registry + `AddressingCandidate`), and
`Generation.Models` read-only.

## The seams

| Type | Role |
|---|---|
| `Services/ResponseMatcher.cs` (#165) | Suggests which storyline an official post addresses, with a confidence (keyword/hashtag similarity to `expectation` + hashtags; verbatim hashtag = strong signal). The engine only ever *suggests*. |
| `Services/ResponseMatchTrustCurve.cs` (#165) | Rolling precision of suggestions within the exercise; **offers** an opt-in auto-confirm once precision holds over a sustained window — never self-enables (§8.2). No cross-exercise learning. |
| `Services/MissSafeResolver.cs` (#164) | **The load-bearing safety behavior.** `Resolve` classifies a candidate → Matched / NeedsConfirmation / Unmatched; `Apply` touches the silence clock **only** on a genuine match (unmatched is never treated as silence — the anti-berate-the-PIO invariant); `Slow` cools escalation by a factor **never to zero** (slows, never pauses). Off-platform marker is the identical satisfier. |
| `Services/ResponseReactionBehavior.cs` (#163) | The `IReactionBehavior` for `OfficialResponse`: a tunable gratitude + follow-up + one-skeptic reaction intent. |
| `Models/MatchModels.cs` | `MatchSuggestion`, `MatchKind`, `MatchResolution`. |

## Design decisions worth knowing

- **Miss-safe is structural** (ADP-002a): only `MatchKind.Matched` ever reaches `RecordMatchedResponse`
  (reset clock + bend down + →ADDRESSED). Unmatched/NeedsConfirmation leave the silence clock untouched, so
  an irrelevant post can neither pause escalation nor falsely satisfy a concern.
- **The engine never raises its own match-autonomy** — the trust curve *offers*; a controller opts in.
- **The match stops escalation automatically**: once addressed, the storyline leaves the unaddressed phases,
  so `ObserveStage` stops raising the inaction trigger (hand-off from silence-escalation).

## Status

| Story | State |
|---|---|
| 01 Matched-response reaction (#163) | Done (decide-stage policy + storyline bend) — `ResponseReactionBehavior` + `MissSafeResolver.Apply`. Voiced live as a burst of `DefaultBurstSize` (3) through the loop's generate → review → publish path, with the #173 telemetry, by `engine-runtime/06` (#415). |
| 02 Miss-safe unmatched default (#164) | Done — `MissSafeResolver` (slow-not-pause, never-silence, anti-gaming). The controller-prompt UI is the E7 cockpit; telemetry deferred (#173). |
| 03 Match suggestion + trust curve (#165) | Done — `ResponseMatcher` + `ResponseMatchTrustCurve`. Prompt/opt-in UI is the cockpit; precision logging deferred (#173). |

Registered against `ReactionLoop.DecideStage` for the `OfficialResponse` trigger; consumes off-platform
markers (CTL-026) as identical satisfiers.

**Live wiring (`engine-runtime/06`, #415).** `Pulse.WebApi`'s `ReactionLoopDriver` registers
`ResponseReactionBehavior` on its `DecideStage` and feeds `ObserveStage` the participant posts that
`PostIngestService` queued since the last tick (its `IAddressingInbox`). Each post goes through
`MissSafeResolver.Resolve` against the exercise's `ResponseMatchTrustCurve`, which is off unless the
operator's seed request opts in. A match is applied before the tick's inaction triggers are decided, so an
addressed storyline is voiced once, as a response, and never also as silence on the same tick; only the answer
that moves it to Addressed draws that burst. `Slow` is applied by the host to the storyline's next escalation
burst, not the tick's: an unconfirmed or unmatched post leaves a pending slow that the next burst spends
(or a match removes), because posts land between bursts far more often than on them.
