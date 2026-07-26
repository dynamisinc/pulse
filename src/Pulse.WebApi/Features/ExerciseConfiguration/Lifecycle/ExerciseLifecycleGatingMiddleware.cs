namespace Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The CLOSED list of participant-world routes <see cref="ExerciseLifecycleGatingMiddleware"/> covers
/// (implementation.md → "The participant-gating seam"). Kept as data, separate from the middleware, so the
/// coverage set is directly assertable by a test and readable by a reviewer.
/// </summary>
/// <remarks>
/// <para>
/// <b>An allowlist by construction — this is the pre-auth safety property.</b> The gate matches only the
/// paths named here, so <c>/api/exercise-context</c>, every login route, <c>/api/session</c>, the
/// <c>/api/staff/...</c> surface, <c>/api/telemetry</c>, <c>/api/ops/...</c> and <c>/health</c> are never
/// gated — not because they appear on a second exemption list that could drift, but because they are not on
/// this one. Adding a participant route means adding it HERE; forgetting is a coverage gap, never an
/// accidental lockout of the auth surface.
/// </para>
/// <para>
/// <b>Matched by path SEGMENT prefix, not by verb.</b> <c>/api/threads</c> covers
/// <c>/api/threads/{postId}</c>, and a future <c>/api/posts/{id}/react</c> is covered the day it is mapped.
/// Verb-blind matching is the fail-closed direction: a participant-world path must not become reachable in an
/// archived exercise merely because someone mapped a different verb on it.
/// </para>
/// <para>
/// <b>Known NOT covered:</b> the SignalR hub <c>/hubs/exercise</c>. implementation.md's covered set does not
/// name it and this story does not widen its own scope; nothing publishes into a Build/Completed/Archived
/// exercise, so the hub has nothing to fan out — but a deliberate decision to gate the hub belongs to a story,
/// not to a builder.
/// </para>
/// </remarks>
public static class ExerciseLifecycleGatedRoutes
{
    /// <summary>The gated participant-world path prefixes, in the order implementation.md lists them.</summary>
    public static IReadOnlyList<string> Paths { get; } =
    [
        // The social reads/writes.
        "/api/feed",
        "/api/threads",
        "/api/personas",
        "/api/posts",

        // All six participant-shell config GETs.
        "/api/shell-state",
        "/api/chrome-config",
        "/api/brand-tokens",
        "/api/channel-nav-config",
        "/api/alerts",
        "/api/overlay-state",
    ];

