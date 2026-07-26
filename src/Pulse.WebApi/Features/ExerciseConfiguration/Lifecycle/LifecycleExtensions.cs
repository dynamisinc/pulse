namespace Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

/// <summary>
/// Story 03's OWN composition-root seams — the three calls the orchestrator wires into <c>Program.cs</c>.
/// This story adds no line inside 01b's <c>ExerciseConfigurationExtensions.cs</c> and never edits
/// <c>Program.cs</c> itself.
/// </summary>
/// <remarks>
/// <para><b>The wiring the orchestrator adds (all three lines):</b></para>
/// <list type="number">
///   <item><c>builder.Services.AddExerciseLifecycle();</c> — DI. Conventionally placed AFTER
///   <c>AddExerciseConfiguration()</c> (01b), and it MUST come after <c>AddPulsePersistence</c>,
///   <c>AddExerciseScoping</c> and <c>AddStaffIdentity</c>/<c>AddSessions</c>, whose
///   <c>ICurrentStaffSessionAccessor</c> both the transition telemetry and the gating exemption resolve.
///   Ordering against 01b is a convention only: <c>Replace</c> wins from either side.</item>
///   <item><c>app.UseExerciseLifecycleGating();</c> — pipeline. <b>ORDER IS LOAD-BEARING:</b> it must run
///   AFTER <c>app.UseExerciseResolution()</c> and <c>app.UseSessionAuthentication()</c> so the exercise scope
///   and the session are already resolved. Wired before them it reads an unset scope on every request and
///   becomes a silent, total no-op — the gate would appear wired and enforce nothing.</item>
///   <item><c>app.MapExerciseLifecycleEndpoints();</c> — the staff read/transition pair. That extension lives
///   on <see cref="LifecycleEndpoints"/> (the same shape as 01b's <c>MapExerciseSettingsEndpoints</c>); there
///   is deliberately no second wrapper here, so there is exactly one name to wire.</item>
/// </list>
/// </remarks>
public static class LifecycleExtensions
{
    /// <summary>
    /// Registers the COR-032 lifecycle slice: the single lifecycle read/transition service, the CTL-023
    /// steering-overlay seam's fail-closed default, and the two participant-shell projections story 01b left
    /// as constant-preserving defaults.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The two projections are registered with <c>services.Replace(...)</c>, never <c>TryAddScoped</c>.</b>
    /// 01b registers <c>ConstantShellVariantProjection</c> / <c>ConstantOverlayStateProjection</c> with
    /// <c>TryAddScoped</c>; copying that idiom here would be a SILENT no-op — the default is already present,
    /// so <c>TryAdd</c> stands down, nothing raises, this story's own projection unit tests still pass, and at
    /// runtime <c>/api/shell-state</c> keeps answering <c>full</c> for an archived exercise. <c>Replace</c> is
    /// order-independent and leaves exactly one descriptor. Proven from a fully composed provider by
    /// <c>ExerciseLifecycleRegistrationTests</c> (pure DI) and <c>ExerciseLifecycleCompositionTests</c>
    /// (real HTTP + real SQL).
    /// </para>
    /// <para>
    /// <b><see cref="ISteeringOverlaySource"/> is <c>TryAdd</c>ed on purpose</b> — the opposite role. This
    /// slice DEFINES that seam and ships its fail-closed floor (<see cref="NoSteeringOverlaySource"/>: never
    /// an active steering overlay). Whoever merges <c>feature/world-steering-wave2</c> contributes the real
    /// adapter over its <c>OverlayStateService</c> and must register it with <c>Replace</c>, exactly as the
    /// projection-override contract requires of every contributor.
    /// </para>
    /// <para>
    /// Everything is Scoped except the stateless steering default, matching the request-scoped
    /// <c>PulseDbContext</c> / <c>IExerciseContext</c> unit of work these services read through.
    /// </para>
    /// </remarks>
    /// <param name="services">The service collection to register into.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddExerciseLifecycle(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddScoped<ExerciseLifecycleService>();

        // The seam this slice OWNS: a fail-closed floor world-steering replaces at merge (see remarks).
        services.TryAddSingleton<ISteeringOverlaySource, NoSteeringOverlaySource>();

        // The seams 01b owns: Replace, never TryAdd (see remarks — TryAdd here is the silent failure).
        services.Replace(ServiceDescriptor.Scoped<IShellVariantProjection, LifecycleShellVariantProjection>());
        services.Replace(ServiceDescriptor.Scoped<IOverlayStateProjection, LifecycleOverlayStateProjection>());

        return services;
    }

    /// <summary>
    /// Adds <see cref="ExerciseLifecycleGatingMiddleware"/> — COR-032's participant fail-closed gate (AC3): in
    /// <c>build</c> / <c>completed</c> / <c>archived</c> the participant-world routes are NOT SERVED
    /// (<c>403</c>), while staff sessions and every un-listed route (the pre-auth allowlist included) pass
    /// through untouched.
    /// </summary>
    /// <remarks>
    /// <b>Required ordering (orchestrator-owned).</b> Wire this AFTER <c>UseExerciseResolution()</c> and
    /// <c>UseSessionAuthentication()</c>. Both writes populate the single request-scoped exercise scope
    /// (precedence: session &gt; host &gt; unset), and this gate reads it — placed earlier it sees an unset
    /// scope on every request and silently gates nothing at all.
    /// </remarks>
    /// <param name="app">The application pipeline builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IApplicationBuilder UseExerciseLifecycleGating(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        return app.UseMiddleware<ExerciseLifecycleGatingMiddleware>();
    }
}
