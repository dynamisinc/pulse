# Feature: Demo feedback cut (10/20)

**Epic:** cross-cutting (E2 Social, E7 Controller, E10 Evaluation) · **Phase:** 1 · **World:** both · **Issue:** #496
**Target:** Tue 10/20 demo. **Code freeze (backend and frontend) Sun 10/18 evening.** Final reset and seed Mon 10/19.
Decisions: [`implementation.md`](implementation.md#decisions-df-n) (DF-1 to DF-16). Scope agreed with Tom on Wed 10/14.

## Summary

Two sets of notes came back from the customer's early Pulse demo sessions. Most of what they asked for is already
built (live feed refresh, embedded photos and video, controller posts on the fly, editing a scripted post before it
fires, QR / link / password-for-the-day sign-in, exercise isolation, search). This feature is the part that is not,
cut to what fits before the Sunday freeze:

1. **EXERCISE marking on all media.** Top and bottom bands on every image and video a participant sees, driven by
   the existing per-exercise `WatermarkEnabled` switch. The stock demo files are also marked in the file itself.
2. **A Pinned tab** next to All and Following. It holds the posts you liked, the posts you pinned, and posts a
   controller pinned for everyone (the newscast people want to rewatch).
3. **Excel export of all post activity** for the after-action review, with a column that tells player posts from
   controller posts.
4. **Excel import into the run sheet** that reads a **Cadence MSEL export as-is** and keeps only the social-media
   rows, so the MSEL tool and Pulse share one file.
5. **A read-only console** so Feds and leads can watch without affecting control.
6. **A white-noise knob** (Off / Low / Medium / High) beside Pause that releases background posts from a
   pre-written pool at a steady rate.
7. **Polish:** an emoji picker in both composers, new posts highlighted in the console's Live world column, and
   issues #493, #494, #495.

## Requirements covered

| Ask (source) | Requirement | Story |
|---|---|---|
| "EVERYTHING must be watermarked" (Tom); pre-loaded media watermarked, with a toggle (notes A) | NFR-008 | 01, 06, C1 |
| PINNED tab next to All Posts and Following (Tom); liking a post puts it in a pinned tab (notes A) | feeds-discovery (new) | 01, 04, 07, 08 |
| End-of-exercise report exportable to Excel; filter player vs controller posts (both) | AAR export (lite) | 02, 09 |
| Posts easy to load from an Excel sheet; same file format as our MSEL tool (both) | inject queue (new) | 01, 03, 10, C2 |
| Read-only controller view for Feds and leads (both) | COR-013 (UI only; enforcement stays on #61 / #377) | 11 |
| Volume knob on posts (notes A); white noise (Tom) | ambient chatter (lite, no AI) | 01, 05, 09, C3, S1 |
| Emojis (both); bold unread posts (Tom); #493, #494, #495 | NFR-001, D1 polish | 08, 10, 12, 13 |

## Out of scope (roadmap slide)

Players editing their own posts and controllers editing a published post · stress test · offline cache and sync ·
Facebook clone channel · NewsNow · phone and tablet layouts (the week after the demo) · in-app camera capture ·
Cadence → Pulse inject push · server-side enforcement of the evaluator role (#61, #377) · burn-in of uploaded
media on the server.

## Stories

`Priority` is MoSCoW for the 10/20 demo. `Wave` is from the [wave plan](implementation.md#wave-plan).

| # | Story | Stack | Priority | Wave | Depends on | Status | Issue |
|---|-------|-------|----------|------|------------|--------|-------|
| 01 | [Foundation: schema, contract, watermark flag](01-foundation-schema-and-contract.md) | backend | Must | 0 | none | Complete | #497 |
| 02 | [Post activity export (.xlsx)](02-post-activity-export.md) | backend | Must | 1 | seam S-1 | Complete | #498 |
| 03 | [MSEL import into the run sheet (Cadence layout)](03-msel-import.md) | backend | Must | 1 | 01, S-1 | Complete | #499 |
| 04 | [Pins: personal and exercise-wide](04-pins-backend.md) | backend | Must | 1 | 01 | Complete | #500 |
| 05 | [White-noise pool and pacer](05-white-noise-backend.md) | backend | Must | 1 | 01 | Complete | #501 |
| 06 | [EXERCISE bands on all participant media](06-media-watermark-bands.md) | frontend | Must | 2 | contract | In Review | #502 |
| 07 | [Pinned tab and Pin action (participant)](07-pinned-tab.md) | frontend | Must | 2 | contract | In Review | #503 |
| 08 | [Live world: pin for everyone and unread highlighting](08-live-world-pin-unread.md) | frontend | Must | 2 | contract | In Review | #504 |
| 09 | [Console: white-noise knob and Export](09-console-noise-export.md) | frontend | Must | 2 | contract | In Review | #505 |
| 10 | [Run sheet: import from Excel, and the #493 form fix](10-run-sheet-import.md) | frontend | Must | 2 | contract | In Review | #506 |
| 11 | [Read-only console for evaluators](11-read-only-console.md) | frontend | Must | 3 | 08, 09, 10, 12b | Not Started | #507 |
| 12 | [Emoji picker in both composers](12-emoji-picker.md) | frontend | Should | 2 / 3 (12b) | none | In Progress | #508 |
| 13 | [Participant polish: tooltips (#494) and centered frame (#495)](13-participant-polish.md) | frontend | Should | 3 | 06, 07 | Not Started | #509 |
| S1 | [Seed script: noise pool, exercise pins, watermark on](S1-seed-script-update.md) | script | Must | 3 | 04, 05 deployed | Not Started | #510 |
| C | [Content: burned-in media, Kestrel MSEL file, noise pool](C-content-tasks.md) | content | Must | any | #491 | Not Started | #511 |

## Manual UAT walk (Sun 10/18, before pencils down)

1. Participant feed: every image and video shows the top and bottom EXERCISE bands, inline and full screen. Turn
   `WatermarkEnabled` off in exercise settings: the bands go away live or on reload.
2. Like a post, pin another: both appear in Pinned. In the console, pin the newscast for everyone: it appears at the
   top of every participant's Pinned tab without a reload. Unpin: it leaves.
3. Console → Export: the .xlsx opens in Excel, one row per post and reply, the Author type column filters player
   vs controller, taken-down posts are marked.
4. Run sheet → Import from Excel with the Kestrel MSEL file: the dry-run shows the social rows to import and the
   others skipped; Apply adds them; importing again changes nothing.
5. White noise: Low, then High, the feed picks up; Off stops it; Freeze stops it; a backend restart keeps the level.
6. Sign in as an evaluator: the console shows the feed, run sheet, noise level and engine state, with no control
   that writes (Export is allowed).
7. Emoji picker in the participant composer and the persona composer; Live world highlights new posts until seen;
   #493, #494, #495 fixed.
