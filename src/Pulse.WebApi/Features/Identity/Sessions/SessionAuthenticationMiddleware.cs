namespace Pulse.WebApi.Features.Identity.Sessions;

using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseResolution;

/// <summary>
/// The session arm of the central exercise scope (COR-001 / COR-012, the hinge). For each request it reads the
/// presented opaque bearer token, resolves the live session it authenticates (via
/// <see cref="ISessionAuthenticator"/>, which uses its own throwaway DI scope), and — with PRECEDENCE over the
/// host middleware's earlier write — sets the request scope to the session's bound exercise. An absent or
/// invalid/expired/revoked token leaves whatever host resolution set (fail closed: the endpoint then 401s and
/// scoped reads see host-only / zero rows). On the live-session path it ALSO assigns
/// <c>HttpContext.User</c> (see <see cref="SessionPrincipal"/>) — the input the default-deny fallback policy
/// (identity-auth-roles/11) evaluates.
/// </summary>
/// <remarks>
/// <para>
/// <b>The gate's single input (identity-auth-roles/11).</b> Before that story, "is a scope resolved" was the
/// only question any endpoint asked — and <c>ExerciseResolutionMiddleware</c> answers it for an anonymous
/// caller from the bare <c>Host</c> header, so every endpoint was reachable with no credential (#359). The fix
/// is not in this middleware's own logic, which was correct: it is that this middleware now publishes the
/// authenticated principal, and <c>app.UseAuthorization()</c> — wired IMMEDIATELY AFTER
/// <c>app.UseSessionAuthentication()</c> — turns "no live session" into a 401 before any endpoint runs. That
/// ordering is load-bearing: <c>WebApplication</c> auto-inserts <c>UseAuthorization()</c> ahead of ALL user
/// middleware when it is never called explicitly, which would evaluate the policy before this middleware has
/// run. The resulting failure is SILENT, not total — the pre-auth allowlist keeps working, so login succeeds
/// and then every authenticated call after it 401s.
/// </para>
/// <para>
/// <b>Precedence (session &gt; host &gt; unset), realized purely by ORDER.</b> This middleware MUST run AFTER
/// <c>UseExerciseResolution()</c> (exercise-isolation/08) so the session's write is the last one to land, and
/// it MUST NOT construct the request-scoped <see cref="PulseDbContext"/> — the token lookup runs in the
/// authenticator's throwaway scope, and this middleware writes only the request-scoped
/// <see cref="IExerciseContext"/> (a plain POCO whose resolution does not build the context). The request
/// context is thus constructed lazily by the endpoint AFTER this write, capturing the session scope. If this
/// middleware built the request context first, its filter would lock to the provisional host scope and
/// precedence would break.
/// </para>
/// <para>
/// <b>Per-kind host binding (the always-Critical participant check).</b> A PARTICIPANT session is host-bound:
/// its exercise MUST equal the host-resolved exercise (exercise-isolation/08's stash), else the request fails
/// closed with 403 and is never honored — a participant session for exercise A presented on exercise B's host
/// (or on a host that resolves to nothing) is exactly the cross-exercise vector COR-001/COR-008 forbid. STAFF
/// and READ-ONLY sessions are NOT host-bound: a staff console is served from a staff host that does not map to
/// a participant exercise, so its scope comes wholly from the selected active exercise carried on the session;
/// a shared read-only session likewise carries its own bound exercise. Only <c>participant</c> is checked.
/// </para>
/// </remarks>
public sealed partial class SessionAuthenticationMiddleware
{
    private const string ParticipantKind = "participant";

    private readonly RequestDelegate _next;
    private readonly ILogger<SessionAuthenticationMiddleware> _logger;

    /// <summary>Creates the middleware.</summary>
    /// <param name="next">The next delegate in the pipeline.</param>
    /// <param name="logger">Diagnostics logger (never logs token material).</param>
    public SessionAuthenticationMiddleware(RequestDelegate next, ILogger<SessionAuthenticationMiddleware> logger)
    {
        ArgumentNullException.ThrowIfNull(next);
        ArgumentNullException.ThrowIfNull(logger);

        _next = next;
        _logger = logger;
    }

