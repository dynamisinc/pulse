# Feature: Post-demo customer feedback

**Epic:** cross-cutting · **Phase:** 2 · **World:** both · **Issue:** #523
Decisions: [`implementation.md`](implementation.md#decisions-pdf-dn). Triaged with Tom 10/14-15.

## Summary

The customer feedback items deliberately cut from the 10/20 demo (see `demo-feedback/feature.md`, "Out of scope").
The stories are tracked as GitHub issues #524-#533 and get story files here as each is pulled into a build. **One
slice is pulled forward into the demo window** (Tom, 10/15): the load-test report from PDF-03 (#526), run Saturday
10/17 against UAT as it is. Restart resilience from the same issue is built in `demo-feedback` Wave 4 (story 18).

## Stories

| # | Story | Customer note (short) | Priority | Status | Issue | File |
|---|---|---|---|---|---|---|
| PDF-01 | Phones and tablets | "Viewable on smart phone"; "Optimized for iPad and iPhone" | Must (week after demo) | Not Started | #524 | — |
| PDF-02 | Offline: cached feed and media | "Basic offline functionality…" | Should | Not Started | #525 | — |
| PDF-03 | Load test, restart resilience, backup site | "Stability!"; "Stress-test with post volume" | Must | **Slice in progress** | #526 | [01 load report](01-load-test-report.md) (slice, #547); restart resilience = [demo-feedback/18](../demo-feedback/18-persist-pause-tier-and-clock.md) |
| PDF-04 | Facebook-style second channel | "Facebook clone - basically, twitter posts go to Facebook" | Could (needs a D-brief + epic number) | Not Started | #527 | — |
| PDF-05 | NewsNow | "Probably unnecessary; embedding is preferred" | Won't (confirm demand) | Not Started | #528 | — |
| PDF-06 | Cadence ↔ Pulse integration | "The tools should share a file format" (file import done: #499/#518) | Should | Not Started | #529 | — |
| PDF-07 | Implementer sheets | "capture time, recipient, and remarks" | Could | Not Started | #530 | — |
| PDF-08 | In-app camera capture | "Maybe photo only. Would need automatic watermarking" | Could (after #524) | Not Started | #531 | — |
| PDF-09 | Server-side burn-in | "EVERYTHING must be watermarked" (overlay covers participant views today) | Should | Not Started | #532 | — |
| PDF-10 | GIFs | "PIOs like emojis—support emojis and/or GIFs" (upload/playback already work) | Could | Not Started | #533 | — |

## Notes from the 10/15 analysis

- GIF upload and playback already work end to end (`MediaSniffer` allowlists GIF87a/89a; `<img>` animates); PDF-10's
  remaining work is a participant-facing curated picker.
- `docs/design/D3-news-outlets/` is an approved design for four outlet skins, relevant if PDF-05 returns.
- PDF-04 (Facebook) has no D-brief and conflicts with the PRD's epic numbering (E3 is the Portal; "Lookbook" was
  descoped at launch); it needs an epic number and a brief before stories.
- UAT runs on a single **B1 Basic** App Service instance with in-process SignalR and serverless SQL (GP_S_Gen5,
  0.5-2 vCores, auto-pause 60 min). The load slice measures where that bends and recommends a size for real exercises.
