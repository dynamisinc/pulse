# Story: Variants — read-only, kiosk (Phase 3), preview

**Feature:** Participant shell  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-064 (COR-015, PRT-040, COR-041)  ·  **Design decisions:** D7-008  ·  **Issue:** #190

## Context
One shell renders in four modes. **full** is the default. **read-only** (COR-015) is the passive-
participant / shared-credential mode — interactive affordances are **absent, not disabled**. **kiosk**
(PRT-040, TTX) strips chrome + channel nav but keeps the alert bar. **preview** is the shell rendered
inside the staff frame (COR-041, driven by `staff-shell` story 04). The shell exposes `variant` as a
flag it passes to channels (story 04); channels honor it by not rendering the removed affordances.

## Acceptance Criteria
- [ ] Given **read-only** (COR-015), when a channel mounts, then interactive affordances (composer,
      Post, reply, follow) are **absent** (not present-but-disabled); the shell passes `variant:
      readOnly` and channels honor it.
- [ ] Given **kiosk** (PRT-040), when the shell renders, then compliance chrome **and** channel nav /
      tab bar are removed but the **alert bar persists** (PRT-010) — *(Phase 3, with TTX COR-052; the
      flag + behavior are specified now, exercised when TTX lands)*.
- [ ] Given **preview** (COR-041), when the staff frame requests it, then the participant shell renders
      in a read-only stage (driven by `staff-shell` preview-as, story 04) with the scenario-moment the
      staff picker selected.
- [ ] Variants are **exercise-scoped** shell flags (server-driven); an affordance removed in read-only
      is removed everywhere it would appear (no partial exposure).
- [ ] Read-only removal is accessible — the affordance is genuinely gone from the a11y tree, not a
      disabled control a screen reader still announces (NFR-001, COR-015).
- [ ] Given the shell-state query is **loading or errored** (review CR-W1), when a channel mounts,
      then `variant` resolves to the **least-affordance** default (`readOnly`, not `full`) — a loading
      frame or a prod fetch failure never grants interaction the exercise didn't intend. UX/affordance
      only; read-only integrity is still enforced server-side (a client can forge `full`).
- [ ] Given **preview** (COR-041) mounted while an outer participant shell is also live, when either
      shell unmounts, then the survivor's compliance-chrome inset is **preserved** and each shell's
      content region insets against **its own** chrome — the two shells do not fight over one shared
      `:root` inset (Wave-1 Gate-1 finding WR-001). Scope the chrome inset vars
      (`--pulse-chrome-top`/`-bottom`) to a per-shell root node; keep `ShellLayout`'s
      `var(--pulse-chrome-*, 0px)` consumer in sync with wherever the vars live.

## Out of Scope
The **shared-credential lifecycle** (E1 identity-auth-roles COR-015/NFR-009); the staff-side
**preview-as** control + moment picker (`staff-shell` story 04 — this story is the participant-side
render target); full **TTX** kiosk display beyond the flag (Phase 3, COR-052/PRT-040/041).

## Technical Notes
Participant world. `variant ∈ {full, readOnly, kiosk, preview}` is a shell flag passed via the
channel-mount contract (story 04). read-only + preview are Phase 1; kiosk is Phase-3-exercised. See
implementation.md (story 06). Mockup Tweaks props: `readOnly`, `kiosk`.

**Review CR-W1 (Wave-1 Gate-1, deferred to this story).** `useShellState()` currently returns
`data?.variant ?? 'full'` (`shellState.ts`) — fail-OPEN while the query is loading / on error, inert
only because no channel gates affordances on `variant` yet. This story is where that gate lands, so
flip the default to `readOnly` (least-affordance) here and add the loading/error test below. Note the
**intentional contrast**: `chromeConfig.ts` fails SAFE the other way (`enabled: true` keeps banners
visible, PRT-010/NFR-008) — the two defaults differ on purpose; do NOT align chromeConfig to match.

**WR-001 (preview double-mount inset).** `ComplianceChrome` (story 01) publishes the inset vars on the
shared `document.documentElement`, so an outer shell + a `preview` shell share one `:root` pair. A
ref-count already guards the unmount RACE (an unmount clears the vars only when the last instance
leaves — landed with story 01). What remains for **this** story: give each shell an INDEPENDENT inset
by scoping the vars to a shell-root node instead of `:root`, so a differently-configured pair (e.g.
chrome-on outer + chrome-off preview) can't clobber the single shared value. Move `ShellLayout`'s
`var(--pulse-chrome-*, 0px)` consumer to read from wherever the vars land. Note that a `position: fixed`
banner positions against the viewport (or nearest transformed/contained ancestor), so the preview
pane's containing block must be settled alongside the var scoping.

## Dependencies
The channel-mount contract (story 04, which carries `variant`); `staff-shell` preview-as (story 04)
for the preview target; identity-auth-roles (COR-015 read-only sessions). Ticks STORY-UPDATES §A;
kiosk **and** the WR-001 inset-scoping item are §D backlog notes.

## Tests
- Component (RTL): read-only mounts a channel with no composer/Post in the a11y tree.
- Component (RTL): kiosk strips chrome + nav, keeps the alert bar.
- Unit: `variant` flows through the mount contract to the channel.
- Unit: `useShellState` resolves `readOnly` (not `full`) while the query is loading and on error —
  pins the CR-W1 fail-closed default so a later refactor can't silently regress it.
