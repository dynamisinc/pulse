# Demo content pack (S2): Fairhaven boil-water storyline

> **Status: ready for Tom's content review** (story [S2](../../features/demo-polish/25-content-pack-authoring.md),
> #444). **Names approved by Tom 2026-10-13** ([FIC-001](../../design/DECISIONS.md): Kestrel County, Metro Desk 9;
> applied here 2026-10-14). Claude drafted the text, structure and placeholder media on 2026-10-13. Tom and
> colleagues edit it: the first review after the **10/16** walk, the second before Rehearsal 2, and the final seed
> on **Mon 10/19**. Change content **here, in the pack**, never by editing UAT.

| File | What it is |
|---|---|
| [`pack.json`](pack.json) | The pack (`pulse.demopack.v1`): persona profile edits, media, the opening feed and the run sheet |
| [`MEDIA-SHOTLIST.md`](MEDIA-SHOTLIST.md) | What each photo, video, avatar and banner must show, with alt text and search terms |
| [`CREDITS.md`](CREDITS.md) | Source, licence and URL per file (the stock rows are for Tom to fill in) |
| `media/`, `avatars/`, `banners/` | The files. **23 are placeholders and 6 are generated drafts** (see the shot list) |
| [`schema/`](schema/pack.schema.json) | S1's JSON Schema (owned by S1; do not edit here) |

## At a glance

| | Count |
|---|---|
| Opening feed | **36 posts** (23 top-level and 13 replies in 7 threads), backdated over **~6 scenario hours** (T−355 to T−14 min) |
| Run sheet | **15 items** (10 `post`, 5 `burst`) = 30 scripted posts, 10 of them replies, covering beats 2–5 |
| Media | **3 videos** (each with a poster), **10 photos**, **9 avatars**, **4 banners** = 29 uploads |
| Personas | All **9** cast handles get profile edits (display name, bio, location, verified, avatar; banners for the 5 orgs) |

## The fiction

**Kestrel County** (fictional), **City of Fairhaven**. Overnight a water main breaks on **Elm Street** near the
**Eastside pump station**. The east side (**Zones 2, 3 and 4**; Main Street divides Zone 1 from the rest) loses
pressure. **Fairhaven Water** issues a precautionary **boil water advisory**, and **Kestrel County EM** opens free
bottled-water sites at **Elm Street Fire Station** and **Fairhaven High School**. An unverified lookalike of the
utility and a sensational outlet fill the gaps with rumor. During the demo a **second break on Mill Road**
becomes breaking news, the lookalike claims boiling is unsafe, and the PIO has to correct it.

This keeps the established storyline: the `#WaterIssues` hashtag, the "Fairhaven Eastside" advisory, Zones 2–4 and
the Elm Street sites all come from the engine seed and the frontend mocks.

### Cast: handles are fixed, everything else is editable

All nine handles exist on UAT once the engine content is seeded. `Reset-DemoState.ps1` calls
`POST /api/ops/seed-engine-content`, whose `PersonaCastSeeder` adds any of these nine that is missing and never
duplicates one. On a database seeded before FIC-001 it renames the county EM and TV-news personas to
`KestrelCoEM` and `MetroDesk9` in place, so run Reset-DemoState once before the first seed after that deploy. The
run order already puts Reset-DemoState before the seed, and S1 stops before any write if a handle is unknown.
**The pack needs no new persona.** Handles and `#WaterIssues` must not change (plan §9: the engine matches on
them).

