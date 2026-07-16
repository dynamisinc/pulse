# E5 — Press Room

> **Epic ID:** E5 · **Requirement prefix:** PRS
> **Depends on:** E1 · **Feeds:** E3 (portal module), E2 (link cards), E10 (telemetry)
> **Roles served:** PIO participants (primary authors), Controllers, Evaluators
> **Looking Glass parity target:** Press Room Wire (PR14)
> **Design handoff:** D4 (Wire Room) — [`docs/design/D4-press-weather/`](design/D4-press-weather/) · decisions `D4-001…013` in [`DECISIONS.md`](design/D4-press-weather/DECISIONS.md); requirement amendments in [`STORY-UPDATES.md`](design/D4-press-weather/STORY-UPDATES.md).

## 1. Epic summary

The participant's formal publishing surface: a simulated press release wire where PIOs and communications players push official statements on behalf of their organizations. Unlike E2/E4 — which are mostly world-generated content participants react to — the Press Room is primarily **participant-authored**. It simulates both an organization's newsroom page and a wire service, and is a major evaluation source: what did the PIO publish, when, was it accurate, did it address the public's actual concerns?

Looking Glass parity: PR Wire lets Communications Players/PIOs post releases (paste from Word, type directly, or drop a PDF), attach a picture, and embargo (schedule) or release immediately.

## 2. Features & requirements

### F5.1 Release authoring (participant-facing)

| ID | Requirement |
|---|---|
| PRS-001 | Participants with PIO/comms permission (COR-010) author releases on behalf of the organization(s) they operate (COR-018 org-account grants). Multiple humans publishing under one org banner is a supported, per-human-attributed pattern (JIC reality); joint/JIC releases publish from a participant-operated JIC org account — not a controller workaround. |
| PRS-002 | Authoring inputs, **PDF-first (decided from exercise experience — PIOs mostly drop finished PDFs):** primary path is drag-and-drop PDF rendered inline as pages (plus download), with headline, release org, and contact block wrapped around it. Rich-text editor with clean paste-from-Word (sanitized per NFR-004) is the secondary path. Image attachment on both. |
| PRS-003 | Release timing: publish immediately or **embargo/schedule** for a set time. Scheduled releases are visible to their author and staff, invisible to the public until release. |
| PRS-004 | Drafts autosave; a draft's full edit timeline is retained (evaluators can see how long a release took to produce, and what changed between drafts — rich evaluation signal; capture disclosed per NFR-007). |
| PRS-005 | Releases can be updated post-publish with visible revision markers ("Updated 14:32" — scenario time, COR-053), preserving prior versions. |

### F5.2 The wire (public-facing)

| ID | Requirement |
|---|---|
| PRS-010 | A public wire page — default in-fiction brand **"The Wire Room"** (screened, theme-configurable) — lists releases newest-first with org branding (logo/letterhead per organization), filterable by organization. |
| PRS-011 | Each release has a permalink page; releases are link-previewable in E2 and surfaceable in the portal's Press Room module (PRT-003). |
| PRS-012 | Each organization gets a newsroom page (its releases only) — simulating "the county's website newsroom." |
| PRS-013 | Publishing a release can optionally auto-post from the org's paired social account (E2) with a link card — configurable per publish action, because deciding *whether and how* to socialize a release is part of the PIO craft being evaluated. |

### F5.3 Simulated-world use & staff controls

| ID | Requirement |
|---|---|
| PRS-020 | Controllers can publish releases as any simulated organization persona (via E7) — e.g., a utility company's tone-deaf statement that inflames the public, or a neighboring county's conflicting guidance. |
| PRS-021 | Optional review gate: exercises may require approval before a participant release publishes. The approver can be **a participant role** (JIC lead, legal reviewer — the approval chain is itself being evaluated, with approval latency captured in EVL-010) or a controller playing that role. Off by default. |
| PRS-022 | World reaction hooks: publishing a release emits an event consumable by E8/E7 so the public can react (quote it, misread it, praise it) and by E10 for response-timing metrics. |

## D4 approved design — decisions folded into §2

> Source: design session **D4** — a full user-approved mockup with 12 sign-offs. Package:
> [`docs/design/D4-press-weather/`](design/D4-press-weather/)
> ([`DECISIONS.md`](design/D4-press-weather/DECISIONS.md),
> [`STORY-UPDATES.md`](design/D4-press-weather/STORY-UPDATES.md)). Requirement IDs are **stable**;
> the entries below **amend/confirm** the requirements above — original wording is preserved. They
> attach to the E5 stories when E5 is decomposed into `docs/features/press-room/` (not yet done —
> see STORY-UPDATES "State of the E5/E6 backlog").

