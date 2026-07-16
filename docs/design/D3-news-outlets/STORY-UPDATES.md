# Story Updates — Pulse News Outlets (D3)

> **Purpose.** The approved D3 proposal (exhibits 1a/1b + decisions `D3-P1…P4`, see
> [`DECISIONS.md`](DECISIONS.md)) **changes or sharpens requirements as written**. This
> checklist is the input for the story/epic agents. E4 is not yet decomposed into
> `docs/features/` (Phase 3) — boxes stay unchecked until the decomposition folds each
> item in; each item names the requirement ID, the decision, the before → after, and the
> action. Verify each "before" against the current epic text (`../../04-news-network.md`)
> when editing.

Legend: **AMEND** = edit existing requirement · **ADD** = new requirement/capability ·
**RECONCILE** = supersede/settle an earlier open question · **BACKLOG** = defer as a
future story.

---

## A. Requirement amendments / sharpenings

- [ ] **NWS-002 — outlet identities are skin TOKEN FILES over one rendering system** · `D3-P1`, `D3-P3`
  - **Before:** "Outlet templates ship in the cast library with distinct visual identities…"
    (silent on how distinctness is built).
  - **After:** ONE article/homepage rendering system; each outlet's identity is a **token
    file**; **a fifth outlet is a token file, not a new build**. Slot anatomy is invariant
    (D3-P1); the four approved registers' type/palette values are the token files' starting
    contents (D3-P3).
  - **Action:** decompose E4 into an article-system feature (owns slots + grid) plus
    skin-token stories; AC: adding an outlet touches zero layout code.

- [ ] **NWS-010 — article model gains kicker; model fields map 1:1 to the fixed slots** · `D3-P1`
  - **Before:** headline, dek, hero media, rich body (pull quotes, embedded posts), byline,
    category, timestamps, outlet — no kicker, breaking, or correction fields.
  - **After:** add **kicker** (optional, authorial); **breaking-slot content** (empty
    default, NWS-012); **correction entries** (NWS-013, two renderings); share affordance.
    The slot anatomy (shell chrome → masthead/nav → breaking → kicker → hed → dek →
    byline/dateline/share → hero + watermark chip → body + pull quote + Pulse embed →
    correction slot → discussion footer) is the model's rendering contract.
  - **Action:** the article-model story carries the slot list as its AC skeleton.

- [ ] **NWS-003 — homepage lead mode is a skin layout enum** · `D3-P2`
  - **Before:** "lead story, category sections, latest list."
  - **After:** same content set; lead presentation is a token-file enum —
    `video-lead / text-lead / list-lead / clutter` — plus rail on/off. `clutter` is legal
    for **The Scoop only**.
  - **Action:** homepage story ACs enumerate lead modes and test the Scoop-only guard.

- [ ] **NWS-012 — breaking is a SLOT, empty by default; vocabulary is a skin token** · `D3-P4`
  - **Before:** "Breaking-news treatment is authorial, not platform chrome…"
  - **After:** sharpened — a dedicated breaking slot in the anatomy, **empty by default**,
    fills only by authorial/controller action; banner style + vocabulary per skin
    ("BREAKING NEWS" / "News Alert" / "EXCLUSIVE!!"); the platform adds nothing (SOC-002
    parity).
  - **Action:** breaking story AC: default-empty slot + per-skin vocabulary + zero
    platform chrome.

- [ ] **NWS-013 — corrections have exactly TWO renderings (settles append-vs-rewrite tension)** · `D3-P4`
  - **Before:** "Updates/corrections **append an editor's note** — correction behavior is
    itself a scenario lever (an outlet that quietly rewrites vs. transparently corrects)."
    The normative sentence (always append) contradicted the lever (quiet rewrite).
  - **After:** two renderings, controller-selectable per correction: **visible
    editor's-note append** (skin-styled; slot position/semantics + a11y fixed) or **silent
    rewrite** (only the "Updated" scenario-time stamp changes).
  - **Action:** corrections story designs and tests both renderings; conflict flagged in
    the sync PR rather than silently rewritten.

