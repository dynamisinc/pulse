# Pulse.LoadTest — Saturday runbook

Load-test harness for story **post-demo-feedback/01** (#547, decisions PDF-D1..D5). It drives a throwaway
`Load test <date>` exercise on UAT with real participant logins, one real SignalR connection per user and
harness-paced controller-as-persona writes, and writes CSV + JSON results for
[`docs/demo/LOAD-TEST-REPORT.md`](../../docs/demo/LOAD-TEST-REPORT.md).

| Piece | What it does |
|---|---|
| `scripts/uat/New-LoadTestExercise.ps1` | Creates the exercise on its own host name, watermark on, staged then live, starts the clock, imports N participants and 20 NPC authors, loads a 200-post noise pool and three 20-post burst items, and writes the join URLs to a git-ignored file |
| `tools/Pulse.LoadTest` (this) | Joins at 25/min or less, then runs 20, 40 and 100 users for 10 minutes each. Each step runs noise High, the burst item and 120 posts/min for 2 minutes. It measures the run and applies the stop rules |
| `scripts/uat/Get-LoadTestMetrics.ps1` | Azure Monitor metrics for the run window, as CSV: App Service CPU, memory, HTTP 5xx and connections, plus SQL CPU, workers and data IO |
| `scripts/uat/Remove-LoadTestExercise.ps1` | Turns noise off, sets the tier to `engine`, moves the lifecycle to completed then archived, and deletes the join-URL file |

## Before Saturday: the load-test exercise needs its own host name

Pulse picks the participant's exercise **from the host name** of the request. The code:

- `JoinLoginService` resolves its scope from the host only.
- `SessionAuthenticationMiddleware` returns 403 when a participant's session and the host name disagree.
- `ExerciseRealtimeHub` adds each connection to the group of the exercise the host resolves to.

`app-pulse-api-uat-dynamis.azurewebsites.net` is bound to the demo exercise. Load users therefore cannot join a second
exercise through it. Without a second host name, the participant half of this test cannot run on UAT. Bind one extra
host name to the same App Service. This adds a binding and changes no app setting, and the app does not restart. It is
still a UAT change, so PDF-D1 makes it Tom's call.

```bash
RG=rg-pulse-uat-centralus; APP=app-pulse-api-uat-dynamis; HOST=pulse-loadtest-api.<your-uat-domain>
az webapp show -g $RG -n $APP --query customDomainVerificationId -o tsv   # → TXT asuid.pulse-loadtest-api
# DNS (<your-uat-domain>): CNAME pulse-loadtest-api → app-pulse-api-uat-dynamis.azurewebsites.net
#                          TXT   asuid.pulse-loadtest-api → <the id above>
az webapp config hostname add -g $RG --webapp-name $APP --hostname $HOST
az webapp config ssl create   -g $RG --name $APP --hostname $HOST        # free managed certificate (Basic and up)
az webapp config ssl bind     -g $RG --name $APP --ssl-type SNI --certificate-thumbprint <thumbprint from the create>
curl -s https://$HOST/health                     # Healthy
curl -s -o /dev/null -w '%{http_code}\n' https://$HOST/api/exercise-context   # 404 = no exercise bound yet (expected)
```

The harness is not a browser, so CORS does not matter. Each load-test exercise **keeps** its host name, and nothing can
release it. A second run needs a fresh host name, for example `pulse-loadtest2-api…`.

## Saturday sequence (about 75 minutes)

Run from the repository root with PowerShell 7.4 or later, the .NET 10 SDK and `az login` (Reader on the resource
group, for the metrics). **Never run during a deploy:** check that no Deploy Backend run is in progress. Nobody should
sign in to the demo during the ramp, because all joins share one 30/min bucket behind the App Service proxy.

```powershell
# 0. Baseline. Note the demo exercise id it prints.
pwsh scripts/uat/Test-DemoReady.ps1

# 1. Staff secret for controller1, in memory only.
pwsh scripts/uat/Copy-StaffSecret.ps1 controller1; $env:PULSE_STAFF_SECRET = Get-Clipboard

# 2. Create the load-test exercise. Preview first (read-only), then for real.
pwsh scripts/uat/New-LoadTestExercise.ps1 -ExerciseHost pulse-loadtest-api.<your-uat-domain> -WhatIf
pwsh scripts/uat/New-LoadTestExercise.ps1 -ExerciseHost pulse-loadtest-api.<your-uat-domain>
#    → prints the join-URL file (scripts/uat/out/loadtest-join-urls-<ts>.csv) and the next command

# 3. Configure: copy the sample and fill apiHost, joinUrlFile and demoExerciseId.
Copy-Item tools/Pulse.LoadTest/loadtest.sample.json tools/Pulse.LoadTest/loadtest.json   # git-ignored

# 4. Preflight: refusal checks, join file, controller sign-in. Sends no load.
dotnet run --project tools/Pulse.LoadTest -c Release -- --config tools/Pulse.LoadTest/loadtest.json --dry-run

# 5. The run: about 45 minutes (ramps of about 1, 1 and 2.5 minutes, plus 3 × 10 minutes).
dotnet run --project tools/Pulse.LoadTest -c Release -- --config tools/Pulse.LoadTest/loadtest.json
#    → loadtest-results/run-<ts>/{summary.json, steps.csv, samples.csv, fanout-drops.csv}

# 6. Azure metrics for the run window (padded 5 minutes each side).
pwsh scripts/uat/Get-LoadTestMetrics.ps1 -SummaryPath (Get-ChildItem loadtest-results/run-*/summary.json | Select-Object -Last 1)

# 7. Teardown. Preview first, then for real. Also deletes the join-URL file.
pwsh scripts/uat/Remove-LoadTestExercise.ps1 -ExerciseHost pulse-loadtest-api.<your-uat-domain> -WhatIf
pwsh scripts/uat/Remove-LoadTestExercise.ps1 -ExerciseHost pulse-loadtest-api.<your-uat-domain>
#    Optional: unbind the host name (the command is printed).

# 8. The demo is unharmed.
pwsh scripts/uat/Test-DemoReady.ps1
$env:PULSE_STAFF_SECRET = $null
```

Then fill in [`docs/demo/LOAD-TEST-REPORT.md`](../../docs/demo/LOAD-TEST-REPORT.md) from `summary.json`,
`steps.csv` and the metrics CSV.

## What a step does

| Minute | Action |
|---|---|
| Before | Connections SignalR closed for good since the last step are rebuilt. Then the ramp: joins at 25/min, evenly spaced (`POST /api/auth/join`). Each new user opens one SignalR connection to `/hubs/exercise` with the session token as `access_token`, like the web client's `accessTokenFactory`. The stop rules run during the ramp too |
| 0 | Reads the pause tier and re-applies `engine` (idempotent; a read-back of `running` means a restart, see below). Then `PUT /api/staff/noise {level: high}` (15/min) from the controller session. If noise reports `running: false`, the scenario clock stopped: the harness restarts it with Freeze → Engine paused |
| 1 | Fires the next pending `Load burst…` item (`POST /api/injects/{id}/fire`): 20 posts over 57 s. If none is left, it creates one first |
| 2–4 | **120 posts/min**: `POST /api/posts` as `controller-as-persona`, one every 0.5 s, round-robin over the NPC personas. The loop is open, so a slow server does not lower the rate |
| 0–10 | Every user reads the feed every 30 s, likes or reposts about once a minute, and posts about every 5 minutes. About a quarter of the posts are replies |
| 10 | Noise off. Next step (users stay joined) |

## Stop rules (PDF-D4)

The harness checks the rules every 5 s, during the ramp and the step. Each check looks at a short trailing window of
15 s:

- **error rate above 5%** (any non-2xx answer, or no answer) **for 60 s in a row**, or
- **POST `/api/posts` p95 above 5 s for 60 s in a row**. This counts participant posts, replies and controller posts.

The short window is deliberate. A breach must last 60 s; a 5 s burst of errors does not trip a step. A window with
fewer than 10 requests (or 10 POSTs, for the p95 rule) is never evidence. In practice the p95 rule is judged during
the 120/min burst, and the error rule all the time. The ramp also stops after **10 failed joins in a row** (a 429
included). When a rule trips, the harness aborts the step (or its ramp) and skips the later steps. The reason goes into `summary.json` (`stopReason`) and the exit code is 2. **Ctrl+C** once stops the load,
turns noise off, closes every connection, signs out and writes a partial summary (exit 130). A second Ctrl+C exits at
once. Remove-LoadTestExercise.ps1 still turns noise off.

The harness also **refuses to run** (exit 1) when any of these is true:

- The exercise that `apiHost` resolves to is the configured `demoExerciseId`.
- That exercise's name does not start with `Load test`.
- No demo id is configured.
- A join returns a session for another exercise.
- The join pace is set above 25/min.
- `apiHost` uses http, names a port (even `:443`), or is an IP address. These are the UAT scripts' host rules: https on
  443, a DNS name.

## If UAT restarts mid-run

An App Service restart drops every SignalR connection and empties Pulse's in-memory state. Until Wave 4 deploys (story
17/18), that state includes the pause tier and the scenario clock.

