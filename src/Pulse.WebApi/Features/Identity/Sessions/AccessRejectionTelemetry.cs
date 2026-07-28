namespace Pulse.WebApi.Features.Identity.Sessions;

using System.Collections.Concurrent;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseResolution;

/// <summary>
/// Emits the XC-004 <c>access.rejected</c> audit event when the default-deny gate refuses a request
/// (identity-auth-roles/11) — the record that someone reached a gated route with no live session, mirroring
/// the <c>outcome: 'failure'</c> pattern the login services already write.
/// </summary>
/// <remarks>
/// <para>
/// <b>Coalesced, because the anonymous path has no rate limiter.</b> A durable write per rejected request
/// would make the audit trail its own denial-of-service vector: the login-failure events this mirrors sit
/// behind a per-IP limiter, and the gate does not. At most one event is written per
/// (exercise, method, route pattern, status) per <see cref="CoalesceWindow"/>, which bounds a flood of any
/// size to roughly one row per route per minute while still recording that the route was probed. The key uses
/// the ROUTE PATTERN, never the raw path, so a parameterised route cannot inflate either the tracking
/// dictionary or the telemetry table.
/// </para>
/// <para>
/// <b>Scope comes from the request, never the caller.</b> The event is stamped with the resolved
/// <see cref="IExerciseContext.CurrentExerciseId"/> — for a rejected request that is the host-resolved scope
/// (COR-001). When nothing resolved, NO event is written: <see cref="TelemetryEvent"/> is
/// <see cref="IExerciseScoped"/> and an unscoped row is exactly what the write-guard exists to refuse. That
/// also caps the write surface — a probe against a host that maps to no exercise costs nothing.
/// </para>
/// <para>
/// <b>Never throws.</b> Any failure is logged and swallowed; a telemetry problem must not turn a correct 401
/// into a 500.
/// </para>
/// </remarks>
public sealed partial class AccessRejectionTelemetry
{
    /// <summary>The XC-004 event type — additive vocabulary, dotted like the engine/storyline families.</summary>
    private const string AccessRejectedEventType = "access.rejected";

    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";
    private const string RouteTargetEntityType = "route";

    /// <summary>At most one event per key per window (see the class remarks).</summary>
    private static readonly TimeSpan CoalesceWindow = TimeSpan.FromMinutes(1);

    /// <summary>
    /// Hard ceiling on tracked keys. The keyspace is bounded by (exercises × routes × 2 statuses) already;
    /// this is a belt-and-braces cap so an unforeseen key explosion cannot grow unbounded. On overflow the
    /// map is cleared wholesale, which costs at most one extra event per key in that window.
    /// </summary>
    private const int MaxTrackedKeys = 1024;

    private readonly ConcurrentDictionary<string, DateTimeOffset> _lastEmitted = new(StringComparer.Ordinal);
    private readonly ILogger<AccessRejectionTelemetry> _logger;

    /// <summary>Creates the emitter.</summary>
    /// <param name="logger">Diagnostics logger. Never logs token material (NFR-009).</param>
    public AccessRejectionTelemetry(ILogger<AccessRejectionTelemetry> logger)
    {
        ArgumentNullException.ThrowIfNull(logger);
        _logger = logger;
    }

    /// <summary>
    /// Records one rejection, subject to coalescing. Best-effort: returns normally whether or not anything
    /// was written.
    /// </summary>
    /// <param name="context">The rejected request.</param>
    /// <param name="statusCode">The status the gate is about to write (401 or 403).</param>
    public async Task RecordRejectionAsync(HttpContext context, int statusCode)
    {
        ArgumentNullException.ThrowIfNull(context);

        try
        {
            var services = context.RequestServices;
            var exerciseId = services.GetService<IExerciseContext>()?.CurrentExerciseId;
            if (exerciseId is null || exerciseId.Value == Guid.Empty)
            {
                // Nothing resolved this request to an exercise, so there is no scope to stamp a row with.
                return;
            }

            var route = RoutePatternOf(context);
            var now = DateTimeOffset.UtcNow;
            var key = $"{exerciseId.Value}|{context.Request.Method}|{route}|{statusCode}";
            if (!ShouldEmit(key, now))
            {
                return;
            }

            var dbContext = services.GetRequiredService<PulseDbContext>();

            // Exercise is the scope ROOT (never IExerciseScoped), so this read is unfiltered. It supplies the
            // envelope's scenario time + time zone, exactly as the login services do.
            var exercise = await dbContext.Exercises
                .AsNoTracking()
                .FirstOrDefaultAsync(e => e.Id == exerciseId.Value, context.RequestAborted);
            if (exercise is null)
            {
                return;
            }

            dbContext.TelemetryEvents.Add(BuildRejectionTelemetry(
                exerciseId.Value,
                $"{context.Request.Method} {route}",
                statusCode,
                now,
                exercise.CurrentScenarioTime ?? now,
                exercise.TimeZone));

            await dbContext.SaveChangesAsync(context.RequestAborted);
        }
        catch (OperationCanceledException)
        {
            // The client hung up mid-rejection. Nothing to audit, nothing to report.
        }
#pragma warning disable CA1031 // Deliberate: a telemetry failure must never change the gate's response.
        catch (Exception exception)
        {
            LogEmitFailed(exception);
        }
#pragma warning restore CA1031
    }

    /// <summary>
    /// Whether this key's window has elapsed. Racy by design — two threads may both win in the same window and
    /// write two rows; the goal is bounding a flood, not exactly-once accounting.
    /// </summary>
    private bool ShouldEmit(string key, DateTimeOffset now)
    {
        if (_lastEmitted.TryGetValue(key, out var last) && now - last < CoalesceWindow)
        {
            return false;
        }

        if (_lastEmitted.Count >= MaxTrackedKeys)
        {
            _lastEmitted.Clear();
        }

        _lastEmitted[key] = now;
        return true;
    }

    /// <summary>
    /// The matched endpoint's route PATTERN (bounded cardinality), falling back to a constant rather than the
    /// raw path — a raw path would put caller-controlled text into both the coalescing key and the audit row.
    /// </summary>
    private static string RoutePatternOf(HttpContext context)
        => context.GetEndpoint() is RouteEndpoint routeEndpoint
            ? routeEndpoint.RoutePattern.RawText ?? "(unnamed route)"
            : "(unmatched route)";

    /// <summary>
    /// Builds the locked v0 envelope for a rejection: <c>actor.kind: 'system'</c> with NO participant/persona/
    /// acting-human id (there is no authenticated identity to attribute to — that is the whole event),
    /// <c>channel: 'system'</c>, and the attempted route as the target. Payload stays a fixed-size literal.
    /// </summary>
    private static TelemetryEvent BuildRejectionTelemetry(
        Guid exerciseId,
        string route,
        int statusCode,
        DateTimeOffset now,
        DateTimeOffset scenarioTime,
        string timeZone) => new()
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = exerciseId,
            EventType = AccessRejectedEventType,
            Channel = SystemChannel,
            Actor = new TelemetryActor { Kind = SystemActorKind },
            WallClockTime = now,
            ScenarioTime = scenarioTime,
            TimeZone = timeZone,
            Target = new TelemetryTarget { EntityType = RouteTargetEntityType, EntityId = route },
            Payload = $"{{\"outcome\":\"failure\",\"statusCode\":{statusCode}}}",
            EmittedAt = now,
        };

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Failed to record an access.rejected telemetry event; the gate's response is unaffected.")]
    private partial void LogEmitFailed(Exception exception);
}
