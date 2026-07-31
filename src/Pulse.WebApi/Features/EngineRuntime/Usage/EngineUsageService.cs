namespace Pulse.WebApi.Features.EngineRuntime.Usage;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;

/// <summary>
/// Serves the staff-only AI-generation usage rollup behind <c>GET /api/engine/usage</c>
/// (engine-telemetry-tuning story 03a) — the first telemetry READ in <c>Pulse.WebApi</c>. Reads this
/// exercise's <c>engine.generated</c> rows for a wall-clock window, deserializes each opaque payload into the
/// emitter's own <see cref="EngineEventPayloads.Generated"/> record, and hands the result to the pure
/// <see cref="EngineUsageAggregator"/> together with the config-sourced price table. Scoped lifetime, matching
/// the <see cref="PulseDbContext"/> unit of work it reads through.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (COR-001, always-Critical).</b> The query runs as an EF ENTITY query over the
/// <c>IExerciseScoped</c> <see cref="Pulse.WebApi.Data.Entities.TelemetryEvent"/>, so
/// <see cref="PulseDbContext"/>'s CENTRAL read-side query filter
/// (<c>HasQueryFilter(e =&gt; e.ExerciseId == _currentExerciseId)</c>) is what confines it — there is
/// deliberately no hand-written <c>ExerciseId</c> predicate anywhere in this file, and deliberately no
/// <c>FromSql</c>/aggregate SQL returning scalars or DTOs, which would leave the entity pipeline and take the
/// central filter out of the loop. Scope is read ONLY from <see cref="IExerciseContext"/> — never a route,
/// query parameter or body — and an unresolved scope FAILS CLOSED
/// (<see cref="EngineReviewOutcome.ScopeUnresolved"/> → <c>401</c>), never a default/empty <c>200</c>.
/// </para>
/// <para>
/// <b>App-layer projection, ratified.</b> <c>TelemetryEvent.Payload</c> is opaque <c>nvarchar(max)</c> with no
/// index over it and no persisted computed column anywhere in this schema, so SQL-side JSON
/// (<c>JSON_VALUE</c>/<c>OPENJSON</c>) would not avoid the scan either — the decision turned on contract and
/// isolation instead (see <c>implementation.md</c>). Only <c>Payload</c> + <c>WallClockTime</c> are projected;
/// the other ~24 envelope columns are never materialized.
/// </para>
/// <para>
/// <b>Read-only, and no telemetry of its own.</b> This service performs no mutation, so it emits no XC-004
/// event: the one-event-per-meaningful-action rule covers actions, and an observability read that logged
/// itself into the very table it reads would pollute the series it exists to report.
/// </para>
/// </remarks>
public sealed class EngineUsageService
{
    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly IOptions<EngineUsagePricingOptions> _pricingOptions;

    /// <summary>Creates the usage service over its persistence, scope, and price-table collaborators.</summary>
    /// <param name="dbContext">The scoped context whose CENTRAL query filter enforces exercise isolation (COR-001).</param>
    /// <param name="exerciseContext">The server-authoritative exercise scope — the sole scoping source.</param>
    /// <param name="pricingOptions">The bound <c>Generation:Pricing</c> table; absent/empty means every model is UNPRICED.</param>
    public EngineUsageService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        IOptions<EngineUsagePricingOptions> pricingOptions)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(pricingOptions);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _pricingOptions = pricingOptions;
    }

    /// <summary>
    /// Serves the current exercise's AI-generation usage for a wall-clock window ending at the server clock.
    /// </summary>
    /// <param name="windowMinutes">
    /// Requested window length in minutes. <c>null</c> uses
    /// <see cref="EngineUsageAggregator.DefaultWindowMinutes"/>; anything outside
    /// [<see cref="EngineUsageAggregator.MinWindowMinutes"/>,
    /// <see cref="EngineUsageAggregator.MaxWindowMinutes"/>] is rejected <c>400</c> rather than silently
    /// clamped, so a caller is never shown a different window than the one it asked for.
    /// </param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The rollup, or <see cref="EngineReviewOutcome.ScopeUnresolved"/> (fail closed) / <see cref="EngineReviewOutcome.Invalid"/>.</returns>
    public async Task<EngineUsageResult> GetUsageAsync(
        int? windowMinutes = null,
        CancellationToken cancellationToken = default)
    {
        if (!TryResolveScope())
        {
            return EngineUsageResult.ScopeUnresolved();
        }

        var minutes = windowMinutes ?? EngineUsageAggregator.DefaultWindowMinutes;
        if (minutes < EngineUsageAggregator.MinWindowMinutes || minutes > EngineUsageAggregator.MaxWindowMinutes)
        {
            return EngineUsageResult.Invalid(
                $"windowMinutes must be between {EngineUsageAggregator.MinWindowMinutes} and "
                + $"{EngineUsageAggregator.MaxWindowMinutes}.");
        }

        // ONE server clock read per operation, shared by the window and every bucket boundary derived from it.
        var window = EngineUsageAggregator.BuildWindow(DateTimeOffset.UtcNow, minutes);
        var from = window.From;
        var to = window.To;

        // Entity query — the central query filter supplies the exercise predicate (COR-001). Only the two
        // columns the rollup needs are projected.
        var rows = await _dbContext.TelemetryEvents
            .Where(e => e.EventType == EngineEventTypes.Generated)
            .Where(e => e.WallClockTime >= from && e.WallClockTime <= to)
            .OrderBy(e => e.WallClockTime)
            .Select(e => new UsageRow(e.WallClockTime, e.Payload))
            .ToListAsync(cancellationToken);

        var calls = new List<EngineGenerationCall>(rows.Count);
        var unparseable = 0;

        foreach (var row in rows)
        {
            if (EngineUsagePayloadReader.TryRead(row.Payload, out var payload) && payload is not null)
            {
                calls.Add(new EngineGenerationCall(row.WallClockTime, payload));
            }
            else
            {
                unparseable++;
            }
        }

        var priceTable = EngineUsagePriceTable.FromOptions(_pricingOptions.Value);

        return EngineUsageResult.Ok(
            EngineUsageAggregator.Aggregate(calls, unparseable, window, priceTable));
    }

    /// <summary>Resolves the fail-closed exercise scope; <c>false</c> when unresolved (mirrors <c>EngineReviewService</c>).</summary>
    private bool TryResolveScope()
    {
        var scope = _exerciseContext.CurrentExerciseId;
        return scope is not null && scope.Value != Guid.Empty;
    }

    /// <summary>The two projected columns — deliberately NOT the whole ~24-column envelope row.</summary>
    private sealed record UsageRow(DateTimeOffset WallClockTime, string? Payload);
}
