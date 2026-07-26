namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// AC5, the DI half — <b>the projection-override contract</b>. Story 01b registers its constant-preserving
/// defaults with <c>TryAddScoped</c>; this story MUST contribute with <c>services.Replace(...)</c>, because a
/// copied <c>TryAdd</c> is a SILENT no-op that leaves the constant serving while this story's own projection
/// unit tests still pass.
/// </summary>
/// <remarks>
/// <b>Deliberately NOT in <see cref="MsSqlCollection"/> (plain <see cref="FactAttribute"/>, no Docker).</b>
/// Every test here is a bare <see cref="ServiceCollection"/> assertion that touches no database, so it must
/// run everywhere — including a Docker-less box with no <c>PULSE_TEST_SQL_CONNECTION</c>. Joining the SQL
/// collection would construct the container fixture for the class regardless and turn these into hard
/// failures exactly where a reviewer most needs to tell a real break in this contract from infrastructure
/// noise (a Gate-2 finding). The end-to-end half lives in
/// <see cref="ExerciseLifecycleCompositionTests"/>, gated with <c>[RequiresDockerFact]</c>.
/// </remarks>
public sealed class ExerciseLifecycleRegistrationTests
{
    /// <summary>The slice's own service is Scoped, matching the request-scoped unit of work it reads through.</summary>
    [Fact]
    public void AddExerciseLifecycle_RegistersTheLifecycleServiceAtScopedLifetime()
    {
        var services = new ServiceCollection();

        services.AddExerciseLifecycle();

        services.Should().Contain(
            d => d.ServiceType == typeof(ExerciseLifecycleService) && d.Lifetime == ServiceLifetime.Scoped,
            "the lifecycle service shares the request-scoped PulseDbContext unit of work");
    }

    /// <summary>AC5: both projections are contributed with <c>Replace</c> — one descriptor, this story's type.</summary>
    [Fact]
    public void AddExerciseLifecycle_ReplacesBothProjectionDefaults_InTheOrchestratorsOrder()
    {
        var services = new ServiceCollection();

        // The orchestrator's declared order: 01b's defaults first, the contributor after.
        services.AddExerciseConfiguration();
        services.AddExerciseLifecycle();

        services.Where(d => d.ServiceType == typeof(IShellVariantProjection)).Should().ContainSingle(
            "Replace swaps the descriptor rather than stacking a second one")
            .Which.ImplementationType.Should().Be(typeof(LifecycleShellVariantProjection));

        services.Where(d => d.ServiceType == typeof(IOverlayStateProjection)).Should().ContainSingle(
            "Replace swaps the descriptor rather than stacking a second one")
            .Which.ImplementationType.Should().Be(typeof(LifecycleOverlayStateProjection));
    }

    /// <summary>AC5: and it wins from a FULLY COMPOSED provider, which is the assertion that matters.</summary>
    [Fact]
    public void ContributedProjections_ResolveFromAFullyComposedProvider()
    {
        using var provider = BuildComposedProvider(configure: null);
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<IShellVariantProjection>()
            .Should().BeOfType<LifecycleShellVariantProjection>(
                "the contributed projection must be the one the runtime resolves — not 01b's TryAdded default");
        scope.ServiceProvider.GetRequiredService<IOverlayStateProjection>()
            .Should().BeOfType<LifecycleOverlayStateProjection>(
                "the contributed projection must be the one the runtime resolves — not 01b's TryAdded default");
    }

    /// <summary>AC5: <c>Replace</c> is order-independent — a contributor must not depend on the wiring order.</summary>
    [Fact]
    public void ContributedProjections_WinEvenWhenAddExerciseLifecycleRunsBeforeTheDefaults()
    {
        var services = new ServiceCollection();

        services.AddExerciseLifecycle();
        services.AddExerciseConfiguration();

        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<IShellVariantProjection>()
            .Should().BeOfType<LifecycleShellVariantProjection>();
        scope.ServiceProvider.GetRequiredService<IOverlayStateProjection>()
            .Should().BeOfType<LifecycleOverlayStateProjection>();
    }

