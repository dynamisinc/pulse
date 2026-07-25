namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
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
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Xunit;

/// <summary>
/// HTTP integration tests for the escalation-dial LIVE endpoints (feature: world-steering, story 09; CTL-022,
/// COR-001, XC-002), over a bespoke minimal host wired EXACTLY as the orchestrator will wire it into
/// <c>Program.cs</c> after Gate-2 (<c>AddStorylineSteering()</c> + <c>MapStorylineSteering()</c>), against the
/// shared migrated Testcontainers SQL Server (needed only for the reused staff-authorization gate's
/// <see cref="StaffAssignmentService"/> — the storyline itself is process-memory only, seeded straight into an
/// <see cref="IReactionLoopRegistry"/> instance this host owns). Every test is
/// <see cref="RequiresDockerFactAttribute"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class StorylineSteeringEndpointsTests
{
    private readonly MsSqlContainerFixture _fixture;

    public StorylineSteeringEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Routes_AreMappedExactlyOnce()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(Registration(exerciseId, SeededStoryline(exerciseId)), exerciseId);
        var dataSource = host.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "GET", "/api/steering/storylines/{storylineId}").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/steering/storylines/{storylineId}/target").Should().Be(1);
    }

    // ---- GET --------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task GetStoryline_ByRealId_ReturnsActualTargetPhase_FromTheLiveRegisteredStoryline()
    {
        var exerciseId = Guid.NewGuid();
        var storyline = SeededStoryline(exerciseId, intensity: 62);
        await using var host = await StartHostAsync(Registration(exerciseId, storyline), exerciseId);

        var response = await host.Client.GetAsync(new Uri($"/api/steering/storylines/{storyline.Id}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.GetProperty("storylineId").GetString().Should().Be(storyline.Id.ToString());
        doc.RootElement.GetProperty("exerciseId").GetString().Should().Be(exerciseId.ToString());
        doc.RootElement.GetProperty("intensity").GetInt32().Should().Be(62);
        doc.RootElement.GetProperty("targetIntensity").ValueKind.Should().Be(JsonValueKind.Null);
        doc.RootElement.GetProperty("phase").GetString().Should().Be("Seeded");
    }

    [RequiresDockerFact]
    public async Task GetStoryline_ByPrimarySentinel_ResolvesToTheCallersOwnFirstStoryline()
    {
        var exerciseId = Guid.NewGuid();
        var storyline = SeededStoryline(exerciseId);
        await using var host = await StartHostAsync(Registration(exerciseId, storyline), exerciseId);

        var response = await host.Client.GetAsync(new Uri("/api/steering/storylines/primary", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.GetProperty("storylineId").GetString().Should().Be(
            storyline.Id.ToString(), "the sentinel resolves to the caller's OWN exercise's first registered storyline");
    }

    [RequiresDockerFact]
    public async Task GetStoryline_ForeignExerciseStorylineId_Returns404_NeverThatExercisesData()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var storylineA = SeededStoryline(exerciseA);
        var storylineB = SeededStoryline(exerciseB);

        var registry = new ReactionLoopRegistry();
        registry.Register(Registration(exerciseA, storylineA));
        registry.Register(Registration(exerciseB, storylineB));

        await using var host = await StartHostAsync(registry, exerciseA);

        // Exercise A's staff caller asks for exercise B's REAL storyline id — must never resolve (COR-001).
        var response = await host.Client.GetAsync(new Uri($"/api/steering/storylines/{storylineB.Id}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "an id from another exercise must never resolve — never leak that exercise's storyline (COR-001)");
    }

    [RequiresDockerFact]
    public async Task GetStoryline_PrimarySentinel_ForAnExerciseWithNoRegisteredLoop_Returns404()
    {
        var registeredExercise = Guid.NewGuid();
        var callerExercise = Guid.NewGuid();
        await using var host = await StartHostAsync(
            Registration(registeredExercise, SeededStoryline(registeredExercise)), callerExercise);

        var response = await host.Client.GetAsync(new Uri("/api/steering/storylines/primary", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "the sentinel must resolve within the CALLER's own exercise only, never a different registered exercise");
    }

    [RequiresDockerFact]
    public async Task GetStoryline_UnresolvedScope_Returns401_FailClosed()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(
            Registration(exerciseId, SeededStoryline(exerciseId)), currentExerciseId: null);

        var response = await host.Client.GetAsync(new Uri("/api/steering/storylines/primary", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "an unresolved scope fails closed, never a default/empty-200");
    }

    [RequiresDockerFact]
    public async Task GetStoryline_NoStaffSession_ParticipantOrAnonymous_Returns401_FailClosed()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(
            Registration(exerciseId, SeededStoryline(exerciseId)), exerciseId, authenticatedStaff: false);

        var response = await host.Client.GetAsync(new Uri("/api/steering/storylines/primary", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "the staff-only steering surface must reject a non-staff session with 401 even when the exercise scope is resolved (COR-005)");
    }

    [RequiresDockerFact]
    public async Task GetStoryline_StaffNotAssignedToResolvedExercise_Returns403_FailClosed()
    {
        var resolvedExercise = Guid.NewGuid();
        var assignedElsewhere = Guid.NewGuid();
        await using var host = await StartHostAsync(
            Registration(resolvedExercise, SeededStoryline(resolvedExercise)),
            resolvedExercise,
            authenticatedStaff: true,
            assignedExerciseId: assignedElsewhere);

        var response = await host.Client.GetAsync(new Uri("/api/steering/storylines/primary", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden,
            "a staff user not assigned to the resolved exercise must be rejected with 403 (COR-005)");
    }

    // ---- POST target --------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task SetTarget_HappyPath_MutatesTheSameRegistryObject_AndReturnsTheUpdatedState()
    {
        var exerciseId = Guid.NewGuid();
        var storyline = SeededStoryline(exerciseId, intensity: 40);
        var registration = Registration(exerciseId, storyline);
        await using var host = await StartHostAsync(registration, exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/steering/storylines/{storyline.Id}/target", UriKind.Relative),
            new { target = 75 });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.GetProperty("targetIntensity").GetInt32().Should().Be(75);
        doc.RootElement.GetProperty("intensity").GetInt32().Should().Be(40, "setting a target never itself moves actual intensity");

        // The SAME in-memory object the registry (and therefore the reaction loop) holds was mutated — no
        // shadow/duplicate storyline (AC2).
        storyline.TargetIntensity.Should().Be(75);
        host.Registry.Active.Should().ContainSingle().Which.Storylines.Should().ContainSingle().Which.Should().BeSameAs(storyline);
    }

    [RequiresDockerFact]
    public async Task SetTarget_NullTarget_ClearsAPreviouslySetTarget()
    {
        var exerciseId = Guid.NewGuid();
        var storyline = SeededStoryline(exerciseId);
        storyline.SetTargetIntensity(50, 0);
        await using var host = await StartHostAsync(Registration(exerciseId, storyline), exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/steering/storylines/{storyline.Id}/target", UriKind.Relative),
            new { target = (int?)null });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.GetProperty("targetIntensity").ValueKind.Should().Be(JsonValueKind.Null);
        storyline.TargetIntensity.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task SetTarget_OutOfRange_Returns400_AndDoesNotMutate()
    {
        var exerciseId = Guid.NewGuid();
        var storyline = SeededStoryline(exerciseId);
        await using var host = await StartHostAsync(Registration(exerciseId, storyline), exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/steering/storylines/{storyline.Id}/target", UriKind.Relative),
            new { target = 137 });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        storyline.TargetIntensity.Should().BeNull("a rejected out-of-range target must never reach the domain mutator");
    }

    [RequiresDockerFact]
    public async Task SetTarget_ForeignExerciseStorylineId_Returns404_AndNeverMutatesIt()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var storylineA = SeededStoryline(exerciseA);
        var storylineB = SeededStoryline(exerciseB);

        var registry = new ReactionLoopRegistry();
        registry.Register(Registration(exerciseA, storylineA));
        registry.Register(Registration(exerciseB, storylineB));

        await using var host = await StartHostAsync(registry, exerciseA);

        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/steering/storylines/{storylineB.Id}/target", UriKind.Relative),
            new { target = 90 });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound, "an IDOR by exercise B's storyline id from A's scope must fail closed (COR-001)");
        storylineB.TargetIntensity.Should().BeNull("exercise A's caller must never be able to mutate exercise B's storyline");
    }

    [RequiresDockerFact]
    public async Task SetTarget_MissingBody_Returns400()
    {
        var exerciseId = Guid.NewGuid();
        var storyline = SeededStoryline(exerciseId);
        await using var host = await StartHostAsync(Registration(exerciseId, storyline), exerciseId);

        var content = new StringContent("null", System.Text.Encoding.UTF8, "application/json");
        var response = await host.Client.PostAsync(
            new Uri($"/api/steering/storylines/{storyline.Id}/target", UriKind.Relative), content);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [RequiresDockerFact]
    public async Task SetTarget_UnresolvedScope_Returns401_AndNeverMutates()
    {
        var exerciseId = Guid.NewGuid();
        var storyline = SeededStoryline(exerciseId);
        await using var host = await StartHostAsync(Registration(exerciseId, storyline), currentExerciseId: null);

        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/steering/storylines/{storyline.Id}/target", UriKind.Relative),
            new { target = 90 });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        storyline.TargetIntensity.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task SetTarget_NoStaffSession_Returns401_AndNeverMutates()
    {
        var exerciseId = Guid.NewGuid();
        var storyline = SeededStoryline(exerciseId);
        await using var host = await StartHostAsync(Registration(exerciseId, storyline), exerciseId, authenticatedStaff: false);

        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/steering/storylines/{storyline.Id}/target", UriKind.Relative),
            new { target = 90 });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        storyline.TargetIntensity.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task SetTarget_StaffNotAssignedToResolvedExercise_Returns403_AndNeverMutates()
    {
        var resolvedExercise = Guid.NewGuid();
        var assignedElsewhere = Guid.NewGuid();
        var storyline = SeededStoryline(resolvedExercise);
        await using var host = await StartHostAsync(
            Registration(resolvedExercise, storyline),
            resolvedExercise,
            authenticatedStaff: true,
            assignedExerciseId: assignedElsewhere);

        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/steering/storylines/{storyline.Id}/target", UriKind.Relative),
            new { target = 90 });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        storyline.TargetIntensity.Should().BeNull();
    }

    // ---- helpers ------------------------------------------------------------------------------------

    private static Storyline SeededStoryline(Guid exerciseId, int intensity = 62)
    {
        var storyline = Storyline.Create(
            exerciseId,
            title: "Water main contamination fears",
            expectation: "an official statement from the county",
            responseWindowMin: 20,
            initialIntensity: intensity,
            participatingPersonas: ["@rosa"],
            hashtags: ["#WaterIssues"]);
        storyline.Seed(0);
        return storyline;
    }

    private static ReactionLoopRegistration Registration(Guid exerciseId, Storyline storyline) => new()
    {
        ExerciseId = exerciseId,
        ExerciseBrief = "A fictional water-utility incident in the town of Cedar Falls.",
        TimeZone = "America/Chicago",
        ScenarioStart = DateTimeOffset.UtcNow,
        TimeZoneInfo = TimeZoneInfo.Utc,
        Storylines = [storyline],
        PersonasByHandle = new Dictionary<string, EnginePersona>(StringComparer.Ordinal),
        Autonomy = EngineAutonomyState.Create(exerciseId, AutonomyLevel.Suggest),
        ControllerDeskId = Guid.NewGuid(),
    };

    private Task<StorylineSteeringTestHost> StartHostAsync(
        ReactionLoopRegistration registration,
        Guid? currentExerciseId,
        bool authenticatedStaff = true,
        Guid? assignedExerciseId = null)
    {
        var registry = new ReactionLoopRegistry();
        registry.Register(registration);
        return StartHostAsync(registry, currentExerciseId, authenticatedStaff, assignedExerciseId);
    }

    private async Task<StorylineSteeringTestHost> StartHostAsync(
        ReactionLoopRegistry registry,
        Guid? currentExerciseId,
        bool authenticatedStaff = true,
        Guid? assignedExerciseId = null)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return await StorylineSteeringTestHost.StartAsync(
            _fixture.ConnectionString!, registry, currentExerciseId, authenticatedStaff, assignedExerciseId);
    }

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<Microsoft.AspNetCore.Routing.HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    /// <summary>
    /// A minimal host wired exactly as the orchestrator's future <c>Program.cs</c> edit will wire story 09
    /// (<c>AddStorylineSteering</c> + <c>MapStorylineSteering</c>), against the shared Testcontainers database
    /// (needed only for the reused staff-authorization gate). The <see cref="IReactionLoopRegistry"/> is a
    /// caller-supplied in-process instance (no DB row) so a test can seed a storyline directly and later
    /// inspect the SAME object for a no-shadow-mutation assertion.
    /// </summary>
    private sealed class StorylineSteeringTestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;

        private StorylineSteeringTestHost(WebApplication app, IReactionLoopRegistry registry)
        {
            _app = app;
            Registry = registry;
            Client = app.GetTestClient();
        }

        public HttpClient Client { get; }

        public IReactionLoopRegistry Registry { get; }

        public IServiceProvider Services => _app.Services;

        public static async Task<StorylineSteeringTestHost> StartAsync(
            string connectionString,
            IReactionLoopRegistry registry,
            Guid? currentExerciseId,
            bool authenticatedStaff = true,
            Guid? assignedExerciseId = null)
        {
            var staffUserId = Guid.NewGuid();
            var accessor = authenticatedStaff
                ? new StubCurrentStaffSessionAccessor(new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staffUserId })
                : new StubCurrentStaffSessionAccessor(null);

            if (authenticatedStaff && (assignedExerciseId ?? currentExerciseId) is { } assignExercise)
            {
                await SeedStaffAssignmentAsync(connectionString, staffUserId, assignExercise);
            }

            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseTestServer();
            builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;

            builder.Services.AddPulsePersistence(builder.Configuration);
            builder.Services.AddExerciseScoping();
            builder.Services.AddExerciseClock();

            // The caller-supplied registry instance — registered BEFORE AddStorylineSteering()'s TryAdd, so
            // the slice converges on this SAME instance rather than creating an empty one of its own.
            builder.Services.AddSingleton(registry);
            builder.Services.AddStorylineSteering();

            builder.Services.AddScoped<StaffAssignmentService>();
            builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
            builder.Services.AddScoped<ICurrentStaffSessionAccessor>(_ => accessor);

            builder.Services.RemoveAll<IExerciseContext>();
            builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = currentExerciseId });

            var app = builder.Build();
            app.MapStorylineSteering();
            await app.StartAsync();

            return new StorylineSteeringTestHost(app, registry);
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.DisposeAsync();
        }

        private static async Task SeedStaffAssignmentAsync(string connectionString, Guid staffUserId, Guid exerciseId)
        {
            var options = new Microsoft.EntityFrameworkCore.DbContextOptionsBuilder<PulseDbContext>()
                .UseSqlServer(connectionString)
                .Options;

            await using var context = new PulseDbContext(options);
            context.Exercises.Add(new Exercise
            {
                Id = exerciseId,
                Name = "Steering Auth Test Exercise",
                TimeZone = "UTC",
                Status = "active",
            });
            context.StaffAssignments.Add(new StaffAssignment
            {
                Id = Guid.NewGuid(),
                StaffUserId = staffUserId,
                ExerciseId = exerciseId,
                Role = "controller",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await context.SaveChangesAsync();
        }
    }
}