- **Connections.** Each client reconnects by itself (`reconnects` in the step). One that gives up is counted in
  `connectionsClosed` and rebuilt at the next step start (see the step's `events`).
- **Pause tier.** Before Wave 4 it comes back as `running`. At each step start the harness reads it, logs
  `RESTART SUSPECTED` in the step's `events` when it is not `engine`, and re-applies `engine`. After Wave 4 the tier
  persists (the read-back carries `persisted: true`), so the read-back stays `engine`.
- **Clock.** Before Wave 4 the clock stops, and with it white noise. The harness sees noise `running: false` after
  High, logs it, and restarts the clock with Freeze → Engine paused. A Freeze shows the pause overlay to the load
  users for an instant. Only the load-test exercise sees it.
- **Sessions** are stored in the database and survive a restart.

Report a restart in the report's "Deviations" row, with its time from the `events` entry.

## What to watch during the run

- **The harness console.** Every 30 s it prints requests, error rate, POST p95, connected users and reconnects.
- **Azure portal → app-pulse-api-uat-dynamis → Metrics**: CPU %, memory %, HTTP 5xx and connections. Also watch
  **Application Insights → Live metrics**.
- **Azure portal → sqldb-pulse-uat**: CPU % and workers %. It is serverless, so the first minutes include the resume.
- The UAT web app **cannot show the load-test exercise**: its pages and live updates follow the demo's host. Do not
  switch the console to it.
- **Audit trail on the demo exercise.** New-LoadTestExercise.ps1 signs in to the demo exercise once, only to call the
  create route, and then signs out. That leaves two staff audit events in the demo exercise's telemetry: a staff
  sign-in and a sign-out by `controller1`. Nothing else in the demo exercise changes. The harness and
  Remove-LoadTestExercise.ps1 never sign in to it.

## Reading the results

| File | Contents |
|---|---|
| `summary.json` | Target, window, `completed`, `stopReason`, `interrupted`. Per step: users, series and fan-out figures, plus reconnects, closed connections, connect failures, and `events` (restart signs, tier re-applies, rebuilt connections) |
| `steps.csv` | One row per step and series: count, errors, error rate, p50/p95/p99/max in ms. Also the `fan-out-lag` and `fan-out-end-to-end` rows |
| `samples.csv` | Every timed request: time, step, users, metric, latency, status |
| `fanout-drops.csv` | Every frame that never arrived: the post, the client, and how long after that client's (re)connect it was accepted |

The series are:

- `post` and `reply`: participant `POST /api/posts`.
- `controller-post`: the paced writes.
- `post-all`: the three above combined.
- `feed`: `GET /api/feed`.
- `reaction`: `PUT …/reactions/{like|repost}`.
- `join`, `noise`, `inject-fire`, `refresh`.

**Fan-out lag** is measured from the moment the 201 for the harness's own post reaches the harness, to `PostReceived` at
every *other* client connected when the post was sent. The server broadcasts before it answers, so a frame often
arrives before the 201. Such a frame counts as 0 ms and is counted in `framesBeforeAccept`. `fan-out-end-to-end` is
measured from the request being sent.

- A frame later than 2 s is **late**.
- A frame missing after 30 s is **dropped**.
- Frames for noise and burst-item posts are counted as `untrackedFrames`. They are not timed, because the harness does
  not know when the server accepted them.

A drop with `secondsAfterConnect` under about 1 s is a join-window artefact. The hub adds a connection to its exercise
group in `OnConnectedAsync`, just after the client sees the connection as connected. Report such drops separately from
real drops.

**Connection counts** are per step:

- `reconnects` counts SignalR's automatic reconnect attempts. A burst of them across most clients at one moment means a
  server restart or a network blip. A steady trickle under load means connections are timing out.
- `connectionsClosed` counts connections that ended for good, after the automatic reconnects gave up. They stop
  receiving frames, so their missing frames show up as drops. They are rebuilt at the next step start, and the step's
  `events` say how many.
- `connectFailures` counts hub connections that could not start at all, at a join or a rebuild.

Read drops against these counts: drops from closed clients are not fan-out lag.

The feed is one unpaged array (`PostReadService.GetFeedAsync`). Feed latency therefore grows with the post count across
the run, so read `feed` p95 per step against the posts already written.

## Configuration

Everything has a default (see `loadtest.sample.json`), and any value can be overridden on the command line. Run
`--help` for the list. You must supply `apiHost`, `joinUrlFile` and `demoExerciseId`. The staff secret comes from
`PULSE_STAFF_SECRET` or a hidden prompt, and it is never printed, logged or written. No output file holds a token, a
secret or a join link.

## Tests

```bash
dotnet test tools/Pulse.LoadTest.Tests      # also runs as part of pulse.slnx in CI
pwsh -c "Invoke-Pester scripts/uat/New-LoadTestExercise.Tests.ps1, scripts/uat/Remove-LoadTestExercise.Tests.ps1, scripts/uat/Get-LoadTestMetrics.Tests.ps1"
```
