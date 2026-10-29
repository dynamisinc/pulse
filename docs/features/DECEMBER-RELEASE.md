# December release — feature index, combined plan and open questions

> **Status:** planning only (docs, no code, no GitHub issues). **Release:** December (Tom, 10/21); today is 10/29. **Source of truth:** the five feature folders below; this page is the
> cross-feature view the orchestrator and Tom read first. Written by the December consolidation pass, which folded the channels' foundation follow-ups into the foundation, defined one migration
> sequence and one platform-prerequisite list, applied the three cross-channel requests, and de-duplicated every open question into one list.
>
> Where things live: foundation contracts, migration ledger, platform prerequisites and the follow-up resolution ledger are in
> [`channels-foundation/implementation.md`](channels-foundation/implementation.md); each channel's own contracts are in its `implementation.md`.

## 1. The five features

| Feature | Epic | Stories | L / M / S | Est. sittings* | Stack mix | Folder |
|---|---|---|---|---|---|---|
| **Channels foundation** (content pipeline, outlets, alerts, router, skins, staff seam, social prerequisites) | E3–E6 shared (under E1) | **21** | 4 / 15 / 2 | ≈ 34 | 9 backend, 4 fullstack, 7 frontend (incl. new 21), 1 testing | [`channels-foundation/`](channels-foundation/feature.md) |
| **News network** (4 outlets, articles, skins, editor) | E4 | **20** | 3 / 9 / 8 | ≈ 29 | 1 backend, 18 frontend (2 staff), 1 testing | [`news-network/`](news-network/feature.md) |
| **Press Room** (release kind, PDF, composer, wire, approval) | E5 | **15** | 6 / 7 / 2 | ≈ 28 | 5 backend, 1 fullstack, 8 frontend (2 staff), 1 testing | [`press-room/`](press-room/feature.md) |
| **Weather source** (products, zones, delivery, site, staff authoring) | E6 | **15** | 2 / 9 / 4 | ≈ 23 | 5 backend, 1 fullstack, 8 frontend (3 staff), 1 testing | [`weather-source/`](weather-source/feature.md) |
| **Exercise portal + TTX display** (portal, kiosk, resources, console) | E3 | **23** | 8 / 11 / 4 | ≈ 41 | 6 backend, 1 fullstack, 15 frontend (3 staff), 1 testing | [`exercise-portal/`](exercise-portal/feature.md) |
| **Total** | | **94** | **23 / 51 / 20** | **≈ 154** | | |

\* Sittings use the features' own guide (S ≈ 1 focused sitting, M ≈ 1–2, L ≈ 2–3) at S = 1, M = 1.5, L = 2.5. It is a sizing aid, not a schedule. Effort changes made by the consolidation: **foundation 13 M → L**
(external skin registration, token-object scope, reset boundary, fonts); **foundation story 21 added** (M). Foundation 04 stays L but is the heaviest story (12 ACs; split seam documented in its tech notes).

### What the consolidation changed in the foundation (summary)
| Change | Where |
|---|---|
| **New story 21** — Social prerequisites (portal R-S1 + news FU-5 compose-with-link + FU-6a post-by-id) | `21-social-prerequisites.md` |
| **Amended stories** 01 (3 follow-up columns), 02 (async validation, new seams, **one** telemetry-vocabulary edit for all channels), 03 (`ISkinOverridesValidator`, idempotent single weather outlet), 04 (sanitizer profile registry, `touchUpdatedStamp`, participant callers + `IContentPublishGate`, options persistence/resolution), 05 (replays options), 06, 07 (`feature/reorder`, schedule options), 09, 11 (multi-alert AC), 12 (route families, no swallowing), 13 (**external skin registration**, `SkinScope`, `SkinResetBoundary`, `registerSkinExtension`, `registerSkinFonts`; M → L), 14 (dateline format registry, player in `core/media`), 15, 16, 17 (`ownsDeliveryOptions`), 18 (acting human from the call), 20 (migration-ledger test) | story files |
| **Contracts (additive)** FC-1 Updated-stamp rule; FC-2 columns; FC-4 `feature/reorder` + channel route families; **FC-6b** channel telemetry vocabulary; FC-7 async validation, `ResolvePublishOptions`, `ISanitizerProfileRegistry`, `IContentPublishGate`, `ISkinOverridesValidator`; **FC-7a** options resolution; FC-8 social side; **FC-8a** skin registration | `implementation.md` |
| **Migration ledger** M1–M5 | `implementation.md` § Migration ledger, section 3 below |
| **Platform prerequisites** PP-1…PP-5 | `implementation.md` § Platform prerequisites, section 5 below |
| **Follow-up resolution ledger** (every news/press/weather/portal FU mapped to a story, FC or PP) | `implementation.md` § Follow-up resolution ledger |

