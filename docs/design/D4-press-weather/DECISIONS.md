# DECISIONS.md — The Wire Room & The Weather Desk (D4)

Running log of design decisions for the Press wire (**The Wire Room**, E5/PRS) and Weather
service (**The Weather Desk**, E6/WX) mockup. Each entry records the choice and the requirement
IDs it satisfies or **amends**. This file goes back to the story/epic agents so design and
requirements stay aligned — see [`STORY-UPDATES.md`](STORY-UPDATES.md) for the actionable
amend/add/reconcile/backlog checklist.

Session 5 (D0 §6 order) · Phase 3 surfaces, smaller & institutional · both channels render
inside the D7 participant shell ([`SHELL-CONTRACT.md`](SHELL-CONTRACT.md)); the Weather Desk feeds
the shell alert bar. Anchors: municipal newsroom / PR Newswire (Wire Room) and weather.gov / NWS
(Weather Desk). **Status: full clickable mockup, user-approved, including 12 review sign-offs
(D4-013).** Evidence anchors below are class/handler names in
[`Wire Room + Weather Desk.dc.html`](Wire%20Room%20%2B%20Weather%20Desk.dc.html).

---

## Part A — The Wire Room (PRS)

## D4-001 — The composer is the letterhead sheet, not a form/CMS
**Decision.** The release composer renders as the finished release artifact: org letterhead +
contact block prefilled and shown as the sheet. The **PDF drop zone IS the body area** (PDF-first,
PRS-002); **headline is the only required input**, auto-suggested from the dropped PDF with a
one-click **"Use as headline"** accept. Rich-text **"Paste from Word"** (formatting kept, sanitized
per NFR-004) is the quiet *secondary* path, not a co-equal tab.
**Sign-off.** Headline **auto-suggest IS in scope** (not a later nicety). Verified against a
stressed-PIO walkthrough: **drop → publish in under 60 seconds.**
**Evidence.** `placeholder="Release headline"`, `From the PDF: "{{sug}}"` + `Use as headline`
(`{{useSug}}`), `Paste from Word instead →` (`{{toRich}}`), `back to PDF drop` (`{{toDrop}}`).
**Satisfies / amends.** PRS-002 (AMEND: adds headline-only-required + auto-suggest + one-click
accept; confirms PDF-first primary, paste-from-Word secondary), PRS-004, NFR-004. Anti-pattern
avoided: CMS admin panel (D4 brief §Anti-patterns).

