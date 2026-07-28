namespace Pulse.WebApi.Features.ExerciseConfiguration.PracticeMode;

using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

/// <summary>
/// The practice/sandbox slice's OWN composition-root extensions (exercise-configuration story 04) — the
/// <see cref="AddPracticeMode"/> / <see cref="MapPracticeModeEndpoints"/> pair the orchestrator wires into
/// <c>Program.cs</c>. No builder in this feature edits <c>Program.cs</c>, and this story adds no line to story
/// 01b's <c>ExerciseConfigurationExtensions.cs</c> — two wave-3 stories routing their wiring through one file
/// is the one way this fan-out collides.
/// </summary>
/// <remarks>
/// <para>
/// <b>Ordering.</b> Place <see cref="AddPracticeMode"/> AFTER <c>AddPulsePersistence</c>,
/// <c>AddExerciseScoping</c> and <c>AddStaffIdentity</c> (it consumes <c>PulseDbContext</c>,
/// <c>IExerciseContext</c>, <c>StaffAssignmentService</c> and <c>ICurrentStaffSessionAccessor</c>), and — by
/// the feature's convention — after <c>AddExerciseConfiguration()</c>. The convention is belt-and-braces
/// only: <see cref="ServiceCollectionDescriptorExtensions.Replace"/> makes the outcome order-independent.
/// This slice introduces NO middleware-ordering constraint.
/// </para>
/// <para>
/// <b>Wiring is required for the seam to exist at all.</b> <see cref="IEvaluationEligibility"/> has no
/// fail-safe default anywhere else in the host, so until <see cref="AddPracticeMode"/> is called nothing
/// registers it and a consumer's <c>GetRequiredService&lt;IEvaluationEligibility&gt;()</c> throws. That is
/// deliberate — a missing registration must be a loud startup/DI failure, never a silent "everything is
/// eligible" default that quietly leaks rehearsal data into an AAR. It is also why story 04 ships a
/// DI-resolution test against a FULLY COMPOSED provider rather than only unit tests of the class: a slice can
/// merge fully green with its composition-root wiring never executed.
/// </para>
/// </remarks>
public static class PracticeModeExtensions
{
    /// <summary>
    /// Registers the practice/sandbox slice: the staff read/write service and the single COR-033
    /// evaluation-eligibility seam E10's export filtering consumes.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Both registrations are <c>Scoped</c>, matching the request-scoped <c>PulseDbContext</c> /
    /// <c>IExerciseContext</c> unit of work they read through.
    /// </para>
    /// <para>
    /// <b>Why <see cref="ServiceCollectionDescriptorExtensions.Replace"/> for the seam.</b> It is the
    /// feature's mandated idiom (implementation.md → "The projection-override contract") and the only one that
    /// is BOTH order-independent AND leaves exactly ONE descriptor behind: a duplicated composition call, or a
    /// future fail-safe default registered elsewhere, can neither stack a second descriptor nor silently win.
    /// <c>TryAdd</c> would be the trap here — it stands down when anything is already registered, which is
    /// precisely how a contributor loses without any error being raised.
    /// </para>
    /// </remarks>
    /// <param name="services">The service collection to register into.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddPracticeMode(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddScoped<PracticeModeService>();
        services.Replace(ServiceDescriptor.Scoped<IEvaluationEligibility, PracticeModeEvaluationEligibility>());

        return services;
    }

    /// <summary>
    /// Maps the slice's HTTP surface — the staff practice-mode read/write pair
    /// (<c>GET/PUT /api/staff/practice-mode</c>). It adds no participant route: practice state is staff-world
    /// only (XC-002).
    /// </summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapPracticeModeEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapPracticeModeStaffEndpoints();

        return endpoints;
    }
}