Item-by-item results: of the **35** channel follow-ups (news 9, press 9, weather 8, portal 9), **23 were folded into existing foundation stories/contracts** (many collapsing duplicates into one change),
**2 into the new story 21** (news FU-5, FU-6a; with portal R-S1 that is three requests), **3 are migration-ledger entries** (press FU-4, weather FU-1, portal FU-1), **4 are platform prerequisites** (portal FU-5, 6, 7, 9)
and **3 needed no foundation change** (press FU-6, 7, 9). The four cross-channel requests: R-S1 → story 21; R-W1 → weather 10; R-P1 → press 01/04/05/09/15; R-N1 → nothing to do. De-duplicated: four skin-registration
asks → one call (`registerSkinTokens`); four telemetry-vocabulary asks → one edit in F02; two options asks (press FU-3, weather FU-2) → one resolution rule (FC-7a); two sanitizer asks → one registry; three migration
asks → one ledger.

## 2. Combined waves (foundation first, then the channels they unblock)

Six integration waves (**CW1–CW6**). A wave's stories have disjoint file footprints and fan out in parallel; an entry marked **→** has a same-wave serial edge. Channel stories sit at the earliest wave in which
every dependency is merged. The feature-local wave numbers in each `feature.md` are unchanged; the moves versus them are listed under the table.

