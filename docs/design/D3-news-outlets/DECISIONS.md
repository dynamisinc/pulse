# DECISIONS.md — Pulse News Outlets (D3), proposal stage

Per-surface decision log (convention per the D1/D5 handoff dirs). Proposal-stage session:
the shared-grid + token-surface contract and the four outlet registers were reviewed and
**approved**; the full clickable mockup follows as its own deliverable. Anchor per the D3
brief: **real local news sites** — a TV station site, a newspaper site, a wire feed, a
gossip site. Credibility is conveyed by design, and *reading* credibility is the skill
being trained.

> The central `../DECISIONS.md` gains this section in a follow-up — that file is
> mid-flight on two open branches (E8 reconciliation, D7 shells) and is not edited here.

---

## D3-P1 — ONE rendering system; four outlet skins as token files (NWS-002)

**Decision.** One article/homepage rendering system; each outlet is a **skin token file**
over it. A fifth outlet is a token file, not a new build. The article page's slot anatomy
is **invariant** across all skins:

1. Shell chrome — owned by the shell, never re-implemented (SHELL-CONTRACT §1: compliance
   chrome, alert bar, channel strip; outlet pages render in the content region only)
2. Outlet masthead + section nav *(skin)*
3. Breaking slot — authorial, **empty by default** (NWS-012)
4. Kicker → headline → dek *(skin type/case/scale; order fixed)*
5. Byline · scenario dateline · share *(fixed: persona block + COR-053 time — skins format,
   never source; share → Pulse link card)*
6. Hero media — image or Beat video, broadcast-style player (NWS-014) — with reserved
   **EXERCISE watermark chip, bottom-right** (NWS-032/NFR-008, matches portal D2-008)
7. Body + pull quote *(skin)*, with **embedded Pulse post** rendered to D1 anatomy
   verbatim (SOC-002/004)
8. Correction slot (NWS-013)
9. Footer: **"Join the discussion on Pulse"** → the outlet's paired post (NWS-031 — no
   comments, ever)

Grid (exhibit 1a): desktop 12-col well, max 1140px; body column 680px (~66ch); optional
340px rail is a skin token. Mobile: one column; rail folds below the body.

**Alternatives rejected.** Bespoke per-outlet layouts — kills the fifth-outlet promise and
re-implements the shell boundary per outlet; the brief's anti-pattern list names
one-skin-fits-all *and* per-outlet builds as the two failure modes.
**Satisfies.** NWS-002/003/010/011/012/013/014/031/032, SHELL-CONTRACT §1, D2-008 parity.

## D3-P2 — The token surface: what a skin CAN and CANNOT touch

**Decision.** A skin **CAN** set: type stack (masthead/hed/dek/body/kicker — face, weight,
case, condensation) · palette (accent, link, bg, rules, breaking color) · density (spacing
scale, rule weights, corner radius) · media treatment (crop aggression, caption style,
player chrome tint) · breaking treatment (banner style + vocabulary) · byline/dateline
format · layout enums (rail on/off; homepage lead mode: `video-lead / text-lead /
list-lead / clutter`) · clutter modules (sanctioned set, **The Scoop only** — busyness as
untrustworthiness signal).

A skin **CANNOT** touch: slot order/anatomy · the scenario-time source (COR-053 — formats
vary, the clock doesn't) · Pulse embed + link-card rendering (D1 anatomy verbatim, seal
`#2D9CDB` fixed — SOC-002/004) · the watermark slot (NFR-008) · share behavior (always
posts an outlet link card to Pulse) · the no-comments rule (NWS-031) · the a11y floor
(NFR-001: AA contrast, ≥16px mobile body, correction-slot semantics) · telemetry
invisibility (NWS-030 — zero reader-visible UI).

**Rationale.** The CAN list is exactly the credibility-register surface (what makes The
Scoop read untrustworthy); the CANNOT list is every trainable signal and compliance
guarantee — those must survive any rebrand, exactly as the verified seal survives exercise
accent theming (D1-003/R-001 precedent).
**Satisfies.** NWS-001/002/030/031, COR-053, SOC-002/004, NFR-001/008.

## D3-P3 — The four approved registers (exhibit 1b)

**Decision.** Approved type/palette per outlet token file:

| Outlet | Register | Type | Palette / idiom |
|---|---|---|---|
| **Newsline 7** | Local TV | Oswald (condensed heds) + Source Sans 3 | Navy `#0f2749`, red `#c8102e`; ● LIVE chip; kicker "BREAKING · WATER CRISIS"; video-forward |
| **The Courier-Ledger** | Newspaper | Newsreader serif (+ Source Sans 3 meta) | Centered nameplate with double rule; restrained grays; small-caps kicker; "By X, Staff Writer" byline; text-forward |
| **The National Wire** | Wire service | IBM Plex Sans + IBM Plex Mono | Timestamp-first (mono, rust `#9a3412`); slug codes (`NW-FAIRHAVEN-WATER-0142`); wire dateline "**FAIRHAVEN, Fulton County (NW) —**"; "BY THE NATIONAL WIRE"; terse heds, minimal art |
| **The Scoop** | Tabloid | Anton (ALL-CAPS heds) + Figtree | Yellow `#ffd400`, magenta `#e6007e`, black; rotated flags ("EXCLUSIVE!!"); yellow highlight marks in heds; chip clutter (TRENDING / SHOCKING / MUST SEE) |

Reading the grid of four: trust decays through type discipline (condensed-urgent →
serif-measured → mono-austere → display-screaming), palette restraint, and clutter count.
The Scoop's chips/rotation/highlights come from its sanctioned clutter-module set — no
other skin can enable them.

**Satisfies.** NWS-002 (credibility diversity as a training feature), D3 brief §"The four
skins", E4 §3 ("participants should be able to *feel* source quality").

## D3-P4 — Breaking is authorial only; corrections have exactly two renderings

**Decision.** **Breaking (NWS-012):** the outlet's own banner in the outlet's own
vocabulary, in the breaking slot, which is empty by default and fills only by
controller/authorial action. The platform never adds badges (SOC-002 parity — the *outlet*
screams BREAKING, Pulse never does). Banner style + vocabulary are skin tokens
("BREAKING NEWS" / "News Alert" / "EXCLUSIVE!!").

**Corrections (NWS-013):** two renderings, both scenario levers, controller-selectable per
correction: **visible editor's-note append** (skin-styled; slot position and semantics
fixed) or **silent rewrite** (body text changes; only the "Updated" scenario-time stamp
changes). An outlet that quietly rewrites vs. transparently corrects is itself a
credibility signal participants can learn.

**Satisfies.** NWS-012/013, SOC-002, COR-053 (the Updated stamp is scenario time).

---

## Status caveat / open / deferred

- **Approved = exhibits 1a/1b only** (grid contract + registers). Article page, homepage,
  breaking state, both correction states, mobile view, and the skin switcher arrive in the
  full-mockup package; do not mark implementation-ready ACs "design final" beyond 1a/1b.
- **Authoring UI (NWS-020…022)** is controller-console territory (E7/D5 patterns); D3
  designed the participant-facing rendering only.
- **Homepage** (NWS-003): lead-mode enum decided (D3-P2); the module set and per-skin
  homepage compositions are full-mockup work.
- **D2 cross-surface note:** the portal's "print" direction (D2-002) risks reading as the
  Courier-Ledger register; portal default remains broadcast (already noted in the D2 log).
