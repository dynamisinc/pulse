# Content tasks (C1–C3)

**Feature:** Demo feedback cut (10/20)  ·  **Status:** Not Started  ·  **Where:** the content-pack branch of PR #491
(`docs/demo/pack/**`)  ·  **Owner:** Tom + a content session  ·  **Decisions:** DF-4, DF-16

No product code. Done on the #491 branch so the pack, its media and its files merge together before the Monday seed.

## C1 — Burn the marking into the stock media (DF-4)

- Every photo and video in the pack gets a top and a bottom band reading `EXERCISE EXERCISE EXERCISE`, burned into the
  pixels (ffmpeg `drawbox` + `drawtext`, or ImageMagick for stills). The on-screen bands (06) will also draw over them;
  check that the two do not look doubled and awkward. If they do, make the burned-in bands thinner rather than dropping them.
- Videos stay H.264 MP4, 720p, `-movflags +faststart`, under 20 MB; re-check playback in Chrome and Edge.
- Keep `CREDITS.md` rows; note "marked for exercise use" in the shot list.

## C2 — The Kestrel run sheet as a Cadence MSEL (DF-16)

- `docs/demo/pack/kestrel-msel.xlsx` in Cadence's exact column layout (`implementation.md` → MSEL columns), sheet `MSEL`.
- One social-media row per **single-post** run-sheet item (10), `Delivery Method = Social Media`, `From / Source` = the
  persona handle, `Description` = the post text, a plausible `Scenario Day/Time`, `Notes`, `Responsible Controller`.
- About 25 non-social rows (phone call, email, radio, in-person, EAS) around them, so the skip is visible on stage,
  plus a StartEx row with the earliest scenario time.
- Optional `Pulse Media` column for the items that carry a photo.

## C3 — The white-noise pool

- About 100 everyday posts in the pack's new `noise` array, spread over the citizen personas: traffic, weather, school
  events, sports, food, pets, a few faintly on-topic grumbles ("anyone else's water taste weird?"). Fictional names and
  places only; no real brands, people or news outlets; no profanity.
