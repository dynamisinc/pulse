# staffShell — the staff frame, and "Preview as participant"

The COBRA staff frame (`StaffShellFrame`, `StaffHeader`, `Toolstrip`) every staff surface mounts, plus the
**Preview as participant** stage (story 04; reworked by demo-polish C6, `docs/features/demo-polish/23-preview-and-startex.md`).
This README covers the preview; the frame's own contract is in the headers of `StaffShellFrame.tsx` /
`StaffHeader.tsx`.

## What the preview is

`PreviewAsParticipant` is rendered **in place of** a staff surface's work area (`active ? <PreviewAsParticipant /> :
<WorkArea />`, driven by `usePreview()`), and it shows the **real** Social channel — the same `<SocialChannel />` a
participant gets, reading the exercise's own feed — inside a neutral mat under a labelled strip
("PREVIEW AS PARTICIPANT — READ-ONLY" + Exit). Two files, two worlds:

| File | World | Job |
|---|---|---|
| `components/PreviewAsParticipant.tsx` | staff | the strip, Exit, the mat; wraps the host in `PreviewErrorBoundary` |
| `components/PreviewChannelHost.tsx` | participant | the provider stack around `SocialChannel` (no COBRA, no MUI) |
| `components/PreviewErrorBoundary.tsx` | staff | "Participant preview unavailable" if the channel throws |
| `previewContext.ts` | staff | the toggle + the (currently unused) moment model |
| `previewFrameMetrics.ts` | staff | the channel's two viewport breakpoints, copied (drift test) |

`previewStubTwoWorlds.test.ts` / `twoWorldsSeparation.test.ts` enforce the split mechanically.

## Read-only, three ways

1. `variant: 'preview'` → `affordancesAvailable` is false: no composer, Post button, compose modal, reply box,
   Following tab or live stream; like / repost / reply are inert counts.
2. `ReadOnlySessionScope` (`core/auth`) narrows the session to a read-only observer with no persona, for the controls
   that ask the session (follow, like, repost) — essential under mock data, where the session is a participant persona.
3. `muteTelemetry()` (`core/telemetry`) drops **participant-kind** events (the channel's own `view` / `search`) while the
   preview is mounted. Every other actor kind — `persona`, `engine`, `system` (e.g. a takedown's `steering_action`) — is
   untouched.

Links stay inside the preview: the channel runs under `MemorySocialNavigationProvider`, so nothing touches
`window.location` or history.

## What the swap costs (the console unmounts while the preview is open)

Decided and accepted. The preview replaces the work area, so React state the console held is gone on Exit.

- **Survives:** the active persona; persona-composer drafts and the reply they were written for (module draft store; reopen
  the dock and the composer restores the reply); the review queue's items and the engine / swamped-mode / pause state
  (module stores); the toolstrip. An engine draft's countdown is deadline-based on the scenario clock, so one that expires
  while the preview is open resolves (default: Hold) when the console returns — nothing auto-sends meanwhile.
- **Lost:** an open inline edit in a console panel (a run-sheet item edit, a review-queue draft edit), whether the persona
  dock was open, and panel scroll positions.

## Known limits

- **No moment picker.** The old STARTEX / ADVISORY / BURST / NOW picker is not rendered: the real channel dates posts from
  the live scenario clock, so a picker changed nothing the audience could see. The model stays for later.
- **The media viewer covers the staff chrome.** It is portalled to `<body>`, so an opened lightbox covers the staff header
  and the strip until Esc. Accepted for the demo.
- **The feed is a snapshot** taken when the preview opens (the live "new posts" stream is off in `preview`); exit and
  re-enter to refresh.
- A render error in the channel is contained by the boundary (the strip and Exit keep working); it does not retry.