- [ ] **NWS-014 — one broadcast-style player; treatment is tokenized** · `D3-P1`, `D3-P2`
  - **Before:** "Embedded video plays inline with a broadcast-style player."
  - **After:** hero media (image or Beat video) is a fixed slot with one shared player;
    **player chrome tint, crop aggression, caption style are skin tokens** — playback
    anatomy is shared.
  - **Action:** player story separates the shared player from per-skin treatment tokens.

- [ ] **NWS-032 — watermark slot position fixed NOW: chip bottom-right on hero media** · `D3-P1`
  - **Before:** "in-content 'EXERCISE' watermarking applies per NFR-008 once available
    (banners-only at launch)."
  - **After:** the reserved slot is designed now — **corner chip, bottom-right of hero
    media**, matching portal D2-008; position/reservation is on the CANNOT list
    (skin-proof).
  - **Action:** hero-media story reserves the chip slot from day one.

- [ ] **NWS-031 — "Join the discussion on Pulse" is a FIXED footer slot; no comments, ever** · `D3-P1`
  - **Before:** "Comments on articles are out of scope **at launch**…; an outlet page
    links to 'discussion' on its social post instead." ("At launch" left a door open.)
  - **After:** the discussion footer is a fixed slot closing every article, linking the
    outlet's paired Pulse post; **no comments, ever** — the rule is on the CANNOT list.
    (Deliberate hardening of "at launch" → "ever"; flagged in the sync PR.)
  - **Action:** AC pins the slot, the link target (paired E2 post), and the absence of any
    comment affordance in every skin.

- [ ] **NWS-030 — telemetry invisibility is a skin-proof invariant** · `D3-P2`
  - **Before:** views/dwell/share-outs captured per session (session-level evidence per
    the D9 adversarial fix).
  - **After:** capture semantics unchanged + **zero reader-visible UI** is on the CANNOT
    list — no skin can surface view/dwell.
  - **Action:** telemetry AC adds a "no visible UI in any skin" check.

- [ ] **NWS-001 — outlet brand config resolves to a token file, bounded by the CANNOT list** · `D3-P2`
  - **Before:** "…its own brand: name, logo, color scheme, tagline, category set"
    (reads as free-form per-persona styling).
  - **After:** brand fields select/parameterize a **skin token file**; no brand config can
    override slot anatomy, the scenario-time source (COR-053), Pulse embed/link-card
    rendering (D1 anatomy verbatim, seal `#2D9CDB` — SOC-002/004), the watermark slot,
    share behavior, the no-comments rule, the a11y floor (AA contrast, ≥16px mobile body,
    correction semantics), or telemetry invisibility.
  - **Action:** the outlet-persona story constrains the config surface to the token schema.

- [ ] **NWS-011/NWS-015 — share + embed contracts are fixed, both directions** · `D3-P1`, `D3-P2`
  - **Before:** articles are link-previewable in E2 (SOC-004) and featurable on the portal
    (PRT-004); share affordances unspecified.
  - **After:** the article share affordance **always posts an outlet link card to Pulse**;
    the **embedded Pulse post** inside article bodies renders D1 anatomy verbatim —
    pixel-consistent in both directions; skins restyle neither.
  - **Action:** embed/link-card stories cite the D1 component contract; add a
    cross-channel visual-consistency AC.

## B. New requirements / capabilities to add

- [ ] **ADD — skin token schema** · `D3-P2`
  - The CAN list as a formal schema: type stack (masthead/hed/dek/body/kicker — face,
    weight, case, condensation) · palette (accent/link/bg/rules/breaking) · density
    (spacing scale, rule weights, radius) · media treatment (crop, caption, player tint) ·
    breaking treatment (banner style + vocabulary) · byline/dateline format · layout enums
    (rail on/off; homepage lead mode) · clutter modules (sanctioned set, Scoop-only flag).
  - **Action:** the schema story is the NWS-002 fifth-outlet interface; a new outlet =
    a new token file validating against it.

- [ ] **ADD — article grid spec** · `D3-P1` (exhibit 1a)
  - Outlet pages render in the **shell content region only** (SHELL-CONTRACT §1 — shell
    owns compliance chrome, alert bar, channel strip, and the scenario-time source).
    Desktop: 12-col well, max 1140px; body column 680px (~66ch); optional 340px rail is a
    skin token. Mobile: one column; rail folds below body; body text ≥16px (NFR-001).
  - **Action:** grid story; mobile-first per D0 §4.6 (shared links open on phones).

