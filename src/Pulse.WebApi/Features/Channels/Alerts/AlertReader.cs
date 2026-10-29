namespace Pulse.WebApi.Features.Channels.Alerts;

using System.Buffers.Text;
using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>
/// The participant read side of the alert source (channels-foundation story 10): the active set behind
/// <c>GET /api/alerts</c> and the paged history behind <c>GET /api/alerts/history</c> (PRT-012), plus the clock read
/// every alert operation shares.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scope only from <see cref="IExerciseContext"/> (COR-001).</b> Every query goes through the central
/// <c>IExerciseScoped</c> filter, so another exercise's alert is never read; an unresolved scope fails closed
/// (<c>null</c> → 401).
/// </para>
/// <para>
/// <b>Active is decided against scenario time (COR-053).</b> An alert is active while it is not cleared and its
/// expiry, if any, is still after the exercise's current scenario instant. The read applies that rule itself, so an
/// expired alert leaves the bar the moment the clock passes it, before the expiry sweep stamps it.
/// </para>
/// </remarks>
public sealed class AlertReader
{
    /// <summary>The history page size when none is asked for.</summary>
    public const int DefaultHistoryLimit = 50;

    /// <summary>The largest history page.</summary>
    public const int MaxHistoryLimit = 100;

    private const string FallbackTimeZone = "UTC";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly IExerciseClock _exerciseClock;
    private readonly TimeProvider _timeProvider;

    /// <summary>Creates the reader over the scoped persistence, the resolved scope and the exercise clock.</summary>
    /// <param name="dbContext">The exercise-scoped persistence context.</param>
    /// <param name="exerciseContext">The server-authoritative exercise scope (COR-001).</param>
    /// <param name="exerciseClock">The native per-exercise scenario clock (COR-050/053).</param>
    /// <param name="timeProvider">The server wall clock.</param>
    public AlertReader(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        IExerciseClock exerciseClock,
        TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(exerciseClock);
        ArgumentNullException.ThrowIfNull(timeProvider);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _exerciseClock = exerciseClock;
        _timeProvider = timeProvider;
    }

    /// <summary><c>GET /api/alerts</c>: the active set, or <c>null</c> when the scope is unresolved (fail closed).</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The active alerts, highest severity first then newest.</returns>
    public async Task<ActiveAlertsResponse?> GetActiveAsync(CancellationToken cancellationToken = default)
    {
        if (ResolvedScope() is not { } exerciseId)
        {
            return null;
        }

        var time = await ReadTimeAsync(exerciseId, cancellationToken);
        return new ActiveAlertsResponse { Alerts = await ReadActiveAsync(time.ScenarioTime, cancellationToken) };
    }

    /// <summary><c>GET /api/alerts/history</c>: one page of every alert, newest first.</summary>
    /// <param name="cursor">The opaque cursor from the previous page, or null for the first.</param>
    /// <param name="limit">The page size (1..<see cref="MaxHistoryLimit"/>), or null for the default.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The page, a readable error, or the fail-closed outcome.</returns>
    public async Task<AlertHistoryRead> GetHistoryAsync(
        string? cursor, int? limit, CancellationToken cancellationToken = default)
    {
        if (ResolvedScope() is null)
        {
            return AlertHistoryRead.ScopeUnresolved;
        }

        var take = limit ?? DefaultHistoryLimit;
        if (take is < 1 or > MaxHistoryLimit)
        {
            return AlertHistoryRead.Invalid($"limit must be between 1 and {MaxHistoryLimit}.");
        }

        HistoryCursor? position = null;
        if (cursor is not null)
        {
            if (!HistoryCursor.TryDecode(cursor, out var decoded))
            {
                return AlertHistoryRead.Invalid("cursor is not a cursor this endpoint issued.");
            }

            position = decoded;
        }

        // Keyset on IssuedScenarioTime, newest first. Scenario time can stand still (a frozen clock), so many alerts can
        // share one instant: within an instant the order is the database's Id order, and the cursor carries how many of
        // that instant's rows were already served. Guid comparisons are not translatable, so this is an offset WITHIN
        // the tie only, never across the whole history.
        var query = _dbContext.ChannelAlerts.AsNoTracking();
        if (position is { } at)
        {
            var anchor = new DateTimeOffset(at.IssuedUtcTicks, TimeSpan.Zero);
            query = query.Where(alert => alert.IssuedScenarioTime <= anchor);
        }

        var rows = await query
            .OrderByDescending(alert => alert.IssuedScenarioTime)
            .ThenBy(alert => alert.Id)
            .Skip(position?.ServedAtInstant ?? 0)
            .Take(take + 1)
            .ToListAsync(cancellationToken);

        var page = rows.Take(take).ToList();
        string? next = null;
        if (rows.Count > take)
        {
            var last = page[^1].IssuedScenarioTime;
            var servedAtLast = page.Count(alert => alert.IssuedScenarioTime == last);
            if (position is { } previous && previous.IssuedUtcTicks == last.UtcTicks)
            {
                servedAtLast += previous.ServedAtInstant;
            }

            next = new HistoryCursor(last.UtcTicks, servedAtLast).Encode();
        }

        return AlertHistoryRead.Ok(new AlertHistoryResponse { Alerts = page.Select(ToDto).ToList(), NextCursor = next });
    }

