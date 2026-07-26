namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration;

using System;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ParticipantShell;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// The END-TO-END half of the guard over the PROJECTION-OVERRIDE CONTRACT wave 3's three-way fan-out rests
/// on: 01b ships constant-preserving defaults with <c>TryAddScoped</c>, and stories 02/03 contribute real
/// projections from their own files with <c>services.Replace(...)</c>. Every test here drives the REAL HTTP
/// endpoint through a composed host against real SQL Server.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a DI-RESOLUTION test and not just a unit test of the projection class.</b> The failure this guards
/// against ships green: a contributor whose projection class is correct, and whose own unit tests pass,
/// registers it with an idiom that loses to the already-present default — and at runtime every exercise
/// silently serves the shipped constant. Exercising the projection class in isolation cannot catch that.
/// These tests drive the real HTTP endpoint over a fully composed provider so the registration idiom itself
/// is under test.
/// </para>
/// <para>
/// <b>The split (and why it matters to a Docker-less box).</b> The pure-DI assertions — the ones that need no
/// database at all — live in the sibling <see cref="ExerciseConfigurationProjectionRegistrationTests"/>,
/// OUTSIDE <see cref="MsSqlCollection"/>, so they run everywhere. Only the genuinely SQL-touching cases
/// belong here, and each is gated with <c>[RequiresDockerFact]</c> so it SKIPS cleanly (never hard-fails)
/// where Docker and <c>PULSE_TEST_SQL_CONNECTION</c> are both absent. Keep that line: a plain
/// <see cref="FactAttribute"/> in this class constructs the container fixture regardless and turns a
/// Docker-less run red.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseConfigurationCompositionTests
{
    private const string ContributedTopText = ContributedChromeProjection.TopText;
    private const string ContributedBottomText = ContributedChromeProjection.BottomText;

    private readonly MsSqlContainerFixture _fixture;

    public ExerciseConfigurationCompositionTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
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
}
