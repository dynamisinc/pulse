# E10 — Evaluation & AAR

> **Epic ID:** E10 · **Requirement prefix:** EVL
> **Depends on:** E1 telemetry foundation (XC-004); consumes events from all channels, E7, E8, E9
> **Roles served:** Evaluators (primary), Exercise Directors, Controllers (post-ex), Planners (next-ex design)
> **Looking Glass parity target:** none visible — Looking Glass offers no evident evaluation layer. Another differentiator.

## 1. Epic summary

"Everything observable is measurable." Pulse's participant surface is a social feed; its evaluator surface is a data stream. This epic turns the telemetry every other epic emits (XC-004) into evaluation value: a reconstructable timeline of the information environment, response-performance metrics, sentiment and spread analytics, live evaluator annotation, and an AAR export package that complements (never duplicates) Cadence's EEG/AAR core.

Boundary discipline: **Pulse measures the information environment; Cadence scores the humans.** P/S/M/U ratings, EEG entries, and observations live in Cadence. Pulse supplies the evidence that makes those ratings fast and defensible.

## 2. Features & requirements

### F10.1 The timeline (foundation)

| ID | Requirement |
|---|---|
| EVL-001 | A complete, ordered exercise timeline of every information-environment event: content published (all channels, all origins), participant actions (posts, releases, DMs, views — attributed to the individual human incl. behind shared org accounts, COR-018), controller actions (fires, steers, vetoes, takedowns, off-platform markers), engine actions (E8 triggers/generations), alerts, storyline state changes — each with dual time and actor. |
| EVL-002 | Timeline is filterable (channel, actor, origin, storyline, hashtag, time range) and searchable; any item deep-links to the content in-situ. |
| EVL-003 | **Replay mode:** step or scrub through the exercise chronologically. Fidelity contract (honest, not over-promised): **event ordering and content are guaranteed exact**; derived state shown in replay (trending lists, engagement counts, alert-bar state, storyline intensity) renders from **periodic snapshots** (≤60s interval) and is labeled as snapshot-approximate. Layout is approximate to the current UI, not pixel-faithful to the moment. Takedown-removed content (CTL-025) never re-renders. Replay handles scenario-time jumps (COR-051) as labeled discontinuities on the scrub bar. |
| EVL-004 | Timeline access is staff-only (evaluator read, per COR-013) and is available live during conduct, not just after. |

### F10.2 Response metrics

