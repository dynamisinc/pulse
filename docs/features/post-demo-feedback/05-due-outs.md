# Due-outs from the 10/20 demo (tracked tasks, not build stories)

**Feature:** Post-demo customer feedback  ·  **Source:** Tom's demo notes, 10/20  ·  **Owner:** Tom unless noted  ·  **Issues:** DO1 #682 · DO2 #683 · DO3 #684

These are deliverables to the customer, not code. They have no ACs; each has a definition of done.

## PDF-DO1: Definitive upper limit of concurrent individual accounts (#682)
**Target (Tom, 10/21): prove 250 concurrent accounts.** The ramp therefore has to go past today's 100 (for example 150, 200, 250), stated per configuration.

Extends PDF-03 (#526) and the load slice [01-load-test-report.md](01-load-test-report.md) (#547).

**What the slice already proves (as built).** A .NET harness (`tools/Pulse.LoadTest`) with stop rules (error rate over 5% or
POST p95 over 5 s for 60 s), run against UAT as it is (B1 Basic, one instance, in-process SignalR, serverless SQL). Steps of 20,
40 and 100 real participant logins, 10 minutes each, each holding a SignalR connection, with white noise High, a 20-post burst
item and 120 posts/min for 2 minutes (the NFR-002 bar). It measures p50/p95/p99 and error rate per endpoint, SignalR fan-out lag
and dropped frames, plus App Service and SQL metrics.

**`docs/demo/LOAD-TEST-REPORT.md` is still an unfilled template.** The slice's run ACs are unticked (pending Tom's Saturday
10/17 run), so the repo holds tooling but no recorded measurement. Until those results are entered, there is no number.

**What is missing for a definitive number.**
- The measured results themselves (fill the report).
- A ceiling: the ramp tops out at 100 users, so a "where it breaks" figure needs steps beyond 100 (150, 200, 300...), with the
  stop rule as the definition of "limit".
- Representative hardware: UAT is B1 Basic. The limit has to be stated per configuration (SKU, scale-out, Azure SignalR Service).
- Load realism: the harness runs from one machine, which can itself cap the test; real devices and networks differ.
- The join ceiling: 30 joins/min in one global bucket means a large roster takes minutes to sign in; state it, or measure a
  simultaneous start (day-word sign-in).
- Sustained duration (a 4-hour exercise soak), serverless SQL auto-pause/scale behavior, and failure behavior at the limit.
- Multi-exercise concurrency (two exercises on one instance).

**Done when** Tom can state "N concurrent individual accounts on configuration X, under these conditions", backed by the report.

## PDF-DO2: Pulse fact sheet for the TIR submission (#683)
**Deferred until the feds make their decision** (Tom, 10/21); no work before then.

Submitted with the TIR if the feds move forward; not needed until they do. Likely source:
[`docs/ScenarioForge-Capability-Statement.md`](../../ScenarioForge-Capability-Statement.md) (sections: Overview, Core
Capabilities, Differentiators, Past Performance & Proof Points). It covers the ScenarioForge suite, so the Pulse sheet is a
Pulse-specific cut. Also draw on `docs/demo/AI-GOVERNANCE-BRIEF.md`, the 508 ACR (PDF-12) and the capacity number (DO1).
**Done when** a one to two page Pulse sheet (what it is, channels and December roadmap, isolation/security posture,
accessibility attestation status, capacity, hosting) is approved by Tom. Open: what the TIR requires and in what format.

## PDF-DO3: Dollar figures, including G&A, per requested scenario (#684)
Tom supplies the costs; **all costs are left blank here.** Scenario list confirmed by Tom, 10/21:

| # | Scenario | Notes | Cost incl. G&A |
|---|---|---|---|
| 1 | Non-AI-generated content | Human-produced videos and media instead of engine-generated | |
| 2 | Offline functionality (disconnected site) | Run Pulse in a disconnected basement and show content on a screen. Related to PDF-02 but **not** the same: this is a fully air-gapped, self-hosted deployment (server, database, realtime, media, clock, no internet or cloud dependency, install and support), not just a cached feed | |
| 3 | AI-generated content | Engine-generated content (E8), including model usage under the AI governance posture | |
| 4 | Hosting / per-exercise environment | Per-exercise environment hosting, including subdomain-per-exercise (PDF-11) | |

**Done when** each scenario has a costed line with G&A, an assumption list, and Tom's approval.
