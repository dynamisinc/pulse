# Pulse — Master PRD & Epic Map

> **Status:** Draft v1 · 2026-07-09 · Output of multi-channel scope brainstorming session
> **Purpose:** Master overview for the Pulse product package. Each epic below has a self-contained file suitable for handing to a story agent or designer independently.
> **Companion docs:** `pulse-vision-doc.md` (vision & principles), `CADENCE_PLATFORM_OVERVIEW.md` (ecosystem context)

---

## 1. Product summary

Pulse is a simulated public information environment for emergency-management exercises — the replacement for Looking Glass on future Dynamis-supported exercises. It is not just a social media clone: it is a **simulated internet** comprising a social network, news outlets, a press release wire, a weather service, and an exercise portal that ties them together — instrumented end-to-end for control, adaptation, and evaluation.

Pulse is one leg of the ScenarioForge triad:

| Product | Role |
|---|---|
| **Beat** | AI-generated inject content studio (video, images, articles) — the media factory |
| **Cadence** | HSEEP-aligned exercise management & conduct (MSEL, clock, fire, EEG/AAR) — the conductor |
| **Pulse** | The simulated information environment participants inhabit — the stage |

## 2. Replacement target (Looking Glass parity analysis)

Observed Looking Glass core functionality from the ATL Critical Infrastructure Exercise (May 2026):

| Looking Glass capability | Pulse disposition | Epic |
|---|---|---|
| Exercise landing page (RIP Board news-portal style) | **Replace** | E3 |
| Tweeder (Twitter-like social) | **Replace & exceed** (adaptive engine) | E2, E8 |
| NewsNow (TV news site, articles with permalinks) | **Replace** | E4 |
| Press Room Wire (PIO press release publishing, embargo) | **Replace** | E5 |
| Weather Source | **Replace** | E6 |
| Utube (standalone video site) | **Descope** — video embeds in social/news instead | E2, E4 |
| Lookbook (Facebook-like second social) | **Descope at launch** — revisit post-launch | — |
| RIP Alerts (cross-channel notifications) | **Absorb** into Portal + Social notifications | E2, E3 |
| UNCLASSIFIED / FOR EXERCISE PURPOSES ONLY banners | **Replace** as configurable compliance chrome | E1 |
| Agency accounts responding to citizen posts | **Replace** | E2, E7 |
| Many scripted voices reporting same events | **Exceed** — adaptive generation, not just scripts | E8 |

**Not in Looking Glass, but core to Pulse:** adaptive content generation reacting to participant action/inaction (E8), first-class evaluation telemetry (E10), and native Cadence/Beat integration (E9).

## 3. Scope decisions (settled this session)

1. **Video: embeds only at launch.** Beat-produced video plays natively inside social posts and news articles. A standalone video platform is a candidate post-launch epic.
2. **Weather Source: in scope.** Low build cost, high scenario value.
3. **Lookbook: out of scope at launch.** A second social format doubles content-authoring burden for marginal training value. Revisit with customer demand.
4. **Compliance chrome is configurable, not absolute.** The vision doc's "no banners" principle is amended: government exercises require UNCLASSIFIED / FOR EXERCISE PURPOSES ONLY markings. These are per-exercise settings rendered as environment chrome (outside the simulated apps' visual frame), preserving in-app immersion while meeting compliance.
5. **Alerts are a capability, not a channel.** Cross-channel notification (the RIP Alerts role) is delivered through the alert bar — which persists across **all** enabled channels (the EAS analog) — plus Social notifications, rather than a standalone product surface.
6. **Hybrid identity model.** Staff federate with Cadence/Dynamis identity; active participants (posting roles) get Pulse-native named accounts; passive participants use a generic per-exercise shared password granting read-only sessions (no per-user provisioning for large audiences). Entra ID / AD / SSO is a future direction — keep the provider behind an interface. (COR-014/COR-015)
7. **Press Room is PDF-first.** PIOs predominantly publish finished PDFs; drag-and-drop PDF is the primary authoring path, rich text secondary. (PRS-002)
8. **Per-exercise hostnames.** Each exercise gets its own subdomain (Looking Glass pattern) — host-level isolation reinforcement, trivial participant onboarding (URL + shared password), no shared domain visible. (COR-008)
9. **Build → Staged → Live lifecycle.** Content development is a first-class phase with a build workspace, preview-as-participant, and readiness dashboard; opening the platform to participants (Staged, ambient world) and StartEx (Live, clock starts) are two distinct, gated go-live moments. (COR-032, COR-040…045)
10. **TTX is in scope, Phase 3.** Tabletop exercises (~3:1 volume vs. functional among target customers) get a kiosk/big-screen display mode (PRT-040) and module-based time advancement (COR-052) — Pulse is not real-time-conduct-only.
11. **Hosting: commercial Azure at launch with a documented Azure Gov/StateRAMP roadmap** and data-handling policy (NFR-006). Matches the Cadence cost posture; honest security-questionnaire answer.
12. **Time model: discrete scenario-time jumps + suspension only.** Directors can jump scenario time ("it is now D+3, 0800") and suspend overnight; continuous clock compression (2× speed) is explicitly out of scope. (COR-050…053)
13. **Leak protection: banners at launch, in-content watermarks fast-follow.** Compliance chrome (COR-031) is the launch mechanism; an in-content "EXERCISE" watermark for high-risk content classes (weather warnings, alerts, news articles, media) follows as default-on; chrome-off + watermark-off simultaneously is never allowed. (NFR-008)

