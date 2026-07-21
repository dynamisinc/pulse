namespace Pulse.WebApi.Features.ExerciseResolution;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;

/// <summary>
/// Default <see cref="IHostExerciseResolver"/> — a straightforward per-request lookup of the
/// <see cref="Data.Entities.Exercise"/> whose provisioned <c>Hostname</c> (subdomain) or optional
/// <c>BrandedDomain</c> matches the request host, exact-match and case-normalized (COR-008, NFR-004).
/// <see cref="Data.Entities.Exercise"/> is NOT an <see cref="IExerciseScoped"/> entity, so the read is not
/// itself scope-filtered — that is what lets it discover the scope in the first place.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a fresh DI scope per lookup (the always-Critical correctness point).</b> <see cref="PulseDbContext"/>
/// captures its scope ONCE, at construction, from the injected <see cref="IExerciseContext"/>. If this
/// resolver used the <i>request-scoped</i> context, that context would be built (and its filter locked to
/// the still-unset <see cref="System.Guid.Empty"/>) BEFORE the middleware writes the resolved scope — so
/// every later scoped read on that same instance would wrongly see zero rows. Opening a short-lived
/// <see cref="IServiceScope"/> here keeps the lookup fully isolated: the request-scoped context is left
/// untouched and is constructed lazily by the endpoint AFTER the middleware has set the scope, capturing the
/// correct exercise. Registered as a singleton (it is stateless and holds only the scope factory).
/// </para>
/// <para>
/// <b>Fail closed on any resolution error.</b> A malformed host is rejected before the query
/// (<see cref="ExerciseHostName.TryNormalize"/>). A transient failure of the lookup itself is caught and
/// treated as "unresolved" (returns <c>null</c>) rather than surfacing a 500 for every request through the
/// pipeline — including the DB-independent liveness probe. An unresolved scope is the safe outcome (zero
/// rows), never a leak.
/// </para>
/// </remarks>
public sealed partial class HostExerciseResolver : IHostExerciseResolver
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<HostExerciseResolver> _logger;

    /// <summary>Creates the resolver over the root scope factory it uses to open isolated lookup scopes.</summary>
    /// <param name="scopeFactory">Factory for the short-lived DI scope each lookup runs in (see remarks).</param>
    /// <param name="logger">Diagnostics logger (a swallowed lookup failure is logged as a warning).</param>
    public HostExerciseResolver(IServiceScopeFactory scopeFactory, ILogger<HostExerciseResolver> logger)
    {
        ArgumentNullException.ThrowIfNull(scopeFactory);
        ArgumentNullException.ThrowIfNull(logger);

        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<Guid?> ResolveExerciseIdAsync(string? rawHost, CancellationToken cancellationToken)
    {
        // NFR-004: validate/normalize BEFORE any query. A malformed host is never used to build a lookup.
        if (!ExerciseHostName.TryNormalize(rawHost, out var host))
        {
            return null;
        }

        try
        {
            // Isolated lookup scope — never the request-scoped PulseDbContext (see the class remarks). The
            // fresh context's own scope is irrelevant: Exercise is unscoped, so the query is not filtered.
            await using var scope = _scopeFactory.CreateAsyncScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<PulseDbContext>();

            // Exact match, case-insensitive at the database (SQL_Latin1_General_CP1_CI_AS) against the
            // normalized (lower-cased) host, on either the default subdomain or the optional branded domain.
            var exerciseId = await dbContext.Exercises
                .AsNoTracking()
                .Where(exercise => exercise.Hostname == host || exercise.BrandedDomain == host)
                .Select(exercise => (Guid?)exercise.Id)
                .FirstOrDefaultAsync(cancellationToken);

            return exerciseId;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Fail closed: an unresolvable lookup yields no scope (zero rows), never a default/first exercise.
            LogResolutionFailed(host, ex);
            return null;
        }
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Host → exercise resolution failed for host '{Host}'; leaving scope unresolved.")]
    private partial void LogResolutionFailed(string host, Exception exception);
}
