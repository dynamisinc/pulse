# Claude Code Session Prompt — Update stories for D4 (Wire Room + Weather Desk) design decisions

Paste everything below into a new Claude Code session opened at the ScenarioForge/Pulse requirements repo.

---

You are updating the Pulse requirements/story docs and GitHub issues to reflect the APPROVED
design from design session D4 (The Wire Room press wire + The Weather Desk weather service).
The design package is attached in this folder (`design_handoff_press_weather/`). Read in this
order:

1. `README.md` (package overview)
2. `Wire Room + Weather Desk.dc.html` — open in a browser (needs `support.js` alongside).
   Both channels inside the participant shell; the host Tweaks panel drives states
   (`wireState`: normal/staged/embargoed/returned · `weatherState`: calm/watch/warning ·
   `storyboard`). Walk: wire → release permalink → Submit a release (composer: drop the PDF
   zone, use the suggested headline, toggle schedule + cross-post, publish, confirm) →
   Approvals → Weather → warning product.
3. `wx011-propagation-storyboard.png` — the propagation moment, four frames.
4. `D4-press-weather.md`, `SHELL-CONTRACT.md`, `COMPONENTS.md`, `D0-FOUNDATIONS.md` — the
   briefs the mockup answers.

## Approved design decisions to encode into stories

D4-001 — Composer = the letterhead sheet, not a form/CMS (PRS-002). Org letterhead + contact
block prefilled and rendered as the release artifact; the PDF drop target IS the body area;
headline is the only required input, auto-suggested from the PDF with one-click accept
(sign-off: auto-suggest IS in scope). Rich-text "paste from Word" is the quiet secondary
path. Verified stressed-PIO walkthrough: drop→publish under 60 seconds.

D4-002 — One confirmation gate; nothing publishes on drop (PRS-002/020). Publish opens a
single confirm sheet restating org / headline / timing / cross-post. Cancel-scheduled and
return-to-author also confirm; no destructive action without confirmation. Cancelling an
embargo notifies approvers and leaves a wire audit trace (sign-off #2).

D4-003 — Embargo state is unmistakable by redundancy (PRS-003): amber "⏱ SCHEDULED —
releases in 19m" banner on composer, author-view wire row, and permalink; the sheet's
"FOR IMMEDIATE RELEASE" line flips to "EMBARGOED — HOLD UNTIL {time}".

D4-004 — Pulse cross-post = explicit checkbox naming the org handle, unchecked by default,
rendering the exact link card that will post (PRS-013; card anatomy per COMPONENTS/D1).

D4-005 — Org switcher reuses the D1 "Posting as" chip (COR-018): "Releasing as {org} ▾",
granted orgs only, letterhead/contacts/handle swap live. One identity at a time (SOC-006).

D4-006 — Autosave is ambient state in the sheet header, never a control (PRS-004).

D4-007 — Approval gate is participant paper, not staff chrome (PRS-021): pending list +
draft-diff (struck removals, shaded additions), approve = confirm chip then releases;
return REQUIRES a note; the returned note surfaces in the author's composer banner.
Sign-offs: approval routing is per-exercise config with per-org defaults (#1); returns stay
wire-internal, no Pulse/portal notification — flagged open to explore (#3).

D4-008 — The wire is public to ALL participants, citizens included (sign-off #5) (PRS-010).

D4-009 — Weather Desk speaks NWS verbatim (WX-010, NFR-001): weather.gov anatomy, zone
selector (WX-004), IBW What/Where/When/Impacts grid, monospace product text with NWS
furniture (...HEADLINE..., PRECAUTIONARY/PREPAREDNESS ACTIONS, && / $$), Issued/Effective/
Expires in scenario time (COR-053). Severity always icon + WATCH/WARNING text chip + color,
never color-only. NWS hues darkened slightly for WCAG AA white-text contrast (sign-off #8).

D4-010 — Warning feeds the shell alert bar per SHELL-CONTRACT §2 (WX-011, PRT-010/011):
watch = advisory ticker; warning = emergency band that escapes the ticker. EVERY warning
type forces the emergency band, for now (sign-off #6). The bar carries all alerts together
— weather and non-weather rotate/stack in one multi-alert bar (sign-off #7). Same headline
string on bar, @WeatherDesk post, portal widget, and product page — no paraphrase.

D4-011 — @WeatherDesk auto-post is editable pre-publish, console-side; default text is the
product headline verbatim (sign-off #10). Weather authoring is staff-side only via the
controller console — the Weather Desk has NO participant composer (sign-off #9). Both are
D5 console retrofit notes, not participant-surface stories.

D4-012 — Radar/cone imagery slot (WX-013) reserves the bottom-right EXERCISE watermark chip
(NFR-008, matches portal D2-008) — the highest-risk leak template is covered.

## Your tasks

1. Locate the press-room and weather-source epics (e.g. `05-press-room.md`,
   `06-weather-source.md`) and every story carrying these IDs: PRS-001…005, PRS-010…013,
   PRS-020…022; WX-001…004, WX-010…013, WX-020…022; plus cross-refs COR-018, COR-053,
   NFR-001, NFR-008, PRT-010/011, SOC-006.
2. Update each story's design-notes/acceptance criteria to cite the decisions above (use
   the D4-001…012 anchors). Flag any story text that CONFLICTS with the approved design
   (e.g. form-style composer, participant weather authoring, color-only severity, publish
   without confirmation) rather than silently rewriting intent — list conflicts in the PR
   description.
3. Encode the open items as explicit backlog notes, not silent gaps: return-notification
   reach beyond the wire (explore later), mobile pass (deferred), real inline PDF rendering
   and paste-from-Word behavior (build work; mocked in the design), alerts history page
   (PRT-012, still stubbed).
4. Keep requirement IDs stable; do not renumber. Add, don't destroy: mark superseded text
   as superseded with a pointer.
5. GitHub: create a branch `design/d4-press-weather-stories`, commit the doc updates, open
   a PR titled "D4 Wire Room + Weather Desk: sync stories to approved design" with a
   summary table (story ID → change), the conflict list, and a reference to this handoff
   package. Update or comment on any open GH issues tracking these PRS/WX stories so they
   point at the PR. Add the two D5 console retrofit notes (editable @WeatherDesk auto-post;
   weather authoring console-side) to whatever tracks console follow-ups.
6. Do NOT write frontend code in this session; this is a docs/stories sync only.
