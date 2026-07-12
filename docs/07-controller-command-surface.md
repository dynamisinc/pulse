# E7 — Controller Command Surface

> **Epic ID:** E7 · **Requirement prefix:** CTL
> **Depends on:** E1; operates E2/E4/E5/E6 · **Gated by it:** E8 human-in-the-loop, E9 inject firing UX
> **Roles served:** Controllers, Exercise Directors; Evaluators share read-only portions
> **Looking Glass parity target:** whatever LG's back office is — plus substantial improvement; this is a primary competitive edge

## 1. Epic summary

The hidden engine: a staff-only console from which controllers operate the entire simulated world — posting as any persona across any channel, firing queued injects, steering trends, escalating or calming the public, and monitoring participant activity in real time. Participants never see any of this; the console is visually and architecturally separate from the simulation (dark staff chrome, per E1).

The design bar: **one controller must be able to run a believable world.** Most exercises have one or two SimCell staff, not a room of them. Speed of persona-switching and content dispatch is the core UX metric (see CTL-034 workload budget).

## 2. Features & requirements

### F7.1 Persona operation

| ID | Requirement |
|---|---|
| CTL-001 | Post as any persona in the exercise into any enabled channel (social post/reply/repost/DM, news article, press release, weather product) from one console — no logging in/out per persona. *Phasing note: all "any channel" CTL requirements apply per enabled channel as channels land (Phase 1 = social only; E4/E5/E6 targets activate in Phase 3).* |
| CTL-002 | Fast persona switching: searchable persona picker with type filters, recents, and pinned favorites; target ≤3 seconds from "need to answer as Fulton County EM" to composing. |
| CTL-003 | Composer shows persona context while writing: voice/personality notes (COR-020), recent posts, audience magnitude — so a persona stays in character across controllers. |
| CTL-004 | Multi-controller safety: presence indicators show who is operating which persona; simultaneous operation is allowed but visible (SignalR presence, same pattern as Cadence review). |
| CTL-005 | Mid-exercise persona creation per COR-022, launchable from the picker ("+ New persona"). |

### F7.2 Inject queue & timeline

| ID | Requirement |
|---|---|
| CTL-010 | A conduct timeline lists pre-authored Pulse content (posts, articles, releases, weather products) in scheduled order with status (pending / ready / fired / skipped / held), mirroring Cadence's MSEL conduct vocabulary. |
| CTL-011 | Fire / hold / skip / edit-then-fire per item, single and batch. Firing captures wall + scenario time (dual time, Cadence convention). Edit-then-fire does not apply to Cadence-locked items (INT-005). |
| CTL-012 | Items sourced from Cadence (E9) render with their inject number, MSEL context, and expected action — controllers see *why* this content exists. Cadence-sourced items are fire-locked in Pulse except explicit take-local-control (INT-005). |
| CTL-013 | Standalone mode: exercises not driven by Cadence get a native scheduler (author content in E4/E5/E6/E2 composers with a "hold for conduct" flag; items land in this queue), scheduled against the native exercise clock (COR-050). |
| CTL-014 | Timed bursts: a queue item can be a **bundle** (e.g., 12 citizen posts across 8 personas over 10 minutes) that fires as a naturally-paced sequence, not a simultaneous dump — the Looking Glass repeated-voices pattern, automated. |
| CTL-015 | On a scenario-time jump (COR-051), the queue presents skipped-span items as a batch disposition: fire-as-backfill / skip / re-schedule. |

### F7.3 World steering

