namespace Pulse.WebApi.Features.Channels.Alerts;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// The ONE alert source every channel raises into (channels-foundation story 10, PRT-010/011): a weather warning, a
/// console flag (CTL-021) and a news flash are the same <see cref="ChannelAlert"/> with a different
/// <c>sourceChannel</c>. Implements <see cref="IAlertRaiser"/> for in-process raisers, the staff raise/clear routes, and
/// the scenario-time expiry the sweep drives.
/// </summary>
/// <remarks>
/// <para>
/// <b>Every change, one shape.</b> A raise, clear or expiry (1) writes the row and its XC-004 event in ONE
/// <c>SaveChanges</c> (FC-6), then (2) broadcasts <c>AlertsChanged</c> with the FULL active set (FC-5), then (3) hands
/// the alert to the SOC-072 bridge while it is enabled. Steps 2 and 3 run after the commit with no request token, and
/// their faults are logged, never surfaced: a committed alert must not answer 500.
/// </para>
/// <para>
/// <b>Server-authoritative.</b> Scope comes only from <see cref="IExerciseContext"/> (COR-001), the issue instant only
/// from the exercise clock (COR-053), and provenance only from the caller's session (the staff routes read it from
/// <see cref="ICurrentStaffSessionAccessor"/>). Another exercise's alert id is indistinguishable from an unknown one.
/// </para>
/// <para>
/// <b>In-fiction only.</b> Nothing here can mark an alert real-world: a real-world message is only the break-fiction
/// overlay (SHELL-CONTRACT §2).
/// </para>
/// </remarks>
public sealed partial class AlertService : IAlertRaiser
{
    private readonly PulseDbContext _dbContext;
    private readonly AlertReader _reader;
    private readonly ICurrentStaffSessionAccessor _staffSession;
    private readonly IFeedBroadcaster _broadcaster;
    private readonly IPlatformAlertNotifier _platformNotifier;
    private readonly AlertAnnouncementGate _announcementGate;
    private readonly ChannelAlertOptions _options;
    private readonly ILogger<AlertService> _logger;

    /// <summary>Creates the alert source.</summary>
    /// <param name="dbContext">The exercise-scoped persistence context.</param>
    /// <param name="reader">The read side (active set, clock read, scope).</param>
    /// <param name="staffSession">The server-side staff session — the staff routes' only source of the acting human.</param>
    /// <param name="broadcaster">The realtime fan-out (<c>AlertsChanged</c>, FC-5).</param>
    /// <param name="platformNotifier">The SOC-072 bridge.</param>
    /// <param name="announcementGate">Orders each exercise's <c>AlertsChanged</c> frames.</param>
    /// <param name="options">The alert source options.</param>
    /// <param name="logger">Diagnostics logger.</param>
    public AlertService(
        PulseDbContext dbContext,
        AlertReader reader,
        ICurrentStaffSessionAccessor staffSession,
        IFeedBroadcaster broadcaster,
        IPlatformAlertNotifier platformNotifier,
        AlertAnnouncementGate announcementGate,
        IOptions<ChannelAlertOptions> options,
        ILogger<AlertService> logger)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(reader);
        ArgumentNullException.ThrowIfNull(staffSession);
        ArgumentNullException.ThrowIfNull(broadcaster);
        ArgumentNullException.ThrowIfNull(platformNotifier);
        ArgumentNullException.ThrowIfNull(announcementGate);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(logger);

