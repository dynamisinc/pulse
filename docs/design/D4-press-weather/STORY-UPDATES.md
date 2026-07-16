# Story Updates — The Wire Room & The Weather Desk (D4)

> **Purpose.** The D4 design review (full mockup, user-approved, 12 sign-offs — see
> [`DECISIONS.md`](DECISIONS.md)) produced decisions that **constrain and in places amend
> requirements as written**, not just UI choices. This checklist is the input for the story/epic
> agents: each item names the requirement ID, the D4 decision that touches it, the before → after,
> and the action. Verify each "before" against the current epic text (`../../05-press-room.md`,
> `../../06-weather-source.md`) when editing — the epic is the source of truth for the original
> wording.

Legend: **AMEND** = edit an existing requirement · **ADD** = new requirement/capability ·
**RECONCILE** = resolve a conflict / supersede earlier text · **BACKLOG** = defer as a future
story/open item.

---

## ⚠ State of the E5/E6 backlog (read first)

**There are no decomposed PRS/WX story files yet.** Only E1/E2/E7 have been decomposed into
`docs/features/` backlogs (Phase 1). E5 (press) and E6 (weather) are **Phase 3** and currently live
**only as epics** (`../../05-press-room.md`, `../../06-weather-source.md`); there are **no
`docs/features/press-room/` or `docs/features/weather-source/` folders**, and **no PRS/WX GitHub
issues** (and no E5/E6 epic issues) exist.

Consequences for this pass:
- The D4 decisions are encoded **(a)** in this file as the amend/add checklist, and **(b)** inline
  in the **epics** as a *"D4 approved design"* block per requirement (add-don't-destroy, IDs stable,
  superseded text pointed not deleted).
- The two existing **cross-reference** Phase-1 stories that touch these IDs were updated to cite
  D4-005 ([`../../features/posts/06-post-as-organization.md`](../../features/posts/06-post-as-organization.md),
  [`../../features/identity-auth-roles/09-org-account-operation.md`](../../features/identity-auth-roles/09-org-account-operation.md)).
- **This checklist is pre-staged for the E5/E6 decomposition pass.** When `story-agent` decomposes
  E5/E6 into `docs/features/press-room/` + `docs/features/weather-source/`, it applies the items
  below to the new stories' acceptance criteria and cites the `D4-0xx` anchors — exactly as the D5
  amendments flowed into `console-shell`.

This is a **process gap, surfaced not silently filled** — decomposing E5/E6 (and mirroring the
E5/E6 → feature → story issue hierarchy to GitHub) is the logged next step, not part of this docs
sync (the prompt scoped this as a stories/design sync, and Phase-1 decomposition is the active work).

---

## A. Requirement amendments

### Wire Room (PRS)

