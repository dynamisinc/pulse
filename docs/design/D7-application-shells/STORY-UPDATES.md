# Story Updates — Pulse Application Shells (D7)

> **Purpose.** The D7 design session (application shells) landed decisions that **change the backlog**,
> not just UI choices. This is the input for the story/epic agents: each item names the target, the
> decision that drove it (`D7-xxx`), the before → after, and the action. Source:
> [`DECISIONS.md`](../DECISIONS.md) (D7 section) + [`SHELL-CONTRACT.md`](SHELL-CONTRACT.md) (normative)
> + [`RETROFIT-NOTES.md`](RETROFIT-NOTES.md) + [`README.md`](README.md), and the session-3 shell
> inventory [`COMPONENTS.md`](../COMPONENTS.md) (R-006) that D7 starts from.

Legend: **ADD** = new feature/story · **AMEND** = edit an existing requirement's ACs ·
**RECONCILE** = resolve an interim/frozen state a prior session set · **BACKLOG** = defer as a
later-phase story.

---

## A. New features to add (ADD)

D7 establishes the two container shells every surface mounts into. Both are **Phase-1 foundations**
(the social app + console need them now); each carries clearly-marked Phase-3 stubs.

- [ ] **ADD — `participant-shell` (Epic E1, Phase 1, world: participant)** · `D7-001..006/008`
  - The participant container: **compliance chrome** (COR-031), **alert-bar host** (PRT-010/011/012,
    ticker default per D7-002), **channel nav** strip + mobile tabs (COR-061/062), the
    **channel-mount contract** (content region zero-styling + scenario-time single source +
    `{variant, scenarioNow}`, COR-060/053/062), the **overlay layer** (break-fiction / pause / EndEx
    rendering, COR-065 / CTL-024/023 / COR-054), **variants** (read-only / kiosk / preview,
    COR-064/015 / PRT-040 / COR-041), and **per-exercise brand theming hooks** (COR-066/030).
  - **Action:** author `docs/features/participant-shell/` (feature.md + implementation.md + 7 stories).
    Phase-1 ACs; kiosk (PRT-040) and multi-channel nav are Phase-3 within-story notes.

- [ ] **ADD — `staff-shell` (Epic E7, Phase 1, world: staff)** · `D7-007/009/010/011`
  - The staff frame: the **Cadence navy header** (brand lockup · identity badge, static during
    conduct COR-005 · scenario+wall clocks · state pill · classification tag folded in per D7-010 ·
    presence · preview-as button); the **one shell-owned toolstrip dock** (shell-global tools +
    surface-registered zone — the console toolbox docks here, D7-011); the **participant-admin
    flyout** (COR-017); **preview-as-participant** (COR-041); and the **Cadence Design System chrome
    tokens** + the thumbnail-distinguishability hard gate (D7-009).
  - **Action:** author `docs/features/staff-shell/` (feature.md + implementation.md + 5 stories).

---

## B. Amendments to existing features (AMEND / RECONCILE)

