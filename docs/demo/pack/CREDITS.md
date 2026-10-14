# Demo pack media: credits and licences

Every file the pack uploads, with where it came from and under what licence (story S2 AC "Media rules";
NFR-004). Stock comes from **Pexels or Pixabay only**. When you replace a placeholder, fill in **Source** (site and
creator), **Licence** (e.g. "Pexels License" or "Pixabay Content License") and **URL** (the photo or video page,
not the download link). Then change **Status** to `STOCK` and note any edit you made (crop, trim, text added).

**Status key**

- `PLACEHOLDER`: a labelled grey card made for this draft. **Must be replaced before the final seed.** It is not
  demo content.
- `GENERATED DRAFT`: a simple fictional mark or notice made for this pack (2026-10-13; the Kestrel County EM and
  Metro Desk 9 marks and the notice card redrawn 2026-10-14 for FIC-001). No third-party material, so no licence
  is needed. Tom approves it or replaces it.
- `STOCK`: the real file, credited below.

Shot descriptions and search terms are in [`MEDIA-SHOTLIST.md`](MEDIA-SHOTLIST.md).

## Videos and posters

| File | Used for | Status | Source | Licence | URL | Notes |
|---|---|---|---|---|---|---|
| `media/news-elm-break.mp4` | V1 · p06 Metro Desk 9 on-scene report | PLACEHOLDER | | | | Real H.264 1280×720 20 s placeholder |
| `media/news-elm-break.poster.jpg` | V1 poster | PLACEHOLDER | | | | Frame from the final clip, same source |
| `media/news-mill-road.mp4` | V2 · rs01 BREAKING (beat 2) | PLACEHOLDER | | | | Real H.264 1280×720 15 s placeholder |
| `media/news-mill-road.poster.jpg` | V2 poster | PLACEHOLDER | | | | Frame from the final clip, same source |
| `media/scoop-brown-tap.mp4` | V3 · rs05 The Scoop (beat 3) | PLACEHOLDER | | | | Real H.264 1280×720 10 s placeholder |
| `media/scoop-brown-tap.poster.jpg` | V3 poster | PLACEHOLDER | | | | Frame from the final clip, same source |

## Photos

| File | Used for | Status | Source | Licence | URL | Notes |
|---|---|---|---|---|---|---|
| `media/photo-elm-crew.jpg` | P1 · p03 | PLACEHOLDER | | | | |
| `media/photo-advisory-sign.jpg` | P2 · p10 | PLACEHOLDER | | | | Blank stock sign plus added text is fine; note the edit |
| `media/photo-boiling-pot.jpg` | P3 · p10 | PLACEHOLDER | | | | |
| `media/photo-brown-sink.jpg` | P4 · p15 | PLACEHOLDER | | | | |
| `media/photo-hydrant-flush.jpg` | P5 · p17 | PLACEHOLDER | | | | |
| `media/photo-distribution.jpg` | P6 · p19 | PLACEHOLDER | | | | No readable brand labels |
| `media/photo-line.jpg` | P7 · p27 | PLACEHOLDER | | | | No recognisable faces |
| `media/photo-brown-glass.jpg` | P8 · rs03 impersonator (beat 3) | PLACEHOLDER | | | | |
| `media/photo-empty-shelves.jpg` | P9 · rs06 (beat 3) | PLACEHOLDER | | | | No store branding |
| `media/pio-statement-card.png` | P10 · PIO live post + rs08 backup (beat 4) | GENERATED DRAFT | Generated for this pack | n/a (own work) | — | Redrawn for Kestrel County (FIC-001). Redraw if a name on it changes |

## Avatars

| File | Used for | Status | Source | Licence | URL | Notes |
|---|---|---|---|---|---|---|
| `avatars/kestrelcoem.png` | @KestrelCoEM | GENERATED DRAFT | Generated for this pack | n/a (own work) | — | Fictional mark |
| `avatars/fairhavenwater.png` | @FairhavenWater | GENERATED DRAFT | Generated for this pack | n/a (own work) | — | Fictional mark |
| `avatars/fairhavenwaterupd.png` | @FairhavenWaterUpd (lookalike) | GENERATED DRAFT | Generated for this pack | n/a (own work) | — | Deliberate near-copy of the utility's mark |
| `avatars/metrodesk9.png` | @MetroDesk9 | GENERATED DRAFT | Generated for this pack | n/a (own work) | — | Fictional mark |
| `avatars/thescoophq.png` | @TheScoopHQ | GENERATED DRAFT | Generated for this pack | n/a (own work) | — | Fictional mark |
| `avatars/mvega_fh.jpg` | @mvega_fh | PLACEHOLDER | | | | No people |
| `avatars/tbrandt41.jpg` | @tbrandt41 | PLACEHOLDER | | | | No people |
| `avatars/kwardfh.jpg` | @kwardFH | PLACEHOLDER | | | | Hands only |
| `avatars/dreyes_fh.jpg` | @dreyes_fh | PLACEHOLDER | | | | No people |

## Banners

| File | Used for | Status | Source | Licence | URL | Notes |
|---|---|---|---|---|---|---|
| `banners/kestrelcoem.jpg` | @KestrelCoEM | PLACEHOLDER | | | | |
| `banners/fairhavenwater.jpg` | @FairhavenWater and @FairhavenWaterUpd | PLACEHOLDER | | | | One file, both profiles |
| `banners/metrodesk9.jpg` | @MetroDesk9 | PLACEHOLDER | | | | No recognisable skyline |
| `banners/thescoophq.jpg` | @TheScoopHQ | PLACEHOLDER | | | | |

## Before the final seed (Mon 10/19)

- [ ] No row says `PLACEHOLDER`.
- [ ] Every `STOCK` row has a source, a licence and a URL.
- [ ] No file shows a recognisable face, a real logo or brand, a real news brand or a real landmark.
- [ ] The `alt` text in `pack.json` matches what each final photo and video actually shows.
- [ ] `pwsh scripts/uat/Seed-DemoContent.ps1 -WhatIf` passes with the final files.
