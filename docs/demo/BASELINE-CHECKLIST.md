# UAT baseline checklist (demo prep)

> **Purpose.** Walk the proposed demo storyline ([`BUILD_PLAN.md` → Demo](../BUILD_PLAN.md)) once in UAT,
> on real data, and record what works and what breaks. Every break becomes an issue; every pass with
> evidence can close a story in [Verification debt](../BUILD_PLAN.md#verification-debt).
> Repeat it after fixes, and use it as the rehearsal script.

## Before you start

- **UAT is healthy again** (#413 merged and deployed 2026-10-06; `-CheckOnly` reports `READY`). If the
  reset ever stops at "Schema matches code", the last backend deploy's migration failed; check that
  run's migration step.
- **Decide the opening feed first** ([BUILD_PLAN → Decision 4](../BUILD_PLAN.md#decisions-needed-)).
  Without archiving, step 1.3 opens on July's 4,815 peak-phase posts.
- **Reset first:** `pwsh scripts/uat/Reset-DemoState.ps1`. It must end `READY`. It restarts the API, so
  refresh any tab opened before it ran. If the participant's composer is missing in step 1, re-run it with
  `-ParticipantUsername <participant> -PersonaHandle mvega_fh`.
- **Two fresh tabs:** participant and controller. Sessions live in per-tab storage, so two fresh tabs in
  one browser can hold different sessions, but a *duplicated* tab copies the session. A second monitor or a
  phone for the participant view makes the demo read better.
- **Accounts.** Never paste either secret into an agent session.
  - **Controller `controller1`:** `pwsh scripts/uat/Copy-StaffSecret.ps1 controller1` copies its secret
    to the clipboard without showing it.
  - **Participant:** `participant1`'s password is stored only as a hash and can't be recovered. Create a
    fresh login with `pwsh scripts/uat/New-DemoParticipant.ps1 -Username pio1 -DisplayName "PIO (demo)"`.
    It prompts for a password and binds the posting persona @mvega_fh (`-PersonaHandle` to change it).
- **URLs:** participant `https://pulse-uat.cobrasoftware.com/login` · controller
  `https://pulse-uat.cobrasoftware.com/staff/login`, then `/staff/console`.

**How to record:** ✅ works · ⚠️ works, with a problem worth fixing · ❌ broken. Note anything odd, with a
screenshot, in the results table at the end. Times are scenario time unless a step says otherwise.

---

## 0. Reset

| # | Do | Expect |
|---|---|---|
| 0.1 | Run the reset script | `READY`. Note the storyline title and the silence window it prints |

## 1. Participant view (demo beat 1)

| # | Do | Expect |
|---|---|---|
| 1.1 | Open the participant URL | The sign-in page renders in the exercise's brand, not the COBRA staff look |
| 1.2 | Sign in as the participant | Lands on the social feed |
| 1.3 | Look at the feed before touching anything | Posts with author names and handles; verified marks on agency accounts; timestamps in **scenario time**, never wall-clock. **Record what the opening state looks like**: UAT holds ~4,800 posts from July, and old posts may sort or date oddly against a storyline re-seeded at minute 0 |
| 1.4 | Open a thread; like a post; click a hashtag; open a profile | Each opens in-channel and back navigation works |
| 1.5 | Find the composer | Present (participant bound to a persona). Absent means no binding: see "Before you start" |

## 2. Controller posts as a persona (beat 2)

| # | Do | Expect |
|---|---|---|
| 2.1 | Sign in at the controller URL | COBRA staff look; lands on (or can reach) `/staff/console` |
| 2.2 | ⌘K (Ctrl+K) → persona picker → **@FairhavenWater** → write a post → Post | The post publishes from the console |
| 2.3 | Watch the participant tab | The post appears **without a refresh**, authored @FairhavenWater, with **no** controller or "SIMCELL" provenance visible |

## 3. The engine reacts to silence (beat 3)

| # | Do | Expect |
|---|---|---|
| 3.1 | Keep the participant silent past the silence window (default 3 scenario minutes) | The storyline escalates |
| 3.2 | Watch the console's review queue | Drafts arrive, each with persona and storyline context, plus an "N need review" indicator |
| 3.3 | Approve one, edit then approve one, veto one | Approved and edited drafts appear in the participant feed under their personas; the vetoed one never does |

## 4. The engine reacts to a response (beat 4)

| # | Do | Expect |
|---|---|---|
| 4.1 | As the participant, post an official statement | It appears in the feed |
| 4.2 | Watch the review queue for a few minutes | New drafts react to the statement, not just to the original incident |

## 5. Steering (beat 5) — closes #352, #353, #354

| # | Do | Expect |
|---|---|---|
| 5.1 | Note the dial's actual intensity and phase. Set a target clearly below it (or above it if the storyline is still low) | "now → target" text updates; the target tick moves |
| 5.2 | Re-read the dial after ~2 and ~5 scenario minutes | **Actual intensity moves toward the target.** Record the numbers. The chase only runs in the Escalating or Peak phase |
| 5.3 | Open the **Engine** tool → set the default to **Delayed-auto** | The setting applies; labels match behaviour |
| 5.4 | Wait for the next burst | Drafts **count down** instead of just queuing |
| 5.5 | Let one countdown expire | It **HOLDs** ("timer expired — held for you"); it never auto-sends |
| 5.6 | Set the default back to **Suggest** | Bursts queue for approval again |

## 6. Freeze (beat 6) — closes #350, #351

| # | Do | Expect |
|---|---|---|
| 6.1 | Note the scenario time in the console header. Pause pill → **Freeze** → confirm | Header reads WORLD FROZEN; the confirm step was required |
| 6.2 | Look at the participant tab, no refresh | The holding page appears, in the selected register |
| 6.3 | Refresh the participant tab while frozen | Still the holding page |
| 6.4 | Watch the review queue for 2+ wall-clock minutes | **No** new drafts while frozen |
| 6.5 | Resume | The holding page clears without a refresh; scenario time continues from the minute noted in 6.1 |

## 7. Usage panel (beat 7) — #401

| # | Do | Expect |
|---|---|---|
| 7.1 | Open the **Usage** tool | The provider and model in use, with call counts for the window. On `Fake` there is no real cost; after the live-AI flip, real calls and cost |
| 7.2 | Press Refresh after more engine activity | The numbers move |

## 8. Evidence pass (Claude)

After the walk, ask Claude to pull the session window from Application Insights and the telemetry table:
exceptions, `engine.*` events, steering actions and review decisions. That's the evidence to close #350–#354
and #401, and it surfaces server errors the UI swallowed.

---

## Results

Copy this table into a dated comment (or a `docs/demo/results-YYYY-MM-DD.md`) for each run.

| # | Result | Notes / issue |
|---|---|---|
| 0.1 | | |
| 1.1 | | |
| 1.2 | | |
| 1.3 | | |
| 1.4 | | |
| 1.5 | | |
| 2.1 | | |
| 2.2 | | |
| 2.3 | | |
| 3.1 | | |
| 3.2 | | |
| 3.3 | | |
| 4.1 | | |
| 4.2 | | |
| 5.1 | | |
| 5.2 | | |
| 5.3 | | |
| 5.4 | | |
| 5.5 | | |
| 5.6 | | |
| 6.1 | | |
| 6.2 | | |
| 6.3 | | |
| 6.4 | | |
| 6.5 | | |
| 7.1 | | |
| 7.2 | | |

See [UAT operating notes](../BUILD_PLAN.md#uat-operating-notes) for behaviour that looks like a bug but isn't.