| ID | Requirement |
|---|---|
| EVL-010 | **Response latency:** for each storyline/inject with an expected response, measure emergence → first official acknowledgment → substantive response (posts and/or releases, **including off-platform responses recorded via CTL-026**), in wall and scenario time. Approval-gate latency (PRS-021) is measured separately when enabled. |
| EVL-011 | **Coverage:** which public concerns (storylines, trending topics) received official response vs. went unaddressed — a missed-opportunities list generated automatically, but **each auto-flagged miss requires evaluator/controller confirmation before appearing in the AAR export** (protects against off-platform blindness producing false findings; unconfirmed items export as "flagged, unconfirmed"). |
| EVL-012 | **Reach & traction:** for official content — impressions proxy, engagement, amplification vs. the surrounding noise; answers "did the message land or get drowned out?" Reach computes over the audience-magnitude model (SOC-054). View/dwell-derived metrics are labeled **session-level evidence, not person-level proof** (shared screens/projectors). |
| EVL-013 | **Misinformation containment:** per rumor (ADP-032) — spread tree size/velocity, time-to-counter, post-counter decay. |
| EVL-014 | **Sentiment trajectory:** exercise-wide and per-storyline sentiment over time (ADP-012 signal) with participant actions overlaid — the correlation view (did the 13:41 release bend the curve?). **Defensibility requirement:** engine configuration and controller dial events (curve assignments, escalation-dial changes, autonomy shifts) render as overlays on every sentiment/intensity chart and export in the AAR as "scenario design inputs," distinct from participant-driven signal — an evaluator must never attribute a controller-dialed mood shift to participant performance. These overlays are **evaluator-facing only** and are excluded from any participant-visible hotwash replay (don't show trainees the puppet strings mid-lesson). |
| EVL-015 | Pre-E8 exercises degrade gracefully: metrics that depend on engine constructs (storylines, rumors, sentiment) compute from controller-tagged equivalents or are marked unavailable — no fake numbers. |

### F10.3 Evaluator tools

| ID | Requirement |
|---|---|
| EVL-020 | Live annotation: evaluators bookmark/tag any timeline moment or content item with a note and category (e.g., "strong correction," "missed rumor") — capturing judgment in the moment, Cadence-photo-capture philosophy applied to the info environment. |
| EVL-021 | Annotations are exportable and included in the AAR package; when Cadence is linked, an annotation can be pushed as context to a Cadence Observation (INT-030 channel). |
| EVL-022 | Evaluator dashboard during conduct: live storyline board, response-latency tickers, unaddressed-concern alerts — evaluation situational awareness parallel to the controller's CTL-030 board. |

### F10.4 AAR export

| ID | Requirement |
|---|---|
| EVL-030 | One-click AAR package export per exercise: timeline (data + readable document), metrics report (EVL-010…015 with charts, including scenario-design-input overlays per EVL-014), annotated moments, content archive (all published content with media; takedowns logged, content not republished), rumor/storyline post-mortems. |
| EVL-031 | Formats: machine-readable (JSON/CSV) + presentation-ready document; structured to slot alongside Cadence's AAR ZIP (INT-032). |
| EVL-032 | Archived exercises retain full timeline/replay integrity per COR-006; retention windows are org-configurable (records/PII posture per NFR-007). |
| EVL-033 | **Hotwash latency:** replay and core metrics (latency, coverage, sentiment) are available ≤15 minutes after EndEx (COR-054) — hotwash starts ~30 minutes after EndEx, not the next morning. Full AAR package export may take longer; the hotwash set may not. |

## 3. User experience

**During conduct.** The evaluator sits with two screens: the live world (read-only participant view) and the evaluator dashboard. The `#WaterIssues` storyline tile has been amber for 40 minutes — "no official response." When the release finally lands, the latency ticker freezes at 68 minutes and the sentiment line starts bending. The evaluator bookmarks the moment: "Response solid once issued — detection was the failure." Ten seconds of work; permanently in the record.

**The hotwash.** Thirty minutes after EndEx, the director opens Replay on the big screen and scrubs to 13:05: "Here's the first water post. Watch the room's feed for the next hour." Participants watch the vacuum fill in fast-forward — speculation, the false boil-water notice, the trust erosion — then the release land and the crowd turn. No slide deck; the exercise explains itself. (The engine-dial overlays stay hidden in this participant-visible mode, per EVL-014.)

**The formal AAR.** The evaluation lead exports the package: latency table per storyline (off-platform responses included, confirmed misses only), the misinformation spread tree as a chart, sentiment trajectory with annotated action markers and scenario-design inputs distinguished. Findings that once took a week of reconstructing screenshots are attached as evidence to the Cadence EEG entries the same afternoon.

**Design notes.** Analytical, calm, chart-forward staff surfaces (shares the E7 staff design system; NFR-001 applies to evaluator surfaces). Replay is the marquee feature — invest in making scrubbing fluid; it's also the single best sales demo of "everything observable is measurable."

## 4. Out of scope

P/S/M/U scoring, EEG structures, observation management, and AAR *document authoring* (all Cadence); cross-exercise benchmarking analytics (future); participant-visible analytics of any kind.

## 5. Open questions

1. ~~Impressions modeling~~ **Partially resolved:** reach computes over the audience-magnitude model (SOC-054); the specific formula still needs a definition workshop before metric stories are written.
2. ~~Replay fidelity~~ **Resolved (adversarial review D7):** ordering/content exact, derived state snapshot-approximate and labeled (EVL-003).
3. Participant-visible hotwash replay mode: facilitated, post-EndEx only, with staff overlays hidden (EVL-014) — needs a controlled design pass, but the direction is set.
