# Story: Console cleanup

**Feature:** Demo polish  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-002, CTL-003, CTL-004 (honesty only), NFR-001  ·  **Design decisions:** D5-016, D5-017 (permanent watch surfaces), D5-014/2.4  ·  **Issue:** #439
**Story ID:** C4  ·  **Stack:** frontend  ·  **Priority:** Must  ·  **Effort:** S  ·  **Wave:** 3
**Home story:** [`console-shell/01`](../console-shell/01-toolstrip-flyouts.md) (slice).

## Context
**As** a presenter, **I want** the console to stop showing mock bits and developer copy, **so that** nothing on
the controller side looks unfinished next to the participant app. Today: the main area carries dev copy ("the
live world and other surfaces dock here as they land"); the header shows fake presence avatars; "SimCell-1"
(header) and "SIMCELL-1" (identity) disagree; ⌘K promises "personas and commands" but has no commands; the
persona context panel always shows "Voice notes unavailable / No recent posts" in UAT; PAUSE INJECTS is a
disabled option reading "No inject queue yet". It also builds the **slots** the orchestrator mounts C2/C3 into.
**World: staff (COBRA).**

## Acceptance Criteria
- [ ] **Main-area slots.** `ControllerConsole` gains optional render-prop props `liveWorldSlot?(ctx)` and
      `runSheetSlot?(ctx)` (`ConsoleSlotContext { openComposer(opts?: { personaId?: string; replyTo?:
      ReplyTarget }): void }`, type exported from the file) and lays them out as a split — Live world | Run
      sheet — at ≥ 1280 px, stacked below; `openComposer` selects the persona and opens the dock. With no slot
      supplied the area shows a concise status line, not placeholders.
- [ ] **Dev copy gone.** The "Press ⌘K … live world and other surfaces dock here as they land" paragraph is
      replaced by a short shortcut strip (⌘K / Ctrl+K posts as a persona); no visible string contains "land",
      "Wave", "TODO" or "mock".
- [ ] **No fake presence.** `useStaffPresence()` returns `[]` and `StaffHeader` renders **no** presence group
      (no empty labelled region) when the roster is empty; the roster is not faked back in.
- [ ] **One SimCell name.** The identity seam's `callSign` (`SIMCELL-1`) is the single source; the header cell
      line (`useStaffRoleCell`) shows the same string; existing tests are updated, none assert `SimCell-1`.
- [ ] **Honest ⌘K.** The palette placeholder and accessible name read "Search personas…" (no "commands"), the
      PERSONAS section is the only section, and there is no dead entry; focus trap, Esc and focus return are
      unchanged.
- [ ] **Persona context shows real data.** `PersonaContextPanel` shows the server `bio` and up to 3 recent posts
      of the persona read from the live exercise feed (authored by that persona, incl. replies; scenario time)
      instead of `listPosts()`; with none, the empty state says so honestly; a missing voice-notes template
      reads "No voice notes authored" (muted) not "unavailable"; it gains `actionsSlot?: ReactNode` for PE's
      button.
- [ ] **Pause tiers match what exists.** The disabled **Pause injects** option is removed from `PausePill` (the
      tier stays in the type; re-enable when an inject queue exists); Pause engine and Freeze world behave
      exactly as before and their tests stay green.

## Out of Scope
Building the live world or run sheet (C2/C3), real presence (CTL-004 SignalR presence), the inject queue, new ⌘K
commands, restyling the toolstrip, voice-notes authoring, engine cockpit changes, mounting the slots
(orchestrator).

## Technical Notes
- Files: implementation.md §4.1 row C4 — `controller/components/{ControllerConsole,PersonaContextPanel}.tsx`,
  `components/steering/PausePill.tsx`, `console/CommandPalette.tsx`, `staffShell/staffHeaderMocks.ts`,
  `staffShell/components/StaffHeader.tsx` (guard for the empty roster), and their tests. **Not**
  `ControllerConsoleRoute.tsx` (orchestrator) or `controllerIdentity.ts` (source of truth).
- The `R-003` origin vocabulary `SIMCELL · MANUAL` in `postService.originConsoleLabel` is a different string and
  stays. COBRA only (`@/theme/styledComponents`, `staffShellTokens`); MUI 9 system props go in `sx`.

## Dependencies
None (independent of F0 for its own files; imports the `ReplyTarget` type from `@/features/social` once F0 has
merged — or declares it locally behind the frozen shape until then). Runs with C1–C3, PE-FE.

## Tests
- `ControllerConsole.test.tsx` (+ new slot test: slots render, `openComposer` opens the dock for a persona,
  split layout), `StaffHeader` empty-roster test, palette copy assertions, `PersonaContextPanel.test.tsx` (bio
  from server persona, recents from a mocked feed read, empty states, `actionsSlot`), `PausePill*.test.tsx`
  (injects option absent; other tiers unchanged).
- A simple string-scan test over the console's rendered text for the banned dev words.
