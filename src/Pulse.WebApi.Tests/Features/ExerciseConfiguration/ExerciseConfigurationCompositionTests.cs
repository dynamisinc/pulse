namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration;

using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ParticipantShell;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// Composition-root guard for <see cref="ExerciseConfigurationExtensions.AddExerciseConfiguration"/> and,
/// above all, for the PROJECTION-OVERRIDE CONTRACT wave 3's three-way fan-out rests on: 01b ships
/// constant-preserving defaults with <c>TryAddScoped</c>, and stories 02/03 contribute real projections from
/// their own files with <c>services.Replace(...)</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a DI-RESOLUTION test and not just a unit test of the projection class.</b> The failure this guards
/// against ships green: a contributor whose projection class is correct, and whose own unit tests pass,
/// registers it with an idiom that loses to the already-present default — and at runtime every exercise
/// silently serves the shipped constant. Exercising the projection class in isolation cannot catch that.
/// These tests resolve the interface from a fully composed provider (and, for the end-to-end case, drive the
/// real HTTP endpoint) so the registration idiom itself is under test.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseConfigurationCompositionTests
{
    private const string ContributedTopText = "CONTRIBUTED TOP BANNER";
    private const string ContributedBottomText = "CONTRIBUTED BOTTOM BANNER";

    private readonly MsSqlContainerFixture _fixture;

    public ExerciseConfigurationCompositionTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

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

    [RequiresDockerFact]
    public async Task WithoutAContributor_ChromeConfig_ServesTheShippedConstants_EndToEnd()
    {
        var exerciseId = Guid.NewGuid();
        await SeedUnconfiguredExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var root = await GetJsonAsync(host, "/api/chrome-config");

        root.GetProperty("top").GetProperty("text").GetString().Should().Be(
            ParticipantShellDefaults.ChromeTopText,
            "01b's default is constant-PRESERVING: behaviour is unchanged until story 02 contributes");
    }

    [RequiresDockerFact]
    public async Task ContributedProjection_RegisteredWithReplace_ReachesTheRealEndpoint_EndToEnd()
    {
        // The whole point of the seam, proven through the composed host and real HTTP rather than by
        // instantiating the projection class: a wave-3 contributor's projection is what /api/chrome-config
        // actually serves, and it sees the resolved exercise (per-exercise output, not a constant).
        var exerciseId = Guid.NewGuid();
        await SeedUnconfiguredExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(
            exerciseId,
            configureContributor: services =>
                services.Replace(ServiceDescriptor.Scoped<IChromeConfigProjection, ContributedChromeProjection>()));

        var root = await GetJsonAsync(host, "/api/chrome-config");

        root.GetProperty("top").GetProperty("text").GetString().Should().Be(
            ContributedTopText,
            "the contributed projection must be the one the endpoint resolves — not the TryAdded default");
        root.GetProperty("bottom").GetProperty("text").GetString().Should().Be(
            $"{ContributedBottomText} {exerciseId}",
            "and it must see the SERVER-RESOLVED exercise, so its output can be per-exercise");
    }

    [RequiresDockerFact]
    public async Task ContributedShellVariantAndOverlayProjections_ReachTheirRealEndpoints_EndToEnd()
    {
        // Story 03 contributes two projections from its own file; both must win the same way.
        var exerciseId = Guid.NewGuid();
        await SeedUnconfiguredExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(
            exerciseId,
            configureContributor: services =>
            {
                services.Replace(ServiceDescriptor.Scoped<IShellVariantProjection, ContributedShellVariantProjection>());
                services.Replace(ServiceDescriptor.Scoped<IOverlayStateProjection, ContributedOverlayStateProjection>());
            });

        var shellState = await GetJsonAsync(host, "/api/shell-state");
        shellState.GetProperty("variant").GetString().Should().Be("readOnly");

        var overlay = await GetJsonAsync(host, "/api/overlay-state");
        overlay.GetProperty("state").GetString().Should().Be("pause");
        overlay.GetProperty("message").GetString().Should().Be($"paused {exerciseId}");
    }

    private static async Task<JsonElement> GetJsonAsync(ExerciseConfigurationTestHost host, string route)
    {
        var response = await host.Client.GetAsync(new Uri(route, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK, "{0} must return 200 on a resolved scope", route);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private async Task SeedUnconfiguredExerciseAsync(Guid exerciseId)
    {
        await using var context = _fixture.CreateContext();
        context.Exercises.Add(ExerciseConfigurationTestData.UnconfiguredExercise(exerciseId));
        await context.SaveChangesAsync();
    }

    private Task<ExerciseConfigurationTestHost> StartHostAsync(
        Guid? exerciseId,
        Action<IServiceCollection>? configureContributor = null)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return ExerciseConfigurationTestHost.StartAsync(
            _fixture.ConnectionString!, exerciseId, configureContributor: configureContributor);
    }

    /// <summary>Stands in for story 02's <c>ChromeConfigProjection</c> — per-exercise, not a constant.</summary>
    private sealed class ContributedChromeProjection : IChromeConfigProjection
    {
        public Task<ChromeConfigResponse> ProjectAsync(ExerciseShellConfigSource source, CancellationToken cancellationToken = default)
        {
            ArgumentNullException.ThrowIfNull(source);

            return Task.FromResult(new ChromeConfigResponse
            {
                Enabled = source.ComplianceChromeEnabled,
                Top = new ChromeBannerConfig { Text = ContributedTopText, Fg = "#ffffff", Bg = "#000000" },
                Bottom = new ChromeBannerConfig
                {
                    Text = $"{ContributedBottomText} {source.ExerciseId}",
                    Fg = "#ffffff",
                    Bg = "#000000",
                },
            });
        }
    }

    /// <summary>Stands in for story 03's shell-variant projection.</summary>
    private sealed class ContributedShellVariantProjection : IShellVariantProjection
    {
        public Task<ShellStateResponse> ProjectAsync(ExerciseShellConfigSource source, CancellationToken cancellationToken = default)
        {
            ArgumentNullException.ThrowIfNull(source);
            return Task.FromResult(new ShellStateResponse { Variant = "readOnly" });
        }
    }

    /// <summary>Stands in for story 03's overlay-state projection.</summary>
    private sealed class ContributedOverlayStateProjection : IOverlayStateProjection
    {
        public Task<OverlayStateResponse> ProjectAsync(ExerciseShellConfigSource source, CancellationToken cancellationToken = default)
        {
            ArgumentNullException.ThrowIfNull(source);

            return Task.FromResult(new OverlayStateResponse
            {
                State = "pause",
                Register = "out-of-fiction",
                Message = $"paused {source.ExerciseId}",
            });
        }
    }
}