## 4. Epic map

| # | Epic | One-liner | File |
|---|---|---|---|
| E1 | Platform Core & Exercise Isolation | Tenancy, personas, auth, roles, compliance chrome — the foundation everything sits on | `01-platform-core-isolation.md` |
| E2 | Social Network | The Tweeder replacement: posts, threads, amplification, trending, search, DMs, notifications | `02-social-network.md` |
| E3 | Exercise Portal | The participant's front door: branded landing page aggregating all channels + alert bar | `03-exercise-portal.md` |
| E4 | News Network | Simulated news outlets: articles, permalinks, breaking news, embedded Beat media | `04-news-network.md` |
| E5 | Press Room | PIO-authored press releases with embargo/scheduling — the participant's publishing surface | `05-press-room.md` |
| E6 | Weather Source | Authoritative simulated weather service with forecasts, alerts, and warning products | `06-weather-source.md` |
| E7 | Controller Command Surface | Post-as-persona, inject queue, escalation dials, live monitoring — the hidden engine | `07-controller-command-surface.md` |
| E8 | Adaptive Content Engine | Generated public reaction to participant action and inaction — the differentiator | `08-adaptive-content-engine.md` |
| E9 | Ecosystem Integration | Cadence inject firing into Pulse channels; Beat media pipeline; telemetry out | `09-ecosystem-integration.md` |
| E10 | Evaluation & AAR | Everything observable is measurable: timelines, sentiment, response metrics, replay | `10-evaluation-aar.md` |

### Dependency shape

```
E1 (foundation)
 ├─▶ E2 Social ──┬─▶ E8 Adaptive Engine
 ├─▶ E4 News ────┤
 ├─▶ E5 Press    │
 ├─▶ E6 Weather  │
 └─▶ E3 Portal (aggregates E2/E4/E5/E6)
E7 Controller Surface (operates E2/E4/E5/E6, gates E8)
E9 Integration (touches all; hard dependency for Cadence-driven exercises)
E10 Evaluation (consumes telemetry from all)
```

### Phasing (revised 2026-07-09 — engine-first strategy)

Product decision: the adaptive engine is the anticipated most-used capability and the competitive differentiator. Rather than completing Looking Glass parity first, the engine starts maturing as soon as the social network stands, so it gets maximum polish time and every early exercise feeds its tuning.

