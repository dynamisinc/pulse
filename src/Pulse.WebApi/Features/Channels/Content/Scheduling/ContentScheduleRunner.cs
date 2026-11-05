namespace Pulse.WebApi.Features.Channels.Content.Scheduling;

using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

/// <summary>
/// The scheduled-publish runner (channels-foundation story 05; NWS-013, PRS-003, COR-050/051): a hosted service that
/// publishes each <c>scheduled</c> content item once the exercise's scenario time reaches its
/// <see cref="Data.Entities.ContentItem.ScheduledScenarioTime"/>, so embargoed releases and scheduled articles go live
/// with every console closed and survive a restart. A thin loop over <see cref="IContentPublishService.PublishAsync"/>:
/// it adds no lifecycle logic of its own.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scope for a non-request caller (COR-001), the <c>InjectBurstRunner</c> pattern.</b> A trusted discovery read takes
/// only <c>(ExerciseId, Id, ScheduledScenarioTime, Version)</c> of scheduled items across exercises
/// (<c>IgnoreQueryFilters</c>, no content leaves it). Each due item is then published inside its OWN DI scope whose
/// <see cref="ExerciseContext.CurrentExerciseId"/> (and organization) is set BEFORE the funnel and
/// <see cref="PulseDbContext"/> are resolved, so every read and write is confined to that exercise.
/// </para>
/// <para>
/// <b>Due is scenario time.</b> An item is due when its scheduled instant is at or before the exercise's scenario time
/// (<see cref="IExerciseClock"/>, else the persisted <c>Exercise.CurrentScenarioTime</c>). An exercise whose scenario
/// time is unknown publishes nothing: the wall clock never decides. Due items go out in scheduled order, and the funnel
/// stamps each with its OWN scheduled time, so a forward jump past several keeps the timeline honest (COR-051). A
/// backward jump makes nothing due and never un-publishes anything. Only an exercise whose lifecycle state fires
/// scenario content (COR-032 <c>live</c>) publishes: a <c>build</c>, <c>staged</c>, <c>paused</c>, <c>completed</c> or
/// <c>archived</c> exercise keeps its items scheduled, however stale its persisted scenario time.
/// </para>
/// <para>
/// <b>Publish options (FC-7a).</b> The runner calls <see cref="IScheduledContentPublisher.PublishDueAsync"/>, the funnel's
/// option-less publish (exactly <c>PublishAsync(id, null, …)</c> plus the claim below), so it replays the item's
/// persisted <c>PublishOptionsJson</c> or the kind's <c>ResolvePublishOptions</c>; the alert and paired post chosen at
/// schedule time fire at publish. The caller is the human who scheduled the item (<see cref="ScheduledByReader"/>).
/// </para>
/// <para>
/// <b>Exactly once (the <c>Version</c> token).</b> The publish is a claim on the item as discovered: it goes ahead only
/// if the item is still <c>scheduled</c>, still due and still at the discovered <c>Version</c>, and it commits under
/// the item's concurrency token. So a second instance (or a tick retried after a restart) loses the race, and a staff
/// unschedule, edit or reschedule that landed since discovery wins; either way the runner gets
/// <see cref="ContentPublishOutcome.Conflict"/> and skips silently. The side effects run only after the winning commit,
/// so they never fire twice.
/// </para>
/// <para>
/// <b>A refusal is visible, not a retry loop.</b> When the funnel refuses the publish (<c>Invalid</c>: a deleted outlet,
/// a payload that no longer validates; or <c>Held</c> by a gate), <see cref="IScheduledContentPublisher"/> returns
/// the item to <c>draft</c> with a staff-visible <c>LastError</c> and one <c>content_schedule_failed</c> event, so it is
/// not found again.
/// </para>
/// <para>
/// <b>Pause tiers.</b> Under WORLD FROZEN (or a frozen clock) an exercise publishes nothing and its items stay
/// <c>scheduled</c>. INJECTS PAUSED and ENGINE PAUSED do not block: scheduled content is authored world content, not an
/// inject or engine output.
/// </para>
/// <para>
/// <b>Cadence.</b> One sweep every <see cref="ContentScheduleRunnerOptions.Interval"/>, and at once when any exercise's
/// clock changes (a jump, a resume: <see cref="ContentScheduleClockObserver"/> pokes <see cref="ContentScheduleSignal"/>).
/// No database work while the host starts (the first sweep waits one interval or a wake-up); a failing sweep backs off,
/// doubling up to <see cref="ContentScheduleRunnerOptions.MaxFailureBackoff"/>, and a repeated failure is logged once.
/// One poisoned item is logged once and never stops the rest.
/// </para>
/// <para>
/// <b>Inert in a host that does not compose the world.</b> The pause tiers and the exercise clock are what make a publish
/// safe (Freeze, scenario time), so a host that registers neither (a slice test host calling <c>AddChannels()</c> alone)
/// gets a runner that logs once and does nothing, rather than a host that fails to start or a runner that publishes
/// blind. <c>Program.cs</c> composes both; the composition-root wiring test pins that the runner is live there.
/// </para>
/// </remarks>
public sealed partial class ContentScheduleRunner : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly PauseTierRegistry? _pauseTiers;
    private readonly IExerciseClock? _clock;
    private readonly TimeProvider _timeProvider;
    private readonly ContentScheduleSignal _signal;
    private readonly ContentScheduleRunnerOptions _options;
    private readonly ILogger<ContentScheduleRunner> _logger;

    // The failure last logged for each item that is failing, so a poisoned item is logged once, not every sweep.
    private readonly ConcurrentDictionary<Guid, string> _itemFailures = new();

    /// <summary>Creates the runner.</summary>
    /// <param name="scopeFactory">Creates the discovery scope and one scope per item.</param>
    /// <param name="pauseTiers">The in-memory tiered-pause state; null (not composed) makes the runner inert.</param>
    /// <param name="clock">The native exercise clock (scenario time, COR-053); null (not composed) makes the runner inert.</param>
    /// <param name="timeProvider">The server clock driving the cadence only.</param>
    /// <param name="signal">The wake-up line a clock change pokes.</param>
    /// <param name="options">The cadences.</param>
    /// <param name="logger">Diagnostics logger.</param>
    public ContentScheduleRunner(
        IServiceScopeFactory scopeFactory,
        PauseTierRegistry? pauseTiers,
        IExerciseClock? clock,
        TimeProvider timeProvider,
        ContentScheduleSignal signal,
        ContentScheduleRunnerOptions options,
        ILogger<ContentScheduleRunner> logger)
    {
        ArgumentNullException.ThrowIfNull(scopeFactory);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(signal);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(logger);

        _scopeFactory = scopeFactory;
        _pauseTiers = pauseTiers;
        _clock = clock;
        _timeProvider = timeProvider;
        _signal = signal;
        _options = options;
        _logger = logger;
    }

    /// <summary>
    /// The wait before the next sweep: <see cref="ContentScheduleRunnerOptions.Interval"/>, and after
    /// <paramref name="consecutiveFailures"/> failed sweeps in a row the interval doubled per further failure, never more
    /// than <see cref="ContentScheduleRunnerOptions.MaxFailureBackoff"/> and never less than the interval.
    /// </summary>
    /// <param name="consecutiveFailures">How many sweeps in a row have failed (0 after a success).</param>
    /// <param name="options">The cadences.</param>
    /// <returns>How long to wait (a wake-up still cuts it short).</returns>
    public static TimeSpan NextDelay(int consecutiveFailures, ContentScheduleRunnerOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var interval = options.Interval > TimeSpan.Zero ? options.Interval : TimeSpan.FromSeconds(5);
        if (consecutiveFailures <= 0)
        {
            return interval;
        }

        var cap = options.MaxFailureBackoff > interval ? options.MaxFailureBackoff : interval;
        var backoffTicks = interval.Ticks * Math.Pow(2, Math.Min(consecutiveFailures - 1, 30));
        return backoffTicks >= cap.Ticks ? cap : TimeSpan.FromTicks((long)backoffTicks);
    }

    /// <summary>Whether the host composed what a safe publish needs (the pause tiers and the exercise clock).</summary>
    public bool IsActive => _pauseTiers is not null && _clock is not null;

    /// <summary>
    /// One sweep: discovers the scheduled items, then publishes each due one, in scheduled order, inside its exercise's
    /// own scope. A failure on one item never stops the sweep for the rest.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>How many items this sweep published.</returns>
    public async Task<int> RunTickAsync(CancellationToken cancellationToken = default)
    {
        if (_pauseTiers is not { } pauseTiers || _clock is not { } clock)
        {
            return 0;
        }

        List<ScheduledItem> scheduled;
        Dictionary<Guid, ExerciseFacts> exercises;
        await using (var discoveryScope = _scopeFactory.CreateAsyncScope())
        {
            var dbContext = discoveryScope.ServiceProvider.GetRequiredService<PulseDbContext>();

            // Trusted server-side discovery across exercises: ids and the schedule only, each item then published in its
            // own scope. A fixed order (exercise, scheduled time, id) keeps the publish order stable and honest.
            scheduled = await dbContext.ContentItems
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(item => item.Status == ChannelVocabulary.StatusScheduled
                    && item.DeletedAt == null
                    && item.ScheduledScenarioTime != null
                    && item.ExerciseId != Guid.Empty)
                .OrderBy(item => item.ExerciseId)
                .ThenBy(item => item.ScheduledScenarioTime)
                .ThenBy(item => item.Id)
                .Select(item => new ScheduledItem(item.ExerciseId, item.Id, item.ScheduledScenarioTime!.Value, item.Version))
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            var exerciseIds = scheduled.Select(item => item.ExerciseId).Distinct().ToList();
            if (exerciseIds.Count == 0)
            {
                _itemFailures.Clear();
                return 0;
            }

            // org-scope-exempt(ResolvedScope): the ids are the exercises of scheduled items the trusted discovery read above
            // found (never a request field); each row supplies that exercise's own tenant and persisted scenario time for
            // its per-item scope, so the read cannot reach another exercise or customer tenant.
            exercises = await dbContext.Exercises
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(exercise => exerciseIds.Contains(exercise.Id))
                .Select(exercise => new ExerciseFacts(
                    exercise.Id, exercise.OrganizationId, exercise.Status, exercise.CurrentScenarioTime))
                .ToDictionaryAsync(exercise => exercise.ExerciseId, cancellationToken)
                .ConfigureAwait(false);
        }

        // Forget failures of items that are no longer scheduled (published, back to draft, deleted), so the map cannot grow.
        foreach (var failedItem in _itemFailures.Keys)
        {
            if (!scheduled.Any(item => item.ItemId == failedItem))
            {
                _itemFailures.TryRemove(failedItem, out _);
            }
        }

        var published = 0;
        foreach (var group in scheduled.GroupBy(item => item.ExerciseId))
        {
            if (!exercises.TryGetValue(group.Key, out var exercise)
                || !ExerciseLifecycleStates.BehaviourOf(exercise.Status).ScenarioContentFires
                || pauseTiers.GetTier(group.Key) == PauseTier.Freeze
                || clock.IsFrozen(group.Key)
                || (clock.CurrentScenarioTime(group.Key) ?? exercise.CurrentScenarioTime) is not { } scenarioNow)
            {
                continue;
            }

            foreach (var item in group.Where(item => item.ScheduledScenarioTime <= scenarioNow))
            {
                try
                {
                    if (await PublishItemAsync(item, exercise, cancellationToken).ConfigureAwait(false))
                    {
                        published++;
                    }

                    _itemFailures.TryRemove(item.ItemId, out _);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
#pragma warning disable CA1031 // One item's fault must not stop scheduled publishing for any other item.
                catch (Exception ex)
                {
                    var signature = FailureSignature(ex);
                    if (!_itemFailures.TryGetValue(item.ItemId, out var logged)
                        || !string.Equals(logged, signature, StringComparison.Ordinal))
                    {
                        LogItemFailed(ex, item.ExerciseId, item.ItemId);
                        _itemFailures[item.ItemId] = signature;
                    }
                }
#pragma warning restore CA1031
            }
        }

        return published;
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Never run inline in the host's start-up, and never sweep during it: the first sweep waits one interval (or a
        // wake-up), so a host that is starting does no database work on the runner's behalf.
        await Task.Yield();

        if (!IsActive)
        {
            LogInert();
            return;
        }

        var consecutiveFailures = 0;
        string? lastLoggedFailure = null;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await _signal.WaitAsync(NextDelay(consecutiveFailures, _options), _timeProvider, stoppingToken)
                    .ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            try
            {
                await RunTickAsync(stoppingToken).ConfigureAwait(false);
                if (consecutiveFailures > 0)
                {
                    LogSweepRecovered(consecutiveFailures);
                }

                consecutiveFailures = 0;
                lastLoggedFailure = null;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
#pragma warning disable CA1031 // A transient failure (e.g. the database briefly unreachable) must not stop the runner.
            catch (Exception ex)
            {
                consecutiveFailures++;
                var signature = FailureSignature(ex);
                if (!string.Equals(signature, lastLoggedFailure, StringComparison.Ordinal))
                {
                    LogSweepFailed(ex, consecutiveFailures);
                    lastLoggedFailure = signature;
                }
            }
#pragma warning restore CA1031
        }
    }

    /// <summary>What makes two failures "the same" for logging: the exception type and message.</summary>
    private static string FailureSignature(Exception exception) =>
        $"{exception.GetType().FullName}: {exception.Message}";

    /// <summary>Publishes one due item in its own scope; <c>true</c> when this call published it.</summary>
    private async Task<bool> PublishItemAsync(ScheduledItem item, ExerciseFacts exercise, CancellationToken cancellationToken)
    {
        // A fresh scope per item: each publish owns a clean unit of work, so one item's conflict or fault cannot leave
        // tracked state behind for the next.
        await using var scope = _scopeFactory.CreateAsyncScope();
        var services = scope.ServiceProvider;

        // Set the server-authoritative scope BEFORE resolving anything that captures it (PulseDbContext reads both in its
        // constructor) — never a client value (COR-001). The tenant is the exercise's own, from the discovery read.
        if (services.GetRequiredService<IExerciseContext>() is ExerciseContext exerciseContext)
        {
            exerciseContext.CurrentExerciseId = item.ExerciseId;
        }
        else
        {
            throw new InvalidOperationException(
                "The registered IExerciseContext is not settable; the content schedule runner cannot establish its scope (COR-001).");
        }

        switch (services.GetService<IOrganizationContext>())
        {
            case OrganizationContext organizationContext:
                organizationContext.CurrentOrganizationId = exercise.OrganizationId;
                break;
            case null:
                break;
            default:
                throw new InvalidOperationException(
                    "The registered IOrganizationContext is not settable; the content schedule runner cannot establish its tenant.");
        }

        // Null: the item is not visible in its own scope (deleted since discovery), so there is nothing to publish.
        if (await services.GetRequiredService<ScheduledByReader>().ReadAsync(item.ItemId, cancellationToken).ConfigureAwait(false)
            is not { } scheduledBy)
        {
            return false;
        }

        var caller = scheduledBy.Caller;
        var publisher = services.GetRequiredService<IScheduledContentPublisher>();

        // The claim: published only if still scheduled, still due and still at the discovered version — a staff unschedule
        // or edit that landed since discovery wins (Conflict, skipped below).
        var result = await publisher
            .PublishDueAsync(item.ItemId, item.Version, scheduledBy.ScheduledAt, caller, cancellationToken)
            .ConfigureAwait(false);

        switch (result.Outcome)
        {
            case ContentPublishOutcome.Ok:
                return true;

            case ContentPublishOutcome.Invalid or ContentPublishOutcome.Held:
                var error = result.Errors.Count == 0
                    ? "The scheduled publish was refused."
                    : string.Join("; ", result.Errors);
                if (await publisher
                        .RecordScheduleFailureAsync(item.ItemId, item.Version, error, caller, cancellationToken)
                        .ConfigureAwait(false))
                {
                    LogPublishRefused(item.ExerciseId, item.ItemId, result.Outcome);
                }

                return false;

            default:
                // Conflict: another instance or a staff action got there first, or the item is no longer due. NotFound:
                // deleted meanwhile. Skip silently.
                return false;
        }
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Content schedule runner sweep failed ({ConsecutiveFailures} in a row); backing off. The same failure is not logged again until it changes or a sweep succeeds.")]
    private partial void LogSweepFailed(Exception exception, int consecutiveFailures);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Error,
        Message = "Content schedule runner failed to publish item {ItemId} of exercise {ExerciseId}; every other item was unaffected. The same failure on this item is not logged again.")]
    private partial void LogItemFailed(Exception exception, Guid exerciseId, Guid itemId);

    [LoggerMessage(
        EventId = 3,
        Level = LogLevel.Information,
        Message = "Content schedule runner recovered after {FailedSweeps} failed sweeps.")]
    private partial void LogSweepRecovered(int failedSweeps);

    [LoggerMessage(
        EventId = 5,
        Level = LogLevel.Error,
        Message = "Content schedule runner is inactive: this host registers no pause tiers or exercise clock, so scheduled content will not publish.")]
    private partial void LogInert();

    [LoggerMessage(
        EventId = 4,
        Level = LogLevel.Information,
        Message = "Scheduled publish of item {ItemId} in exercise {ExerciseId} was refused ({Outcome}); the item is back in draft with its error.")]
    private partial void LogPublishRefused(Guid exerciseId, Guid itemId, ContentPublishOutcome outcome);

    /// <summary>A scheduled item found by the discovery read — ids and the schedule only.</summary>
    private sealed record ScheduledItem(Guid ExerciseId, Guid ItemId, DateTimeOffset ScheduledScenarioTime, int Version);

    /// <summary>The exercise facts the sweep needs: its tenant, lifecycle state and persisted scenario time.</summary>
    private sealed record ExerciseFacts(Guid ExerciseId, Guid OrganizationId, string Status, DateTimeOffset? CurrentScenarioTime);
}

/// <summary>The <see cref="ContentScheduleRunner"/> cadences.</summary>
public sealed class ContentScheduleRunnerOptions
{
    /// <summary>
    /// The period between sweeps — and the wait before the FIRST sweep after start-up; a clock change cuts it short.
    /// Default 5 s.
    /// </summary>
    public TimeSpan Interval { get; init; } = TimeSpan.FromSeconds(5);

    /// <summary>
    /// The longest wait between sweeps while sweeps keep failing (the wait doubles from <see cref="Interval"/> per
    /// failure up to this). Default 60 s.
    /// </summary>
    public TimeSpan MaxFailureBackoff { get; init; } = TimeSpan.FromSeconds(60);
}
