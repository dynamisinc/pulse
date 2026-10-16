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
   lifecycle writes, and EndEx does not stop realtime content. See A4.
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
| **P0** | #377 / #481 / #61 | Settings, chrome, practice-mode and **lifecycle** writes check only "assigned staff", never the role, so **an evaluator can rewrite the world or POST EndEx**. | `LifecycleEndpoints.cs:57-58` uses `EngineCockpitStaffAuthorizationFilter`. The fix already exists in the codebase: `EngineCockpitControllerRoleFilter`, used by the engine, inject, pin, moderation and noise routes. |
| **P0** | #375 | EndEx does not stop content reaching connected participants. `/hubs/exercise` is not lifecycle-gated, and `ReactionLoopHost` never checks lifecycle. | `ExerciseLifecycleGatingMiddleware.cs:31` names the hub as a "known RISK". |
| P1 | #379 | Participants can still post during Freeze or a pause. | No check in `PostIngestService` or `PostWriteEndpoints`. PR #558 confirms it. |
| P1 | #376 / #180 | Participants see the **internal** exercise name, and so do printed cards and emails. DF-22 rename makes this more visible. | `ExerciseScopeDto.cs:67`, `LinkCardService.cs:271` |
| P1 | #480 | No forwarded headers, so every rate limiter sees the App Service front end's IP. **A 100-person StartEx can trip the login limits.** | `Program.cs:388-396` |
| P1 | #490 | The DataProtection key ring is unencrypted, with no Key Vault. | `EasyLoginFoundationExtensions.cs:68` |
| P2 | #485, #389, #390, #393 | no-store missing on 4 auth routes; refused attribution is not audited; lifecycle changes are not pushed; staff auth validates the body before identity. | see the audit |

**Demo impact:** low. Staff at the demo are trusted, and the demo does not use EndEx or the
evaluator surface. **Do not fix these before the code freeze.** They are Wave 1.

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
**Fix it in Wave 0 by making close-out part of the PR gate** (C4, rule 6).

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

# Part B · Roadmap (post-demo, from Wed 10/21)

## B1. Calendar to the demo (for context)

| Day | |
|---|---|
| Fri 10/16 | Merge the 5 PRs (A6). Docs fold: WAVE-4 rows into `feature.md`, DF-24..42 decisions into `implementation.md`. |
| Sat 10/17 | Morning: load test (PDF-03a). Afternoon: Rehearsal 1. |
| Sun 10/18 | UAT walk, steps 1–16. **Code freeze in the evening.** |
| Mon 10/19 | Final reset, seed, Rehearsal 2. |
| **Tue 10/20** | **Demo.** Capture feedback into #523 the same day. |

## B2. Waves

Order rule: **close the trust gaps first, then what the customer marked Must, then the rest.**
Each wave is a normal feature orchestration
([`FEATURE_ORCHESTRATION_PLAYBOOK.md`](FEATURE_ORCHESTRATION_PLAYBOOK.md)).

