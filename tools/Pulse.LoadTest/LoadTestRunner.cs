namespace Pulse.LoadTest;

using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json.Nodes;

/// <summary>
/// The whole run: preflight and refusal, controller sign-in, then each step (ramp joins at ≤ 25/min, noise High, the
/// 20-post burst item, 2 minutes of harness-paced 120/min controller-as-persona writes, the participant mix), with the
/// stop rules checked every few seconds. Always ends by turning noise off, closing every connection, signing out and
/// writing the (possibly partial) results.
/// </summary>
internal sealed class LoadTestRunner : IDisposable
{
    private static readonly TimeSpan MonitorTick = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan ProgressEvery = TimeSpan.FromSeconds(30);

    private readonly LoadTestConfig _config;
    private readonly Func<string?> _readSecret;
    private readonly TextWriter _out;
    private readonly SampleLog _log = new();
    private readonly RunClock _clock = new();
    private readonly ConnectionCounters _counters = new();
    private readonly ConcurrentDictionary<int, VirtualParticipant> _participants = new();
    private readonly List<Task> _activity = [];
    private readonly CancellationTokenSource _activityCts = new();
    private readonly List<StepResult> _steps = [];
    private FanOutTracker _tracker = null!;

    public LoadTestRunner(LoadTestConfig config, Func<string?> readSecret, TextWriter output)
    {
        _config = config;
        _readSecret = readSecret;
        _out = output;
    }

