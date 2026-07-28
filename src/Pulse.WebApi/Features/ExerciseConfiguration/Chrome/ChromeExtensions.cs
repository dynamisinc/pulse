namespace Pulse.WebApi.Features.ExerciseConfiguration.Chrome;

using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

/// <summary>
/// Story 02's OWN composition-root extensions — the
/// <see cref="AddComplianceChromeConfig"/> / <see cref="MapComplianceChromeEndpoints"/> pair the orchestrator
/// wires into <c>Program.cs</c>. Deliberately a separate file from story 01b's
/// <c>ExerciseConfigurationExtensions</c>: two wave-3 builders routing their registrations through that one
/// file is the single way this fan-out collides. No builder edits <c>Program.cs</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Ordering.</b> Place <see cref="AddComplianceChromeConfig"/> AFTER <c>AddPulsePersistence</c>,
/// <c>AddExerciseScoping</c>, <c>AddStaffIdentity</c> and <c>AddExerciseConfiguration()</c> — conventionally,
/// not for correctness. <c>Replace</c> is order-independent (pinned by
/// <c>ChromeProjectionRegistrationTests.ChromeProjection_WinsEvenWhenItRunsBeforeTheDefault</c>); the
/// convention just keeps the mistaken <c>TryAdd</c> idiom from ever appearing to work. No middleware-ordering
/// constraint is introduced here.
/// </para>
/// </remarks>
public static class ChromeExtensions
{
    /// <summary>
    /// Registers story 02's compliance-chrome slice: the staff chrome settings service, and — the point of the
    /// story — the real per-exercise <see cref="ChromeConfigProjection"/> contributed OVER story 01b's
    /// constant-preserving default.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The projection-override contract — why <c>Replace</c> and not <c>TryAdd</c>.</b> Story 01b registers
    /// its default with <c>TryAddScoped</c>, a fail-safe FLOOR present only while nobody has contributed a real
    /// projection. Copying that idiom here would be a SILENT no-op: the default is already registered, so the
    /// <c>TryAdd</c> stands down, nothing raises, this story's own projection unit tests still pass — and
    /// <c>/api/chrome-config</c> keeps serving one identical banner set to every exercise, which is precisely
    /// the defect this story exists to fix. <c>Replace</c> is order-independent AND leaves exactly one
    /// descriptor, so <c>IEnumerable&lt;IChromeConfigProjection&gt;</c> never sees a stale default beside the
    /// real implementation.
    /// </para>
    /// <para>
    /// Everything is Scoped, matching the request-scoped <c>PulseDbContext</c> / <c>IExerciseContext</c> unit
    /// of work these services read through.
    /// </para>
    /// </remarks>
    /// <param name="services">The service collection to register into.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddComplianceChromeConfig(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddScoped<ChromeSettingsService>();

        // Replace, NEVER TryAdd — see the projection-override contract above.
        services.Replace(ServiceDescriptor.Scoped<IChromeConfigProjection, ChromeConfigProjection>());

        return services;
    }

    /// <summary>
    /// Maps story 02's HTTP surface — the staff chrome read/write pair. The participant
    /// <c>GET /api/chrome-config</c> route is NOT mapped here: it is already mapped by
    /// <c>MapParticipantShellEndpoints()</c> and this story only changed what backs it.
    /// </summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapComplianceChromeEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapChromeSettingsEndpoints();

        return endpoints;
    }
}
