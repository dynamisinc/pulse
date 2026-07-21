namespace Pulse.WebApi.Features.ExerciseResolution;

using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;

/// <summary>
/// Composition-root seams for host → exercise resolution (exercise-isolation/08). The orchestrator wires the
/// single <see cref="AddExerciseResolution"/> (DI) and <see cref="UseExerciseResolution"/> (pipeline) calls
/// into <c>Program.cs</c> serially; this story never edits <c>Program.cs</c> itself. The paired
/// <c>GET /api/exercise-context</c> endpoint is mapped by
/// <see cref="ExerciseContextEndpoints.MapExerciseContextEndpoints"/>.
/// </summary>
public static class ExerciseResolutionExtensions
{
    /// <summary>
    /// Registers the host → exercise resolver (<see cref="IHostExerciseResolver"/> →
    /// <see cref="HostExerciseResolver"/>) as a singleton — it is stateless and opens its own short-lived DI
    /// scope per lookup. The scope-write target (<see cref="Data.IExerciseContext"/>) and the
    /// <see cref="Data.PulseDbContext"/> the endpoint reads are already registered by <c>AddExerciseScoping</c>
    /// / <c>AddPulsePersistence</c>, so no other registration is required here.
    /// </summary>
    /// <param name="services">The service collection to register into.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddExerciseResolution(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddSingleton<IHostExerciseResolver, HostExerciseResolver>();

        return services;
    }

    /// <summary>
    /// Adds <see cref="ExerciseResolutionMiddleware"/> to the pipeline — it resolves the request host to an
    /// exercise and sets the request scope (fail closed on an unresolved host).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Required ordering (orchestrator-owned).</b> This call MUST run <b>before</b> the auth/session
    /// middleware (identity-auth-roles/03, Wave 2). The single scoped <c>CurrentExerciseId</c> has the
    /// precedence <c>session &gt; host &gt; unset</c>, realized purely by order: host resolution writes the
    /// provisional scope first, then the session middleware's later write (when a valid session exists) wins.
    /// It should also run after the DB-independent liveness probe mapping so a resolution lookup can never
    /// affect liveness; the resolver additionally fails closed on any lookup error as a second line of defense.
    /// In Wave 1 there is no session layer yet, so host resolution is the only populator — expected.
    /// </para>
    /// <para>
    /// Pair this with <see cref="AddExerciseResolution"/> (DI) and
    /// <see cref="ExerciseContextEndpoints.MapExerciseContextEndpoints"/> (the resolver endpoint).
    /// </para>
    /// </remarks>
    /// <param name="app">The application pipeline builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IApplicationBuilder UseExerciseResolution(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        return app.UseMiddleware<ExerciseResolutionMiddleware>();
    }
}
