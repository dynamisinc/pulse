# R — Cross-surface reconciliation (D1 ↔ D5), session 3

> **Verbatim excerpt** from the design-workspace `DECISIONS.md` (session 3), imported so story
> references to `R-001`…`R-006` resolve in-repo. The design workspace's `DECISIONS.md` is the
> source of truth — **do not edit here**; re-import on the next design handoff. Companion
> inventory: [`COMPONENTS.md`](COMPONENTS.md) ("Shell extraction").

### R-001 — Verified mark unified to the D1 scallop seal
The console rendered three ad-hoc star-shaped marks (two #4d97d1, one accent-navy — the exact
failure SOC-052 exists to prevent: the trust mark must never derive from theme color). All three
replaced with the canonical D1 scallop-with-check, fixed seal-blue #2D9CDB, on post cards,
persona palette, and composer identity header. Satisfies SOC-052, D1-003.

### R-002 — Engagement row order unified: reply · repost · like
Console post cards showed ↺ ♡ ↩; the participant app renders reply → repost → like. Console
reordered to match — controllers read the same anatomy participants see.

### R-003 — Console staff overlay: always-visible origin line (user: decide-for-me)
Each console post card now carries one compact mono line participants never see:
`{origin} · FIRED {scenario clock}`. Origin vocabulary: ENGINE · AUTO, SIMCELL-1/2 · MANUAL,
INJ-nnn (matches MSEL inject ids; gov advisory post tagged INJ-042, consistent with the fired
timeline item). Always visible rather than hover-only: hover already carries actions, and
glanceable provenance is the point. Fired time derived from scenario clock minus post age.

### R-004 — Avatars: duotone human silhouettes; orgs keep monograms (user: decide-for-me)
Human accounts on both surfaces render a duotone head-and-shoulders silhouette (white .85 mask
over the persona color — offline-safe, no photo dependency). Org/institutional accounts keep
monograms (logo-analog; also preserves the intentional near-identical imposter pair, both orgs).
Humans — D1: @mvega_fh, @tbrandt41, @kwardFH, @dreyes_fh. D5: darco, maria, aisha, tommy, coral,
ray + the three trainee roster rows. Photo avatar library (COR-024) remains deferred (D1-R6);
this replaces raw initials as the interim treatment.

### R-005 — Worlds NOT merged; mapping documented (user decision)
Each mockup keeps its own demo data; no shared data module. Role-equivalence mapping between the
two Fairhaven water-crisis casts, for anyone reading them side by side:

| D1 (participant app) | D5 (console) | Role |
|---|---|---|
| Fairhaven Water Utility @FairhavenWater | Fairhaven Water Dept @FHWaterDept | official utility voice |
| The Scoop @TheScoopHQ | The Scoop @thescoop | sensational outlet (handle mismatch, left as-is) |
| Newsline 7 @Newsline7 | Maria Solano @maria_solano7 | broadcast news (org account vs anchor persona) |
| Marisol Vega / Tom Brandt / Keisha Ward | Coral Nguyen / Tommy Rourke / Ray Osei / Darco Tripp | citizen archetypes |
| Fulton County EM @FulcoEM | City of Fairhaven @FairhavenGov + Fairhaven Dispatch @FairhavenPSAP | official government voice (split in D5) |

Known divergences, intentional and retained: advisory zones (D1: 2–4; D5: 3–7), scenario clock
(D5 console at 09:33 run-up; D1 feed reads mid-advisory), D5 adds the 911-outage storyline.
These are different exercise sessions in the same fiction family, not one timeline.

### R-006 — Shell extraction: improvised chrome inventoried, frozen pending D7
Both mockups improvised container chrome (exercise banners, brand lockups, identity/role
chrome, alert bar, clock cluster). Full inventory with markup anchors and 8 documented
divergences now lives in COMPONENTS.md ("Shell extraction"). All inventoried elements are
marked "replaced by shell — see D7". No shell design was done in this session; both mockups
keep their improvised chrome untouched so D7 starts from evidence, not memory.