        _dbContext = dbContext;
        _reader = reader;
        _staffSession = staffSession;
        _broadcaster = broadcaster;
        _platformNotifier = platformNotifier;
        _announcementGate = announcementGate;
        _options = options.Value;
        _logger = logger;
    }

    // ---- IAlertRaiser ----------------------------------------------------------------------------------

    /// <inheritdoc />
    /// <exception cref="InvalidOperationException">The exercise scope is unresolved (COR-001).</exception>
    /// <exception cref="ArgumentException">The raise or the caller is invalid (the message says why).</exception>
    public async Task<AlertDto> RaiseAsync(
        AlertRaise raise, ContentCaller caller, CancellationToken cancellationToken = default)
    {
        var outcome = await TryRaiseAsync(raise, caller, cancellationToken);
        return outcome switch
        {
            { Alert: { } alert } => alert,
            { Unresolved: true } => throw new InvalidOperationException(
                "An alert can only be raised inside a resolved exercise scope (COR-001)."),
            _ => throw new ArgumentException(outcome.Error, nameof(raise)),
        };
    }

    /// <inheritdoc />
    public async Task<bool> ClearAsync(Guid id, ContentCaller caller, CancellationToken cancellationToken = default)
    {
        if (AlertRaiseValidator.ValidateCaller(caller) is { } callerError)
        {
            throw new ArgumentException(callerError, nameof(caller));
        }

        if (_reader.ResolvedScope() is not { } exerciseId)
        {
            return false;
        }

        var time = await _reader.ReadTimeAsync(exerciseId, cancellationToken);

        // The central filter confines this to the resolved exercise: a cross-exercise id reads as absent.
        var alert = await _dbContext.ChannelAlerts.FirstOrDefaultAsync(row => row.Id == id, cancellationToken);
        if (alert is null || !IsActive(alert, time.KnownScenarioTime))
        {
            return false;
        }

        alert.ClearedScenarioTime = time.ScenarioTime;
        alert.Version++;
        _dbContext.TelemetryEvents.Add(AlertTelemetry.ForCleared(alert, caller, time));

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Someone else cleared (or the sweep expired) it first: it is no longer active, and their save announced it.
            _dbContext.ChangeTracker.Clear();
            return false;
        }

        await AnnounceAsync(exerciseId, raised: null, clearedIds: [alert.Id]);
        return true;
    }

    // ---- staff routes ----------------------------------------------------------------------------------

    /// <summary><c>POST /api/alerts</c>: a controller raises a console alert (source <c>system</c>).</summary>
    /// <param name="request">The request body.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The raised alert, a readable error, or the fail-closed outcome.</returns>
    public async Task<AlertRaiseOutcome> RaiseAsStaffAsync(
        StaffAlertRaiseRequest? request, CancellationToken cancellationToken = default)
    {
        if (await StaffCallerAsync(cancellationToken) is not { } caller)
        {
            return AlertRaiseOutcome.ScopeUnresolved;
        }

        if (request is null)
        {
            return AlertRaiseOutcome.Invalid("A request body is required.");
        }

        var raise = new AlertRaise
        {
            Severity = request.Severity ?? string.Empty,
            Headline = request.Headline ?? string.Empty,
            Href = request.Href,
            SourceChannel = ChannelVocabulary.AlertSourceSystem,
            ExpiresScenarioTime = request.ExpiresScenarioTime,
        };

        return await TryRaiseAsync(raise, caller, cancellationToken);
    }

    /// <summary><c>POST /api/alerts/{id}/clear</c>: a controller clears an active alert.</summary>
    /// <param name="id">The alert id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><c>true</c> when cleared, <c>false</c> when there is no such active alert, null when unresolved.</returns>
    public async Task<bool?> ClearAsStaffAsync(Guid id, CancellationToken cancellationToken = default)
    {
        if (await StaffCallerAsync(cancellationToken) is not { } caller)
        {
            return null;
        }

        return await ClearAsync(id, caller, cancellationToken);
    }

    // ---- expiry ----------------------------------------------------------------------------------------

    /// <summary>
    /// Expires every active alert of the resolved exercise whose scenario-time expiry has passed: stamps it cleared AT
    /// its expiry instant, writes an <c>alert_cleared</c> (reason <c>expired</c>) in the same save, then announces the new
    /// active set once. Called by <see cref="AlertExpirySweeper"/> inside the exercise's own scope.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>How many alerts expired.</returns>
    public async Task<int> ExpireDueAsync(CancellationToken cancellationToken = default)
    {
        if (_reader.ResolvedScope() is not { } exerciseId)
        {
            return 0;
        }

        var time = await _reader.ReadTimeAsync(exerciseId, cancellationToken);
        if (!time.ScenarioKnown)
        {
            // No clock and no persisted scenario instant (not started, or the exercise row is gone): never expire against
            // the wall clock (COR-053). The sweep retries once scenario time is known again.
            return 0;
        }

        var scenarioNow = time.ScenarioTime;
        var due = await _dbContext.ChannelAlerts
            .Where(alert => alert.ClearedScenarioTime == null
                && alert.ExpiresScenarioTime != null
                && alert.ExpiresScenarioTime <= scenarioNow)
            .ToListAsync(cancellationToken);

        if (due.Count == 0)
        {
            return 0;
        }

        foreach (var alert in due)
        {
            alert.ClearedScenarioTime = alert.ExpiresScenarioTime;
            alert.Version++;
            _dbContext.TelemetryEvents.Add(AlertTelemetry.ForExpired(alert, time));
        }

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // A staff clear won the race for one of them; the next sweep retries the rest.
            _dbContext.ChangeTracker.Clear();
            return 0;
        }

        await AnnounceAsync(exerciseId, raised: null, clearedIds: due.Select(alert => alert.Id).ToList());
        return due.Count;
    }

    // ---- core ------------------------------------------------------------------------------------------

    private async Task<AlertRaiseOutcome> TryRaiseAsync(
        AlertRaise raise, ContentCaller caller, CancellationToken cancellationToken)
    {
        if (AlertRaiseValidator.ValidateCaller(caller) is { } callerError)
        {
            return AlertRaiseOutcome.Invalid(callerError);
        }

        if (_reader.ResolvedScope() is not { } exerciseId)
        {
            return AlertRaiseOutcome.ScopeUnresolved;
        }

        var time = await _reader.ReadTimeAsync(exerciseId, cancellationToken);
        var validation = AlertRaiseValidator.Validate(raise, time.ScenarioTime);
        if (validation.Raise is not { } valid)
        {
            return AlertRaiseOutcome.Invalid(validation.Error!);
        }

        var alert = new ChannelAlert
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            Severity = valid.Severity,
            Headline = valid.Headline,
            SourceChannel = valid.SourceChannel,
            SourceContentId = valid.SourceContentId,
            Href = valid.Href,
            IssuedScenarioTime = time.ScenarioTime,
            ExpiresScenarioTime = valid.ExpiresScenarioTime,
            Origin = caller.Origin,
            ActingHumanId = caller.ActingHumanId,
            Version = 1,
        };

        _dbContext.ChannelAlerts.Add(alert);
        _dbContext.TelemetryEvents.Add(AlertTelemetry.ForIssued(alert, caller, time));
        await _dbContext.SaveChangesAsync(cancellationToken);

        var dto = AlertReader.ToDto(alert);
        await AnnounceAsync(exerciseId, raised: dto, clearedIds: []);
        return AlertRaiseOutcome.Raised(dto);
    }

    /// <summary>
    /// After a commit: broadcast the full active set, then feed the SOC-072 bridge. No request token (a client that
    /// disconnects must not cancel the fan-out of a committed change) and no throw (logged instead).
    /// </summary>
    /// <remarks>
    /// The read and the broadcast run under the exercise's <see cref="AlertAnnouncementGate"/>, so two changes that
    /// commit close together cannot send their frames out of order: the frame that goes last was read last, after both
    /// commits, and carries the newest set (per host instance).
    /// </remarks>
    private async Task AnnounceAsync(
        Guid exerciseId, AlertDto? raised, IReadOnlyList<Guid> clearedIds)
    {
        var gate = _announcementGate.For(exerciseId);
        await gate.WaitAsync(CancellationToken.None);
        try
        {
            // Not the request token (a disconnect must not cancel a committed change's fan-out), but bounded: the gate is
            // held across a real SignalR send, and one stalled send must not block every later change in the exercise
            // or the expiry sweep. A timeout is logged like any broadcast fault; clients converge on their next read.
            using var bound = new CancellationTokenSource(_options.BroadcastTimeout);
            var time = await _reader.ReadTimeAsync(exerciseId, bound.Token);
            var active = await _reader.ReadActiveAsync(time.KnownScenarioTime, bound.Token);
            await _broadcaster.BroadcastAlertsChangedAsync(
                exerciseId, new AlertsChangedDto { Alerts = active }, bound.Token);
        }
#pragma warning disable CA1031 // A broadcast fault must never turn a committed alert into a failed request.
        catch (Exception ex)
        {
            LogBroadcastFailed(ex, exerciseId);
        }
#pragma warning restore CA1031
        finally
        {
            gate.Release();
        }

        if (!_options.PlatformNotificationBridgeEnabled)
        {
            return;
        }

        try
        {
            if (raised is not null)
            {
                await _platformNotifier.AlertRaisedAsync(exerciseId, raised, CancellationToken.None);
            }

            foreach (var id in clearedIds)
            {
                await _platformNotifier.AlertClearedAsync(exerciseId, id.ToString(), CancellationToken.None);
            }
        }
#pragma warning disable CA1031 // The bridge is a second rendering; its fault must not undo the first.
        catch (Exception ex)
        {
            LogBridgeFailed(ex, exerciseId);
        }
#pragma warning restore CA1031
    }

    private async Task<ContentCaller?> StaffCallerAsync(CancellationToken cancellationToken)
    {
        if (_reader.ResolvedScope() is null)
        {
            return null;
        }

        var staff = await _staffSession.GetCurrentStaffSessionAsync(cancellationToken);
        return staff is null
            ? null
            : new ContentCaller { Origin = ChannelVocabulary.OriginController, ActingHumanId = staff.StaffUserId.ToString() };
    }

    private static bool IsActive(ChannelAlert alert, DateTimeOffset? scenarioNow) =>
        alert.ClearedScenarioTime is null
        && (scenarioNow is null || alert.ExpiresScenarioTime is null || alert.ExpiresScenarioTime > scenarioNow);

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "AlertsChanged broadcast failed for exercise {ExerciseId}; the alert change is committed and clients converge on their next read.")]
    private partial void LogBroadcastFailed(Exception exception, Guid exerciseId);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Warning,
        Message = "The SOC-072 platform-alert bridge failed for exercise {ExerciseId}; the alert itself is committed and on the bar.")]
    private partial void LogBridgeFailed(Exception exception, Guid exerciseId);
}

/// <summary>The outcome of a raise: the alert, a readable error, or the fail-closed outcome.</summary>
/// <param name="Alert">The raised alert.</param>
/// <param name="Error">The readable validation error.</param>
/// <param name="Unresolved">Whether the scope or the staff session was unresolved (→ 401).</param>
public sealed record AlertRaiseOutcome(AlertDto? Alert, string? Error, bool Unresolved)
{
    /// <summary>The fail-closed outcome.</summary>
    public static AlertRaiseOutcome ScopeUnresolved { get; } = new(null, null, true);

    /// <summary>A raised alert.</summary>
    /// <param name="alert">The alert.</param>
    /// <returns>The outcome.</returns>
    public static AlertRaiseOutcome Raised(AlertDto alert) => new(alert, null, false);

    /// <summary>A refused raise.</summary>
    /// <param name="error">The readable error.</param>
    /// <returns>The outcome.</returns>
    public static AlertRaiseOutcome Invalid(string error) => new(null, error, false);
}
