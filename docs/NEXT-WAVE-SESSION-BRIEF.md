# Post-Demo · Next Wave · Dedicated Session Brief

> **Read this, then do it.** This is the kickoff brief for the first build session after the
> **10/20 customer demo**. Part A is a critical assessment of where Pulse stands on 2026-10-16.
> Part B is the roadmap. Part C is the session runbook, in the same shape as
> [`E8-SESSION-BRIEF.md`](E8-SESSION-BRIEF.md). Part D starts the Help / User Guide.
> The full issue-by-issue evidence is in [`TRACKER-AUDIT-2026-10-16.md`](TRACKER-AUDIT-2026-10-16.md).
>
> **Snapshot:** `main` @ `3753b7c`, 2026-10-16. Five PRs open (#551, #552, #553, #557, #558).
> **Before you act, re-verify anything this brief says is open or closed.**

---

# Part A · Critical assessment (2026-10-16)

## A1. The verdict

**Pulse is ready for a participant-first demo. It is not ready for an unattended customer exercise.**

The demo path is strong. It is one channel (the Pulse social app) driven from a capable controller
console, with good test coverage, green CI and an automated UAT deploy. The demo plan, the pre-flight
check (`Test-DemoReady`) and the one-shot reset (`Invoke-DemoReset`) are all merged.

These are the gaps between a demo and a paid exercise:

1. **Three server-side authorization holes.** Staff roles are not enforced on the configuration and
   lifecycle writes (any assigned staff member, including an evaluator, can make them), and EndEx does not stop realtime content. See A4.
2. **One channel out of eight.** Seven of the D0 brands (portal, Newsline 7, Courier-Ledger,
   National Wire, Scoop, Wire Room, Weather Desk) exist only as disabled nav entries.
3. **The evaluator dashboard shows canned data.** It makes no API calls, even in production builds,
   and it renders a `DEV — EXERCISE STATE` strip with no dev-only guard
   (`src/frontend/src/features/evaluator/pages/EvaluatorDashboardPage.tsx:37`).
   **Keep it out of the demo.**
4. **One instance, state in memory.** The engine's storylines and autonomy settings, the SignalR
   connections and the export lock all live in process memory. PR #558 persists only the pause tier
   and the clock. Saturday's load test will be the first evidence about 120 posts/min.
5. **The tracker is badly stale.** Of 266 open issues, **105 can close**. See A5.

## A2. What is real today

| Area | State |
|---|---|
| **Participant social app** | Feed, posts, replies and threads, likes and reposts, follows, profiles, image and video, pins, alert bar, freeze overlay. Real backend in production builds. Search, trending and notifications are computed in the browser. DMs and quote-post are not built. |
| **Controller console** (~83k LOC) | Post as persona, live world column, takedown, white noise, .xlsx export, media library, persona edit, run sheet (a manual queue; no timed auto-release), Cadence MSEL import, engine review, steering, Freeze, autonomy. |
| **Planner / admin** | Exercise settings, practice mode, account import, easy login (roster, links, QR cards, day word, email), Exercise Management. |
| **AI engine (E8)** | Fully wired, but UAT runs the **Fake** provider. Live generation (#349) is blocked until the PROVIDER-GOVERNANCE §8 sign-off. |
| **Evaluator dashboard** | Design-complete UI on mock data only. No backend. |
| **Other channels (E3–E6)** | Not decomposed into stories, not built. |
| **In the open PRs** | Edit own post, a restart-proof pause tier and clock (#558); Pinned marker, rename and archive, mark fired (#553); printable PDF report (#551, #552); load-test harness (#557). |

## A3. Engineering health

| Signal | Reading |
|---|---|
| Frontend | type-check and lint clean. Vitest **8,357 / 8,358** (one known flake: `MediaLibraryPicker.test.tsx` under parallel load). There are 830 React `act(...)` warnings in the run, which is noise worth cleaning. |
| Backend | About 3,500 tests, about 1,670 of them against real SQL. The last 8 CI runs on main are green (backend job ~19 min). |
| Size | WebApi 68.7k LOC, 101 mapped endpoints, 16 EF migrations. Frontend 105k LOC. Test code exceeds product code. |
| Debt | 43 source files over 600 lines (`EngineReviewService.cs` 1,851; `InjectQueueService.cs` 1,761). The prod AI SDK is a beta (`Azure.AI.OpenAI 2.9.0-beta.1`). xUnit is still v2 (#334). `npm run dev` always serves mocks. |
| Ops | **UAT is the only environment** and it doubles as the demo host. No staging or prod. No browser e2e tests. No Azure alert rules. No Key Vault. A merge touching both halves fires both deploys at once. |
| Docs truth | `README.md` and `CLAUDE.md` still describe a "scaffold" with no backend. `BUILD_PLAN.md` was last refreshed 10/06. On main, the Wave 4 story files say "Not Started". All 14 WebApi slices lack a README. |

## A4. Security and correctness: the tracker under-states these

The audit checked each one against the code on `main`. Only **#359** (participant API with no
session) is fixed. These remain open:

| Pri | # | Finding | Evidence |
|---|---|---|---|
| **P0** | #377 / #481 / #61 | Settings, chrome, practice-mode and **lifecycle** writes check only "assigned staff", never the role, so **an evaluator can rewrite the world or POST EndEx**. | `LifecycleEndpoints.cs:57-58` and `ExerciseSettingsEndpoints.cs:54-57` use `EngineCockpitStaffAuthorizationFilter` only. The fix is **per-route and per-transition**, not a blanket controller gate: `EngineCockpitControllerRoleFilter` rejects planners, but Exercise Settings is the planner's home surface (`staffRouteRegistry.tsx:85`, `allowedRoles: ['planner']`). Planners keep configuration writes; StartEx/EndEx need a controller; evaluators are refused every write. |
| **P0** | #375 | EndEx does not stop content reaching connected participants. `/hubs/exercise` is not lifecycle-gated, and `ReactionLoopHost` never checks lifecycle. | `ExerciseLifecycleGatingMiddleware.cs:31` names the hub as a "known RISK". |
| P1 | #379 | Participants can still post during Freeze or a pause. | No check in `PostIngestService` or `PostWriteEndpoints`. PR #558 confirms it. |
| P1 | #376 / #180 | Participants see the **internal** exercise name, and so do printed cards and emails. DF-22 rename makes this more visible. | `ExerciseScopeDto.cs:67`, `LinkCardService.cs:271` |
| P1 | #480 | No forwarded headers, so every rate limiter sees the App Service front end's IP. **A 100-person StartEx can trip the login limits.** | `Program.cs:388-396` |
| P1 | #490 | The DataProtection key ring is unencrypted, with no Key Vault. | `EasyLoginFoundationExtensions.cs:68` |
| P2 | #485, #389, #390, #393 | no-store missing on 4 auth routes; refused attribution is not audited; lifecycle changes are not pushed; staff auth validates the body before identity. | see the audit |

**Demo impact:** low. Staff at the demo are trusted, and the demo does not use EndEx or the
evaluator surface. **Do not fix these before the code freeze.** They are folded into Session A (C2), alongside the role and lifecycle screens they belong to.

## A5. Tracker truth

| Category | Count | Action |
|---|---|---|
| A. Close now (on main) | 78 | Close as completed, with the evidence commit in the closing comment |
| B. Close when the 5 PRs merge | 13 | Close after the merges |
| C. Relabel or retitle | 9 | e.g. #101 becomes "Quote-post"; #349 becomes `status:blocked` |
| D. Superseded or duplicate | 14 | Close as not planned or duplicate, naming the replacement |
| E. Genuinely open | 152 | 3 P0 · 11 P1 · 64 P2 · 74 P3 (36 of the P3s are epic or feature parents) |

The root cause is the process. Wave PRs merge, but nothing flips the story status or closes the
mirrored issue: step 7 of the orchestration playbook gets skipped under deadline pressure.
**Fix it by making close-out part of done** (C5).

> **Update, later on 10/16:** the cleanup has been run. 84 issues were closed, #559 was created as
> the post-demo hardening parent, and 182 issues are open. See
> [`TRACKER-CLEANUP-LOG-2026-10-16.md`](TRACKER-CLEANUP-LOG-2026-10-16.md). Still held:
> - six engine stories waiting on a recorded UAT check (#352–#354, #401, #402, #173);
> - #350 and #351, waiting on the DF-27 UAT run;
> - the issues that close when #553, #557 and #558 merge.

## A6. Open PRs: recommended merge order (this morning)

You expected three; there are five.

1. **#553** Wave 4 polish: clean, CI green, Copilot reviewed.
2. **#551** Printable report: clean. **It has no Copilot review yet**, which CLAUDE.md requires.
3. **#558** Wave 4 (stories 17–20, the wave's migration): wait for CI and Copilot. **It conflicts
   with #553 in `Program.cs`**, so merge `main` into it after step 1.
4. **#552** Report edits: it targets `feature/demo-feedback-w4` (the #558 branch), **not `main`**,
   and it depends on #551. Merge it into the w4 branch **before** #558, or retarget it to `main`
   after #558. No Copilot review yet.
5. **#557** Load-test harness: tools only, no product code. GitHub shows it "unstable" (a check is
   pending or failing). It is needed before Saturday's run.

**After the merges:** re-run `Test-DemoReady`, then reseed (**the seed must follow the last backend deploy**).

---

# Part B · Roadmap (agreed 10/16, post-demo from Wed 10/21)

## B1. Decisions from the 10/16 interview

| Topic | Decision |
|---|---|
| **Next target** | The next demo or pilot. There is no hard exercise date, so **build it right**. |
| **Administration** | **Org-admin self-service.** Dynamis creates only the organization and its first org admin; the customer does everything else. |
| **Identity model** | **One account per person.** A person can be staff on one exercise and a participant on another. |
| **Sign-in** | **One account, separate entry.** The same credentials enter either the staff console or a participant exercise, and a session lives in **one world at a time** (the two-worlds rule holds). |
| **Roles** | **Per exercise.** Planner, controller and evaluator are assigned per exercise; org admin is org-wide. |
| **Participants** | **Both:** an org-level directory of people who carry across exercises, **and** one-off participants added to a single exercise. |
| **Passwords** | All four flows: an admin resets a staff password; staff self-service "forgot password"; an admin reissues participant access (links and day word, as today); **participants can also have real passwords** that can be reset. |
| **Avatars** | Participants upload their own (in-fiction profile). Staff set participant avatars from the roster. Staff accounts have avatars. Persona avatars stay as they are. |
| **Exercise lifecycle** | Build → Staged (with a readiness checklist) → Live. Reopen or reset. Duplicate. Delete a Build-state exercise that never ran. |
| **Planner self-setup** | Create personas, assign staff with roles, set or rotate the view-only code, and seed content (opening feed, noise pool, media pack) **in the app** rather than through scripts. |
| **Security fixes** | **Folded into the administration work**, not a separate wave. |
| **Mobile** | Responsive web plus an installable **PWA** for participants. **The controller and evaluator also work on a tablet.** |
| **AI engine** | **Live with some autonomy** for the pilot: ambient chatter publishes on its own, key posts are still reviewed. **Tom signs PROVIDER-GOVERNANCE §8 now.** |
| **Evaluator first** | A live timeline on real data, live annotations, and the AAR export. |
| **First new channel** | The **local news portal** ("[City] Today"). |
| **Production** | **Multi-tenant SaaS** (several customer orgs on one deployment), with **monitoring and alerting**. |
| **User guide** | **Docs-as-done:** every story updates `docs/guide/` in the same PR. |
| **Sessions** | **Three in parallel:** A (administration), B (mobile and tablet), C (AI engine). |

## B2. Order

| # | Track | Session | Starts |
|---|---|---|---|
| 1+2 | **Administration:** people, roles, passwords, avatars, plus exercise management (lifecycle, duplicate, delete, personas, staffing, view-only code, content seeding), with the security fixes folded in | **A** | 10/21 |
| 3 | **Mobile and tablet:** participant PWA; controller and evaluator tablet layouts | **B** | 10/21 |
| 4 | **AI engine go-live:** live provider with some autonomy | **C** | 10/21; the provider flip waits on the §8 signature |
| 5 | **Evaluator dashboard on real data:** timeline, annotations, AAR export | after A | when A's role model lands |
| 6 | **Channel breadth:** the local news portal first | after B | needs E3/E4 decomposed against D2/D3 |
| 7 | **Production polish:** multi-tenant SaaS hardening, monitoring and alerting, Key Vault, staging, browser e2e | rolling | parts start inside A (tenancy) and C (alerts) |

**What can jump the queue:**
- Findings from Saturday's load test. If they are serious, they come first in whichever session owns the code.
- **#480 (forwarded headers) must land before any exercise with about 100 participants.** It rides along with Session A, story 1.

**Why this order:** items 1 and 2 are what stop a customer from running an exercise without Dynamis.
Writing the guide confirmed it. Each of these gaps had to be documented as "ask Dynamis support":
- moving an exercise out of Build
- creating staff accounts and roles
- changing the view-only code
- creating personas
- seeding content

---

# Part C · Session briefs

## C0. Shared setup (all three sessions)

- Root Claude Code at the repo so the `.claude/agents` are native. Use Opus at high effort.
- Start from the latest `origin/main` **after the five 10/16 PRs merge**. Check `git log --oneline -10`.
- **GitHub GraphQL is blocked from cloud sessions.** Use the GitHub MCP tools or `gh api` REST.
- **Read first, in order:**
  1. this brief
  2. [`CLAUDE.md`](../CLAUDE.md)
  3. [`design/D0-FOUNDATIONS.md`](design/D0-FOUNDATIONS.md)
  4. [`FEATURE_ORCHESTRATION_PLAYBOOK.md`](FEATURE_ORCHESTRATION_PLAYBOOK.md) and
     [`ORCHESTRATION_MECHANICS.md`](ORCHESTRATION_MECHANICS.md)
  5. [`GITHUB_TRACKER.md`](GITHUB_TRACKER.md)
  6. [`OPERATE.md`](OPERATE.md), before any migration or infra change
  7. [`guide/README.md`](guide/README.md)
- **Process per wave:**
  1. `story-agent` decomposes the work, or amends the existing stories.
  2. Each story gets its own worktree.
  3. builder → `testing-agent` → Gate-1 `code-review` (no Critical or High).
  4. The orchestrator merges the stories serially, with real merges, then runs Gate-2.
  5. Open the PR. Request a Copilot review as soon as it opens.
  6. Tom signs off any schema, isolation, security or infra change.
  7. After merge, close out the tracker (C5).

## C1. Rules that keep three sessions from colliding

1. **One migration owner at a time.** EF model snapshots from parallel branches conflict.
   - Session A owns the schema for the administration work.
   - Session C must avoid schema changes. If it needs one (for example, persisting engine state),
     it lands **after** A's foundation migration is on main, and it merges main in first.
   - Session B is frontend-only and needs no migration.
2. **The orchestrator-owned files are `Program.cs`, `App.tsx` and `staffRouteRegistry.tsx`.**
   Each session edits them only in a dedicated "wiring" commit at the end of its wave, after
   merging `main` in. Keep each change additive: one line per feature extension.
3. **Branches:**
   - Session A: `feature/admin-<slug>`
   - Session B: `feature/mobile-<slug>`
   - Session C: `feature/engine-golive-<slug>`

   Merge `main` into the active branch at the start of every work day and before opening a PR.
4. **Frozen contracts are announced.** When Session A changes a shared type (`PostView`, the
   session or role types, `ExerciseScopeDto`), it posts the change on its feature issue. Sessions B
   and C merge it before touching those types.
5. **B depends on A's role model for the tablet layouts.**
   - Session B builds the **participant** PWA first. It needs nothing from A.
   - It builds the **controller** tablet layout second, on the existing role guards.
   - It builds the **evaluator** tablet layout last, after A's per-exercise roles land and the
     dashboard has real data (track 5).

---

## C2. Session A · Administration (people, roles, exercises) + folded security

> **Goal:** a customer's org admin and planners can run the whole exercise lifecycle in the app,
> with no Dynamis support and no scripts.

**Start from these existing stories.** They are written but not started. **Amend them; don't rewrite them:**

| Folder | Stories | Notes |
|---|---|---|
| `docs/features/identity-auth-roles/` | 01 roles (In Progress), 04 evaluator read-only, 08 participant admin panel, 09 org account operation, 15 org-level authentication | 02, 03, 05–07 and 10–14 are Complete; reuse them. Read `ENDPOINT-AUTH-AUDIT.md` |
| `docs/features/exercise-build-golive/` | 01 build workspace, 03 readiness dashboard, 04 gated go-live StartEx, 05 content lock at go-live, 06 exercise duplication | 02 (preview) is largely delivered by staff-shell/04 and C6 |
| `docs/features/persona-management/` | 01 templates, 02 casts and seeding, 03 mid-exercise creation, 04 pre-exercise post history, 05 avatar library | 03 duplicates closed #18 |
| `docs/features/exercise-lifecycle-admin/` | 01–03 "Backend built" | Exercise Management UI; rename and archive arrive with #553 |
| `docs/features/easy-login/` | complete | Links, day word, cards and email: keep them working for participants |

**Phase A: design the identity model first. Don't decompose it straight into stories.**
Deliver `docs/design/ADMIN-IDENTITY-MODEL.md` and get Tom's sign-off before building. The hard problems:

1. **One account, two worlds.**
   - One person record (org-scoped) with credentials.
   - Per-exercise *enrollments*: an exercise plus a role (planner, controller, evaluator or participant), and for participants a persona binding.
   - Org admin is an org-level grant.
   - A session is minted **for one world and one exercise**. A staff session must never carry participant capabilities, and vice versa.
   - Participants' exercise is still resolved from the request host (`HostExerciseResolver`).
2. **Directory vs one-off participants.** How does a one-off participant differ from a directory
   person? Probably a person with an `ExerciseOnly` flag. How are they promoted into the directory?
   How is the easy-login roster (CSV, personal links) reconciled with directory people?
3. **Credentials:**
   - password hashing and policy;
   - staff "forgot password" and admin reset, using emailed one-time links through the existing
     Azure Communication Services path (`docs/features/easy-login/13-email-delivery.md`);
   - participant passwords alongside links and the day word: which sign-in methods are allowed
     for each exercise?
4. **Avatars:**
   - Participant self-upload goes through the existing media pipeline (sanitized, EXERCISE
     watermark rules) and is exercise-scoped: the in-fiction profile lives per exercise, not per
     person, because one person can play different personas.
   - Staff avatars live in the staff world only.
5. **Lifecycle:**
   - Build → Staged requires a readiness checklist (exercise-build-golive/03).
   - Staged → Live is StartEx (controller only).
   - Define reopen and reset precisely: what is kept and what is wiped.
   - Delete is allowed only for a Build-state exercise with no conduct data.
   - Duplicate copies settings, personas, run sheet and media, but never posts.
6. **Content seeding in the app.** Port what `scripts/uat` seed and pack loading do (opening feed,
   noise pool, media pack, run sheet) into a planner upload flow that runs through the public
   services. This reuses S1 seed-script logic; it does not touch the database directly.
7. **Multi-tenant from day one.** Every new route is org-scoped *and* exercise-scoped where
   relevant. Cross-org access returns the same bare 404 as a missing record (the DF-22 pattern).
   Use the method+path allow-list test.

**Phase B: stories.** Suggested cut, in waves:

| Wave | Stories |
|---|---|
| **A1 Foundation** (one migration) | People and enrollments schema; the frozen contract; the role model replaces the ad-hoc staff assignment. Also folds in **per-route and per-transition role checks** on config and lifecycle writes (#377, #481, #61): planners keep configuration writes (settings, chrome, practice mode); a controller is required for StartEx and EndEx (and for pause and Freeze, as today); evaluators are refused every write; who may stage and archive is an explicit decision to record (#481). Prove it with a **route × role matrix test**. Plus **#480** forwarded headers |
| **A2 People** | Org directory UI (org admin); staff invite and role assignment per exercise; admin password reset; staff forgot-password; participant passwords and reset; participant reissue (existing); staff and participant avatars |
| **A3 Exercise management** | Build workspace and readiness checklist; Staged → Live; reopen and reset; delete; duplicate; view-only code set and rotate; assign staff from the exercise |
| **A4 Setup content** | Create, clone and archive personas (templates and casts); persona avatar library; content seeding upload |
| **A5 Lifecycle correctness** | EndEx and Freeze stop everything: lifecycle-gate the hub and the reaction loop (#375); refuse participant writes during Freeze or pause (#379); push lifecycle changes to clients (#390). Participant-facing exercise name (#180 then #376). Audit refused attribution (#389). no-store on auth routes (#485) |

**Tier-2 sign-offs to ask Tom for up front:**
- the identity-model doc;
- the role matrix;
- the password policy;
- the participant-facing name;
- the reset semantics.

**Done when:** a new org admin, starting from an empty organization, can do all of these without Dynamis:
1. invite staff;
2. import participants;
3. create personas;
4. seed content;
5. stage, start and end the exercise;
6. duplicate it.

The planner and controller guides are updated to match, and every "ask Dynamis support" line in
`docs/guide/` that this work removes is gone.

---

## C3. Session B · Mobile and tablet

> **Goal:** participants play comfortably on phones and tablets (installable PWA). Controllers and
> evaluators can work from an iPad.

**Read:**
- `docs/design/D0-FOUNDATIONS.md` §4 (participant surfaces are mobile-first; staff are desktop-first, now **plus tablet**)
- `docs/design/D1-social-app.md`
- `docs/design/D7-application-shells/`
- `docs/features/post-demo-feedback/` (PDF-01 #524, PDF-02 #525, PDF-08 #531)

**Waves:**

| Wave | Scope |
|---|---|
| **B1 Participant on phones** (#524) | Audit every participant screen at 360, 390 and 768 px: feed, thread, composer, media viewer, profile, Explore, Pinned, holding page, join and sign-in. Fix the **alert bar on phones**: the text is truncated to about 3 characters, it covers the channel label, and its "Details →" link goes to a missing `/alerts` route (found 10/16; reproduce with `tools/guide-screenshots`, shot `participant-alert-bar`). Touch targets of at least 44 px. Keep burst legibility at 120 posts/min on a mid-range phone (NFR-002). |
| **B2 PWA** | Manifest per exercise brand (the name and icon must stay in the fiction: no "Pulse by Dynamis" leaking into a branded exercise). Service worker for the app shell only. **Offline cache and "missed while offline" (PDF-02 #525) is a follow-up**, unless it is cheap once the service worker exists. Install prompts on iOS and Android. |
| **B3 Controller on tablet** | The console at 1024×768 and 1180×820, in landscape and portrait. Collapse the columns into tabs or panes; check the keyboard shortcuts with an iPad keyboard and touch alternatives without one. Takedown and Freeze confirms must stay deliberate on touch. |
| **B4 Evaluator on tablet** | **After track 5** (real data) and A's role model. Until then, only prototype the layout. |
| **Later** | In-app camera (PDF-08 #531), which builds on the PWA. |

**Testing:**
- Add Playwright viewport tests for the participant critical path (join → feed → post → reply).
  These are the first browser e2e tests, and they count toward track 7.
- Extend `tools/guide-screenshots` with phone and tablet shots, and add them to the participant
  and controller guides.

**No migration.** Frontend only. The PWA manifest may need a small backend route for per-exercise
brand metadata. If it does, coordinate it under C1, rule 1.

---

## C4. Session C · AI engine go-live (live, with some autonomy)

> **Goal:** for the next pilot, the engine runs on the live provider. Ambient chatter publishes on
> its own under guardrails; story-critical posts still go through the review queue.

**Read:**
- [`E8-SESSION-SUMMARY.md`](E8-SESSION-SUMMARY.md)
- [`design/E8-ENGINE-ARCHITECTURE.md`](design/E8-ENGINE-ARCHITECTURE.md)
- `docs/08-adaptive-content-engine.md`
- [`features/engine-runtime/PROVIDER-GOVERNANCE.md`](features/engine-runtime/PROVIDER-GOVERNANCE.md)
- `docs/demo/AI-GOVERNANCE-BRIEF.md`
- `docs/features/{engine-runtime,autonomy-safety,ambient-chatter,engine-telemetry-tuning,engine-eval-harness}/`

**Step 0, before any code:** Tom signs PROVIDER-GOVERNANCE §8. Record the signature in the doc.
Only then:
- flip the three infra parameters in one commit (per the E8 summary);
- finish #349 (live provider on UAT, suggest-only first);
- close #402 and #401 with their UAT checks.

**Waves:**

| Wave | Scope |
|---|---|
| **C1 Live, suggest-only on UAT** | #349 to green; usage and cost panel (#401); the Fake cut-over lever (#402) proven as the egress kill switch; alert rules on the provider's errors, latency and spend (counts toward track 7). Latency and cost SLO measurement (#177). |
| **C2 Some autonomy** | Ambient background posting (#168) publishes autonomously **within a tier policy**: rate caps, topic and persona allow-lists, content safety, the kill switch, and Freeze/EndEx respected (depends on A5's lifecycle gate; until it lands, the engine must check lifecycle itself). Review stays mandatory for storyline and escalation posts. Engine settings API and panel (#353, #354) close out. |
| **C3 State that survives a restart** | Persist the engine's run state (storylines, autonomy settings, kill switch). Today it is in process memory and lost on every deploy. **Schema: wait for A1 on main** (C1, rule 1). |
| **C4 Quality** | Scenario reaction-correctness tests (#178); amplification (#166, #167) if time allows. |

**Non-negotiables:**
- Silence is never approval: a timed-out draft is held, never auto-sent.
- Every engine post is labelled as engine-sourced in telemetry and in the report.
- Participants never see a draft.
- The kill switch works within 5 s.
- Load the `claude-api` skill before any model, cost or latency reasoning.

---

## C5. Shared non-negotiables and definition of done

- **Two worlds:** COBRA on staff surfaces only; nothing breaks the fiction on participant paths.
  **One account never means one session across both worlds.**
- **Exercise and org isolation is always Critical:** `IExerciseScoped` plus the central filter.
  Every new route gets a foreign-exercise test and a foreign-org test.
- **Scenario time only** on participant surfaces (COR-053).
- **Severity is never colour-only;** WCAG 2.1 AA (NFR-001).
- **FontAwesome only;** MUI 9 system props go in `sx`.
- **One migration per wave,** with hand-written SQL wrapped in `EXEC`. Tom signs off schema,
  isolation, security and infra changes.
- **Copilot review on every PR.**
- **Done includes:**
  - the story status is flipped;
  - the mirrored issue is closed;
  - the `feature.md` row is updated;
  - **the `docs/guide/` page is updated** (the story template's user-guide line);
  - screenshots are re-captured if a documented screen changed.

## C6. Paste-in kickoff prompts

**Session A:**
```text
Read docs/NEXT-WAVE-SESSION-BRIEF.md (Parts B, C0, C1, C2, C5). You are Session A (administration).
Start from latest origin/main. Phase A first: write docs/design/ADMIN-IDENTITY-MODEL.md resolving
the 7 hard problems in C2, then stop and ask me for the Tier-2 sign-offs. After sign-off, have
story-agent amend the existing identity-auth-roles / exercise-build-golive / persona-management
stories and add new ones per the C2 wave cut, mirror to GitHub, and build wave A1. You own
migrations; follow C1 coordination rules. Request a Copilot review on every PR.
```

**Session B:**
```text
Read docs/NEXT-WAVE-SESSION-BRIEF.md (Parts B, C0, C1, C3, C5). You are Session B (mobile and
tablet). Start from latest origin/main. Have story-agent decompose waves B1-B3 under
docs/features/mobile-tablet/ (link #524), then build B1 first, starting with the alert-bar bug.
Frontend only, no migrations. Follow C1 coordination rules; merge main daily. Add Playwright
viewport tests for the participant critical path. Request a Copilot review on every PR.
```

**Session C:**
```text
Read docs/NEXT-WAVE-SESSION-BRIEF.md (Parts B, C0, C1, C4, C5). You are Session C (AI engine
go-live). Load the claude-api skill. Start from latest origin/main. Step 0: confirm with me that
PROVIDER-GOVERNANCE section 8 is signed; do not flip the provider before that. Then run waves C1
and C2. No schema changes until Session A's A1 migration is on main (C1 rule 1). Request a
Copilot review on every PR.
```

---

# Part D · Help / User Guide

## D1. Where it stands (10/16)

[`docs/guide/`](guide/README.md) exists:
- an index;
- Getting started;
- a glossary;
- the Planner, Controller and Participant guides (the participant guide is a printable one-pager);
- Troubleshooting;
- 26 screenshots.

The screenshots are captured from mock data by [`tools/guide-screenshots`](../tools/guide-screenshots/README.md)
(`npm run capture`). The story template now carries a user-guide line.

## D2. Still to do

- **Fill in the placeholders:** support, escalation and in-room help contacts, marked "to be confirmed".
- **Walk the guide on UAT once.** The labels were checked against code, but a few behaviours were inferred:
  - what players see after EndEx;
  - the fix for a player stuck on the holding page;
  - whether practice mode is respected by the exports.
- **Rewrite as each track lands:**
  - **Session A** removes most "ask Dynamis support" lines, and needs a new **Org admin guide** (people, roles, passwords).
  - **Session B** adds phone and tablet screenshots.
  - **Session C** updates the AI engine section.
  - **The Evaluator guide** gets written once track 5 has real data.
- **In-app help, staff surfaces only:**
  - a "?" drawer in the COBRA staff shell that renders the matching guide page for the current route;
  - a natural small story for Session A once its screens settle;
  - **never on participant surfaces.**

## C7. Optional: an orchestrator session over A, B and C

You can run the three sessions independently, using the C6 prompts, with Tom enforcing the C1
rules. **Recommended instead:** one light orchestrator session that coordinates and never builds.
Why:
- **The real risks are coordination risks:** migrations, the wiring files, and the A → B/C dependencies.
- **One owner enforces C1** instead of three sessions each trying to follow it.
- **Tom gets one queue of sign-off requests** instead of three sessions asking separately.

```text
You are the ORCHESTRATOR for Pulse's post-demo build (repo dynamisinc/pulse). You coordinate;
you do NOT write product code, open product PRs, or merge anything. Merging is Tom's.

Read first: docs/NEXT-WAVE-SESSION-BRIEF.md (all of Parts B and C, especially C1 coordination
rules and C6 kickoff prompts), CLAUDE.md, docs/FEATURE_ORCHESTRATION_PLAYBOOK.md.

1. Spawn three child sessions with create_session (same environment, repo dynamisinc/pulse,
   default branch), titled "Pulse A · Administration", "Pulse B · Mobile & tablet",
   "Pulse C · AI engine go-live", tag all "pulse-postdemo". Give each its C6 kickoff prompt
   verbatim plus: "An orchestrator session coordinates you. Before (a) adding an EF migration,
   (b) editing Program.cs / App.tsx / staffRouteRegistry.tsx, or (c) changing a frozen shared type,
   stop and state it clearly in your reply so the orchestrator can clear it." Do not use
   permission_mode "plan" for children.
   - Session C's first step is a human gate (PROVIDER-GOVERNANCE §8). Spawn it anyway; it does
     read-only prep until Tom confirms the signature.

2. Hold the coordination state in working notes and enforce C1:
   - MIGRATION TOKEN: exactly one session may have an unmerged migration. Session A holds it
     first (wave A1). Session C may not add schema until A1 is merged on main.
   - WIRING FILES: one session at a time; it must merge main first and keep the change additive.
   - FROZEN CONTRACTS: when A changes a shared type, tell B and C to merge main before touching it.
   - DEPENDENCIES: B's evaluator-tablet wave waits for A's role model + real evaluator data;
     C's C2 autonomy must self-check lifecycle until A5's lifecycle gate lands.

3. Cadence: check each child with get_session / list_events (kinds: assistant, result) about every
   45 minutes using send_later; do not busy-poll. On each check: note progress, blocked states,
   open PRs (CI status, Copilot review requested?), and any C1 rule about to be broken. Steer with
   send_message (priority "next") only when needed; interrupt_session only to stop a rule breach.

4. Human gates: collect every Tier-2 sign-off request and question from the children into ONE
   consolidated list for Tom (who, what decision, options, recommendation, what is blocked).
   Relay Tom's answers back verbatim to the right child. Never answer a sign-off yourself.

5. PRs: when a child opens a PR, check it requested a Copilot review and that tracker close-out
   (C5) is planned. Recommend a merge order to Tom when several are ready (migrations first, then
   wiring, then the rest). After each merge to main, tell the other children to merge main.

6. Every few hours (and when Tom asks), give Tom a short status: per session — wave, last
   milestone, open PR(s), blockers, next step; plus the pending sign-off list.

Start by confirming with Tom: (a) PRs #553, #558 and #560 are merged, (b) whether §8 is signed yet.
Then spawn the three sessions.
```