    /// <summary>
    /// Resolves the presented session and, when live, sets the request scope (with precedence over the host) —
    /// enforcing the participant host-binding rule and failing closed on a mismatch. <paramref name="authenticator"/>
    /// and <paramref name="exerciseContext"/> are injected per-invocation from request services.
    /// </summary>
    /// <param name="context">The current request context.</param>
    /// <param name="authenticator">The live-session resolver (throwaway-scope token lookup).</param>
    /// <param name="exerciseContext">The request-scoped exercise context this middleware writes with precedence.</param>
    public async Task InvokeAsync(
        HttpContext context,
        ISessionAuthenticator authenticator,
        IExerciseContext exerciseContext)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(authenticator);
        ArgumentNullException.ThrowIfNull(exerciseContext);

        if (!SessionTokenExtractor.TryGetSessionToken(context.Request, out var rawToken))
        {
            // Anonymous / pre-auth request (login endpoints, the first /exercise-context): no token to honor.
            // The host's provisional scope (if any) stands; scope stays unset otherwise (fail closed).
            await _next(context);
            return;
        }

        var authenticated = await authenticator.AuthenticateAsync(rawToken, context.RequestAborted);
        if (authenticated is null)
        {
            // Unknown / expired / revoked token → never honored. Do NOT upgrade the scope; the endpoint
            // (e.g. GET /api/session) fails closed with 401. Host scope (if any) stands.
            await _next(context);
            return;
        }

        // A participant session is host-bound: its exercise MUST equal the host's resolved exercise, else the
        // request fails closed and is never honored (COR-001/COR-008).
        if (string.Equals(authenticated.Kind, ParticipantKind, StringComparison.Ordinal))
        {
            var hostResolvedExerciseId = context.GetHostResolvedExerciseId();
            if (hostResolvedExerciseId is null || hostResolvedExerciseId.Value != authenticated.ExerciseId)
            {
                LogParticipantHostMismatch(authenticated.ExerciseId, hostResolvedExerciseId);
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return; // Short-circuit — the scope is NOT set and the pipeline does not continue.
            }
        }

        // The default-deny gate's single input (identity-auth-roles/11, COR-012). ADDITIVE: assigning the
        // principal changes nothing about the scope precedence below, and every pre-existing consumer of this
        // middleware is untouched. AuthorizationMiddleware — wired immediately after this middleware in
        // Program.cs — reads HttpContext.User to evaluate the RequireAuthenticatedUser fallback policy, so a
        // request that reaches here WITHOUT a live session stays anonymous and is rejected before any
        // handler, controller action, or hub method runs. Setting this only on the live-session path is the
        // whole guarantee: an absent, unknown, expired or revoked token returned above, principal unset.
        context.User = SessionPrincipal.Create(authenticated);

        // Precedence: overwrite the host's provisional write with the session's bound exercise. The settable
        // seam is the concrete ExerciseContext; the DbContext-facing IExerciseContext stays get-only.
        if (exerciseContext is ExerciseContext settableExerciseContext)
        {
            settableExerciseContext.CurrentExerciseId = authenticated.ExerciseId;
        }
        else
        {
            // Defensive: the registered IExerciseContext is expected to be the settable ExerciseContext. If it
            // is not, fail closed (leave the scope as host resolution set it) rather than guess.
            LogExerciseContextNotSettable(authenticated.ExerciseId, exerciseContext.GetType());
        }

        await _next(context);
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Rejecting a participant session bound to exercise {SessionExerciseId} presented on a host that resolved to {HostExerciseId} — a participant session is host-bound; failing closed (403).")]
    private partial void LogParticipantHostMismatch(Guid sessionExerciseId, Guid? hostExerciseId);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Warning,
        Message = "Authenticated a session bound to exercise {ExerciseId} but the registered IExerciseContext ({ExerciseContextType}) is not settable; leaving the scope as host resolution set it.")]
    private partial void LogExerciseContextNotSettable(Guid exerciseId, Type exerciseContextType);
}
