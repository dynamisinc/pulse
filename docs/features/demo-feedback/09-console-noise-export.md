# Story: Console: white-noise knob and Export

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** ambient chatter (lite), AAR export (lite)  ·  **Decisions:** DF-8, DF-12, DF-13  ·  **Issue:** #505
**Stack:** frontend  ·  **World:** staff  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 2  ·  **Effort:** M

## Context

The console halves of white noise (05) and the post export (02): a four-step **White noise** control beside the Pause
pill, and an **Export posts** button in the console title row.

## Acceptance Criteria

- [ ] A `NoiseControl` sits **beside** `PausePill` in the world-steering panel (the two in one row). It is a
      four-option segmented control, Off / Low / Medium / High, with the current rate ("6 posts/min") and the pool size
      and posted count as secondary text. Choosing a level calls `PUT /api/staff/noise` and shows errors visibly.
- [ ] It reads `GET /api/staff/noise` on mount and stays live from `NoiseStateChanged` on the shared hub connection
      (staff group). When `running` is false with a level set, it says why in words ("Stopped: the world is frozen",
      "Stopped: the clock is not running", "No posts in the pool").
- [ ] **Export posts** in the console title row (beside the StartEx/EndEx slot) downloads
      `GET /api/staff/exports/posts.xlsx` with the session's bearer token (fetch as a blob, then save with the server's
      file name), shows a spinner while it runs, and shows the error text on failure. A `429` (another export is being built) is retried once after about 1 s before its reason is shown (02 Gate-1 fold).
- [ ] **Noise origin on the client** (01 Gate-1 L1): add `'noise'` to `PostOrigin` (`social/types/post.ts`), to `telemetryOriginSchema` (`core/telemetry/schema.ts`), and a console origin label in `originConsoleLabel` (`social/services/postService.ts`), e.g. `NOISE · AUTO`, so Live world never shows the raw string. Participant surfaces show nothing new.
- [ ] Mock adapters for both behind the console's existing mock switch.

### Cross-cutting
- [ ] **Two worlds:** COBRA components only (`CobraPrimaryButton`, `consoleChrome` tokens); FontAwesome icons.
- [ ] **Accessibility:** the segmented control is a radio group with arrow-key support and a visible label "White noise".

## Out of Scope

Hiding the control's write affordance for evaluators (11 does it). A pool editor.

## Tests

Level change round trip and error; live update from the hub event; stopped reasons; export downloads a blob with the
server file name; export error; keyboard on the radio group.
