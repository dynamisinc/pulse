# ScenarioForge Suite — Authoritative Internal Record

> **Status:** v1 · 2026-07-18 · Authoritative internal source document
> **Purpose:** A single, accurate record of the ScenarioForge suite (Beat, Cadence, Pulse) — what each product is, its stack and maturity, where it has been used, and Tom Bull's role. Written to serve as the source of truth from which more tailored, audience-specific materials (RFP responses, capability statements, bios, briefings) are drawn.
> **Sources:** Dynamis knowledge base (Cadence CAPABILITIES / PLATFORM_OVERVIEW / FEATURE_MATRIX, ScenarioForge Capability Slick), the Pulse repository docs (Master PRD, Build Plan, E8 engine design), and Tom's direct input (2026-07-18).
> **Confidence key:** Statements are grounded in the sources above unless marked **[TBC]** (to be confirmed / not yet documented).

---

## 0. The suite at a glance

ScenarioForge is Dynamis's purpose-built technology suite for the emergency-management exercise lifecycle. Three products divide the work:

| Product | Role in one line | Nature |
|---|---|---|
| **Beat** | AI-generated inject content studio — video, images, articles ("the media factory") | Process/production-driven service |
| **Cadence** | HSEEP-aligned exercise management & conduct — MSEL, clock, fire, EEG/AAR ("the conductor") | Web platform (SaaS) |
| **Pulse** | The simulated public-information environment participants inhabit ("the stage") | Web platform (SaaS) |

The suite is positioned to complement — not overlap — the Dynamis flagship: **Cadence owns exercise & training; COBRA / C5 owns real-world incident management.** Beat and Pulse plug into the exercise *conduct* experience rather than duplicate it. The whole suite is operated by the same Dynamis team that designs and facilitates the customer's exercise.

**Timeline of record (2026):**

- **Beat** — video production began March 2026; first live deliverable May 2026. Now an established Dynamis capability/offering, cited in RFPs and commercial quotes. In use: Air Force Reaper (May 2026); CISA exercises (April–July 2026).
- **Cadence** — commercially released July 2026 (live build v2.16). Piloted to date; TSA is a prospective customer for fall 2026.
- **Pulse** — in active phased build; target release September 2026.

---

## 1. Beat — AI video / inject content studio

*(Process-driven production service, not a shipped code product. "Beat" is the current product name; earlier marketing material refers to this capability as "Broadcast.")*

### What it produces, for whom, and how

Beat is the media factory of the suite: an AI-assisted production capability that generates exercise inject content — **AI-generated news broadcasts, B-roll, and video injects**, plus **images and articles** — featuring the customer's *actual* venues, landmarks, and jurisdiction. Outputs include AI anchor-desk news segments and venue-accurate, jurisdiction-specific visuals.

The audience is the exercise design team and SimCell: Beat content is produced during the planning cycle and delivered as **timed injects during exercise play** (natively, Beat-produced video embeds inside Pulse social posts and news articles, and can be fired into Cadence-run exercises). The value proposition is speed and cost — media produced in **days, not weeks, at a fraction of traditional video-production cost**, with rapid iteration off planning-conference feedback (e.g., objectives shift at the MPM and updated injects are ready in days).

### Toolchain / models

Beat is delivered as a human-run production process built on a **curated, multi-tool pipeline of commercial AI generation services**, assembled and maintained through a formal, repeatable **tool-evaluation methodology** rather than a single fixed toolchain. The pipeline is deliberately **evolving** as tools improve; selection is driven by evidence, not vendor lock-in. (Working documents live in the EM Media Production Initiative folder: the tool-evaluation guide, evaluator onboarding guide, and per-tool scoring workbooks.)

**Evaluation methodology.** Candidate tools are scored against **24 standardized test prompts** across six media categories — still image, image-to-video, text-to-video, avatar/anchor video, voice generation, and broadcast graphics (lower-thirds, social mockups) — on a 1–5 usability rubric ("would I use this output?"), by both internal and external evaluators, with fixed file-naming and folder conventions so results are comparable across tools and rounds. Tests include exercise-specific stressors such as correct pronunciation of local place names (e.g., Kissimmee, Osceola) and jurisdiction-accurate reference-image fidelity.