    /// <summary>Runs. Returns the process exit code: 0 completed, 1 refused or failed, 2 stopped by a rule, 130 interrupted.</summary>
    public async Task<int> RunAsync(CancellationToken cancel)
    {
        // Ctrl+C stops the participant loops at once too (the shutdown also stops them on a normal end).
        await using var stopActivity = cancel.Register(() => _activityCts.Cancel());
        var problems = _config.Validate();
        if (problems.Count > 0)
        {
            foreach (var problem in problems)
            {
                Fail(problem);
            }

            return 1;
        }

        LoadTestConfig.TryNormalizeApiHost(_config.ApiHost!, out var origin, out _);
        _tracker = new FanOutTracker(_config.FanOut);

        IReadOnlyList<JoinEntry> entries;
        try
        {
            entries = JoinUrlFile.Parse(await File.ReadAllTextAsync(_config.JoinUrlFile!, cancel), _config.NpcNamePrefix);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or FormatException)
        {
            Fail($"Cannot read the join-URL file: {ex.Message}");
            return 1;
        }

        var needed = _config.Steps.Max();
        if (entries.Count < needed)
        {
            Fail($"The join-URL file has {entries.Count} participant links; the largest step needs {needed}. Re-run New-LoadTestExercise.ps1 with -Participants {needed}.");
            return 1;
        }

        using var api = new PulseApi(origin, TimeSpan.FromSeconds(_config.RequestTimeoutSeconds), _log, _clock);
        Info($"Pulse load test against {origin} — steps {string.Join(" → ", _config.Steps)} users, {_config.StepMinutes} min each.");

        // ── Preflight: what does the HOST resolve to? (never a typed id) ──────────────────────────────────────────
        var context = await api.GetExerciseContextAsync(cancel);
        if (!context.Success || context.Json is null)
        {
            Fail($"GET /api/exercise-context on {origin} answered {context.Status}. The host must be bound to the load-test exercise (see README: the extra hostname).");
            return 1;
        }

        var targetId = (string?)context.Json["exerciseId"];
        var targetName = (string?)context.Json["exerciseName"];
        var refusal = TargetGuard.Check(targetId, targetName, _config.DemoExerciseId);
        if (refusal is not null)
        {
            Fail("REFUSED: " + refusal);
            return 1;
        }

        var target = Guid.Parse(targetId!);
        var timeZone = (string?)context.Json["timeZone"] is { Length: > 0 } tz ? tz : "UTC";
        Info($"PASS target: '{TargetGuard.Printable(targetName)}' ({target}), status {TargetGuard.Printable((string?)context.Json["status"])}; not the demo exercise.");

        // ── Controller session ─────────────────────────────────────────────────────────────────────────────────
        var secret = _readSecret();
        if (string.IsNullOrEmpty(secret))
        {
            Fail("No staff secret: set PULSE_STAFF_SECRET or type it at the prompt.");
            return 1;
        }

        ApiResult login;
        try
        {
            login = await api.StaffLoginAsync(_config.StaffUsername, secret, target.ToString(), cancel);
        }
        finally
        {
            secret = null;
        }

        if (!login.Success || login.Json is null)
        {
            Fail($"Controller sign-in as '{_config.StaffUsername}' answered {login.Status} (401: secret; 403: not assigned to the load-test exercise; 429: wait a minute).");
            return 1;
        }

        var staff = PulseSession.FromLoginJson(login.Json);
        if (TargetGuard.CheckSession(staff.ExerciseId, target) is { } staffMismatch)
        {
            Fail("REFUSED: " + staffMismatch);
            await api.LogoutAsync(staff, CancellationToken.None);
            return 1;
        }

        Info($"PASS signed in as {_config.StaffUsername} (controller session on the load-test exercise).");
        var startedAt = DateTimeOffset.UtcNow;
        string? runStop = null;
        var interrupted = false;
        var outDir = Path.Combine(_config.OutputDirectory, $"run-{startedAt:yyyyMMdd-HHmmss}");

        try
        {
            var npcPersonas = await LoadNpcPersonasAsync(api, staff, cancel);
            if (npcPersonas.Count == 0)
            {
                Fail($"No NPC personas (display name starting '{_config.NpcNamePrefix}') in the load-test exercise. Run New-LoadTestExercise.ps1 first.");
                return 1;
            }

            Info($"PASS {entries.Count} participant links, {npcPersonas.Count} NPC personas for the controller writes.");
            if (_config.DryRun)
            {
                Info("DRY RUN: preflight passed. No load was sent.");
                return 0;
            }

            Directory.CreateDirectory(outDir);
            var joinQueue = new Queue<JoinEntry>(entries);
            var pacer = new JoinPacer(_config.JoinsPerMinute);

            for (var stepIndex = 0; stepIndex < _config.Steps.Count; stepIndex++)
            {
                _clock.Step = stepIndex;
                var users = _config.Steps[stepIndex];
                var step = new StepResult { Index = stepIndex, TargetUsers = users };
                _steps.Add(step);

                Info($"Step {stepIndex + 1}/{_config.Steps.Count}: ramping to {users} users at {_config.JoinsPerMinute}/min.");
                await RebuildClosedConnectionsAsync(step, cancel);
                var rampStop = await RampAsync(api, joinQueue, pacer, users, target, timeZone, stepIndex, cancel);
                step.Joined = _participants.Count;
                if (rampStop is not null)
                {
                    step.StopReason = rampStop;
                    step.EndedAt = DateTimeOffset.UtcNow;
                    await SetNoiseAsync(api, staff, "off", CancellationToken.None);
                    runStop = $"step {stepIndex + 1} ({users} users): {rampStop}";
                    Fail($"STOP RULE: {runStop}. Later steps skipped.");
                    break;
                }

                step.Connected = _participants.Values.Count(p => p.IsConnected);

                step.StartedAt = DateTimeOffset.UtcNow;
                step.StopReason = await RunStepAsync(api, staff, npcPersonas, timeZone, step, cancel);
                step.EndedAt = DateTimeOffset.UtcNow;

                await SetNoiseAsync(api, staff, "off", CancellationToken.None);
                if (step.StopReason is not null)
                {
                    runStop = $"step {stepIndex + 1} ({users} users): {step.StopReason}";
                    Fail($"STOP RULE: {runStop}. Later steps skipped.");
                    break;
                }

                Info($"Step {stepIndex + 1} done: {Describe(stepIndex)}");
            }
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested)
        {
            interrupted = true;
            Warn("Interrupted (Ctrl+C): stopping the load and writing a partial summary.");
            if (_steps.Count > 0 && _steps[^1].EndedAt is null)
            {
                _steps[^1].EndedAt = DateTimeOffset.UtcNow;
                _steps[^1].StopReason ??= "interrupted (Ctrl+C)";
            }
        }
        finally
        {
            await ShutdownAsync(api, staff);
            if (Directory.Exists(outDir))
            {
                _tracker.Sweep(DateTimeOffset.UtcNow, all: true);
                var summary = BuildSummary(origin, target, targetName, startedAt, runStop, interrupted);
                ResultWriter.Write(outDir, summary, _log.Snapshot(), _config.Steps, DropsCsv());
                Info($"Results: {Path.GetFullPath(outDir)} (summary.json, steps.csv, samples.csv, fanout-drops.csv)");
            }
        }

        return interrupted ? 130 : runStop is not null ? 2 : 0;
    }

