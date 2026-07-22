namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// HTTP integration tests for the review-cockpit endpoints (story 02) over a bespoke minimal host wired
/// EXACTLY as the orchestrator will wire it into <c>Program.cs</c> after Gate-2 (<c>AddEngineReview()</c> +
/// <c>MapEngineReview()</c>), against the shared migrated Testcontainers SQL Server. Proves the route
/// mapping, the fail-closed scope handling (401 on an unresolved scope — extending the standing isolation
/// suite), the IDOR 404 (COR-001), and the publish/telemetry wiring end to end over real HTTP. Story 01's
/// <see cref="IEnginePublishService"/> is a capturing fake (contract-first seam; 01 owns the impl). Every
/// test is <see cref="RequiresDockerFactAttribute"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class EngineReviewEndpointsTests
{
    private readonly MsSqlContainerFixture _fixture;

    public EngineReviewEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Routes_AreMappedExactlyOnce()
    {
        await using var host = await StartHostAsync(Guid.NewGuid());
        var dataSource = host.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "GET", "/api/engine/review-queue").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/review/{draftId:guid}/approve").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/review/{draftId:guid}/edit").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/review/{draftId:guid}/veto").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/review/{draftId:guid}/re-roll").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/review/batch-approve").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/autonomy/swamped-mode").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/autonomy/kill-switch").Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task GetQueue_ReturnsScopedQueue_ExcludingResolved_InTheFrozenShape()
    {
        var exerciseId = Guid.NewGuid();
        var queued = Guid.NewGuid();
        var counting = Guid.NewGuid();
        var published = Guid.NewGuid();
        await SeedAsync(
            Item(queued, exerciseId, AutonomyLevel.Suggest, DraftDisposition.Queued, countdown: false),
            Item(counting, exerciseId, AutonomyLevel.DelayedAuto, DraftDisposition.CountingDown, countdown: true),
            Item(published, exerciseId, AutonomyLevel.Suggest, DraftDisposition.Published, countdown: false));

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.GetAsync(new Uri("/api/engine/review-queue", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        var items = doc.RootElement.EnumerateArray().ToList();

        items.Select(i => i.GetProperty("draftId").GetString())
            .Should().BeEquivalentTo(new[] { queued.ToString(), counting.ToString() },
                "the queue serves queued + counting-down + held, never resolved items");

        // The wire shape deserializes into the frozen reviewContracts.ts EngineReviewItem field-for-field.
        var sample = items.Single(i => i.GetProperty("draftId").GetString() == counting.ToString());
        foreach (var key in new[] { "exerciseId", "storylineId", "routedAtLevel", "disposition", "countdown", "posts", "storylineTag" })
        {
            sample.TryGetProperty(key, out _).Should().BeTrue($"the frozen contract requires a '{key}' key");
        }

        sample.GetProperty("disposition").GetString().Should().Be("counting-down");
    }

    [RequiresDockerFact]
    public async Task GetQueue_UnresolvedScope_Returns401_FailClosed()
    {
        var exerciseId = Guid.NewGuid();
        await SeedAsync(Item(Guid.NewGuid(), exerciseId, AutonomyLevel.Suggest, DraftDisposition.Queued, countdown: false));

        await using var host = await StartHostAsync(currentExerciseId: null);
        var response = await host.Client.GetAsync(new Uri("/api/engine/review-queue", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "an unresolved scope fails closed, never a default/empty-200");
    }

    [RequiresDockerFact]
    public async Task GetQueue_InExerciseA_NeverSurfacesExerciseBsItems()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var draftA = Guid.NewGuid();
        var draftB = Guid.NewGuid();
        await SeedAsync(
            Item(draftA, exerciseA, AutonomyLevel.Suggest, DraftDisposition.Queued, countdown: false),
            Item(draftB, exerciseB, AutonomyLevel.Suggest, DraftDisposition.Queued, countdown: false));

        await using var host = await StartHostAsync(exerciseA);
        var response = await host.Client.GetAsync(new Uri("/api/engine/review-queue", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateArray().Select(i => i.GetProperty("draftId").GetString())
            .Should().ContainSingle().Which.Should().Be(draftA.ToString(), "COR-001: a queue read in A never surfaces B's item");
    }

    [RequiresDockerFact]
    public async Task Approve_HappyPath_Returns200_Publishes_AndMarksPublished()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(Item(draftId, exerciseId, AutonomyLevel.DelayedAuto, DraftDisposition.CountingDown, countdown: true));

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/engine/review/{draftId}/approve", UriKind.Relative),
            new { actingHumanId = "controller-7", timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        host.Publisher.Published.Should().ContainSingle().Which.DraftId.Should().Be(draftId);

        await using var verify = _fixture.CreateContext();
        var reloaded = await verify.EngineReviewItems.IgnoreQueryFilters().SingleAsync(i => i.DraftId == draftId);
        reloaded.Disposition.Should().Be(DraftDisposition.Published);
    }

    [RequiresDockerFact]
    public async Task Approve_ForeignDraftId_FromExerciseAScope_Returns404_AndNeverPublishes()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var draftB = Guid.NewGuid();
        await SeedAsync(Item(draftB, exerciseB, AutonomyLevel.DelayedAuto, DraftDisposition.CountingDown, countdown: true));

        await using var host = await StartHostAsync(exerciseA);
        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/engine/review/{draftB}/approve", UriKind.Relative),
            new { actingHumanId = "controller-7", timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound, "an IDOR by exercise B's draft id from A's scope must fail closed (COR-001)");
        host.Publisher.Published.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Approve_MissingActingHumanId_Returns400()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(Item(draftId, exerciseId, AutonomyLevel.DelayedAuto, DraftDisposition.CountingDown, countdown: true));

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/engine/review/{draftId}/approve", UriKind.Relative),
            new { timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "COR-018 requires actingHumanId for a review decision");
        host.Publisher.Published.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Approve_UnresolvedScope_Returns401()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(Item(draftId, exerciseId, AutonomyLevel.DelayedAuto, DraftDisposition.CountingDown, countdown: true));

        await using var host = await StartHostAsync(currentExerciseId: null);
        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/engine/review/{draftId}/approve", UriKind.Relative),
            new { actingHumanId = "controller-7", timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        host.Publisher.Published.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Veto_HappyPath_Returns200_MarksVetoed_AndNeverPublishes()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(Item(draftId, exerciseId, AutonomyLevel.DelayedAuto, DraftDisposition.CountingDown, countdown: true));

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/engine/review/{draftId}/veto", UriKind.Relative),
            new { actingHumanId = "controller-3", timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        host.Publisher.Published.Should().BeEmpty("a veto never publishes");

        await using var verify = _fixture.CreateContext();
        var reloaded = await verify.EngineReviewItems.IgnoreQueryFilters().SingleAsync(i => i.DraftId == draftId);
        reloaded.Disposition.Should().Be(DraftDisposition.Vetoed);
    }

    [RequiresDockerFact]
    public async Task SwampedMode_Enable_Returns200_WithSwampedModeOn()
    {
        var exerciseId = Guid.NewGuid();

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/swamped-mode", UriKind.Relative),
            new { actingHumanId = "lead-1", enabled = true });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.GetProperty("swampedMode").GetBoolean().Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task KillSwitch_InvalidMode_Returns400()
    {
        var exerciseId = Guid.NewGuid();

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/kill-switch", UriKind.Relative),
            new { actingHumanId = "lead-1", mode = "nope" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // ---- host + helpers -------------------------------------------------------------------------

    private async Task<EngineReviewTestHost> StartHostAsync(Guid? currentExerciseId)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return await EngineReviewTestHost.StartAsync(_fixture.ConnectionString!, currentExerciseId);
    }

    private async Task SeedAsync(params EngineReviewItemEntity[] items)
    {
        await using var seed = _fixture.CreateContext();
        seed.EngineReviewItems.AddRange(items);
        await seed.SaveChangesAsync();
    }

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<Microsoft.AspNetCore.Routing.HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    private static EngineReviewItemEntity Item(
        Guid draftId,
        Guid exerciseId,
        AutonomyLevel level,
        DraftDisposition disposition,
        bool countdown) => new()
    {
        DraftId = draftId,
        ExerciseId = exerciseId,
        StorylineId = Guid.NewGuid(),
        RoutedAtLevel = level,
        Disposition = disposition,
        CountdownStartedScenarioMinute = countdown ? 0 : null,
        CountdownMinutes = countdown ? 5 : null,
        CountdownDecision = countdown ? ControllerDecision.None : null,
        StorylineTag = "#WaterIssues",
        StorylineBrief = "Rising frustration about the water outage.",
        ActionLabel = "reply → @mvega_fh",
        Posts = new List<EngineReviewDraftPost>
        {
            new() { PersonaHandle = "@mvega_fh", Text = "Water pressure is dropping.", Sentiment = -0.3, Hashtags = new List<string> { "#WaterIssues" } },
        },
    };

    /// <summary>A capturing <see cref="IEnginePublishService"/> stand-in for story 01's funnel (contract-first seam).</summary>
    private sealed class CapturingEnginePublishService : IEnginePublishService
    {
        public List<EngineBurst> Published { get; } = new();

        public Task<EngineBurstPublishResult> PublishBurstAsync(EngineBurst burst, CancellationToken cancellationToken = default)
        {
            Published.Add(burst);
            return Task.FromResult(new EngineBurstPublishResult
            {
                Posts = burst.Posts
                    .Select(p => new EnginePublishedPost
                    {
                        PersonaHandle = p.PersonaHandle,
                        PostId = Guid.NewGuid(),
                        Outcome = EnginePublishOutcome.Published,
                    })
                    .ToList(),
            });
        }
    }

    /// <summary>
    /// A minimal host wired exactly as the orchestrator's future <c>Program.cs</c> edit will wire story 02
    /// (AddEngineReview + MapEngineReview), against the shared Testcontainers database. The non-request-bound
    /// tick host is removed so the HTTP tests are deterministic (the scenario clock is unstarted here, so no
    /// countdown would expire anyway); the auto-HOLD tick is exercised directly in the service suite.
    /// </summary>
    private sealed class EngineReviewTestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;

        private EngineReviewTestHost(WebApplication app, CapturingEnginePublishService publisher)
        {
            _app = app;
            Publisher = publisher;
            Client = app.GetTestClient();
        }

        public HttpClient Client { get; }

        public CapturingEnginePublishService Publisher { get; }

        public IServiceProvider Services => _app.Services;

        public static async Task<EngineReviewTestHost> StartAsync(string connectionString, Guid? currentExerciseId)
        {
            var publisher = new CapturingEnginePublishService();

            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseTestServer();
            builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;

            // Wire exactly the production prerequisites the review endpoints depend on, then the feature.
            builder.Services.AddPulsePersistence(builder.Configuration);
            builder.Services.AddExerciseScoping();
            builder.Services.AddSignalR();
            builder.Services.AddEngineRuntimeSeams();
            builder.Services.AddExerciseClock();
            builder.Services.AddEngineReview();

            // The auto-HOLD tick host stays registered (production-faithful) but is inert in these HTTP tests:
            // the scenario clock is never started here, so every exercise reads scenario minute 0 and no
            // countdown reaches its deadline — no auto-HOLD fires. EvaluateAutoHold is exercised directly in the
            // service suite. (Do NOT RemoveAll<IHostedService> — that would also drop the web host service.)

            // Story 01's publish funnel (contract-first seam) — capturing fake here.
            builder.Services.AddSingleton<IEnginePublishService>(publisher);

            // The server-authoritative request scope (fixed per host; null = the fail-closed case).
            builder.Services.RemoveAll<IExerciseContext>();
            builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = currentExerciseId });

            var app = builder.Build();
            app.MapEngineReview();
            await app.StartAsync();

            return new EngineReviewTestHost(app, publisher);
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.DisposeAsync();
        }
    }
}