| Handle | Display name | Role in the story | Verified | Avatar |
|---|---|---|---|---|
| `KestrelCoEM` | Kestrel County EM | County emergency management. **The PIO participant posts as this persona** (`New-DemoParticipant.ps1` default) | ✔ | generated draft |
| `FairhavenWater` | Fairhaven Water Utility | The real utility | ✔ | generated draft |
| `FairhavenWaterUpd` | Fairhaven Water Update | **The impersonator**: an unverified lookalike of the utility. Same banner file, near-identical avatar | ✘ | generated draft |
| `MetroDesk9` | Metro Desk 9 | Local TV news: breaking news and video | ✔ | generated draft |
| `TheScoopHQ` | The Scoop | Sensational, low-credibility outlet that amplifies the rumor | ✘ | generated draft |
| `mvega_fh` | Marisol Vega | East-side mom and nurse: practical, worried questions | ✘ | placeholder (garden) |
| `tbrandt41` | Tom Brandt | Small-business owner: skeptical, falls for the lookalike | ✘ | placeholder (dog) |
| `kwardFH` | Keisha Ward | Community organizer: steers people to verified accounts | ✘ | placeholder (hands) |
| `dreyes_fh` | Dana Reyes | Ordinary resident: confused, shares the fake, then corrects | ✘ | placeholder (cat) |

## Storyline, beat by beat

The beats are the plan's demo storyline v2 ([§3](../PARTICIPANT-FIRST-DEMO-PLAN.md#3-demo-storyline-v2-20-min-desktop)).
`pNN` are opening-feed posts and `rsNN` are run-sheet items. T−N is minutes before the seed's scenario anchor.

### Beat 1: "It's X." (the opening feed, already there when the PIO signs in)

| Phase | Posts | What happens |
|---|---|---|
| The break (T−355 to T−305) | p01–p05 | Metro Desk 9 breaks the story (p01). Residents lose pressure (p02, p04). The utility responds with a crew photo (p03). County EM supports and redirects traffic (p05) |
| The advisory (T−290 to T−246) | p06–p12 | **Metro Desk 9's on-scene video (p06, plays inline; thread p06→p07→p08).** The utility issues the boil water advisory (p09). County EM shares it with a 2-photo grid (p10). A zone-map question gets answered by a neighbor (p11→p12) |
| First doubts (T−240 to T−200) | p13–p17 | The Scoop: "only telling us NOW?" (p13). A boiling tip (p14). **Brown-water photo (p15) with the utility's answer in-thread (p16).** Hydrant flushing explained (p17) |
| Water sites and the lookalike (T−185 to T−138) | p18–p26 | Repairs run into tomorrow (p18). **County EM opens free water sites (p19), with a 3-deep thread: infant line question → answer → confirmation (p19→p20→p22→p26).** **The lookalike says "bring cash, $5 per case" (p21) and outpaces the official post.** In its thread a neighbor flags it (p23), a resident can't tell them apart (p24) and **the verified utility says the account isn't theirs (p25)** |
| Lines, rumor, recovery (T−130 to T−14) | p27–p36 | Lines at the high school, photo (p27). Neighbors helping (p28). **The Scoop's anonymous "source" (p29) and the exchange under it (p29→p30→p31).** Pressure returns in Zone 2 (p32). County EM reminder (p33). A thank-you (p34). A shower question answered (p35→p36) |

Point out: **Trending `#WaterIssues`** (21 of the 36 opening posts carry it, and no post carries another tag), the
inline video (p06), the **verified utility beside its lookalike** (p21 and p25 in one thread), threads with
replies, and profiles with Media tabs (@KestrelCoEM, @FairhavenWater, @MetroDesk9, @tbrandt41).

### Beat 2: the controller drops breaking news

| Item | Kind | What |
|---|---|---|
| **rs01** | post | **Metro Desk 9, BREAKING, with video (`news-mill-road`)**: a second main has burst on Mill Road. Fire it, or show the live path: the composer, post as MetroDesk9, attach the clip from the media library (or upload `media/news-mill-road.mp4` from the demo laptop), paste the text, then Skip rs01. Nothing replies to rs01, so both paths work |
| rs02 | burst (4, 45 s) | Residents react: "mill road is a river", "stay back", pressure dropped, "is the advisory getting bigger?" |

### Beat 3: misinformation

