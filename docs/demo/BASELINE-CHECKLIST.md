# UAT baseline checklist (demo prep)

> **Purpose.** Walk the proposed demo storyline ([`BUILD_PLAN.md` → Demo](../BUILD_PLAN.md)) once in UAT,
> on real data, and record what works and what breaks. Every break becomes an issue; every pass with
> evidence can close a story in [Verification debt](../BUILD_PLAN.md#verification-debt).
> Repeat it after fixes, and use it as the rehearsal script.

## Before you start

- **UAT is healthy again** (#413 merged and deployed 2026-10-06; `-CheckOnly` reports `READY`). If the
  reset ever stops at "Schema matches code", the last backend deploy's migration failed; check that
  run's migration step.
- **Opening state:** July's 4,821 posts and 51 stale drafts were cleared on 2026-10-06 (Decision 4). After
  a clear the feed opens EMPTY until the engine or the controller posts. Record in 1.3 whether that works
  as a demo opening.
- **Clear, then reset.** Run `pwsh scripts/uat/Clear-DemoContent.ps1` first. It archives older posts and
  vetoes stale engine drafts, and is reversible: it prints an undo command. Then run
  `pwsh scripts/uat/Reset-DemoState.ps1 -AutoConfirmResponses`, which must end `READY` (beat 4 needs the
  switch, and #416 deployed). Then refresh any console tab that was
  already open. It no longer restarts the API by default. After a restart the old process
  keeps serving for minutes, and the seed is lost at the handover. If you need a clean slate, run it with
  `-Restart`, wait ~8 minutes, then run it again without it.
- **Two fresh tabs:** participant and controller. Sessions live in per-tab storage, so two fresh tabs in
  one browser can hold different sessions, but a *duplicated* tab copies the session. A second monitor or a
  phone for the participant view makes the demo read better.
- **Accounts.** Never paste either secret into an agent session.
  - **Controller `controller1`:** `pwsh scripts/uat/Copy-StaffSecret.ps1 controller1` copies its secret
    to the clipboard without showing it.
  - **Participant (the PIO):** `participant1`'s password is stored only as a hash and can't be recovered.
    Create a fresh login with `pwsh scripts/uat/New-DemoParticipant.ps1 -Username pio1 -DisplayName "PIO (demo)"`.
    It prompts for a password and binds **@FulcoEM**, the official account the storyline's silence test
    waits for. Don't bind a citizen persona (mvega_fh and friends), because the engine writes as them too.
    To rebind an existing login, run `Reset-DemoState.ps1 -ParticipantUsername pio1 -PersonaHandle FulcoEM`,
    then sign that participant out and back in.
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
| 1.3 | Look at the feed before touching anything | Posts with author names and handles; verified marks on agency accounts; timestamps in **scenario time**, never wall-clock. **Record what the opening state looks like**: after the clear the feed starts empty until the engine or the controller posts (Decision 4). Note anything left over from before the clear that sorts or dates oddly against a storyline re-seeded at minute 0 |
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
| 4.0 | Check step 0's output | `Official posts … auto-confirm ON`. Anything else: re-run the reset with `-AutoConfirmResponses`, which needs #416 deployed. Without it a statement only slows the escalation, because the console has no confirm button yet (#415) |
| 4.1 | As the participant (on @FulcoEM), post an official statement that **carries `#WaterIssues`** | It appears in the feed. Matching is keyword-based: without the hashtag, the post must use the storyline's wording (Fulton County Emergency Management, water, safety, official statement) |
| 4.2 | Watch the console for a tick or two | The storyline turns **Addressed**, and the silence drafts stop |
| 4.3 | Watch the review queue | One new burst of up to 3 voices reacts to the statement: mostly gratitude and follow-up questions, one skeptic |

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
| 4.0 | | |
| 4.1 | | |
| 4.2 | | |
| 4.3 | | |
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