**Field of tools evaluated** (as of the Jan 2026 round): Google AI (Gemini / "Nano Banana"), OpenAI Sora, HeyGen, ElevenLabs, Envato Elements, InVideo AI, Grok, Midjourney, Runway, and Pika — spanning voice, avatar/anchor video, text/image-to-video, still imagery, and graphics. The production pipeline draws the best-scoring tool per category and is refreshed as the field changes.

**Production evidence in-folder:** the Osceola County TTX proof of concept (AI newscast + source-content workflow), the REAPER deliverables, and World Cup / Miami Heatwave B-roll (cooling-station and on-the-ground reporter clips, Norfolk and Dallas newscasts) — demonstrating anchor-desk newscasts, field B-roll, and jurisdiction-specific media as shipped output classes.

### Usage detail (dates / scale)

Video production began **March 2026**, with the **first live deliverable in May 2026**. Typical output is **5–10 videos per exercise**. Beat is now treated as an established Dynamis capability/offering and is cited in RFPs and commercial quotes.

| Engagement | Timing | Notes |
|---|---|---|
| Air Force Reaper | May 2026 | First live Beat deliverable. ~5–10 videos/exercise. |
| CISA exercises | April–July 2026 | Beat used across CISA exercise support. ~5–10 videos/exercise. |

*(Note: an earlier draft associated a "TSA summer 2026" engagement and a "July 2026 commercial release" with Beat. Per Tom, those belong to Cadence — TSA is a prospective **Cadence** customer for fall 2026, and the July 2026 commercial release is **Cadence**. Corrected here.)*

### Tom's role

Tom **project-manages the Beat team** responsible for video generation — leading the production effort rather than hand-building each asset.

---

## 2. Pulse — simulated public-information environment

### What it is

Pulse is a **simulated public-information environment** for emergency-management exercises — the designated replacement for Looking Glass on future Dynamis-supported exercises. It is more than a social-media clone: it is a **simulated internet** comprising a social network, simulated news outlets, a press-release wire, a weather service, and an exercise portal that ties them together — instrumented end-to-end for control, adaptation, and evaluation. PIOs and EM staff practice monitoring feeds, countering misinformation, publishing official messaging, and managing public sentiment in real time.

Its differentiators over Looking Glass are an **adaptive content engine** ("a world that talks back" — content generated in response to what participants do *and fail to do*, governed by a controller who directs rather than types), **first-class evaluation telemetry**, and **native Cadence/Beat integration**.

### Stack

Aligned with the proven Dynamis / Cadence stack:

- **Frontend:** React + TypeScript + Vite, MUI + FontAwesome, COBRA styling system (participant surfaces are per-brand skinned with no COBRA chrome; staff surfaces use COBRA, desktop-first).
- **Backend:** .NET / ASP.NET Core on Azure; Azure SQL + EF Core; SignalR for real-time fan-out (feeds, notifications, trending).
- **Hosting:** Azure Static Web Apps / App Service; per-exercise subdomains for host-level isolation. Commercial Azure at launch, with a documented Azure Gov / StateRAMP roadmap for security questionnaires.
- **Adaptive content engine:** tenant-bounded LLM endpoints (e.g., Azure OpenAI under no-training-on-customer-data terms), model tiering (Sonnet-tier for storyline-critical generation, Haiku for ambient), prompt caching as the dominant cost lever; modeled generation cost ~$1.50–3.60 per exercise-hour, off the participant hot path.
- **Cost posture:** consistent with Cadence's modest-Azure-infrastructure philosophy.

### Maturity

**Pre-release; in active, phased build toward a September 2026 launch.** Development is managed in the `dynamisinc/pulse` repository via a multi-agent orchestration workflow, with an engine-first phasing strategy (the adaptive engine, the anticipated most-used capability, starts maturing as soon as the social network stands).