    /// <summary>Whether <paramref name="path"/> is a participant-world route this gate covers.</summary>
    /// <param name="path">The request path.</param>
    /// <returns><c>true</c> when the path is gated.</returns>
    public static bool IsGated(PathString path)
    {
        foreach (var gated in Paths)
        {
            if (path.StartsWithSegments(gated, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}

/// <summary>
/// <b>COR-032's participant fail-closed gate (AC3).</b> In <c>build</c> / <c>completed</c> / <c>archived</c>
/// the participant surface is NOT SERVED: every route in
/// <see cref="ExerciseLifecycleGatedRoutes"/> short-circuits with <c>403 Forbidden</c> before its handler
/// runs. <c>staged</c> and <c>live</c> are the participant-accessible states; <c>paused</c> is served too,
/// because that is the only way the holding page can render (AC6).
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this is middleware and not a projection.</b> <see cref="IShellVariantProjection"/> can only change
/// <c>ShellStateResponse.variant</c>. A builder could return <c>readOnly</c>, tick AC3's wording, and
/// <c>/api/feed</c> would still hand a participant the posts of an ARCHIVED world. Refusing service is a
/// pipeline concern, so it lives here — and the suite asserts <c>/api/feed</c> specifically for exactly that
/// reason.
/// </para>
/// <para>
/// <b>Who is exempt, and why each exemption is safe:</b>
/// </para>
/// <list type="bullet">
///   <item><b>Staff (including evaluators and directors) — exempt.</b> Staff working in <c>build</c> IS the
///   point of <c>build</c>. "Evaluator" is a staff ROLE (<c>StaffAssignment.Role</c>) on a <c>staff</c>-kind
///   session, so a single kind check covers controllers, evaluators, planners and directors alike. The check
///   reuses B2's shipped <see cref="ICurrentStaffSessionAccessor"/> — a live, non-revoked, unexpired
///   <c>staff</c>-kind session bound to a <c>StaffUser</c> — rather than inventing a second notion of "is
///   staff". Note this gate deliberately does NOT also require a <c>StaffAssignment</c> to the resolved
///   exercise: it is a lifecycle gate, not an authorization gate, and every staff-only endpoint already
///   carries <c>EngineCockpitStaffAuthorizationFilter</c> for the assignment check (COR-005). Adding the
///   assignment check here would silently duplicate an authorization decision in a second place.</item>
///   <item><b>The pre-auth allowlist — never reached.</b> <c>/api/exercise-context</c> and every login route
///   are simply not in the covered set, so no code path here can touch them (see
///   <see cref="ExerciseLifecycleGatedRoutes"/>).</item>
///   <item><b>An UNRESOLVED scope — passed through untouched.</b> With no exercise resolved there is no
///   lifecycle to read, and the covered endpoints already fail closed themselves with <c>401</c>. Turning
///   that into a <c>403</c> here would mislabel an unauthenticated request as a forbidden one and would
///   change the shipped status contract of six endpoints.</item>
///   <item><b>A shared read-only (<c>readonly</c>-kind) session is NOT exempt.</b> COR-015's view-only
///   session lands on the PARTICIPANT world (its role is <c>participant</c>); it is an observer of the
///   fiction, not a staff console. It is therefore gated exactly like a participant — the fail-closed
///   direction, and the one that keeps "the participant surface is not served" true for every caller who sees
///   that surface.</item>
/// </list>
/// <para>
/// <b>Ordering (orchestrator-owned).</b> <c>UseExerciseLifecycleGating()</c> MUST be wired AFTER
/// <c>UseExerciseResolution()</c> and <c>UseSessionAuthentication()</c>, so the scope and the session are both
/// already resolved when this decides. Wired earlier, it would read an unset scope on every request and pass
/// everything through — a silent, total no-op.
/// </para>
/// <para>
/// <b>Cost.</b> On a gated route this adds ONE indexed single-column read of the resolved exercise's status.
/// The staff-session lookup runs only when the exercise is NOT participant-accessible, so the common
/// <c>live</c> path costs exactly one query and never touches the sessions table.
/// </para>
/// </remarks>
public sealed partial class ExerciseLifecycleGatingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExerciseLifecycleGatingMiddleware> _logger;

    /// <summary>Creates the middleware.</summary>
    /// <param name="next">The next delegate in the pipeline.</param>
    /// <param name="logger">Diagnostics logger (never logs token material).</param>
    public ExerciseLifecycleGatingMiddleware(RequestDelegate next, ILogger<ExerciseLifecycleGatingMiddleware> logger)
    {
        ArgumentNullException.ThrowIfNull(next);
        ArgumentNullException.ThrowIfNull(logger);

        _next = next;
        _logger = logger;
    }

    /// <summary>
    /// Refuses a covered participant-world request when the resolved exercise is not in a
    /// participant-accessible lifecycle state, unless the caller holds a live staff session.
    /// </summary>
    /// <remarks>
    /// <b>Services are resolved from <see cref="HttpContext.RequestServices"/> AFTER the path check, not
    /// method-injected.</b> Method injection resolves its parameters on EVERY request before the body runs,
    /// which would construct a <c>PulseDbContext</c> for every un-gated request in the app — including the
    /// deliberately DB-independent <c>/health</c> liveness probe the composition root goes out of its way to
    /// keep DB-free. Resolving lazily means a non-gated request costs one path comparison and nothing else.
    /// (Same idiom as <c>EngineCockpitStaffAuthorizationFilter</c>.)
    /// </remarks>
    /// <param name="context">The current request context.</param>
    public async Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        if (!ExerciseLifecycleGatedRoutes.IsGated(context.Request.Path))
        {
            await _next(context);
            return;
        }

        var services = context.RequestServices;
        var lifecycle = services.GetRequiredService<ExerciseLifecycleService>();

        // An unresolved scope is the endpoints' own fail-closed 401, not this gate's 403 (see remarks).
        var state = await lifecycle.GetCurrentStateAsync(context.RequestAborted);
        if (state is null || ExerciseLifecycleStates.IsParticipantAccessible(state))
        {
            await _next(context);
            return;
        }

        // Only now — when the world is actually closed to participants — is the staff exemption worth a query.
        var staffSession = services.GetRequiredService<ICurrentStaffSessionAccessor>();
        var staff = await staffSession.GetCurrentStaffSessionAsync(context.RequestAborted);
        if (staff is not null)
        {
            await _next(context);
            return;
        }

        // Hoisted so the log-argument expression is a plain local read (CA1873).
        var refusedPath = context.Request.Path.Value ?? string.Empty;
        LogParticipantSurfaceRefused(refusedPath, state);
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Information,
        Message = "Refusing the participant-world route {Path}: the resolved exercise is in lifecycle state '{LifecycleState}', which is not participant-accessible (COR-032). Staff sessions are exempt.")]
    private partial void LogParticipantSurfaceRefused(string path, string lifecycleState);
}