    private async Task<IReadOnlyList<string>> LoadNpcPersonasAsync(PulseApi api, PulseSession staff, CancellationToken ct)
    {
        var result = await api.GetPersonasAsync(staff, ct);
        if (!result.Success || result.Json is not JsonArray personas)
        {
            return [];
        }

        return personas
            .Where(p => ((string?)p?["displayName"] ?? string.Empty).StartsWith(_config.NpcNamePrefix, StringComparison.Ordinal))
            .Select(p => (string?)p?["id"])
            .OfType<string>()
            .ToList();
    }

    /// <summary>
    /// Joins until <paramref name="users"/> are in. The stop rules run here too (every join, and every 5 s of a 429
    /// wait), over the ramp's own requests — the joins and the load of the users already in — and
    /// <see cref="JoinFailureGuard"/> stops after <see cref="JoinFailureGuard.DefaultLimit"/> failed joins in a row. Returns
    /// the stop reason, or <c>null</c>.
    /// </summary>
    private async Task<string?> RampAsync(PulseApi api, Queue<JoinEntry> queue, JoinPacer pacer, int users, Guid target, string timeZone, int stepIndex, CancellationToken ct)
    {
        var rampStart = DateTimeOffset.UtcNow;
        var evaluator = new StopRuleEvaluator(_config.StopRules);
        var failures = new JoinFailureGuard(JoinFailureGuard.DefaultLimit);
        string? Check()
        {
            _tracker.Sweep(DateTimeOffset.UtcNow);
            var samples = _log.ForStep(stepIndex).Where(s => s.At >= rampStart).ToArray();
            return evaluator.Evaluate(DateTimeOffset.UtcNow, samples) is { } reason ? "during the ramp: " + reason : null;
        }

        var attemptsLeft = (users - _participants.Count) * 3;
        while (_participants.Count < users && queue.Count > 0 && attemptsLeft-- > 0)
        {
            var wait = pacer.DelayUntilNext(DateTimeOffset.UtcNow);
            if (wait > TimeSpan.Zero)
            {
                await Task.Delay(wait, ct);
            }

            var entry = queue.Dequeue();
            pacer.Record(DateTimeOffset.UtcNow);
            var result = await api.JoinAsync(entry.Token, ct);
            var joined = result.Success && result.Json is not null;
            if (failures.Record(joined) is { } tripped)
            {
                return "during the ramp: " + tripped;
            }

            if (result.Status == 429)
            {
                Warn("Join answered 429 (the global join bucket is full; someone else may be signing in). Waiting a minute.");
                queue.Enqueue(entry);
                for (var waited = 0; waited < 60; waited += 5)
                {
                    await Task.Delay(TimeSpan.FromSeconds(5), ct);
                    if (Check() is { } during429)
                    {
                        return during429;
                    }
                }

                continue;
            }

            if (!joined)
            {
                Warn($"Join failed ({result.Status}) for one participant link; skipping it.");
                if (Check() is { } afterFailure)
                {
                    return afterFailure;
                }

                continue;
            }

            var session = PulseSession.FromLoginJson(result.Json!);
            if (TargetGuard.CheckSession(session.ExerciseId, target) is { } mismatch)
            {
                await api.LogoutAsync(session, CancellationToken.None);
                throw new InvalidOperationException("REFUSED: " + mismatch);
            }

            var id = _participants.Count + 1;
            var participant = new VirtualParticipant(id, session, api, _tracker, _counters, _clock, _config.Activity, timeZone, OtherConnectedClients);
            _participants[id] = participant;
            await participant.ConnectAsync(ct);
            var activityToken = _activityCts.Token;
            _activity.Add(Task.Run(() => participant.RunAsync(activityToken), CancellationToken.None));
            if (_participants.Count % 10 == 0)
            {
                Info($"  {_participants.Count} joined, {_participants.Values.Count(p => p.IsConnected)} connected.");
            }

            if (Check() is { } reason)
            {
                return reason;
            }
        }

        return null;
    }

