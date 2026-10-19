# Demo pack media: credits and licences

Every file the pack uploads, with where it came from and under what licence (story S2 AC "Media rules";
NFR-004). Media comes from **Pexels or Pixabay**, from **the Dynamis team** (media it supplies and holds the licence
for), or is **generated for this pack** ([FIC-002](../../design/DECISIONS.md), Tom, 2026-10-19). When you replace a
file, fill in **Source** (site and creator, or who supplied it), **Licence** (e.g. "Pexels License" or "Pixabay
Content License") and **URL** (the photo or video page, not the download link; "internal" for team-supplied media).
Then set **Status** and note any edit you made (crop, trim, blur, text added).

**Status key**

- `PLACEHOLDER`: a labelled grey card made for the first draft. **Must be replaced before the final seed.** None
  are left.
- `GENERATED DRAFT`: a simple fictional mark or illustration made for this pack. No third-party material, so no
  licence is needed. Tom approves it or replaces it.
- `GENERATED`: made for this pack and approved by Tom (2026-10-19). That includes the AI-generated advisory sign
  (FIC-002).
- `STOCK`: the real, licensed file, credited below.

Every file was re-encoded for the pack and **all its metadata was stripped** (EXIF, GPS, XMP, capture time,
device, ICC; videos with `-map_metadata -1`), because the server keeps whatever metadata a file carries. Photos
are sRGB JPEG and the videos are silent (the supplied audio tracks were empty). The MP4s carry no encoder tag
and no x264 settings block either.

Shot descriptions and search terms are in [`MEDIA-SHOTLIST.md`](MEDIA-SHOTLIST.md).

## Videos and posters

| File | Used for | Status | Source | Licence | URL | Notes |
|---|---|---|---|---|---|---|
| `media/news-elm-break.mp4` | V1 · p06 Metro Desk 9 on-scene report | STOCK | Dynamis team (supplied 2026-10-19) | Licensed to Dynamis; licence held by the team | internal | Trimmed to 8.1 s–end of the supplied 21 s cut (12.8 s). The opening aerial shot was cut: it showed an excavator brand logo and a for-sale banner with a phone number. 1280×720 H.264, no audio |
| `media/news-elm-break.poster.jpg` | V1 poster | STOCK | Same as the clip | Same as the clip | internal | Frame at 2 s of the final clip |
| `media/news-mill-road.mp4` | V2 · rs01 BREAKING (beat 2) | STOCK | Dynamis team (supplied 2026-10-19) | Licensed to Dynamis; licence held by the team | internal | Cropped to the left 1600×900 of the 1080p frame (drops a van's rear number and a car badge), then 1280×720 H.264, 16 s, no audio. The fire engine's unit marking ("E97" on the rear, "97" on the side panel) is blurred in every frame, tracked as the camera moves. Re-encoded at a 2.6 Mbps cap (5.4 MB) |
| `media/news-mill-road.poster.jpg` | V2 poster | STOCK | Same as the clip | Same as the clip | internal | Frame at 2 s of the final (blurred) clip |
| `media/scoop-brown-tap.mp4` | V3 · rs05 The Scoop (beat 3) | STOCK | Dynamis team (supplied 2026-10-19) | Licensed to Dynamis; licence held by the team | internal | 1280×720 H.264, 10 s, no audio |
| `media/scoop-brown-tap.poster.jpg` | V3 poster | STOCK | Same as the clip | Same as the clip | internal | Frame at 1 s of the final clip |

## Photos

| File | Used for | Status | Source | Licence | URL | Notes |
|---|---|---|---|---|---|---|
| `media/photo-elm-crew.jpg` | P1 · p03 | STOCK | Dynamis team (supplied 2026-10-19) | Licensed to Dynamis; licence held by the team | internal | 16:9 crop, 1600×900, cut about 100 px narrower on the right so the second worker's face and hard hat are out of frame |
| `media/photo-advisory-sign.jpg` | P2 · p10 | GENERATED | AI-generated image, supplied by the Dynamis team | n/a (generated for Dynamis) | internal | Scaled to 1600×900. The sign text is part of the generated image. Recorded as generated with Tom's OK (FIC-002) |
| `media/photo-boiling-pot.jpg` | P3 · p10 | STOCK | Dynamis team (supplied 2026-10-19) | Licensed to Dynamis; licence held by the team | internal | 16:9 crop, 1600×900. Original credit line (from the stripped metadata): Africa Images (Olga Yastremska) |
| `media/photo-brown-sink.jpg` | P4 · p15 | STOCK | Dynamis team (supplied 2026-10-19) | Licensed to Dynamis; licence held by the team | internal | Scaled to 1600×900 |
| `media/photo-hydrant-flush.jpg` | P5 · p17 | STOCK | Dynamis team (supplied 2026-10-19) | Licensed to Dynamis; licence held by the team | internal | 16:9 crop, 1600×900. Vehicles in the background are out of focus; no markings or plates readable |
| `media/photo-distribution.jpg` | P6 · p19 | STOCK | Dynamis team (supplied 2026-10-19) | Licensed to Dynamis; licence held by the team | internal | 16:9 crop, 1600×900. The jug labels are out of focus and unreadable |
| `media/photo-line.jpg` | P7 · p27 | STOCK | Dynamis team (supplied 2026-10-19) | Licensed to Dynamis; licence held by the team | internal | Cropped from the top so no face is in frame (shoulders down); Adobe RGB to sRGB. Original credit line: Rawpixel Ltd. |
| `media/photo-brown-glass.jpg` | P8 · rs03 impersonator (beat 3) | STOCK | Dynamis team (supplied 2026-10-19) | Licensed to Dynamis; licence held by the team | internal | 16:9 crop, 1600×900 |
| `media/photo-empty-shelves.jpg` | P9 · rs06 (beat 3) | STOCK | Dynamis team (supplied 2026-10-19) | Licensed to Dynamis; licence held by the team | internal | Cropped to the empty left side of the aisle, which drops the branded products and the store's sale signage. Every remaining shelf tag is blurred (store slogans, a store-brand tag). Display P3 to sRGB |
| `media/pio-statement-card.png` | P10 · PIO live post + rs08 backup (beat 4) | GENERATED | Generated for this pack | n/a (own work) | — | Redrawn for Kestrel County (FIC-001). Approved by Tom 2026-10-19. Redraw if a name on it changes |

## Avatars

| File | Used for | Status | Source | Licence | URL | Notes |
|---|---|---|---|---|---|---|
| `avatars/kestrelcoem.png` | @KestrelCoEM | GENERATED | Generated for this pack | n/a (own work) | — | Fictional mark. Approved by Tom 2026-10-19 |
| `avatars/fairhavenwater.png` | @FairhavenWater | GENERATED | Generated for this pack | n/a (own work) | — | Fictional mark. Approved by Tom 2026-10-19 |
| `avatars/fairhavenwaterupd.png` | @FairhavenWaterUpd (lookalike) | GENERATED | Generated for this pack | n/a (own work) | — | Deliberate near-copy of the utility's mark. Approved by Tom 2026-10-19 |
| `avatars/metrodesk9.png` | @MetroDesk9 | GENERATED | Generated for this pack | n/a (own work) | — | Fictional mark. Approved by Tom 2026-10-19 |
| `avatars/thescoophq.png` | @TheScoopHQ | GENERATED | Generated for this pack | n/a (own work) | — | Fictional mark. Approved by Tom 2026-10-19 |
| `avatars/mvega_fh.jpg` | @mvega_fh | GENERATED DRAFT | Drawn in code for this pack (2026-10-19) | n/a (own work) | — | Flat illustration: three sunflowers by a garden fence. No people |
| `avatars/tbrandt41.jpg` | @tbrandt41 | GENERATED DRAFT | Drawn in code for this pack (2026-10-19) | n/a (own work) | — | Flat illustration: a golden dog's face. No people |
| `avatars/kwardfh.jpg` | @kwardFH | GENERATED DRAFT | Drawn in code for this pack (2026-10-19) | n/a (own work) | — | Flat illustration: cupped hands holding soil with a seedling. Hands only |
| `avatars/dreyes_fh.jpg` | @dreyes_fh | GENERATED DRAFT | Drawn in code for this pack (2026-10-19) | n/a (own work) | — | Flat illustration: an orange tabby seen from behind on a sunny windowsill. No people |

## Banners

| File | Used for | Status | Source | Licence | URL | Notes |
|---|---|---|---|---|---|---|
| `banners/kestrelcoem.jpg` | @KestrelCoEM | GENERATED DRAFT | Drawn in code for this pack (2026-10-19) | n/a (own work) | — | Flat illustration: a small river town among green hills. No landmark |
| `banners/fairhavenwater.jpg` | @FairhavenWater and @FairhavenWaterUpd | GENERATED DRAFT | Drawn in code for this pack (2026-10-19) | n/a (own work) | — | Flat illustration: treatment-plant basins under a blue sky. One file, both profiles |
| `banners/metrodesk9.jpg` | @MetroDesk9 | GENERATED DRAFT | Drawn in code for this pack (2026-10-19) | n/a (own work) | — | Out-of-focus city lights at dusk (abstract bokeh). No skyline |
| `banners/thescoophq.jpg` | @TheScoopHQ | GENERATED DRAFT | Drawn in code for this pack (2026-10-19) | n/a (own work) | — | A spotlight beam on a dark red background. No text |

## Before the final seed (Mon 10/19)

- [x] No row says `PLACEHOLDER`.
- [ ] Every `STOCK` row has a source, a licence and a URL (`internal` for team-supplied media).
- [ ] No file shows a recognisable face, a real logo or brand, a real news brand or a real landmark.
- [ ] The `alt` text in `pack.json` matches what each final photo and video actually shows.
- [ ] Tom approves or replaces the 8 `GENERATED DRAFT` avatars and banners.
- [x] `pwsh scripts/uat/Seed-DemoContent.ps1 -WhatIf` passes with the final files.