| Item | Kind | What |
|---|---|---|
| **rs03** | post | **The impersonator (@FairhavenWaterUpd) with the brown-water glass photo:** "URGENT: Do NOT boil… boiling concentrates the contaminant… the advisory now covers ALL of Fairhaven." Baseline 1,840 likes / 1,420 reposts / 310 replies. **The beat-5 takedown target.** Fire it before rs04 and rs10 (they reply to it) |
| **rs04** | burst (7, 75 s) | **The pile-on: 7 replies under rs03**, so its reply count climbs live. A worried mother, a cynic, a resident who pours out her boiled water (a reply to a reply), The Scoop ("share before it disappears"), Keisha noticing there's no check mark, and "they look exactly the same to me" |
| rs05 | post | **The Scoop amplifies with the brown-tap video (`scoop-brown-tap`)**: "And they want you to BOIL it? 👀" |
| rs06 | burst (3, 40 s) | Run on bottled water: empty-shelves photo plus two replies in its thread |

### Beat 4: the PIO responds

| Item | Kind | What |
|---|---|---|
| **rs07** | post | **The cue.** Metro Desk 9: "Posts claiming boiling is unsafe… are spreading fast. We have asked Kestrel County EM and Fairhaven Water to confirm." |
| *(live)* | — | **The PIO posts the official statement as @KestrelCoEM and attaches `pio-statement-card.png`** (see below) |
| rs08 | post | **BACKUP ONLY**: the same statement and card as @KestrelCoEM. Fire only if the live post fails, otherwise Skip |
| **rs09** | post | **The citizen follow-up question.** Preferred: in Live world, *Reply as…* `mvega_fh` on the PIO's post with this text, so the PIO sees it in the thread. Fire rs09 only if replying live is not possible (it posts top-level and mentions @KestrelCoEM) |
| rs10 | post | **The verified utility replies inside the impersonator's thread** (a reply to rs03): "This is not a Fairhaven Water account…" |
| rs11 | burst (3, 45 s) | The correction spreads. Dana apologises for sharing the fake. Tom: "so why is the fake one still up?" (the lead-in to beat 5) |
| rs12 | post | Metro Desk 9 reports the correction to its larger audience |

**PIO script** (suggested; the PIO can word it differently):

> OFFICIAL: Boiling tap water for 1 minute IS safe and is still the right step in Zones 2-4. The advisory has NOT
> expanded. Posts saying otherwise did not come from Fairhaven Water or Kestrel County EM. Rely on verified accounts
> only. #WaterIssues

Attach `docs/demo/pack/media/pio-statement-card.png`. Copy it to the demo laptop beforehand. Alt text to type if
the composer asks: "Official notice from Kestrel County Emergency Management: boiling tap water for 1 minute is
safe; the advisory has not expanded beyond Zones 2 to 4; free bottled water at Elm Street Fire Station and
Fairhaven High School; official updates only from verified accounts."

