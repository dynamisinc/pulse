# E9 — Ecosystem Integration (Cadence · Beat · COBRA)

> **Epic ID:** E9 · **Requirement prefix:** INT
> **Depends on:** E1, E7 (surfaces the integrations); touches all channels
> **Roles served:** Planners, Controllers, Exercise Directors; indirectly everyone
> **Looking Glass parity target:** none — Looking Glass is an island. Triad integration is a decisive competitive advantage.

## 1. Epic summary

Pulse as a connected citizen of the ScenarioForge triad: Cadence plans and conducts the exercise; Beat manufactures the media; Pulse is where the public information environment plays out. This epic defines the seams — inject delivery from Cadence into Pulse channels, the Beat asset pipeline, the shared exercise clock, and the telemetry Pulse emits back for evaluation.

Positioning note (per the Cadence overview): companion products should **enrich conduct without duplicating the MSEL or evaluation core**. Pulse therefore does not re-implement MSEL authoring, EEG scoring, or AAR document generation — it delivers stimuli and returns evidence.

## 2. Features & requirements

### F9.1 Cadence → Pulse inject delivery

| ID | Requirement |
|---|---|
| INT-001 | A Cadence exercise can be linked to a Pulse exercise instance (one-to-one at launch); linkage is a planner action requiring authority in both systems. |
| INT-002 | Pulse channels register as Cadence **delivery methods** via the extensible `DeliveryMethodLookup` (e.g., `Pulse: Social Post`, `Pulse: News Article`, `Pulse: Press Release`, `Pulse: Weather Product`, `Pulse: Alert`) — deliberately aligned with Cadence's enum→lookup migration; reference the lookup, never the legacy enum. **Named external dependency:** Cadence's enum→lookup migration is mid-flight (Cadence overview §12); checkpoint its status before Phase 4 story commitment. |
| INT-003 | A Cadence inject with a Pulse delivery method carries a **content payload** (channel-specific: persona/source, body, media refs, channel fields). Payload authoring happens in Pulse's composers, linked from the Cadence inject (deep link both directions); the MSEL remains the scheduling/approval source of truth. |
| INT-004 | When the inject **fires** in Cadence (manual or clock-driven), Pulse publishes the payload's *metadata and text* to the target channel within 2 seconds (video/media may finish async behind a placeholder), and reports publication (with dual-time capture) back to the inject's conduct record. Delivery failure: retry with backoff + dead-letter + immediate controller alert (NFR-003) — never a silent drop. |
| INT-005 | Fire/skip/defer semantics map cleanly: skipping in Cadence leaves Pulse content unpublished; deferring reschedules it. Pulse's own queue (CTL-010) shows Cadence-sourced items with inject number and MSEL context (CTL-012). **Single fire authority:** Cadence-sourced items are locked in Pulse (no edit-then-fire, no independent fire) unless a controller explicitly takes local control — an audit-logged action that releases the item from Cadence authority and reports the transfer back. Prevents the dual-console race (two people, two consoles, one inject). |
| INT-006 | **Standalone mode is first-class:** every Pulse capability must function without a linked Cadence exercise (native scheduler per CTL-013, native clock per COR-050). Cadence linkage adds MSEL traceability; it is never a prerequisite. |

### F9.2 Shared exercise clock

| ID | Requirement |
|---|---|
| INT-010 | **The exercise clock is native to Pulse (COR-050, Phase 1); Cadence linkage swaps the provider.** When linked, Cadence's clock (start/pause/reset, scenario time) drives the same interface every subsystem already consumes — scenario timestamps (SOC-003), weather timeline (WX-002), scheduled content, E8 timers — and a Cadence pause pauses the world (CTL-023). Clock-subscription loss: holdover on last-known state + controller alert (NFR-003). |
| INT-011 | Scenario-time jump/suspension semantics (COR-051/052) must reconcile with Cadence's `ScenarioDay`/`ScenarioTime` model when linked; jumps initiated in either system propagate to the other. |

### F9.3 Beat → Pulse media pipeline

