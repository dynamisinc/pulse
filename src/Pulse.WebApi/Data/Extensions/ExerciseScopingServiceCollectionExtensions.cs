namespace Pulse.WebApi.Data.Extensions;

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

/// <summary>
/// Composition-root extension that registers the read-side exercise-scoping seam — the
/// <see cref="IExerciseContext"/> the <see cref="PulseDbContext"/> injects to drive its global query
/// filter. Kept in its OWN extension (separate from <c>AddPulsePersistence</c>) so the scoping seam is a
/// discrete, independently-registered concern; the orchestrator wires the single call into
/// <c>Program.cs</c>, which this story does NOT edit.
/// </summary>
public static class ExerciseScopingServiceCollectionExtensions
{
    /// <summary>
    /// Registers <see cref="IExerciseContext"/> (default <see cref="ExerciseContext"/>) with a Scoped
    /// lifetime, matching the <see cref="PulseDbContext"/>'s own scoped lifetime so <c>AddDbContext</c>'s
    /// constructor injection resolves it per request / unit of work at runtime.
    /// </summary>
    public static IServiceCollection AddExerciseScoping(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddScoped<IExerciseContext, ExerciseContext>();

        // The OUTER (customer tenant) axis rides along with the inner one, deliberately — see
        // AddOrganizationScoping's remarks for why it is not left as a separate line for the orchestrator.
        services.AddOrganizationScoping();

        return services;
    }

    /// <summary>
    /// Registers <see cref="IOrganizationContext"/> (default <see cref="OrganizationContext"/>) with a
    /// Scoped lifetime — the CUSTOMER tenant seam the <see cref="PulseDbContext"/>'s second global query
    /// filter reads (exercise-isolation/11, COR-010). Idempotent: safe to call directly as well as via
    /// <see cref="AddExerciseScoping"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why this is called FROM <see cref="AddExerciseScoping"/> rather than being a second
    /// orchestrator-wired line.</b> The two scoping axes are one seam ("the read-side scope the DbContext
    /// reads"), and a HALF-WIRED seam is the failure mode worth engineering out: with
    /// <see cref="IOrganizationContext"/> unregistered the context still constructs (the ctor param is
    /// optional) and still fails closed — so nothing throws, nothing logs, and every org-scoped library read
    /// quietly returns zero rows. That is safe but silent, and silent-and-safe is how a tenant tier ends up
    /// shipped-but-inert. Coupling the registration to the already-wired call makes the axis impossible to
    /// forget, and needs no <c>Program.cs</c> edit (which this story does not make).
    /// </para>
    /// </remarks>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddOrganizationScoping(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddScoped<IOrganizationContext, OrganizationContext>();

        return services;
    }
}
