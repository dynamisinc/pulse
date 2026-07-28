namespace Pulse.WebApi.Features.Identity.SharedAccess;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The server-side write-path denial for a VIEW-ONLY session (COR-015, story 06) — the load-bearing,
/// isolation-class guarantee that a shared read-only session can NEVER mutate any exercise. A read-only session
/// must be denied every sim write (post / reply / react / follow / DM) at the SERVER, never merely hidden in the
/// UI. This reusable minimal-API <see cref="IEndpointFilter"/> is applied to a sim-write endpoint (or a group of
/// them); it consults <see cref="IReadOnlySessionProbe"/> for the current request's presented session and
/// short-circuits with <c>403 Forbidden</c> when that session is a live read-only session — otherwise the write
/// proceeds to its own scope + validation checks.
/// </summary>
/// <remarks>
/// <para>
/// <b>Fail closed, server-authoritative.</b> The filter trusts nothing from the client about read-only-ness: it
/// resolves the presented token to the persisted <see cref="Data.Entities.Session"/> row and reads
/// <c>IsReadOnly</c> off the SERVER-issued session. It denies BEFORE the handler runs, so no partial mutation
/// can occur. A request that presents no session (or an expired/absent one) is NOT denied here — this filter's
/// single job is the read-only-session denial.
/// </para>
/// <para>
/// <b>Where the absent-session case IS denied (corrected, identity-auth-roles/11).</b> This comment used to
/// claim the unauthenticated case was "handled by the write endpoint's own fail-closed scope check (an
/// unresolved <see cref="IExerciseContext"/> → 401)". That was <b>false as built</b> and is the heart of #359:
/// the endpoint's check was scope-only, and <c>ExerciseResolutionMiddleware</c> resolves a perfectly usable
/// scope for an anonymous caller from the bare <c>Host</c> header — so an absent session sailed straight
/// through this filter AND through the handler, and <c>POST /api/posts</c> accepted an unauthenticated write.
/// It is now true, but for a different reason: the default-deny fallback policy runs in
/// <c>AuthorizationMiddleware</c>, STRICTLY AHEAD of every endpoint filter, so a request with no live session
/// is rejected with 401 before this filter is ever constructed. This filter's behavior is deliberately
/// unchanged — the gap was never in it.
/// </para>
/// <para>
/// <b>Composition (orchestrator-owned).</b> This story does not edit any other slice's files or
/// <c>Program.cs</c>. New sim-write endpoints apply the guard themselves at map time via
/// <see cref="ReadOnlyWriteDenialExtensions.DenyReadOnlySessions{TBuilder}"/>; the pre-existing B1
/// <c>POST /api/posts</c> is guarded centrally by the orchestrator (see this feature's implementation.md for the
/// one-line Program.cs wiring). The filter instance is created per request from request services, so its Scoped
/// <see cref="IReadOnlySessionProbe"/> dependency resolves correctly.
/// </para>
/// </remarks>
public sealed class ReadOnlySessionWriteFilter : IEndpointFilter
{
    private readonly IReadOnlySessionProbe _probe;

    /// <summary>Creates the filter over the read-only-session probe.</summary>
    /// <param name="probe">Resolves whether the current request presents a live read-only session.</param>
    public ReadOnlySessionWriteFilter(IReadOnlySessionProbe probe)
    {
        ArgumentNullException.ThrowIfNull(probe);
        _probe = probe;
    }

    /// <inheritdoc />
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        if (await _probe.IsReadOnlySessionAsync(context.HttpContext, context.HttpContext.RequestAborted))
        {
            // A view-only session must never write (COR-015). Fail closed with 403 before the handler runs.
            return Results.StatusCode(StatusCodes.Status403Forbidden);
        }

        return await next(context);
    }
}

