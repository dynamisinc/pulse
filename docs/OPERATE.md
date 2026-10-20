# Operate (UAT)

> Proportional to where Pulse actually is: UAT only, no production. This is the whole ceremony until prod
> exists — do not write a production-shaped runbook the project can't honor.
> Companion to [`ORCHESTRATION_MECHANICS.md`](ORCHESTRATION_MECHANICS.md) (the build/gate loop).

## Gate order

Quality gates run **pre-merge** in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) (Gate 0).
Deploy **assumes-green** and runs only after merge to `main`. A lint/test regression is caught on the PR,
never first on `main`.

## Deploy

- **Frontend:** automatic on push to `main` touching `src/frontend/**`
  ([`deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml)) → Azure Static Web App
  (`stapp-pulse-uat`).
- **Backend:** automatic on push to `main` touching `src/Pulse.WebApi/**`, `src/Pulse.Core/**`,
  `global.json` or `pulse.slnx` ([`deploy-backend.yml`](../.github/workflows/deploy-backend.yml)) →
  App Service (`app-pulse-api-uat-dynamis`), applying the EF migration to `sqldb-pulse-uat` as an
  idempotent script **before** the new code is published. Its first post-deploy smoke polls
  `GET /api/build` (anonymous, returns only `{"commit":"<sha>"}`) for 30 attempts (~5 min, up to ~10 worst
  case) until it reports the run's own commit, so a green deploy means the **new** build is serving, not just
  that `/health` answers. This assumes the single-instance plan: if the App Service scales out, one matching
  answer proves only the instance that served it.
- **Infrastructure:** manual `workflow_dispatch`
  ([`deploy-infrastructure.yml`](../.github/workflows/deploy-infrastructure.yml)), with `what_if` preview.

### ⚠ Frontend-before-backend, for any change to a fail-closed contract

The two deploy workflows both trigger on `push: main` with **disjoint path filters and separate
concurrency groups** — so a commit touching both halves fires them **concurrently, in no guaranteed
order**. That is normally harmless, but it is not when a change widens a value the frontend validates
fail-closed.

The live case is `ExerciseScope.status`: `isExerciseStatus` (`core/exerciseContext/exerciseContextResolver.ts`)
rejects unknown values, and `ExerciseContextProvider` returns `null` on a rejected scope — which blanks
the participant world *and* the staff shell rather than raising a visible error. If the backend deploy
wins the race, it rewrites rows to a vocabulary the currently-served bundle does not know.

**Rule:** when a change both widens a server-emitted value and widens the client guard that accepts it,
the **frontend must be serving before the backend applies the migration**. Client guards are widened
additively (they accept the old and new vocabularies at once) precisely so this ordering is safe — but
only in that one direction.

You cannot achieve it by "running the frontend first", because a single merge commit touching both
halves auto-fires **both** workflows on the push and neither can be held. Do one of these instead:

- **Cancel and re-dispatch** (works after the fact). In Actions, cancel the auto-triggered *Deploy
  Backend* run immediately, let *Deploy Frontend* finish, confirm the new bundle is serving, then
  re-dispatch *Deploy Backend*. Cancelling is safe **only before its deploy job starts**: the migration script
  is applied in a single transaction, so a run cancelled before the migration leaves the schema untouched, and
  re-running it is idempotent. Once the deploy job has started, let it finish. Cancelling after the migration has
  committed leaves the new schema under the old code.
- **Split the merge** (works by construction, preferred when you control the merge). Land the additive
  client-guard change as its own commit to `main` first — it touches `src/frontend/**` only, so only
  *Deploy Frontend* fires — then merge the backend half.

**Rollback reverses the rule.** Once the database holds the new vocabulary, rolling the frontend bundle
back to a narrow guard re-creates the blank world. A rollback must therefore go **backend/schema first,
frontend second** — the exact opposite of promotion.

Left unmanaged the failure is **transient and self-healing** — both workflows complete, so UAT blanks
only for the window between them — but a tab holding the old bundle stays blank until a hard reload.

#### A3 — participant-facing name + setup-content columns (exercise-build-golive/09, #670)

**#670 is order-independent.** Either workflow may finish first; there is no cancel and re-dispatch race.

- A frontend that ships **before** the backend tolerates an old backend: the settings response guard accepts
  an absent `participantName` and reads it as `null`. The `participant-name` readiness item renders whatever
  the server sends. In that window a planner's saved participant name is ignored by the old backend and the
  field comes back empty; re-enter it after the backend deploys (fails safe).
- A backend that ships **before** the frontend is tolerated by the old (post-#669) bundle: the resolver and
  the card-sheet guard accept `exerciseName: null`.

1. **Precondition: #669 is deployed to UAT.** It is merged to `main`; verify its *Deploy Frontend* run is
   green. Without it the serving bundle's guard rejects a null `exerciseName`, which blanks the participant
   world and staff shell once the new backend emits one.
2. **The NavRail participant-name rendering ships separately as PR-4c.** Merge it **only after #670's
   *Deploy Backend* run is green**, including the *Smoke test — the NEW build is serving (commit matches)*
   step (`/api/build` commit equals the run's SHA) and the *Smoke test — an exercise-scoped read works*
   step (`/api/exercise-context`). Reason: against an old backend `exerciseName` is the internal `Name`, which
   the NavRail would show to participants (#376 leak). The participant-guide sentence about the name in the
   side menu moves to PR-4c with it.
3. **Re-scaffold the migration after #655 (`20261019171234`) and #665 (`20261019200000`) are on `main`.**
   `ef migrations add` cannot set the id, so:
   0. Install the CI-pinned tool: `dotnet tool install --global dotnet-ef --version 10.0.10` (the repo has no
      local tool manifest; `deploy-backend.yml` pins 10.0.10).
   1. Merge `main` into the branch; let `ModelSnapshot` merge textually.
   2. From the repo root: `dotnet ef migrations add TmpA3Model --project src/Pulse.WebApi/Pulse.WebApi.csproj`.
   3. Copy the body of `BuildTargetModel` from the generated `*_TmpA3Model.Designer.cs` into
      `20261019230000_A3SetupContentParticipantName.Designer.cs` (keep that file's class/attribute header).
   4. **Check that the generated `*_TmpA3Model.cs` has EMPTY `Up()` and `Down()`.** If it does not, the merged
      snapshot or the A3 migration is missing schema: stop and fix that; do not paper over it. Then delete the
      `*_TmpA3Model` `.cs` and `.Designer.cs`, and keep the snapshot exactly as the textual merge left it
      (revert anything the Tmp run wrote to it).
   5. `dotnet ef migrations has-pending-model-changes --project src/Pulse.WebApi/Pulse.WebApi.csproj` must report none.
   6. Run `A3SetupContentParticipantNameMigrationTests` and `IdempotentMigrationScriptTests`. The test
      constants `MigrationUnderTest` and `BeforeA3` pin the migration ids; update `BeforeA3` if the
      predecessor on `main` changed.
4. **Rollback: no workflow runs a `Down`.** *Deploy Backend* has no ref input (its only input is the
   environment), so roll back the backend with a **revert PR**. Reverting the code without a `Down` is
   safe: the new columns are additive (a nullable column, and `bit NOT NULL DEFAULT 0`) and the old
   model ignores them. A schema `Down` is optional and manual. It drops the three columns, and the
   planner-entered participant names and the setup/conduct split are lost (a replayed Up re-derives
   them from `WorldName` and the lifecycle telemetry). Generate the script **from a checkout that still contains
   the A3 migration** (the #670 merge commit, before the revert; on post-revert `main` it reports
   "migration not found") and apply it to `sqldb-pulse-uat` by hand:
   `dotnet ef migrations script 20261019230000_A3SetupContentParticipantName 20261017120000_AdminIdentityFoundation --project src/Pulse.WebApi/Pulse.WebApi.csproj`
   (adjust the "to" migration to whichever migration precedes A3 on `main` at that time). If PR-4c has
   shipped, revert it first so nothing renders the name.
5. **After deploy, reload open staff consoles.** The settings PUT is a full replace. An old tab's PUT omits
   `participantName` and clears it. That fails safe (no name shows, and the `participant-name` readiness item
   blocks staging again), but the planner must re-enter the name.
6. **Backfill cost and locks.** The column adds are metadata-only (a nullable column, and a `bit NOT NULL
   DEFAULT 0`). The `IsSetupContent` backfill aggregates the lifecycle events **once per exercise**: one scan
   of `TelemetryEvents` (there is no `EventType` index, so this is the largest read), then one join against
   `Posts` and one against `Follows`. At UAT size this takes seconds. The deploy script runs in one
   transaction, so the schema locks on `Exercises`, `Posts` and `Follows` are held until it commits. Reads and
   writes to those tables wait for that time; expect a short stall in the window, not errors. Run it in the
   agreed UAT window, not during an exercise.

## Easy login (participant sign-in)

Decided by Tom on 2026-10-14 (#486, Tier-2 items 3, 4 and 7):

- **Join links are built from `Authentication__FrontendBaseUrl`.** Infra sets it from `frontendUrl` in
  `infrastructure/parameters/uat.bicepparam` (`https://pulse-uat.cobrasoftware.com`); the 2026-10-09
  infra deploy applied it. Without it, the roster reports `joinLinksAvailable: false` and shows no links.
- **The reprint keys** (ASP.NET DataProtection, under `/home/ASP.NET/DataProtection-Keys` on the App
  Service) are stored unencrypted. That is accepted for UAT. Post-demo, protect them with Key Vault.
- **If that key ring is lost** (the app is recreated, or moved to another region), printed cards and
  links **still work**, because sign-in matches the token's hash. They just can't be **reprinted**. To
  get a new card, use **Reissue** on the roster. That voids the old card, so hand out the new one.
- **Shared devices: tap Sign out.** A participant session ends at midnight in the exercise time zone.
  A **View-only code** session also persists, but is not day-capped (accepted for the demo).

## Test staff accounts (role smoke)

UAT has one staff login (`controller1`, the lead). To add a non-lead controller, a planner or an evaluator:

1. Replace the `STAFF_IDENTITY_ACCOUNTS_JSON` secret with the full array, keeping `controller1` unchanged.
2. Re-run **Deploy Infrastructure**.
3. Enroll each login by re-running `bootstrap-exercise` with only the `staff` sub-request.

Steps and caveats:
[login/06 → Adding test staff accounts](features/login/06-uat-goLive-config-runbook.md#adding-test-staff-accounts-role-smoke).

## Timeout auto-send (swamped mode): single instance only

`uat` authorizes timeout auto-send (`generationTimeoutAutoSendAuthorized = true` in
`infrastructure/parameters/uat.bicepparam`, PROVIDER-GOVERNANCE §8 Phase 2).

- **Keep `uat` single-instance (B1, capacity 1) while that flag is true.** Swamped mode and the rest of the engine's
  autonomy state are held **in memory, per process**. With two instances, one could be swamped (auto-sending expired
  drafts) while the other is not, and a lead's ON or OFF would reach only one of them.
- **Before scaling out** (more instances, or a plan with autoscale), set the flag back to `false` and re-run **Deploy
  Infrastructure**. Expired countdowns then always hold.
- **A restart turns swamped mode off.** After an app restart or deploy, swamped mode is off until the lead turns it on
  again.

## Trusted proxy (forwarded headers, #480)

Behind App Service every request arrives from the platform front end, so without forwarded headers every
per-IP rate limiter (staff login, join link, day word, ...) shares **one** bucket — a 100-person StartEx can
lock everyone out. `UsePulseForwardedHeaders()` restores the client IP (`X-Forwarded-For`) and the original
scheme (`X-Forwarded-Proto`), but **only from peers you configure**:

| App setting | Meaning |
|---|---|
| `ForwardedHeaders__KnownNetworks__0`, `__1`, ... | Trusted proxy networks, CIDR (e.g. `10.0.0.0/8`) |
| `ForwardedHeaders__KnownProxies__0`, `__1`, ... | Trusted proxy addresses (e.g. `10.0.0.4`) |
| `ForwardedHeaders__ForwardLimit` | Hops honored, right to left. Default `1` (the single front end); leave it |

- **Unset = trust no one.** With no entries the middleware is not added at all, so the limiter keeps the
  proxy-collapsed behavior. Do not leave UAT unset before a large exercise.
- **App Service (Linux):** the front end's internal addresses are not published. Microsoft's guidance for
  Linux App Service is to trust the private ranges the platform uses: `10.0.0.0/8`, `172.16.0.0/12`,
  `192.168.0.0/16`. This is safe here because the worker is reachable only through the front end; a client
  cannot connect from those ranges directly. If the app is ever put behind another hop (Front Door, App
  Gateway), add that hop and revisit `ForwardLimit`.
- **Keep `ASPNETCORE_FORWARDEDHEADERS_ENABLED=false`** (pinned in `webapp.bicep`). When true, that framework switch adds
  its own forwarded-headers middleware that trusts **every** peer. App Service on Linux can set it on the platform
  side, so the host does **not** refuse to start: it removes that framework middleware, honors only the trust list
  above, and logs a critical warning naming the key. (An earlier version refused to start; that took UAT down with a
  503 on 2026-10-17.)
- `X-Forwarded-Host` is never honored: the request host selects the exercise, so it must not be client-settable.
- **Check it worked:** after a deploy, two people on different networks should each get their own staff-login
  limit (10 failed attempts per minute). If one person's failures lock out the other, the networks are not
  configured.
- **Shared networks still share a limit.** The limiters partition on the client's **public** IP. Everyone behind
  one NAT (venue Wi-Fi, an agency VPN, a corporate proxy) is one client to Pulse. For a large single-site exercise,
  raise the per-policy permits ahead of StartEx without a deploy and stagger sign-ins. Every sign-in limiter is a
  fixed 1-minute window per public IP:

  | App setting | Routes | Default |
  |---|---|---|
  | `Authentication__EasyLogin__JoinPermitPerMinute` | `POST /api/auth/join` (personal link / QR) | 30 |
  | `Authentication__EasyLogin__WordPermitPerMinute` | `POST /api/auth/word` (day word) | 10 |
  | `Authentication__RateLimits__ParticipantLoginPerMinute` | `POST /api/auth/login` | 10 |
  | `Authentication__RateLimits__SharedLoginPerMinute` | `POST /api/auth/shared` (view-only code) | 5 |
  | `Authentication__RateLimits__SessionPerMinute` | `GET /api/session`, `POST /api/auth/refresh`, `/logout` | 60 |
  | `Authentication__RateLimits__StaffLoginPerMinute` | `POST /api/auth/staff/login` | 10 |

  A missing, non-integer or non-positive value keeps the default, so a typo never disables a limiter. Changing an
  app setting restarts the App Service worker. Do it ~30 minutes before StartEx, and put the defaults back after
  the sign-in rush: higher limits give a guesser on the same network more tries, and the day word is the
  weakest credential.

## Retire the PWA service worker

To retire the PWA service worker: copy `src/frontend/public/sw-killswitch.js` over `src/frontend/public/sw.js`
and deploy. Every installed client unregisters on its next visit and reloads uncached (the kill switch
deletes all `pulse-shell-*` caches, unregisters itself and reloads open windows). Keep it deployed for at
least 30 days so infrequent devices also pick it up.

## Rollback

**Frontend (deploy-only):**

1. Find the last-good workflow run (green CI, working UAT).
2. Open that run and use **Re-run jobs** — SWA overwrites with the prior build. (Redeploy = rollback.)
   Note `workflow_dispatch` takes a **branch or tag ref**, not an arbitrary SHA, so re-running the old
   run is the way to target a specific commit.
3. Append an incident line below.

**Backend:** redeploying an earlier commit rolls back the *code*, but **not the schema** — the migration
script is idempotent-forward only and is never auto-reversed. A schema rollback means generating a
**down script** and applying it to `sqldb-pulse-uat` by hand (`Down` is C#; it is not something you run
directly):

```bash
dotnet ef migrations script <target-migration> <migration-to-undo> --idempotent --project src/Pulse.WebApi
```

where `<target-migration>` is the one you want to land back on — i.e. the arguments are from-then-to,
so undoing the newest migration means naming the one **before** it first.

Note that a `Down` is not guaranteed loss-free: where a migration widens a vocabulary, `Down` maps the
new values back onto the narrower legacy set, so distinctions collapse (and a `Down` **then** re-`Up` is
not identity-preserving — it silently reclassifies). Read the specific migration's `Down` before relying
on it. UAT is a disposable playground: for anything non-trivial, re-seeding from a clean database is
faster and more honest than unwinding a migration.

### AdminIdentityFoundation (A1b): deploy order and rollback

This migration replaces `StaffAssignments` with `People` + `Enrollments`. It also changes what a session
can carry: an org-admin session has `exerciseId: null`, and the role is a union of exercise and org roles.

**Deploy in a quiet window.** Pick a time with no live exercise. While the backend deploy runs, expect about 5 minutes
of failures on sign-in, staff assignments, the roster and exports:
- the migration takes schema locks while it applies;
- for about 3 minutes the old process runs on the new schema before the new code starts.
Everyone with an `orgAdmin` session must sign in again afterwards, because the migration revokes those sessions.

**Order: either works; backend first or both together is simplest.** The new bundle's session and staff-assignment
parsers accept both shapes:
- **The pre-A1 shape** (no `scope`, `world`, `isLead` or `personId`). The missing fields default to an exercise
  session, the world implied by the role, not lead, and no person.
- **The legacy exercise-scoped `orgAdmin` session and `orgAdmin` assignment row.** The bundle reads these as
  `planner`, which is what A1 migrates such people to; the old backend still authorizes them on the server.
- **The A1 shape.**

The old bundle ignores the new fields, so it keeps working against the new backend too, **except for org admins**:
it requires an exercise on every session, so org admins cannot use the console from the moment the backend lands until
the new bundle is serving. Do **not** cancel *Deploy
Backend* once its deploy job has started (see the cancel-and-re-dispatch rule above).

**Staff and participants on one origin: use separate browser profiles.** A1 enforces one world per browser. Signing in
as a participant signs out every staff tab in the same browser profile, and the reverse. On UAT, staff and participant
share one origin. For demos and testing, open the staff console and the participant views in **separate browser
profiles** (or one in a private window).

**Before the backend deploy, note the time.** Write down the UTC time just before *Deploy Backend* starts its deploy
job. That is the point-in-time-restore (PITR) target if a rollback is needed.

**Rollback order of preference:**

1. **Forward-fix.** Preferred. Most problems after this deploy are code problems, not data problems, and a fix on
   `main` redeploys in minutes without touching the data.
2. **PITR to the noted time.** If the data is wrong, restore `sqldb-pulse-uat` to the time noted above (Azure portal
   → the database → *Restore*, as a new database, then swap the connection string). Then redeploy the backend and
   frontend from the commit before the merge, **backend first, frontend second**. Anything written after the noted
   time is lost. Both bundles read the restored pre-A1 session shape, so the order of the two redeploys does not
   matter; org-scope sign-in simply stops working once the old backend is back.
3. **The migration's `Down`.** Last resort. It is reversible but **not loss-free**:
   - `StaffAssignments` come back with the same ids, and `Accounts.Role` / `PersonaId` are restored from enrollments.
   - A person who was both a planner and an org admin comes back as `orgAdmin` only.
   - Org-scope sessions are deleted (they have no exercise to point at).
   - A person who holds an `OrgRole` but has no enrollments loses admin access entirely: the pre-A1 schema keeps
     org-admin access only on per-exercise rows. Re-grant it by hand after `Down` if needed.
   - Everything that exists only from A1 on is dropped: people's emails and passwords, org audit events, login
     choices, organization slugs, `FirstLiveAt`.

## Incident log

<!-- One dated line per incident: date · symptom · SHA · action taken. -->

_(none yet)_
