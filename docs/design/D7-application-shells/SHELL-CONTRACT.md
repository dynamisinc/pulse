# SHELL-CONTRACT.md — Pulse application shells (D7)

The interface every channel design session and story agent builds against.
Mockups: `Pulse Shell.dc.html` (participant) · `Pulse Staff Shell.dc.html` (staff).
Decisions: DECISIONS.md D7-001…D7-008.

---

## 1. The shell owns / channels own

### Participant shell owns (COR-060)
| Layer | What | Notes |
|---|---|---|
| Compliance chrome | Two fixed 22px banners at absolute viewport top + bottom, green `#2e6b2e`, Figtree 10px caps `.14em` tracking, visually OUTSIDE the app frame (COR-031). Text + colors config-driven; layout must not depend on their presence (chrome-off is a legal state). | D1's containment model is canonical: the app zone is inset between them. |
| Alert bar host | Directly below top chrome, above channel nav. States: none / info / advisory / emergency (PRT-010/011). Severity = icon + text chip + color, never color-only (NFR-001). Scenario timestamp + Details link-through (→ alerts history, PRT-012). Persists across every channel. | Channels supply alert *content* (D2 patterns); the shell supplies the container, severities, collapse, and stacking. |
| Channel nav | Desktop: one 38px global strip under the alert bar — channel names as plain links, current channel marked, scenario dateline at right (COR-061/062). Mobile: bottom tab bar, 5 slots. Config-driven: a disabled channel appears nowhere (matches D2-005). | Channels never render their own cross-channel nav. Their own mastheads/section navs are theirs. |
| Scenario time | The shell is the single source for "now" in scenario time (COR-053/062): the strip dateline, alert timestamps, and the value channels use for "2h ago"/datelines. Never annotated as "scenario time" inside the fiction. | |
| Content region | The rectangle between nav and bottom chrome. The shell imposes ZERO styling inside it — no inherited fonts, colors, or resets beyond the browser's. | |
| Overlay layer | Break-fiction broadcast (top z, covers chrome, CTL-024); pause + EndEx full-page states, each in-fiction and out-of-fiction (CTL-023, COR-054). Channels cannot draw above this layer. | |
| Variants | full · read-only (COR-015: interactive affordances ABSENT, never disabled) · kiosk (chrome-free + nav-free, PRT-040) · preview-as-participant (rendered inside the staff frame, COR-041). | Read-only is a shell-provided flag; channels honor it by not rendering affordances. |
| Theming hooks | Per-exercise brand tokens (COR-066/030). Zero hardcoded brands in shell code; "Fairhaven" strings in the mockup are demo config. | |

### Channels own
Everything inside the content region: masthead/brand, section nav, typography, color,
content, in-content interactivity, per-outlet skins (NWS-002), watermark slots on
high-risk templates (NFR-008). Also: alert CONTENT patterns (D2), in-fiction identity
UI (D1's "Posting as" chip is product UI, not shell — see retrofit notes).

### Staff shell owns (COR-063)
| Element | Spec |
|---|---|
| Header (56px) | Navy `#1e3a5f`: brand lockup (PULSE / SURFACE NAME) · exercise identity badge — exercise name + role/cell, static during conduct (COR-005) · scenario + wall clock pair · exercise state pill (text + dot, never color-only) · classification tag (`UNCLASSIFIED // FOUO`, mono, persistent on every staff screen) · staff presence · **Preview as participant** (COR-041). No separate exercise bar — D7-010 folded it into the header. **Addendum (2026-08-01, `docs/features/staff-navigation/`):** the brand lockup is now also the **surface launcher** (COR-071) — a role-gated menu of the staff surface registry (COR-070), reusing this element rather than adding a fourth chrome element, a rail, or a second toolstrip tenant. See `docs/01-platform-core-isolation.md` F1.7 and `STORY-UPDATES.md`'s new ADD entry. |
| Toolstrip | 56px right-edge dock, shell-owned container, two zones: shell-global tools on top (**Participant admin**, COR-017, on every staff surface), divider, then a surface zone where the surface registers its own tools (the controller toolbox docks here — it never draws its own strip). Badges per tool; consult-on-demand rule per D5-017. |
| Work area | The surface (console, evaluator dashboard) renders here and owns everything inside. |

### Classification strings (per world, config-driven)
Participant: `UNCLASSIFIED // EXERCISE` (+ "EXERCISE · EXERCISE" repetition, "ALL CONTENT
SIMULATED"). Staff: `UNCLASSIFIED // FOUO`. One config token per deployment, per world.

---

## 2. Alert bar component contract (PRT-010/011/012)

- **States:** `none` (zero height — no reserved space) · `info` · `advisory` · `emergency`.
- **Anatomy:** severity chip (icon + LABEL text) · message · scenario timestamp · "Details →" (routes to alerts history).
- **Palettes:** info `#edf3f9/#3d6a96` · advisory `#fff3dd/#b97a00` (D1/D2 exact) · emergency `#b3261e` solid, white text.
- **Collapse:** band info/advisory collapse on scroll to a one-line compact strip; tap re-expands. **Emergency never collapses and always escapes the ticker to the full band.** Alerts are in-fiction (simulated) — anything real-world is ONLY the break-fiction overlay, never the alert bar. Never user-dismissable.
- **Multi-alert:** ticker auto-rotates through active alerts (~3.5s, severity tab swaps per message); band/compact show highest severity + "+N more" chip that expands the stack in place.
- **A11y:** `role="status"`; severity carried by chip text; live-region announce on state change.
- Three visual treatments remain in the mockup as an exploration tweak — **ticker is the decided default** (D7-002, user decision); band/compact retained for comparison only. The scroll-collapse compact state applies to band; the ticker is already one-line and does not collapse.

## 3. Overlay layer contract (COR-065)

Z-order, bottom → top: content · channel nav · alert bar · pause/EndEx pages · compliance chrome · **break-fiction broadcast** (covers everything).

- **Break-fiction (CTL-024):** black field, amber hazard-stripe bars, monospace, "REAL-WORLD MESSAGE · EXERCISE CONTROL", message, **wall-clock time** (the only participant surface ever showing real time), "remains until cleared" line. NO dismiss affordance, no logo, no product type or color from either world. The console only *triggers* it.
- **Pause (CTL-023):** in-fiction = neutral "We'll be right back" maintenance page (system-ui, no exercise language); out-of-fiction = slate/mono "EXERCISE PAUSED" control page, scenario-clock-stopped line.
- **EndEx (COR-054):** in-fiction = "This service is no longer available"; out-of-fiction = "ENDEX" + hot-wash logistics.
- Only break-fiction gets the alarm treatment; pause/EndEx control pages share a calm slate/mono family.

## 4. Hard gates

1. Staff surfaces distinguishable from participant surfaces at thumbnail size: dark chrome + single top bar vs light world framed by two green banners. Never mix.
2. No instructional banners, no platform-added badges, nothing that needs explaining inside the fiction (XC-002, SOC-002).
3. Read-only: affordances absent, not disabled (COR-015).
4. Severity/state never color-only (NFR-001).
