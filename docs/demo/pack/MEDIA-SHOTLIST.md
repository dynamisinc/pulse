# Demo pack media: shot list

> **Status: FINAL MEDIA IN (S2, #444), 2026-10-19.** All 29 files are real. **14 are licensed media** supplied by
> the Dynamis team (`STOCK`), **7 are generated and approved by Tom** (`GENERATED`: the five org marks, the notice
> card and the AI-generated advisory sign) and **8 are generated drafts** (`GENERATED DRAFT`: the four resident
> avatars and the four banners, drawn in code as flat illustrations) for Tom to approve or replace. No placeholder
> is left. Every file is recorded in [`CREDITS.md`](CREDITS.md).

Swap a file in place: same path, same file name. Then run `pwsh scripts/uat/Seed-DemoContent.ps1 -WhatIf`, which
checks type, size and magic bytes the way the server does.

## Rules for every file

These come from the story ACs (`docs/features/demo-polish/25-content-pack-authoring.md`) and plan decision 2.

- **Source:** Pexels or Pixabay (royalty-free), media the Dynamis team supplies and holds the licence for, or an
  image generated for this pack ([FIC-002](../../design/DECISIONS.md), Tom, 2026-10-19). Write the source, the
  licence and the page URL (or "internal") into `CREDITS.md` as you pick. Stock licences limit how identifiable
  people may be shown, which is one more reason for the next rule.
- **Strip all metadata** (EXIF, GPS, capture time, device): the server keeps whatever a file carries. Use
  `ffmpeg -map_metadata -1` for video and `magick -strip` (or an equivalent re-save) for images. No burned-in date
  or time: participants see scenario time only.
- **No recognisable faces.** Show people from behind, at a distance, hands only, or out of focus.
- **No real brands.** No logos, brand names, readable store or street signs with real names, licence plates, news
  chyrons, station bugs or watermarks. No recognisable skylines or landmarks: the county is fictional.
- **Nothing out of the fiction** in the frame: no "sample", "stock", "test" or "training" overlays.
- **Photos:** JPEG (or PNG/WebP), **1600 × 900 (16:9)** to match `pack.json`, ideally ≤ 500 KB (the server's limit
  is 5 MB). If you export another size, change that item's `width`/`height` in `pack.json`.
- **Videos:** **H.264 MP4** (High or Main profile, `yuv420p`, `+faststart`), **1280 × 720**, **≤ 30 s, ≤ 20 MB**.
  Sound is optional (AAC if kept). Safari will not play other codecs, and magic bytes cannot tell, so keep to
  H.264. Every video needs a **poster** JPEG at 1280 × 720. If the length differs from the one listed, change
  `durationSec` in `pack.json`.
- **Avatars:** square, **400 × 400**. They are shown as a **circle**, so keep the subject inside the middle.
- **Banners:** **1500 × 500**. The profile shows them about 600 × 150 (a 4:1 crop), so keep the subject in the
  middle band.
- **Alt text** lives in `pack.json` (media `alt`) and describes the **final** shot. If the clip you pick differs
  from the description below, rewrite the `alt` to match what is actually in the frame. Write it as a
  description, never a file name, and keep "simulation", "exercise" and "training" out of it (fiction AC).

### Converting a stock clip (ffmpeg)

```bash
# Trim to the slot (here: start at 3 s, keep 20 s), crop to 1280x720, H.264 + faststart.
ffmpeg -ss 3 -i original.mp4 -t 20 \
  -vf "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 23 -preset slow -movflags +faststart \
  -c:a aac -b:a 128k docs/demo/pack/media/news-elm-break.mp4      # use -an instead to drop the sound

# Poster: the frame named in the slot (here at 2 s).
ffmpeg -ss 2 -i docs/demo/pack/media/news-elm-break.mp4 -frames:v 1 -q:v 3 docs/demo/pack/media/news-elm-break.poster.jpg

# Check: codec h264, 1280x720, duration.
ffprobe -v error -show_entries stream=codec_name,profile,width,height,pix_fmt,duration -of compact docs/demo/pack/media/news-elm-break.mp4
```

Photos: crop to 16:9 and export at 1600 × 900, JPEG quality around 80.

## Summary

| # | Pack key / file | Kind | Status | Used by |
|---|---|---|---|---|
| V1 | `news-elm-break` · `media/news-elm-break.mp4` + `.poster.jpg` | video | STOCK | p06 (@MetroDesk9, opening feed, beat 1) |
| V2 | `news-mill-road` · `media/news-mill-road.mp4` + `.poster.jpg` | video | STOCK | rs01 (@MetroDesk9, BREAKING, beat 2) |
| V3 | `scoop-brown-tap` · `media/scoop-brown-tap.mp4` + `.poster.jpg` | video | STOCK | rs05 (@TheScoopHQ, beat 3) |
| P1 | `photo-elm-crew` · `media/photo-elm-crew.jpg` | photo | STOCK | p03 (@FairhavenWater) |
| P2 | `photo-advisory-sign` · `media/photo-advisory-sign.jpg` | photo | GENERATED | p10 (@KestrelCoEM, 2-photo grid) |
| P3 | `photo-boiling-pot` · `media/photo-boiling-pot.jpg` | photo | STOCK | p10 (@KestrelCoEM, 2-photo grid) |
| P4 | `photo-brown-sink` · `media/photo-brown-sink.jpg` | photo | STOCK | p15 (@tbrandt41) |
| P5 | `photo-hydrant-flush` · `media/photo-hydrant-flush.jpg` | photo | STOCK | p17 (@FairhavenWater) |
| P6 | `photo-distribution` · `media/photo-distribution.jpg` | photo | STOCK | p19 (@KestrelCoEM) |
| P7 | `photo-line` · `media/photo-line.jpg` | photo | STOCK | p27 (@MetroDesk9) |
| P8 | `photo-brown-glass` · `media/photo-brown-glass.jpg` | photo | STOCK | rs03 (@FairhavenWaterUpd, the impersonator, beat 3) |
| P9 | `photo-empty-shelves` · `media/photo-empty-shelves.jpg` | photo | STOCK | rs06 (@dreyes_fh, beat 3) |
| P10 | `pio-statement-card` · `media/pio-statement-card.png` | image | GENERATED | rs08 (backup) and the PIO's live post (beat 4) |
| A1 | `avatars/kestrelcoem.png` | avatar | GENERATED | @KestrelCoEM |
| A2 | `avatars/fairhavenwater.png` | avatar | GENERATED | @FairhavenWater |
| A3 | `avatars/fairhavenwaterupd.png` | avatar | GENERATED | @FairhavenWaterUpd (the lookalike) |
| A4 | `avatars/metrodesk9.png` | avatar | GENERATED | @MetroDesk9 |
| A5 | `avatars/thescoophq.png` | avatar | GENERATED | @TheScoopHQ |
| A6 | `avatars/mvega_fh.jpg` | avatar | GENERATED DRAFT | @mvega_fh |
| A7 | `avatars/tbrandt41.jpg` | avatar | GENERATED DRAFT | @tbrandt41 |
| A8 | `avatars/kwardfh.jpg` | avatar | GENERATED DRAFT | @kwardFH |
| A9 | `avatars/dreyes_fh.jpg` | avatar | GENERATED DRAFT | @dreyes_fh |
| B1 | `banners/kestrelcoem.jpg` | banner | GENERATED DRAFT | @KestrelCoEM |
| B2 | `banners/fairhavenwater.jpg` | banner | GENERATED DRAFT | @FairhavenWater **and** @FairhavenWaterUpd (the lookalike copies it) |
| B3 | `banners/metrodesk9.jpg` | banner | GENERATED DRAFT | @MetroDesk9 |
| B4 | `banners/thescoophq.jpg` | banner | GENERATED DRAFT | @TheScoopHQ |

That is 3 videos (each with a poster), 10 photos, 9 avatars and 4 banners: **29 uploads**. The server allows 30
uploads a minute per account. S1 waits out a 429, so more files only make the run slower.

## Videos

### V1 · `news-elm-break` (STOCK)

- **File:** `media/news-elm-break.mp4`, poster `media/news-elm-break.poster.jpg`
- **Used by:** p06, Metro Desk 9's on-scene report in the opening feed. It is the video that plays inline and opens
  full-screen in beat 1.
- **The shot:** street-level footage of a road or utility crew in high-visibility vests working in a trench cut
  across a city street, with an excavator and water at the bottom. Traffic cones or barriers. Early-morning or
  daylight. No faces close up, no company names on vests or trucks.
- **Length:** 13 s. The brief asked for 15 to 30 s; the supplied cut is 13 s once its opening aerial shot (a
  brand logo and a banner with a phone number) is removed.
- **Poster frame:** about 2 s in, a wide frame that shows the trench and the crew.
- **Alt (in `pack.json`):** "Overhead news footage of a deep, muddy excavation: a worker in a high-visibility vest
  kneels beside an excavator bucket next to a large concrete pipe section standing in brown water. The view then
  drops into the narrow trench as the excavator bucket digs and water runs along the bottom."
- **Search:** `road works excavator`, `pipe repair street`, `water main repair`, `construction trench workers`,
  `road construction night`.

### V2 · `news-mill-road` (STOCK)

- **File:** `media/news-mill-road.mp4`, poster `media/news-mill-road.poster.jpg`
- **Used by:** rs01, Metro Desk 9's BREAKING post in beat 2. If the controller shows the live upload path instead,
  this is also the file to upload from the demo laptop (keep a copy there).
- **The shot:** water gushing or bubbling up from a street or a burst pipe and running down the road toward a
  drain. A strong, obvious "something broke" image in the first 2 seconds. A vehicle with amber lights is a
  bonus if it carries no markings.
- **Length:** 16 s (10 to 30 s).
- **Poster frame:** 2 s in, at the moment the water is most visible.
- **Alt:** 'News footage of water surging up through the pavement and flooding a residential street. Down the road, a
  fire engine waits behind a "Road work ahead" sign and traffic cones, beside a line of stopped cars.'
- **Search:** `water main break`, `burst pipe street`, `water flowing street`, `flooded road water rushing`,
  `street flooding`.

### V3 · `scoop-brown-tap` (STOCK)

- **File:** `media/scoop-brown-tap.mp4`, poster `media/scoop-brown-tap.poster.jpg`
- **Used by:** rs05, The Scoop's amplification post in beat 3.
- **The shot:** close-up of cloudy, brownish or rust-coloured water running from a kitchen faucet into a sink. A
  handheld, slightly shaky look suits the account. No brand on the faucet.
- **Length:** 10 s (6 to 20 s).
- **Poster frame:** about 1 s in, with the water stream clearly discoloured.
- **Alt:** "Shaky close-up video of rust-brown tap water pouring from a chrome tap and filling a white bathroom
  sink."
- **Search:** `dirty tap water`, `brown water faucet`, `rusty water tap`, `contaminated water tap`.

## Photos

### P1 · `photo-elm-crew` (STOCK)

- **Used by:** p03 (@FairhavenWater, "We are responding to a main break on Elm Street…").
- **The shot:** a utility crew around an excavated street trench with a large pipe exposed and water at the bottom.
  Backs or hard hats, not faces. No company names.
- **Alt:** "A worker in a welding mask kneels in an excavated trench, welding a joint on a large steel pipe. A second
  worker in an orange vest is just visible at the edge of the trench."
- **Search:** `pipe repair workers`, `road excavation`, `water pipe trench`, `construction workers street`.

### P2 · `photo-advisory-sign` (GENERATED)

- **Used by:** p10 (@KestrelCoEM, first photo of a 2-photo grid).
- **The shot:** a yellow roadside or sandwich-board sign reading "Boil water advisory" at the edge of a residential
  street. Stock rarely has this exact sign: take a blank yellow warning sign and add the words in an editor. That
  keeps the sign fictional. No real agency name on it.
- **Alt:** 'A portable electronic sign on an orange trailer reads "Boil water advisory" at the curb of a quiet
  residential street.'
- **Search:** `blank yellow sign`, `warning sign sidewalk`, `road sign blank`, `sandwich board sign street`.

### P3 · `photo-boiling-pot` (STOCK)

- **Used by:** p10 (@KestrelCoEM, second photo of the grid: how to boil).
- **The shot:** a pot of water at a full rolling boil on a stove.
- **Alt:** "A stainless steel pot of water at a rolling boil on a stovetop, with steam rising."
- **Search:** `boiling water pot`, `pot boiling stove`, `rolling boil`.

### P4 · `photo-brown-sink` (STOCK)

- **Used by:** p15 (@tbrandt41, "this is what came out of my bathroom tap…").
- **The shot:** cloudy, brownish tap water in a white sink. It should look like a resident's phone photo.
- **Alt:** "Cloudy, rust-brown tap water pouring from a chrome tap and filling a white bathroom sink."
- **Search:** `dirty water sink`, `brown water sink`, `rusty water`.

### P5 · `photo-hydrant-flush` (STOCK)

- **Used by:** p17 (@FairhavenWater, hydrant flushing explained).
- **The shot:** an open fire hydrant sending a stream of water along a street gutter.
- **Alt:** "An open red fire hydrant sends a strong stream of water into the gutter of a residential street. Work
  trucks and a police car with flashing lights wait farther down the road."
- **Search:** `fire hydrant water`, `open hydrant`, `hydrant flushing`, `hydrant spraying water`.

### P6 · `photo-distribution` (STOCK)

- **Used by:** p19 (@KestrelCoEM, free bottled water at two sites).
- **The shot:** stacks of shrink-wrapped cases of bottled water on pallets or tables, ideally inside a fire station
  bay or a gym. **No brand labels readable** (blur them if needed).
- **Alt:** "Rows of large, blue-capped water jugs packed tightly together and roped into lines, ready to be handed
  out."
- **Search:** `bottled water cases`, `water bottles pallet`, `water donation`, `bottled water stack`.

### P7 · `photo-line` (STOCK)

- **Used by:** p27 (@MetroDesk9, lines at Fairhaven High School).
- **The shot:** a queue of people **seen from behind** on a sidewalk outside a school-like building. Faces not
  recognisable.
- **Alt:** "A line of people, shown from the shoulders down, waits along a railing outside a white-painted building."
- **Search:** `people queue from behind`, `line of people waiting outside`, `queue sidewalk`.

### P8 · `photo-brown-glass` (STOCK): the beat-3 rumor photo

- **Used by:** rs03 (@FairhavenWaterUpd, the impersonator's "do NOT boil" post: the beat-5 takedown target).
- **The shot:** a clear glass of cloudy, brown-tinted water held under a kitchen faucet. It must be striking at
  feed size. This is the image the audience remembers.
- **Alt:** "A tall clear glass of cloudy, silty tap water on a kitchen counter beside a stainless steel sink."
- **Search:** `dirty water glass`, `contaminated water glass`, `brown water glass`, `polluted drinking water`.

### P9 · `photo-empty-shelves` (STOCK)

- **Used by:** rs06 (@dreyes_fh, "The grocery on Main Street is completely out of bottled water").
- **The shot:** empty store shelves where bottled water would be. **No store branding, price labels with a real
  chain name, or product logos.**
- **Alt:** "Long rows of bare store shelves, emptied of stock, with only price tags left along the shelf edges."
- **Search:** `empty supermarket shelves`, `empty store shelves`, `panic buying shelves`.

### P10 · `pio-statement-card` (GENERATED)

- **Used by:** the PIO's live statement in beat 4 (the PIO attaches it from the demo laptop), and rs08, the backup
  of that post.
- **What it is:** a 1600 × 900 PNG notice card: navy header "KESTREL COUNTY EMERGENCY MANAGEMENT · Official notice",
  the title "Boil water advisory: Zones 2-4", and four lines (boiling is safe, the advisory has not expanded, the
  free water sites, verified accounts only). Generated for this pack, no stock and no real logo.
- **Decision:** approved by Tom on 2026-10-19. It was redrawn for Kestrel County on 2026-10-14 (FIC-001).
  **If a name on it changes again, it must be redrawn** (the names are in the image). Keep its alt text in step with
  the words on the card.
- **Alt:** "Official notice from Kestrel County Emergency Management. Boil water advisory, Zones 2 to 4. Boiling
  tap water for 1 minute is safe and effective. The advisory has not expanded: Zones 2, 3 and 4 only. Free bottled
  water at Elm Street Fire Station and Fairhaven High School. Official updates come only from verified accounts:
  KestrelCoEM and FairhavenWater."
- **Demo prep:** copy `media/pio-statement-card.png` to the PIO's demo laptop (desktop or Pictures) so it can be
  attached live.

## Avatars

Avatars carry no alt text in the pack (the UI renders them next to the display name). The descriptions below are
for picking.

| # | File | Status | What it must show | Search |
|---|---|---|---|---|
| A1 | `avatars/kestrelcoem.png` | GENERATED | Navy circle, white shield outline, "KCEM". A fictional county EM mark (redrawn for Kestrel County, FIC-001). | — (design, not stock) |
| A2 | `avatars/fairhavenwater.png` | GENERATED | Deep blue, white water drop with two wave lines. The **real** utility. | — |
| A3 | `avatars/fairhavenwaterupd.png` | GENERATED | The **lookalike**: almost the same drop on a slightly brighter blue, **without the wave lines**. Close enough to fool a skim, different enough to spot (SOC-052). Keep this pairing if you redesign A2. | — |
| A4 | `avatars/metrodesk9.png` | GENERATED | Red tile, white "9", navy "METRO DESK" bar (redrawn for Metro Desk 9, FIC-001). Don't style the 9 like a real station's numeral mark (for example a numeral inside a circle). | — |
| A5 | `avatars/thescoophq.png` | GENERATED | Yellow, black "THE SCOOP". Tabloid feel. | — |
| A6 | `avatars/mvega_fh.jpg` | GENERATED DRAFT | Sunflowers or a backyard garden. **No people.** (Mom, nurse, east side.) | `sunflowers garden`, `backyard flowers` |
| A7 | `avatars/tbrandt41.jpg` | GENERATED DRAFT | A dog on a porch step, or a dog's face close up. **No people.** (Coffee, dogs, local sports.) | `dog porch`, `golden retriever portrait` |
| A8 | `avatars/kwardfh.jpg` | GENERATED DRAFT | Hands planting a seedling in a community garden. **Hands only.** (Community organizer.) | `hands planting seedling`, `community garden hands` |
| A9 | `avatars/dreyes_fh.jpg` | GENERATED DRAFT | A tabby cat on a sunny windowsill. **No people.** (Just trying to keep up.) | `cat windowsill`, `tabby cat sunlight` |

The resident avatars avoid faces on purpose: a stock portrait is a real person's likeness, which the AC rules out.

## Banners

| # | File | Status | What it must show | Search |
|---|---|---|---|---|
| B1 | `banners/kestrelcoem.jpg` | GENERATED DRAFT | Aerial view of a small river town with green hills. No recognisable landmark. | `small town aerial river`, `town valley aerial`, `rural town drone` |
| B2 | `banners/fairhavenwater.jpg` | GENERATED DRAFT | Water treatment plant basins or a reservoir under a blue sky. **Used by both** the utility and its lookalike: the impersonator copied the banner. | `water treatment plant`, `reservoir aerial`, `water treatment basins` |
| B3 | `banners/metrodesk9.jpg` | GENERATED DRAFT | Out-of-focus city lights at dusk, or abstract studio lights. **No recognisable skyline.** | `city lights bokeh`, `blurred city night`, `studio lights abstract` |
| B4 | `banners/thescoophq.jpg` | GENERATED DRAFT | A dramatic spotlight or a red-lit dark background. Tabloid mood, no text. | `spotlight dark background`, `dramatic red light abstract` |
