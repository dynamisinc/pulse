# D6 — Design Brief: Evaluator Dashboard & Replay

> Epic: `../10-evaluation-aar.md` · Anchors: **Cadence evaluation views** (observations, EEG, P/S/M/U vocabulary) + analytics dashboards evaluators already read + a **video-scrubber** mental model for Replay. Staff world, but calmer than D5: analytical, chart-forward, unhurried.

## Purpose & users

Evaluators watch everything without touching anything (COR-013). Two modes: **live** (during conduct — situational awareness + moment capture) and **after** (hotwash + formal AAR — replay + metrics). Cadence evaluators must feel at home; Pulse supplies evidence, Cadence takes the scores (E10 §1 boundary).

## Key screens

1. **Live dashboard** (EVL-022): storyline board (intensity/sentiment tiles, response-latency tickers, unaddressed-concern indicators), live timeline stream, and the read-only world view alongside. The `#WaterIssues`-amber-for-40-minutes moment (E10 §3) is the design target: state legible at a glance across the room.
2. **Annotation capture** (EVL-020): bookmark any moment/content in ≤10 seconds — note + category chip, keyboard-friendly. Cadence observation-capture philosophy applied here; push-to-Cadence affordance when linked (EVL-021).
3. **Timeline explorer** (EVL-001/002): filterable, searchable, deep-links into content in-situ. Per-human attribution visible behind shared org accounts (COR-018).
4. **Replay — the marquee** (EVL-003): video-scrubber interaction over the exercise; feeds/portal render as they appeared (ordering exact; derived state snapshot-labeled). Scenario-time jumps as labeled discontinuities on the scrub bar. Invest in scrub fluidity — this is the single best demo of "everything observable is measurable," and it runs on a projector at hotwash 30 minutes after EndEx (EVL-033). **Participant-visible hotwash mode:** staff overlays (dial events, origins) hidden (EVL-014).
5. **Metrics views** (EVL-010…014): latency tables, coverage/missed-opportunities (with the confirm-before-AAR workflow — unconfirmed items visually provisional), reach/traction, misinformation spread tree, sentiment trajectory **with scenario-design-input overlays** (dial events as a distinct visual layer — the defensibility feature).
6. **AAR export** (EVL-030/031): one-click package; progress + contents manifest.

## States to design

- Live-quiet · live-storm · post-EndEx hotwash (replay on projector) · formal review (metrics + annotations) · pre-E8 exercise (engine metrics gracefully absent, EVL-015 — no fake numbers, no empty-chart shame).

## Constraints & cues

- WCAG 2.1 AA applies fully to evaluator surfaces (NFR-001); charts need non-color encodings.
- Session-level vs. person-level evidence labeling on view-derived metrics (EVL-012) — a visible epistemic honesty cue, not fine print.
- Shares the COBRA staff design system with D5 but lower density; an evaluator is reading, not operating.

## Anti-patterns

Dashboard-vendor maximalism (20 widgets nobody reads); burying the annotate action; replay as a log table (it must *feel* like scrubbing the exercise); charts that imply participant blame for controller-dialed effects (EVL-014 exists precisely to prevent this).
