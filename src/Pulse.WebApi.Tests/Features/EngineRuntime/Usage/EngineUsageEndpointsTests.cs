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
using Microsoft.Extensions.Configuration;
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

        // Name-agnostic, matching the reflection pin: an enumerated key check would let a future
        // `liveProvider`/`currentProvider` through, and the wire is the half a client actually reads.
        root.EnumerateObject()
            .Select(property => property.Name)
            .Where(name => name.Contains("provider", StringComparison.OrdinalIgnoreCase))
            .Should().BeEmpty(
                "AC1: 'which provider is live now' is GET /api/engine/settings' single authoritative answer — this "
                + "endpoint never serves a second one under ANY top-level key spelling");
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

    // ==============================================================================================
    // ADVERSARIAL PASS (story 03a QA review). Everything below was added BESIDE the builder's suite,
    // not in place of it, to close gaps where the original coverage was silent or credited the wrong
    // mechanism. Nothing above was changed except the test host gaining an optional configuration
    // hook (needed by the priced-vs-unpriced wire test).
    // ==============================================================================================

    // ---- AC4: isolation, attacked ----------------------------------------------------------------

    /// <summary>
    /// <b>Isolation, extended to EVERY projection on the wire — not just <c>totals</c> and the model name.</b>
    /// The builder's crown-jewel test asserts A's call count, input tokens and model name. This one attacks the
    /// four projections it does not look at, each of which is an independent leak surface derived from the same
    /// query: the aggregate BUCKET series, the GUARD-RESULT mix (a distinctive literal only B produced), the
    /// COST rows, and <c>unparseableEvents</c> (B's malformed rows must not inflate A's honesty counter). B's
    /// rows are proven to physically exist with <c>IgnoreQueryFilters</c>, so every zero here is the central
    /// query filter closing the door rather than an empty table.
    /// </summary>
    [RequiresDockerFact]
    public async Task GetUsage_ScopesEverySeriesOnTheWire_NotJustTheTotals_WhileTheOtherExercisesRowsProvablyExist()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        await SeedGeneratedAsync(exerciseA, minutesAgo: 5, model: "model-a", inputTokens: 10, guardResult: "pass");

        // B: a different guard literal, a different provider/model, real tokens, and two unreadable payloads.
        for (var index = 0; index < 4; index++)
        {
            await SeedGeneratedAsync(
                exerciseB,
                minutesAgo: 5,
                provider: "ProviderB",
                model: "model-b",
                inputTokens: 1_000_000,
                guardResult: "b-only-guard-literal");
        }

        await SeedRawPayloadAsync(exerciseB, payload: "{ not json", minutesAgo: 5);
        await SeedRawPayloadAsync(exerciseB, payload: null, minutesAgo: 5);

        await using var host = await StartHostAsync(exerciseA);
        var usage = await ReadUsageAsync(host);

        usage.GetProperty("buckets").EnumerateArray().Sum(b => b.GetProperty("calls").GetInt32()).Should().Be(
            1, "the aggregate SERIES is a leak surface of its own — B's four calls must not raise A's histogram");

        usage.GetProperty("guardResults").EnumerateArray()
            .Select(g => g.GetProperty("result").GetString())
            .Should().Equal(
                new[] { "pass" },
                "a guard-result literal only the other exercise produced must not appear in A's mix — the mix "
                + "is grouped from the same rows the totals are, so it needs its own assertion");

        usage.GetProperty("cost").GetProperty("byModel").EnumerateArray()
            .Select(c => c.GetProperty("model").GetString())
            .Should().Equal(new[] { "model-a" }, "and the COST rows are scoped too, not just the volume rows");

        usage.GetProperty("unparseableEvents").GetInt32().Should().Be(
            0,
            "B's two unreadable rows must not inflate A's honesty counter — it is counted from the same scoped "
            + "query, so a leak there would make A's operator chase a data problem in somebody else's exercise");

        await using var verify = _fixture.CreateContext();
        (await verify.TelemetryEvents.IgnoreQueryFilters()
            .CountAsync(e => e.ExerciseId == exerciseB && e.EventType == EngineEventTypes.Generated))
            .Should().Be(
                6,
                "IgnoreQueryFilters proves all six of B's engine.generated rows (four readable, two unreadable) "
                + "are really in the table, so every zero above is the filter working, not an empty fixture");
    }

    /// <summary>
    /// <b>There is no client-supplied scope vector, and this proves it rather than assuming it.</b> The handler
    /// takes exactly one query parameter (<c>windowMinutes</c>); scope comes only from the server-authoritative
    /// <c>IExerciseContext</c>. A future refactor that accepted an <c>exerciseId</c> parameter "for convenience"
    /// would be the single worst regression this feature could ship, so the absence is pinned behaviourally: the
    /// request below ASKS for exercise B by every plausible parameter name and still receives only A's data.
    /// </summary>
    [RequiresDockerFact]
    public async Task GetUsage_IgnoresAnyClientSuppliedExerciseId_ScopeComesOnlyFromTheServerContext()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        await SeedGeneratedAsync(exerciseA, minutesAgo: 5, model: "model-a", inputTokens: 10);
        await SeedGeneratedAsync(exerciseB, minutesAgo: 5, model: "model-b", inputTokens: 5_000_000);

        await using var host = await StartHostAsync(exerciseA);

        var query = $"?exerciseId={exerciseB}&exercise={exerciseB}&ExerciseId={exerciseB}&scope={exerciseB}";
        var usage = await ReadUsageAsync(host, query);

        usage.GetProperty("totals").GetProperty("calls").GetInt32().Should().Be(
            1, "an exercise id supplied by the caller is not a scope — it is ignored outright");
        usage.GetProperty("totals").GetProperty("inputTokens").GetInt64().Should().Be(10);
        usage.GetProperty("byModel").EnumerateArray().Select(m => m.GetProperty("model").GetString())
            .Should().Equal(new[] { "model-a" });

        await using var verify = _fixture.CreateContext();
        (await verify.TelemetryEvents.IgnoreQueryFilters()
            .CountAsync(e => e.ExerciseId == exerciseB && e.EventType == EngineEventTypes.Generated))
            .Should().Be(1, "B's row exists, so A's blindness to it is the filter — not an empty table");
    }

    /// <summary>
    /// <b>Pins WHICH layer refuses a cross-exercise staff caller, and pins it exactly.</b> The neighbouring
    /// <c>GetUsage_FromAStaffSessionAssignedToADifferentExercise_FailsClosed</c> accepts either 401 or 403, which
    /// cannot tell the assignment gate from the service's own fail-closed path — and 401 is what the service
    /// returns, so a regression that broke the assignment check while leaving scope resolution intact could keep
    /// that assertion green. <c>403</c> is only reachable from
    /// <c>EngineCockpitStaffAuthorizationFilter</c>'s assignment branch, so asserting it exactly is what
    /// attributes the refusal to the right mechanism.
    /// </summary>
    [RequiresDockerFact]
    public async Task GetUsage_FromAStaffSessionAssignedElsewhere_IsRefusedWithExactly403_TheAssignmentGate()
    {
        var resolved = Guid.NewGuid();
        var assignedElsewhere = Guid.NewGuid();

        await SeedGeneratedAsync(resolved, minutesAgo: 5, inputTokens: 4_242);
        await using var host = await StartHostAsync(resolved, assignedExerciseId: assignedElsewhere);

        var response = await host.Client.GetAsync(new Uri("/api/engine/usage", UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "403 is reachable ONLY from the assignment branch of the cockpit staff filter (an unresolved scope "
            + "is 401 in both the filter and the service), so pinning it exactly is what proves the "
            + "cross-exercise refusal came from the assignment gate rather than from something else failing");

        (await response.Content.ReadAsStringAsync()).Should().NotContain(
            "4242", "and the refusal carries no fragment of the resolved exercise's spend");
    }

    // ---- layer ORDERING: does the auth gate really answer first? -----------------------------------

    /// <summary>
    /// <b>The minimal-API ordering trap, pinned in the direction that matters — on THIS host.</b> This endpoint
    /// takes a query parameter AND sits behind an <see cref="Microsoft.AspNetCore.Http.IEndpointFilter"/>, so
    /// "which answers first" is a real question. For a value that BINDS but is out of range, the answer is the
    /// correct one: validation lives in the service, behind the filter, so the caller gets <c>401</c> and learns
    /// nothing about the window bounds.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Read the attribution carefully.</b> What is measured here is <c>UsageTestHost</c>, which wires the
    /// feature's <c>AddEngineReview()</c>/<c>MapEngineReview()</c> pair and NO authentication or authorization
    /// middleware at all — so the only thing that can refuse is the slice's own
    /// <c>EngineCockpitStaffAuthorizationFilter</c>, reading the stubbed
    /// <c>ICurrentStaffSessionAccessor</c>. That is deliberately the harshest case for this assertion: with no
    /// outer gate present, the slice's own filter still answers before the service's validation.
    /// </para>
    /// <para>
    /// In the REAL host the first responder is something else and strictly earlier: <c>Program.cs</c>'s
    /// deny-by-default <c>AddSessionAuthorization()</c> <c>FallbackPolicy</c> + <c>app.UseAuthorization()</c>,
    /// which refuses every endpoint declaring no authorization metadata of its own except the eleven routes in
    /// <c>PreAuthAllowlist</c> — and <c>/api/engine/usage</c> is correctly NOT among them. So production is more
    /// closed than this test measures, not less; this test does not, and does not claim to, exercise that outer
    /// gate. Pinned anyway because a refactor that moved validation forward — into a route constraint, a binding
    /// attribute, or a filter registered ahead of the auth filter — would flip THIS layer to 400 while the outer
    /// gate silently masked the regression in production.
    /// </para>
    /// </remarks>
    [RequiresDockerFact]
    public async Task GetUsage_AnonymousWithAnOutOfRangeWindow_Is401_TheAuthGateAnswersBeforeValidation()
    {
        await using var host = await StartHostAsync(Guid.NewGuid(), authenticatedStaff: false);

        foreach (var query in new[] { "?windowMinutes=1441", "?windowMinutes=0", "?windowMinutes=-5", "?windowMinutes=2147483647" })
        {
            var response = await host.Client.GetAsync(new Uri($"/api/engine/usage{query}", UriKind.Relative));

            response.StatusCode.Should().Be(
                HttpStatusCode.Unauthorized,
                "refusal must come BEFORE validation: an unauthenticated caller is told 'no', not 'your window "
                + "is out of bounds' ({0})",
                query);
        }
    }

    /// <summary>
    /// <b>The trap this repo has been bitten by, checked and found NOT to apply to the slice's own filter.</b>
    /// Minimal-API parameter binding failures have historically been reported ahead of endpoint guards; measured
    /// on <c>UsageTestHost</c>, they are not. An <c>IEndpointFilter</c> wraps the innermost step that performs
    /// binding and reports a parameter-check failure, so <c>EngineCockpitStaffAuthorizationFilter</c> answers
    /// FIRST: a session-less caller sending a value that cannot bind at all gets <c>401</c>, not the framework's
    /// <c>400</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Scope of the claim.</b> <c>UsageTestHost</c> wires no authentication or authorization middleware, so the
    /// 401 here is the SLICE's filter and nothing else — which is the point: even with no outer gate to hide
    /// behind, binding does not answer ahead of the guard. It is NOT a measurement of the real pipeline. In the
    /// real host <c>Program.cs</c>'s deny-by-default <c>FallbackPolicy</c> (<c>AddSessionAuthorization()</c> +
    /// <c>app.UseAuthorization()</c>) refuses an anonymous caller earlier still, since <c>/api/engine/usage</c> is
    /// correctly absent from the eleven-route <c>PreAuthAllowlist</c>; production is strictly more closed than
    /// what is asserted below.
    /// </para>
    /// <para>
    /// Pinned because this layer is fragile in both directions and the outer gate would mask its loss. It would
    /// flip to <c>400</c> if this route were moved off a filtered group, if the slice gate were re-expressed as
    /// middleware ahead of routing, or if a binding attribute / route constraint moved validation in front of the
    /// filter — and on any host or future surface where the fallback policy does not apply, a <c>400</c> would
    /// tell an unauthenticated caller the endpoint exists and what its parameter looks like.
    /// </para>
    /// </remarks>
    [RequiresDockerFact]
    public async Task GetUsage_AnonymousWithAnUnbindableWindow_IsStill401_TheFilterWrapsParameterBinding()
    {
        await using var host = await StartHostAsync(Guid.NewGuid(), authenticatedStaff: false);

        foreach (var query in new[] { "?windowMinutes=abc", "?windowMinutes=99999999999999", "?windowMinutes=6.5", "?windowMinutes=" })
        {
            var response = await host.Client.GetAsync(new Uri($"/api/engine/usage{query}", UriKind.Relative));

            response.StatusCode.Should().Be(
                HttpStatusCode.Unauthorized,
                "the endpoint filter runs BEFORE the parameter-check failure is reported, so an anonymous caller "
                + "is refused rather than told what the endpoint's parameter looks like ({0})",
                query);
        }
    }

    /// <summary>
    /// <b>Both 400s exist, and they come from different layers — the response BODY is what tells them apart.</b>
    /// A value that cannot bind is rejected by the framework with an empty body; a value that binds but is out of
    /// range is rejected by <c>EngineUsageService</c> with a message naming the parameter. Pinned because the two
    /// are indistinguishable by status code alone, so a regression that lost the service's validation entirely
    /// (leaving only binding) would otherwise still look like a passing 400.
    /// </summary>
    [RequiresDockerFact]
    public async Task GetUsage_HasTwoDistinct400Paths_FrameworkBindingAndServiceValidation()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        foreach (var unbindable in new[] { "abc", "99999999999999", "6.5", string.Empty })
        {
            var binding = await host.Client.GetAsync(
                new Uri($"/api/engine/usage?windowMinutes={unbindable}", UriKind.Relative));

            binding.StatusCode.Should().Be(HttpStatusCode.BadRequest, "'{0}' cannot bind to int?", unbindable);
            (await binding.Content.ReadAsStringAsync()).Should().BeEmpty(
                "the FRAMEWORK rejected it during binding — the handler never ran, so there is no message ('{0}')",
                unbindable);
        }

        var validation = await host.Client.GetAsync(
            new Uri("/api/engine/usage?windowMinutes=1441", UriKind.Relative));

        validation.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await validation.Content.ReadAsStringAsync()).Should().Contain(
            "windowMinutes",
            "1441 BINDS fine, so this 400 came from the service's own bounds check — which is the one that would "
            + "silently disappear in a refactor while the status code kept looking right");
    }

    /// <summary>
    /// The gate also answers before validation for an AUTHENTICATED-but-unassigned caller: a cross-exercise
    /// staff session asking for an out-of-range window gets the COR-005 <c>403</c>, not a <c>400</c> that would
    /// have confirmed the endpoint's parameter bounds to somebody with no business reading it.
    /// </summary>
    [RequiresDockerFact]
    public async Task GetUsage_AssignedElsewhereWithAnOutOfRangeWindow_Is403NotAValidationError()
    {
        var resolved = Guid.NewGuid();
        await using var host = await StartHostAsync(resolved, assignedExerciseId: Guid.NewGuid());

        var response = await host.Client.GetAsync(
            new Uri("/api/engine/usage?windowMinutes=1441", UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "the assignment gate refuses before the service ever looks at windowMinutes");
    }

    /// <summary>
    /// <b>An OMITTED parameter takes the default; an EMPTY one does not — measured, and it matters to story 03c.</b>
    /// <c>?windowMinutes=</c> is a binding failure (<c>400</c>, asserted in
    /// <see cref="GetUsage_HasTwoDistinct400Paths_FrameworkBindingAndServiceValidation"/>), not a fall-through to
    /// the default. So the panel must OMIT the parameter to get the 60-minute default rather than sending an empty
    /// value from an unset control — a one-character difference between a working first read and a 400.
    /// </summary>
    [RequiresDockerFact]
    public async Task GetUsage_WithTheWindowParameterOmitted_TakesTheDocumentedDefault()
    {
        await using var host = await StartHostAsync(Guid.NewGuid());

        var usage = await ReadUsageAsync(host);

        usage.GetProperty("window").GetProperty("windowMinutes").GetInt32().Should().Be(
            EngineUsageAggregator.DefaultWindowMinutes, "the default is the panel's first read");
        usage.GetProperty("window").GetProperty("bucketCount").GetInt32().Should().Be(60);

        var empty = await host.Client.GetAsync(new Uri("/api/engine/usage?windowMinutes=", UriKind.Relative));
        empty.StatusCode.Should().Be(
            HttpStatusCode.BadRequest,
            "whereas an explicitly EMPTY value is rejected — recorded here so 03c sends no parameter at all "
            + "rather than an empty one");
    }

    // ---- AC3: the two zeroes must be distinguishable ON THE WIRE ----------------------------------

    /// <summary>
    /// <b>AC3's sharpest edge, proven end-to-end in ONE response body.</b> A model with a CONFIGURED ZERO rate
    /// and a model ABSENT from the table both produce "no cost", and the whole AC turns on a reader being able
    /// to tell them apart. The aggregator unit tests cover each state separately; this serves both in a single
    /// HTTP response and reads the raw JSON: the configured one is <c>priced: true</c> with a numeric
    /// <c>0</c> and its rates echoed, the absent one is <c>priced: false</c> with <c>totalCost</c> present-and-
    /// <c>null</c>. It also proves the host's serializer does not omit the null (a
    /// <c>DefaultIgnoreCondition</c> change would turn "unpriced" into "key missing", which a client reading
    /// <c>totalCost ?? 0</c> would render as free).
    /// </summary>
    [RequiresDockerFact]
    public async Task GetUsage_TellsAConfiguredZeroRateApartFromAnAbsentModel_OnTheWire()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(
            exerciseId,
            extraConfiguration: new Dictionary<string, string?>
            {
                ["Generation:Pricing:Currency"] = "USD",
                ["Generation:Pricing:Providers:Fake:fake-deterministic:InputPer1MTokens"] = "0",
                ["Generation:Pricing:Providers:Fake:fake-deterministic:OutputPer1MTokens"] = "0",
                ["Generation:Pricing:Providers:Fake:fake-deterministic:CacheReadPer1MTokens"] = "0",
                ["Generation:Pricing:Providers:Fake:fake-deterministic:CacheCreationPer1MTokens"] = "0",
            });

        // Two calls on the priced-at-zero model so it leads the breakdown, one on the unpriced model.
        await SeedGeneratedAsync(exerciseId, minutesAgo: 5, provider: "Fake", model: "fake-deterministic");
        await SeedGeneratedAsync(exerciseId, minutesAgo: 4, provider: "Fake", model: "fake-deterministic");
        await SeedGeneratedAsync(
            exerciseId, minutesAgo: 3, provider: "ClaudeFoundry", model: "claude-sonnet-5", inputTokens: 900_000);

        var usage = await ReadUsageAsync(host);
        var rows = usage.GetProperty("cost").GetProperty("byModel").EnumerateArray()
            .ToDictionary(c => c.GetProperty("model").GetString()!, c => c);

        var configuredZero = rows["fake-deterministic"];
        configuredZero.GetProperty("priced").GetBoolean().Should().BeTrue();
        configuredZero.GetProperty("totalCost").ValueKind.Should().Be(
            JsonValueKind.Number, "a CONFIGURED zero is a known number, so it is served as one");
        configuredZero.GetProperty("totalCost").GetDecimal().Should().Be(0m);
        configuredZero.GetProperty("rates").GetProperty("inputPer1MTokens").GetDecimal().Should().Be(
            0m, "and the applied rate is echoed, so the zero is visibly a rate rather than an unexplained zero");

        var absent = rows["claude-sonnet-5"];
        absent.GetProperty("priced").GetBoolean().Should().BeFalse();
        absent.GetProperty("totalCost").ValueKind.Should().Be(
            JsonValueKind.Null,
            "an ABSENT model asserts no cost at all — and the key is PRESENT-and-null, not omitted: a client "
            + "reading `totalCost ?? 0` on a missing key would render 900k unpriced tokens as free");
        absent.GetProperty("rates").ValueKind.Should().Be(JsonValueKind.Null);

        usage.GetProperty("cost").GetProperty("anyUnpriced").GetBoolean().Should().BeTrue(
            "one configured model does not make the total complete");
        usage.GetProperty("cost").GetProperty("pricedTotalCost").GetDecimal().Should().Be(
            0m, "the floor is genuinely zero here — the only priced model is the one that costs nothing");
        usage.GetProperty("totals").GetProperty("inputTokens").GetInt64().Should().Be(
            900_000, "while VOLUME stays complete: the unpriced model's tokens are reported in full");
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
        string assignedRole = "controller",
        IEnumerable<KeyValuePair<string, string?>>? extraConfiguration = null)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return await UsageTestHost.StartAsync(
            _fixture.ConnectionString!,
            currentExerciseId,
            authenticatedStaff,
            assignedExerciseId,
            assignedRole,
            extraConfiguration);
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
    /// A minimal host wired exactly as <c>Program.cs</c> wires the FEATURE (AddEngineGeneration →
    /// AddEngineReview → MapEngineReview), with a configurable staff session and a fixed server-authoritative
    /// exercise scope. Mirrors <c>EngineSettingsEndpointsTests</c>' host.
    /// </summary>
    /// <remarks>
    /// <b>It wires the feature, NOT the application pipeline.</b> There is no <c>UseAuthentication</c>,
    /// <c>UseAuthorization</c>, <c>AddSessionAuthorization</c>, exercise-resolution middleware or lifecycle gate
    /// here — so every refusal observed through this host comes from the slice's own
    /// <c>EngineCockpitStaffAuthorizationFilter</c> or from <c>EngineUsageService</c>, and never from
    /// <c>Program.cs</c>'s deny-by-default <c>FallbackPolicy</c>. That makes the refusals asserted here the
    /// slice's OWN guarantees (the useful thing to pin, since the outer gate would otherwise mask their loss),
    /// and it means no assertion here may be read as a measurement of the production pipeline, which refuses an
    /// anonymous caller earlier and harder.
    /// </remarks>
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
            string assignedRole,
            IEnumerable<KeyValuePair<string, string?>>? extraConfiguration = null)
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

            // No appsettings.json reaches this host's content root, so the price table binds EMPTY unless a test
            // supplies keys here — which is why most tests below read the explicit "unpriced" state.
            if (extraConfiguration is not null)
            {
                builder.Configuration.AddInMemoryCollection(extraConfiguration);
            }

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
