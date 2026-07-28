namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration;

using System.Linq;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ParticipantShell;
using Xunit;

/// <summary>
/// Composition-root guard for <see cref="ExerciseConfigurationExtensions.AddExerciseConfiguration"/> and,
/// above all, for the PROJECTION-OVERRIDE CONTRACT wave 3's three-way fan-out rests on: 01b ships
/// constant-preserving defaults with <c>TryAddScoped</c>, and stories 02/03 contribute real projections from
/// their own files with <c>services.Replace(...)</c>. This is the DI half of that guard.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a DI-RESOLUTION test and not just a unit test of the projection class.</b> The failure this guards
/// against ships green: a contributor whose projection class is correct, and whose own unit tests pass,
/// registers it with an idiom that loses to the already-present default — and at runtime every exercise
/// silently serves the shipped constant. Exercising the projection class in isolation cannot catch that.
/// These tests resolve the interface from a fully composed provider so the registration idiom itself is
/// under test.
/// </para>
/// <para>
/// <b>Why this class is deliberately NOT in <c>MsSqlCollection</c> (plain <see cref="FactAttribute"/>, no
/// Docker).</b> Every test here is a bare <see cref="ServiceCollection"/> assertion that touches no database,
/// so it must run everywhere — including a Docker-less developer box with no
/// <c>PULSE_TEST_SQL_CONNECTION</c>. Joining the SQL collection would construct the container fixture for the
/// class regardless and turn these into hard <c>DockerUnavailableException</c> failures, exactly where a
/// wave-3 contributor most needs to tell a real break in this contract from infrastructure noise. Its sibling
/// <see cref="ExerciseConfigurationCompositionTests"/> holds the end-to-end half, which genuinely needs SQL
/// and is gated with <c>[RequiresDockerFact]</c> accordingly.
/// </para>
/// </remarks>
public sealed class ExerciseConfigurationProjectionRegistrationTests
{
    [Fact]
    public void AddExerciseConfiguration_RegistersTheSlicesServicesAtScopedLifetime()
    {
        var services = new ServiceCollection();

        services.AddExerciseConfiguration();

        services.Should().Contain(
            d => d.ServiceType == typeof(ExerciseSettingsService) && d.Lifetime == ServiceLifetime.Scoped,
            "the settings service shares the request-scoped PulseDbContext unit of work");
        services.Should().Contain(
            d => d.ServiceType == typeof(ParticipantShellConfigService) && d.Lifetime == ServiceLifetime.Scoped,
            "the shell-config service shares the request-scoped PulseDbContext unit of work");
    }

    [Fact]
    public void AddExerciseConfiguration_RegistersEachProjectionDefaultExactlyOnce_AsTheConstantPreservingFloor()
    {
        var services = new ServiceCollection();

        services.AddExerciseConfiguration();

        services.Where(d => d.ServiceType == typeof(IChromeConfigProjection)).Should().ContainSingle()
            .Which.ImplementationType.Should().Be(typeof(ConstantChromeConfigProjection));
        services.Where(d => d.ServiceType == typeof(IShellVariantProjection)).Should().ContainSingle()
            .Which.ImplementationType.Should().Be(typeof(ConstantShellVariantProjection));
        services.Where(d => d.ServiceType == typeof(IOverlayStateProjection)).Should().ContainSingle()
            .Which.ImplementationType.Should().Be(typeof(ConstantOverlayStateProjection));
    }

    [Fact]
    public void AddExerciseConfiguration_CalledTwice_StillRegistersOneProjectionDescriptor()
    {
        // TryAdd (not Add) is what makes the default a FLOOR rather than a stack: a duplicated composition
        // call cannot produce two descriptors whose order silently decides which one wins.
        var services = new ServiceCollection();

        services.AddExerciseConfiguration();
        services.AddExerciseConfiguration();

        services.Count(d => d.ServiceType == typeof(IChromeConfigProjection)).Should().Be(1);
        services.Count(d => d.ServiceType == typeof(IShellVariantProjection)).Should().Be(1);
        services.Count(d => d.ServiceType == typeof(IOverlayStateProjection)).Should().Be(1);
    }

    [Fact]
    public void ContributedProjection_RegisteredWithReplace_WinsOverTheDefault_InTheOrchestratorsOrder()
    {
        // The orchestrator's declared order: 01b's AddExerciseConfiguration() first, the contributor after.
        var services = new ServiceCollection();
        services.AddExerciseConfiguration();
        services.Replace(ServiceDescriptor.Scoped<IChromeConfigProjection, ContributedChromeProjection>());

        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<IChromeConfigProjection>()
            .Should().BeOfType<ContributedChromeProjection>(
                "Replace swaps the descriptor, so the contributed projection is the one the runtime resolves");
        services.Count(d => d.ServiceType == typeof(IChromeConfigProjection)).Should().Be(
            1, "Replace swaps the descriptor rather than stacking a second one");
    }

    [Fact]
    public void ContributedProjection_RegisteredWithReplace_WinsEvenWhenItRunsBeforeTheDefault()
    {
        // Replace is ORDER-INDEPENDENT: it swaps the descriptor whether or not the default is registered yet,
        // and the subsequent TryAdd sees a registration already present and stands down.
        var services = new ServiceCollection();
        services.Replace(ServiceDescriptor.Scoped<IChromeConfigProjection, ContributedChromeProjection>());
        services.AddExerciseConfiguration();

        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<IChromeConfigProjection>()
            .Should().BeOfType<ContributedChromeProjection>(
                "a contributor must not have to depend on the orchestrator's call order to win");
    }

    [Fact]
    public void ContributedProjection_RegisteredWithTryAdd_IsSilentlyIgnored_WhichIsWhyReplaceIsMandatory()
    {
        // THE trap this contract exists to close. A contributor that copies 01b's own TryAdd idiom loses:
        // the default is already present, so TryAdd stands down, no error is raised anywhere, the
        // contributor's own unit tests still pass — and every exercise serves the constant at runtime.
        var services = new ServiceCollection();
        services.AddExerciseConfiguration();
        services.TryAddScoped<IChromeConfigProjection, ContributedChromeProjection>();

        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<IChromeConfigProjection>()
            .Should().BeOfType<ConstantChromeConfigProjection>(
                "TryAdd is NOT an override — this is the silent failure the Replace rule prevents");
    }
}
