# Story: Participant polish: tooltips (#494) and centered frame (#495)

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** NFR-001, D1-005 / D1-013 (revisited)  ·  **Issue:** #509 (closes #494, #495)
**Stack:** frontend  ·  **World:** participant  ·  **Review:** Tier-1  ·  **Priority:** Should  ·  **Wave:** 3  ·  **Effort:** S

## Context

Two issues Tom filed on 10/14. Icon buttons have no tooltips (#494), and the social frame is pinned to the left on wide
screens where X centres it (#495). Runs after 06 and 07 because it touches the same buttons.

## Acceptance Criteria

- [ ] **#494:** every participant icon-only control shows its name on hover **and** keyboard focus, matching its
      `aria-label`: post actions (Reply, Repost, Like, Pin), composer attach/remove/emoji, media viewer previous/next,
      video mute/expand/play, search clear, compose-modal close, detail-header back, and the nav rail links and Post
      button when their text label is hidden (below 840px). One small participant-skinned tooltip component, not the
      MUI default look; it never covers the control it describes; touch devices are unaffected.
- [ ] **#495:** at widths of 1280px and above the three-column frame (nav 240 · main 600 · rail 344) is **centred** in
      the window, like X; below that the existing layout is unchanged. `SocialChannel.layout.test.tsx` and the D1-013
      comments are updated to the new rule.

### Cross-cutting
- [ ] **Two worlds:** participant skin, no COBRA. **Accessibility:** tooltip text is not the only accessible name.

## Out of Scope

Mobile layouts (after the demo).

## Tests

Tooltip on hover and focus for a representative control of each kind; frame centring at 1440px and left layout at
1100px.

- `src/frontend/src/features/social/components/ParticipantTooltip.test.tsx`: the component and its geometry.
  `placeTooltip` puts the bubble below / above / to the right with a gap, flips at the viewport edge, slides to stay
  on screen, and never overlaps the control across a grid of positions and every placement. On a plain button: shows
  on mouse hover only after the dwell and hides on leave; shows at once on keyboard (Tab) focus and hides on blur;
  is `aria-hidden`, not `role="tooltip"`, not `aria-describedby`, so the `aria-label` stays the only accessible name;
  Escape hides it without swallowing the key; Enter and click hide it; a touch pointer and a tap's focus show
  nothing; the `media` gate. Skin: no MUI / `@/theme` / Cobra imports, composes the participant `.tokens`, reads
  `--pc-*`, light only, white on `--pc-ink-muted` is at least 4.5:1.
- `src/frontend/src/features/social/components/ParticipantTooltip.controls.test.tsx`: the tooltip on the real
  controls. Post actions: Reply and Like on hover, Repost and Pin on keyboard focus, hidden on leave / blur, the
  counted `aria-label` ("Like, 42") unchanged and led by the tooltip text. Composer: "Add photos or video" on hover,
  "Add emoji" on focus. Media: the viewer's "Next image" on hover and focus; the video player's Mute then Expand on
  focus (one bubble at a time). Nav rail with `matchMedia` pinned below 840px: Home on focus, Post on hover, names
  unchanged; at 840px and up no tooltip on hover or focus; the icon-rail query is the complement of the 840px
  breakpoint. Detail header Back on focus. A source table pins that every control in the AC is wrapped (including
  attachment remove, video Play, search clear, compose-modal Close and viewer Previous) and that both nav rail
  tooltips carry the icon-rail gate.
- `src/frontend/src/features/social/SocialChannel.layout.test.tsx` (updated, #495): resolves the `.frame` rule for a
  given window width from the real stylesheet's base rules and `min-width` blocks. At 1100px: `240px minmax(0, 600px)`,
  `justify-content: start`, left offset 0 (and still start at 1200 / 1279px). At 1440px: the full 240 | 600 | 344
  frame, `justify-content: center`, 128px on each side; the 1280px block changes no track; no auto margins. Metrics:
  `FRAME_CENTRED_MIN_WIDTH` is 1280 and above `FRAME_MIN_WIDTH`; the stylesheet's breakpoints are exactly 840 / 1184
  / 1280.
- `src/frontend/src/features/social/components/Composer.emoji.test.tsx` (one assertion): the emoji and attach buttons
  share the tools row via `closest('div')`, since each now sits in its tooltip's box-less wrapper.
