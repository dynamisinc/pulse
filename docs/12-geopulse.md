# E11 — GeoPulse (Geo-referenced Content Map)

> **Status:** **Proposed** — draft for review, 2026-11-02. Not yet in a phase; see §5 Q1.
> **Epic ID:** E11 · **Requirement prefix:** GEO
> **Depends on:** E1 (isolation, roles, exercise configuration, clock); E2 (posts — implements SOC-001's "optional location tag"); E7 (console composer, inject queue) · **Feeds:** E10 (timeline, replay, AAR)
> **Roles served:** Controllers, Exercise Directors, Planner/ExerciseAdmin, OrgAdmin; Evaluators read-only (COR-013). Participants only *tag* — they never see the map.
> **Looking Glass parity target:** none — Looking Glass has no geographic view. A differentiator, like E8 and E10.

## 1. Epic summary

GeoPulse puts the simulated information environment on a map. Staff see where geo-referenced social content is "coming from" across the exercise area, live during conduct and afterwards in the AAR. During conduct, a controller watching a burst can see that the flooding reports cluster on the east side of town while the official posts name the west-side shelter. Afterwards, an evaluator can show the hotwash how the information picture spread across the jurisdiction over scenario time.

Locations get onto content in two ways, and the difference matters:

- **Location tag (public).** Part of the post itself, the way real platforms show "📍 Riverside Park". Participants may add one to their own posts if they choose, by picking from the exercise's place list. Controllers add one when posting as a persona, or script one into an inject. Participants see it on the post as a place name; they never see the map.
- **Geo-reference (staff-only).** A controller places any post on the map without changing the post. An example is a citizen post that says "water over the road on Main St" but carries no tag. Geo-references never render on a participant surface.

The map is a **staff surface** (COBRA, staff world). It is called a "channel" informally, but in Pulse's vocabulary (Master §7) a channel is a participant destination. GeoPulse is never added to the participant channel list or channel nav, and no participant route reaches it (XC-002).

Scope discipline: this is situational awareness over exercise content, not a GIS. It plots points the exercise defines; it does not geocode the world, track devices, or analyze terrain.

## 2. Features & requirements

### F11.1 Location model & exercise geography

| ID | Requirement |
|---|---|
| GEO-001 | A **location** value is a WGS84 point (latitude/longitude) plus a display **label**, a **source** (participant / controller-as-persona / staff geo-reference / scripted inject / import / engine), and the actor and dual time (wall + scenario) it was set at. It is exercise-scoped like all content (COR-001). |
| GEO-002 | Each exercise defines an **area of interest** (the map's default extent and centre) as part of exercise configuration (F1.4). Seeding or duplicating an exercise carries it (COR-021, exercise duplication). |
| GEO-003 | Each exercise has a **place list** (gazetteer): named points such as "Riverside Park", "Kestrel County EOC" or "I-85 at Exit 12", each with coordinates and an optional category. Planners build it by hand, by clicking on the map, or by CSV import. It is the source for participant tags (F11.2) and a shortcut for staff. |
| GEO-004 | A social post can carry **at most one location tag** and **any number of staff geo-references**. The model is shared rather than post-specific, so articles, releases and weather products can carry locations later without reworking post locations (see GEO-060). |
| GEO-005 | Locations follow soft-delete and audit rules (XC-010): removing or changing a tag or geo-reference is recorded, never hard-deleted, and is visible in the timeline (EVL-001). |
| GEO-006 | Setting, changing or removing a location tag or geo-reference emits a telemetry event (XC-004) with actor, dual time, source and target content. |

### F11.2 Participant location tagging

| ID | Requirement |
|---|---|
| GEO-010 | The participant composer offers an **optional "Add location"** control, off by default, completing SOC-001. The participant picks a place from the exercise's place list with type-ahead. No map is shown and no coordinates are displayed. |
| GEO-011 | A tagged post renders the place **label** under the author line, styled per the brand skin like real platforms (participant world; no COBRA, no enterprise look). Participant-facing payloads carry the label only; coordinates are not sent to participant sessions (NFR-007 minimization). |
| GEO-012 | **No device geolocation at launch.** The browser's location API is never requested on participant paths. A participant's real-world position (usually the EOC they are sitting in) is PII and meaningless to the scenario (NFR-007). See §5 Q4. |
| GEO-013 | Wherever a participant can edit their own post, they can also add, change or remove its tag. Deleting a post removes the tag with it. Earlier tags are retained for the AAR (XC-010). |
| GEO-014 | Org-account posting (SOC-006) works the same way. The tag is attributed to the individual human behind the shared org account (COR-018). |

### F11.3 Staff geo-tagging from the controller console

| ID | Requirement |
|---|---|
| GEO-020 | The controller composer can set a **location tag** when posting as a persona (CTL-001), by picking from the place list, clicking the map, or entering coordinates. It adds no more than one step to the ≤3-second persona-switch-to-compose budget (CTL-002) and does not count against the CTL-034 decision budget when unused. |
| GEO-021 | Scripted content in the inject queue (F7.2) and rows imported from a MSEL or run sheet can carry a location as a place-list name or latitude/longitude columns. The tag is applied when the inject fires. |
| GEO-022 | A controller can add a **staff geo-reference** to **any** post in the exercise (participant, persona, engine or inject), from the monitoring board, a watchlist column, a thread, or the map itself. Doing so never changes the post or what participants see. |
| GEO-023 | Staff **cannot alter a participant's own location tag**. They add a geo-reference instead, so participant-authored content stays exactly as the participant wrote it for evaluation. |
| GEO-024 | Geo-references are attributed and audit-logged (who, when, wall + scenario time). They can be corrected or removed, and both actions are logged. Multi-controller presence (CTL-004) shows when two controllers are placing the same post. |
| GEO-025 | **Bulk placement:** select several posts (for example a burst about one incident) and place them at one place or point in one action. |

### F11.4 The GeoPulse map (staff surface)

| ID | Requirement |
|---|---|
| GEO-030 | A staff-only map view, reachable from the staff console and the evaluator surface, opens on the exercise's area of interest and shows every geo-referenced post as a marker. **Public tags and staff geo-references use different marker shapes and the legend names them; they are never distinguished by colour alone** (NFR-001). |
| GEO-031 | **Live:** new and changed locations appear without a reload through the staff real-time groups. Markers cluster as density rises, and the map stays legible and responsive at NFR-002 burst load (120 posts/min for ≥10 min). |
| GEO-032 | **Filters:** scenario-time window, channel, origin, persona type, author or org, hashtag, storyline, and location kind (tag / geo-reference). Filters combine and are reflected in the list view (GEO-034). |
| GEO-033 | Selecting a marker or cluster shows the post(s) as staff-rendered cards (author, scenario time, origin, engagement) with deep links to the thread in context and to the timeline entry (EVL-002). Controller actions available elsewhere (reply as persona, takedown, flag to AAR) are available from the card, subject to role. |
| GEO-034 | **List equivalent:** every map state has a keyboard-operable table of the same posts (place, scenario time, author, excerpt), sortable and filterable. The map is not the only way to reach any information (NFR-001, Section 508). |
| GEO-035 | **Time scrub:** a scenario-time slider shows how geo-referenced content accumulated. It follows the replay fidelity contract (EVL-003): ordering and content are exact, and scenario-time jumps (COR-051) are labelled discontinuities. |
| GEO-036 | Taken-down content (CTL-025) never renders as a post on the map; it shows as a takedown marker to staff only. Soft-deleted participant posts are hidden by default, with a staff toggle to show them. |
| GEO-037 | Evaluators get the map read-only (COR-013): they can view, filter, scrub and annotate (EVL-020…), but cannot add geo-references or act on posts. |
| GEO-038 | **Degraded basemap:** if map tiles cannot load (provider outage, agency web filter, COR-009), the map still plots markers on a plain coordinate grid with the place-list labels, and the list view works unchanged. Pulse never shows a blank panel. |

### F11.5 Scenario layers *(later — stub)*

| ID | Requirement |
|---|---|
| GEO-040 | Planners can add **overlay layers** to the map: points (shelters, EOCs, PODs), lines and areas (incident perimeter, evacuation zones, flood extent). Layers are drawn by hand or imported as GeoJSON. |
| GEO-041 | Layers can be keyed to scenario time (an evacuation zone appears at D+0 1400) and toggled on and off by staff. |
| GEO-042 | When weather zones gain geometry (WX-004, parked in weather-source story 02), they render as a layer and active warning products shade their zones. |

### F11.6 Evaluation & AAR

| ID | Requirement |
|---|---|
| GEO-050 | The printable exercise report and the AAR package (EVL-030) gain a **GeoPulse section**. It holds a static map of the area of interest with all geo-referenced posts, optional maps per scenario-time window, and a table of those posts in scenario-time order with place, author and excerpt. The section is omitted when the exercise has no locations. |
| GEO-051 | Machine-readable exports (EVL-031) include locations: **GeoJSON** of geo-referenced posts, plus latitude, longitude, place label and location kind columns in the existing CSV/xlsx exports. |
| GEO-052 | The map, its time scrub and the report section are available within the hotwash window (EVL-033: ≤15 minutes after EndEx). |
| GEO-053 | Archived exercises keep their locations and map integrity (COR-006, EVL-032) under the same retention policy. |

### Later-phase hooks *(record only — not active stories)*

| ID | Requirement |
|---|---|
| GEO-060 | News articles, press releases and weather products (E4/E5/E6) can carry a location tag and appear on the map, using the same model (GEO-004). |
| GEO-061 | The adaptive engine (E8) can place generated posts at places relevant to their storyline (for example citizen reports clustered near an incident), with the source recorded as engine. |
| GEO-062 | Cadence injects (E9) carry a location field that maps onto GEO-021. |

## 3. User experience

**Conduct.** A controller has the map open in a console panel beside the monitoring board. A scripted inject fires a burst of citizen posts about a chemical smell, tagged near the rail yard; they cluster on the map within seconds. Two participant PIOs post updates: one tags "Kestrel County EOC", the other doesn't tag. The controller notices an untagged citizen post naming Elm St, drops a staff geo-reference on it, and sees the rumour is three blocks outside the official shelter-in-place area. That prompts a decision to escalate, which they take from the marker's card. Throughout, participants see only place names on posts. They have no idea a map exists.

**Hotwash.** The evaluator opens the map within minutes of EndEx and scrubs scenario time from StartEx. The room watches the citizen reports spread east while the official messaging stayed pinned to the west. The same picture, as a static map and a table, is a section of the printed report.

**Design notes.**

- **Staff world, COBRA, desktop-first** (XC-007; tablet layout per the existing console patterns). The participant-side change is small: one optional composer control and a place label on the post card, both inside the brand skin.
- **Accessibility is the main design risk.** Maps are hard to make Section 508-conformant. The list equivalent (GEO-034), keyboard marker navigation and non-colour marker kinds are requirements, not polish.
- A **design brief (D8)** is needed before the map surface is decomposed into stories. It should cover the map's placement in the console (panel, page or flyout), marker and cluster language, and the time scrub.

## 4. Out of scope

- Any participant-facing map, including a pin-drop map in the participant composer at launch (§5 Q4).
- Tracking or displaying participants' real-world device location.
- GIS analysis: buffers, routing, drive-time, terrain, 3D.
- Automatic geolocation of untagged posts from their text (an AI inference feature). It is a candidate E8-adjacent idea, not v1.
- Live real-world geodata or social feeds (the isolation principle: the exercise's world is the scenario's world).
- Offline tile packages for air-gapped venues (the degraded basemap, GEO-038, is the launch answer).

## 5. Open questions

1. **Phase and release.** Which phase does E11 belong to? Suggested default: after the December channels release, with F11.1 and F11.2 (the location model and participant tag) able to land earlier as the SOC-001 follow-up the posts backlog already records. *(Tom to decide.)*
2. **Basemap provider.** Azure Maps (fits the Azure hosting posture, NFR-006; check Azure Government availability for the Gov roadmap) or an OpenStreetMap-based tile service? Either way the provider sits behind an interface. Its hosts must be added to the CSP (channels-foundation 23) and to the published firewall allowlist (COR-009). Per-exercise tile cost must fit the Cadence cost posture. *(Needs a spike.)*
3. **Fictional geography.** Exercises set in fictional places such as Kestrel County have no real basemap. Should planners be able to use a real area as a stand-in, upload a custom image basemap, or both?
4. **Participant precision.** Is the place list enough, or should participants also be able to drop a pin, or (with consent) use device location? The default is the place list only, for PII and simplicity.
5. **Content scope in v1.** Social posts only (the default), or also articles, releases and weather products (GEO-060) once those channels ship?
6. **Evaluator geo-references.** Should evaluators be able to add geo-references as a form of annotation, or stay strictly view-only (the default, COR-013)?
7. **Naming.** "GeoPulse" is staff-facing. Does it need the same trademark screen the in-fiction names had (Master §8 Q3) before customer-facing use?