**Reply as… text** (`mvega_fh`, on the PIO's post):

> @KestrelCoEM thank you. Is the formula I made earlier with boiled water still OK to use? And should we throw out
> the ice in the freezer?

### Beat 5: moderation (if C5 is in the build)

| Item | Kind | What |
|---|---|---|
| *(live)* | — | **Take down rs03** (the impersonator's post) from Live world. It disappears from the participant feed |
| rs13 | post | OPTIONAL: the impersonator doubles down. A second takedown target, e.g. when rs03 was already taken down in a run-through. Skip if not needed |
| rs14 | burst (3, 30 s) | **Fire only after the takedown**: "The fake water account's post is gone…". Skip if takedown is not in the build |

### Close

| Item | Kind | What |
|---|---|---|
| rs15 | post | Fairhaven Water: the Mill Road break is isolated and the advisory stays. Fire it, then **Freeze** (beat 6). Beat 7 (the engine teaser) needs no run-sheet item |

All items are assigned to `"me"` (the controller who runs the seed) and carry `plannedMinute` T+3 to T+18 as
display hints. Nothing fires on its own.

### The rumor outpaces the official word

Seeded baselines (likes / reposts / replies). Real clicks are added on top during the demo.

| Rumor | Baseline | Official | Baseline |
|---|---|---|---|
| p21 lookalike "$5 per case" | 724 / 611 / 88 | p19 County EM water sites | 612 / 538 / 37 |
| p29 The Scoop "a source says" | 547 / 332 / 92 | p32 utility "pressure returning" | 262 / 181 / 30 |
| **rs03 impersonator "do NOT boil"** | **1,840 / 1,420 / 310** | **the PIO's live post** | **real counts only** (participants get no baseline) |
| rs05 The Scoop video | 962 / 718 / 141 | rs10 utility reply | 344 / 291 / 41 |

## What Tom needs to decide or replace

### 1. Names: approved 2026-10-13 (FIC-001)

Tom approved the fiction's names on 2026-10-13 ([FIC-001](../../design/DECISIONS.md)), and the pack's `county`
line records it. The backend half shipped in #482: `PersonaCastSeeder` seeds the new handles and the engine's
silence test (`StarterStorylineFactory.StorylineExpectation`) names "Kestrel County Emergency Management".

| Name | Decision | In the pack |
|---|---|---|
| **Kestrel County** / "Kestrel County EM" (`@KestrelCoEM`) | New fictional county, replacing a real county name | Display name, bio, locations, post text, the notice card, the avatar mark ("KCEM") and the file names |
| **Metro Desk 9** (`@MetroDesk9`) | New TV station name, replacing one close to real news brands | Display name, bio, post text, run-sheet titles, the avatar mark and the file names |
| **Fairhaven** | Kept (FIC-001) | Unchanged. So are the other seven handles and `#WaterIssues` |

FIC-001 did not cover two smaller points from the draft. Both are optional and can be settled in the content
review (display names change in `pack.json` alone):

| Name | Concern | Option |
|---|---|---|
| **The Scoop** | Generic; outlets with similar names exist | Probably fine |
| **Tom Brandt** | Shares the presenter's first name, which may get a laugh in a live demo | "Theo Brandt" fits the handle `tbrandt41` |

### 2. Media

- Replace the **23 placeholders** with Pexels/Pixabay stock, following [`MEDIA-SHOTLIST.md`](MEDIA-SHOTLIST.md):
  same path and file name, the listed sizes, and **no faces, logos or real brands**. Fill in
  [`CREDITS.md`](CREDITS.md) as you go. If P3 test clips fit a video slot, start from them.
- Approve or replace the **6 generated drafts** (5 org avatars and the PIO notice card). The Kestrel County EM
  and Metro Desk 9 avatars and the notice card were redrawn with the new names on 2026-10-14.
- After swapping, update `width`/`height`/`durationSec` in `pack.json` if a file differs from the listed size or
  length, and **re-read each media `alt`** against the real shot.

### 3. When to seed: read this before Mon 10/19

The opening feed is dated `anchor − minutesBeforeAnchor`, and the anchor defaults to the moment S1 runs. The
participant app counts trending over the **last 12 scenario hours** (`explore/trending.ts`), and the scenario
clock tracks wall-clock time. **If the final seed runs Monday and the demo is Tuesday, every opening post is about
a day old: Trending `#WaterIssues` is empty at the start of beat 1 and every timestamp is a day stale.**

Recommended: on demo morning, after the final reset and at least an hour before the demo, run Clear-DemoContent →
Reset-DemoState → Seed-DemoContent. Uploads are reused and the archived posts are re-posted on a fresh anchor. The
story reads best with the anchor between late morning and mid-afternoon, so the first posts land in the early
morning ("woke up to almost no water pressure"). Seeding the day before with `-ScenarioAnchor <demo start>`
would date the posts in the future until the demo. That looks wrong in rehearsals and keeps them out of Trending
until then, so I do not recommend it.

### 4. Demo-day prep

- `media/pio-statement-card.png` on the PIO's laptop, and `media/news-mill-road.mp4` on the controller's laptop if
  you show the live upload in beat 2.
- The PIO participant posts as `KestrelCoEM` (`New-DemoParticipant.ps1 -PersonaHandle KestrelCoEM`, the
  default). Their profile will show the County EM posts from the opening feed as their own history. That is
  intended.

### 5. A read-through

- Tone and local plausibility, and the health lines: boil 1 minute; shower but don't swallow; a sponge bath for
  little ones; formula with boiled or bottled water; throw out ice. These follow common public-health guidance;
  an SME glance would help.
- Absolute clock times are kept out of post text on purpose ("opens in one hour", "into tomorrow"), so the story
  works on any anchor. Keep it that way when editing.

## Running the seed

How to run S1, every switch, and the rehearsal rules are in
[`scripts/uat/README-seed.md`](../../../scripts/uat/README-seed.md). In short:

```powershell
pwsh scripts/uat/Seed-DemoContent.ps1 -WhatIf                                   # validate the pack + plan; no sign-in, no writes
pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1                # full run (hidden secret prompt, or $env:PULSE_STAFF_SECRET)
pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1 -ReloadFiredRunSheet   # after a rehearsal fired the run sheet
```

- **After every rehearsal that fired run-sheet items, add `-ReloadFiredRunSheet`.** A fired item is spent: the
  console cannot fire it again. A plain run reports it and its self-check fails.
- **After a partial rehearsal** (some items fired, the rest pending), first **Skip the remaining items in the
  console**, then run with `-ReloadFiredRunSheet`, so the whole sheet reloads in pack order. Otherwise "Fire next"
  opens mid-story.
- The pack uploads 29 files, under the server's 30-per-minute limit. S1 waits out a 429 if you add more.
- Run order: `Clear-DemoContent.ps1` (optional), then `Reset-DemoState.ps1`, then `Seed-DemoContent.ps1`.

## Editing rules (S1 and the schema enforce most of them)

- **Never change a handle or `#WaterIssues`.** Display names, bios, locations and avatars are free.
- Post text ≤ 280 characters, no markup (`<…>`), no URLs, phone numbers or real addresses.
- No "simulation", "exercise" or "training" in post text, bios or alt text. Controller-facing `title` and `notes`
  may say anything.
- A reply comes **after** its parent in `posts` and has a `minutesBeforeAnchor` no larger than its parent's. Keep
  the list in descending `minutesBeforeAnchor` order.
- A run-sheet reply names `{ "postKey": "pNN" }`, `{ "sequence": n }` (an earlier post of the same item) or
  `{ "item": "rsNN", "sequence": n }` (an **earlier** item). A burst's `burstWindowSeconds` must be at least
  3 × (posts − 1).
- Every media item needs a meaningful `alt`. A post-level `alt` overrides it for that post.
- Run `-WhatIf` after every edit.

## Validation (2026-10-14, after the FIC-001 rename)

- `pack.json` validates against `schema/pack.schema.json` (PowerShell `Test-Json -SchemaFile`, and Python
  `jsonschema` draft-07): no errors.
- `Seed-DemoContent.ps1 -WhatIf` validation **passes** with exit 0: "9 persona edit(s), 29 file(s) (874 KB),
  36 post(s) (23 top-level), 15 run-sheet item(s) (30 scripted post(s))". Every file passes the magic-byte and size
  checks, and the three placeholder videos are real H.264 1280×720 MP4s. The single WARN was the anonymous
  `/api/exercise-context` call: the check ran offline, with `-ApiHost` on a closed loopback port. Run `-WhatIf`
  from a normal machine for the zero-warning check.
- Content checks (post text ≤ 280 characters, no out-of-fiction words, URLs or phone numbers, opening feed in
  descending time order, image sizes match `pack.json`): no problems. The pack's nine handles are exactly the nine
  in `PersonaCastSeeder`'s catalog, including `KestrelCoEM` and `MetroDesk9`.
- Not checked here, because it needs UAT: that the handles resolve on the server, that `"me"` is on the assignee
  list, and the live self-check.