| Wave | Theme | Scope | Size | Why now |
|---|---|---|---|---|
| **0** | **Truth** (1 day, docs plus GitHub, no product code) | Execute the tracker audit. Refresh `BUILD_PLAN.md`, `README.md` and `CLAUDE.md` (no longer a "scaffold"). Fold the demo feedback into #523. Add tracker close-out to the PR gate. Re-label the open security issues with phase, feature and status. | S | Every later session plans from the tracker. Today it lies. |
| **1** | **Trust hardening** (feature `security-hardening`) | #377 + #481 + #61 controller-role gate on config and lifecycle writes (reuse `EngineCockpitControllerRoleFilter`, plus a role-matrix test per route). #375 lifecycle-gate the hub and the reaction loop. #379 refuse participant writes during Freeze or pause. #376 + #180 a participant-facing exercise name. #480 forwarded headers. #490 Key Vault for the key ring. #485 no-store. #389 audit refused attribution. #390 push lifecycle changes. Guard the evaluator `DEV` strip, and hide the evaluator route in production until B-wave 5. | M (one migration at most: the display-name field) | P0s. Customers' security reviewers will find these first. |
| **2** | **Scale & resilience** (PDF-03 remainder, #526) | Fix what Saturday's load report finds. Decide on **Azure SignalR Service** and the App Service size from the report. #345 feed pagination and windowing. #455 idempotent post create. Persist the remaining engine state (storylines, autonomy). Azure alert rules. Backup site and switchover plan (Front Door or a warm second region). | M–L | The customer said "Stability!". This is the precondition for 100+ participants. |
| **3** | **Mobile** (PDF-01, #524: **Must**) | Participant app on iPhone, iPad and Android. Start responsive and installable (PWA), not native. Audit touch targets, the composer, the media viewer and the alert bar at 360 px. Then PDF-02 offline cache (#525) and PDF-08 camera (#531). | L | The only customer-flagged Must besides stability. Mobile-first is already in D0 §4 rule 6. |
| **4** | **Reporting & AAR** | #556 controller notes in the report (decide whether evaluators can write first), #555 Word (.docx) export with white-labeling (~2–3 days), PDF-07 implementer sheets (#530), PDF-09 server-side EXERCISE burn-in (#532). | M | The 10/15 internal demo said "pretty sells". Builds directly on #551. |
| **5** | **Evaluator on real data** (E10 slice) | Wire the evaluator dashboard to real telemetry: timeline (#231), response latency (#225), read-only staff access (#230). Remove the mocks from production paths. | L | It is designed but fake. A visible credibility gap the first time a customer clicks it. |
| **H** | **Help / User Guide** (parallel track, docs only) | See Part D. | S per guide | Needed before any customer runs an exercise without you in the room. |

**Parked, each needing a decision before it is built:**

- **PDF-04** Facebook-style channel: needs a design brief and an epic number.
- **PDF-05** NewsNow: Won't, unless demand is confirmed.
- **PDF-06** Cadence ↔ Pulse integration: E9, Phase 4.
- **E3–E6 channels** (portal, news, press, weather): need decomposing.
- **#349** live AI provider: waiting on the §8 governance signature.
- **PDF-10** GIF picker.
- DMs (#114–#116) and quote-post (#101).

> **My recommendation:** run **Wave 0 and Wave 1 in the first session** (Wave 0 is a half-day
> warm-up that also teaches the session the codebase), and start Wave 2 when the load report is in.
> Run Track H in a separate, lighter session in parallel, because it needs no code changes.

---

# Part C · Session runbook

## C0. Session setup

- Root Claude Code at the repo (`C:\Code\pulse` locally, or `/home/user/pulse` in the cloud) so the
  `.claude/agents` (`story-agent`, `frontend-agent`, `backend-agent`, `testing-agent`,
  `code-review`) are native. Use Opus at high effort.
- Start from the latest `origin/main` **after the five PRs merge**. Confirm with
  `git log --oneline -5` that #551, #553 and #558 are in.
- **GitHub GraphQL is blocked from cloud sessions.** `gh issue view` and sub-issue linking fail.
  Use REST (`gh api repos/dynamisinc/pulse/issues/N`, `POST …/issues/{n}/sub_issues`) or the GitHub MCP tools.
- Issue numbering continues from **#559**.

## C1. Read first (in order)

1. **This brief**, then [`TRACKER-AUDIT-2026-10-16.md`](TRACKER-AUDIT-2026-10-16.md).
2. [`CLAUDE.md`](../CLAUDE.md) and [`design/D0-FOUNDATIONS.md`](design/D0-FOUNDATIONS.md): the two worlds and the non-negotiables.
3. [`FEATURE_ORCHESTRATION_PLAYBOOK.md`](FEATURE_ORCHESTRATION_PLAYBOOK.md) and
   [`ORCHESTRATION_MECHANICS.md`](ORCHESTRATION_MECHANICS.md): the wave mechanics (§6 has paste-in kickoff prompts).
4. [`GITHUB_TRACKER.md`](GITHUB_TRACKER.md): labels and the Epic → Feature → Story hierarchy.
5. For Wave 1, the identity code and the existing role filter:
   - `src/Pulse.WebApi/Features/EngineRuntime/EngineCockpitStaffAuthorizationFilter.cs`
   - `EngineCockpitControllerRoleFilter`
   - `Features/ExerciseConfiguration/*Endpoints.cs`
   - `ExerciseLifecycleGatingMiddleware.cs`
   - `Features/Identity/` (session auth)
   - `docs/features/identity-auth-roles/` (stories 11–14: how #359 was closed; use it as the template)
6. [`OPERATE.md`](OPERATE.md): the deploy order and the rollback rules, before any migration.
7. `docs/features/post-demo-feedback/feature.md`: the customer's PDF-01..10 with Tom's triage.

## C2. Wave 0: Truth (execute)

1. **Tracker:** work the audit's tables in order A → B → D → C. For each close, put the evidence
   (commit sha or PR) in the closing comment and set `state_reason`. Re-verify before closing,
   especially the A-list engine stories (#352–#354, #401, #402, #173): their only gap is a recorded
   UAT check, so ask Tom whether that check was done.
2. **Parents:** create a `post-demo-hardening` feature issue. Move #514, #521, #522, #554, #462,
   #461, #456, #451, #448, #446 and #445 under it. Then close #496, #465 and #419.
3. **Labels:** give every category-E issue a phase, feature and status label, starting with the
   security set (#375–#379, #390, #393, #480, #481, #490).
4. **Docs:**
   - Rewrite `BUILD_PLAN.md`'s status section.
   - Update the README and CLAUDE.md: say the backend exists (`Pulse.Core`, `Pulse.WebApi`, `tools/`); set Status to "Phase 1 built; post-demo".
   - Set the Wave 4 story files to Complete once the UAT walk passes.
   - Refresh the stale `feature.md` tables listed in the audit.
5. **Process fix:** add a "Tracker close-out" checkbox to the PR template, or to the
   playbook's Gate-2 list: story status flipped, issue closed or relabelled, `feature.md` row updated.
   Optional: a small GitHub Action that comments on a merged PR when a `Closes #N` issue still carries `status:in-review`.

**Done when:** open issues are about 150; every open issue has phase, feature and status labels;
`BUILD_PLAN.md` matches reality; the PR in C4 is merged.

## C3. Wave 1: Trust hardening (decompose, then build)

1. Have `story-agent` create `docs/features/security-hardening/` from the Wave 1 row of B2. Suggested cut:
   - **01** Controller-role gate on config and lifecycle writes (#377, #481, #61), with a
     **route × role matrix test**: every non-GET `/api/staff/*` route is listed with its allowed
     roles, and a new route fails the test until it is classified (like DF-22's method+path allow-list).
   - **02** EndEx and Freeze stop everything (#375, #379, #390): the hub gate, the reaction-loop
     lifecycle check, write refusal during Freeze or pause, and a lifecycle push to clients.
   - **03** Participant-facing exercise name (#180 decision, then #376), across the scope DTO, cards and email.
   - **04** Edge and secrets hardening (#480 forwarded headers plus per-room limits; #490 Key Vault
     with a Bicep change; #485 no-store).
   - **05** Audit and evaluator hygiene (#389 refused-attribution telemetry; the evaluator `DEV`
     strip behind `import.meta.env.DEV`; the evaluator route hidden in production until Wave 5).
2. **Tom signs off (Tier-2):** the role matrix, the participant-facing name decision, and the Key
   Vault infra change. **Ask for these up front** so the builders aren't blocked.
3. Build per the playbook: one worktree per story, builder → `testing-agent` → Gate-1
   `code-review` (no Critical or High) → serial real merges → Gate-2 → PR → Copilot.

## C4. Non-negotiables

- **Two worlds:** COBRA on staff surfaces only; never on participant paths.
- **Exercise isolation is always Critical:** `IExerciseScoped` plus the central filter. Every new
  route gets a foreign-exercise test.
- **Scenario time only** on participant surfaces (COR-053).
- **Severity is never colour-only;** WCAG 2.1 AA (NFR-001).
- **FontAwesome only;** MUI 9 system props go in `sx`.
- **One migration per wave;** hand-written SQL wrapped in `EXEC`; Tom signs off schema, isolation and security changes.
- **Copilot review on every PR,** requested when the PR opens and again after substantial pushes.
- **Tracker close-out is part of done.** A merged PR whose issues still say `in-review` is not finished.

## C5. Deliverables

- Wave 0: a docs-only PR (tracker-truth commit, BUILD_PLAN, README and CLAUDE.md refresh, PR-template close-out item), plus the GitHub changes themselves.
- Wave 1: `docs/features/security-hardening/` (feature, implementation, stories, mirrored issues) and the umbrella PR `feature/security-hardening` → main, CI green, Copilot folded.
- A short `docs/POST-DEMO-SESSION-SUMMARY.md` at the end, in the shape of `E8-SESSION-SUMMARY.md`: what shipped, decisions and trades, what's left.

## C6. The bar

Flag it, don't bury it. If something in this brief is wrong when you check it against the code,
say so and correct the brief.

## C7. Paste-in kickoff prompt

```text
Read docs/NEXT-WAVE-SESSION-BRIEF.md and docs/TRACKER-AUDIT-2026-10-16.md, then execute
Wave 0 (C2) and Wave 1 (C3). Start from latest origin/main and confirm PRs #551/#553/#558 are
merged. Before closing any issue, re-verify the audit row against main. Ask me up front for the
three Tier-2 sign-offs in C3.2. Request a Copilot review on every PR.
```

---

# Part D · Help / User Guide: a starting plan

## D1. What exists today

**There is no help system.** No guide, FAQ, glossary, onboarding tour or help entry point. The only
in-app help is `KeyboardHelp.tsx`, the run-sheet shortcut list, plus tooltips and helper text
scattered across about 30 files.

Raw material worth harvesting:

- [`demo/BASELINE-CHECKLIST.md`](demo/BASELINE-CHECKLIST.md): a step-by-step walk. The best seed for a controller quick start.
- [`demo/PARTICIPANT-FIRST-DEMO-PLAN.md`](demo/PARTICIPANT-FIRST-DEMO-PLAN.md): the demo beats, which read as an exercise script.
- [`demo/pack/README.md`](demo/pack/README.md): a worked example exercise (36-post opening feed, 15-item run sheet, MSEL).
- [`OPERATE.md`](OPERATE.md), `scripts/uat/README-seed.md`, `docs/features/login/06-uat-goLive-config-runbook.md`.
- The acceptance criteria in 288 story files, and the D1–D7 design briefs.

## D2. Shape: by role, docs-as-code

Use Markdown in the repo under `docs/guide/`, written by role, because each role does different work:

| Guide | Audience | Core content | Priority |
|---|---|---|---|
| **Getting started** | Everyone | What Pulse is, the two worlds, roles, glossary (inject, persona, run sheet, Freeze, tier, scenario time, white noise, lookalike account) | 1 |
| **Planner / Exercise admin** | Planners, org admins | Create, rename and archive an exercise. Settings and branding. Roster CSV, join links, QR cards, day word, email links. MSEL import. Practice mode. Pre-flight and reset. | 1 |
| **Controller** | Controllers | Console tour. Post as persona. Run sheet (fire, hold, mark fired). Live world, pins, takedown. White noise. Freeze and resume. AI review queue and autonomy. Report and export. | 1 |
| **Participant one-pager** | Players | Join by link or QR, sign in with the day word, what is fiction and what isn't, who to ask for help. **Printed or emailed, outside the app.** | 2 |
| **Evaluator** | Evaluators | **Hold until Wave 5.** Don't document mock data. | later |
| **Troubleshooting / FAQ** | Staff | Join failures, a frozen tab, restart recovery, reseeding | 2 |
| **Admin / Ops** | Dynamis staff | Draw from `OPERATE.md`. Stays internal. | 3 |

## D3. Delivery: three steps

1. **Markdown first** (Track H session): write the Getting started, Planner and Controller
   guides from the sources above, with screenshots.
2. **Automate the screenshots:** a Playwright script (Chromium is in the cloud container) that
   walks the seeded demo exercise and writes PNGs into `docs/guide/img/`. Screenshots then stay
   current with one command instead of going stale like the 10/07 set.
3. **In-app help on staff surfaces only:** a "?" button in the COBRA staff shell that opens a
   drawer rendering the matching guide page (bundled with Vite's `?raw` import plus a Markdown
   renderer), with each page keyed to the current route. **Never on participant surfaces:** help
   there breaks the fiction. Participant help lives on the join card and the one-pager.

## D4. Keep it current

Add a "User-guide impact" line to `docs/features/_template/story.md`. A story that changes a staff
workflow updates its guide page in the same PR, and `code-review` checks for it. This is the same
cure as for the stale tracker: docs-as-done, not docs-later.

## D5. Track H kickoff prompt

```text
Read docs/NEXT-WAVE-SESSION-BRIEF.md Part D. Create docs/guide/ with README.md (index plus
glossary), getting-started.md, planner-guide.md and controller-guide.md, sourced from
docs/demo/BASELINE-CHECKLIST.md, docs/demo/PARTICIPANT-FIRST-DEMO-PLAN.md, docs/demo/pack/,
and the story ACs in docs/features/. Write for a Cadence-trained EM controller, not a developer.
Then add a Playwright screenshot script against the mock-data dev server (npm run dev) that
captures each documented screen into docs/guide/img/. No product-code changes. Open one PR.
```
