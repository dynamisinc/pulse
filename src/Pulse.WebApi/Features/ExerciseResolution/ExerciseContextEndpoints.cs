namespace Pulse.WebApi.Features.ExerciseResolution;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// Serves the FROZEN resolver contract <c>GET /api/exercise-context</c> (exercise-isolation/08) — the
/// server-side mirror of <c>src/frontend/src/core/exerciseContext/exerciseContextResolver.ts</c>. It returns
/// the <see cref="ExerciseScopeDto"/> for the ONE resolved exercise (no list, no picker, no
/// admin/simulation-status surface — COR-004, XC-002), read from the resolved
/// <see cref="IExerciseContext"/>, NEVER a client-supplied <c>exerciseId</c> (COR-001). Called PRE-AUTH by
/// the participant login page.
/// </summary>
/// <remarks>
/// Minimal-API extension method mirroring <c>Features/Social/*</c>; the orchestrator wires the single
/// <see cref="MapExerciseContextEndpoints"/> call into <c>Program.cs</c> (route base <c>/api</c>). The scope
/// is populated upstream by <see cref="ExerciseResolutionMiddleware"/>; an unresolved scope (unknown host)
/// FAILS CLOSED with <c>404</c> — never a 200 with empty/default data.
/// </remarks>
public static class ExerciseContextEndpoints
{
    /// <summary>
    /// Maps <c>GET /api/exercise-context</c> — the single-exercise scope for the resolved host.
    /// </summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapExerciseContextEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // PRE-AUTH (identity-auth-roles/11, PreAuthAllowlist): the login pages need a resolved exercise scope
        // BEFORE a session exists — that is this endpoint's entire purpose (exercise-isolation/08). It reads
        // only the frozen public ExerciseScope, never exercise content.
        endpoints.MapGet("/api/exercise-context", GetExerciseContextAsync)
            .AllowAnonymousPreAuth();

        return endpoints;
    }

    /// <summary>
    /// Returns the frozen <see cref="ExerciseScopeDto"/> for the resolved exercise, or <c>404</c> when no
    /// scope was resolved for the request (unknown host — fail closed). Scope comes solely from the resolved
    /// <see cref="IExerciseContext"/>; a client cannot supply or influence which exercise is returned.
    /// </summary>
    private static async Task<IResult> GetExerciseContextAsync(
        IExerciseContext exerciseContext,
        PulseDbContext dbContext,
        CancellationToken cancellationToken)
    {
        var scope = exerciseContext.CurrentExerciseId;

        // Fail closed: no host resolved (or the fail-closed Guid.Empty floor) → 404, never a default/empty 200.
        if (scope is null || scope.Value == Guid.Empty)
        {
            return Results.NotFound();
        }

        // Exercise is not IExerciseScoped, so this PK lookup is not itself scope-filtered; the id is the
        // server-resolved scope, never a client input. A missing row (should not happen for a resolved
        // scope) also fails closed.
        // org-scope-exempt(ResolvedScope): scope.Value is the server-resolved exercise from IExerciseContext,
        // so the single row read is the caller's own exercise and thus already inside their organization.
        var exercise = await dbContext.Exercises
            .AsNoTracking()
            .FirstOrDefaultAsync(candidate => candidate.Id == scope.Value, cancellationToken);

        return exercise is null
            ? Results.NotFound()
            : Results.Ok(ExerciseScopeDto.FromExercise(exercise));
    }
}