| Wave | Foundation | News (E4) | Press (E5) | Weather (E6) | Portal (E3) | Platform / migration |
|---|---|---|---|---|---|---|
| **CW1** (4) | **01** (M1), **02**, **21** | — | **02** (PDF/`document` kind; long pole) | — | — | PP-1 (identity), PP-3 (CSP) work starts; **M1** |
| **CW2** (11) | 03, 04, 08, 09, 10, 13, 14 | — | 03 (PDF render, on mock) | 01 (contract, kinds) | 01 (**M2**), 02 | PP-1 merged; **M2** |
| **CW3** (26) | 05, 06, 07, 11, 12 | 01, 03, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14 | 01 → 04 | 02 (**M3**), 07 | 03, 04, 05, 06, 07 | **M3** |
| **CW4** (26) | 15, 16 (**M4**), 17, 18, 19 (→ after 15) | 04, 15 → 16*, 18, 19 | 05, 06 (**M5**, after F16's M4), 07 | 03 → 10*, 04, 05, 06 | 08, 09, 10, 11, 13, 14, 15, 21 | **M4**, **M5**; PP-2 merged |
| **CW5** (23) | 20 | 02, 17 | 08, 09, 10, 11, 12, 13, 14 | 08, 09, 11, 12 (→ after 11), 13, 15 | 12*, 16*, 17, 18, 19, 20, 22 | `/display/*` headers (PP-3) |
| **CW6** (4) | — | 20 | 15 | 14 | 23 | — |

**Moves versus feature-local waves** (all because of a cross-feature dependency the feature docs could not see): news **16** E4-3 → CW4 behind 15 (so 02 can mount in CW5); weather **10** wave 5 → CW4 behind 03's
types/fixtures PR (the portal hard-imports it); portal **12** → CW5 (behind weather 10); portal **16** → CW5 (behind F17); portal **21** may start CW4; news **02** E4-4 → CW5; foundation story **21** is CW1.
Same-wave serial edges to respect: press 01 → 04; F15 → F19; F16 → press 06 (migration order); news 15 → 16; weather 03 (types) → 10; weather 11 → 12.

Gates: **CW2 starts after CW1's F01/F02 merge** (and F21 for news 06/09, merged CW1); **CW3's channel frontends start after CW2's F13/F14/F08 merge**; **CW5's 18 needs PP-2**; CW6 needs F20 (CW5).

### Cross-feature critical path
Longest chain: **F02 → F04 (L) → F06/F09 → F15 → news 04/15 (L) → news 02 → conformance (CW6)**. Three more chains are nearly as long and each carries a single point of risk:
1. **Press PDF:** press 02 (L, security, CW1, no foundation dependency) → 04 (L) → 05 (L) / 07 (L) → 08/09 → 15. The malicious-PDF corpus is the gating review (see Q-03).
2. **Kiosk:** portal 01+02 → **PP-1** → 05 (L, Tier-2 security review, new anonymous route) → 08 → 18 (+ **PP-2**) / 19 (L) → 20 (L) → 23. Fallback is kiosk-lite (Q-35).
3. **Weather warning end to end:** weather 01 → 02 (M3) → 04 (needs F04/F05/F10/F18, FC-7a) → 08/11 → 14.
4. **Migrations:** M1 → M2 → M3 → M4 → M5 are five *serial* merges across CW1–CW4; any slip in one delays the next (see Q-28 for the alternative).
Peak load is **CW3 and CW4 (26 stories each)**, dominated by news and portal frontends; CW5 is 23.

## 3. Migration sequence (one sanctioned, serialized order)

Authoritative copy: [`channels-foundation/implementation.md` § Migration ledger](channels-foundation/implementation.md#migration-ledger). One migration PR in flight at a time; each later one is regenerated against the merged snapshot of the one before.

| # | Owner story | Adds | Wave | Starts when |
|---|---|---|---|---|
| **M1** | foundation **01** | `Outlet`, `ContentItem` (+ `UpdatedScenarioTime`, `PublishOptionsJson`, `LastError`), `ContentItemRevision`, `ContentItemMedia`, `ChannelAlert` | CW1 | now |
| **M2** | portal **01** | `PortalConfig`, `PortalResource`, `PortalDisplay` | CW2 | M1 merged |
| **M3** | weather **02** | `WeatherZone` | CW3 | M2 merged |
| **M4** | foundation **16** | `InjectItem.ContentItemId` | CW4 | M3 merged |
| **M5** | press **06** | `PressReleaseEvent`, `PressApprovalSettings` | CW4 (after M4) | M4 merged |

Deviation from the literal "F01 → … → F16 → channel migrations": M2 and M3 sit **before** F16's M4 because their stories start earlier on the wave axis (waiting for F16 in CW4 would push the portal and weather
zones to CW5+). The rule that matters is "one at a time, in ledger order, none outside the ledger"; story 20 carries a ledger test. If Tom prefers fewer serialized merges, Q-28 offers folding the portal/weather tables
(and F16's column) into M1.

## 4. Combined cut order (cut first → last)

Built from each feature's own list with every feature's internal order preserved. Items marked *(proposed)* are not in the owning feature's docs and need a yes/no.

| # | Cut | Feature | Effect / fallback |
|---|---|---|---|
| 1 | **15** scripted-storm sample seed | weather | stretch; demo convenience only |
| 2 | **22** Top Stories board | portal | F17's per-item pin satisfies PRT-004 |
| 3 | **21** evergreen filler pack | portal | planners author `background` news in F17; Staged portal sparse but valid |
| 4 | **14** console approval settings | press | approval stays default-off, configured by API |
| 5 | **18** article templates *(proposed)* | news | editors start from a blank article |
| 6 | **12** timeline panel (+ 05 read model except `issue-update`) | weather | F17's status list filtered to weather is the timeline |
| 7 | **10** approval UI, then **06** approval gate backend (**drops M5**) | press | gate is off by default; controllers still publish/revise |
| 8 | **12** weather mount | portal | module hides cleanly; kiosk weather slide drops |
| 9 | **05** `issue-update` helper | weather | clone/edit manually; costs re-keying zones/IBW |
| 10 | playlist parts of **19** / **20** | portal | keep pinned target + "show next"; drop auto-cycle and playlist editor |
| 11 | **11** revise-own | press | controller revise via F17 remains |
| 12 | **15** PDF attachments (resources) | portal | text + images only until press 02 lands |
| 13 | **10** widget tile | weather | only needed if the portal lands; pilot mode needs none |
| 14 | **13** zone admin | weather | one default zone via the zone API; WX-004 multi-zone slips |
| 15 | **16** module order/toggle UI | portal | fixed order; hide only via channel enablement |
| 16 | **14** Scoop clutter modules *(proposed)* | news | The Scoop renders as a plain tabloid skin (server/render guards unaffected) |
| 17 | **13** console release editor | press | generic F17 editor with `release` payload as raw JSON |
| 18 | **05 / 08** kiosk credential + remote control → **kiosk-lite** | portal | existing shared view-only login on `/portal?display=1`; drops **PP-1**, per-display telemetry and remote control (see Q-35) |
| 19 | the whole **portal + TTX display** (feature, 23 stories) | portal | pilot-mode landing stays Social; weather 10 and F12's portal landing become dormant (see Q-42) |

**Not cuttable (any feature):** foundation 01–15, 17, 18 and the isolation/XSS/a11y/scenario-time/telemetry parts of every conformance story; news 01–09, 15, 17; press 01–05, 07–09 and 12 (XC-004 telemetry from day one);
weather 01–04, 06–09, 11; portal 01–03, 06, 07, 09, 10, 13, 17 (if the portal ships at all). Foundation **19** (subdomain readiness, S) is the only foundation story with no December consumer; **16** (content injects) is
needed for NWS-013/WX-012 inject firing, and **11** (alert bar live) is what makes a weather warning reach the bar, so neither is a soft edge.

## 5. Platform prerequisites (owned outside the channels foundation)

Authoritative copy: [`channels-foundation/implementation.md` § Platform prerequisites](channels-foundation/implementation.md#platform-prerequisites).

| ID | Item | Owner feature | Needed by (wave) | Fallback |
|---|---|---|---|---|
| **PP-1** | `display` session purpose + actor kind (portal FU-5) | `identity-auth-roles` + `telemetry` (orchestrator-applied) | portal 05 (CW3) → must merge by end CW2 | kiosk-lite |
| **PP-2** | Kiosk chrome stripping + `isWatermarkRequired` kiosk clause (portal FU-7/FU-9) | `participant-shell` story 06 (AC2 pulled forward) | portal 18 (CW5) → merge by end CW4 | kiosk shows shell chrome (quality regression only) |
| **PP-3** | CSP `font-src 'self'`; `/display/*` no-referrer/no-store headers | `backend-host` / SPA host config | F13 fonts (CW2); portal 18 (CW5) | system fonts; headers are mandatory for the kiosk |
| **PP-4** | Per-display realtime group (portal FU-6) | `exercise-portal` follow-up | nothing in December | December polls (5 s ETag) |
| **PP-5** | `identity-auth-roles/09` multi-org grants + `posts/06` "Posting as" chip | `identity-auth-roles`, `posts` | press 04/07 *only if Q-18 requires multi-org* | single-org per human |

## 6. Open questions for Tom

One list, de-duplicated across the five features. Source key: **F** foundation Q1–Q7, **N** news E4-Q1…Q10, **P** press Q-E5-1…9, **W** weather Q1…Q9, **E3** portal Q-E3-1…12. Foundation Q1–Q7 are
Q-01…Q-07 in order. **DECIDE FIRST** = answering differently changes scope or the date (or must be answered before Wave 1 starts); the rest are safe to answer after the build starts, because the default is
already built into the stories. Q-42 is the only question that is this pass's own (no feature asked it): it falls out of the combined view.

### Decide first (6)
| ID | Question | Features | Default assumed | Impact if answered differently | Source |
|---|---|---|---|---|---|
| **Q-03** | **PDF-first release composer:** keep PRS-002's PDF-first decision with the new `document` media kind (press 02 + 03: structural PDF inspector, sandboxed serve, pdf.js worker; limits 20 MB / 60 pages / no scripts-forms-embedded files / encrypted rejected), or take the fallback now — rich text first, PDF as a download-only attachment? (Foundation Q3 "who owns PDF" is answered: press 02 owns it.) | press, portal 15 (PDF attachments), foundation 14 | PDF-first, limits as stated, configurable in `MediaOptions`; press 02 starts CW1 | Fallback now: press 02 (L) and 03 (M) shrink to an attachment path (≈ 3.5 sittings saved, security long pole gone) but PRS-002 regresses and portal resource PDFs are cut; only the limits change = config. | F-Q3, P-Q3 |
| **Q-11** | **Build participant surfaces without full mockups?** News has only exhibits 1a/1b approved (no article states, per-skin homepages or mobile); weather's D4 is desktop-only; the portal has no mobile or kiosk design; press has no mobile pass. Build mobile-first to the ACs and token files and iterate by token edit (design reviews before release), or wait for design? | news, weather, press, portal (≈ 60 frontend stories) | Build now; iterate via tokens; design review of the result before release | Waiting blocks most of CW3–CW5 frontends for the design turnaround (date moves). Building risks layout (not token) rework for article/home compositions, weather mobile and portal mobile. | N-Q6, W-Q4, E3-Q6 |
| **Q-18** | **Multi-org / JIC "Releasing as {org} ▾"** depends on `identity-auth-roles/09` and the D1 chip (`posts/06`), both Not Started. Is single-org-per-human acceptable for December? | press 04, 07 | Yes: `IReleaseOrgResolver` returns the bound persona; chip renders only when more than one org | If multi-org is required, two more features join December scope (PP-5) and press 04/07 grow; JIC scenarios otherwise rely on the shared-account pattern. | P-Q2 |
| **Q-28** | **Migration shape.** Keep the ledger (M1 F01, M2 portal tables, M3 `WeatherZone`, M4 F16 column, M5 press tables — five serial merges), or fold portal/weather tables (and F16's `InjectItem.ContentItemId`) into F01's M1? Also confirm zones as their own table (no outlet-categories fallback) and no auto-created default zone. | foundation 01/16, portal 01, weather 02, press 06 | Ledger; zones own table; no auto default zone | Folding makes F01 larger and CW1 slower but removes 2–3 serialized migrations and the ordering risk; the ledger keeps F01 lean at the cost of five serial merges. Must be answered **before CW1 starts**. | W-Q6, E3 FU-1, P FU-4 |
| **Q-35** | **Kiosk strategy and priority.** New revocable display credential (default: `POST /api/auth/display`, hashed token, no expiry until revoked, ≤ 10 screens, needs PP-1 + a Tier-2 security review + a new anonymous route) versus **kiosk-lite** (existing shared view-only login on `/portal?display=1`, no remote control). And if both portal and kiosk cannot land: portal first? | portal 05, 08, 18–20, PP-1 | New credential; portal first, kiosk-lite as the fallback | Kiosk-lite removes PP-1, portal 05/08/20 (≈ 6.5 sittings) and a security review, and loses per-display telemetry and remote control. Kiosk-first would reorder CW4–CW5 capacity. | E3-Q4, E3-Q11 |
| **Q-42** | **December cut line.** All five features from 10/29 (94 stories, ≈ 154 sittings, six integration waves, peak 26 stories per wave) or hold a line (e.g. foundation + news + press + weather; portal/kiosk as stretch)? No document states the release date. | all | All five, cutting in the order of section 4 | Dropping the portal removes ≈ 41 sittings and PP-1/PP-2/M2 from the critical path, makes weather 10 and F12's portal landing dormant (pilot-mode landing stays Social), and moves cut #19 up. | this pass |

### Everything else
| ID | Question | Features | Default assumed | Impact if answered differently | Source |
|---|---|---|---|---|---|
| Q-01 | Retracted article/release: in-fiction **tombstone** at the permalink, or plain not-found? | foundation 06, news 08, press 09, weather 09 | Tombstone in the outlet's skin (XC-010) | Plain 404 removes the tombstone DTO shape and four tombstone ACs; loses in-fiction "withdrawn" realism and the AAR trace. | F-Q1 |
| Q-02 | Press org newsrooms as **child `Outlet`s** of The Wire Room (one outlet per publishing org)? | foundation 03, press 01/09 | Yes; letterhead = outlet logo + `ext.press` | One outlet + an org filter in payload: changes F03 `parentOutletId` validation, the provisioner and per-org skin overrides. | F-Q2 |
| Q-04 | Gate **social** routes with channel enablement too (`/api/feed`, `/api/posts`)? | foundation 08 | No; a one-line follow-up | Yes touches pilot-mode social isolation tests and closes exercise-configuration AC3 fully. | F-Q4 |
| Q-05 | When content raises an alert, also emit the **SOC-072 platform notification** (pilot bridge)? | foundation 10 | Yes while bar and notifications coexist; bar authoritative once the portal-era bar is on | No: drop the bridge AC; pilot-mode participants see the bar only. | F-Q5 |
| Q-06 | **Participant release controls:** revise-own yes, retract staff-only; deleting a *scheduled* release requires "cancel embargo" first. | press 04/05/11 | As stated | Participant retract = a new route + attribution rules; direct delete of a scheduled release bypasses the cancel-embargo audit trace. | F-Q6, P-Q9 |
| Q-07 | The **portal is not a content channel** (it aggregates; filler is `news` content tagged `background`). | portal, foundation | Confirmed | Portal-owned content breaks "aggregates, does not publish" and adds a content kind (large). | F-Q7 |
| Q-08 | **Amend epic text** on the next sync: NWS-013 ("always append an editor's note") → two correction renderings (D3-P4); NWS-031 → "no comments, ever"; epic Q1 bylines → optional. | news | Stories follow D3; epic edited on sync | Reinstating "always append" removes the `silent_rewrite` lever (F04, news 08/17). | N-Q1 |
| Q-09 | **Updated-stamp semantics:** a silent rewrite *moves* the stamp (no fully-invisible edit); a post-publish breaking toggle does *not* move it (`touchUpdatedStamp: false`). | foundation 01/04/06/09, news 07/08 | As stated (FC-1 rule) | A "fully invisible" option is a one-flag addition (`touchUpdatedStamp: false` on a content edit); low cost. | N-Q2, N-Q3 |
| Q-10 | **Fonts:** self-host the OFL families lazily per outlet (news six families; weather/portal as needed) or system fallbacks only (restricted/air-gapped networks)? | foundation 13, news 10–13, weather 06, portal 06, PP-3 | Self-host, lazy per scope, `font-src 'self'` | System-only drops D3-P3 register fidelity, removes PP-3 font CSP and the woff2 files. | N-Q4 |
| Q-12 | **Seed content in the December build:** news none (outlets only); weather sample storm (story 15, stretch); portal evergreen filler (21). | news, weather 15, portal 21 | As stated | Prepared example articles/products make demos richer but add authoring, fictional-NWS and legal review and 1–2 stories. | N-Q5 |
| Q-13 | **Rich-text library** for the article editor (approved library, or builder proposes TipTap/Lexical)? | news 17 | Builder proposes in the 17 PR; must emit only the `article-rich` allowlist | New-dependency review; answer before CW5. | N-Q7 |
| Q-14 | **Alerts stay an explicit publish option:** a breaking article *suggests* an `advisory` entry but never raises one (FC-7a: `DefaultAlertMapping` is a suggestion only). | foundation 04/17, news 01/07 | Confirmed | Auto-raise from the mapping reverses FC-7a and every kind then needs an opt-out. | N-Q8 |
| Q-15 | **NewsNow (PDF-05):** mark "superseded by E4 for December" on the next triage? | news (post-demo-feedback) | Yes; no change made here | Doc-only. | N-Q9 |
| Q-16 | Embedded posts are **same-exercise only**; a deleted post shows "post unavailable". | news 06, foundation 21 | Yes (XC-001/XC-010) | Cross-exercise embeds violate isolation. | N-Q10 |
| Q-17 | Who may open the press composer: `pio` role **and** an org they may release as; others read the wire only? | press 04 | Yes | Wider access changes the authz matrix and attribution. | P-Q1 |
| Q-19 | Org colleagues see each other's **display names** ("last edited by J. Alvarez")? | press 04 | Yes, own org only | Hiding names weakens JIC coordination; per-human evaluation stays staff-side. | P-Q4 |
| Q-20 | Embargoed releases invisible to **everyone** but the author org and staff (media-persona preview parked)? | foundation 06, press 05/09 | Confirmed | Per-role projection in F06 and an XC-002 leak risk. | P-Q5 |
| Q-21 | A controller publishing a `pending_approval` release: **bypass with audit** (default) or force through approval? | foundation 04 (gate), press 06 | Bypass, audited via `IContentPublishGate` `Allow(auditNote)` | Forcing = gate returns `Hold` for staff; controllers lose the override mid-exercise. | P-Q6 |
| Q-22 | Approver notifications: **wire-internal badge only** (D4-007 #3) or also a platform notification? | press 06/10 | Wire-internal only | Platform push couples press to the notifications feature. | P-Q7 |
| Q-23 | Is a **headline-only release** (no body, no PDF) publishable? | press 05/07, `ReleaseDek` | Yes with a non-blocking note | Else a validation rule and a dek-fallback removal. | P-Q8 |
| Q-24 | **Warning ⇒ emergency band** for every hazard, no opt-out; watch → advisory; advisory → info (D4-010 #6 "for now"). | weather 04, foundation 11 | Yes | Graded mapping is parked; changing means `WeatherAlertSeverityMap` + bar tests. | W-Q1 |
| Q-25 | `@WeatherDesk` post default **checked** for watch/warning (unchecked for advisory/forecast)? | weather 04/11 | Checked, editable | Editor default only. | W-Q2 |
| Q-26 | **Backward clock jump:** nothing un-publishes; the site excludes "published after now", alert-bar entries and permalinks stay. Acceptable? | weather 03/04, foundation 05 | Acceptable, documented | Un-publish on rewind is a new foundation capability (large). | W-Q3 |
| Q-27 | **Advisory hue** AA amber `#8a4b00` + `faCircleInfo` (D4 defines only warning and watch). | weather 06/07 | Yes, pending design confirmation | Token edit. | W-Q5 |
| Q-29 | Weather **product text monospace** only (`ProductText`); plain sans for chrome (D4-009)? | weather 07 | Yes | Token/font only. | W-Q7 |
| Q-30 | **US customary units** only (°F, mph, inches)? Any non-US exercises in December? | weather | US only | Non-US needs unit/locale support (new scope). | W-Q8 |
| Q-31 | The weather epic's §5 open questions **end mid-sentence** (file truncated). Is a question lost? | weather (epic text) | None assumed | Possible unscoped question; epic text fix. | W-Q9 |
| Q-32 | Portal **"[City]"** source: a `CityName` config field; unset → neutral "Local Today" (never the exercise name). | portal 03/16 | As stated | Using the exercise name leaks the exercise into the fiction. | E3-Q1 |
| Q-33 | **Kiosk chrome:** strip the compliance banners (D2 "zero chrome") and always draw the EXERCISE chip, or keep banners? | portal 18, PP-2 | Strip banners, chip always on | Keeping banners simplifies PP-2 but loses the clean big-screen. | E3-Q2 |
| Q-34 | Add D2's visible header link row (News · Pulse · Wire Room · Weather) despite SHELL-CONTRACT? | portal 06/17 | No: shell strip + in-module "See all →" | Needs a SHELL-CONTRACT amendment. | E3-Q3 |
| Q-36 | **Emergency lead kicker** "● EMERGENCY · LIVE UPDATES" / red "WATCH LIVE": platform-generated text in the fiction. | portal 13 | Drop the text; non-textual mood shift; controllers carry kicker text | Keeping it violates FC-9.5 / SOC-002 unless authored; D2-004 amendment. | E3-Q5 |
| Q-37 | **COR-052 module advancement** (exercise-clock/03, Not Started) in December? | portal, exercise-clock | No; kiosk follows live content | Adds a whole feature to scope. | E3-Q7 |
| Q-38 | **Resources shelf:** no external links; authored text may contain real times, the platform renders none. | portal 04/15 | As stated | External links would break FC-9.3. | E3-Q8 |
| Q-39 | **Top Stories scope:** News only? | portal 09 | News only; press/weather have modules | Mixed lead needs a cross-channel list route (new). | E3-Q9 |
| Q-40 | **TTX facilitator** = controller or planner (no new role)? | portal 05/20 | Yes | A new role is an identity change. | E3-Q10 |
| Q-41 | **Portal visual direction:** ship broadcast + anchor only; print/grid parked (print collides with Courier-Ledger)? | portal 06/07 | Yes | More directions = more portal-skin stories. | E3-Q12 |

## 7. Epic and design amendments flagged but **not** made

No agent edited an epic, the Master PRD, `docs/design/**` or `STORY-UPDATES.md` (docs-only decomposition). These need a decision, then an edit.

| # | Item | Document to amend | Applied in the stories as | Question |
|---|---|---|---|---|
| A-1 | NWS-013 "always append an editor's note" vs the quiet-rewrite lever (D3-P4 splits it into two renderings: visible correction note, silent rewrite with only the Updated stamp) | `docs/04-*.md` (E4) NWS-013 | two renderings; `silent_rewrite` moves the stamp, adds no `revisions[]` | Q-08, Q-09 |
| A-2 | NWS-031 hardened from "comments out of scope at launch" to "no comments, ever" | E4 NWS-031 | fixed discussion footer, no comment model | Q-08 |
| A-3 | E4 epic Q1 (reporter bylines) settled to optional (D3 RECONCILE) | E4 open question 1 | byline format token, optional | Q-08 |
| A-4 | Weather epic §5 open questions truncated mid-sentence | `docs/06-*.md` (E6) §5 | none | Q-31 |
| A-5 | WX-011 "at mapped severity" vs D4-010 (every warning = emergency, "for now") — D4 STORY-UPDATES **C-2** | `docs/06-weather-source.md` WX-011 | one pinned severity map, graded mapping parked | Q-24 |
| A-6 | WX-020 "'@NWSAtlanta'-analog" vs `@WeatherDesk` — D4 **C-3** | `docs/06-weather-source.md` WX-020 | `@WeatherDesk`, brand "The Weather Desk" | — |
| A-7 | PRS-021 approver "a controller playing that role" vs approval gate as **participant paper** — D4 **C-1** | `docs/05-press-room.md` PRS-021 | participant approval routes, controller acts through the participant view | Q-21 |
| A-8 | PDF-first (PRS-002) vs the December fallback | `docs/05-press-room.md` PRS-002 | PDF-first with documented fallback | Q-03 |
| A-9 | Portal conflicts **C-1…C-7** vs the D2 brief / SHELL-CONTRACT / PRT-004 (decisions applied; D2 has no STORY-UPDATES): **C-1** D2 header link row vs "channels never render cross-channel nav" · **C-2** D2-004 "● EMERGENCY · LIVE UPDATES" kicker / red "WATCH LIVE" vs FC-9.5 · **C-3** D2-005 "Trending always renders" vs no data when social is off · **C-4** D2-007 wall-clock schedule on Resources vs COR-053 (Resources is the one out-of-fiction surface) · **C-5** participant-shell/06 kiosk strips chrome vs COR-031/NFR-008 · **C-6** PRT-040 "login-free" vs XC-001 (bearer link to a read-only `display` session) · **C-7** PRT-004 controller-ordered with fallback vs F06's `featured=true` ordering | `docs/design/D2-portal.md`, `D7-application-shells/SHELL-CONTRACT.md`, `docs/03-*.md` (E3) PRT-040/041, PRT-004 | all seven decisions as stated in `exercise-portal/implementation.md` § Conflicts | Q-33, Q-34, Q-36, Q-38 |
| A-10 | **FC-1 vs D3-P4**: FC-1 said `silent_rewrite` has "no participant marker"; D3-P4 says only the Updated stamp changes. Resolved **in the foundation contract** by this pass (stamp moves, no `revisions[]` entry); the epic/design text is untouched | `docs/design/D3-news-outlets/STORY-UPDATES.md` NWS-013 | FC-1 Updated stamp rule | Q-09 |
| A-11 | Foundation closes exercise-configuration open question (c) "channel-enablement route gating is unowned" for portal/news/press/weather only; social gating deferred | `docs/features/exercise-configuration` AC3 | F08 | Q-04 |
| A-12 | Demo-polish F0 **froze the `features/social` barrel**; foundation story 21 lifts the freeze for additive read-only exports | `docs/features/demo-polish` implementation §4.3 | F21 | — |

### D3 and D4 STORY-UPDATES checklists left unticked by design
Each item is ticked in `docs/design/D3-news-outlets/STORY-UPDATES.md` / `docs/design/D4-press-weather/STORY-UPDATES.md` **by the owning story's merge**, not by the decomposition. Nothing in either file was ticked.

| Checklist | Unticked item → owning stories |
|---|---|
| **D3** (news) | NWS-002 skins as token files → news 10–13, 03, 20 · NWS-010 kicker/slot-mapped model → news 01, 04 · NWS-003 lead-mode enum → news 15, 14 · NWS-012 breaking slot → news 07 (+01) · NWS-013 two correction renderings → news 08, 17 (A-1) · NWS-014 one player → news 05 · NWS-032 watermark chip → news 05 (+F14) · NWS-031 discussion footer → news 09 (A-2) · NWS-030 telemetry invisibility → news 04, 19, 20 · NWS-001 CANNOT list → news 03, 20 (server guard F03) · NWS-011/015 share + embed → news 06, 09 (+F21) · ADD skin token schema → F13 + news 10–13 · ADD article grid → news 04 · ADD Scoop clutter set → news 14 · ADD register token values → news 10–13 · RECONCILE epic Q1 bylines → news 04 (A-3) · RECONCILE D2-002 "print" → portal parks print (Q-41) · BACKLOG: full mockup (Q-11), NWS-020/021/022 UI → news 17/18, NWS-004 pairing → F18 |
| **D4** (press + weather) | PRS-002 letterhead sheet, PDF-first → press 02, 03, 07, 08 · PRS-003 scheduled state by redundancy → press 05, 07, 08, 09 · PRS-013 cross-post explicit → press 05, 08 (+F18) · PRS-004 autosave ambient → press 04, 07 · PRS-020 one confirm gate → press 05, 08, 13 · PRS-021 approval is participant paper → press 06, 10 (C-1 = A-7) · PRS-001/COR-018/SOC-006 "Releasing as" chip → press 04, 07 (Q-18) · PRS-010/012 public wire → press 01, 09 · WX-001/010 NWS-verbatim anatomy → weather 01, 06–09 · WX-011 propagation → weather 04, 08–10 (+F10, F11; C-2 = A-5) · WX-013 imagery watermark → weather 07, 09, 11, 14 · WX-020 `@WeatherDesk` → weather 04, 11 (C-3 = A-6) · WX-002 staff-authored only → weather 11, 12 · backlog: return-notification reach (Q-22), mobile pass (Q-11), real inline PDF + paste-from-Word → press 02/03/07, alerts history page → F11, graded severity (Q-24), `@WeatherDesk` editable pre-publish → weather 11, weather authoring console-side → weather 11–13 |

## 8. Inconsistencies noticed and how they were handled

| # | Inconsistency | Handling |
|---|---|---|
| I-1 | FC-1 ("no participant marker") vs D3-P4 (Updated stamp moves) on `silent_rewrite`; `ContentItem` had no column to hold a stamp without a visible revision | Contract clarified; `UpdatedScenarioTime` added to FC-2/F01 (A-10) |
| I-2 | Story 05 referred to a staff-visible `lastError`, but FC-2 had no such column | `LastError` added to FC-2/F01 |
| I-3 | Weather FU-2 wanted `DefaultAlertMapping` to be the alert default on the no-dialog path; news E4-Q8 needs it to never raise an alert | Resolved: `DefaultAlertMapping` is a suggestion only; weather supplies `ResolvePublishOptions` (FC-7a) |
| I-4 | Press 01 listed "can run with 04" while 04 depends on 01; weather 12 depends on 11 yet lists it as can-run-with | Same-wave serial edges, recorded in section 2; press text corrected, weather text left (needs the weather owner to confirm 12 delegates to F17 or waits for 11) |
| I-5 | Feature-local wave numbering differs (press/weather use the foundation axis; news/portal are local) | Combined waves (section 2) with six explicit moves; per-feature tables untouched |
| I-6 | Portal 18 owned a `ShellLayout.tsx` edit that is really a platform change in a Complete shell story | Moved to PP-2; portal 18 now consumes it (nobody has yet accepted ownership of PP-1/PP-2/PP-3; the orchestrator must) |
| I-7 | "Only F01 and F16 own migrations" contradicted three channel features | Replaced by the ledger (section 3) |
| I-8 | Foundation F04 now exceeds the 3–7 AC guideline (12) | Existing foundation stories already ran 8–10; split seam documented in F04 tech notes, not split |
