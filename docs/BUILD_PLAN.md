# Build Plan — live plan

> **The single source a fresh session opens to find "what's next."** Refreshed 2026-10-06. The previous
> wave-by-wave Phase-1 log (every wave in it has shipped) is in git history:
> `git show cb5f25b:docs/BUILD_PLAN.md`. *How* to run a wave (branches, worktrees, Workflow fan-out,
> gates, kickoff prompt) is in [`ORCHESTRATION_MECHANICS.md`](ORCHESTRATION_MECHANICS.md).
>
> **Legend:** ⬜ not started · 🔧 in progress · ✅ done. Counts come from the story files on `main`,
> cross-checked against the code, PRs and UAT on 2026-10-06. All participant surfaces: per-brand skin,
> **no COBRA**, scenario-time only, mobile-first, WCAG AA. Staff: COBRA, desktop-first.

---

## Where we are (2026-10-06)

- **Idle since 2026-08-03.** The last merge was #411 (staff navigation + Organization tier + exercise
  creation backend). No commits on any branch between then and this refresh.
- **✅ UAT was broken 2026-08-03 → 2026-10-06; fixed by #413.** #411's `OrganizationTenantBoundary`
  migration never applied: in the deploy's idempotent script its hand-written SQL failed to compile
  (`Msg 207`), and `sqlcmd` ran without `-b`, so the step still reported success. Every exercise-scoped
  read, including the sign-in pages' exercise lookup, returned 500 while `/health` and `/health/ready`
  stayed green. #413 is merged and deployed: the migration is applied (verified in the database) and
  the reset script's `-CheckOnly` reports `READY`. #413's own deploy run shows red only because its
  new smoke test gave up during the post-deploy handover window; #414 widens it.
- **Phase 2 (E8) is further along than Phase 1 (E1/E2/E7)** — the engine-first order the master PRD
  recommends ("pilot exercises run on Social + engine").
