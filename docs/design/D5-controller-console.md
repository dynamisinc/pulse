# D5 — Design Brief: Controller Console

> Epic: `../07-controller-command-surface.md` · Anchors: **Cadence conduct views** (fire/skip/defer, dual time, presence) + **TweetDeck** (columns) + command-palette apps (Ctrl+K). Staff world: dark COBRA chrome, dense-on-purpose, keyboard-first.
> **Session 1 priority: this is the Phase 1 build and the sales demo asset. It should *look* like mission control.**

## Purpose & users

One controller runs a believable world (E7 §1; workload budget CTL-034: ≤~6 decisions/min at burst). Cadence-trained controllers must be productive immediately — reuse Cadence vocabulary and conventions everywhere they apply.

## Layout concept (E7 §3)

Three-region desktop layout:

- **Left — Conduct timeline** (CTL-010…015): scheduled content in Cadence MSEL-conduct style. Status chips (pending/ready/fired/skipped/held), fire/hold/skip actions, bundle items ("12 posts · 8 personas · 10 min"), Cadence-locked items with inject number + lock badge + "take local control" escape (INT-005). Time-jump batch disposition dialog (CTL-015).
- **Center — The live world** (CTL-030/031): TweetDeck-style columns — All Posts, watchlists (hashtag/storyline/persona), participant activity. Column management must be effortless.
- **Right — Persona dock + engine** (CTL-001…005): pinned personas, search picker (Ctrl+K command palette; ≤3s to composing), composer with persona voice notes/context; below it the **E8 review queue** (ADP-040: approve/edit/veto/re-roll, batch approve, countdown timers on delayed-auto items) and the **escalation dial** per storyline (CTL-022).

## Critical moments to design

1. **Fire a bundle** — one confirm, then watch it pace out in the center columns.
2. **In-character reply in <10 seconds** — Ctrl+K → persona → voice notes visible → send (the E7 §3 Darco Tripp moment).
3. **Review-queue triage under burst** — countdown items, one-key approve/veto, batch actions; must feel like inbox triage, not form-filling.
4. **Response-match prompt** (ADP-002a) — "Does this address #WaterIssues? Y/N" as a lightweight toast/inline prompt, never a modal wall.
5. **Takedown** (CTL-025) — right-click/⋯ menu → two clicks with incident category → done.
6. **Off-platform response marker** (CTL-026) — one click from a storyline card + optional note.
7. **Break-fiction broadcast** (CTL-024) — Director-gated, deliberately heavy confirmation (type-to-confirm), and the resulting overlay design: visually alien to everything else in the product. Also: pause controls with in-fiction/out-of-fiction page choice (CTL-023).
8. **Storyline board** — intensity/sentiment at a glance, escalation dial, expected-action state (CTL-032).

## Multi-controller & multi-exercise

Presence indicators on personas (CTL-004); explicit exercise switcher in header (COR-005) — impossible to mistake which world you're operating.

## Constraints & cues

- Fully keyboard-operable (NFR-001); zero modal friction on the fire path.
- Dark staff chrome — never confusable with participant surfaces.
- Evaluator variant: same monitoring surfaces read-only, steering controls absent not disabled (CTL-033).
- Participant admin quick-panel (COR-017): reset/unlock/force-logout reachable without leaving the console — StartEx login triage happens *here*.

## Anti-patterns

Enterprise-dashboard sprawl (density with hierarchy, not chaos); modal confirmations on routine actions; anything requiring a mouse for the core loop; hiding the kill switch (ADP-042 — always visible, one click to Suggest/stop).
