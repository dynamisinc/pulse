namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

using System;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// <b>AC5, the end-to-end half of the projection-override contract.</b> Every test here drives the REAL
/// <c>/api/shell-state</c> and <c>/api/overlay-state</c> endpoints through a host composed exactly as the
/// orchestrator wires it (<c>AddExerciseConfiguration()</c> then <c>AddExerciseLifecycle()</c>) against real
/// SQL Server — so the REGISTRATION IDIOM itself is under test, not just the projection classes.
/// </summary>
/// <remarks>
/// The pure-DI half lives in <see cref="ExerciseLifecycleRegistrationTests"/>, OUTSIDE
/// <see cref="MsSqlCollection"/>, so it runs on a Docker-less box. Keep that split: a plain
/// <see cref="FactAttribute"/> in this class would construct the container fixture regardless and turn a
/// Docker-less run red.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseLifecycleCompositionTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ExerciseLifecycleCompositionTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>
    /// AC5/AC6: the contributed shell-variant projection is what <c>/api/shell-state</c> actually serves, and
    /// it is driven by THIS exercise's lifecycle state — not by 01b's constant <c>full</c>.
    /// </summary>
    [RequiresDockerTheory]
    [InlineData("live", "full")]
    [InlineData("staged", "readOnly")]
    [InlineData("paused", "readOnly")]
    public async Task ShellState_IsDrivenByTheLifecycle_EndToEnd(string state, string expectedVariant)
    {
        var exerciseId = await SeedAsync(state);
        await using var host = await StartAsync(exerciseId);

        var root = await GetJsonAsync(host, "/api/shell-state");

        root.GetProperty("variant").GetString().Should().Be(
            expectedVariant,
            "the contributed projection must be the one the endpoint resolves — not the TryAdded constant 'full'");
    }

    /// <summary>
    /// The proof the registration idiom is right: a lifecycle state that maps to a NON-default variant comes
    /// back. Had <c>AddExerciseLifecycle()</c> used <c>TryAddScoped</c>, this would silently be <c>full</c>.
    /// </summary>
    [RequiresDockerFact]
    public async Task ShellState_ForABuildExercise_IsPreview_ProvingReplaceBeatsTheConstantDefault()
    {
        var exerciseId = await SeedAsync("build");

        // Staff, because a build-state exercise refuses participants outright (AC3).
        await using var host = await StartAsync(exerciseId, authenticatedStaff: true);

        var root = await GetJsonAsync(host, "/api/shell-state");

        root.GetProperty("variant").GetString().Should().Be(
            "preview", "01b's constant default would have answered 'full' — Replace is what makes this per-exercise");
    }

    /// <summary>AC6: a Paused exercise serves the holding page through the unchanged frozen overlay shape.</summary>
    [RequiresDockerFact]
    public async Task OverlayState_ForAPausedExercise_ServesTheHoldingPage_EndToEnd()
    {
        var exerciseId = await SeedAsync("paused");
        await using var host = await StartAsync(exerciseId);

        var root = await GetJsonAsync(host, "/api/overlay-state");

        root.GetProperty("state").GetString().Should().Be("pause");
        root.GetProperty("register").GetString().Should().Be("out-of-fiction");
        root.GetProperty("message").GetString().Should().BeEmpty();
        root.EnumerateObject().Should().HaveCount(3, "the frozen OverlayStateResponse shape is filled, never reshaped");
    }

    /// <summary>A Live exercise with no steering overlay is byte-identical to the shipped Phase-1 constant.</summary>
    [RequiresDockerFact]
    public async Task OverlayState_ForALiveExercise_IsTheShippedConstant_EndToEnd()
    {
        var exerciseId = await SeedAsync("live");
        await using var host = await StartAsync(exerciseId);

        var root = await GetJsonAsync(host, "/api/overlay-state");

        root.GetProperty("state").GetString().Should().Be("none");
        root.GetProperty("register").GetString().Should().Be("in-fiction");
    }

    /// <summary>
    /// The world-steering merge, rehearsed end to end: an adapter contributed with <c>Replace</c> over
    /// <see cref="ISteeringOverlaySource"/> composes with the lifecycle Pause into ONE overlay.
    /// </summary>
    [RequiresDockerFact]
    public async Task AContributedSteeringOverlaySource_ComposesWithTheLifecyclePause_EndToEnd()
    {
        var exerciseId = await SeedAsync("paused");

        await using var host = await StartAsync(
            exerciseId,
            configureServices: services => services.Replace(
                ServiceDescriptor.Singleton<ISteeringOverlaySource, InFictionFreezeSource>()));

        var root = await GetJsonAsync(host, "/api/overlay-state");

        root.GetProperty("state").GetString().Should().Be("pause", "one composed overlay, never two competing ones");
        root.GetProperty("register").GetString().Should().Be(
            "out-of-fiction", "out-of-fiction dominates — staying in-fiction would hide a real stop");
        root.GetProperty("message").GetString().Should().Be(InFictionFreezeSource.FreezeMessage);
    }

    /// <summary>The frozen shell-state shape is filled, never reshaped.</summary>
    [RequiresDockerFact]
    public async Task ShellState_KeepsTheFrozenSingleFieldShape()
    {
        var exerciseId = await SeedAsync("live");
        await using var host = await StartAsync(exerciseId);

        var root = await GetJsonAsync(host, "/api/shell-state");

        root.EnumerateObject().Should().ContainSingle().Which.Name.Should().Be(
            "variant", "ShellStateResponse is a frozen contract — a changed key blanks the participant shell");
    }

    private static async Task<JsonElement> GetJsonAsync(ExerciseLifecycleTestHost host, string route)
    {
        var response = await host.Client.GetAsync(new Uri(route, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK, "{0} must return 200 on a resolved, served scope", route);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private async Task<Guid> SeedAsync(string status)
    {
        var exerciseId = Guid.NewGuid();

        await using var context = _fixture.CreateContext();
        context.Exercises.Add(ExerciseLifecycleTestData.ExerciseInState(exerciseId, status));
        await context.SaveChangesAsync();

        return exerciseId;
    }

    private Task<ExerciseLifecycleTestHost> StartAsync(
        Guid? currentExerciseId,
        bool authenticatedStaff = false,
        Action<IServiceCollection>? configureServices = null)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");

        return ExerciseLifecycleTestHost.StartAsync(
            _fixture.ConnectionString!,
            currentExerciseId,
            authenticatedStaff,
            configureServices: configureServices);
    }

    /// <summary>Stands in for the world-steering adapter registered at merge time (an in-fiction Freeze).</summary>
    private sealed class InFictionFreezeSource : ISteeringOverlaySource
    {
        public const string FreezeMessage = "Please stand by.";

        public OverlayContribution? GetCurrent(Guid exerciseId) =>
            new("pause", "in-fiction", FreezeMessage);
    }
}
