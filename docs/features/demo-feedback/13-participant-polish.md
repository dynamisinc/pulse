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