- [ ] **ADD — The Scoop clutter-module set** · `D3-P2`, `D3-P3`
  - A sanctioned module set (chip rows — TRENDING / SHOCKING / MUST SEE, rotated flags,
    yellow highlight marks): the ONE sanctioned busy design in the product — busyness as
    untrustworthiness signal. No other skin can enable it.
  - **Action:** own story with the Scoop-only enforcement AC.

- [ ] **ADD — approved register token values** · `D3-P3`
  - Newsline 7: Oswald + Source Sans 3, navy `#0f2749` / red `#c8102e`, ● LIVE chip,
    video-forward. Courier-Ledger: Newsreader serif, centered nameplate w/ double rule,
    restrained grays, text-forward. National Wire: IBM Plex Sans + Plex Mono,
    timestamp-first (mono, rust `#9a3412`), wire slug dateline ("FAIRHAVEN, Fulton County
    (NW) —"), terse heds, minimal art. The Scoop: Anton ALL-CAPS heds + Figtree, yellow
    `#ffd400` / magenta `#e6007e` / black, rotated flags, chip clutter, yellow highlights.
  - **Action:** the four token-file stories seed from these values.

## C. Reconcile / settle

- [ ] **RECONCILE — E4 open question 1 (reporter bylines)** settled to **optional** ·
  `D3-P2/P3`: byline/dateline format is a skin token; org/staff bylines are legal
  ("BY THE NATIONAL WIRE", "By Scoop Staff"). Epic Q1 marked resolved.
- [ ] **RECONCILE — cross-surface:** D2-002's "print" portal direction risks reading as
  the Courier-Ledger register; portal default stays **broadcast** (already noted in the
  D2 log). No E4 text change.

## D. Not covered by this proposal (do not mark design-final)

- [ ] Full clickable mockup — article page, homepage compositions, breaking state, both
  correction states, mobile view, skin switcher — **next design deliverable**.
- [ ] **NWS-020…022 authoring UI** — controller-console territory (E7/D5 patterns); D3
  designed participant-facing rendering only.
- [ ] **NWS-004 paired social presence** — E2/D1 territory; D3 fixes only the
  share → link-card contract.

---

## Traceability at a glance

| Requirement | Decision(s) | Type | One-line change |
|---|---|---|---|
| NWS-002 | D3-P1, D3-P3 | AMEND | Identities are token files over ONE system; fifth outlet = token file |
| NWS-010 | D3-P1 | AMEND | Model gains kicker; fields map 1:1 to invariant slots |
| NWS-003 | D3-P2 | AMEND | Homepage lead mode enum (video/text/list/clutter); rail on/off |
| NWS-012 | D3-P4 | AMEND | Breaking slot empty by default; vocabulary is a skin token |
| NWS-013 | D3-P4 | AMEND | Exactly two correction renderings: visible note / silent rewrite |
| NWS-014 | D3-P1/P2 | AMEND | One shared player; tint/crop/caption are tokens |
| NWS-032 | D3-P1 | AMEND | Watermark chip bottom-right on hero, matches D2-008, skin-proof |
| NWS-031 | D3-P1 | AMEND | Fixed discussion footer; no comments **ever** (hardened from "at launch") |
| NWS-030 | D3-P2 | AMEND | Telemetry zero-UI is skin-proof |
| NWS-001 | D3-P2 | AMEND | Brand config resolves to a token file; CANNOT list binding |
| NWS-011/015 | D3-P1/P2 | AMEND | Share always posts link card; Pulse embed = D1 anatomy verbatim |
| — (token schema) | D3-P2 | ADD | The CAN list as the outlet-onboarding schema |
| — (grid spec) | D3-P1 | ADD | 1140px well / 680px body / 340px rail token; mobile folds |
| — (Scoop clutter) | D3-P2/P3 | ADD | Sanctioned clutter set, Scoop only |
| — (register values) | D3-P3 | ADD | Four approved token files' starting values |
| E4 open Q1 | D3-P2/P3 | RECONCILE | Bylines optional; format is a skin token |
| D2-002 print | — | RECONCILE | Portal avoids Courier-Ledger collision; broadcast default |
| mockup / authoring / social pairing | — | BACKLOG | Next package / E7 / E2 respectively |
