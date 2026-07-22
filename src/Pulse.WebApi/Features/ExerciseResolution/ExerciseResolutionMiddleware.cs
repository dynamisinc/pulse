namespace Pulse.WebApi.Features.ExerciseResolution;

using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;

/// <summary>
/// The participant-side realization of the central exercise scope (COR-001 / COR-008). For each request it
/// resolves the <c>Host</c> header to the owning exercise via <see cref="IHostExerciseResolver"/> and, on a
/// match, writes the scope into the request's <see cref="ExerciseContext"/> — the settable B0 seam every
/// downstream <see cref="IExerciseScoped"/> query then reads. An absent, malformed, or un-provisioned host
/// leaves the scope UNSET (fail closed): the <c>PulseDbContext</c> global query filter collapses an
/// unresolved scope to <see cref="System.Guid.Empty"/> and matches ZERO rows — never a default, aggregate,
/// or "first" exercise.
/// </summary>
/// <remarks>
/// <para>
/// <b>Population precedence (owned by this story).</b> The single scoped <c>CurrentExerciseId</c> value has
/// three populators, in strict precedence:
/// <c>authenticated session (identity-auth-roles/03, incl. staff active-exercise identity-auth-roles/05)
/// &gt; host resolution (this middleware, anonymous / pre-auth participant) &gt; unset (fail-closed floor)</c>.
/// This middleware writes only the <i>provisional</i> host scope; when a valid session exists, the session
/// middleware's later write overrides it. That precedence is realized purely by ORDER: this middleware MUST
/// run BEFORE the auth/session middleware, so the session's write is the last one to land.
/// </para>
/// <para>
/// <b>Cross-wave seam.</b> On a resolved host it also stashes the exercise id via
/// <see cref="ExerciseResolutionHttpContextItems.SetHostResolvedExerciseId"/> so the Wave-2 session layer can
/// enforce "session exercise MUST equal host exercise, else fail closed". That comparison is not built here.
/// </para>
/// </remarks>
public sealed partial class ExerciseResolutionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExerciseResolutionMiddleware> _logger;

    /// <summary>Creates the middleware.</summary>
    /// <param name="next">The next delegate in the pipeline.</param>
    /// <param name="logger">Diagnostics logger.</param>
    public ExerciseResolutionMiddleware(RequestDelegate next, ILogger<ExerciseResolutionMiddleware> logger)
    {
        ArgumentNullException.ThrowIfNull(next);
        ArgumentNullException.ThrowIfNull(logger);

        _next = next;
        _logger = logger;
    }

    /// <summary>
    /// Resolves the request host to an exercise and, on a match, sets the request scope; otherwise leaves it
    /// unset (fail closed). <paramref name="resolver"/> and <paramref name="exerciseContext"/> are injected
    /// per-invocation from request services (this middleware is a singleton, they are not).
    /// </summary>
    /// <param name="context">The current request context.</param>
    /// <param name="resolver">The host → exercise resolver.</param>
    /// <param name="exerciseContext">The request-scoped exercise context to write the resolved scope into.</param>
    public async Task InvokeAsync(HttpContext context, IHostExerciseResolver resolver, IExerciseContext exerciseContext)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(resolver);
        ArgumentNullException.ThrowIfNull(exerciseContext);

        // HostString.Host is the hostname WITHOUT its port; empty when no Host header was sent. The resolver
        // validates/normalizes it and returns null for anything absent, malformed, or un-provisioned.
        var resolvedExerciseId = await resolver.ResolveExerciseIdAsync(context.Request.Host.Host, context.RequestAborted);

        if (resolvedExerciseId is { } exerciseId && exerciseId != Guid.Empty)
        {
            // Cross-wave seam for identity-auth-roles/03's session-vs-host mismatch check (Wave 2).
            context.SetHostResolvedExerciseId(exerciseId);

            // Write the provisional participant/pre-auth scope. A later session-layer write overrides it
            // (precedence, above). The settable seam is the concrete ExerciseContext; the read-only
            // IExerciseContext interface the DbContext consumes stays get-only, so we set through the concrete.
            if (exerciseContext is ExerciseContext settableExerciseContext)
            {
                settableExerciseContext.CurrentExerciseId = exerciseId;
            }
            else
            {
                // Defensive: the registered IExerciseContext is expected to be the settable ExerciseContext.
                // If it is not, fail closed (leave scope unset) rather than guess.
                LogExerciseContextNotSettable(exerciseId, exerciseContext.GetType());
            }
        }

        // Unresolved host: intentionally do nothing — CurrentExerciseId stays unset and fails closed.
        await _next(context);
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Resolved host to exercise {ExerciseId} but the registered IExerciseContext ({ExerciseContextType}) is not settable; leaving scope unresolved.")]
    private partial void LogExerciseContextNotSettable(Guid exerciseId, Type exerciseContextType);
}