    /// <summary>
    /// The trap this contract exists to close, restated against THIS story's projections: had they been
    /// contributed with <c>TryAddScoped</c>, 01b's constants would silently keep serving.
    /// </summary>
    [Fact]
    public void HadTheProjectionsBeenContributedWithTryAdd_TheConstantsWouldSilentlyKeepServing()
    {
        var services = new ServiceCollection();
        services.AddExerciseConfiguration();
        services.TryAddScoped<IShellVariantProjection, LifecycleShellVariantProjection>();

        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<IShellVariantProjection>()
            .Should().BeOfType<ConstantShellVariantProjection>(
                "TryAdd is NOT an override — this is exactly the silent failure AddExerciseLifecycle's Replace prevents");
    }

    /// <summary>A duplicated composition call still leaves exactly one descriptor per projection.</summary>
    [Fact]
    public void AddExerciseLifecycle_CalledTwice_StillLeavesOneDescriptorPerProjection()
    {
        var services = new ServiceCollection();

        services.AddExerciseConfiguration();
        services.AddExerciseLifecycle();
        services.AddExerciseLifecycle();

        services.Count(d => d.ServiceType == typeof(IShellVariantProjection)).Should().Be(1);
        services.Count(d => d.ServiceType == typeof(IOverlayStateProjection)).Should().Be(1);
        services.Count(d => d.ServiceType == typeof(ISteeringOverlaySource)).Should().Be(1);
    }

    /// <summary>
    /// The CTL-023 seam ships a fail-closed floor (<c>TryAdd</c>, because this slice OWNS the seam), and the
    /// world-steering adapter overrides it at merge with <c>Replace</c> — the same contract, one level down.
    /// </summary>
    [Fact]
    public void SteeringOverlaySource_DefaultsToTheFailClosedFloor_AndIsReplaceableByWorldSteering()
    {
        var services = new ServiceCollection();
        services.AddExerciseLifecycle();

        using (var defaultProvider = services.BuildServiceProvider())
        {
            defaultProvider.GetRequiredService<ISteeringOverlaySource>()
                .Should().BeOfType<NoSteeringOverlaySource>(
                    "with world-steering unmerged there is never an active steering overlay");
        }

        services.Replace(ServiceDescriptor.Singleton<ISteeringOverlaySource, MergedSteeringOverlaySource>());

        using var mergedProvider = services.BuildServiceProvider();
        mergedProvider.GetRequiredService<ISteeringOverlaySource>()
            .Should().BeOfType<MergedSteeringOverlaySource>(
                "the merge is a one-file adapter registered with Replace — nothing else in this slice changes");
    }

    /// <summary>Composes the slice exactly as the orchestrator will, minus the database itself.</summary>
    private static ServiceProvider BuildComposedProvider(Action<IServiceCollection>? configure)
    {
        var services = new ServiceCollection();

        services.AddLogging();
        services.AddExerciseScoping();
        services.TryAddScoped<ICurrentStaffSessionAccessor, NullStaffSessionAccessor>();
        services.AddExerciseConfiguration();
        services.AddExerciseLifecycle();
        configure?.Invoke(services);

        return services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
    }

    /// <summary>Stands in for the world-steering adapter contributed at merge time.</summary>
    private sealed class MergedSteeringOverlaySource : ISteeringOverlaySource
    {
        public OverlayContribution? GetCurrent(Guid exerciseId) =>
            new("pause", "out-of-fiction", string.Empty);
    }

    /// <summary>A fail-closed staff-session accessor, so the composed graph resolves without B2's full wiring.</summary>
    private sealed class NullStaffSessionAccessor : ICurrentStaffSessionAccessor
    {
        public System.Threading.Tasks.Task<CurrentStaffSession?> GetCurrentStaffSessionAsync(
            System.Threading.CancellationToken cancellationToken = default) =>
            System.Threading.Tasks.Task.FromResult<CurrentStaffSession?>(null);
    }
}