- **Phase 1 — Social core:** E1, E2, E7 (persona operation, native inject queue, review-queue and escalation-dial foundations, minimal monitoring). Telemetry capture (XC-004) from day one.
- **Phase 2 — Adaptive engine v1:** E8 on the social channel — storylines, silence escalation, response reaction, ambient chatter, amplification; Suggest + Delayed-auto autonomy levels. Contradiction reaction, rumor objects, and Auto mode follow as v1.1 once v1 is stable. **Pilot exercises run here: Social + engine is a viable social-media-focused exercise offering before full parity.**

  **Pilot mode (Phases 1–2, pre-portal) is explicitly defined:** participant login lands on the Social feed (the Portal is Phase 3); official *social posts* are qualifying responses for storyline expectations (the Press Room doesn't exist yet); high-priority alerts deliver via platform notifications (SOC-072) until the cross-channel alert bar (PRT-010) lands; the exercise clock is native to E1 (COR-050) from day one — it never waits for Cadence integration.
- **Phase 3 — Looking Glass parity channels:** E3 Portal, E4 News, E5 Press Room, E6 Weather — with engine hooks extended to news/press reactions as each channel lands.
- **Phase 4 — Ecosystem & evaluation depth:** E9 (Cadence fire-into-Pulse, Beat pipeline), E10 full (timeline UI, replay, metrics — computed over telemetry captured since Phase 1), E8 maturity (Auto mode hardening, misinformation depth).

Consequences of engine-first: the E8 cost/latency spike and persona voice-profile quality (COR-020) become near-term priorities, not future concerns; E7's review queue ships in Phase 1 rather than as a later hook. Phasing is a recommendation; epics are written so stories can be cut independently.

## 5. Cross-cutting requirements (apply to every epic)

| ID | Requirement |
|---|---|
| XC-001 | All participant-visible surfaces are scoped to a single exercise; no data from another exercise is ever renderable, searchable, or inferable from a participant session. |
| XC-002 | No participant-facing surface exposes the concept of "exercise selection," simulation status, or platform administration. Controllers/evaluators/admins get elevated surfaces participants cannot reach. |
| XC-003 | Compliance chrome (classification banner, "FOR EXERCISE PURPOSES ONLY") is configurable per exercise (on/off, text, colors) and renders as environment chrome consistently across all channels. |
| XC-004 | Every participant- or persona-generated event (post, reply, reaction, article view, press release, DM, login) is captured with wall-clock timestamp, exercise-scenario timestamp, actor (including the human behind a shared org account, COR-018), and channel — feeding E10. **The telemetry event schema (v0) is a named early-Phase-1 design deliverable** — E10 metrics, E9's event stream (INT-031), and E8 observation all consume it; a schema mistake becomes a cross-phase migration. |
| XC-005 | All simulated-world content is attributable to a persona; all personas belong to exactly one exercise instance (persona *templates* are reusable across exercises). |
| XC-006 | Controllers can act as any persona in their exercise from any channel's controller surface (E7 defines the UX). |
| XC-007 | Responsive web, desktop-first for PIO/controller monitoring, fully usable on mobile for citizen-role participants and evaluators. |
| XC-008 | All times display in the exercise's configured time zone; the platform tracks UTC internally. |
| XC-009 | Media (images, video, audio) is supported wherever content is authored or injected; video plays inline (no standalone video site at launch). |
| XC-010 | Soft delete everywhere; nothing is hard-deleted during a live exercise (audit and AAR integrity). |

## 5b. Non-functional & compliance requirements

Added 2026-07-09 following adversarial review (see `11-ADVERSARIAL-REVIEW.md`). These are procurement-gating and architecture-shaping; story agents treat them as cross-cutting acceptance criteria.

| ID | Requirement |
|---|---|
| NFR-001 | **Accessibility:** WCAG 2.1 AA conformance on all participant and evaluator surfaces; VPAT available at launch; live-region semantics specified for real-time feeds; severity/alert states never conveyed by color alone; controller console fully keyboard-operable. Section 508 conformance is a pass/fail procurement gate for the customer base. |
| NFR-002 | **Scale (sized from real exercise shapes: ~12 agencies + ~40 SimCell operators + 100–200 read-only consumers = large functional):** support 300 concurrent sessions nominal / 500 ceiling per exercise; ~50 concurrently active posting users; sustained burst of 60 posts/min with 120 posts/min peaks for ≥10 min; p95 feed delivery <2s at nominal load; notification storms aggregate rather than degrade (SOC-071). A load rehearsal is an item on the go-live readiness dashboard (COR-042). |
| NFR-003 | **Availability & degraded modes (exercises are one-shot events):** 99.9% availability during scheduled conduct windows; RPO ≤1 min / RTO ≤15 min during conduct; defined failure behavior for — Cadence fires but Pulse unreachable (retry + dead-letter + controller alert, INT-004), clock-subscription loss (holdover on last-known state + alert), LLM provider outage or latency spike (engine auto-falls back to Suggest/manual, controller notified), SignalR degradation (feeds fall back to polling). A stated venue-connectivity floor is published for site planners. |
| NFR-004 | **Content security:** upload malware scanning, MIME/type validation, size caps; HTML sanitization on all rich-text paths (incl. paste-from-Word, PRS-002); PDF rendering sandboxed; strict CSP. Stored-XSS attempts are part of the standing isolation test suite (COR-007) — a script in a post must never execute in another session. |
| NFR-005 | **LLM data governance:** generation (E8) uses tenant-bounded endpoints (e.g., Azure OpenAI within the Dynamis/customer tenant) under contractual no-training-on-customer-data terms; data residency documented. Engine-first phasing makes this a Phase 2 requirement, not a future concern. |
| NFR-006 | **Hosting posture:** commercial Azure at launch; documented Azure Gov / StateRAMP roadmap and data-handling policy available for security questionnaires. (Decision 11.) |
| NFR-007 | **PII & records:** participant data minimization; org-configurable retention with documented defaults and a purge-on-request path; DM visibility (SOC-062) and draft-history capture (PRS-004) disclosed via product-supplied exercise ground-rules boilerplate; telemetry about named government employees treated as records (FOIA/retention-schedule aware). |
| NFR-008 | **Leak protection:** launch = compliance chrome banners (COR-031). Fast-follow = in-content "EXERCISE" watermark rendered into high-risk content classes (weather warning products, platform alerts, news article pages, and media derivatives), default-on once available; disabling requires org-admin risk acknowledgment; chrome and watermark may never both be off. |
| NFR-009 | **Abuse resistance:** posting endpoints rate-limited per account; shared read-only credential (COR-015) has lifecycle controls — rotation, immediate revocation, brute-force lockout, per-IP rate limiting. |

## 6. Technical context (informative, not prescriptive)

Story agents should assume alignment with the existing Dynamis stack unless an epic states otherwise: React + TypeScript + Vite frontend (MUI + FontAwesome, COBRA styling system), .NET / ASP.NET Core backend on Azure, Azure SQL + EF Core, SignalR for real-time, Azure Static Web Apps / App Service hosting. Real-time fan-out (feeds, notifications, trending) and multi-tenant query filtering follow patterns already proven in Cadence. Keep cost posture consistent with the Cadence philosophy (modest Azure infrastructure).

## 7. Glossary

| Term | Meaning |
|---|---|
| **Persona** | A simulated account (citizen, outlet, agency, influencer) operated by controllers and/or automation |
| **Participant** | A trainee (PIO, EM staff) using Pulse as themselves via an assigned account |
| **Inject** | A scenario stimulus; in Pulse, content that lands in a channel (post, article, alert, press item) — mirrors Cadence's inject model |
| **Fire** | Deliver an inject (HSEEP verb, consistent with Cadence) |
| **Channel** | A simulated destination: Social, News, Press Room, Weather, Portal |
| **Compliance chrome** | Configurable exercise/classification banners rendered outside the simulated apps' frame |
| **Cast** | The set of personas seeded into an exercise |
| **Exercise instance** | One isolated exercise world on the shared platform |

## 8. Open questions (tracked, not blocking)

1. Feed algorithm as teaching mechanic — chronological at launch; engagement-weighted mode specced in E2 as a stretch feature.
2. ~~Identity ownership~~ **Resolved:** hybrid model — see scope decision 6.
3. ~~Naming inside the simulation~~ **Resolved** (knockout-screened 2026-07-09; formal trademark clearance still required before customer-facing use): social app = **Pulse** (product name, in-fiction too); portal = templated **"[City] Today"**; TV outlet = **Newsline 7**; paper = **The Courier-Ledger**; wire = **The National Wire**; tabloid = **The Scoop**; press room = **The Wire Room**; weather = **The Weather Desk**. All remain theme-configurable per exercise; these are shipping defaults. Rejected on screen: Chatter (Salesforce), PressWire (crowded industry), StormCenter (KUBRA), The Daily Blast (The Blast/Daily Blast Live), Warble/Murmur (crowded), The Beacon (diluted).
4. Standalone video platform and Lookbook-style second social — deferred; candidate Phase 4 epics.
5. Misinformation depth (coordinated campaigns, manipulated media) — baseline mechanics in E8; advanced scenarios need SME input.