- [ ] **PRS-002 — composer is the letterhead sheet; PDF-first; headline-only + auto-suggest** · `D4-001`, `D4-002`
  - **Before:** "primary path is drag-and-drop PDF rendered inline … with headline, release org, and
    contact block wrapped around it. Rich-text editor … is the secondary path."
  - **After:** the composer **renders as the release artifact** (letterhead + contact block
    prefilled); the **PDF drop zone IS the body**; **headline is the only required input**,
    **auto-suggested from the PDF with one-click "Use as headline"** (sign-off #11); paste-from-Word
    is the *quiet secondary* path (formatting kept, sanitized per NFR-004). **Nothing publishes on
    drop.** Bench target: **drop → publish < 60s**.
  - **Action:** author the composer story ACs to the sheet model + auto-suggest + the <60s path;
    forbid a form/CMS-style composer (anti-pattern).

- [ ] **PRS-003 — scheduled/embargo state is unmistakable by redundancy** · `D4-003`
  - **Before:** "clear embargo state ('Scheduled — releases in 19m')."
  - **After:** amber **"⏱ SCHEDULED — releases in 19m"** on **composer + author wire row + permalink**;
    the sheet's **"FOR IMMEDIATE RELEASE" flips to "EMBARGOED — HOLD UNTIL {time}"**; scheduled item
    visible to author + staff/JIC only.
  - **Action:** AC covers all three surfaces + the sheet-line flip; severity not color-only (amber +
    ⏱ icon + text).

- [ ] **PRS-013 — cross-post is explicit, unchecked-by-default, with a live card** · `D4-004`
  - **Before:** "optionally auto-post from the org's paired social account with a link card —
    configurable per publish action."
  - **After:** an **explicit checkbox naming the org handle, unchecked by default**, rendering the
    **exact link card** that will post (anatomy per COMPONENTS/D1).
  - **Action:** AC: opt-in default off; handle named; live card preview.

- [ ] **PRS-004 — autosave is ambient state, never a control** · `D4-006`, `D4-001`
  - **Before:** "drafts autosave; a draft's full edit timeline is retained."
  - **After:** autosave shown as **passive header status** (dot + "Saved…"), **no Save button**
    (sign-off #12); edit timeline retained for evaluation (disclosed per NFR-007).
  - **Action:** AC: no Save control; ambient status; timeline capture disclosed.

- [ ] **PRS-020 — one confirmation gate; cancel-embargo notifies + audits** · `D4-002`
  - **Before:** "no destructive actions without confirmation" (design note).
  - **After:** **exactly one** confirm sheet on publish restating **org / headline / timing /
    cross-post**; cancel-scheduled + return-to-author also confirm; **cancelling an embargo notifies
    approvers and leaves a wire audit trace** (sign-off #2).
  - **Action:** AC per gate; the cancel-embargo notification + audit trace is a new, testable behavior.

- [ ] **PRS-021 — the approval gate is participant paper, not staff chrome** · `D4-007`  *(see also Conflict C-1)*
  - **Before:** "optional review gate … approver can be a participant role or a controller … off by
    default."
  - **After:** the gate renders in the **wire's letterhead world**: pending list + **draft-diff**
    (struck removals / shaded additions); **approve = confirm chip → releases**; **return REQUIRES a
    note**; the returned note surfaces to the author as a **"↩ RETURNED FOR REVISION"** banner.
    **Routing is per-exercise config with per-org defaults** (sign-off #1; off-by-default preserved).
    Approval latency still captured (EVL-010).
  - **Action:** AC: participant-surface gate; mandatory return note; author-facing return banner;
    per-exercise routing + per-org defaults. **Reconcile the "controller playing that role" framing**
    (C-1).

### Weather Desk (WX)

- [ ] **WX-001 / WX-010 — NWS-verbatim anatomy + IBW grid + AA-adjusted severity** · `D4-009`
  - **Before:** "NWS-style visual language"; "type/hazard/zones/effective-expiry, headline, body in
    familiar NWS style"; "alert color conventions matching real NWS severity colors."
  - **After:** weather.gov anatomy; **IBW What/Where/When/Impacts grid** on the warning product;
    **monospace product text with NWS furniture** (`...HEADLINE...`, `PRECAUTIONARY/PREPAREDNESS
    ACTIONS`, `&&`/`$$`); **Issued/Effective/Expires in scenario time**; severity **always icon +
    WATCH/WARNING text chip + color, never color-only**; **NWS hues darkened for WCAG AA** white-text
    contrast (sign-off #8: warning `#8b0000`, watch `#2e6b4f`).
  - **Action:** AC: IBW grid; NWS furniture; scenario-time stamps; icon+text+color; AA-adjusted hues.

- [ ] **WX-011 — warning propagation: emergency band + shared multi-alert bar + verbatim headline** · `D4-010`  *(see also Conflict C-2)*
  - **Before:** "publishes to the alert panel, pushes to the portal alert bar (PRT-010) **at mapped
    severity**, and optionally auto-posts from the paired account."
  - **After:** watch = advisory ticker; **warning = emergency band that escapes the ticker on every
    channel**; **every warning type forces the emergency band, for now** (sign-off #6 — provisional,
    revisit per-type mapping); the bar carries **weather + non-weather in one multi-alert bar**
    (sign-off #7); the **same headline string** appears on bar, @WeatherDesk post, portal widget, and
    product page — **no paraphrase**.
  - **Action:** AC: warning⇒emergency-band (note the "for now"); multi-alert shared bar; verbatim
    headline propagation across four surfaces. Per SHELL-CONTRACT §2.

- [ ] **WX-013 — imagery slot reserves the EXERCISE watermark chip** · `D4-012`
  - **Before:** "support uploaded/Beat-generated imagery … canned/produced imagery only."
  - **After:** the imagery slot **reserves the bottom-right EXERCISE watermark chip** (NFR-008,
    matching portal D2-008) — warning products are the highest-risk leak class, covered first.
  - **Action:** AC: reserved watermark slot + placement on the warning product.

- [ ] **WX-020 — paired account is @WeatherDesk; auto-post editable pre-publish** · `D4-011`  *(see also Conflict C-3)*
  - **Before:** "paired verified E2 account (e.g., '@NWSAtlanta'-analog)"; UX prose says
    "@WeatherSource".
  - **After:** the paired handle is **@WeatherDesk** (consistent with the WX-001 brand "The Weather
    Desk"); its auto-post defaults to the **product headline verbatim** and is **editable pre-publish,
    console-side** (sign-off #10 — a D5 note, see §E).
  - **Action:** reconcile the handle name (C-3); AC for the auto-post lives console-side (§E).

## B. New requirements / capabilities confirmed by the mockup

- [ ] **PRS-001 / COR-018 / SOC-006 — "Releasing as {org} ▾" reuses the D1 chip** · `D4-005`
  - Multi-org/JIC authors switch identity via the **same D1 "Posting as" chip**, labelled
    "Releasing as"; granted orgs only; letterhead/contacts/handle swap live; **one identity at a
    time** (SOC-006). Reuses E1 grant + attribution.
  - **Action:** the E5 composer story consumes the E2/D1 chip; do not build a second switcher.

- [ ] **PRS-010 / PRS-012 — the wire is public to all participants** · `D4-008`
  - Citizens included (sign-off #5). The wire + org newsroom pages are public destinations.
  - **Action:** AC: no PIO/media-only gating on read.

- [ ] **WX-002 — weather authoring is staff-side only** · `D4-011` *(→ §E)*
  - Confirms no participant weather composer (sign-off #9); the participant Weather Desk is
    read/consume only. Authoring is controller-console (D5).

## C. Reconcile / conflicts (LISTED, not silently rewritten)

> These are places where **existing epic/UX text disagrees with the approved D4 design**. Flagged
> here and in the PR description for a human to confirm the reconciliation; the epics were annotated
> with a pointer, original wording preserved.

- [ ] **C-1 — PRS-021 approver framing.** Epic: approver may be "a controller playing that role."
  D4-007: the **gate UI is participant paper**, regardless of operator. **Resolution proposed:** a
  controller who approves does so via preview-as-participant / the participant approval view; the
  gate is never staff console chrome. *Confirm.*
- [ ] **C-2 — WX-011 severity mapping.** Epic: portal alert bar "**at mapped severity**." D4-010
  (sign-off #6): **every warning forces the emergency band, for now** — a deliberate simplification,
  not a full per-type mapping. **Resolution proposed:** encode emergency-for-all-warnings now; keep
  a backlog note to revisit graded mapping. *Confirm the "for now."*
- [ ] **C-3 — Weather paired-account name.** Epic WX-020 "'@NWSAtlanta'-analog" + UX prose
  "@WeatherSource" vs approved **@WeatherDesk**. **Resolution proposed:** standardize on
  **@WeatherDesk** (matches the WX-001 brand). *Confirm.*

**Guards — potential conflicts checked and NOT present (do not reintroduce during decomposition):**
form/CMS-style composer (excluded by D4-001), participant weather authoring (excluded by D4-011 #9),
color-only severity (excluded by NFR-001 / D4-009), publish-without-confirmation (excluded by D4-002).

## D. Open items → backlog (log as explicit gaps, not silent)

- [ ] **Return-notification reach beyond the wire** (`D4-007`, sign-off #3) — returns currently stay
  **wire-internal**; whether a returned release should notify via Pulse/portal is **open to explore**
  later. *Provisional, not a shipped guarantee.*
- [ ] **Mobile pass — deferred.** The D4 mockup is desktop; participant surfaces are **mobile-first**
  (D0 §4.6). The Wire Room composer + Weather Desk product need a mobile pass before build.
- [ ] **Real inline PDF rendering + paste-from-Word — build work.** Mocked in the design (`FILED
  DOCUMENT · advisory-update-0714.pdf · 2 pages`, `Replace`); real page rendering and sanitized
  Word-paste (NFR-004) are implementation work under PRS-002.
- [ ] **Alerts history page (PRT-012) — still stubbed.** The alert bar's **"Details →"** routes here;
  the destination page is not designed yet (shell/SHELL-CONTRACT §2 concern shared with D2/D7).
- [ ] **Warning ⇒ emergency-band "for now" (`D4-010`/#6)** — revisit graded per-type severity
  mapping post-launch (paired with C-2).

## E. Routed to D5 (controller-console retrofit notes)

> D4-011 produced two **staff-side** follow-ups. They are **not** participant-surface stories and
> were added to the console follow-up tracker:
> [`../D5-controller-console/STORY-UPDATES.md`](../D5-controller-console/STORY-UPDATES.md) §E.

- [ ] **@WeatherDesk auto-post editable pre-publish, console-side** (`D4-011`, sign-off #10).
- [ ] **Weather authoring is console-side only — no participant composer** (`D4-011`, sign-off #9).

---

## Traceability at a glance

| Requirement | D4 decision(s) | Type | One-line change |
|---|---|---|---|
| PRS-001 | D4-005 | ADD/ref | "Releasing as" reuses the D1 chip; one identity at a time |
| PRS-002 | D4-001, D4-002 | AMEND | Letterhead sheet; PDF-first; headline-only + auto-suggest; no publish-on-drop |
| PRS-003 | D4-003 | AMEND | Redundant SCHEDULED state (3 surfaces) + sheet-line flip |
| PRS-004 | D4-006, D4-001 | AMEND | Autosave = ambient status, no Save control |
| PRS-005 | D4-009 (COR-053) | confirm | Revision markers in scenario time |
| PRS-010/012 | D4-008 | ADD/ref | Wire + newsrooms public to all participants |
| PRS-011 | D4-003, D4-010 | confirm | Permalink scheduled banner; product page canonical source |
| PRS-013 | D4-004 | AMEND | Cross-post opt-in (off by default), names handle, live card |
| PRS-020 | D4-002 | AMEND | One confirm gate; cancel-embargo notifies + audits |
| PRS-021 | D4-007 | AMEND + C-1 | Participant-paper gate; mandatory return note; per-exercise routing |
| PRS-022 | — | confirm | Publish emits world-reaction/telemetry event (unchanged) |
| WX-001/010 | D4-009 | AMEND | NWS verbatim; IBW grid; furniture; AA-adjusted severity |
| WX-002 | D4-011, D4-012 | ADD/ref | Staff-authored only; watermark on warning |
| WX-003 | — | confirm | Forecast evolution unchanged |
| WX-004 | D4-009 | confirm | Per-zone selector |
| WX-011 | D4-010 | AMEND + C-2 | Warning⇒emergency band (for now); shared multi-alert bar; verbatim headline |
| WX-012 | D4-011 | confirm | Firable as inject / ad hoc (staff) |
| WX-013 | D4-012 | AMEND | EXERCISE watermark slot on imagery |
| WX-020 | D4-011 | AMEND + C-3 | @WeatherDesk handle; auto-post editable pre-publish |
| WX-021 | D4-010 | confirm | Portal widget swaps to warning tile; same headline |
| WX-022 | — | confirm | Product-view telemetry (XC-004) unchanged |
| COR-018 / SOC-006 | D4-005 | ref | Org grants; one identity at a time |
| COR-053 | D4-003/006/009 | ref | Scenario time on all participant-visible times |
| NFR-001 | D4-009 | ref | Severity icon+text+color; AA hues |
| NFR-008 | D4-012 | ref | EXERCISE watermark reserved |
| PRT-010/011 | D4-010 | ref | Alert bar states; emergency escapes ticker |
| PRT-012 | Open | BACKLOG | Alerts history page still stubbed |
