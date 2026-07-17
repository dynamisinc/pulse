# COMPONENTS.md — Pulse cross-surface component inventory

## Shell extraction (session 3, step 2b) — improvised container chrome

Both mockups improvised their own shell elements because no unified Pulse shell
existed when they were designed. Inventory below is extracted from the shipped
markup (class names are the evidence anchors in each `.dc.html`). **All items in
this section are marked: replaced by shell — see D7.** Nothing here is redesigned
in this pass; the D7 unified-shell session starts from this evidence.

### D1 — Pulse Social App (participant surface)

| Element | Anchor | What it improvised | Status |
|---|---|---|---|
| Exercise banner ×2 (top + bottom) | `.xb .xbt` / `.xb .xbb` | Fixed 22px strips, green `#2e6b2e`, Figtree 10.5px caps, `.14em` tracking. Top: "UNCLASSIFIED // EXERCISE · EXERCISE · EXERCISE — ALL CONTENT SIMULATED". Bottom: "PULSE TRAINING ENVIRONMENT — …". App frame is inset 22px top+bottom to clear them. | replaced by shell — see D7 |
| Advisory alert bar | `.abar` (+ `.asev`, `.alnk`) | Sticky in-app emergency banner, band `#fff3dd` / chip `#8a5a00` + white LABEL (chip darkened from `#b97a00` for WCAG AA — D7-012; own dark variant), toggled by `alertOn`. In-fiction content, but the container pattern is chrome. | replaced by shell — see D7 |
| Nav rail + logo | `.nav`, `.logo` | Left rail with hand-drawn Pulse waveform SVG logo + 5 nav rows (Home/Explore/Notifications/Messages/Profile) with badge. Product nav, but the rail container/logo lockup were improvised. | replaced by shell — see D7 |
| Identity switcher | `Posting as: {{cur.name}} ▾` chip + `.menu`/`.mi` | Account-switch chip + dropdown in composer (PIO multi-account). Staff-adjacent identity chrome. | replaced by shell — see D7 |
| Me card / account menu | `.mecard` + `Log out @dreyes_fh` flyout | Bottom-of-rail current-user card with logout flyout. | replaced by shell — see D7 |

### D5 — Controller Console (staff surface)

| Element | Anchor | What it improvised | Status |
|---|---|---|---|
| Exercise banner ×1 (top only) | `.exbar` | Single flex bar, dark `#0c1420`, mono 10px `.14em`, three segments: "EXERCISE — TRAINING USE ONLY · SIMULATED CONTENT" / `{{exName}} · SIMCELL` / "UNCLASSIFIED // FOUO". No bottom banner. | replaced by shell — see D7 |
| Header / brand lockup | `.hdr`, `.brand` (`.b1`/`.b2`) | Gradient dark header `#101c2c→#0c1622`; stacked "PULSE / CONTROLLER CONSOLE" wordmark (no logo glyph). | replaced by shell — see D7 |
| Exercise identity block | `.exsw`, `.exsw-btn` (`.e1`/`.e2`) | Fixed exercise name + "CONTROLLER · SimCell-1" role line (COR-005: identity immutable during conduct). | replaced by shell — see D7 |
| Clock cluster | `.clocks`, `.clk .scn` / `.clk .wall` | Scenario clock + wall clock pair in header. | replaced by shell — see D7 |
| Exercise state pill | `.state-pill` + `.dot` | Live conduct state (running/paused) with status dot. | replaced by shell — see D7 |
| Staff presence | `.presence` (3× `.av` S1/S2/DP) | SimCell/Director presence avatars in header. | replaced by shell — see D7 |
| Header action group | `.hgrp` (focus toggle, pause) | Focus-mode toggle + tiered pause button (CTL-023) as header chrome. | replaced by shell — see D7 |

### Divergences (evidence for D7)

1. **Banner count & placement** — D1 wraps content in two fixed banners (top + bottom); D5 has one top bar only, in document flow.
2. **Banner voice & classification text** — D1: "UNCLASSIFIED // EXERCISE · EXERCISE · EXERCISE"; D5: "UNCLASSIFIED // FOUO". Same platform, different classification strings.
3. **Banner styling** — D1: green `#2e6b2e`, Figtree; D5: dark navy `#0c1420`, mono. No shared token.
4. **Brand lockup** — D1: waveform SVG glyph + "Pulse" wordmark in nav rail; D5: text-only stacked lockup in header. Logo exists on one surface only.
5. **Exercise identity** — D5 shows exercise name + role persistently (COR-005); D1 shows none — a participant cannot see which exercise session they are in.
6. **Clocks** — D5: scenario + wall clock in chrome; D1: none (relative timestamps only).
7. **Identity/role chrome** — D1: "Posting as" chip (composer-local); D5: fixed role line in header. Two unrelated identity treatments.
8. **Structural approach** — D1 insets a fixed `.app` frame between banners; D5 stacks bars in flow above the work area. The shell must pick one containment model.

### Out of scope for this extraction
In-column headers, HUD metrics (`.hud*`), dock/palette, and feed/post containers are
surface-specific working UI, not shell chrome — not inventoried here.