    /// <summary>
    /// Step start (M3): re-applies pause tier <c>engine</c> (idempotent) and checks for a UAT restart since the last step:
    /// the tier reading back as <c>running</c> (the in-memory default after a restart, until Wave 4 persists it), or white
    /// noise not running after High (the scenario clock is not running). A stopped clock is restarted with Freeze →
    /// Engine paused, as New-LoadTestExercise.ps1 does. Everything found goes into the step's events.
    /// </summary>
    private static async Task CheckTierAndClockAsync(PulseApi api, PulseSession staff, StepResult step, CancellationToken ct)
    {
        var before = await api.GetPauseTierAsync(staff, ct);
        var tier = (string?)before.Json?["tier"];
        var persisted = before.Json?["persisted"] is { } p ? p.ToString() : "absent (pre-Wave 4: tier and clock live in memory)";
        if (!before.Success)
        {
            step.Event($"GET /api/steering/pause-tier answered {before.Status}.");
        }
        else if (tier != "engine")
        {
            step.Event($"RESTART SUSPECTED: pause tier read back as '{tier}' (setup left 'engine'; persisted: {persisted}).");
        }

        var set = await api.SetPauseTierAsync(staff, "engine", ct);
        if (!set.Success)
        {
            step.Event($"Re-applying pause tier 'engine' answered {set.Status}.");
        }
    }

    private static async Task EnsureNoiseRunningAsync(PulseApi api, PulseSession staff, ApiResult noise, StepResult step, CancellationToken ct)
    {
        if (!noise.Success || (bool?)noise.Json?["running"] != false)
        {
            return;
        }

        step.Event("RESTART SUSPECTED: white noise is High but not running (scenario clock stopped). Restarting the clock with Freeze → Engine paused.");
        var freeze = await api.SetPauseTierAsync(staff, "freeze", ct);
        var resume = await api.SetPauseTierAsync(staff, "engine", ct);
        var after = await api.GetNoiseAsync(staff, ct);
        step.Event((bool?)after.Json?["running"] == true
            ? "Clock restarted: white noise running."
            : $"Clock NOT restarted (freeze {freeze.Status}, engine {resume.Status}, noise running={(bool?)after.Json?["running"]}): this step runs without white noise.");
    }

    /// <summary>L5: a connection SignalR gave up on (closed after its automatic reconnects) is rebuilt at a step start.</summary>
    private async Task RebuildClosedConnectionsAsync(StepResult step, CancellationToken ct)
    {
        var closed = _participants.Values.Where(p => p.IsClosed).ToArray();
        if (closed.Length == 0)
        {
            return;
        }

        var rebuilt = 0;
        foreach (var participant in closed)
        {
            if (await participant.RebuildAsync(ct))
            {
                rebuilt++;
            }
        }

        step.Event($"{closed.Length} closed connection(s) found at step start; {rebuilt} rebuilt.");
    }

    private int[] OtherConnectedClients(int sender) =>
        _participants.Values.Where(p => p.Id != sender && p.IsConnected).Select(p => p.Id).ToArray();

