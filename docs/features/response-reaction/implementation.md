# Implementation: Response reaction

> The ADP-002/002a behaviors: calm-the-crowd on a match, slow-not-pause on an unmatched post, and the
> suggestion→trust-curve toward auto-match (open Q2). Built on the reaction loop. Backend .NET absent.

## Per-story tech notes

| Story | Approach | Key files it will own | Exports (the seam others import) |
|-------|----------|-----------------------|----------------------------------|
| 01 Matched-response reaction | Decide-stage policy: match event → gratitude/follow-up/skeptic intent; bend intensity down. | `services/behaviors/response/matchedPolicy` | matched-response behavior policy |
| 02 Miss-safe unmatched default | Slow all active escalation, never pause, never silence; prompt Y/N. | `services/behaviors/response/missSafe` | `onUnmatchedOfficial()` → slow + prompt; the "unmatched ≠ silence" contract silence-escalation reads |
| 03 Match suggestion + trust curve | Similarity suggest + confidence; rolling precision; per-exercise auto-match opt-in. | `services/behaviors/response/matchSuggest` | `suggestMatch(post) → {storyline, confidence}`; precision tracking |

## Reuse map
- **`reaction-loop`** — decide (policy registry), generate/publish/measure.
- **`storyline-model`** — `expectation` + hashtags (matching), decay/ADDRESSED transition.
- **`persona-voice-engine`** — voiced mixed-tone reactions.
- **off-platform marker (#29)** — an identical satisfier (matched-response event).
- **`silence-escalation`** — consumes the "unmatched ≠ silence" contract (story 02).
- **console-shell NEEDS-YOU + engine-review-cockpit** — surfaces the Y/N match prompt + the trust-curve opt-in.
- Telemetry emitter (`XC-004`) — match suggestions/confirmations/precision, `storyline.state_changed`; feeds E10 latency/coverage.

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 03 Match suggestion + trust curve | response/matchSuggest | storyline-model (expectation) | 02 | 1 | M |
| 02 Miss-safe unmatched default | response/missSafe | reaction-loop, silence-escalation, 03 (suggestion) | — | 2 | M |
| 01 Matched-response reaction | response/matchedPolicy | reaction-loop, storyline-model, 02/03 | — | 3 | M |

Suggestion (03) first — it produces the match the others act on. Miss-safe (02) is the safety-critical
default that must exist before matched-reaction (01) is trusted. All three plug into the reaction-loop
registry; the "unmatched ≠ silence" contract is a serial edge shared with silence-escalation.