- **Phase 1 — Social core (in progress):** Foundation seams merged (exercise-isolation context, scenario-time clock, XC-004 telemetry schema; 89 tests). Participant shell built (compliance chrome, brand theming, alert bar, channel nav; COBRA physically unreachable from participant paths). Staff shell built and Gate-2 clean (Cadence header, toolstrip dock, participant-admin flyout, preview-as-participant). Social E2 keystone (`PostCard` + provenance) delivered; first social surface (global feed + composer + threads) in progress.
- **Phase 2 — Adaptive engine v1 (designed, backlogged):** Architecture spike complete; GitHub Epic #126 → 11 v1 features + 4 stubs → 37 stories. Pilot exercises are explicitly runnable at this stage (Social + engine as a standalone social-media-focused offering).
- **Phase 3 — Looking Glass parity channels:** Portal, News Network, Press Room, Weather Source.
- **Phase 4 — Ecosystem & evaluation depth:** Cadence fire-into-Pulse, Beat media pipeline, full evaluation/AAR (timeline, replay, metrics), engine maturity.

Non-functional targets are procurement-shaped: WCAG 2.1 AA / Section 508, 300 concurrent sessions nominal (500 ceiling) per exercise, 99.9% availability during conduct windows, content-security hardening, and LLM data governance.

### Where it has been used

**Not yet fielded** — Pulse releases September 2026. Its scope and parity targets were derived from observed Looking Glass functionality at the **Atlanta Critical Infrastructure Exercise (May 2026)**, which anchors the replacement analysis.

### Tom's role

Tom has done **everything on Pulse from business analysis and design through implementation, refinement, fielding, training, marketing, and iteration** — the full product lifecycle, as originator and lead.

---

## 3. Cadence — HSEEP exercise management & conduct

### What it is

Cadence is a **HSEEP-compliant MSEL management platform** for emergency-management exercises, with its center of gravity in the **conduct** phase — the real-time running of an exercise — and reach outward into planning (MSEL authoring/review) and evaluation (observation capture and after-action material). The thesis: most teams plan in Excel, run the day off printouts and a whiteboard, and rebuild the AAR from memory; Cadence is one place for all three, built for the messy live part — including when the EOC has no usable wifi.

### Stack

- **Frontend:** React 19 + TypeScript + Vite, MUI 7 (in-house COBRA styling system) + FontAwesome + React Query; Azure Static Web App / PWA.
- **Backend:** .NET 10 / ASP.NET Core on Azure App Service (B1, **always-warm — no cold starts during conduct**); EF Core 10 against Azure SQL; Azure SignalR for real-time; Azure Functions for background jobs only.
- **Offline:** PWA with IndexedDB (Dexie) local cache + FIFO action queue and sync-on-reconnect, with conflict resolution (last-write-wins generally; first-write-wins for inject firing).
- **Architecture:** clean separation of concerns — `Cadence.Core` (domain/business logic, no web dependencies), `Cadence.WebApi` (host, controllers, SignalR hubs, auth), `Cadence.Functions` (background jobs). Feature-module structure on both tiers.
- **Ops:** CI/CD via GitHub Actions, infrastructure-as-code via Bicep; ~$20/month infrastructure target.

### Maturity

Commercially released **July 2026**; live UAT build **v2.16** (verified 2026-07-09). Candid read:

- **Live and verified:** auth/RBAC, org multi-tenancy, exercise & MSEL CRUD, the conduct experience (clock, fire/skip/defer, confirmation, Director/Controller/Narrative views), real-time + offline, observations and EEG entries, metrics/coverage/reports and exports.
- **Built, less battle-tested:** inject approval workflow, collaborative MSEL review, inject library, bulk import, review mode, document/EEG generation.
- **Roadmap / partial:** field operations (photo/voice/GPS + director map), auto-fire & conditional triggers, multi-MSEL, multi-framework.
- **Candid notes:** small user base so far; effectively single-developer to date; activation is one-way in the UI today (no revert-to-Draft); coverage dashboard depends on injects being tagged to objectives.

### Users / exercises

**Piloted to date** — engagements so far have been pilots rather than sustained production deployments. Actively developed. **TSA is a prospective customer for fall 2026.**

### How it embodies HSEEP

Cadence is HSEEP-native rather than a generic tool retrofitted:

- **Exercise types:** TTX, FE, FSE, CAX (plus Hybrid).
- **Participant roles:** **5 exercise roles live today** (Administrator, Exercise Director, Controller, Evaluator, Observer), with the **full 9 HSEEP roles planned** (adding Player, Simulator, Facilitator, Safety Officer, Trusted Agent). Outward-facing materials should claim "5 today, 9 planned" rather than presenting all nine as shipped.
- **Inject lifecycle:** the FEMA PrepToolkit 8-status model — Draft → Submitted → Approved → Synchronized → Released → Complete, with Deferred and Obsolete branches ("Fire" moves an inject to Released).
- **Evaluation chain (EEG):** Objective → Capability → Capability Target → Critical Task → Inject → EEG Entry, with mandatory **P/S/M/U** ratings (Performed / Some challenges / Major challenges / Unable).
- **Dual-time tracking:** wall-clock and scenario time on every inject, enabling multi-day scenario compression.
- **SMART objectives** with many-to-many inject linkage for coverage analysis.
- **AAR output:** export organized by Capability → Target → Task → Observation, supporting the HSEEP AAR/IP format.
- **Cross-framework support (configurable):** DoD/JTS, NATO, UK Cabinet Office, Australian AIIMS, NIST/MITRE, CMS/Joint Commission, FFIEC/FINRA, ISO 22301 — with HSEEP as the default.

### Tom's role

As with Pulse, Tom has done **everything on Cadence — business analysis and design through implementation, refinement, fielding, training, marketing, and iteration.**

---

## 4. Suite-level — ScenarioForge as a product line

### Positioning and commercial complement to COBRA

ScenarioForge is the purpose-built technology arm of a broader Dynamis offering: **HSEEP-consistent, end-to-end exercise programs** delivered by exercise professionals who also build and operate the tooling. The five-phase framing Dynamis markets — Program Management, Design & Development, Conduct, Evaluation, Improvement — is accelerated at each phase by the suite: Beat compresses content production between planning conferences; Cadence replaces spreadsheet MSEL trackers and group chats in conduct; Pulse provides the simulated information environment for PIO/public-information play; and evaluation/AAR flow through Cadence's EEG and Pulse's telemetry.

Commercially, the suite is **complementary to the COBRA / C5 flagship, not competitive with it**: Cadence owns exercise & training, COBRA/C5 owns real-world incident management, and the exercise products are designed to plug into conduct rather than duplicate the incident-management core. This lets the exercise suite open doors (and recurring exercise engagements) with the same emergency-management customer base COBRA serves.

### Roadmap (product line)

- **Beat:** established Dynamis capability (production since March 2026, first live deliverable May 2026), now embedded in RFPs and commercial quotes; continued federal/exercise production support with an evolving generation pipeline. Typical delivery 5–10 videos/exercise.
- **Cadence:** field operations (photo/voice/GPS + director map — highest stated SME demand), automation (auto-fire & conditional/branching triggers, already modeled), multi-MSEL / larger multi-agency events, multi-framework support, and expanded HSEEP document generation (AAR/IP).
- **Pulse:** ship Phase 1–2 (social core + adaptive engine) for pilot exercises, then Looking Glass parity channels (Phase 3) and ecosystem/evaluation depth (Phase 4); Azure Gov / StateRAMP hosting posture as a procurement enabler.

### Go-to-market / marketing

Dynamis markets the suite under the ScenarioForge banner with a capability slick and a demo reel of AI-generated exercise media (news broadcasts, B-roll, scenario-specific injects), routing inquiries through **cobrasales@dynamis.com** with capabilities briefings and live demos. Positioning emphasizes HSEEP compliance, all-hazards, tabletop-through-full-scale coverage, and federal/state/local applicability.

### Product ownership and Tom's role

The **entire ScenarioForge suite is Tom's concept and initiative** — his brainchild. His hands-on role by product:

- **Beat:** leads and project-manages the video-generation team.
- **Cadence & Pulse:** full lifecycle ownership — business analysis, design, implementation, refinement, fielding, training, marketing, and iteration.

Tom holds **formal P&L (profit & loss) ownership** of the suite — accountability for its revenue, costs, and margin — **in addition to** product and delivery leadership. In outward-facing materials this supports the strongest framing: originator, P&L owner, and hands-on delivery lead across ScenarioForge.

---

## 5. Open items

All prior open items are resolved. Beat's toolchain is documented above as a curated multi-tool pipeline maintained via a formal evaluation methodology; because that pipeline is intentionally evolving, the **specific per-category tool selections should be re-confirmed against the latest evaluation round** before being quoted in any point-in-time, customer-facing document.