    private async Task<string?> RunStepAsync(PulseApi api, PulseSession staff, IReadOnlyList<string> npcPersonas, string timeZone, StepResult step, CancellationToken ct)
    {
        var start = step.StartedAt!.Value;
        var end = start + TimeSpan.FromMinutes(_config.StepMinutes);
        var burst = _config.Burst;
        var evaluator = new StopRuleEvaluator(_config.StopRules);
        using var stepCts = CancellationTokenSource.CreateLinkedTokenSource(ct);

        await CheckTierAndClockAsync(api, staff, step, ct);
        if (burst.NoiseHigh)
        {
            var noise = await SetNoiseAsync(api, staff, "high", ct);
            step.NoiseHigh = noise.Success;
            await EnsureNoiseRunningAsync(api, staff, noise, step, ct);
        }

        var burstItemTask = burst.FireBurstItem
            ? FireBurstItemAtAsync(api, staff, npcPersonas, start + TimeSpan.FromMinutes(burst.BurstItemAtMinute), step, stepCts.Token)
            : Task.CompletedTask;
        var pacedTask = PacedWritesAsync(api, staff, npcPersonas, timeZone, start + TimeSpan.FromMinutes(burst.PacedStartMinute), step, stepCts.Token);

        string? reason = null;
        var nextProgress = start + ProgressEvery;
        try
        {
            while (DateTimeOffset.UtcNow < end)
            {
                await Task.Delay(MonitorTick, ct);
                var now = DateTimeOffset.UtcNow;
                await api.EnsureFreshAsync(staff, TimeSpan.FromMinutes(5), ct);
                _tracker.Sweep(now);
                var samples = _log.ForStep(step.Index).Where(s => s.At >= start).ToArray();
                reason = evaluator.Evaluate(now, samples);
                if (reason is not null)
                {
                    break;
                }

                if (now >= nextProgress)
                {
                    nextProgress = now + ProgressEvery;
                    Info(string.Create(CultureInfo.InvariantCulture,
                        $"  {(now - start).TotalMinutes:0.0} min: {samples.Length} requests, error rate {evaluator.LastErrorRate:P1}, POST p95 {evaluator.LastPostP95Ms:0} ms, {_participants.Values.Count(p => p.IsConnected)}/{_participants.Count} connected, {_counters.Reconnects(step.Index)} reconnects"));
                }
            }
        }
        finally
        {
            await stepCts.CancelAsync();
            await Task.WhenAll(burstItemTask.ContinueWith(_ => { }, TaskScheduler.Default), pacedTask.ContinueWith(_ => { }, TaskScheduler.Default));
        }

        return reason;
    }

    private async Task FireBurstItemAtAsync(PulseApi api, PulseSession staff, IReadOnlyList<string> npcPersonas, DateTimeOffset at, StepResult step, CancellationToken ct)
    {
        var wait = at - DateTimeOffset.UtcNow;
        if (wait > TimeSpan.Zero)
        {
            await Task.Delay(wait, ct);
        }

        var queue = await api.GetInjectsAsync(staff, ct);
        string? itemId = null;
        if (queue.Success && queue.Json?["items"] is JsonArray items)
        {
            itemId = items
                .Where(i => (string?)i?["kind"] == "burst" && (string?)i?["status"] == "pending"
                    && ((string?)i?["title"] ?? string.Empty).StartsWith(_config.Burst.BurstItemTitlePrefix, StringComparison.Ordinal))
                .OrderBy(i => (int?)i?["order"] ?? int.MaxValue)
                .Select(i => (string?)i?["id"])
                .FirstOrDefault();
        }

        if (itemId is null)
        {
            // None left (each fires once): make one, the same shape New-LoadTestExercise.ps1 makes.
            var created = await api.CreateBurstItemAsync(staff, $"{_config.Burst.BurstItemTitlePrefix} step {step.Index + 1} (harness)", npcPersonas, ct);
            itemId = (string?)created.Json?["id"];
            if (!created.Success || itemId is null)
            {
                Warn($"Could not create a burst item ({created.Status}); this step runs without it.");
                return;
            }
        }

        var fired = await api.FireInjectAsync(staff, itemId, ct);
        step.BurstItemFired = fired.Success;
        if (!fired.Success)
        {
            Warn($"Firing the burst item answered {fired.Status}.");
        }
    }