| ID | Requirement |
|---|---|
| INT-020 | Pulse composers (social, article, release, weather) include a **Beat asset picker**: browse/search the exercise's Beat-produced media (video, images, audio) and attach without download/re-upload. |
| INT-021 | Beat assets carry metadata (scenario tags, intended persona/outlet, produced-for-inject ref) that pre-fills composer context. |
| INT-022 | A Beat "publish to Pulse" flow: from Beat, push an asset to a Pulse exercise's asset library (and optionally straight into a draft post/article for a chosen persona). |
| INT-023 | Video delivery: Beat videos stream inline in E2 posts and E4 articles (the Utube-descope path); transcode/packaging responsibilities land on the pipeline, not the channels. |
| INT-024 | Persona avatars/profile imagery can be Beat-sourced (COR-024 hook). |

### F9.4 Pulse → evaluation telemetry (Cadence-facing)

| ID | Requirement |
|---|---|
| INT-030 | For Cadence-fired injects, Pulse returns **response evidence**: qualifying participant actions linked to the inject (e.g., the PIO's release addressing it, response latency, engagement summary, off-platform response markers per CTL-026) — attachable context for evaluator Observations/EEG entries in Cadence. Pulse computes and transmits; scoring stays in Cadence. |
| INT-031 | Pulse exposes an exercise event stream (webhook/queue) — content published, participant actions, storyline/sentiment changes — consumable by Cadence dashboards or other exercise systems (MSEL-adjacent tooling per the vision doc §9). Schema per the telemetry event schema v0 deliverable (XC-004). |
| INT-032 | AAR export alignment: Pulse's E10 export package is designed to slot into Cadence's AAR package structure (complementary artifacts, no duplicated authoring). |

### F9.5 COBRA (exploratory, design-for not build-now)

| ID | Requirement |
|---|---|
| INT-040 | The event contracts above (INT-031) must be product-agnostic enough that COBRA/C5 actions (EOC activation, public alert issuance) could later trigger Pulse storyline events, and Pulse activity could feed COBRA as an inject/intel stream. No COBRA build commitment in this epic — contract shape only. |

## 3. User experience

**Planning, joined-up.** The planner builds the MSEL in Cadence. Inject #47: "News article — Emergency Call Delays," delivery method `Pulse: News Article`, scheduled scenario-hour 3. Clicking "author content" deep-links into Pulse's article composer with the outlet pre-selected; they write the article, grab the Beat anchor-desk clip from the asset picker, and save. Back in Cadence, #47 shows a green "content ready" state, goes through MSEL review like any inject, and is locked with the rest.

**Conduct, one fire.** At scenario-hour 3 the inject auto-readies; the controller confirms fire in Cadence (single fire authority — the Pulse queue shows it locked with a "take local control" escape hatch, INT-005). The article publishes, the outlet's social account posts the link, the portal features it. The conduct record captures dual time. Twenty minutes later, Cadence's inject view shows Pulse evidence: PIO viewed at +4m, press release published at +19m — right where the evaluator is writing the EEG entry.

**Selling it.** This flow — MSEL to fired multi-channel media moment to evaluation evidence with zero swivel-chair — is the triad demo. No competitor shows that today.

## 4. Out of scope

MSEL authoring/approval in Pulse, EEG/observation capture in Pulse (E10 telemetry ≠ scoring), COBRA implementation, multi-Cadence-exercise → one Pulse world mapping (revisit with multi-MSEL roadmap).

## 5. Open questions

1. ~~Identity federation~~ **Resolved:** Phase 1 staff auth = Dynamis IdP directly; Cadence session federation arrives with this epic (Phase 4); participants stay Pulse-native (COR-014/015).
2. Where does inject content approval live when content is authored in Pulse but approved in Cadence's workflow? (Recommend: Cadence approves the inject; Pulse locks the payload upon Cadence approval — consistent with COR-044 and INT-005.)
3. Transport/contract specifics (REST + webhook vs. queue) — technical spike; keep out of story scope until contracts are drafted.