    /// <summary>
    /// The active set of the resolved exercise at <paramref name="scenarioNow"/>: not cleared, not expired, highest
    /// severity first, then newest. The set is small (a handful of bar entries), so the severity rank is applied after
    /// the filtered read.
    /// </summary>
    /// <param name="scenarioNow">The exercise's current scenario instant.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The active alerts.</returns>
    internal async Task<IReadOnlyList<AlertDto>> ReadActiveAsync(
        DateTimeOffset scenarioNow, CancellationToken cancellationToken)
    {
        var rows = await _dbContext.ChannelAlerts
            .AsNoTracking()
            .Where(alert => alert.ClearedScenarioTime == null
                && (alert.ExpiresScenarioTime == null || alert.ExpiresScenarioTime > scenarioNow))
            .ToListAsync(cancellationToken);

        return rows
            .OrderByDescending(alert => SeverityRank(alert.Severity))
            .ThenByDescending(alert => alert.IssuedScenarioTime)
            .ThenBy(alert => alert.Id)
            .Select(ToDto)
            .ToList();
    }

    /// <summary>
    /// The one clock read for an operation: server wall clock, plus scenario time from the native exercise clock,
    /// falling back to the persisted scenario instant and finally the wall clock (the inject queue's rule, COR-053).
    /// </summary>
    /// <param name="exerciseId">The resolved exercise.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The clock read.</returns>
    internal async Task<AlertEventTime> ReadTimeAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        // org-scope-exempt(ResolvedScope): exerciseId is the server-resolved scope (IExerciseContext, set by the request
        // pipeline or by the expiry sweep from its own scoped read) and never a request field, so this read of the
        // exercise's own row cannot cross an exercise or a customer tenant.
        var row = await _dbContext.Exercises
            .AsNoTracking()
            .Where(exercise => exercise.Id == exerciseId)
            .Select(exercise => new { exercise.TimeZone, exercise.CurrentScenarioTime })
            .FirstOrDefaultAsync(cancellationToken);

        var now = _timeProvider.GetUtcNow();
        var scenario = _exerciseClock.CurrentScenarioTime(exerciseId) ?? row?.CurrentScenarioTime ?? now;
        var timeZone = string.IsNullOrWhiteSpace(row?.TimeZone) ? FallbackTimeZone : row.TimeZone;
        return new AlertEventTime(now, scenario, timeZone);
    }

    /// <summary>The resolved exercise, or null (fail closed).</summary>
    /// <returns>The exercise id.</returns>
    internal Guid? ResolvedScope() =>
        _exerciseContext.CurrentExerciseId is { } scope && scope != Guid.Empty ? scope : null;

    /// <summary>Projects a row onto the participant-safe FC-3 wire shape: no origin, no acting human (XC-002).</summary>
    /// <param name="alert">The row.</param>
    /// <returns>The DTO.</returns>
    internal static AlertDto ToDto(ChannelAlert alert) => new()
    {
        Id = alert.Id.ToString(),
        Severity = alert.Severity,
        Message = alert.Headline,
        ScenarioTime = Iso(alert.IssuedScenarioTime),
        Href = alert.Href,
        SourceChannel = AlertDto.WireSourceChannel(alert.SourceChannel),
        ContentId = alert.SourceContentId?.ToString(),
        ExpiresScenarioTime = alert.ExpiresScenarioTime is { } expires ? Iso(expires) : null,
    };

    /// <summary>The severity order of the bar: emergency, then advisory, then info.</summary>
    /// <param name="severity">The severity literal.</param>
    /// <returns>A higher number for a more severe alert.</returns>
    internal static int SeverityRank(string severity) => severity switch
    {
        ChannelVocabulary.SeverityEmergency => 2,
        ChannelVocabulary.SeverityAdvisory => 1,
        _ => 0,
    };

    private static string Iso(DateTimeOffset instant) =>
        instant.UtcDateTime.ToString("O", CultureInfo.InvariantCulture);

    /// <summary>The decoded history position: the last instant served and how many of its rows were served.</summary>
    private readonly record struct HistoryCursor(long IssuedUtcTicks, int ServedAtInstant)
    {
        public string Encode() =>
            Base64Url.EncodeToString(Encoding.UTF8.GetBytes(
                string.Create(CultureInfo.InvariantCulture, $"{IssuedUtcTicks}:{ServedAtInstant}")));

        public static bool TryDecode(string value, out HistoryCursor cursor)
        {
            cursor = default;
            string text;
            try
            {
                text = Encoding.UTF8.GetString(Base64Url.DecodeFromChars(value));
            }
            catch (FormatException)
            {
                return false;
            }

            var parts = text.Split(':');
            if (parts.Length != 2
                || !long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var ticks)
                || !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var served)
                || ticks < DateTimeOffset.MinValue.UtcTicks
                || ticks > DateTimeOffset.MaxValue.UtcTicks
                || served < 1)
            {
                return false;
            }

            cursor = new HistoryCursor(ticks, served);
            return true;
        }
    }
}

/// <summary>The outcome of <see cref="AlertReader.GetHistoryAsync"/>.</summary>
/// <param name="Page">The page when the read succeeded.</param>
/// <param name="Error">The readable error for a bad cursor or limit.</param>
/// <param name="Unresolved">Whether the scope was unresolved (fail closed → 401).</param>
public sealed record AlertHistoryRead(AlertHistoryResponse? Page, string? Error, bool Unresolved)
{
    /// <summary>The fail-closed outcome.</summary>
    public static AlertHistoryRead ScopeUnresolved { get; } = new(null, null, true);

    /// <summary>A page.</summary>
    /// <param name="page">The page.</param>
    /// <returns>The outcome.</returns>
    public static AlertHistoryRead Ok(AlertHistoryResponse page) => new(page, null, false);

    /// <summary>A bad request.</summary>
    /// <param name="error">The readable error.</param>
    /// <returns>The outcome.</returns>
    public static AlertHistoryRead Invalid(string error) => new(null, error, false);
}
