namespace Pulse.WebApi.Features.ExerciseConfiguration;

using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

/// <summary>
/// The exercise-configuration slice's composition-root extensions (story 01b) — the single
/// <see cref="AddExerciseConfiguration"/> / <see cref="MapExerciseConfigurationEndpoints"/> pair the
/// orchestrator wires into <c>Program.cs</c>. No builder in this feature edits <c>Program.cs</c> itself.
/// </summary>
/// <remarks>
/// <para>
/// <b>REQUIRED wiring, not optional (read before merging).</b> <see cref="AddExerciseConfiguration"/>
/// registers <see cref="ParticipantShellConfigService"/>, which the ALREADY-WIRED
/// <c>app.MapParticipantShellEndpoints()</c> handlers now depend on. Until this call is in
/// <c>Program.cs</c>, the six participant-shell config GETs cannot resolve their handler dependency and fail
/// at request time — the participant shell blanks in UAT. It must be wired in the same change that merges
/// this slice.
/// </para>
/// <para>
/// <b>Ordering.</b> Place <see cref="AddExerciseConfiguration"/> AFTER <c>AddPulsePersistence</c>,
/// <c>AddExerciseScoping</c> and <c>AddStaffIdentity</c> (it consumes <c>PulseDbContext</c>,
/// <c>IExerciseContext</c>, <c>StaffAssignmentService</c> and <c>ICurrentStaffSessionAccessor</c>), and
/// BEFORE the wave-3 contributors' <c>AddComplianceChromeConfig()</c> / <c>AddExerciseLifecycle()</c> /
/// <c>AddPracticeMode()</c>. Strictly, <c>TryAdd</c> + <c>Replace</c> already make the outcome
/// order-independent; keeping the declared order is belt-and-braces so a future contributor that gets the
/// idiom wrong still resolves correctly. No middleware-ordering constraint is introduced here.
/// </para>
/// </remarks>
public static class ExerciseConfigurationExtensions
{
    /// <summary>
    /// Registers the exercise-configuration slice: the staff settings service, the participant-shell config
    /// service, and the three constant-preserving projection defaults.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The projection-override contract (authoritative — wave 3's concurrency depends on it).</b> The
    /// three projections are registered with <c>TryAddScoped</c>: a FAIL-SAFE FLOOR that is present if and
    /// only if nobody has contributed a real implementation. They are never <c>AddScoped</c>, which would
    /// stack a second descriptor and let last-wins registration order decide silently.
    /// </para>
    /// <para>
    /// A contributing story (02 chrome; 03 shell-variant + overlay-state) MUST override from its OWN
    /// <c>Add*()</c> extension with
    /// <c>services.Replace(ServiceDescriptor.Scoped&lt;IChromeConfigProjection, RealChromeConfigProjection&gt;())</c>.
    /// <c>Replace</c> is order-independent and unambiguous; a bare <c>AddScoped</c> is NOT an override.
    /// </para>
    /// <para>
    /// <b>The silent failure this prevents.</b> A contributor that uses <c>AddScoped</c> ships green — its
    /// unit tests exercise the projection class directly and pass — while the constant default still wins at
    /// runtime, so every exercise serves identical chrome. Testing the projection class in isolation cannot
    /// catch it: each contributing story must resolve the interface from a FULLY COMPOSED provider (the real
    /// <c>Add*()</c> calls, in the orchestrator's order) and assert the contributed implementation comes back.
    /// </para>
    /// <para>
    /// Everything is Scoped, matching the request-scoped <c>PulseDbContext</c> / <c>IExerciseContext</c> unit
    /// of work these services read through.
    /// </para>
    /// </remarks>
    /// <param name="services">The service collection to register into.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddExerciseConfiguration(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddScoped<ExerciseSettingsService>();
        services.AddScoped<ParticipantShellConfigService>();

        // The constant-preserving floor — see the projection-override contract above. TryAdd, never Add.
        services.TryAddScoped<IChromeConfigProjection, ConstantChromeConfigProjection>();
        services.TryAddScoped<IShellVariantProjection, ConstantShellVariantProjection>();
        services.TryAddScoped<IOverlayStateProjection, ConstantOverlayStateProjection>();

        return services;
    }

    /// <summary>
    /// Maps the slice's HTTP surface — the staff settings read/write pair. The six participant-shell config
    /// GETs are mapped by the existing <c>MapParticipantShellEndpoints()</c> (unchanged call site); this
    /// story only changed what backs them.
    /// </summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapExerciseConfigurationEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapExerciseSettingsEndpoints();

        return endpoints;
    }
}