    private async Task PacedWritesAsync(PulseApi api, PulseSession staff, IReadOnlyList<string> npcPersonas, string timeZone, DateTimeOffset at, StepResult step, CancellationToken ct)
    {
        var burst = _config.Burst;
        var total = (int)Math.Round(burst.PostsPerMinute * burst.DurationMinutes);
        if (total <= 0)
        {
            return;
        }

        var interval = TimeSpan.FromMinutes(1.0 / burst.PostsPerMinute);
        var inFlight = new List<Task>(total);
        try
        {
            for (var k = 0; k < total; k++)
            {
                // Open loop: post k is due at a fixed instant, whatever the earlier ones are doing, so a slow server
                // does not quietly lower the rate.
                var wait = at + (interval * k) - DateTimeOffset.UtcNow;
                if (wait > TimeSpan.Zero)
                {
                    await Task.Delay(wait, ct);
                }

                var persona = npcPersonas[k % npcPersonas.Count];
                var text = $"Load burst {step.Index + 1}.{k + 1:000}: update from the field at {DateTimeOffset.UtcNow:HH:mm:ss.f}.";
                inFlight.Add(SendControllerPostAsync(api, staff, persona, text, timeZone, step, ct));
                step.PacedPostsSent++;
            }
        }
        finally
        {
            await Task.WhenAll(inFlight.Select(t => t.ContinueWith(_ => { }, TaskScheduler.Default)));
        }
    }

    private async Task SendControllerPostAsync(PulseApi api, PulseSession staff, string persona, string text, string timeZone, StepResult step, CancellationToken ct)
    {
        var expected = OtherConnectedClients(0);
        var sentAt = DateTimeOffset.UtcNow;
        var result = await api.CreateControllerPostAsync(staff, persona, text, timeZone, ct);
        if (result.Success && (string?)result.Json?["id"] is { } postId)
        {
            _tracker.Register(step.Index, postId, sentAt, DateTimeOffset.UtcNow, expected);
        }
    }

    private async Task<ApiResult> SetNoiseAsync(PulseApi api, PulseSession staff, string level, CancellationToken ct)
    {
        var result = await api.SetNoiseAsync(staff, level, ct);
        if (result.Success)
        {
            Info($"  noise {level}.");
        }
        else
        {
            Warn($"PUT /api/staff/noise {level} answered {result.Status}.");
        }

        return result;
    }

    private async Task ShutdownAsync(PulseApi api, PulseSession staff)
    {
        await _activityCts.CancelAsync(); // stop every participant loop first: no new load while shutting down
        using var grace = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        if (_steps.Count > 0) // a dry run, or a stop before step 1, never touched the noise level
        {
            try
            {
                await SetNoiseAsync(api, staff, "off", grace.Token);
            }
            catch (OperationCanceledException)
            {
                Warn("Could not confirm noise off: run Remove-LoadTestExercise.ps1, which turns it off.");
            }
        }

        await Task.WhenAll(_activity.Select(t => t.ContinueWith(_ => { }, TaskScheduler.Default)));
        await Parallel.ForEachAsync(_participants.Values, new ParallelOptions { MaxDegreeOfParallelism = 8 }, async (p, _) =>
        {
            await p.DisposeAsync();
            await api.LogoutAsync(p.Session, grace.Token);
        });
        await api.LogoutAsync(staff, CancellationToken.None);
        Info($"Closed {_participants.Count} connections and signed out.");
    }