- [ ] **RECONCILE — `console-shell` (#2) is UNFROZEN; chrome ownership moves to `staff-shell`** · `D7-007/010/011`, R-006
  - **Before:** the console's improvised container chrome (exercise banner, header/brand lockup,
    exercise identity block, clock cluster, state pill, presence, header action group) was
    **inventoried and frozen pending the D7 session** (`COMPONENTS.md`); story 03's presentation was
    tagged interim.
  - **After:** D7 has landed. Those inventoried elements are now **owned by `staff-shell`** (the
    frame). `console-shell` keeps only the **console-specific content that mounts in the frame**: the
    toolbox tools, the NEEDS-YOU action bar, the console's flyouts, Flag, the trainee monitor.
  - **Action:** edit `console-shell/feature.md` — remove the "frozen pending D7" note; state the
    split (frame = staff-shell; console content = this feature); repoint design refs to D7.
    - **AMEND story 01 (toolstrip, #9):** the toolstrip **container** is shell-owned (`staff-shell`);
      this story becomes "the console **registers its tools into the shell's surface-zone**" (D7-011),
      not "the console draws its own strip." The continuous-watch vs consult-on-demand rule (D5-017)
      stands as *which* tools the console registers.
    - **RECONCILE story 03 (identity badge, #11):** the badge now lives in the **`staff-shell`
      header** (D7-007/010); the **behavior stands** (static during conduct, switching pre-conduct),
      and the interim/R-006 presentation tag **resolves** — presentation is `staff-shell`'s.

- [ ] **AMEND — `world-steering` (#5): overlay rendering moves to `participant-shell`; console keeps triggers** · `D7-003/004`
  - **Break Fiction (#27):** **Before** the story implied the console owns the alien overlay markup.
    **After** — per D7-003, the **overlay is rendered by `participant-shell`** (top of the overlay
    z-order, above compliance chrome; black/amber hazard, monospace, wall-clock, no-dismiss). The
    console keeps **only the trigger**: the guarded/latched group, Director gate, type-to-confirm
    ("BROADCAST"), per-session delivery, and logging. **Action:** amend #27 — the overlay component is
    `participant-shell`'s (COR-065); this story owns the trigger + fan-out + audit.
  - **Tiered pause (#26):** **Before** the pause "holding page" (in-fiction / out-of-fiction) read as
    console-side. **After** — per D7-004, the participant-facing **pause + EndEx pages** (both
    registers) are **rendered by `participant-shell`**; the console keeps the **pause control + tier
    state machine** (Pause injects / Pause engine / Freeze) and the clock-stop-on-Freeze. The state
    pill's interim/R-006 tag **resolves** — it lives in the `staff-shell` header. **Action:** amend
    #26 — split rendering (participant-shell) from control (this story).

- [ ] **AMEND — participant-surface chrome is shell-owned (retrofit, not redesign)** · RETROFIT-NOTES
  - D1 **social app** (E2) and D2 **portal** (E3) mount into `participant-shell`. Their improvised
    **compliance chrome, alert bar, and channel nav** become **shell-owned**; the surfaces keep their
    in-fiction product UI (nav rail/logo, "Posting as" chip, mastheads, section nav). The D1
    two-banner inset model **is** the canonical chrome (no visual change); the D1 alert-bar palette is
    adopted exactly. **Action:** where posts/feeds/portal stories reference chrome/alert-bar/channel-nav,
    note the shell as owner (cross-ref `participant-shell`); no channel-content redesign.
  - `exercise-configuration/02-compliance-chrome.md` owns the **config** (strings, colors, on/off,
    COR-030/066); `participant-shell/01-compliance-chrome.md` owns the **render**. Cross-ref both ways.

---

## C. Reconcile / resolve interim states

- [ ] **RECONCILE — `COMPONENTS.md` inventory "replaced by shell — see D7" is now implemented.** Every
  improvised element in the session-3 inventory maps to a `participant-shell` or `staff-shell` story
  (see the mapping in `RETROFIT-NOTES.md`). The inventory stays as the historical evidence; the
  "replaced by shell" status is now **discharged** by these two features.
- [ ] **RECONCILE — divergence #5 (participants have no exercise identity)** is resolved *by design*
  (D7-005 / README): participants **never** see exercise identity inside the fiction (XC-002); the
  compliance chrome is their only exercise signal. `exercise-configuration/05-participant-exercise-identity.md`
  records the resolution; no participant-facing identity chrome is built.

---

## D. Backlog (later-phase, do not build this pass)

- [ ] **Kiosk / TTX display mode (PRT-040)** — a `participant-shell` variant (chrome + nav stripped,
  alert bar persists); Phase 3 with TTX (COR-052). Story exists as a Phase-3 note inside
  `participant-shell/06-variants.md`, not built now.
- [ ] **Multi-channel nav at scale** — the channel strip is real in Phase 1 but degenerate with one
  channel (Social); it earns its keep as E4/E5/E6 land (Phase 3). Framed in
  `participant-shell/03-channel-nav.md` as Phase-1 container + Phase-3 multi-channel behavior.
- [ ] **Evaluator dashboard frame (D6)** inherits the `staff-shell` frame with fewer header controls —
  fold in when D6/evaluator decomposes.
- [ ] **Per-shell-scoped compliance-chrome inset (WR-001)** — `ComplianceChrome` publishes its inset
  vars (`--pulse-chrome-top`/`-bottom`) on the shared `:root`. A ref-count guards the unmount race
  (landed, story 01), but a `preview` shell (COR-041) mounted alongside an outer shell still shares one
  value pair — a differently-configured pair clobbers each other. Scope the vars to a per-shell root
  node so each shell insets independently, and move `ShellLayout`'s `var(--pulse-chrome-*, 0px)`
  consumer with them. Land in `participant-shell/06-variants.md` (preview) / the App.tsx participant
  route-tree split, when the shell is actually wired up.
- [ ] **Participant not-found leaks the COBRA staff 404 (WR-002)** — `App.tsx` scopes COBRA to a
  `StaffThemeBoundary` and mounts `/shell` COBRA-free (`ExerciseContextProvider → BrandThemeProvider →
  ShellLayout`), but the router catch-all
  (`{ path: '*', element: <StaffThemeBoundary><NotFoundPage/></StaffThemeBoundary> }`) renders the
  **staff 404** for every unmatched path. `/shell` is exact-match today, so no participant path falls
  through — **not a current break**. Once E2 social lands participant deep-links / nested channel
  routes, `/shell/foo` falls through to the COBRA 404, showing the staff look inside the fiction
  (violates the D0 §2 two-worlds thumbnail gate on a participant path). **Fix when participant routing
  lands:** a nested, brand-skinned not-found inside `ParticipantShellRoute`; keep the COBRA
  `NotFoundPage` for staff / unknown-staff paths only. Wave-2 Gate-2 finding · issue #238.

---

## Traceability at a glance

| Target | Decision(s) | Type | One-line change |
|---|---|---|---|
| `participant-shell` (E1) | D7-001..006/008 | ADD | New participant container feature (7 stories) |
| `staff-shell` (E7) | D7-007/009/010/011 | ADD | New staff frame feature (5 stories) |
| `console-shell` #2 | D7-007/010/011, R-006 | RECONCILE | Unfreeze; frame→staff-shell, console keeps its content |
| `console-shell` 01 #9 | D7-011 | AMEND | Toolbox registers into the shell dock |
| `console-shell` 03 #11 | D7-007/010 | RECONCILE | Identity badge in staff-shell header; behavior stands |
| `world-steering` 04 #27 | D7-003 | AMEND | Break-fiction overlay rendered by participant-shell; console = trigger |
| `world-steering` 03 #26 | D7-004 | AMEND | Pause/EndEx pages rendered by participant-shell; console = control |
| E2 posts / E3 portal | RETROFIT-NOTES | AMEND | Chrome/alert-bar/nav are shell-owned (retrofit) |
| `COMPONENTS.md` inventory | R-006 → D7 | RECONCILE | "replaced by shell" discharged by the two features |
| PRT-040 kiosk / multi-channel / D6 frame | D7-008/001 | BACKLOG | Phase-3 notes, not built this pass |
| `participant-shell` 06 inset (WR-001) | Gate-1 review | BACKLOG | Scope chrome inset vars off `:root` (ref-count landed) |
| `participant-shell` App.tsx 404 (WR-002) | Gate-2 review | BACKLOG | Participant catch-all must stay COBRA-free when sub-routes land (issue #238) |