- **The bottleneck is verification, not code.** 27 stories are built, reviewed and on `main` but not
  Complete, because their DoD is *verified in UAT* or a Tier-2 sign-off — see
  [Verification debt](#verification-debt).
- **The engine runs on the `Fake` provider in UAT.** Live AI is gated on the unsigned
  [`PROVIDER-GOVERNANCE.md` §8](features/engine-runtime/PROVIDER-GOVERNANCE.md).

| Epic | Phase | Complete | Built, not Complete | Not started |
|---|---|---|---|---|
| E1 Platform core & isolation | 1 | 35 / 73 | 15 | 23 |
| E2 Social network | 1 | 23 / 43 | 1 | 19 |
| E7 Controller command surface | 1 | 15 / 37 | 3 | 19 |
| E8 Adaptive content engine | 2 | 35 / 49 | 8 ¹ | 6 |
| E10 Evaluation & AAR | 4 | 0 / 15 | — | 15 |
| E3–E6 channels, E9 integration | 3–4 | not decomposed into stories yet | | |

¹ Includes `reaction-loop/03` and `/04`, which were built as `engine-runtime/01` (#294).

---

## Demo — target ~2026-10-18 (proposed: confirm audience, date and storyline)

**Recommendation: demo what is already built — a live pilot exercise on the social channel, with the
adaptive engine reacting — and spend the 12 days on verification, live AI and hardening, not new
features.** Every beat below exists on `main`; most of it has never been run end to end in UAT on real
data.

### Proposed storyline (~20 min)

Uses the seeded exercise "Pulse UAT Pilot" and the storyline "Water main contamination fears"
(Fairhaven personas). Each beat needs a rehearsal to confirm it.

1. **Participant view.** A PIO signs in and lands on the Fairhaven feed: agency and citizen personas,
   verified marks, hashtags, threads, likes and reposts, the live "▲ N new posts" pill.
2. **Controller posts as a persona.** ⌘K → persona picker → post as @FairhavenWater. It appears in the
   participant feed live, with no controller provenance visible to the participant.
3. **The engine reacts to silence.** While the PIO stays quiet the storyline escalates and the engine
   drafts public reaction. Drafts land in the controller's review queue (Suggest) for approve, edit or
   veto.
4. **The engine reacts to a response.** The PIO posts an official statement; the engine drafts
   reactions to it.
5. **Steering.** The controller sets the escalation dial and actual intensity follows. Switching
   Suggest → Delayed-auto makes drafts count down — and auto-HOLD, never auto-send, on timeout.
6. **Freeze.** The controller freezes the world; the participant tab shows the holding page without a
   refresh; Resume continues from the same scenario minute.
7. **Usage panel.** AI calls and cost for the session (meaningful only with live AI).

### Critical path

Dates assume a demo on or near 2026-10-18; shift them if the date moves. 🧑 = a human gate (Tom).

| When | Step | Done when |
|---|---|---|
| Oct 6 ✅ | **0. Unbreak UAT.** #413 merged and deployed; the Organization tier is applied to UAT's data; `Reset-DemoState.ps1 -CheckOnly` ends `READY`. Still to do: 🧑 the full reset (restart + re-seed) before the walk. | ✅ `-CheckOnly` `READY` |
| Oct 7–8 | **1. Baseline UAT.** Walk [`demo/BASELINE-CHECKLIST.md`](demo/BASELINE-CHECKLIST.md) once on `Fake`: reset, then the storyline beats as participant and controller. File every break as an issue. | Every checklist row marked ✅ / ⚠️ / ❌ |
| Oct 7–8 | **2. Decide live AI.** 🧑 Recommended: yes — on `Fake` the content is canned and the engine, the differentiator, won't read as adaptive. **Pre-signing checks re-run 2026-10-06, all clean:** the Ambient deployment is still `gpt-5.4-mini` **2026-03-17**, the measured build, so no §6 re-run is needed. Evidence (i) holds: the API's managed identity has `Cognitive Services OpenAI User` on `aif-pulse-uat`, `disableLocalAuth` is true, and it runs in `centralus` on `DataZoneStandard`. Remaining: 🧑 **sign §8** → flip the three `uat.bicepparam` params in one reviewed commit → Deploy Infrastructure → reset. | The usage panel shows real calls |
| Oct 8–14 | **3. Fix what step 1 breaks.** Small PRs straight to `main` — no umbrellas this close to a demo. | The storyline runs clean |
| Oct 8–14 | **4. Pay down verification debt.** Run the UAT round trips [below](#verification-debt); flip each story to Complete with evidence (screenshots, telemetry rows) and close its issue. | #349–#354, #401, #402 closed |
| Oct 12–14 | **5. Harden the reset.** [`scripts/uat/Reset-DemoState.ps1`](../scripts/uat/Reset-DemoState.ps1) exists: health, schema, restart, re-seed, persona binding, wiring. Add whatever the opening-feed decision (Decision 4) needs: archiving old posts and/or scripted opening posts. | Reset → `READY` in under 5 min |
| Oct 14 | **Code freeze for the backend.** Every backend deploy restarts the App Service and drops the in-memory engine loop. Frontend-only fixes stay safe. | — |
| Oct 15–16 | **6. Two full rehearsals** 🧑 from a clean reset, timed, on the demo machine and network. | Two clean runs |
| Oct 17–18 | Buffer · demo | |

### Only if the critical path is green by Oct 12 (pick at most one)

- **`ambient-chatter/01`** (#168, E8) — background posting, so the feed feels alive between engine
  reactions. The biggest visual payoff for one story.
- **`amplification/02`** — reposts appear in followers' feeds ("X reposted"), finishing
  `amplification/01` AC1.
- **Exercise-creation UI** (`exercise-lifecycle-admin/01` frontend) — show setup as well as conduct.
  Needs the Organization-tier Tier-2 sign-off first; the riskiest of the three.

### Not in the demo

Inject queue (`inject-queue` is not started; PAUSE INJECTS ships disabled), live monitoring,
notifications, direct messages, the E3–E6 channels, E10 evaluation, org-level sign-in (COR-077).

### Decisions needed 🧑

1. Audience, date and storyline — confirm or change the proposal above.
2. Live AI for the demo — sign §8 (step 2) or demo on `Fake`.
3. Whether to show exercise creation (needs the Organization-tier Tier-2 sign-off plus a frontend story).
4. ✅ **Cleared 2026-10-06 at Tom's request:** 4,821 July posts archived and 51 stale drafts vetoed, by
   [`scripts/uat/Clear-DemoContent.ps1`](../scripts/uat/Clear-DemoContent.ps1) (undo manifest kept). Still
   open: what the demo opens on, now that the feed starts empty. The background on the decision:
   **What the participant feed opens on.** It opened on the 4,815 engine posts from July's runs
   (Jul 24–29): the same water storyline, but at peak panic, dated July, while a fresh run starts at
   scenario minute 0. New posts do sort above them, because scenario time tracks the wall clock.
   Recommended: before the baseline, archive the old posts by setting `DeletedAt`, which is reversible
   (one timestamp marks the batch). The feed, Following feed and threads already skip archived posts;
   check hashtag and profile views on the walk. Then choose the opening content: a few scripted persona
   posts at minute 0, or let the engine fill the feed on its own. **The review queue has the same
   problem:** it opens with 51 pending July drafts (all as @mvega_fh, in `EngineReviewItems`).
   "Batch approve" would publish them, so they need clearing too.

### Baseline findings so far (2026-10-06)

- ✅ **UAT outage** — fixed by #413.
- ✅ **A seed straight after a restart is silently lost.** The old instance served for ~6 minutes, took
  the seed, then handed over to a new, empty one ("No live storyline" in the console). The reset script
  no longer restarts by default; `-Restart` now stops and tells you to re-run ~8 minutes later.
- ⚠️ **The engine writes as any castable persona, including one bound to a participant.** All the citizen
  personas are castable, so a participant on @mvega_fh would see the engine posting under their own
  name. Workaround: bind the PIO to **@FulcoEM**, the account the storyline's silence test expects.
  The engine is citizens-first and has never published as FulcoEM, and the controller can veto any draft
  that does. Real fix, a small backend story: drop participant-bound personas from the engine cast at
  seed time.
- 🔧 **Beat 4 couldn't work: the live engine never saw participant posts. Fixed in #416** (story
  `engine-runtime/06`, #415); it needs merge, deploy and a UAT check. `ReactionLoopHost.cs:419` called
  `ObserveStage.Observe(..., addressing: [], ...)` on every tick, so no official post ever reached
  response matching. The silence escalation ran on whatever the PIO said. On 2026-10-07, @FulcoEM's
  "Water is contaminated, do not drink" was followed one second later by another `inaction-timer`
  burst. `response-reaction/01–03` (#163–#165) were marked Complete, but they existed only as unit-tested
  `Pulse.Core` logic (`ResponseMatcher`, `MissSafeResolver`, `ResponseReactionBehavior`): an unwired seam.
  - **What #416 does:** participant posts reach the loop through the ingest funnel. A match resets the
    silence clock, bends intensity down, turns the storyline **Addressed** and queues a 3-voice response
    burst (mostly gratitude and follow-up questions, one skeptic) instead of a silence burst. An
    unconfirmed or unmatched post slows the escalation but never pauses it.
  - **The demo needs `Reset-DemoState.ps1 -AutoConfirmResponses`.** There is no controller-confirm button
    yet, so without the opt-in a matching post only slows the escalation. The script reports what the
    server applied.
  - **Matching is keyword-based.** `#WaterIssues` in the post scores 0.9; otherwise it's word overlap with
    "official statement from Fulton County Emergency Management addressing the water safety concern",
    against a 0.3 threshold. The post above scored ~0.08, so even after #416 it would only slow the
    escalation. **Script the PIO's beat-4 post to carry `#WaterIssues`.**
  - **Merging #416 is a backend deploy:** do it before the Oct 14 freeze, then re-seed ~8 minutes later.
- ⚠️ **On a wide screen the participant feed is a narrow, left-aligned column** with a blank right side.
  Mobile-first is right, but on a laptop or projector it reads unfinished. Polish candidate.

---

## Verification debt

Built, reviewed and on `main`, but not Complete. Most need one observed round trip in UAT.

| Story | Issue | What closes it |
|---|---|---|
| `world-steering/07` pause, server-authoritative | #350 | Freeze visibly stops the loop (no new review items or `engine.*` events while frozen); Resume restarts from the same scenario minute (COR-050) |
| `world-steering/08` pause, participant overlay | #351 | A participant tab shows the holding page with no refresh, in the controller's register, and clears on Resume; a refresh mid-Freeze still holds it |
| `world-steering/09` escalation dial, live | #352 | A dial target moves actual intensity over later ticks (the storyline must be Escalating or Peak) |
| `autonomy-safety/05` engine settings API | #353 | Suggest → Delayed-auto makes a live burst count down instead of queuing |
| `autonomy-safety/06` engine settings panel | #354 | The console Engine flyout shows and sets the above, with correct labels |
| `engine-runtime/05` live-provider go-live | #349 | A live AI round trip in UAT — after §8 |
| `engine-runtime/06` official responses reach the loop | #415 | After #416 deploys and a `-AutoConfirmResponses` reset: a PIO post with `#WaterIssues` turns the storyline Addressed and queues a 3-voice response burst |
| `autonomy-safety/07` cut to `Fake` | #402 | The console lever cuts a *live* provider to `Fake` — after §8 |
| `engine-telemetry-tuning/03` AI usage panel | #401 | The panel turns "0 calls, $0" into real numbers — after §8 |
| `engine-telemetry-tuning/01` engine event types | #173 | Close-out pass: the taxonomy was ratified as built in #403/#405 |
| `exercise-configuration/01–04` | #41 | Close-out pass: their status text predates #374's merge (it still says the umbrella has not merged) |
| `staff-navigation/01–04`, `exercise-isolation/11`, `exercise-lifecycle-admin/01–03` | — | 🧑 **Tier-2 sign-off** on the Organization tier (customer-isolation boundary, backfill against live UAT data), then UAT. The exercise creation and list **frontend is not built** |
| `identity-auth-roles/01`, `persona-management/01–02` | #58, #53, #54 | Data and model seeded; the staff UIs were deferred |
| `amplification/01` repost & quote | #101 | AC1 ("X reposted" in the audience's feed) moves to `amplification/02` |

---

## UAT operating notes

These look like bugs otherwise.

- **Hosts.** Site: `https://pulse-uat.cobrasoftware.com` (Static Web App). API:
  `https://app-pulse-api-uat-dynamis.azurewebsites.net`. The exercise resolves from the **API's** Host
  header, so seed and bootstrap against the API host, not the custom domain — see the
  [`login/06` runbook](features/login/06-uat-goLive-config-runbook.md).
- **Every backend deploy or App Service restart drops the engine.** Loop registration, storylines,
  autonomy and the clock live in process memory (there is no `Storyline` entity). Run
  `pwsh scripts/uat/Reset-DemoState.ps1`, which restarts the API, re-seeds via
  `POST /api/ops/seed-engine-content` and checks the result. It reads the bootstrap secret through your
  `az` login and never prints it; `-CheckOnly` is read-only and needs no secret. A re-seed resets the
  storyline to scenario minute 0. Frontend-only deploys don't restart the API.
- **Freeze outside a running world is refused (409 with a reason)** by design: in `staged` it would start
  a clock COR-032 forbids.
- **#390:** a tab that received a Freeze while `live` and never reconnects can stay on the holding page
  after EndEx. A refresh heals it.
- **UAT runs as `Production`,** so the dev org-admin seeder is off. Mint the first org admin with
  `POST /api/ops/bootstrap-exercise` and staff role `orgAdmin` (stored exactly as camelCase; the
  username must be in the configured allowlist).
- **An org with zero exercises can't have an org admin sign in** — COR-077 /
  `identity-auth-roles/15`, not started.
- **The Organization tier is live in UAT** (applied 2026-10-06 by #413). One "Default Organization" holds
  the exercise and the staff user; the `THROW 50011` pre-flight passed.
- **For several minutes after a backend deploy or a restart, the old process keeps serving.**
  - After a deploy it runs on top of DLLs the deploy has overwritten. It returns `BadImageFormatException`
    500s with garbled method names, yet still passes `/health`. The red #413 deploy run was this window,
    fixed by #414.
  - After a restart, the handover took ~6 minutes on 2026-10-07, and anything seeded on the old process was
    lost. Seed only once the new instance is serving (see the reset script's `-Restart`).
  - Run-from-package would remove the deploy case; that's a post-demo infra change.
- **`/health` and `/health/ready` don't prove the schema.** Both stayed green for two months while every
  exercise-scoped read 500'd. `GET /api/exercise-context` (anonymous) is the quick schema check; the
  reset script and, after #413, the deploy smoke test both use it.
- **The autonomy default is `suggest`** (set 2026-07-29), so drafts queue for approval. That's correct.
- **Live AI** means three `uat.bicepparam` params (`generationProviderLive`, `generationTenantBounded`,
  `generationNoTrainingAttested`) flipped together in one commit, only after §8 is signed. Ambient for
  the first live run uses a temporary alias (`Generation:Tiers:Standard:Model` → the mini model);
  remove it once the runtime tier lever is used.
- **PAUSE INJECTS ships disabled** — there is no inject queue.

---

## What's shipped (all on `main`)

| Area | Epic | PRs |
|---|---|---|
| Foundation seams — exercise context, scenario time, telemetry v0 | E1 / XC-004 | #212 |
| Participant shell — mount contract, compliance chrome, alert bar, channel nav, overlays, variants, brand theming | E1 (D7) | #215, #217, #239, #250 |
| Staff shell — COBRA frame, header, toolstrip, participant-admin flyout, preview-as-participant | E7 (D7) | #243 |
| Social — PostCard + provenance, feed, composer, threads, likes, reposts/quotes (partial), hashtags, real-time pill, profiles, verification, follow graph, Following feed | E2 | #240, #252, #295, #301, #372, #397 (+ #395, #408, #409) |
| Social API — feed/thread read, post write, SignalR hub, personas, participant-shell config endpoints | E2 | #280, #338, #347, #348 |
| Controller console — post-as-persona, engine review cockpit (auto-HOLD, swamped mode), world steering (dial + tiered pause, then live), engine settings | E7 / E8 | #260, #276, #282, #385, #386, #399 |
| Backend host — EF Core, isolation filter, telemetry sink, persona-handle uniqueness | E1 | #277, #357, #360 |
| Identity — sessions, role-aware nav, participant and staff login, persona binding, API auth (default-deny gate, server-side attribution, anonymous-access suite) | E1 | #293, #310, #311, #313, #314, #316, #317, #319, #321, #364, #384, #388, #392, #394 |
| Exercise configuration, staff navigation, Organization tier, exercise creation (backend) | E1 | #374, #383, #411 |
| E8 engine cores — generation infra + governance gate, Claude-on-Foundry, storyline model, autonomy & safety, persona voice, reaction-loop cores, silence escalation + response reaction, eval gates | E8 | #248, #253, #254, #258, #261–#265 |
| E8 runtime — engine wired into the host, content seed, UAT engine fixes, live-provider staging (IaC only), cut-to-`Fake` lever, event taxonomy, AI usage panel | E8 | #294, #328, #336, #337, #387, #403, #405, #406 |
| Infra / CI — Bicep, deploy workflows, Azure SQL, App Service, SignalR, custom domain, cold-start and Entra-admin fixes | — | #198, #251, #278, #279, #281, #283, #299, #302, #331, #344, #358, #404 |

---

## Not started — the remaining backlog

| Epic | Not started (story numbers) |
|---|---|
| E1 | `exercise-build-golive` (all 6), `exercise-clock` 01–03 + 05, `exercise-isolation` 02/03/06/07/09, `identity-auth-roles` 04/08/09/15, `persona-management` 03–05, `exercise-configuration/05` |
| E2 | `direct-messages` (3), `notifications` (3), `posts` 04–06, `feeds-discovery` 03/05/06, `hashtags-trending` 02–03, `amplification` 02–03, `reactions/02`, `threads-replies/03`, `social-api/05` |
| E7 | `inject-queue` (5), `live-monitoring` (4), `console-shell` 02–05, `persona-operation` 04–05, `world-steering` 01/04/05/06 |
| E8 | `ambient-chatter/01`, `amplification-engine` 01–02, `engine-eval-harness` 03–04, `engine-telemetry-tuning/02`; stub features for v1.1 and later: `auto-mode`, `contradiction-reaction`, `rumor-model`, `expected-action-binding` |
| E10 | All four features (15 stories): timeline, metrics, evaluator tools, AAR export |
| E3–E6, E9 | Not yet decomposed into features and stories (Phases 3–4) |

---

## Doc debt

- **Corrected in this refresh:** `staff-navigation/04` (its Gate-2 Critical, CR-001, was fixed before #411
  merged, but the header still said "Blocked — do not merge"); `reaction-loop/03` and `/04` (built as
  `engine-runtime/01`, #294, per the feature's own table, but the headers still said Not Started).
- **Still stale:** `exercise-configuration/01–04` status text (see Verification debt). GitHub epic and
  feature issues lag the docs — epic #126 (E8) shows 2 of 17 features closed.
- **Housekeeping:** about 60 remote branches, most for merged PRs — prune when convenient.

## Lessons to keep in view

- **A green deploy is not an applied migration.** On 2026-08-03 the deploy's `sqlcmd` (no `-b`) printed 7
  SQL errors and "Successfully executed", and UAT then ran new code on the old schema for two months. Every
  migration test passed because `Migrate()` runs each operation alone, while the deploy runs each migration
  as one compiled batch. Hand-written SQL that names a column added in the same migration must be
  `EXEC(N'…')`-wrapped. `IdempotentMigrationScriptTests` now replays the real script (#413).
- **"Merged" is not "on `main`", and "on `main`" is not "works in UAT".** A reviewed fix once merged into
  an umbrella 30 seconds after that umbrella merged, and never reached `main` (#373, recovered as #397).
  A fully green slice once merged with its `Program.cs` wiring never executed, leaving the endpoint dead
  at 404 (#310 → #317). Check landedness against `origin/main`; grep the composition root after a merge.
- **The controller-features wave found nine Criticals of one class** — a surface asserting a state the
  server never applied — and no test suite caught any of them. Mutation-test every new guard (break it,
  watch it fail, restore it), and cross-check a run's collected file count against the files on disk
  (#391).