| ID | Requirement |
|---|---|
| CTL-020 | Portal curation: pin/feature Top Stories (PRT-004), publish alerts to the alert bar with severity (PRT-010). |
| CTL-021 | Attention levers: edit suggested-follows (SOC-053); flag content as platform-alert (SOC-072); trend boost-weight (SOC-041). |
| CTL-022 | Escalation dial (E8 hook): per-exercise and per-storyline intensity controls for automated public reaction. **Engine-first phasing: this control and the E8 review queue (ADP-040) ship as part of the Phase 1 controller surface** so the engine lands into a ready cockpit in Phase 2. |
| CTL-023 | Pause/resume the information environment (world holds still during an exercise pause; queued automation suspends), aligned with the exercise clock state (COR-050). The pause holding page has both in-fiction and **out-of-fiction** options. |
| CTL-024 | **Real-world broadcast (break-fiction):** a Director-level action publishes an unmissable, visually alien banner/overlay — deliberately unlike any simulation chrome — to every session in the exercise on every channel: "REAL-WORLD EVENT — EXERCISE SUSPENDED" (configurable text: safety stop, ENDEX, real emergency instructions). Cannot be dismissed while active; delivery is logged per session. This is the house lights; no exercise Director will run a stage without them. |
| CTL-025 | **Content takedown:** controllers can remove any content in the exercise (participant or world content) in ≤2 clicks: tombstone in-fiction ("post unavailable"), tag the removal with an incident category (inappropriate / PII / real-world reference / other), and optionally notify the Exercise Director. Removed content is retained staff-only for the record (XC-010) and never re-rendered in participant surfaces, including replay. Resolves what real exercises hit roughly every time: a participant posts something that has to come down *now*. |
| CTL-026 | **Off-platform response marker:** one click records that an official response occurred outside Pulse (press briefing, phone, real alerting system) against a storyline/inject — timestamped, with a short note. Satisfies E8 storyline expectations (stops wrongful silence-escalation, ADP-002a) and annotates E10 latency/coverage metrics so the AAR never reports a false "unaddressed." |

### F7.4 Live monitoring

| ID | Requirement |
|---|---|
| CTL-030 | A monitoring board: live participant activity stream (posts, releases, DMs, article views), filterable by participant, org, and channel. |
| CTL-031 | Watchlist: controllers can watch specific storylines (hashtag, rumor thread, persona) as columns — TweetDeck-style multi-column staff view. |
| CTL-032 | Expected-action tracking: where content carries an expected action (from Cadence inject data or native authoring), controllers see fired-vs-responded state at a glance — the trigger for "they missed it, escalate" decisions (manual now, E8-automated later). |
| CTL-033 | Evaluators get this monitoring surface read-only (COR-013), minus steering controls. |
| CTL-034 | **Controller workload budget (acceptance criterion for E7+E8 together):** at NFR-002 burst load with the engine at Delayed-auto, a single controller's required decisions (review-queue actions + response-match prompts + queue fires) must not exceed ~6/minute sustained. If a design change pushes past this, the design is wrong — the product bar is "one controller runs a believable world," and the failure mode is public: the world berating a PIO who already answered. |

## 3. User experience

**One controller, a whole city.** The controller's screen: left, the conduct timeline synced to the exercise clock with the next bundle ("Trash pickup complaints — 12 posts / 8 personas / 10 min") ready to fire. Center, the live world: All-Posts column, a `#911` watchlist column, participant activity column. Right, the persona dock with pinned favorites — the news outlet, the county EM account, three reliable citizens.

A participant posts something unexpected — a PIO prematurely confirms a road closure. The controller taps the citizen persona "Darco Tripp," gets his voice notes ("mildly grumpy, short sentences"), and replies in-character within seconds: "so is it closed or not?? I drive that way." Then bumps the storyline's escalation dial one notch and drops a note into the storyline log — which flows to E10 so the AAR can explain why the world turned hostile at 14:07.

**When something has to come down.** A participant accidentally posts a real colleague's phone number. The controller right-clicks → Take down → category: PII → notify Director. Two clicks; the post tombstones in-fiction; the AAR records the removal without republishing the content.

**Design notes.** Dense, dark, keyboard-friendly operator tooling — the opposite of the participant surfaces. Column-based layout, command-palette persona switching (Ctrl+K), zero modal friction on the fire path, fully keyboard-operable (NFR-001). This console is also a sales demo asset: it should *look* like the mission control it is.

## 4. Out of scope

Automated content generation (E8 — this epic is its control panel), Cadence data plumbing (E9), evaluation analytics (E10 — CTL-030 is operational awareness, not scoring).

## 5. Open questions

1. ~~Retcon policy~~ **Resolved (adversarial review A5):** delete-as-tombstone yes with incident tagging (CTL-025); silent edit no.
2. Minimum viable monitoring board for Phase 1 vs. full watchlist columns — needs a scoping pass with whoever runs SimCell at the next exercise.
