# E5 — Press Room

> **Epic ID:** E5 · **Requirement prefix:** PRS
> **Depends on:** E1 · **Feeds:** E3 (portal module), E2 (link cards), E10 (telemetry)
> **Roles served:** PIO participants (primary authors), Controllers, Evaluators
> **Looking Glass parity target:** Press Room Wire (PR14)

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

## 3. User experience

**Publishing under pressure.** The `#911` rumor is trending. The PIO opens The Wire Room from the portal nav, hits "New Release," and gets a purposeful, low-friction editor — letterhead already loaded for their org, contact block prefilled. They drop the approved PDF their team finished, it renders cleanly inline, they attach the graphic, and face the decision: release now or embargo for the 14:00 press conference. They publish now and check "post to our social account." The release hits the wire, the portal module, and their org's feed simultaneously. Within minutes, replies accumulate on the social post and a news outlet (controller) quotes the release — accurately this time.

**The evaluator's view.** The evaluator sees the release drafted at 13:12, published 13:41 — 29 minutes, and 67 minutes after the rumor first trended — attributed to the specific JIC member who hit publish. The draft history shows the legal-sounding hedge added in revision 3. All of it lands in the E10 timeline automatically.

**Design notes.** The wire should look like a real municipal/agency newsroom-meets-PR-wire: austere, credible, letterhead-forward — a deliberate tonal contrast with E2's noise. Authoring UX must be forgiving under stress: autosave, clear embargo state ("Scheduled — releases in 19m"), no destructive actions without confirmation.

## 4. Out of scope

Press-conference simulation (live video/AV — future consideration), media-inquiry inbox (DM flows in E2 cover the interim), multi-org joint releases beyond the JIC-account pattern (PRS-001).

## 5. Open questions

1. Should embargoed releases be visible to media personas pre-release (real embargo behavior, enabling "outlet breaks the embargo" scenarios)? Compelling but adds workflow — recommend post-launch.
2. ~~PDF-first vs. rich-text-first~~ **Resolved:** PDF-first (PRS-002).
