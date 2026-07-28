namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
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
using Pulse.Core.Core.Extensions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Xunit;

/// <summary>
/// HTTP integration tests for the engine-settings endpoints and the #297 controller-role gate
/// (autonomy-safety story 05), over a minimal host wired exactly as <c>Program.cs</c> wires the feature
/// (<c>AddEngineReview()</c> + <c>MapEngineReview()</c>) against the shared real SQL Server. Proves the three
/// routes exist on the already-mapped <c>/api/engine</c> group, the frozen wire shape story 06 builds against,
/// the fail-closed 401/400 cases, and — the #297 gate — that a non-controller assigned staff session is
/// rejected 403 on EVERY mutating route while both GETs stay open for observation.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class EngineSettingsEndpointsTests
{
    private readonly MsSqlContainerFixture _fixture;

    public EngineSettingsEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    /// <summary>Every MUTATING cockpit route, with a body that would otherwise be accepted — the #297 gate surface.</summary>
    private static IReadOnlyList<(string Route, object Body)> MutatingRoutes(Guid draftId) =>
    [
        ($"/api/engine/review/{draftId}/approve", new { actingHumanId = "c-1", timeZone = "UTC" }),
        ($"/api/engine/review/{draftId}/edit", new { actingHumanId = "c-1", timeZone = "UTC", text = "revised" }),
        ($"/api/engine/review/{draftId}/veto", new { actingHumanId = "c-1", timeZone = "UTC" }),
        ($"/api/engine/review/{draftId}/re-roll", new { actingHumanId = "c-1", timeZone = "UTC" }),
        ("/api/engine/review/batch-approve", new { actingHumanId = "c-1", timeZone = "UTC", draftIds = new[] { draftId.ToString() } }),
        ("/api/engine/autonomy/swamped-mode", new { actingHumanId = "c-1", enabled = true }),
        ("/api/engine/autonomy/kill-switch", new { actingHumanId = "c-1", mode = "drop-to-suggest" }),
        ("/api/engine/autonomy/restore", new { actingHumanId = "c-1", timeZone = "UTC" }),
        ("/api/engine/settings/autonomy-default", new { actingHumanId = "c-1", level = "delayed-auto" }),
        ("/api/engine/settings/tier-policy", new { actingHumanId = "c-1", mode = "ambient" }),
    ];

    [RequiresDockerFact]
    public async Task SettingsRoutes_AreMappedExactlyOnce_OnTheExistingEngineGroup()
    {
        await using var host = await StartHostAsync(Guid.NewGuid());
        var dataSource = host.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "GET", "/api/engine/settings").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/settings/autonomy-default").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/settings/tier-policy").Should().Be(1);

        // The pre-existing routes are unchanged by the new controller-role sub-group (empty prefix).
        CountRoutes(dataSource, "GET", "/api/engine/review-queue").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/autonomy/kill-switch").Should().Be(1);
    }

    // ---- the wire contract story 06 builds against ------------------------------------------------

    [RequiresDockerFact]
    public async Task GetSettings_ReturnsTheFullSnapshot_InTheDocumentedWireShape()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        var response = await host.Client.GetAsync(new Uri("/api/engine/settings", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = doc.RootElement;

        foreach (var key in new[] { "provider", "tiers", "autonomy", "tierPolicyMode", "inMemoryState", "inMemoryStateNote" })
        {
            root.TryGetProperty(key, out _).Should().BeTrue($"the settings contract requires a '{key}' key");
        }

        root.GetProperty("provider").GetString().Should().Be("Fake", "the test host runs the offline provider");
        root.GetProperty("tierPolicyMode").GetString().Should().Be("auto", "no override is set on a fresh exercise");
        root.GetProperty("inMemoryState").GetBoolean().Should().BeTrue();

        var tier = root.GetProperty("tiers").EnumerateArray().Single(t => t.GetProperty("tier").GetString() == "Standard");
        tier.GetProperty("model").GetString().Should().Be("claude-sonnet-5");
        tier.GetProperty("deployment").GetString().Should().Be("standard");
        tier.GetProperty("zdrCapable").GetBoolean().Should().BeTrue();

        var autonomy = root.GetProperty("autonomy");
        autonomy.GetProperty("exerciseDefaultLevel").GetString().Should().Be(
            "suggest", "the additive field reports the REAL default, so the cockpit no longer has to assume it");
        foreach (var key in new[] { "swampedMode", "generationStopped", "safetyClampActive", "degradedReason" })
        {
            autonomy.TryGetProperty(key, out _).Should().BeTrue($"the autonomy snapshot keeps its '{key}' key");
        }
    }

    [RequiresDockerFact]
    public async Task PostAutonomyDefault_DelayedAuto_Returns200_AndTheSnapshotReportsTheNewDefault()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/settings/autonomy-default", UriKind.Relative),
            new { actingHumanId = "controller-7", level = "delayed-auto", timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        doc.RootElement.GetProperty("autonomy").GetProperty("exerciseDefaultLevel").GetString()
            .Should().Be("delayed-auto");

        // The host's singleton registry is the one the loop reads — the change is live, not per-request.
        host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId)
            .ExerciseDefault.Should().Be(AutonomyLevel.DelayedAuto);
    }

    [RequiresDockerFact]
    public async Task PostAutonomyDefault_Auto_Returns400_AndChangesNothing()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/settings/autonomy-default", UriKind.Relative),
            new { actingHumanId = "controller-7", level = "auto" });

        response.StatusCode.Should().Be(
            HttpStatusCode.BadRequest, "selecting the v1.1 'auto' level is rejected, never silently clamped");
        host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId)
            .ExerciseDefault.Should().Be(AutonomyLevel.Suggest);
    }

    [RequiresDockerFact]
    public async Task PostAutonomyDefault_MissingActingHumanId_Returns400()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/settings/autonomy-default", UriKind.Relative),
            new { level = "delayed-auto" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "COR-018 requires actingHumanId");
    }

    [RequiresDockerFact]
    public async Task PostAutonomyDefault_MissingBody_Returns400()
    {
        await using var host = await StartHostAsync(Guid.NewGuid());

        var content = new StringContent("null", System.Text.Encoding.UTF8, "application/json");
        var response = await host.Client.PostAsync(
            new Uri("/api/engine/settings/autonomy-default", UriKind.Relative), content);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [RequiresDockerFact]
    public async Task PostTierPolicy_Returns200_AndTheSnapshotReportsTheMode()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/settings/tier-policy", UriKind.Relative),
            new { actingHumanId = "controller-7", mode = "ambient" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        doc.RootElement.GetProperty("tierPolicyMode").GetString().Should().Be("ambient");

        host.Services.GetRequiredService<EngineTierPolicyRegistry>().GetMode(exerciseId)
            .Should().Be(TierPolicyMode.Ambient, "the POST writes the singleton the reaction loop reads per burst");
    }

    [RequiresDockerFact]
    public async Task PostTierPolicy_UnknownMode_Returns400()
    {
        await using var host = await StartHostAsync(Guid.NewGuid());

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/settings/tier-policy", UriKind.Relative),
            new { actingHumanId = "controller-7", mode = "claude-opus-5" });

        response.StatusCode.Should().Be(
            HttpStatusCode.BadRequest,
            "only the three tier ROLE literals are settable — a concrete model/deployment is never expressible here (NFR-005)");
    }

    [RequiresDockerFact]
    public async Task GetSettings_ReportsBothTheBaseDefaultAndTheEffectiveLevel_WhileAClampIsActive()
    {
        // WR-003: story 06 must never have to infer "clamp active ⇒ effectively Suggest" from the wire.
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/settings/autonomy-default", UriKind.Relative),
            new { actingHumanId = "controller-7", level = "delayed-auto" });
        await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/kill-switch", UriKind.Relative),
            new { actingHumanId = "lead-1", mode = "drop-to-suggest" });

        var response = await host.Client.GetAsync(new Uri("/api/engine/settings", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var autonomy = doc.RootElement.GetProperty("autonomy");
        autonomy.GetProperty("exerciseDefaultLevel").GetString().Should().Be("delayed-auto");
        autonomy.GetProperty("effectiveLevel").GetString().Should().Be(
            "suggest", "the clamped level the loop actually routes on is on the wire, not re-derived by the consumer");
        autonomy.GetProperty("safetyClampActive").GetBoolean().Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task GetSettings_WhenFullyStopped_SerializesEffectiveLevelAsJsonNull()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/kill-switch", UriKind.Relative),
            new { actingHumanId = "lead-1", mode = "full-stop" });

        var response = await host.Client.GetAsync(new Uri("/api/engine/settings", UriKind.Relative));

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var autonomy = doc.RootElement.GetProperty("autonomy");
        autonomy.GetProperty("effectiveLevel").ValueKind.Should().Be(
            JsonValueKind.Null, "a full stop routes at no level; the key is present and null, never a misleading literal");
        autonomy.GetProperty("generationStopped").GetBoolean().Should().BeTrue();
    }

    // ---- COR-001: fail closed on an unresolved scope ----------------------------------------------

    [RequiresDockerFact]
    public async Task GetSettings_UnresolvedScope_Returns401_FailClosed()
    {
        await using var host = await StartHostAsync(currentExerciseId: null);

        var response = await host.Client.GetAsync(new Uri("/api/engine/settings", UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized, "an unresolved scope fails closed, never a default/unscoped 200 snapshot");
    }

    [RequiresDockerFact]
    public async Task SettingsPosts_UnresolvedScope_Return401_FailClosed()
    {
        await using var host = await StartHostAsync(currentExerciseId: null);

        var autonomy = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/settings/autonomy-default", UriKind.Relative),
            new { actingHumanId = "controller-7", level = "delayed-auto" });
        var tier = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/settings/tier-policy", UriKind.Relative),
            new { actingHumanId = "controller-7", mode = "ambient" });

        autonomy.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        tier.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [RequiresDockerFact]
    public async Task EveryRoute_FromAStaffSessionAssignedToADifferentExercise_FailsClosed()
    {
        // The cross-exercise attempt (COR-001/COR-005): a controller assigned to exercise B calling into the
        // resolved exercise A. Every route — both reads and every mutation — must fail closed (401/403).
        var resolved = Guid.NewGuid();
        var assignedElsewhere = Guid.NewGuid();
        var draftId = Guid.NewGuid();

        await using var host = await StartHostAsync(resolved, assignedExerciseId: assignedElsewhere);

        foreach (var route in new[] { "/api/engine/settings", "/api/engine/review-queue" })
        {
            var read = await host.Client.GetAsync(new Uri(route, UriKind.Relative));
            read.StatusCode.Should().BeOneOf(
                [HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized],
                $"a cross-exercise read of {route} must fail closed");
        }

        foreach (var (route, body) in MutatingRoutes(draftId))
        {
            var response = await host.Client.PostAsJsonAsync(new Uri(route, UriKind.Relative), body);
            response.StatusCode.Should().BeOneOf(
                [HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized],
                $"a cross-exercise mutation of {route} must fail closed");
        }

        host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(resolved)
            .ExerciseDefault.Should().Be(AutonomyLevel.Suggest, "nothing was mutated behind the closed door");
        host.Services.GetRequiredService<EngineTierPolicyRegistry>().GetMode(resolved)
            .Should().Be(TierPolicyMode.Auto);
    }

    // ---- #297: the controller-role gate -----------------------------------------------------------

    [RequiresDockerFact]
    public async Task EveryMutatingEngineRouteInTheRealRouteTable_IsCoveredByTheRoleGateTests()
    {
        // WR-001 drift guard: the gate-completeness tests above loop a HARDCODED list, and route→group
        // assignment is manual — a future story writing cockpit.MapPost("/api/engine/...") would get no role
        // gate AND no failing test (exactly the omission #297 was filed about). So derive the mutating
        // /api/engine surface from the REAL EndpointDataSource and require every route to be covered.
        await using var host = await StartHostAsync(Guid.NewGuid());
        var draftId = Guid.NewGuid();
        var covered = MutatingRoutes(draftId).Select(r => r.Route).ToList();

        var discovered = host.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText is { } raw
                && raw.StartsWith("/api/engine", StringComparison.OrdinalIgnoreCase))
            .Where(e => (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? [])
                .Any(m => !string.Equals(m, "GET", StringComparison.OrdinalIgnoreCase)
                    && !string.Equals(m, "HEAD", StringComparison.OrdinalIgnoreCase)
                    && !string.Equals(m, "OPTIONS", StringComparison.OrdinalIgnoreCase)))
            .Select(e => e.RoutePattern.RawText!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        discovered.Should().NotBeEmpty("the cockpit's mutating routes must be discoverable, or this guard proves nothing");

        // The matcher must discriminate, or every assertion below would pass vacuously.
        MatchesTemplate("/api/engine/review/{draftId:guid}/approve", $"/api/engine/review/{draftId}/approve")
            .Should().BeTrue();
        MatchesTemplate("/api/engine/review/{draftId:guid}/approve", $"/api/engine/review/{draftId}/veto")
            .Should().BeFalse();
        MatchesTemplate("/api/engine/settings/tier-policy", "/api/engine/settings/autonomy-default")
            .Should().BeFalse();

        foreach (var template in discovered)
        {
            covered.Should().Contain(
                route => MatchesTemplate(template, route),
                $"the mutating route '{template}' must be exercised by the controller-role gate tests — add it to " +
                "MutatingRoutes (and confirm it is mapped on the 'steering' sub-group), or #297 regresses silently");
        }

        foreach (var route in covered)
        {
            discovered.Should().Contain(
                template => MatchesTemplate(template, route),
                $"the covered route '{route}' is no longer in the route table — the gate list is stale");
        }
    }

    /// <summary>
    /// Whether a concrete request path matches a route template, each <c>{...}</c> placeholder standing for one
    /// path segment. Tokenizes the template into placeholder-or-literal runs and escapes ONLY the literals, so
    /// no sentinel character is round-tripped through the pattern (a literal space or brace in a future template
    /// would otherwise be indistinguishable from a placeholder marker).
    /// </summary>
    private static bool MatchesTemplate(string template, string concreteRoute)
    {
        var pattern = "^" + Regex.Replace(
            template,
            @"\{[^{}]*\}|[^{}]+",
            match => match.Value.StartsWith('{') ? "[^/]+" : Regex.Escape(match.Value)) + "$";

        return Regex.IsMatch(concreteRoute, pattern, RegexOptions.IgnoreCase);
    }

    [RequiresDockerFact]
    public async Task EveryMutatingRoute_FromANonControllerAssignedStaffSession_Returns403()
    {
        // An EVALUATOR assigned to the resolved exercise: it passes the staff + assignment gate but must not be
        // able to steer the engine (#297). Asserted on EVERY mutating route in the group, including the two
        // pre-existing autonomy controls and the review actions — not just this story's new POSTs.
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, assignedRole: "evaluator");

        foreach (var (route, body) in MutatingRoutes(draftId))
        {
            var response = await host.Client.PostAsJsonAsync(new Uri(route, UriKind.Relative), body);
            response.StatusCode.Should().Be(
                HttpStatusCode.Forbidden,
                $"{route} is a steering mutation: only a controller-role staff assignment may reach it (#297)");
        }

        host.Publisher.Published.Should().BeEmpty("the gate rejects before any publish funnel is reached");
        host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId)
            .SwampedModeEnabled.Should().BeFalse("no autonomy state was touched by the rejected calls");
        host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId)
            .ExerciseDefault.Should().Be(AutonomyLevel.Suggest);
        host.Services.GetRequiredService<EngineTierPolicyRegistry>().GetMode(exerciseId)
            .Should().Be(TierPolicyMode.Auto);
    }

    [RequiresDockerFact]
    public async Task BothGets_FromANonControllerAssignedStaffSession_Are200_SoAnEvaluatorCanWatch()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, assignedRole: "evaluator");

        var settings = await host.Client.GetAsync(new Uri("/api/engine/settings", UriKind.Relative));
        var queue = await host.Client.GetAsync(new Uri("/api/engine/review-queue", UriKind.Relative));

        settings.StatusCode.Should().Be(
            HttpStatusCode.OK, "an evaluator may WATCH the engine's settings — only steering is controller-only (#297)");
        queue.StatusCode.Should().Be(HttpStatusCode.OK, "the review-queue read stays open to any assigned staff");
    }

    [RequiresDockerFact]
    public async Task EveryMutatingRoute_FromAControllerAssignedStaffSession_IsNotBlockedByTheRoleGate()
    {
        // The positive control for the gate: the SAME calls that 403 for an evaluator get past the role filter
        // for a controller (each then resolves on its own merits — 404 for the unknown draft id, 200 for the
        // autonomy/settings controls — but never 401/403).
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, assignedRole: "controller");

        foreach (var (route, body) in MutatingRoutes(draftId))
        {
            var response = await host.Client.PostAsJsonAsync(new Uri(route, UriKind.Relative), body);
            response.StatusCode.Should().NotBe(
                HttpStatusCode.Unauthorized,
                $"a controller assigned to the resolved exercise must pass the auth gate on {route}");
            response.StatusCode.Should().NotBe(
                HttpStatusCode.Forbidden,
                $"a controller assigned to the resolved exercise must pass the role gate on {route}");
        }
    }

    [RequiresDockerFact]
    public async Task SettingsPosts_FromANonStaffSession_Return401()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, authenticatedStaff: false);

        var post = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/settings/autonomy-default", UriKind.Relative),
            new { actingHumanId = "controller-7", level = "delayed-auto" });
        var get = await host.Client.GetAsync(new Uri("/api/engine/settings", UriKind.Relative));

        post.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "a participant/anonymous caller never reaches the cockpit");
        get.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ---- host + helpers --------------------------------------------------------------------------

    private async Task<SettingsTestHost> StartHostAsync(
        Guid? currentExerciseId,
        bool authenticatedStaff = true,
        Guid? assignedExerciseId = null,
        string assignedRole = "controller")
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return await SettingsTestHost.StartAsync(
            _fixture.ConnectionString!, currentExerciseId, authenticatedStaff, assignedExerciseId, assignedRole);
    }

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    /// <summary>A capturing publish funnel — asserts the role gate rejects BEFORE anything could publish.</summary>
    private sealed class CapturingPublishService : IEnginePublishService
    {
        public List<EngineBurst> Published { get; } = [];

        public Task<EngineBurstPublishResult> PublishBurstAsync(EngineBurst burst, CancellationToken cancellationToken = default)
        {
            Published.Add(burst);
            return Task.FromResult(new EngineBurstPublishResult { Posts = [] });
        }
    }

    /// <summary>
    /// A minimal host wired exactly as <c>Program.cs</c> wires the feature (AddEngineGeneration →
    /// AddEngineReview → MapEngineReview), with a configurable staff session (authenticated? assigned where?
    /// which role?) and a fixed server-authoritative exercise scope.
    /// </summary>
    private sealed class SettingsTestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;

        private SettingsTestHost(WebApplication app, CapturingPublishService publisher)
        {
            _app = app;
            Publisher = publisher;
            Client = app.GetTestClient();
        }

        public HttpClient Client { get; }

        public CapturingPublishService Publisher { get; }

        public IServiceProvider Services => _app.Services;

        public static async Task<SettingsTestHost> StartAsync(
            string connectionString,
            Guid? currentExerciseId,
            bool authenticatedStaff,
            Guid? assignedExerciseId,
            string assignedRole)
        {
            var publisher = new CapturingPublishService();
            var staffUserId = Guid.NewGuid();
            var accessor = authenticatedStaff
                ? new StubCurrentStaffSessionAccessor(new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staffUserId })
                : new StubCurrentStaffSessionAccessor(null);

            if (authenticatedStaff && (assignedExerciseId ?? currentExerciseId) is { } assignExercise)
            {
                await SeedStaffAssignmentAsync(connectionString, staffUserId, assignExercise, assignedRole);
            }

            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseTestServer();
            builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;

            // Governed tier config (the Fake provider needs none, but GET /settings reports the mapping).
            builder.Configuration["Generation:Provider"] = "Fake";
            builder.Configuration["Generation:Tiers:Standard:Model"] = "claude-sonnet-5";
            builder.Configuration["Generation:Tiers:Standard:Deployment"] = "standard";
            builder.Configuration["Generation:Tiers:Ambient:Model"] = "claude-haiku-5";
            builder.Configuration["Generation:Tiers:Ambient:Deployment"] = "ambient";

            builder.Services.AddPulsePersistence(builder.Configuration);
            builder.Services.AddExerciseScoping();
            builder.Services.AddSignalR();
            builder.Services.AddEngineGeneration(builder.Configuration);
            builder.Services.AddEngineRuntimeSeams();
            builder.Services.AddExerciseClock();
            builder.Services.AddEngineReview();

            builder.Services.AddScoped<StaffAssignmentService>();
            builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
            builder.Services.AddScoped<ICurrentStaffSessionAccessor>(_ => accessor);

            builder.Services.AddSingleton<IEnginePublishService>(publisher);

            builder.Services.RemoveAll<IExerciseContext>();
            builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = currentExerciseId });

            var app = builder.Build();
            app.MapEngineReview();
            await app.StartAsync();

            return new SettingsTestHost(app, publisher);
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.DisposeAsync();
        }

        private static async Task SeedStaffAssignmentAsync(
            string connectionString,
            Guid staffUserId,
            Guid exerciseId,
            string role)
        {
            var options = new DbContextOptionsBuilder<PulseDbContext>()
                .UseSqlServer(connectionString)
                .Options;

            await using var context = new PulseDbContext(options);
            context.Exercises.Add(new Exercise
            {
                Id = exerciseId,
                Name = "Engine Settings Test Exercise",
                TimeZone = "UTC",
                Status = "active",
            });
            context.StaffAssignments.Add(new StaffAssignment
            {
                Id = Guid.NewGuid(),
                StaffUserId = staffUserId,
                ExerciseId = exerciseId,
                Role = role,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await context.SaveChangesAsync();
        }
    }
}
