# December release — feature index, combined plan and open questions

> **Status:** planning docs with Tom's 10/29 answers folded in; GitHub issues mirror the in-scope stories (**§ 9: 4 epics, 5 features, 92 stories**). **Release:** December (Tom, 10/21); today is 10/29. **Source of truth:** the five feature folders below; this page is the
> cross-feature view the orchestrator and Tom read first. Written by the December consolidation pass (which folded the channels' foundation follow-ups into the foundation, defined one migration
> sequence and one platform-prerequisite list, applied the three cross-channel requests, and de-duplicated every open question into one list) and updated on 10/29 for Tom's answers (§ 0).
>
> Where things live: foundation contracts, migration ledger, platform prerequisites and the follow-up resolution ledger are in
> [`channels-foundation/implementation.md`](channels-foundation/implementation.md); each channel's own contracts are in its `implementation.md`.

## 0. Decisions folded in (Tom, 10/29)

| Q | Decision (Tom, 10/29) | What it changed |
|---|---|---|
| **Q-42** cut line | **All five features stay in December**; the combined cut order (§ 4) is applied as the date nears. | Nothing cut up front. |
| **Q-03** press | **Rich text first; the PDF is a download-only attachment.** Inline PDF rendering moves to Q1 / post-December. | Press **03 Deferred**; press **02 re-scoped L → M** (sniff, size cap, reduced deny-list scan, attachment-only serve; the page cap, page count, headline suggestion and inline serve are gone); press **07 composer body is now rich text** (Word paste first-class, PDF optional attachment chip, no dependence on 03); 09/10/12/13/15 amended; the PDF corpus is no longer the gating security review. |
| **Q-11** mockups | **Build the participant surfaces now without full mockups**; a design review happens before release. | No scope change; the default is accepted as a decision. |
| **Q-35** kiosk | **Portal first; kiosk-lite only.** The existing shared view-only login on `/portal?display=1`, using the kiosk frame; no new credential; no remote control. | Portal **05, 08, 20 Deferred**; **18 and 19 re-scoped to kiosk-lite (L → M each)**; the playlist/pinned/show-next parts of 19 Deferred; **PP-1 Deferred** — verified against the code that kiosk-lite needs **no identity change**; **PP-2 kept**; PP-3's `/display/*` headers dropped; one anonymous route and the allowlist-count churn avoided. |
| **Q-18** orgs | **Single org per person** behind the swappable `IReleaseOrgResolver`. | PP-5 not needed; press 04/07 keep the bound-persona resolver; the chip renders only when more than one org exists. |
| **Q-28** migrations | **Fold the portal tables (M2), `WeatherZone` (M3) and F16's `InjectItem.ContentItemId` (M4) into F01's M1.** Press's audit tables stay a separate, later migration. | Ledger is now **M1 (F01) → M2 (press 06, formerly M5)**; F01/portal 01/weather 02/F16/press 06 and the F20 ledger test amended; `PortalDisplay` is **not** created (deferred with 05); portal 01 shrinks M → S. |
| other | **All other questions stay at their documented defaults.** Q-03/11/18/28/35/42 are marked **Decided** in § 6; the rest read "default accepted unless Tom says otherwise". | — |
| fix | Weather 12 now **explicitly waits for 11**; its can-run-with no longer lists 11 (and 11's no longer lists 12). | Inconsistency I-4 closed. |

## 1. The five features

| Feature | Epic | In-scope stories | L / M / S | Est. sittings* | Stack mix | Folder |
|---|---|---|---|---|---|---|
| **Channels foundation** (content pipeline, outlets, alerts, router, skins, staff seam, social prerequisites) | E3–E6 shared (under E1) | **23** | 4 / 16 / 3 | ≈ 37.0 | 10 backend, 4 fullstack, 8 frontend, 1 testing | [`channels-foundation/`](channels-foundation/feature.md) · #692 |
| **News network** (4 outlets, articles, skins, editor) | E4 | **20** | 3 / 9 / 8 | ≈ 29.0 | 1 backend, 18 frontend (2 staff), 1 testing | [`news-network/`](news-network/feature.md) · #693 |
| **Press Room** (release kind, attachment, composer, wire, approval) | E5 | **14** (+1 Deferred) | 5 / 7 / 2 | ≈ 25.0 | 5 backend, 1 fullstack, 7 frontend (2 staff), 1 testing | [`press-room/`](press-room/feature.md) · #694 |
| **Weather source** (products, zones, delivery, site, staff authoring) | E6 | **15** | 2 / 9 / 4 | ≈ 22.5 | 5 backend, 1 fullstack, 8 frontend (3 staff), 1 testing | [`weather-source/`](weather-source/feature.md) · #695 |
| **Exercise portal + kiosk-lite** (portal, resources, console) | E3 | **20** (+3 Deferred) | 4 / 11 / 5 | ≈ 31.5 | 4 backend, 1 fullstack, 14 frontend (2 staff), 1 testing | [`exercise-portal/`](exercise-portal/feature.md) · #696 |
| **Total in scope** | | **92** | **18 / 52 / 22** | **≈ 145.0** | | |
| *Deferred (post-December), kept in the docs, no issues* | | *4* | *(M, L, M, L)* | *(≈ 8.0)* | press 03; portal 05, 08, 20 | |

\* Sittings use the features' own guide (S ≈ 1 focused sitting, M ≈ 1–2, L ≈ 2–3) at S = 1, M = 1.5, L = 2.5. It is a sizing aid, not a schedule. **Change from the 10/21 plan (94 stories, 23 / 51 / 20, ≈ 154; **10/29 follow-up: +foundation 22 (M) and 23 (S) → 92 stories, 18 / 52 / 22, ≈ 145.0**):** −4 stories deferred
(press 03, portal 05/08/20), press 02 L → M, portal 18 L → M, portal 19 L → M, portal 01 M → S (schema folded into F01), so L drops 23 → 18, M stays 51, S rises 20 → 21 and sittings fall ≈ 154 → ≈ 142.5 (−11.5).
Earlier consolidation changes still stand: **foundation 13 M → L** (external skin registration, token-object scope, reset boundary, fonts); **foundation story 21 added** (M). Foundation 01 stays L but is now the heaviest story (it also carries the folded portal/zone/inject schema);
foundation 04 stays L (12 ACs; split seam documented in its tech notes).

### What the consolidation changed in the foundation (summary)
| Change | Where |
|---|---|
| **New story 21** — Social prerequisites (portal R-S1 + news FU-5 compose-with-link + FU-6a post-by-id) | `21-social-prerequisites.md` |
| **Amended stories** 01 (3 follow-up columns; **10/29: + folded portal/zone/inject schema**), 02 (async validation, new seams, **one** telemetry-vocabulary edit for all channels), 03 (`ISkinOverridesValidator`, idempotent single weather outlet), 04 (sanitizer profile registry, `touchUpdatedStamp`, participant callers + `IContentPublishGate`, options persistence/resolution), 05 (replays options), 06, 07 (`feature/reorder`, schedule options), 09, 11 (multi-alert AC), 12 (route families, no swallowing), 13 (**external skin registration**, `SkinScope`, `SkinResetBoundary`, `registerSkinExtension`, `registerSkinFonts`; M → L), 14 (dateline format registry, player in `core/media`; **10/29: `document` renders a download link only**), 15, 16 (**10/29: no migration**), 17 (`ownsDeliveryOptions`), 18 (acting human from the call), 20 (migration-ledger test, **10/29: M1 + M2 only**) | story files |
| **Contracts (additive)** FC-1 Updated-stamp rule; FC-2 columns; FC-4 `feature/reorder` + channel route families; **FC-6b** channel telemetry vocabulary; FC-7 async validation, `ResolvePublishOptions`, `ISanitizerProfileRegistry`, `IContentPublishGate`, `ISkinOverridesValidator`; **FC-7a** options resolution; FC-8 social side; **FC-8a** skin registration | `implementation.md` |
| **Migration ledger** (10/21: M1–M5; **10/29: M1 + M2**) | `implementation.md` § Migration ledger, section 3 below |
| **Platform prerequisites** PP-1…PP-5 (**10/29: PP-1 Deferred, PP-3 trimmed, PP-5 not needed**) | `implementation.md` § Platform prerequisites, section 5 below |
| **Follow-up resolution ledger** (every news/press/weather/portal FU mapped to a story, FC or PP) | `implementation.md` § Follow-up resolution ledger |

Item-by-item results: of the **35** channel follow-ups (news 9, press 9, weather 8, portal 9), **23 were folded into existing foundation stories/contracts** (many collapsing duplicates into one change),
**2 into the new story 21** (news FU-5, FU-6a; with portal R-S1 that is three requests), **3 are migration-ledger entries** (press FU-4, weather FU-1, portal FU-1 — *since 10/29 the weather and portal ones are folded into F01's M1*), **4 are platform prerequisites** (portal FU-5, 6, 7, 9 — *FU-5/PP-1 now Deferred*) and
**3 needed no foundation change** (press FU-6, 7, 9). The four cross-channel requests: R-S1 → story 21; R-W1 → weather 10; R-P1 → press 01/04/05/09/15; R-N1 → nothing to do. De-duplicated: four skin-registration
asks → one call (`registerSkinTokens`); four telemetry-vocabulary asks → one edit in F02; two options asks (press FU-3, weather FU-2) → one resolution rule (FC-7a); two sanitizer asks → one registry; three migration
asks → one ledger.

## 2. Combined waves (foundation first, then the channels they unblock)

Six integration waves (**CW1–CW6**). A wave's stories have disjoint file footprints and fan out in parallel; an entry marked **→** has a same-wave serial edge. Channel stories sit at the earliest wave in which
every dependency is merged. The feature-local wave numbers in each `feature.md` are unchanged; the moves versus them are listed under the table. Deferred stories (press 03; portal 05, 08, 20) are in no wave.

| Wave | Foundation | News (E4) | Press (E5) | Weather (E6) | Portal (E3) | Platform / migration |
|---|---|---|---|---|---|---|
| **CW1** (5) | **01** (**M1**, incl. folded schema), **02**, **21**, **23** | — | **02** (download-only attachment; no longer the long pole, free to slide) | — | — | **PP-3 = foundation 23 (font CSP, merges before F13's fonts in CW2)**; **M1**; *M1's folded column specs frozen before this wave starts* |
| **CW2** (10) | 03, 04, 08, 09, 10, 13, 14 | — | — | 01 (contract, kinds) | 01 (guard + tests, **no migration**), 02 | — |
| **CW3** (26) | 05, 06, 07, 11, 12, **22** (PP-2) | 01, 03, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14 | 01 → 04 | 02 (**no migration**), 07 | 03, 04, 06, 07 | — |
| **CW4** (25) | 15, 16 (**no migration**), 17, 18, 19 (→ after 15) | 04, 15 → 16*, 18, 19 | 05, 06 (**M2**, after M1 only), 07 (Tiptap, Q-13 decided) | 03 → 10*, 04, 05, 06 | 09, 10, 11, 13, 14, 15, 21 | **M2**; **PP-2 (foundation 22) merged by the end of this wave** |
| **CW5** (22) | 20 | 02, 17 | 08, 09, 10, 11, 12, 13, 14 | 08, 09, 11 → 12, 13, 15 | 12*, 16*, 17, 18, 19, 22 | — |
| **CW6** (4) | — | 20 | 15 | 14 | 23 | — |

Counts check: 5 + 10 + 26 + 25 + 22 + 4 = **92**. Peak load is **CW3 (26) and CW4 (25)**, dominated by news and portal frontends.

**Moves versus feature-local waves** (all because of a cross-feature dependency the feature docs could not see): news **16** E4-3 → CW4 behind 15 (so 02 can mount in CW5); weather **10** wave 5 → CW4 behind 03's
types/fixtures PR (the portal hard-imports it); portal **12** → CW5 (behind weather 10); portal **16** → CW5 (behind F17); portal **21** may start CW4; news **02** E4-4 → CW5; foundation story **21** is CW1.
**Changes on 10/29:** press 03 left CW2 (Deferred); portal 05 left CW3 and 08 left CW4 and 20 left CW5 (Deferred); **the migrations no longer serialize across CW2–CW4** (M2 portal, M3 weather, M4 F16 are inside M1), so portal 01 / weather 02 / F16 are ordinary stories that need only F01 merged;
press 06's migration (now M2) needs only M1, no longer "after F16's M4". Press 02 is free to slide to CW2/CW3 (it is first needed by press 04 in CW3).
Same-wave serial edges to respect: press 01 → 04; F15 → F19; **F15 → portal 09/10/11 and news 15/19, which build mock-first against F15's fixtures ("mock until live") and integrate once F15 merges**; weather 03 (types) → 10; **weather 11 → 12 (fixed, see I-4)**; news 15 → 16; portal 18 → 19 (the `KioskFrame` props type first). *(F16 → press 06 migration order is gone.)*

Gates: **CW2 starts after CW1's F01/F02 merge** (and F21 for news 06/09, merged CW1); **CW3's channel frontends start after CW2's F13/F14/F08 merge**; **CW5's portal 18 needs foundation 22 / PP-2** (#788; scheduled CW3, merged by end of CW4); CW6 needs F20 (CW5).

### Cross-feature critical path
Longest chain is **unchanged: F02 → F04 (L) → F06/F09 → F15 → news 04/15 (L) → news 02 → conformance (CW6)** — six waves — so the date is still set by the foundation and news, not by the channels that moved. The three chains that were "nearly as long" are all shorter now:
1. **Press:** was press 02 (L, security, the malicious-PDF corpus as the gating review) → 04 → 05/07 → 08/09 → 15. Now **press 01 → 04 (L) → 05 (L) / 07 (L, now with a rich-text editor) → 08/09 → 15**; no security long pole. The new single point of risk is **07** (a new editor library, **Tiptap** (Q-13 decided), shared with news 17, needed by CW4 instead of CW5).
2. **Kiosk:** was portal 01+02 → PP-1 → 05 (L, Tier-2 review, new anonymous route) → 08 → 18 (+ PP-2) / 19 (L) → 20 (L) → 23. Now **portal 06/07 → PP-2 → 18 (M) → 19 (M) → 23**; the single point of risk is **PP-2** (the shell's kiosk variant).
3. **Weather warning end to end:** weather 01 → 02 → 04 (needs F04/F05/F10/F18, FC-7a) → 08/11 → 14 — unchanged except 02 no longer waits behind two earlier migrations.
4. **Migrations:** was five serial merges across CW1–CW4. Now **M1 (CW1) → M2 (CW4)**: the only real risk is that **F01 is heavier and the folded schema must be frozen before CW1** (a column discovered later is an additive follow-on migration, not a rewrite).

## 3. Migration sequence (one sanctioned, serialized order)

Authoritative copy: [`channels-foundation/implementation.md` § Migration ledger](channels-foundation/implementation.md#migration-ledger). One migration PR in flight at a time; M2 is regenerated against the merged snapshot of M1.
**Q-28 decided 10/29: M2, M3 and M4 are folded into M1.**

| # | Owner story | Adds | Wave | Starts when |
|---|---|---|---|---|
| **M1** | foundation **01** | `Outlet`, `ContentItem` (+ `UpdatedScenarioTime`, `PublishOptionsJson`, `LastError`), `ContentItemRevision`, `ContentItemMedia`, `ChannelAlert` **+ `PortalConfig`, `PortalResource`, `WeatherZone` and the nullable `InjectItem.ContentItemId`** (no `PortalDisplay`: Deferred) | CW1 | now (folded column specs frozen first) |
| **M2** (was M5) | press **06** | `PressReleaseEvent`, `PressApprovalSettings` | CW4 | M1 merged |

Portal 01, weather 02 and F16 own **no** migration (their entities/column are F01's); the F20 ledger test asserts M1 then M2, that no other migration creates the folded tables/column, and the `Channels_M<n>` tokens. Zones stay their own table with no auto-created default zone (Q-28 confirmations).
The cost, accepted by Tom: F01 is larger and CW1 slower than the 10/21 ledger; the benefit is three fewer serialized merges and no ordering risk across features.

## 4. Combined cut order (cut first → last)

Built from each feature's own list with every feature's internal order preserved, **re-based on 10/29**: items that were fallbacks (the kiosk credential/remote control, the playlist parts) are now Deferred outright and are no longer cuts; the PDF attachment is a new late cut. Items marked *(proposed)* are not in the owning feature's docs and need a yes/no.
Per Q-42 all five features start in December; this order is applied as the date nears.

| # | Cut | Feature | Effect / fallback |
|---|---|---|---|
| 1 | **15** scripted-storm sample seed | weather | stretch; demo convenience only |
| 2 | **22** Top Stories board | portal | F17's per-item pin satisfies PRT-004 |
| 3 | **21** evergreen filler pack | portal | planners author `background` news in F17; Staged portal sparse but valid |
| 4 | **14** console approval settings | press | approval stays default-off, configured by API |
| 5 | **18** article templates *(proposed)* | news | editors start from a blank article |
| 6 | **12** timeline panel (+ 05 read model except `issue-update`) | weather | F17's status list filtered to weather is the timeline |
| 7 | **10** approval UI, then **06** approval gate backend (**drops M2**, leaving M1 as the only migration) | press | gate is off by default; controllers still publish/revise |
| 8 | **12** weather mount | portal | module hides cleanly; kiosk-lite weather tile drops |
| 9 | **05** `issue-update` helper | weather | clone/edit manually; costs re-keying zones/IBW |
| 10 | **11** revise-own | press | controller revise via F17 remains |
| 11 | **15** PDF attachments (resources) | portal | text + images only; PDFs are download-only links once press 02 lands |
| 12 | **10** widget tile | weather | only needed if the portal lands; pilot mode needs none |
| 13 | **13** zone admin | weather | one default zone via the zone API; WX-004 multi-zone slips |
| 14 | **16** module order/toggle UI | portal | fixed order; hide only via channel enablement |
| 15 | **14** Scoop clutter modules *(proposed)* | news | The Scoop renders as a plain tabloid skin (server/render guards unaffected) |
| 16 | **13** console release editor | press | generic F17 editor with `release` payload as raw JSON |
| 17 | **02** document attachment *(proposed, new 10/29)* | press | releases are rich text + images only; the composer hides the attach control; portal resource PDFs stay off. Costs realism for PIOs who arrive with a finished PDF |
| 18 | **18 / 19** kiosk-lite *(proposed, replaces the old kiosk-credential and playlist cuts)* | portal | the TV opens `/portal` in a normal browser; PP-2 and the kiosk board drop |
| 19 | the whole **portal** (feature, 20 stories) | portal | pilot-mode landing stays Social; weather 10 and F12's portal landing become dormant (see Q-42's original impact) |

**Not cuttable (any feature):** foundation 01–15, 17, 18 and the isolation/XSS/a11y/scenario-time/telemetry parts of every conformance story; news 01–09, 15, 17; press 01, 04, 05, 07–09 and 12 (XC-004 telemetry from day one);
weather 01–04, 06–09, 11; portal 01–03, 06, 07, 09, 10, 13, 17 (if the portal ships at all). Foundation **19** (subdomain readiness, S) is the only foundation story with no December consumer; **16** (content injects) is
needed for NWS-013/WX-012 inject firing, and **11** (alert bar live) is what makes a weather warning reach the bar, so neither is a soft edge.

## 5. Platform prerequisites (owned outside the channels foundation)

Authoritative copy: [`channels-foundation/implementation.md` § Platform prerequisites](channels-foundation/implementation.md#platform-prerequisites).

| ID | Item | Owner feature | Needed by (wave) | Status / fallback |
|---|---|---|---|---|
| **PP-1** | `display` session purpose + actor kind (portal FU-5) | `identity-auth-roles` + `telemetry` | portal 05 (Deferred) | **Deferred (post-December).** Verified: **kiosk-lite needs no identity change** — the existing shared view-only login already issues `readonly` sessions with an ephemeral identity and `actor.kind: 'system'`; the write filter and telemetry authority already handle them |
| **PP-2** → **foundation 22** (#788) | Kiosk chrome stripping + `isWatermarkRequired` kiosk clause (portal FU-7/FU-9) | channels foundation story 22 (was `participant-shell` story 06 AC2) | portal 18 (CW5); story 22 in CW3, merged by end CW4 | **Still a December prerequisite.** Fallback: kiosk shows shell chrome (quality regression only) |
| **PP-3** → **foundation 23** (#789) | CSP `font-src 'self'` (the `/display/*` headers part is Deferred) | channels foundation story 23 (SPA host config) | F13 fonts (CW2); story 23 in CW1 | system fonts |
| **PP-4** | Per-display realtime group (portal FU-6) | `exercise-portal` follow-up | nothing in December | parked; no display state exists in December |
| **PP-5** | `identity-auth-roles/09` multi-org grants + `posts/06` "Posting as" chip | `identity-auth-roles`, `posts` | — | **Not needed in December (Q-18 decided: single org per person)** |

## 6. Open questions for Tom

One list, de-duplicated across the five features. Source key: **F** foundation Q1–Q7, **N** news E4-Q1…Q10, **P** press Q-E5-1…9, **W** weather Q1…Q9, **E3** portal Q-E3-1…12. Foundation Q1–Q7 are
Q-01…Q-07 in order. Q-42 is the only question that is this pass's own (no feature asked it): it falls out of the combined view.
**Status as of 10/29:** the six "decide first" questions are **Decided** (Tom, 10/29; below). Every other question carries the status **default accepted unless Tom says otherwise** — the default is already built into the stories, so none blocks the build.

### Decided (Tom, 10/29)
| ID | Question | Decision (Tom, 10/29) | Where it landed | Source |
|---|---|---|---|---|
| **Q-03** | PDF-first release composer with a structural inspector and inline pdf.js, or rich text first with the PDF as a download-only attachment? | **Decided: rich text first; PDF is a download-only attachment.** Inline PDF rendering (press 03, and the PDF-as-body parts of 02/07) moves to Q1 / post-December. | Press 03 Deferred; 02 re-scoped to a minimum safe attachment (sniff, size cap, **reduced deny-list scan kept** because the file lands on recipients' own readers, attachment-only serve), L → M; 07 body = rich text; portal resource PDFs become download links. See § 0, A-8. | F-Q3, P-Q3 |
| **Q-11** | Build participant surfaces without full mockups? | **Decided: build now without full mockups; a design review happens before release.** | No scope change; mobile-first to the ACs and token files, iterate by token edit. | N-Q6, W-Q4, E3-Q6 |
| **Q-18** | Multi-org / JIC "Releasing as {org} ▾" or single org per person for December? | **Decided: single org per person**, behind the swappable `IReleaseOrgResolver`. | PP-5 not needed; press 04/07 unchanged (with one org the "Releasing as" line is read-only text; the swap chip appears only with more than one org). | P-Q2 |
| **Q-28** | Migration shape: keep the five-step ledger or fold? | **Decided: fold** the portal tables (M2), `WeatherZone` (M3) and F16's `InjectItem.ContentItemId` (M4) into F01's M1; press's audit tables stay a separate, later migration. Zones stay their own table, no auto-created default zone. | Ledger = M1 + M2 (§ 3); F01, portal 01, weather 02, F16, press 06 and the F20 ledger test amended. | W-Q6, E3 FU-1, P FU-4 |
| **Q-35** | Kiosk strategy: new display credential or kiosk-lite; portal first? | **Decided: portal first, kiosk-lite only** — the existing shared view-only login on `/portal?display=1`, using the kiosk frame; no new credential, no remote control. | Portal 05/08/20 Deferred; 18/19 re-scoped; PP-1 Deferred (no identity change needed, verified); PP-2 kept. See § 0, A-13. | E3-Q4, E3-Q11 |
| **Q-42** | December cut line: all five features, or hold a line? | **Decided: all five features stay in December**; the combined cut order (§ 4) is applied as the date nears. | § 4 cut order (re-based). | this pass |


### Everything else
| ID | Question | Features | Default assumed | Impact if answered differently | Source | Status |
|---|---|---|---|---|---|---|
| Q-01 | Retracted article/release: in-fiction **tombstone** at the permalink, or plain not-found? | foundation 06, news 08, press 09, weather 09 | Tombstone in the outlet's skin (XC-010) | Plain 404 removes the tombstone DTO shape and four tombstone ACs; loses in-fiction "withdrawn" realism and the AAR trace. | F-Q1 | Default accepted unless Tom says otherwise |
| Q-02 | Press org newsrooms as **child `Outlet`s** of The Wire Room (one outlet per publishing org)? | foundation 03, press 01/09 | Yes; letterhead = outlet logo + `ext.press` | One outlet + an org filter in payload: changes F03 `parentOutletId` validation, the provisioner and per-org skin overrides. | F-Q2 | Default accepted unless Tom says otherwise |
| Q-04 | Gate **social** routes with channel enablement too (`/api/feed`, `/api/posts`)? | foundation 08 | No; a one-line follow-up | Yes touches pilot-mode social isolation tests and closes exercise-configuration AC3 fully. | F-Q4 | Default accepted unless Tom says otherwise |
| Q-05 | When content raises an alert, also emit the **SOC-072 platform notification** (pilot bridge)? | foundation 10 | Yes while bar and notifications coexist; bar authoritative once the portal-era bar is on | No: drop the bridge AC; pilot-mode participants see the bar only. | F-Q5 | Default accepted unless Tom says otherwise |
| Q-06 | **Participant release controls:** revise-own yes, retract staff-only; deleting a *scheduled* release requires "cancel embargo" first. | press 04/05/11 | As stated | Participant retract = a new route + attribution rules; direct delete of a scheduled release bypasses the cancel-embargo audit trace. | F-Q6, P-Q9 | Default accepted unless Tom says otherwise |
| Q-07 | The **portal is not a content channel** (it aggregates; filler is `news` content tagged `background`). | portal, foundation | Confirmed | Portal-owned content breaks "aggregates, does not publish" and adds a content kind (large). | F-Q7 | Default accepted unless Tom says otherwise |
| Q-08 | **Amend epic text** on the next sync: NWS-013 ("always append an editor's note") → two correction renderings (D3-P4); NWS-031 → "no comments, ever"; epic Q1 bylines → optional. | news | Stories follow D3; epic edited on sync | Reinstating "always append" removes the `silent_rewrite` lever (F04, news 08/17). | N-Q1 | Default accepted unless Tom says otherwise |
| Q-09 | **Updated-stamp semantics:** a silent rewrite *moves* the stamp (no fully-invisible edit); a post-publish breaking toggle does *not* move it (`touchUpdatedStamp: false`). | foundation 01/04/06/09, news 07/08 | As stated (FC-1 rule) | A "fully invisible" option is a one-flag addition (`touchUpdatedStamp: false` on a content edit); low cost. | N-Q2, N-Q3 | Default accepted unless Tom says otherwise |
| Q-10 | **Fonts:** self-host the OFL families lazily per outlet (news six families; weather/portal as needed) or system fallbacks only (restricted/air-gapped networks)? | foundation 13, news 10–13, weather 06, portal 06, PP-3 | Self-host, lazy per scope, `font-src 'self'` | System-only drops D3-P3 register fidelity, removes PP-3 font CSP and the woff2 files. | N-Q4 | Default accepted unless Tom says otherwise |
| Q-12 | **Seed content in the December build:** news none (outlets only); weather sample storm (story 15, stretch); portal evergreen filler (21). | news, weather 15, portal 21 | As stated | Prepared example articles/products make demos richer but add authoring, fictional-NWS and legal review and 1–2 stories. | N-Q5 | Default accepted unless Tom says otherwise |
| Q-13 | **Decided (Tom, 10/29): Tiptap.** **Rich-text library** for the article editor (approved library, or builder proposes TipTap/Lexical)? | news 17 | Builder proposes in the 17 PR; must emit only the `article-rich` allowlist | New-dependency review; **answer before CW4** now that press 07's body (Q-03) shares the library. | N-Q7 | **Decided: Tiptap** (Tom, 10/29). Press 07 and news 17 both use it; the gate on press 07 is removed. |
| Q-14 | **Alerts stay an explicit publish option:** a breaking article *suggests* an `advisory` entry but never raises one (FC-7a: `DefaultAlertMapping` is a suggestion only). | foundation 04/17, news 01/07 | Confirmed | Auto-raise from the mapping reverses FC-7a and every kind then needs an opt-out. | N-Q8 | Default accepted unless Tom says otherwise |
| Q-15 | **NewsNow (PDF-05):** mark "superseded by E4 for December" on the next triage? | news (post-demo-feedback) | Yes; no change made here | Doc-only. | N-Q9 | Default accepted unless Tom says otherwise |
| Q-16 | Embedded posts are **same-exercise only**; a deleted post shows "post unavailable". | news 06, foundation 21 | Yes (XC-001/XC-010) | Cross-exercise embeds violate isolation. | N-Q10 | Default accepted unless Tom says otherwise |
| Q-17 | Who may open the press composer: `pio` role **and** an org they may release as; others read the wire only? | press 04 | Yes | Wider access changes the authz matrix and attribution. | P-Q1 | Default accepted unless Tom says otherwise |
| Q-19 | Org colleagues see each other's **display names** ("last edited by J. Alvarez")? | press 04 | Yes, own org only | Hiding names weakens JIC coordination; per-human evaluation stays staff-side. | P-Q4 | Default accepted unless Tom says otherwise |
| Q-20 | Embargoed releases invisible to **everyone** but the author org and staff (media-persona preview parked)? | foundation 06, press 05/09 | Confirmed | Per-role projection in F06 and an XC-002 leak risk. | P-Q5 | Default accepted unless Tom says otherwise |
| Q-21 | A controller publishing a `pending_approval` release: **bypass with audit** (default) or force through approval? | foundation 04 (gate), press 06 | Bypass, audited via `IContentPublishGate` `Allow(auditNote)` | Forcing = gate returns `Hold` for staff; controllers lose the override mid-exercise. | P-Q6 | Default accepted unless Tom says otherwise |
| Q-22 | Approver notifications: **wire-internal badge only** (D4-007 #3) or also a platform notification? | press 06/10 | Wire-internal only | Platform push couples press to the notifications feature. | P-Q7 | Default accepted unless Tom says otherwise |
| Q-23 | Is a **headline-only release** (no body, no PDF) publishable? | press 05/07, `ReleaseDek` | Yes with a non-blocking note | Else a validation rule and a dek-fallback removal. | P-Q8 | Default accepted unless Tom says otherwise |
| Q-24 | **Warning ⇒ emergency band** for every hazard, no opt-out; watch → advisory; advisory → info (D4-010 #6 "for now"). | weather 04, foundation 11 | Yes | Graded mapping is parked; changing means `WeatherAlertSeverityMap` + bar tests. | W-Q1 | Default accepted unless Tom says otherwise |
| Q-25 | `@WeatherDesk` post default **checked** for watch/warning (unchecked for advisory/forecast)? | weather 04/11 | Checked, editable | Editor default only. | W-Q2 | Default accepted unless Tom says otherwise |
| Q-26 | **Backward clock jump:** nothing un-publishes; the site excludes "published after now", alert-bar entries and permalinks stay. Acceptable? | weather 03/04, foundation 05 | Acceptable, documented | Un-publish on rewind is a new foundation capability (large). | W-Q3 | Default accepted unless Tom says otherwise |
| Q-27 | **Advisory hue** AA amber `#8a4b00` + `faCircleInfo` (D4 defines only warning and watch). | weather 06/07 | Yes, pending design confirmation | Token edit. | W-Q5 | Default accepted unless Tom says otherwise |
| Q-29 | Weather **product text monospace** only (`ProductText`); plain sans for chrome (D4-009)? | weather 07 | Yes | Token/font only. | W-Q7 | Default accepted unless Tom says otherwise |
| Q-30 | **US customary units** only (°F, mph, inches)? Any non-US exercises in December? | weather | US only | Non-US needs unit/locale support (new scope). | W-Q8 | Default accepted unless Tom says otherwise |
| Q-31 | The weather epic's §5 open questions **end mid-sentence** (file truncated). Is a question lost? | weather (epic text) | None assumed | Possible unscoped question; epic text fix. | W-Q9 | Default accepted unless Tom says otherwise |
| Q-32 | Portal **"[City]"** source: a `CityName` config field; unset → neutral "Local Today" (never the exercise name). | portal 03/16 | As stated | Using the exercise name leaks the exercise into the fiction. | E3-Q1 | Default accepted unless Tom says otherwise |
| Q-33 | **Kiosk chrome:** strip the compliance banners (D2 "zero chrome") and always draw the EXERCISE chip, or keep banners? | portal 18, PP-2 | Strip banners, chip always on | Keeping banners simplifies PP-2 but loses the clean big-screen. | E3-Q2 | Default accepted unless Tom says otherwise |
| Q-34 | Add D2's visible header link row (News · Pulse · Wire Room · Weather) despite SHELL-CONTRACT? | portal 06/17 | No: shell strip + in-module "See all →" | Needs a SHELL-CONTRACT amendment. | E3-Q3 | Default accepted unless Tom says otherwise |
| Q-36 | **Emergency lead kicker** "● EMERGENCY · LIVE UPDATES" / red "WATCH LIVE": platform-generated text in the fiction. | portal 13 | Drop the text; non-textual mood shift; controllers carry kicker text | Keeping it violates FC-9.5 / SOC-002 unless authored; D2-004 amendment. | E3-Q5 | Default accepted unless Tom says otherwise |
| Q-37 | **COR-052 module advancement** (exercise-clock/03, Not Started) in December? | portal, exercise-clock | No; kiosk follows live content | Adds a whole feature to scope. | E3-Q7 | Default accepted unless Tom says otherwise |
| Q-38 | **Resources shelf:** no external links; authored text may contain real times, the platform renders none. | portal 04/15 | As stated | External links would break FC-9.3. | E3-Q8 | Default accepted unless Tom says otherwise |
| Q-39 | **Top Stories scope:** News only? | portal 09 | News only; press/weather have modules | Mixed lead needs a cross-channel list route (new). | E3-Q9 | Default accepted unless Tom says otherwise |
| Q-40 | **TTX facilitator** = controller or planner (no new role)? | portal 05/20 (**both Deferred, Q-35**) | Yes | A new role is an identity change. | E3-Q10 | Default accepted unless Tom says otherwise |
| Q-41 | **Portal visual direction:** ship broadcast + anchor only; print/grid parked (print collides with Courier-Ledger)? | portal 06/07 | Yes | More directions = more portal-skin stories. | E3-Q12 | Default accepted unless Tom says otherwise |

## 7. Epic and design amendments flagged but **not** made

No agent edited an epic, the Master PRD, `docs/design/**` or `STORY-UPDATES.md` (docs-only decomposition). These need a decision, then an edit.

| # | Item | Document to amend | Applied in the stories as | Question |
|---|---|---|---|---|
| A-1 | NWS-013 "always append an editor's note" vs the quiet-rewrite lever (D3-P4 splits it into two renderings: visible correction note, silent rewrite with only the Updated stamp) | `docs/04-*.md` (E4) NWS-013 | two renderings; `silent_rewrite` moves the stamp, adds no `revisions[]` | Q-08, Q-09; **Applied 10/29 (Tom): E4 NWS-013 amended.**
| A-2 | NWS-031 hardened from "comments out of scope at launch" to "no comments, ever" | E4 NWS-031 | fixed discussion footer, no comment model | Q-08; **Applied 10/29 (Tom): E4 NWS-031 amended.**
| A-3 | E4 epic Q1 (reporter bylines) settled to optional (D3 RECONCILE) | E4 open question 1 | byline format token, optional | Q-08 |
| A-4 | Weather epic §5 open questions truncated mid-sentence | `docs/06-*.md` (E6) §5 | none | Q-31 |
| A-5 | WX-011 "at mapped severity" vs D4-010 (every warning = emergency, "for now") — D4 STORY-UPDATES **C-2** | `docs/06-weather-source.md` WX-011 | one pinned severity map, graded mapping parked | Q-24 |
| A-6 | WX-020 "'@NWSAtlanta'-analog" vs `@WeatherDesk` — D4 **C-3** | `docs/06-weather-source.md` WX-020 | `@WeatherDesk`, brand "The Weather Desk" | — |
| A-7 | PRS-021 approver "a controller playing that role" vs approval gate as **participant paper** — D4 **C-1** | `docs/05-press-room.md` PRS-021 | participant approval routes, controller acts through the participant view | Q-21 |
| A-8 | PDF-first (PRS-002) vs December: **rich text first, PDF as a download-only attachment** (Tom, 10/29, Q-03). PRS-002's "drop a finished PDF as the body, rendered inline" wording is not delivered in December; inline rendering is Q1 | `docs/05-press-room.md` PRS-002 | rich-text body with an optional download-only PDF attachment; no inline render, no page count, no headline-from-PDF | Q-03; **Applied 10/29 (Tom): E5 PRS-002 amended.**
| A-9 | Portal conflicts **C-1…C-7** vs the D2 brief / SHELL-CONTRACT / PRT-004 (decisions applied; D2 has no STORY-UPDATES): **C-1** D2 header link row vs "channels never render cross-channel nav" · **C-2** D2-004 "● EMERGENCY · LIVE UPDATES" kicker / red "WATCH LIVE" vs FC-9.5 · **C-3** D2-005 "Trending always renders" vs no data when social is off · **C-4** D2-007 wall-clock schedule on Resources vs COR-053 (Resources is the one out-of-fiction surface) · **C-5** participant-shell/06 kiosk strips chrome vs COR-031/NFR-008 · **C-6** PRT-040 "login-free" vs XC-001 (bearer link to a read-only `display` session) · **C-7** PRT-004 controller-ordered with fallback vs F06's `featured=true` ordering | `docs/design/D2-portal.md`, `D7-application-shells/SHELL-CONTRACT.md`, `docs/03-*.md` (E3) PRT-040/041, PRT-004 | all seven decisions as stated in `exercise-portal/implementation.md` § Conflicts | Q-33, Q-34, Q-36, Q-38 |
| A-10 | **FC-1 vs D3-P4**: FC-1 said `silent_rewrite` has "no participant marker"; D3-P4 says only the Updated stamp changes. Resolved **in the foundation contract** by this pass (stamp moves, no `revisions[]` entry); the epic/design text is untouched | `docs/design/D3-news-outlets/STORY-UPDATES.md` NWS-013 | FC-1 Updated stamp rule | Q-09 |
| A-11 | Foundation closes exercise-configuration open question (c) "channel-enablement route gating is unowned" for portal/news/press/weather only; social gating deferred | `docs/features/exercise-configuration` AC3 | F08 | Q-04 |
| A-12 | Demo-polish F0 **froze the `features/social` barrel**; foundation story 21 lifts the freeze for additive read-only exports | `docs/features/demo-polish` implementation §4.3 | F21 | — |
| A-13 | **PRT-040 "login-free, facilitator-driven display"** vs December's kiosk-lite (Tom, 10/29, Q-35): the screen is signed in with the existing shared view-only code and shows the live portal; the revocable per-display credential, remote control and playlist are Deferred. The epic text is not edited | `docs/03-*.md` (E3) PRT-040/041 | kiosk-lite on `/portal?display=1`; portal 05/08/20 Deferred (see also A-9 C-6) | Q-35; **Applied 10/29 (Tom): E3 PRT-040 amended.**

### D3 and D4 STORY-UPDATES checklists left unticked by design
Each item is ticked in `docs/design/D3-news-outlets/STORY-UPDATES.md` / `docs/design/D4-press-weather/STORY-UPDATES.md` **by the owning story's merge**, not by the decomposition. Nothing in either file was ticked.

| Checklist | Unticked item → owning stories |
|---|---|
| **D3** (news) | NWS-002 skins as token files → news 10–13, 03, 20 · NWS-010 kicker/slot-mapped model → news 01, 04 · NWS-003 lead-mode enum → news 15, 14 · NWS-012 breaking slot → news 07 (+01) · NWS-013 two correction renderings → news 08, 17 (A-1) · NWS-014 one player → news 05 · NWS-032 watermark chip → news 05 (+F14) · NWS-031 discussion footer → news 09 (A-2) · NWS-030 telemetry invisibility → news 04, 19, 20 · NWS-001 CANNOT list → news 03, 20 (server guard F03) · NWS-011/015 share + embed → news 06, 09 (+F21) · ADD skin token schema → F13 + news 10–13 · ADD article grid → news 04 · ADD Scoop clutter set → news 14 · ADD register token values → news 10–13 · RECONCILE epic Q1 bylines → news 04 (A-3) · RECONCILE D2-002 "print" → portal parks print (Q-41) · BACKLOG: full mockup (Q-11), NWS-020/021/022 UI → news 17/18, NWS-004 pairing → F18 |
| **D4** (press + weather) | PRS-002 letterhead sheet, **rich-text-first (10/29)** → press 02 (attachment), 07, 08; the PDF-first / inline-render part is Deferred with press 03 · PRS-003 scheduled state by redundancy → press 05, 07, 08, 09 · PRS-013 cross-post explicit → press 05, 08 (+F18) · PRS-004 autosave ambient → press 04, 07 · PRS-020 one confirm gate → press 05, 08, 13 · PRS-021 approval is participant paper → press 06, 10 (C-1 = A-7) · PRS-001/COR-018/SOC-006 "Releasing as" chip → press 04, 07 (Q-18) · PRS-010/012 public wire → press 01, 09 · WX-001/010 NWS-verbatim anatomy → weather 01, 06–09 · WX-011 propagation → weather 04, 08–10 (+F10, F11; C-2 = A-5) · WX-013 imagery watermark → weather 07, 09, 11, 14 · WX-020 `@WeatherDesk` → weather 04, 11 (C-3 = A-6) · WX-002 staff-authored only → weather 11, 12 · backlog: return-notification reach (Q-22), mobile pass (Q-11), real inline PDF (**Deferred, post-December, press 03**) + paste-from-Word → press 04/07, alerts history page → F11, graded severity (Q-24), `@WeatherDesk` editable pre-publish → weather 11, weather authoring console-side → weather 11–13 |

## 8. Inconsistencies noticed and how they were handled

| # | Inconsistency | Handling |
|---|---|---|
| I-1 | FC-1 ("no participant marker") vs D3-P4 (Updated stamp moves) on `silent_rewrite`; `ContentItem` had no column to hold a stamp without a visible revision | Contract clarified; `UpdatedScenarioTime` added to FC-2/F01 (A-10) |
| I-2 | Story 05 referred to a staff-visible `lastError`, but FC-2 had no such column | `LastError` added to FC-2/F01 |
| I-3 | Weather FU-2 wanted `DefaultAlertMapping` to be the alert default on the no-dialog path; news E4-Q8 needs it to never raise an alert | Resolved: `DefaultAlertMapping` is a suggestion only; weather supplies `ResolvePublishOptions` (FC-7a) |
| I-4 | Press 01 listed "can run with 04" while 04 depends on 01; weather 12 depends on 11 yet listed it as can-run-with | Same-wave serial edges, recorded in section 2; press text corrected on 10/21; **weather corrected 10/29: 12 explicitly waits for 11** (the timeline's edit action delegates to 11's editors), and 11/12's can-run-with lists no longer name each other (weather `feature.md`, `implementation.md`, stories 11 and 12) |
| I-5 | Feature-local wave numbering differs (press/weather use the foundation axis; news/portal are local) | Combined waves (section 2) with six explicit moves; per-feature tables untouched |
| I-6 | Portal 18 owned a `ShellLayout.tsx` edit that is really a platform change in a Complete shell story | Moved to PP-2; portal 18 now consumes it (nobody has yet accepted ownership of PP-1/PP-2/PP-3; the orchestrator must) |
| I-7 | "Only F01 and F16 own migrations" contradicted three channel features | Replaced by the ledger (section 3) |
| I-8 | Foundation F04 now exceeds the 3–7 AC guideline (12) | Existing foundation stories already ran 8–10; split seam documented in F04 tech notes, not split |
| I-9 | **New 10/29 — F01 now carries other features' schema** (Q-28). A column discovered after M1 merges would have been a cheap amendment under the 10/21 ledger | The folded column specs (portal PC-2 minus `PortalDisplay`, the weather zone columns, the inject column) are **frozen before CW1 starts**; a late column is an orchestrator-approved additive follow-on migration numbered after M2, never a rewrite of M1 (ledger rule 6) |
| I-10 | **New 10/29 — the Q-13 rich-text library is now needed by CW4**, not CW5: press 07's body is a rich-text editor (Q-03) and shares the library with news 17 | Press 07's PR proposes the library if Q-13 is still open; news 17 reuses it; **Closed 10/29: Q-13 decided, Tiptap; the gate is removed** |
| I-11 | **New 10/29 — kiosk-lite's `display=1` is read by a route-level `KioskGate`** that no existing story owned (portal 17 owns `PortalChannel`, 18 owns the frame) | Owned by portal 18 (`KioskGate`, `useKioskMode`), wired above `PortalChannel` by the orchestrator at the `/portal` route; honored for read-only sessions only, so a participant link with `display=1` never strips chrome |
| I-12 | **New 10/29 — read-only sessions are not day-capped** (sliding access window, default 12 h refresh) so a kiosk-lite screen left past the refresh window needs the view-only code re-entered (the Deferred credential would have refreshed until EndEx) | Documented in portal 18 (neutral re-sign-in notice; facilitators set the screen up each day); not changed in the identity feature |

## 9. GitHub mirror (created 10/29)

Epic → Feature → Story **sub-issue hierarchy** per [`../GITHUB_TRACKER.md`](../GITHUB_TRACKER.md); markdown stays canonical. All issues carry `release:december` and `phase:3` (no milestones are used in this repo); stories/features are `status:todo`.
E3, E4, E5 and E6 had no epic issue, so they were created (**E3 #688, E4 #689, E5 #690, E6 #691**); the channels foundation is cross-cutting and is parented under **E1 #37** (the precedent for `telemetry`, `participant-shell` and `backend-host`; the tracker doc itself had no cross-cutting rule, so it now records one).
Deferred stories (press 03; portal 05, 08, 20) have **no issue** and are listed in their feature issue's body.

| Feature issue | Parent epic | Story issues |
|---|---|---|
| **#692** F: Channels foundation (cross-cutting, parented under E1 — Platform Core) | E1 (#37) | **23** — 01 #697, 02 #698, 03 #699, 04 #700, 05 #701, 06 #702, 07 #703, 08 #704, 09 #705, 10 #706, 11 #707, 12 #708, 13 #709, 14 #710, 15 #711, 16 #712, 17 #713, 18 #714, 19 #715, 20 #716, 21 #717, 22 #788, 23 #789 |
| **#693** F4 News network | E4 (#689) | **20** — 01 #718, 02 #719, 03 #720, 04 #721, 05 #722, 06 #723, 07 #724, 08 #725, 09 #726, 10 #727, 11 #728, 12 #729, 13 #730, 14 #731, 15 #732, 16 #733, 17 #734, 18 #735, 19 #736, 20 #737 |
| **#694** F5 Press Room (The Wire Room) | E5 (#690) | **14** — 01 #738, 02 #739, 04 #740, 05 #741, 06 #742, 07 #743, 08 #744, 09 #745, 10 #746, 11 #747, 12 #748, 13 #749, 14 #750, 15 #751 |
| **#695** F6 Weather source | E6 (#691) | **15** — 01 #752, 02 #753, 03 #754, 04 #755, 05 #756, 06 #757, 07 #758, 08 #759, 09 #760, 10 #761, 11 #762, 12 #763, 13 #764, 14 #765, 15 #766 |
| **#696** F3 Exercise portal and kiosk-lite display | E3 (#688) | **20** — 01 #767, 02 #768, 03 #769, 04 #770, 06 #771, 07 #772, 09 #773, 10 #774, 11 #775, 12 #776, 13 #777, 14 #778, 15 #779, 16 #780, 17 #781, 18 #782, 19 #783, 21 #784, 22 #785, 23 #786 |

Total: 4 epics + 5 features + 92 stories = **101 issues** (99 created 10/29, plus #788 and #789 added by the follow-up pass).
