namespace Pulse.WebApi.Tests.Features.EngineRuntime.Usage;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
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
using Pulse.Core.Core.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Features.EngineRuntime.Usage;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Xunit;

/// <summary>
/// HTTP integration tests for <c>GET /api/engine/usage</c> (engine-telemetry-tuning story 03a, #401) over a
/// minimal host wired exactly as <c>Program.cs</c> wires the feature (<c>AddEngineReview()</c> +
/// <c>MapEngineReview()</c>) against the shared REAL SQL Server. These prove the parts a pure unit test cannot:
/// the route exists on the already-wired <c>/api/engine</c> group, the query runs (and what it runs against),
/// the frozen wire shape story 03c renders, the fail-closed <c>401</c>, and — the always-Critical one — that
/// the rollup is confined to the calling exercise by <c>PulseDbContext</c>'s CENTRAL query filter (COR-001).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class EngineUsageEndpointsTests
{
    private readonly MsSqlContainerFixture _fixture;

    public EngineUsageEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- wiring + wire shape ---------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task UsageRoute_IsMappedExactlyOnce_OnTheExistingEngineGroup()
    {
        await using var host = await StartHostAsync(Guid.NewGuid());
        var dataSource = host.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "GET", "/api/engine/usage").Should().Be(
            1, "the usage read joins the already-wired /api/engine group — no new slice, no Program.cs edit");

        // The pre-existing cockpit reads are untouched by the addition.
        CountRoutes(dataSource, "GET", "/api/engine/review-queue").Should().Be(1);
        CountRoutes(dataSource, "GET", "/api/engine/settings").Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task GetUsage_ReturnsTheDocumentedWireShape_TheFrozenSeamForTheFrontendPanel()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        await SeedGeneratedAsync(exerciseId, minutesAgo: 5);

        var response = await host.Client.GetAsync(new Uri("/api/engine/usage", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = doc.RootElement;

        foreach (var key in new[] { "window", "totals", "buckets", "byModel", "guardResults", "cost", "unparseableEvents" })
        {
            root.TryGetProperty(key, out _).Should().BeTrue($"the wire shape must carry '{key}'");
        }

        var window = root.GetProperty("window");
        window.GetProperty("clock").GetString().Should().Be(
            "wall-clock", "the panel labels its axis from this field rather than guessing the clock (COR-053)");
        window.GetProperty("windowMinutes").GetInt32().Should().Be(60);
        window.GetProperty("bucketMinutes").GetInt32().Should().Be(1);
        window.GetProperty("bucketCount").GetInt32().Should().Be(60);
        DateTimeOffset.Parse(window.GetProperty("fromWallClock").GetString()!, null).Should().BeBefore(
            DateTimeOffset.Parse(window.GetProperty("toWallClock").GetString()!, null));

        var totals = root.GetProperty("totals");
        foreach (var key in new[]
        {
            "calls", "inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens", "latency",
        })
        {
            totals.TryGetProperty(key, out _).Should().BeTrue($"totals must carry '{key}'");
        }

        var cost = root.GetProperty("cost");
        cost.GetProperty("currency").GetString().Should().Be("USD");
        cost.TryGetProperty("pricedTotalCost", out _).Should().BeTrue();
        cost.TryGetProperty("anyUnpriced", out _).Should().BeTrue();

        root.TryGetProperty("provider", out _).Should().BeFalse(
            "AC1: 'which provider is live now' is GET /api/engine/settings' single authoritative answer — this "
            + "endpoint never computes a second one");
    }

    [RequiresDockerFact]
    public async Task GetUsage_RollsUpThisExercisesGeneratedEvents_TokensLatencyAndGuardMix()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        await SeedGeneratedAsync(exerciseId, minutesAgo: 10, model: "gpt-5.4", inputTokens: 1000, outputTokens: 200, cacheReadTokens: 30, cacheCreationTokens: 4, latencyMs: 2000, guardResult: "pass");
        await SeedGeneratedAsync(exerciseId, minutesAgo: 9, model: "gpt-5.4", inputTokens: 1000, outputTokens: 200, cacheReadTokens: 30, cacheCreationTokens: 4, latencyMs: 4000, guardResult: "re-roll");

        var usage = await ReadUsageAsync(host);

        usage.GetProperty("totals").GetProperty("calls").GetInt32().Should().Be(2);
        usage.GetProperty("totals").GetProperty("inputTokens").GetInt64().Should().Be(2000);
        usage.GetProperty("totals").GetProperty("outputTokens").GetInt64().Should().Be(400);
        usage.GetProperty("totals").GetProperty("cacheReadInputTokens").GetInt64().Should().Be(60);
        usage.GetProperty("totals").GetProperty("cacheCreationInputTokens").GetInt64().Should().Be(8);
        usage.GetProperty("totals").GetProperty("latency").GetProperty("maxMs").GetDouble().Should().Be(4000);

        var guards = usage.GetProperty("guardResults").EnumerateArray()
            .ToDictionary(g => g.GetProperty("result").GetString()!, g => g.GetProperty("calls").GetInt32());
        guards.Should().BeEquivalentTo(new Dictionary<string, int> { ["pass"] = 1, ["re-roll"] = 1 });

        var models = usage.GetProperty("byModel").EnumerateArray().ToList();
        models.Should().ContainSingle();
        models[0].GetProperty("provider").GetString().Should().Be("AzureOpenAI");
        models[0].GetProperty("model").GetString().Should().Be("gpt-5.4");
        models[0].GetProperty("buckets").EnumerateArray().Sum(b => b.GetProperty("calls").GetInt32()).Should().Be(2);

        // No price entry for a live provider is committed, so the cost view says UNPRICED rather than $0.
        var cost = usage.GetProperty("cost").GetProperty("byModel").EnumerateArray().Single();
        cost.GetProperty("priced").GetBoolean().Should().BeFalse();
        cost.GetProperty("totalCost").ValueKind.Should().Be(
            JsonValueKind.Null, "the key is present and null — never a magic 0 the panel would render as free");
        usage.GetProperty("cost").GetProperty("anyUnpriced").GetBoolean().Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task GetUsage_CountsOnlyEngineGeneratedRows_NotTheRestOfTheEngineEventLog()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        await SeedGeneratedAsync(exerciseId, minutesAgo: 5);
        await SeedOtherEventAsync(exerciseId, EngineEventTypes.Decided, minutesAgo: 5);
        await SeedOtherEventAsync(exerciseId, EngineEventTypes.Published, minutesAgo: 5);

        var usage = await ReadUsageAsync(host);

        usage.GetProperty("totals").GetProperty("calls").GetInt32().Should().Be(
            1, "only engine.generated rows are model CALLS; the rest of the loop's events are not spend");
        usage.GetProperty("unparseableEvents").GetInt32().Should().Be(
            0, "and the other event types are filtered out in SQL, not read and then counted as unreadable");
    }

    [RequiresDockerFact]
    public async Task GetUsage_ExcludesRowsOutsideTheRequestedWindow()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        await SeedGeneratedAsync(exerciseId, minutesAgo: 5);
        await SeedGeneratedAsync(exerciseId, minutesAgo: 600);

        var oneHour = await ReadUsageAsync(host);
        oneHour.GetProperty("totals").GetProperty("calls").GetInt32().Should().Be(1);

        var oneDay = await ReadUsageAsync(host, "?windowMinutes=1440");
        oneDay.GetProperty("totals").GetProperty("calls").GetInt32().Should().Be(
            2, "widening the window reaches the older call");
        oneDay.GetProperty("window").GetProperty("bucketMinutes").GetInt32().Should().Be(
            24, "and the bucket width widens with it, so the series length stays bounded");
    }

    // ---- honest handling of unreadable payloads ---------------------------------------------------

    [RequiresDockerFact]
    public async Task GetUsage_WithNullAndMalformedPayloads_CountsThemExplicitly_AndNeither500sNorScoresThemAsZeros()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        await SeedGeneratedAsync(exerciseId, minutesAgo: 5, inputTokens: 1000, latencyMs: 2000);
        await SeedRawPayloadAsync(exerciseId, payload: null, minutesAgo: 5);
        await SeedRawPayloadAsync(exerciseId, payload: "{ not json", minutesAgo: 5);
        await SeedRawPayloadAsync(exerciseId, payload: "{\"provider\":\"AzureOpenAI\"}", minutesAgo: 5);

        var response = await host.Client.GetAsync(new Uri("/api/engine/usage", UriKind.Relative));
        response.StatusCode.Should().Be(
            HttpStatusCode.OK, "an unreadable payload must never 500 the read and hide every usable row");

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var usage = doc.RootElement;

        usage.GetProperty("unparseableEvents").GetInt32().Should().Be(
            3, "null, malformed and shape-mismatched rows are all surfaced as a COUNT on the wire");
        usage.GetProperty("totals").GetProperty("calls").GetInt32().Should().Be(
            1, "and none of them is silently counted as a zero-token, zero-latency call");
        usage.GetProperty("totals").GetProperty("latency").GetProperty("averageMs").GetDouble().Should().Be(
            2000, "which is what keeps the averages honest — three phantom zeros would have quartered this");
    }

    // ---- COR-001: fail closed + isolation ---------------------------------------------------------

    [RequiresDockerFact]
    public async Task GetUsage_UnresolvedScope_Returns401_FailClosed()
    {
        await using var host = await StartHostAsync(currentExerciseId: null);

        var response = await host.Client.GetAsync(new Uri("/api/engine/usage", UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "an unresolved scope fails closed — never a default/unscoped 200 rollup, which on a spend view "
            + "would be somebody else's numbers or a fabricated zero");
    }

    /// <summary>
    /// <b>The always-Critical isolation test (COR-001/XC-001), and it fails closed.</b> Two exercises each have
    /// <c>engine.generated</c> rows; the caller is scoped to A. It must see A's single call — not B's five —
    /// and the <c>IgnoreQueryFilters</c> read proves B's rows physically EXIST, so a passing assertion is the
    /// central query filter closing the door rather than an empty table. Note what is deliberately absent from
    /// <c>EngineUsageService</c>: any hand-written <c>ExerciseId</c> predicate, and any raw/aggregate SQL that
    /// would leave the entity pipeline and take that filter out of the loop.
    /// </summary>
    [RequiresDockerFact]
    public async Task GetUsage_SeesOnlyItsOwnExercisesCalls_WhileTheOtherExercisesRowsProvablyExist()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        await SeedGeneratedAsync(exerciseA, minutesAgo: 5, model: "model-a", inputTokens: 10);
        for (var index = 0; index < 5; index++)
        {
            await SeedGeneratedAsync(exerciseB, minutesAgo: 5, model: "model-b", inputTokens: 1_000_000);
        }

        await using var host = await StartHostAsync(exerciseA);
        var usage = await ReadUsageAsync(host);

        usage.GetProperty("totals").GetProperty("calls").GetInt32().Should().Be(
            1, "exercise A ran ONE model call; B's five must be invisible — an aggregate count is a leak too");
        usage.GetProperty("totals").GetProperty("inputTokens").GetInt64().Should().Be(
            10, "and B's five million tokens must not appear in A's spend");

        var models = usage.GetProperty("byModel").EnumerateArray().ToList();
        models.Should().ContainSingle();
        models[0].GetProperty("model").GetString().Should().Be(
            "model-a", "not even the NAME of another exercise's model may surface here");

        await using var verify = _fixture.CreateContext();
        (await verify.TelemetryEvents.IgnoreQueryFilters()
            .CountAsync(e => e.ExerciseId == exerciseB && e.EventType == EngineEventTypes.Generated))
            .Should().Be(
                5,
                "IgnoreQueryFilters proves B's rows are really there — so A's count of 1 is the central query "
                + "filter closing the door, not an empty table making the test pass for the wrong reason");
    }

    [RequiresDockerFact]
    public async Task GetUsage_FromAStaffSessionAssignedToADifferentExercise_FailsClosed()
    {
        var resolved = Guid.NewGuid();
        var assignedElsewhere = Guid.NewGuid();

        await SeedGeneratedAsync(resolved, minutesAgo: 5);
        await using var host = await StartHostAsync(resolved, assignedExerciseId: assignedElsewhere);

        var response = await host.Client.GetAsync(new Uri("/api/engine/usage", UriKind.Relative));

        response.StatusCode.Should().BeOneOf(
            [HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized],
            "a cross-exercise usage read must fail closed (COR-005) — the staff filter refuses a caller "
            + "assigned to another exercise before the handler runs");
    }

    [RequiresDockerFact]
    public async Task GetUsage_WithNoStaffSession_IsRefused()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, authenticatedStaff: false);

        var response = await host.Client.GetAsync(new Uri("/api/engine/usage", UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "engine call volume, cost and provider identity are STAFF-only (XC-002/SOC-003) — a participant or "
            + "anonymous caller never reaches the cockpit");
    }

    [RequiresDockerFact]
    public async Task GetUsage_IsReadableByAnAssignedEvaluator_NotJustAController()
    {
        // The usage read sits on the READ-ONLY cockpit group, not the #297 controller-role steering group: a
        // spend/volume view is observability, and an assigned evaluator may WATCH the cockpit.
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, assignedRole: "evaluator");

        var response = await host.Client.GetAsync(new Uri("/api/engine/usage", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    // ---- window validation ------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task GetUsage_WithAWindowOutsideTheSupportedBounds_Returns400_NeverASilentClamp()
    {
        await using var host = await StartHostAsync(Guid.NewGuid());

        foreach (var query in new[] { "?windowMinutes=0", "?windowMinutes=-5", "?windowMinutes=1441" })
        {
            var response = await host.Client.GetAsync(new Uri($"/api/engine/usage{query}", UriKind.Relative));

            response.StatusCode.Should().Be(
                HttpStatusCode.BadRequest,
                "a caller is never shown a different window than the one it asked for — silently clamping a "
                + "spend query is the plausible-but-wrong reading this view must avoid ({0})",
                query);
        }

        // The upper bound itself is ACCEPTED — otherwise the cap assertion above could pass off-by-one.
        var atCap = await host.Client.GetAsync(
            new Uri($"/api/engine/usage?windowMinutes={EngineUsageAggregator.MaxWindowMinutes}", UriKind.Relative));
        atCap.StatusCode.Should().Be(HttpStatusCode.OK, "the cap is inclusive");
    }

    // ---- host + helpers --------------------------------------------------------------------------

    private static async Task<JsonElement> ReadUsageAsync(UsageTestHost host, string query = "")
    {
        var response = await host.Client.GetAsync(new Uri($"/api/engine/usage{query}", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        // Cloned so the element survives the JsonDocument's disposal at the end of this helper.
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.Clone();
    }

    private async Task SeedGeneratedAsync(
        Guid exerciseId,
        int minutesAgo,
        string provider = "AzureOpenAI",
        string model = "gpt-5.4",
        int inputTokens = 0,
        int outputTokens = 0,
        int cacheReadTokens = 0,
        int cacheCreationTokens = 0,
        double latencyMs = 0,
        string guardResult = "pass")
    {
        var payload = new EngineEventPayloads.Generated
        {
            Storyline = Guid.NewGuid().ToString(),
            DraftId = Guid.NewGuid().ToString(),
            Provider = provider,
            Model = model,
            TokenUsage = new EngineEventPayloads.TokenUsage
            {
                InputTokens = inputTokens,
                OutputTokens = outputTokens,
                CacheReadInputTokens = cacheReadTokens,
                CacheCreationInputTokens = cacheCreationTokens,
            },
            LatencyMs = latencyMs,
            GuardResult = guardResult,
        };

        // Built by the REAL emitter, so these rows are byte-identical to what the reaction loop persists.
        var row = new EngineTelemetryEmitter().BuildEvent(
            EngineEventTypes.Generated,
            BuildContext(exerciseId, minutesAgo),
            payload);

        await SaveAsync(row);
    }

    private async Task SeedOtherEventAsync(Guid exerciseId, string eventType, int minutesAgo)
    {
        var row = new EngineTelemetryEmitter().BuildEvent(
            eventType,
            BuildContext(exerciseId, minutesAgo),
            new { storyline = "s", note = "not a model call" });

        await SaveAsync(row);
    }

    private async Task SeedRawPayloadAsync(Guid exerciseId, string? payload, int minutesAgo)
    {
        var row = new EngineTelemetryEmitter().BuildEvent(
            EngineEventTypes.Generated,
            BuildContext(exerciseId, minutesAgo));
        row.Payload = payload;

        await SaveAsync(row);
    }

    private static EngineTelemetryContext BuildContext(Guid exerciseId, int minutesAgo) => new()
    {
        ExerciseId = exerciseId,
        Channel = "social",
        TimeZone = "UTC",
        Actor = new EngineTelemetryActor { Kind = "engine" },
        WallClockTime = DateTimeOffset.UtcNow.AddMinutes(-minutesAgo),
        ScenarioTime = DateTimeOffset.UtcNow.AddMinutes(-minutesAgo),
    };

    private async Task SaveAsync(TelemetryEvent row)
    {
        await using var context = _fixture.CreateContext();
        context.TelemetryEvents.Add(row);
        await context.SaveChangesAsync();
    }

    private async Task<UsageTestHost> StartHostAsync(
        Guid? currentExerciseId,
        bool authenticatedStaff = true,
        Guid? assignedExerciseId = null,
        string assignedRole = "controller")
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return await UsageTestHost.StartAsync(
            _fixture.ConnectionString!, currentExerciseId, authenticatedStaff, assignedExerciseId, assignedRole);
    }

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    /// <summary>A publish funnel that never publishes — the usage read is a pure read and must not need one.</summary>
    private sealed class NoOpPublishService : IEnginePublishService
    {
        public Task<EngineBurstPublishResult> PublishBurstAsync(
            EngineBurst burst,
            System.Threading.CancellationToken cancellationToken = default)
            => Task.FromResult(new EngineBurstPublishResult { Posts = [] });
    }

    /// <summary>
    /// A minimal host wired exactly as <c>Program.cs</c> wires the feature (AddEngineGeneration →
    /// AddEngineReview → MapEngineReview), with a configurable staff session and a fixed server-authoritative
    /// exercise scope. Mirrors <c>EngineSettingsEndpointsTests</c>' host.
    /// </summary>
    private sealed class UsageTestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;

        private UsageTestHost(WebApplication app)
        {
            _app = app;
            Client = app.GetTestClient();
        }

        public HttpClient Client { get; }

        public IServiceProvider Services => _app.Services;

        public static async Task<UsageTestHost> StartAsync(
            string connectionString,
            Guid? currentExerciseId,
            bool authenticatedStaff,
            Guid? assignedExerciseId,
            string assignedRole)
        {
            var staffUserId = Guid.NewGuid();
            var accessor = authenticatedStaff
                ? new StubCurrentStaffSessionAccessor(
                    new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staffUserId })
                : new StubCurrentStaffSessionAccessor(null);

            if (authenticatedStaff && (assignedExerciseId ?? currentExerciseId) is { } assignExercise)
            {
                await SeedStaffAssignmentAsync(connectionString, staffUserId, assignExercise, assignedRole);
            }

            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseTestServer();
            builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;
            builder.Configuration["Generation:Provider"] = "Fake";

            builder.Services.AddPulsePersistence(builder.Configuration);
            builder.Services.AddExerciseScoping();
            builder.Services.AddSignalR();
            builder.Services.AddEngineGeneration(builder.Configuration);
            builder.Services.AddEngineRuntimeSeams();
            builder.Services.AddExerciseClock();
            builder.Services.AddEngineReview();

            // The review slice's auto-HOLD tick host resolves this; the usage read never publishes anything.
            builder.Services.AddSingleton<IEnginePublishService, NoOpPublishService>();

            builder.Services.AddScoped<StaffAssignmentService>();
            builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
            builder.Services.AddScoped<ICurrentStaffSessionAccessor>(_ => accessor);

            builder.Services.RemoveAll<IExerciseContext>();
            builder.Services.AddScoped<IExerciseContext>(
                _ => new ExerciseContext { CurrentExerciseId = currentExerciseId });

            var app = builder.Build();
            app.MapEngineReview();
            await app.StartAsync();

            return new UsageTestHost(app);
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
                Name = "Engine Usage Test Exercise",
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