    private RunSummary BuildSummary(Uri origin, Guid target, string? targetName, DateTimeOffset startedAt, string? stopReason, bool interrupted)
    {
        var steps = _steps.Select(step =>
        {
            var samples = _log.ForStep(step.Index);
            var series = samples.GroupBy(s => s.Metric, StringComparer.Ordinal)
                .ToDictionary(g => g.Key, g => SeriesSummary.From(g.Key, g.ToArray()), StringComparer.Ordinal);
            var posts = samples.Where(s => StopRuleEvaluator.PostMetrics.Contains(s.Metric)).ToArray();
            series["post-all"] = SeriesSummary.From("post-all", posts);
            return new StepSummary(
                step.Index + 1,
                step.TargetUsers,
                step.Joined,
                step.Connected,
                step.StartedAt,
                step.EndedAt,
                step.StartedAt is { } s && step.EndedAt is { } e ? Math.Round((e - s).TotalSeconds) : null,
                step.StopReason,
                step.NoiseHigh,
                step.BurstItemFired,
                step.PacedPostsSent,
                series,
                _tracker.Summary(step.Index),
                _counters.Reconnects(step.Index),
                _counters.ClosedCount(step.Index),
                _counters.ConnectFailures(step.Index),
                step.Events);
        }).ToList();

        return new RunSummary(
            origin.ToString(),
            target.ToString(),
            targetName,
            startedAt,
            DateTimeOffset.UtcNow,
            stopReason is null && !interrupted && _steps.Count == _config.Steps.Count,
            stopReason,
            interrupted,
            _tracker.UntrackedFrames,
            new ConfigEcho(_config.Steps, _config.StepMinutes, _config.JoinsPerMinute, _config.Activity, _config.Burst, _config.StopRules, _config.FanOut),
            steps);
    }

    /// <summary>One row per missing frame: the post, the client, and how long after its (re)connect the post was accepted.</summary>
    private string DropsCsv()
    {
        var csv = new System.Text.StringBuilder();
        csv.AppendLine("step,postId,acceptedAt,clientId,clientConnectedAt,secondsAfterConnect");
        foreach (var drop in _tracker.Drops)
        {
            foreach (var client in drop.MissingClients)
            {
                var connected = _participants.TryGetValue(client, out var p) ? p.ConnectedAt : null;
                csv.Append(drop.Step + 1).Append(',').Append(drop.PostId).Append(',')
                    .Append(drop.AcceptedAt.ToString("O", CultureInfo.InvariantCulture)).Append(',').Append(client).Append(',')
                    .Append(connected?.ToString("O", CultureInfo.InvariantCulture)).Append(',')
                    .Append(connected is { } c ? (drop.AcceptedAt - c).TotalSeconds.ToString("0.000", CultureInfo.InvariantCulture) : string.Empty)
                    .AppendLine();
            }
        }

        return csv.ToString();
    }

    private string Describe(int step)
    {
        var all = _log.ForStep(step);
        var posts = SeriesSummary.From("post", all.Where(s => StopRuleEvaluator.PostMetrics.Contains(s.Metric)).ToArray());
        var feed = SeriesSummary.From("feed", all.Where(s => s.Metric == Metrics.Feed).ToArray());
        var fan = _tracker.Summary(step);
        return string.Create(CultureInfo.InvariantCulture,
            $"POST p95 {posts.P95Ms} ms ({posts.ErrorRate:P1} errors), feed p95 {feed.P95Ms} ms, fan-out p95 {fan.LagP95Ms} ms, {fan.FramesDropped} dropped, {_counters.Reconnects(step)} reconnects.");
    }

    public void Dispose() => _activityCts.Dispose();

    private void Info(string message) => _out.WriteLine($"{DateTimeOffset.Now:HH:mm:ss} {message}");

    private void Warn(string message) => _out.WriteLine($"{DateTimeOffset.Now:HH:mm:ss} WARN {message}");

    private void Fail(string message) => _out.WriteLine($"{DateTimeOffset.Now:HH:mm:ss} FAIL {message}");

    private sealed class StepResult
    {
        public int Index { get; init; }

        public int TargetUsers { get; init; }

        public int Joined { get; set; }

        public int Connected { get; set; }

        public DateTimeOffset? StartedAt { get; set; }

        public DateTimeOffset? EndedAt { get; set; }

        public string? StopReason { get; set; }

        public bool NoiseHigh { get; set; }

        public bool BurstItemFired { get; set; }

        public int PacedPostsSent;

        public List<string> Events { get; } = [];

        public void Event(string message)
        {
            Events.Add($"{DateTimeOffset.UtcNow:O} {message}");
            Console.WriteLine($"{DateTimeOffset.Now:HH:mm:ss} NOTE step {Index + 1}: {message}");
        }
    }
}