## D4-002 — Exactly one confirmation gate; nothing publishes on drop
**Decision.** Dropping a PDF never publishes. **Publish** opens a single confirm sheet restating
**org / headline / timing / cross-post** before anything goes out. **Cancel-scheduled** and
**return-to-author** also confirm. No destructive action without confirmation.
**Sign-off (#2).** Cancelling an embargo **notifies approvers and leaves a wire audit trace.**
**Evidence.** `Confirm …` gates; `Publish now` / `Schedule (embargo)` (`{{setNow}}`/`{{setSched}}`).
**Satisfies / amends.** PRS-002, PRS-020 (AMEND: one-gate model; cancel-embargo → approver
notification + audit trace). Aligns with E5 §3 design note "no destructive actions without
confirmation."

## D4-003 — Embargo state is unmistakable by redundancy
**Decision.** A scheduled (embargoed) release shows an amber **"⏱ SCHEDULED — releases in 19m"**
treatment in **three** places: the composer, the author-view wire row, and the release permalink.
On the sheet, the **"FOR IMMEDIATE RELEASE"** line flips to **"EMBARGOED — HOLD UNTIL {time}"**.
Scheduled releases are visible to the author + staff/JIC approvers only, invisible to the public
until release.
**Evidence.** `⏱ SCHEDULED` + `releases at 3:06 PM · in 19m` (wire row), permalink banner
"Releases at 3:06 PM — in 19m. Visible to your organization and JIC approvers only.",
`FOR IMMEDIATE RELEASE` / `EMBARGOED`.
**Satisfies / amends.** PRS-003 (AMEND: the redundant, three-surface scheduled-state treatment +
the sheet headline flip).

## D4-004 — Pulse cross-post is an explicit, unchecked-by-default checkbox with a live card
**Decision.** The "post to our social account" decision (PRS-013) is an **explicit checkbox naming
the org handle, unchecked by default**, and it renders the **exact link card** that will post
(card anatomy per [`COMPONENTS.md`](COMPONENTS.md) / D1). Deciding *whether and how* to socialize a
release is PIO craft being evaluated, so it is a visible decision, never an implicit side effect.
**Evidence.** `cross-post` toggle + `link card` preview.
**Satisfies / amends.** PRS-013 (AMEND: unchecked default; names the handle; live link-card
preview).

## D4-005 — Org switcher reuses the D1 "Posting as" chip, as "Releasing as {org} ▾"
**Decision.** Multi-org / JIC authors switch org identity via the **same D1 chip pattern** (COR-018)
— labelled **"Releasing as {org} ▾"** — granted orgs only; letterhead, contact block, and paired
handle swap live. **One identity at a time** (SOC-006).
**Evidence.** `Releasing as {{curOrg.name}} ▾` (`{{toggleOrgMenu}}`); letterhead/`MEDIA CONTACT`
bound to `{{curOrg.*}}`.
**Satisfies.** PRS-001, COR-018, SOC-006. Reuses E1 org-grant + attribution and the E2/D1 chip
(see [`../../features/posts/06-post-as-organization.md`](../../features/posts/06-post-as-organization.md),
[`../../features/identity-auth-roles/09-org-account-operation.md`](../../features/identity-auth-roles/09-org-account-operation.md)).

## D4-006 — Autosave is ambient state in the sheet header, never a control
**Decision.** Autosave shows as a passive status line (dot + "Saved …") in the sheet header; there
is no Save button. The draft edit timeline is retained for evaluation (PRS-004, disclosed per
NFR-007).
**Evidence.** `{{autosave}}` with a green status dot in the composer header.
**Satisfies / amends.** PRS-004 (AMEND: autosave is presented as ambient state, not an action).

## D4-007 — The approval gate is participant paper, not staff chrome
**Decision.** The JIC/legal approval gate (PRS-021) renders in the **wire's letterhead world**, not
staff console chrome: a **pending list** + a **draft-diff** (struck removals, shaded additions).
**Approve** = a confirm chip, then it releases. **Return REQUIRES a note**; the returned note
surfaces in the author's composer as a **"↩ RETURNED FOR REVISION"** banner.
**Sign-offs.** **(#1)** Approval routing is **per-exercise config with per-org defaults** (off by
default stays true). **(#3)** Returns stay **wire-internal — no Pulse/portal notification** — this
is flagged **open to explore** (see STORY-UPDATES open items), not a shipped guarantee.
**Evidence.** `Approvals` (JIC) tab, `↩ RETURNED FOR REVISION` banner + returner/time, `diff`.
**Satisfies / amends.** PRS-021 (AMEND: participant-surface gate; mandatory return note; returned
note surfaces to author; per-exercise routing + per-org defaults), EVL-010 (approval latency still
captured). **Reconcile:** E5/PRS-021 currently frames the approver as "a participant role or a
controller playing that role" — the *gate UI* is participant paper regardless of who operates it
(a controller uses preview-as-participant / the participant approval view).

## D4-008 — The wire is public to ALL participants, citizens included
**Decision.** The Wire Room is a public destination for every participant, not a
PIO/media-only surface.
**Sign-off (#5).** Confirmed: citizens can read the wire.
**Satisfies.** PRS-010, PRS-011, PRS-012.

---

## Part B — The Weather Desk (WX)

## D4-009 — The Weather Desk speaks NWS verbatim
**Decision.** weather.gov anatomy: zone selector (WX-004), the IBW **What / Where / When / Impacts**
grid on the warning product (WX-010), monospace product text with NWS furniture (`...HEADLINE...`,
`PRECAUTIONARY/PREPAREDNESS ACTIONS`, `&&` / `$$`), and **Issued / Effective / Expires** in scenario
time (COR-053). Severity is **always icon + WATCH/WARNING text chip + color — never color-only**.
**Sign-off (#8).** NWS hues **darkened slightly** so white text clears **WCAG AA** contrast
(warning renders `#8b0000`; watch `#2e6b4f`), while staying recognizably NWS so participants'
instincts transfer.
**Evidence.** `⚠ WARNING`/`WATCH` chips, `Public Sans` product type, `What:`/`Where:`/`When:`/
`Impacts:`, `PRECAUTIONARY`, `#8b0000` warning / `#2e6b4f` watch.
**Satisfies / amends.** WX-001, WX-004, WX-010 (AMEND: IBW grid + NWS furniture specifics),
NFR-001 (icon+text+color; AA-adjusted hues), COR-053.

## D4-010 — A warning feeds the shell alert bar per SHELL-CONTRACT §2
**Decision.** Watch = **advisory ticker**; warning = **emergency band that escapes the ticker** and
forces the full band on **every** channel (portal, Pulse, Wire Room alike). The bar carries **all**
alerts together — weather and non-weather **rotate/stack in one multi-alert bar**. The **same
headline string** appears on the bar, the @WeatherDesk post, the portal widget, and the product
page — **no paraphrase**.
**Sign-offs.** **(#6)** For now, **every warning type forces the emergency band** (no per-type
severity mapping yet — a deliberate, revisit-later simplification). **(#7)** One shared multi-alert
bar for weather + non-weather.
**Evidence.** `wx011-propagation-storyboard.png` (four surfaces, one string); alert-bar cards
`abTicker`/`abBand`; "emergency escapes the ticker and forces the full band … (PRT-010)".
**Satisfies / amends.** WX-011 (AMEND: warning⇒emergency-band "for now"; multi-alert shared bar;
verbatim headline propagation), PRT-010, PRT-011, SHELL-CONTRACT §2.

## D4-011 — @WeatherDesk auto-post is editable pre-publish and console-side; weather is staff-authored only
**Decision.** The @WeatherDesk auto-post (WX-011/WX-020) is **editable before publish, on the
console side**; default text is the **product headline verbatim**. Weather authoring is
**staff-side only via the controller console** — the Weather Desk has **NO participant composer**.
**Sign-offs.** **(#9)** No participant weather authoring. **(#10)** Auto-post text is editable
pre-publish (console-side).
**Satisfies.** WX-011, WX-020, WX-002/WX-012 (staff authoring). **Routing:** both are **D5
controller-console retrofit notes**, not participant-surface stories — routed to
[`../D5-controller-console/STORY-UPDATES.md`](../D5-controller-console/STORY-UPDATES.md) §E.

## D4-012 — The radar/cone imagery slot reserves the EXERCISE watermark chip
**Decision.** The WX-013 imagery slot reserves the bottom-right **EXERCISE** watermark chip
(NFR-008), matching portal D2-008. Warning products are the highest-risk leak class in the product,
so this is the template that is covered first.
**Evidence.** RADAR tile with absolute bottom-right `EXERCISE` chip (`rgba(46,107,46,.92)`).
**Satisfies / amends.** WX-013, WX-002 (watermark-on-warning), NFR-008 (AMEND: names the reserved
slot + placement).

---

## D4-013 — Package sign-off (12 review sign-offs)
**Decision.** The mockup is user-approved with 12 explicit review sign-offs, folded into the
decisions above. Roster (anchor → decision):

| # | Sign-off | Home |
|---|----------|------|
| 1 | Approval routing = per-exercise config, per-org defaults | D4-007 |
| 2 | Cancel-embargo notifies approvers + wire audit trace | D4-002 |
| 3 | Returns stay wire-internal (no Pulse/portal notification) — **open to explore** | D4-007 |
| 4 | Cross-post is opt-in (unchecked default), names handle, live card | D4-004 |
| 5 | The wire is public to all participants, citizens included | D4-008 |
| 6 | Every warning type forces the emergency band, **for now** | D4-010 |
| 7 | One multi-alert bar carries weather + non-weather together | D4-010 |
| 8 | NWS hues darkened for WCAG AA white-text contrast | D4-009 |
| 9 | Weather authoring is staff-side only (no participant composer) | D4-011 |
| 10 | @WeatherDesk auto-post is editable pre-publish (console-side) | D4-011 |
| 11 | Headline auto-suggest from the PDF is in scope | D4-001 |
| 12 | Autosave is ambient state, never a control | D4-006 |

> Sign-offs #3 and #6 are explicitly provisional ("open to explore", "for now") and are logged as
> open items in [`STORY-UPDATES.md`](STORY-UPDATES.md), not as settled guarantees.
