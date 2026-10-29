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
| PDF-01 | Phones and tablets | "Viewable on smart phone"; "Optimized for iPad and iPhone" | Must (week after demo; also a December-release channel prerequisite) | **In progress (B1)** | #524 | [mobile-tablet](../mobile-tablet/feature.md) |
| PDF-02 | Offline: cached feed and media | "Basic offline functionality…" | Should | Not Started | #525 | — |
| PDF-03 | Load test, restart resilience, backup site | "Stability!"; "Stress-test with post volume" | Must | **Slice in progress** | #526 | [01 load report](01-load-test-report.md) (slice, #547); restart resilience = [demo-feedback/18](../demo-feedback/18-persist-pause-tier-and-clock.md) |
| PDF-04 | Facebook-style second channel | "Facebook clone - basically, twitter posts go to Facebook"; 10/20: a customer also asked about other social platforms (likely a throwaway) | Could (needs a D-brief + epic number; no bump) | Not Started | #527 | — |
| PDF-05 | NewsNow | "Probably unnecessary; embedding is preferred" | Won't (confirm demand) | Not Started | #528 | — |
| PDF-06 | Cadence ↔ Pulse integration | "The tools should share a file format" (file import done: #499/#518); 10/20: customer very interested in Cadence, wants a **live connection** | **Must** (raised from Should, 10/20); **Cadence drives Pulse** (PDF-D10, Tom 10/21) | Not Started | #529 | — |
| PDF-07 | Implementer sheets | "capture time, recipient, and remarks" | Could | Not Started | #530 | — |
| PDF-08 | In-app camera capture | "Maybe photo only. Would need automatic watermarking" | Could (after #524) | Not Started | #531 | — |
| PDF-09 | Server-side burn-in | "EVERYTHING must be watermarked" (overlay covers participant views today) | Should (confirmed, Tom 10/21; not raised to Must) | Not Started | #532 | — |
| PDF-10 | GIFs | "PIOs like emojis—support emojis and/or GIFs" (upload/playback already work) | Could | Not Started | #533 | — |
| PDF-11 | Subdomain per exercise (host-resolved, automated DNS + cert) | 10/20 demo: customer "really liked" `exercise-a.<env-host>` | **Must** | Not Started | #679 | [02](02-subdomain-per-exercise.md) |
| PDF-12 | Section 508 attestation (ACR/VPAT, a11y gate, AT audit) | 10/20: we must attest/prove 508 compliance | **Must** | Not Started | #680 | [03](03-section-508-attestation.md) |
| PDF-13 | Back-pocket injects (loaded, held in reserve, fired at discretion) | 10/20 demo ask | **Must** (December) | Not Started | #681 | [04](04-back-pocket-injects.md) |
| PDF-BUG | New-posts pill shows nothing on load (fixed) | 10/20: with white noise on, the "N new posts" pill disappears on click but no new posts show | **Must** | **Fixed** (PR #678, merged 10/29); no issue (orchestrator's call, 10/29; tracked by PR #678) | — | — |

### Due-outs from the 10/20 demo (tracked tasks, not build stories)

Owner Tom unless noted. Detail and the scenario list are in [05-due-outs.md](05-due-outs.md).

| # | Due-out | Status | Issue |
|---|---|---|---|
| PDF-DO1 | Definitive upper limit of concurrent individual accounts (extends PDF-03) | Open; target: prove **250 concurrent** accounts | #682 |
| PDF-DO2 | Pulse fact sheet for the TIR submission, if the feds move forward | **Deferred** until the feds decide | #683 |
| PDF-DO3 | Dollar figures including G&A per requested scenario (costs blank) | Open; four scenarios, costs blank for Tom | #684 |

## 10/20 demo notes

Source: **Tom's notes from the 10/20 customer demo** (product owner). Items 1-7 below are folded into the table
above. Open questions were answered by Tom on 10/21 (decisions PDF-D6..D10); only PDF-BUG is built (fixed, #678).

1. **December release commitment: the other defined channels.** Tom told the customer the remaining defined channels
   (Portal E3, News outlets E4, Press Room / TV / newspaper / wire E5, Weather E6; epics `docs/03` to `docs/06`) ship
   in the **December release**. This overrides the Master PRD §4 phasing, where they are Phase 3, and makes it a
   release commitment, not a plan. Effects on this feature:
   - **PDF-05 (NewsNow)** stays Won't: the commitment is the epic-defined E4 outlets (D3 skins), not a NewsNow clone.
   - **PDF-01 (phones and tablets)** is a December prerequisite (new channels are mobile-first), so keep it first.
   - **PDF-09 (server-side burn-in)** stays **Should** (Tom, 10/21). Every new channel is still a surface to
     watermark (NFR-008) through the existing overlay.
   - **PDF-04 (Facebook-style)** is NOT part of this commitment. A customer also asked about other social platforms;
     Tom thinks it was a throwaway. Noted against PDF-04, no priority bump.
   - **Decided (Tom, 10/21): the December commitment is FIRM; decompose now.** The schedule risk is **accepted**.
     Decomposed 10/29 in PR #686 (`docs/features/DECEMBER-RELEASE.md`; issues #688-#786).
2. **Subdomain per exercise** loved by the customer: PDF-11, Must.
3. **Cadence connection:** PDF-06 raised to Must. The ask is a **live connection** (two running systems exchanging
   exercise content), beyond the shared file format already delivered (#499/#518). **Decided (Tom, 10/21): Cadence
   drives Pulse.** Cadence owns the MSEL and the clock and pushes injects and clock changes into Pulse; Pulse fires
   them and reports back. Seam note (added 10/29): #678 made the server exercise clock authoritative
   (`GET /api/clock` + `ScenarioClockChanged` push), and `IExerciseClock` was designed swappable, so a Cadence-linked
   clock provider plugs in there. Still to design before stories: auth between the two products and the shared
   inject-identity contract. CTL-012 / E9 (Phase 4) is the epic home and is pulled forward by this.
4. **508 attestation:** PDF-12, Must.
5. **Back-pocket injects:** PDF-13, Must, December.
6. **Due-outs:** PDF-DO1..DO3, tracked tasks.
7. **Bug:** PDF-BUG, Must. **Fixed by PR #678** (merged 10/29); no issue (orchestrator's call, 10/29; tracked by PR #678). Root cause: noise posts were stamped by the server clock (frozen during a Freeze) while other posts used the browser wall clock, so feeds sorted noise below the top. Fix: every live post is stamped with the server clock, browsers sync to it, and the Live World cap and the unknown-author pill path are hardened.

## Notes from the 10/15 analysis

- GIF upload and playback already work end to end (`MediaSniffer` allowlists GIF87a/89a; `<img>` animates); PDF-10's
  remaining work is a participant-facing curated picker.
- `docs/design/D3-news-outlets/` is an approved design for four outlet skins, relevant if PDF-05 returns.
- PDF-04 (Facebook) has no D-brief and conflicts with the PRD's epic numbering (E3 is the Portal; "Lookbook" was
  descoped at launch); it needs an epic number and a brief before stories.
- UAT runs on a single **B1 Basic** App Service instance with in-process SignalR and serverless SQL (GP_S_Gen5,
  0.5-2 vCores, auto-pause 60 min). The load slice measures where that bends and recommends a size for real exercises.