/// <summary>
/// Resolves whether the CURRENT request presents a live, view-only (read-only) session — the single fact the
/// read-only write guard keys off (COR-015). Kept behind an interface so the write filter is unit-testable and
/// the token→session resolution is defined once.
/// </summary>
public interface IReadOnlySessionProbe
{
    /// <summary>
    /// Returns <c>true</c> only when the request carries a bearer token that resolves to a LIVE (non-revoked,
    /// unexpired) session whose <c>IsReadOnly</c> flag is set. Returns <c>false</c> for an
    /// absent/unknown/expired/revoked token (an unauthenticated request is not this guard's concern — the write
    /// endpoint's own scope check denies it).
    /// </summary>
    /// <remarks>
    /// A lookup ERROR (a DB failure, or a theoretical multi-match on the unique-by-<c>TokenHash</c> session) is
    /// deliberately NOT swallowed: it PROPAGATES (surfacing as a 500), so the guarded write handler never runs
    /// and the write is DENIED. That is the fail-SAFE outcome for a write guard whose whole job is
    /// "a read-only session must NEVER write" (COR-015). This MUST NOT be "hardened" into a catch-that-returns-
    /// <c>false</c>: returning <c>false</c> on an error would let the request fall THROUGH to the handler —
    /// fail-OPEN — and could let a write slip past when the read-only status could not be established. When the
    /// answer cannot be determined, denying (by throwing) is correct; allowing is not.
    /// </remarks>
    /// <param name="httpContext">The current request.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><c>true</c> when the request presents a live read-only session; otherwise <c>false</c>.</returns>
    Task<bool> IsReadOnlySessionAsync(HttpContext httpContext, CancellationToken cancellationToken = default);
}

/// <summary>
/// Default <see cref="IReadOnlySessionProbe"/> — hashes the presented opaque bearer token and looks the
/// persisted <see cref="Data.Entities.Session"/> up by <c>TokenHash</c> through the request-scoped
/// <see cref="PulseDbContext"/>, reporting read-only ONLY for a live session. Mirrors
/// <c>CurrentStaffSessionAccessor</c>'s endpoint-time token lookup: it runs after scope resolution (at endpoint
/// execution), and <see cref="Data.Entities.Session"/> is not <see cref="IExerciseScoped"/>, so the lookup is
/// not scope-filtered. No token material is ever logged (NFR-009). Scoped lifetime.
/// </summary>
public sealed class ReadOnlySessionProbe : IReadOnlySessionProbe
{
    private readonly PulseDbContext _dbContext;

    /// <summary>Creates the probe over the request-scoped persistence context the token lookup runs through.</summary>
    /// <param name="dbContext">The request-scoped persistence context.</param>
    public ReadOnlySessionProbe(PulseDbContext dbContext)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        _dbContext = dbContext;
    }

    /// <inheritdoc />
    public async Task<bool> IsReadOnlySessionAsync(HttpContext httpContext, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        if (!SessionTokenExtractor.TryGetBearerToken(httpContext.Request, out var rawToken))
        {
            // No token presented → not a read-only session (the write endpoint's own auth handles the anonymous
            // case). Fail closed here means "do not treat as read-only", never "allow the write".
            return false;
        }

        var tokenHash = SessionTokens.Hash(rawToken);
        var now = DateTimeOffset.UtcNow;

        var session = await _dbContext.Sessions
            .AsNoTracking()
            .SingleOrDefaultAsync(s => s.TokenHash == tokenHash, cancellationToken);

        // Only a LIVE read-only session is denied. An expired/revoked/unknown token authenticates nothing, so it
        // is not this guard's concern (the endpoint fails closed on the unresolved scope instead).
        return session is not null && session.IsLive(now) && session.IsReadOnly;
    }
}

/// <summary>
/// The reusable seam that applies the read-only write denial (COR-015) to a sim-write endpoint or endpoint group
/// — the single mechanism, keyed off the current session's <c>IsReadOnly</c>, that story 06 exports for the
/// orchestrator and for future sim-write stories to wire without per-slice edits.
/// </summary>
public static class ReadOnlyWriteDenialExtensions
{
    /// <summary>
    /// Denies a live read-only session (403) on the endpoint(s) built by <paramref name="builder"/> by adding
    /// the <see cref="ReadOnlySessionWriteFilter"/>. Works on a single <c>RouteHandlerBuilder</c> (one endpoint)
    /// or a <c>RouteGroupBuilder</c> (every sim-write endpoint mapped through the group), so the orchestrator can
    /// guard the pre-existing <c>POST /api/posts</c> centrally — without editing the Social slice — by mapping it
    /// through a guarded group.
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder type (route handler or route group).</typeparam>
    /// <param name="builder">The endpoint / group builder to guard.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static TBuilder DenyReadOnlySessions<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);
        return builder.AddEndpointFilter<TBuilder, ReadOnlySessionWriteFilter>();
    }
}
