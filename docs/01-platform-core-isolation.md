# E1 — Platform Core & Exercise Isolation

> **Epic ID:** E1 · **Requirement prefix:** COR
> **Depends on:** nothing (foundation) · **Blocks:** all other epics
> **Roles served:** all roles
> **Master reference:** `00-MASTER-PRD.md` §5 cross-cutting requirements and §5b NFRs apply throughout.

## 1. Epic summary

The foundation layer: multi-exercise tenancy with absolute isolation, the persona and participant identity models, role-based access, per-exercise configuration, the exercise clock and scenario-time model, the build/go-live lifecycle, and compliance chrome. Every channel epic (E2–E6) builds on the entities and guarantees defined here. If E1 gets isolation wrong, nothing else matters — a participant seeing another exercise's content is the platform's worst possible failure.

## 2. Goals

- Many concurrent exercises on one platform; zero cross-exercise leakage into any participant surface.
- A persona model rich enough to populate a believable world and reusable enough to make exercise setup fast.
- Roles that mirror the exercise ecosystem: Participant, Controller, Evaluator, Planner/Admin (aligned with Cadence's ExerciseRole vocabulary where sensible).
- Compliance requirements (classification/exercise banners) met without breaking in-app immersion.
- A native exercise clock and scenario-time model that all subsystems consume from Phase 1.

## 3. Domain model

### 3.1 Core entities

| Entity | Description |
|---|---|
| `Organization` | Tenant boundary (customer). Owns exercises, persona templates, cast libraries. Mirrors Cadence's org concept. |
| `Exercise` | An isolated exercise instance: settings, time zone, schedule, compliance chrome config, channel enablement, lifecycle status (Build → Staged → Live → Paused → Completed → Archived, per COR-032). |
| `PersonaTemplate` | Org-library reusable persona definition: name, handle, avatar, bio, type, personality/voice notes, verification, audience magnitude band. |
| `Persona` | An instantiation of a template (or ad-hoc creation) inside one exercise. Carries exercise-scoped state: post history, follower counts, relationships. |
| `ParticipantAccount` | A human trainee's account inside one exercise: display identity, assigned role(s), channel permissions, org-account grants (COR-018). |
| `StaffAssignment` | Controller/Evaluator/Planner access to one or more exercises (elevated, cross-exercise capable, never participant-visible). |
| `Cast` | A named bundle of persona templates (e.g., "Mid-size US city baseline: 2 news outlets, 6 agencies, 40 citizens") for one-click seeding. |

### 3.2 Persona types (minimum set)

News outlet · Government/agency · Weather/scientific service · Ordinary citizen · Influencer/high-follower · Business/organization · Bad actor (troll, rumor-spreader). Type drives default profile styling, verification defaults, and E8 behavior profiles.

## 4. Features & requirements

### F1.1 Exercise isolation

| ID | Requirement |
|---|---|
| COR-001 | Every content and social-graph entity carries an `ExerciseId`; all queries on participant-facing paths filter by the session's exercise. Enforced centrally (query filter/interceptor), not per-endpoint. |
| COR-002 | Feeds, search, trending, notifications, suggested follows, DMs, profiles, and media URLs are exercise-scoped. Media URLs must be non-guessable and access-checked (a leaked URL from exercise A returns 403/404 in exercise B). |
| COR-003 | The same persona template may be instantiated in multiple concurrent exercises without collision (independent state per instance). |
| COR-004 | Participants have no UI concept of exercise selection: login lands directly in their exercise's landing surface (Portal in Phase 3+; Social feed in pilot mode, Master §4). An account belongs to exactly one exercise. |
| COR-005 | Staff (controller/evaluator) may hold assignments across multiple exercises with an explicit exercise switcher on staff surfaces only. |
| COR-006 | Completed/archived exercises are fully separable for AAR export and never contaminate live queries. |
| COR-007 | Isolation is covered by automated tests that attempt cross-exercise access on every participant-facing endpoint (a standing test suite, extended as endpoints are added; includes stored-XSS attempts per NFR-004). |
| COR-008 | **Per-exercise hostname:** each exercise gets its own subdomain (e.g., `atl-cie.{platform-domain}.com`), optionally a customer-branded domain (Looking Glass pattern: `cisatraining.lookingglassexercise.com`). The hostname scopes the participant session's exercise, is the participant's only entry point (pairs with COR-015 shared credential: URL + password is the entire onboarding), and no shared/marketing domain is ever participant-visible. Operationally: wildcard/automated certificate + DNS provisioning with a stated lead-time SLA. |
| COR-009 | **Network readiness (government-network reality):** novel subdomains are exactly what agency web filters, TLS-inspection proxies, and MDM block. Product ships: a participant-facing connectivity self-test page (reachable pre-exercise, checks WebSocket/SSE, media, and auth paths), a published allowlist/firewall specification for customer IT, and verification guidance for locked-down GFE devices. Network readiness is an item on the go-live readiness dashboard (COR-042). |

### F1.2 Identity, auth & roles

| ID | Requirement |
|---|---|
| COR-010 | Roles: **Participant** (trainee), **PIO** (participant flavor with monitoring defaults + Press Room authoring), **Controller**, **Evaluator** (read-everything, write-nothing in the sim), **Planner/ExerciseAdmin**, **OrgAdmin**. |
| COR-011 | **Named participant accounts** are exercise-provisioned (bulk import or planner-created) for *active* roles — anyone who posts, publishes, or DMs (PIOs, comms players). No self-registration on participant paths. Fake signup UI theater is omitted, normatively (phishing-pattern optics on a government training site). |
| COR-012 | Sessions are short-lived with refresh; a participant session is bound to one exercise and one account (or one read-only session per COR-015). |
| COR-013 | Evaluator role can see all channels and all controller activity but cannot post, react, or DM. |
| COR-014 | **Hybrid identity model (decided):** staff (controller/evaluator/planner) authenticate against the Dynamis identity provider directly in Phase 1; federation with Cadence sessions arrives with E9 (Phase 4). Active participants use Pulse-native named accounts; read-only access via COR-015. Identity provider stays behind an interface — Entra ID / AD / SSO integration is an anticipated future direction, not a launch requirement. |
| COR-015 | **Shared read-only access:** each exercise can enable a generic credential (exercise URL + shared password) granting a **view-only session** — full read access to all enabled channels, no posting, reacting, following, or DMs. Built for the "hundred passive participants" case; account management burden must be near zero. Read-only sessions get an ephemeral session identity so telemetry (XC-004) can still count views/reach without per-user provisioning. Default read-only landing/feed is All Posts (or the Portal once E3 lands) — never the Following feed, which is empty for accounts that cannot follow. |
| COR-016 | **Shared-credential lifecycle:** the shared password supports rotation (announce + grace window), immediate revocation (kills all read-only sessions), brute-force lockout, and per-IP rate limiting. It is an internet-facing shared secret on a public hostname and is treated as such. (NFR-009.) |
| COR-017 | **Participant admin panel (login-triage reality):** controllers (not just OrgAdmins) can reset passwords, unlock accounts, force-logout sessions, reassign roles/org affiliations mid-exercise, and diagnose "wrong account" situations — from the staff console, audit-logged. The first 30 minutes of every StartEx is login triage; it cannot require a support ticket. |
| COR-018 | **Organization-account operation:** participants can be granted operation of one or more org personas ("post as Fulton County EM") in exercise setup or live (staff action). Multiple humans may share one org account — every action behind a shared handle records the individual human in telemetry (per-human attribution is evaluation-critical; XC-004). Participant-facing account switcher in posting UIs (E2 SOC-006, E5 PRS-001). Full JIC workflow (concurrent-draft presence, shift handoff, in-team approval chains) is a Phase 3 feature; attribution and post-as-org ship in Phase 1. *Flagged for SME validation: confirm JIC operating patterns with practitioners before Phase 3 design.* |

### F1.3 Persona management & cast libraries

| ID | Requirement |
|---|---|
| COR-020 | Planners can create, edit, clone, and archive persona templates with: name, handle, avatar, bio, persona type, verification flag, audience magnitude band (SOC-054), voice/personality notes (drives E8 and controller ghost-writing), and optional backstory. Voice-profile quality is Phase-1-critical: the engine (Phase 2) is only as believable as these notes. |
| COR-021 | Planners can assemble templates into named Casts and seed an exercise with a cast in one action; seeding instantiates personas with believable derived state (varied follower counts, join dates predating the exercise). |
| COR-022 | Personas can be created mid-exercise by controllers in ≤60 seconds (name, handle, type, avatar pick) — supports E7's "spin up personas in response to unexpected participant behavior." |
| COR-023 | Optional pre-exercise post history: planners can author or generate "background noise" posts backdated before StartEx so profiles don't look born yesterday. Backdated content renders under the scenario-time rule (COR-053). |
| COR-024 | Avatar library: bundled, rights-cleared avatar/profile image sets by persona type, plus upload. (Beat integration for generated avatars lands in E9.) |

### F1.4 Exercise configuration

| ID | Requirement |
|---|---|
| COR-030 | Per-exercise settings: name (internal), participant-visible world name/locale, time zone (single zone per exercise — known constraint, open question 4), schedule, enabled channels (Social/News/Press/Weather), theming (portal branding, outlet names), compliance chrome config. |
| COR-031 | Compliance chrome: configurable top/bottom banners (text, e.g., "UNCLASSIFIED // FOR EXERCISE PURPOSES ONLY"; colors) rendered as persistent environment chrome outside the simulated app frame, consistently on every channel. Can be disabled per exercise — but never simultaneously with in-content watermarks off (NFR-008). |
| COR-032 | Exercise lifecycle: **Build → Staged → Live → Paused → Completed (EndEx) → Archived.** Build: staff-only content development. Staged: participant access is open and the ambient world is running, but the scenario has not started — supports pre-StartEx familiarization days. Live: StartEx has occurred; the exercise clock runs and scenario content fires. Participants can access Staged and Live only; Paused shows a configurable holding page (in-fiction or out-of-fiction, CTL-023). |
| COR-033 | A "practice/sandbox" flag lets staff run rehearsals whose data is excluded from evaluation exports. |

### F1.5 Exercise build & go-live

The planning/development cycle is a first-class phase, not just "before." A typical exercise involves weeks of content development — personas, background world texture, scheduled scenario content, channel theming — before any participant logs in.

| ID | Requirement |
|---|---|
| COR-040 | **Build workspace:** during Build, planners and controllers author everything the world needs — personas/casts (F1.3), backdated post history (COR-023), portal filler (PRT-030), held scenario content (CTL-013), the weather timeline (WX-002), outlet branding, and theming — using the same composers used during conduct, with all content in a staff-only unpublished state. |
| COR-041 | **Preview-as-participant:** at any point during Build/Staged, staff can open a full participant-perspective preview of the world as it will appear at a chosen moment (at platform-open, at StartEx) — the design-review tool for the fiction. |
| COR-042 | **Readiness dashboard:** a go-live checklist aggregating world completeness — personas seeded, channels themed, scheduled content counts by channel, participant accounts provisioned, shared credential set, hostname active + network readiness verified (COR-009), compliance chrome configured, load rehearsal done (NFR-002) — with per-item status. |
| COR-043 | **Go-live is a deliberate, gated action** (Exercise Director authority): Build → Staged opens participant access to the ambient world; **StartEx** (Staged → Live) is a separate explicit action that starts the exercise clock (COR-050) and begins scenario content delivery. The two moments are distinct because real exercises open the platform for familiarization before the scenario begins. **Staged behavior per subsystem:** clock not started; ambient/filler content and backdated history visible; scheduled scenario content held; E8 dormant (or ambient-chatter-only if enabled); weather shows the timeline's pre-StartEx state. |
| COR-044 | Content created during Build is versioned/locked at go-live consistent with any linked Cadence MSEL approval state (INT-003); post-lock changes during conduct are controller actions (E7), audit-logged. |
| COR-045 | Exercises are duplicable: clone an exercise's world (cast, theming, filler, scheduled content, config — not participant data or conduct history) as the starting point for the next exercise. The build investment compounds. |

### F1.6 Exercise clock & scenario-time model

**Pulse owns a native exercise clock from Phase 1** — it is not an E9/Cadence dependency. E8's inaction timers (Phase 2), scheduled content, the weather timeline, and StartEx all consume it. When a Cadence exercise is linked (Phase 4), Cadence's clock becomes the provider behind the same interface (INT-010/011).

| ID | Requirement |
|---|---|
| COR-050 | **Native exercise clock:** per-exercise scenario clock with StartEx, pause/resume, and current scenario datetime (supports `ScenarioDay` semantics compatible with Cadence's 1–99 model). All subsystems consume the clock through one interface; providers (native / Cadence-linked) are swappable. |
| COR-051 | **Discrete time jumps:** a Director-level action advances scenario time ("it is now D+3, 0800"). On a jump, each subsystem has defined behavior: scheduled content in the skipped span is presented to the controller as a batch disposition (fire-as-backfill with backdated scenario timestamps / skip / re-schedule); E8 storyline timers re-evaluate in scenario time (a blown window is blown, but jump-induced expiries queue as controller-confirmable rather than auto-firing en masse); the weather timeline (WX-002) snaps to the new scenario time; feeds render backfilled content in correct scenario order. **Continuous clock compression (e.g., 2× speed) is explicitly out of scope** (Master decision 12). |
| COR-052 | **Suspension & module advancement:** the clock supports overnight suspension (multi-day exercises: world freezes, optionally with a planner-authored "overnight backfill" bundle firing at resume) and **module-based advancement for TTX** — the facilitator steps through named modules, each jumping scenario time and releasing that module's content (pairs with the TTX display mode, PRT-040). |
| COR-053 | **Scenario time is the participant-visible time.** All in-fiction surfaces (post timestamps, "2h ago" relative times, article datelines, weather products, portal dateline) render in scenario time in the exercise's time zone. Wall-clock time is captured in telemetry (XC-004) but never shown inside the fiction. Backdated content (COR-023) and post-jump backfills render consistently under this rule. |
| COR-054 | **EndEx:** Completing an exercise presents participants a configurable EndEx state (out-of-fiction thank-you/hotwash-instructions page); shared credentials expire per policy (immediate or +N hours for hotwash); the world remains accessible **read-only** to staff and (optionally, facilitated) participants for hotwash — "go find the post I mean" is a real hotwash need. Replay and core metrics are available ≤15 min after EndEx (EVL-033). |

### F1.7 Staff navigation & exercise lifecycle administration

Added 2026-08-01, filed from a backlog audit (`docs/features/staff-navigation/`,
`docs/features/exercise-lifecycle-admin/`) that found two structural holes: no staff
surface-switching model exists anywhere in the design corpus (`RoleAwareEntry` sends each staff
role to exactly one hardcoded surface — no deep links, no navigation element — for the ~40 staff
surfaces planned across E1/E4/E5/E6/E7/E8/E10), and "create an exercise" has no requirement ID
anywhere (the only creation language is the un-IDed UX narrative in §5 below; `COR-045` exercise
duplication presupposes a create path that has never had a requirement or a story). These IDs are
filed here, in the epic, rather than continuing the un-backfilled `COR-060`–`COR-066` pattern
(coined directly in the D7 design session and never back-filed — see Open question 5).

| ID | Requirement |
|---|---|
| COR-070 | **Staff route tree & surface registry:** staff surfaces are real, deep-linkable routes (bookmarkable, back/forward-safe) — not a single role-keyed hand-off rendered by one catch-all route with no path of its own. A staff surface registry is the extensibility seam every new staff surface (console, evaluator, planner, org admin, and future E4–E6/E8/E10 staff tooling) registers into: adding a surface is a registry entry, not a route-table rewrite. The **participant catch-all (COR-004) is unchanged** — participants keep exactly zero addressable route table, only their one resolved landing surface. |
| COR-071 | **Surface launcher:** staff reach the registry's surfaces from a single, role-gated launcher anchored to the staff header's brand lockup (`PULSE` / surface name) — grouped by function, keyboard-operable (NFR-001). This is the only new staff-chrome element; it does not add a nav rail (would contest the shell's three-element ownership, `SHELL-CONTRACT.md` §1) and does not add a second toolstrip tenant (the toolstrip is for consult-on-demand flyouts, D7-011/D5-017) — it reuses the header element D7-010 already folded the old exercise bar into. |
| COR-072 | **Deep-linked configuration sections:** a staff surface's internal sections (e.g. the planner's exercise-settings sections) are URL-addressable, so a reload or a shared link returns the caller to the section they were on rather than always the surface's default section. |
| COR-073 | **Live exercise-context refresh on switch:** when a staff member switches active exercise (COR-005), every mounted consumer of the exercise scope — not only the React-Query-backed data that already invalidates correctly — reflects the newly active exercise without a full page reload or an incidental remount. |
| COR-074 | **Exercise creation:** a Planner or OrgAdmin can create a new exercise from a staff surface — not the ops-only bootstrap seam (`POST /api/ops/bootstrap-exercise`), which is explicitly documented as unreachable in a real customer-facing deployment. Creation allocates a hostname (COR-008), sets the initial lifecycle state to `Build` (COR-032), auto-assigns the creator a `StaffAssignment`, and records the exercise's owning organization. |
| COR-075 | **Exercise list & management:** staff with an organization-scoped role see and manage the set of exercises their organization owns (never a global, cross-organization list) — the surface a Planner/OrgAdmin lands on before using COR-074's create action or COR-045's duplicate action. |
| COR-076 | **OrgAdmin surface family:** OrgAdmin (COR-010) is its own surface family — neither the participant world nor the existing staff console/evaluator/planner surfaces — for organization-scoped administration (exercise list/management, staff assignment across the organization's exercises). Distinct from a persona "posting as an organization" (COR-018), which is in-fiction content attribution, not platform administration. |
| COR-077 | **Org-level authentication (no exercise scope):** an OrgAdmin (COR-010) can authenticate and hold a live session scoped to their organization with **no bound exercise** — resolved from organization membership alone, for an organization that owns zero exercises and therefore has no per-exercise `StaffAssignment` to grant the role through. A session with no exercise scope must fail closed on every exercise-scoped read/write (never widen the filter to "every exercise") and must reach only the org-tier surfaces explicitly gated for it (COR-076). Filed 2026-08-02 from a backlog audit of the OrgAdmin surface family (`docs/features/exercise-lifecycle-admin/03-orgadmin-surface-family.md`'s "Known gaps"): the role whose own job includes creating an organization's first exercise (COR-074) cannot itself sign in under today's login funnel until one exists — chicken-and-egg. Provisioning the very first OrgAdmin of a brand-new organization in a real (non-seeded) production deployment is a related, still-open gap this requirement does not itself close (see `docs/features/identity-auth-roles/15-org-level-authentication.md`). |

**Dependency note:** COR-074/075/076 depend on the `Organization` tenant tier (§3.1's `Organization`
entity; tracked at `docs/features/exercise-isolation/11-organization-tenant-boundary.md`). That
story's own text defers the tier to a wave "gated on multi-customer go-live" — **superseded for
this work**: the tier is being pulled forward now as a hard prerequisite for exercise creation,
exercise management, and the OrgAdmin surface family, and is being built in parallel to this
backlog. Read `exercise-isolation/11`'s own file for its current status rather than assuming
"Deferred" still holds.

## 5. User experience

**Participant first login.** A participant receives a URL and credentials from exercise staff. They log in on a clean, brandable login page (no Dynamis branding by default, no exercise pick list) and land in their exercise's world. The only reminder they're in an exercise is the compliance banner — thin, at the very top/bottom edge of the viewport, visually separate from the simulated apps, exactly like Looking Glass's green UNCLASSIFIED bars. Everything inside the frame is the fiction.

**Planner setting up an exercise.** From the staff console: create exercise → configure world (name, locale, time zone, channels, banners) → seed a cast from the library → adjust/add personas → provision participants (CSV import mirrors Cadence's bulk import UX) → open to Staged for familiarization → StartEx to Live (COR-043). Target: a planner who has done it once can stand up a new exercise world in under an hour using library content.

**Controller switching exercises.** A controller running two simultaneous exercises sees an explicit context switcher in the staff console header — deliberate, obvious, impossible to confuse with a participant view (staff surfaces use a distinct visual scheme, e.g., dark chrome).

## 6. Out of scope for this epic

Channel functionality (E2–E6), posting as personas (E7), automated persona behavior (E8), Cadence identity federation implementation (Phase 4, E9).

## 7. Open questions

1. ~~Identity federation~~ **Resolved:** hybrid model per COR-014/COR-015 (federated staff, named active participants, shared read-only credential; Entra/SSO future).
2. ~~Realism theater on login/signup~~ **Resolved (adversarial review C9):** omit at launch, normatively — fake sign-up buttons are a phishing-pattern optic on a government training site (COR-011).
3. ~~Persona handle uniqueness: per-exercise only (recommended) or org-global?~~ **Resolved: per-exercise
   only** (the recommended option). Enforced in the database by `IX_Personas_ExerciseId_Handle` — a unique
   index on `(ExerciseId, Handle)`, case-insensitive under the `SQL_Latin1_General_CP1_CI_AS` collation, so
   `mvega_fh` and `MVega_FH` collide within one exercise while two *different* exercises may each run a
   `@FulcoEM`. Org-global was rejected: it would make a second exercise's cast unseedable from the shared
   library and would leak one exercise's naming into another's world, against COR-001. See
   `docs/features/backend-host/03-persona-handle-uniqueness.md`.
4. Multi-time-zone exercises (statewide/hurricane with mutual-aid players across zones): single exercise time zone (XC-008) is a known constraint, accepted for launch; revisit with multi-region demand. (Review A13.)
5. **Tracked cleanup, not a blocker:** `COR-060`–`COR-066` were coined directly in the D7 design
   session (`docs/design/D7-application-shells/`) and shipped in `docs/features/participant-shell/`
   and `docs/features/staff-shell/` without ever being back-filed into this epic document — unlike
   `COR-070`–`COR-076` (F1.7), which file new IDs here first per the recommended practice. Back-fill
   `COR-060`–`COR-066` into a future-F1 subsection once picked up; their content is stable and
   shipped, so this is a documentation debt, not a renumbering — do not renumber them.
