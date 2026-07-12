# Story Updates — Pulse Controller Console (D5)

> **Purpose.** The D5 design review produced decisions that **change requirements as
> written**, not just UI choices. This checklist is the input for the story/epic agents:
> each item names the requirement ID, the decision that changed it (`D5-xxx`), the
> before → after, and the action. Source: [`DECISIONS.md`](DECISIONS.md) and
> [`README.md`](README.md). Verify each "before" against the current epic text
> (`../0X-*.md`) when editing — the epic is the source of truth for the original wording.

Legend: **AMEND** = edit existing requirement · **ADD** = new requirement/capability ·
**RECONCILE** = supersede an earlier decision · **BACKLOG** = defer as a future story.

---

## A. Requirement amendments (safety-critical first)

- [ ] **ADP-040 — engine-draft timeout defaults to auto-HOLD** · `D5-014/1.1`, `D5-005 (superseded)`
  - **Before:** expired timed drafts auto-**send** (inaction = approval).
  - **After:** expired drafts **auto-HOLD** for the controller ("timer expired — held for
    you"; surfaces in NEEDS YOU). *Silence is never approval.* Auto-send exists **only** as
    an explicit per-exercise **"swamped mode"** toggle the lead controller enables; automation
    never escalates its own autonomy.
  - **Action:** rewrite the acceptance criteria for the timeout path; add the swamped-mode
    setting as a separate, lead-controller-gated story.

- [ ] **CTL-024 — rename "Real-World Broadcast" → "Break Fiction"; constrain scope** · `D5-014/1.2`, `D5-007`
  - **Before:** "Real-World Broadcast" control (scope ambiguous).
  - **After:** **"Break Fiction"** — replaces participant screens **inside the exercise only**
    (nothing leaves the platform). Director-gated (locked for Controller role), type-to-confirm
    (**"BROADCAST"**), lives in a visually distinct **guarded/latched** group, and **every use
    is logged to the exercise record**. Confirm dialog states destination + that use is logged.
  - **Action:** rename across stories; add scope, gating, type-to-confirm, and audit-log ACs.

- [ ] **CTL-023 — pause becomes tiered (3 tiers)** · `D5-014/1.3`
  - **Before:** single pause action.
  - **After:** three tiers — **Pause injects** (world keeps living) / **Pause engine** (no new
    AI content) / **Freeze world** (guarded; participants notice; safety-stop only). State pill
    reads INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN. **Scenario clock stops only on Freeze.**
    Break Fiction implies world-freeze.
  - **Action:** split the pause AC into three tiers; specify which tier stops the scenario clock;
    mark Freeze as guarded.

- [ ] **CTL-034 — visible metric is "queue pressure," not performance** · `D5-014/2.7`, `D5-003`
  - **Before:** "decisions/min" acceptance criterion (unspecified surfacing).
  - **After:** a header/action-bar **queue-pressure meter** = decisions **demanded** per minute
    over a rolling 60s window, budget **≤6**, amber past 6. Tooltip states it is **demand, not a
    controller-performance measure**. Staff-performance surveillance explicitly rejected.
  - **Action:** reword CTL-034 to define the metric as demand + design budget; forbid its use as
    a performance/evaluation signal.

- [ ] **CTL-022 — storyline intensity = actual + controller-set target** · `D5-014/2.2`
  - **Before:** intensity shown as a single value.
  - **After:** one track showing **actual fill + a target tick**; click the track to set target
    ("78 →60"); the **engine drives actual toward the target**.
  - **Action:** update CTL-022 to include the target control and the engine-follows-target loop.

- [ ] **CTL-015 — time-jump guarded while RUNNING** · `D5-014/P4`
  - **Before:** time-jump available during conduct.
  - **After:** **requires pause first**; the time-jump dialog does batch disposition of spanned
    injects (fire all / fire + hold rumor wave / skip all).
  - **Action:** add the pause precondition and the batch-disposition step to CTL-015.

- [ ] **COR-005 — exercise identity is static during live conduct** · `D5-012(g)`
  - **Before:** exercise switcher present in the header.
  - **After:** header shows a **static identity badge** during conduct; switching is a
    **pre-conduct** concern (identity intent of COR-005 kept).
  - **Action:** clarify COR-005 that switching is not a conduct-time action.

---

## B. New requirements / capabilities to add

- [ ] **ADD — Toolstrip + flyouts pattern (the console's extension point)** · `D5-016`, `D5-017`, `D5-019`
  - 56px right-edge toolstrip; **continuous-watch** surfaces (engine review queue, live world)
    keep permanent rail/column space; **consult-on-demand** surfaces (Stories, Personas,
    Trainees, Rumors) are tools with status badges (red pulsing count when escalating).
  - Designated home for future casual surfaces so the rail never re-bloats: participant admin
    (COR-017), evaluator flags (3.4), rumor tracker (3.3), exercise settings.
  - **Action:** add as a cross-cutting UI/architecture requirement for the console.

- [ ] **ADD — Rumor tracker as first-class objects** · `D5-018`, review 3.3 *(mocked; target: Storyline Board v2)*
  - Rumor lifecycle **SEEDED → SPREADING → COUNTERED → DEAD**, origin (inject-seeded vs organic),
    reach bar + trend, mutation line, countered-by credit, action **"Draft counter as…"** → persona picker.
  - **Action:** create rumor-object stories (data model + tracker flyout); currently mock-only.

- [ ] **ADD — "Flag" on any post writes to the after-action record** · `D5-014/3.4` *(partial)*
  - Per-post hover **Flag** action → AAR. Full evaluator flags/annotations deferred to D6/evaluator.
  - **Action:** add a minimal AAR-write story for Flag; link full annotation set to D6.

- [ ] **ADD — Trainee monitor (flyout), adaptive-loop metric** · `D5-016`, `D5-014/3.1` *(partial)*
  - Card per trainee: role, live status (ACTIVE / IDLE / DRAFTING), last action, response-time-vs-target
    and expected-action progress. Storyline cards keep a one-line trainee signal.
  - **Action:** add trainee-monitor story; note full PIO monitoring is its own future surface.

- [ ] **ADD — NEEDS YOU action bar: locate-and-highlight, never act** · `D5-010`, `D5-012(d)`
  - Persistent bar names current to-dos; chips highlight the target (amber ring) but **never
    execute** — nothing fires without an explicit Fire press.
  - **Action:** capture as an interaction-safety requirement (no action-at-a-distance).

---

## C. Reconcile / supersede

- [ ] **RECONCILE — D5-005 "auto-fire on expiry" is superseded by D5-014/1.1 (auto-HOLD).**
  Ensure no story still says drafts auto-send on timeout except behind swamped mode.
- [ ] **RECONCILE — counts across surfaces** · `D5-014/2.1` — "N of M need review" / "N timers under
  60s" must agree with the queue's pending count. Add a consistency note to the relevant ACs.

---

## D. Deferred → backlog (log as future stories, not this pass)

- [ ] **CTL-033 — evaluator read-only console variant:** steering controls **absent, not disabled**.
- [ ] **COR-017 — participant admin quick-panel:** StartEx login triage (candidate toolstrip tool).
- [ ] **NFR-008 — "EXERCISE" watermark slot:** participant-content concern, not the console.
- [ ] **Global sentiment / mood** (per-storyline sentiment already exists) · `D5-014/3.2`.

---

## Traceability at a glance

| Requirement | Decision(s) | Type | One-line change |
|---|---|---|---|
| ADP-040 | D5-014/1.1, D5-005 | AMEND | Timeout → auto-HOLD; auto-send only via swamped mode |
| CTL-024 | D5-014/1.2, D5-007 | AMEND | Rename "Break Fiction"; in-exercise only; Director-gated + logged |
| CTL-023 | D5-014/1.3 | AMEND | Tiered pause; clock stops only on Freeze |
| CTL-034 | D5-014/2.7, D5-003 | AMEND | "Queue pressure" = demand budget ≤6, not performance |
| CTL-022 | D5-014/2.2 | AMEND | Intensity = actual + controller target |
| CTL-015 | D5-014/P4 | AMEND | Time-jump requires pause; batch disposition |
| COR-005 | D5-012(g) | AMEND | Static identity during conduct; switching pre-conduct |
| — (UI) | D5-016/17/19 | ADD | Toolstrip + flyouts; watch vs consult rule |
| 3.3 | D5-018 | ADD | Rumor first-class objects (mocked) |
| 3.4 | D5-014/3.4 | ADD | Flag → after-action record (partial) |
| 3.1 | D5-016, D5-014/3.1 | ADD | Trainee monitor flyout (partial) |
| CTL-033 / COR-017 / NFR-008 | Open | BACKLOG | Deferred, not in this pass |