| Req | Decision | Change |
|---|---|---|
| PRS-001 | D4-005 | Org switcher **reuses the D1 "Posting as" chip**, labelled **"Releasing as {org} ▾"**; granted orgs only; letterhead/contacts/handle swap live; one identity at a time (SOC-006). |
| PRS-002 | D4-001, D4-002 | Composer **is the letterhead sheet**; the **PDF drop zone is the body**; **headline is the only required input, auto-suggested from the PDF** (one-click accept); paste-from-Word is the quiet secondary path (sanitized, NFR-004); **nothing publishes on drop** (drop→publish < 60s). |
| PRS-003 | D4-003 | Redundant amber **"⏱ SCHEDULED — releases in 19m"** on composer + author wire row + permalink; the sheet's **"FOR IMMEDIATE RELEASE" flips to "EMBARGOED — HOLD UNTIL {time}"**. |
| PRS-004 | D4-006 | Autosave is **ambient header status, never a Save control**; edit timeline retained (NFR-007). |
| PRS-010/011/012 | D4-008 | The wire + org newsrooms are **public to all participants, citizens included** (sign-off #5). |
| PRS-013 | D4-004 | Cross-post = **explicit checkbox naming the handle, unchecked by default**, with a live link-card preview. |
| PRS-020 | D4-002 | **Exactly one** confirmation gate (org/headline/timing/cross-post); **cancelling an embargo notifies approvers + leaves a wire audit trace**. |
| PRS-021 | D4-007 | Approval gate is **participant paper** (pending list + draft-diff); **return REQUIRES a note** that surfaces to the author's composer; **per-exercise routing with per-org defaults** (off by default). ⚠ **Conflict C-1** — reconcile §2's "a controller playing that role": the *gate UI* is participant-surface regardless of who operates it. |

**Open items (logged, not silently closed):** return-notification reach beyond the wire (D4-007
sign-off #3 — *explore later*); a **mobile pass** (the mockup is desktop; participant surfaces are
mobile-first per D0 §4.6); **real inline PDF rendering + sanitized paste-from-Word** (build work;
mocked in the design). Full list in [`STORY-UPDATES.md`](design/D4-press-weather/STORY-UPDATES.md) §C–D.

## 3. User experience

**Publishing under pressure.** The `#911` rumor is trending. The PIO opens The Wire Room from the portal nav, hits "New Release," and gets a purposeful, low-friction editor — letterhead already loaded for their org, contact block prefilled. They drop the approved PDF their team finished, it renders cleanly inline, they attach the graphic, and face the decision: release now or embargo for the 14:00 press conference. They publish now and check "post to our social account." The release hits the wire, the portal module, and their org's feed simultaneously. Within minutes, replies accumulate on the social post and a news outlet (controller) quotes the release — accurately this time.

**The evaluator's view.** The evaluator sees the release drafted at 13:12, published 13:41 — 29 minutes, and 67 minutes after the rumor first trended — attributed to the specific JIC member who hit publish. The draft history shows the legal-sounding hedge added in revision 3. All of it lands in the E10 timeline automatically.

**Design notes.** The wire should look like a real municipal/agency newsroom-meets-PR-wire: austere, credible, letterhead-forward — a deliberate tonal contrast with E2's noise. Authoring UX must be forgiving under stress: autosave, clear embargo state ("Scheduled — releases in 19m"), no destructive actions without confirmation. **→ D4-001…003/006 (refined):** the composer is the letterhead sheet (PDF drop = body; headline auto-suggested), autosave is ambient (not a control), the scheduled state is redundant across three surfaces, and there is exactly one confirmation gate.

## 4. Out of scope

Press-conference simulation (live video/AV — future consideration), media-inquiry inbox (DM flows in E2 cover the interim), multi-org joint releases beyond the JIC-account pattern (PRS-001).

## 5. Open questions

1. Should embargoed releases be visible to media personas pre-release (real embargo behavior, enabling "outlet breaks the embargo" scenarios)? Compelling but adds workflow — recommend post-launch.
2. ~~PDF-first vs. rich-text-first~~ **Resolved:** PDF-first (PRS-002).
