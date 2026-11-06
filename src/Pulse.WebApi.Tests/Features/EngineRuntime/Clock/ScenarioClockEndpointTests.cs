namespace Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

using System;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Persistence;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Social;

/// <summary>
/// fix/noise-new-posts-clock §1: <c>GET /api/clock</c>. The handler's contract (shape, not-started / running / frozen,
/// isolation, fail-closed 401) is proven Docker-free over a self-mapped TestServer with a hand-advanced clock; the
/// REAL <c>Program</c> host's wiring (mapped once, default-deny 401 for an anonymous caller, the observer composed
/// beside the persistence sink) is proven over a never-connecting host; and the session-bound read through the real
/// pipeline runs against SQL in <see cref="ScenarioClockHostTests"/>.
/// </summary>
public sealed class ScenarioClockEndpointTests
{
    private static readonly Uri ClockUri = new("/api/clock", UriKind.Relative);
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 14, 8, 0, 0, TimeSpan.FromHours(-5));
    private static readonly DateTimeOffset WallStart = new(2026, 10, 21, 14, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Shape_IsExactlyTheFrozenContractsFourFields()
    {
        await using var host = await ClockHost.StartAsync();
        host.Scope = Guid.NewGuid();
        host.Clock.Start(host.Scope.Value, ScenarioStart, TimeZoneInfo.Utc);

        using var document = await host.GetJsonAsync();

        document.RootElement.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            ["started", "frozen", "scenarioTime", "serverTime"],
            "the wire shape mirrors ScenarioClockState field-for-field: scenario time only, no tier or provenance (XC-002)");
        document.RootElement.GetProperty("serverTime").GetString().Should().EndWith("Z", "serverTime is ISO-8601 UTC");
        document.RootElement.GetProperty("scenarioTime").GetString().Should().EndWith("Z", "scenarioTime is ISO-8601 UTC");
    }

    [Fact]
    public async Task NotStarted_ReadsStartedFalse_FrozenFalse_AndANullScenarioTime()
    {
        await using var host = await ClockHost.StartAsync();
        host.Scope = Guid.NewGuid();

        using var document = await host.GetJsonAsync();

        document.RootElement.GetProperty("started").GetBoolean().Should().BeFalse();
        document.RootElement.GetProperty("frozen").GetBoolean().Should().BeFalse();
        document.RootElement.GetProperty("scenarioTime").ValueKind.Should().Be(JsonValueKind.Null, "null when !started");
        ParseInstant(document, "serverTime").Should().Be(WallStart);
    }

    [Fact]
    public async Task Running_ReadsTheAdvancingScenarioTime_AndTheServerWallClockAtTheSameRead()
    {
        await using var host = await ClockHost.StartAsync();
        host.Scope = Guid.NewGuid();
        host.Clock.Start(host.Scope.Value, ScenarioStart, TimeZoneInfo.Utc);
        host.Time.Advance(TimeSpan.FromMinutes(12));

        using var document = await host.GetJsonAsync();

        document.RootElement.GetProperty("started").GetBoolean().Should().BeTrue();
        document.RootElement.GetProperty("frozen").GetBoolean().Should().BeFalse();
        ParseInstant(document, "scenarioTime").Should().Be(ScenarioStart.AddMinutes(12));
        ParseInstant(document, "serverTime").Should().Be(WallStart.AddMinutes(12));
    }

    [Fact]
    public async Task Frozen_ReadsFrozenTrue_AndTheHeldScenarioTime_WhileTheServerTimeMovesOn()
    {
        await using var host = await ClockHost.StartAsync();
        host.Scope = Guid.NewGuid();
        host.Clock.Start(host.Scope.Value, ScenarioStart, TimeZoneInfo.Utc);
        host.Time.Advance(TimeSpan.FromMinutes(30));
        host.Clock.Freeze(host.Scope.Value);
        host.Time.Advance(TimeSpan.FromMinutes(20));

        using var document = await host.GetJsonAsync();

        document.RootElement.GetProperty("started").GetBoolean().Should().BeTrue();
        document.RootElement.GetProperty("frozen").GetBoolean().Should().BeTrue();
        ParseInstant(document, "scenarioTime").Should().Be(ScenarioStart.AddMinutes(30), "a frozen clock holds");
        ParseInstant(document, "serverTime").Should().Be(WallStart.AddMinutes(50));
    }

    [Fact]
    public async Task AfterAJump_ReadsTheLeapedScenarioTime()
    {
        await using var host = await ClockHost.StartAsync();
        host.Scope = Guid.NewGuid();
        host.Clock.Start(host.Scope.Value, ScenarioStart, TimeZoneInfo.Utc);
        host.Clock.Jump(host.Scope.Value, 90);

        using var document = await host.GetJsonAsync();

        ParseInstant(document, "scenarioTime").Should().Be(ScenarioStart.AddMinutes(90));
    }

    [Fact]
    public async Task Isolation_EachExerciseReadsOnlyItsOwnClock_NeverAnothers()
    {
        // COR-001: exercise A is frozen at minute 30; exercise B is running at minute 75; exercise C never started.
        await using var host = await ClockHost.StartAsync();
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        host.Clock.Start(exerciseA, ScenarioStart, TimeZoneInfo.Utc);
        host.Clock.Start(exerciseB, ScenarioStart.AddHours(5), TimeZoneInfo.Utc);
        host.Time.Advance(TimeSpan.FromMinutes(30));
        host.Clock.Freeze(exerciseA);
        host.Time.Advance(TimeSpan.FromMinutes(45));

        host.Scope = exerciseA;
        using (var a = await host.GetJsonAsync())
        {
            a.RootElement.GetProperty("frozen").GetBoolean().Should().BeTrue();
            ParseInstant(a, "scenarioTime").Should().Be(ScenarioStart.AddMinutes(30), "A reads A's frozen minute");
        }

        host.Scope = exerciseB;
        using (var b = await host.GetJsonAsync())
        {
            b.RootElement.GetProperty("frozen").GetBoolean().Should().BeFalse("A's freeze never moves B (COR-001)");
            ParseInstant(b, "scenarioTime").Should().Be(ScenarioStart.AddHours(5).AddMinutes(75));
        }

        host.Scope = Guid.NewGuid();
        using var c = await host.GetJsonAsync();
        c.RootElement.GetProperty("started").GetBoolean().Should().BeFalse(
            "an exercise with no clock never reads another exercise's started clock");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AnUnresolvedScope_FailsClosedWith401_NeverADefaultNotStarted200(bool emptySentinel)
    {
        await using var host = await ClockHost.StartAsync();
        host.Clock.Start(Guid.NewGuid(), ScenarioStart, TimeZoneInfo.Utc);
        host.Scope = emptySentinel ? Guid.Empty : null;

        using var response = await host.Client.GetAsync(ClockUri);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "an unresolved scope is a closed door (COR-001)");
    }

    [Fact]
    public void ProgramCs_MapsGetClockExactlyOnce_AndComposesThePushBesideThePersistenceSink()
    {
        using var factory = new NeverConnectingHostFactory();
        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        dataSource.Endpoints.OfType<RouteEndpoint>().Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, "/api/clock", StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains("GET") ?? false))
            .Should().Be(1, "GET /api/clock must be mapped by Program.cs exactly once");

        factory.Services.GetRequiredService<IExerciseClockChangeSink>().Should().BeOfType<ExerciseClockWriteThrough>(
            "the push composes with story 18's write-through; it must never displace it");
        // Observers are additive (the idle background services also observe the clock, to wake on a start or unfreeze),
        // so pin the push itself: registered exactly once, not "the only observer".
        factory.Services.GetServices<IExerciseClockChangeObserver>().OfType<ScenarioClockChangedPublisher>().Should()
            .ContainSingle("the ScenarioClockChanged push observes the clock exactly once");
        factory.Services.GetRequiredService<IExerciseClock>().Should().BeOfType<ExerciseClockService>();
    }

    [Fact]
    public async Task ProgramCs_AnAnonymousCaller_IsRefusedByTheDefaultDenyGate()
    {
        using var factory = new NeverConnectingHostFactory();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(ClockUri);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "GET /api/clock requires a live session");
        response.Headers.WwwAuthenticate.Should().NotBeEmpty("the 401 is the GATE's, before any handler runs");
    }

    [Fact]
    public void TheParticipantLifecycleGate_CoversTheClockRoute_LikePersonas() =>
        ExerciseLifecycleGatedRoutes.IsGated(new PathString("/api/clock")).Should().BeTrue();

    private static DateTimeOffset ParseInstant(JsonDocument document, string property) =>
        DateTimeOffset.Parse(document.RootElement.GetProperty(property).GetString()!, CultureInfo.InvariantCulture);

    /// <summary>A self-mapped host serving only <c>GET /api/clock</c> over a hand-advanced clock and a settable scope.</summary>
    private sealed class ClockHost : IAsyncDisposable
    {
        private readonly WebApplication _app;

        private ClockHost(WebApplication app, ManualTimeProvider time, ExerciseClockService clock)
        {
            _app = app;
            Time = time;
            Clock = clock;
            Client = app.GetTestClient();
        }

        public ManualTimeProvider Time { get; }

        public ExerciseClockService Clock { get; }

        public HttpClient Client { get; }

        /// <summary>The exercise every request resolves to (null = unresolved).</summary>
        public Guid? Scope { get; set; }

        public static async Task<ClockHost> StartAsync()
        {
            var time = new ManualTimeProvider(WallStart);
            var clock = new ExerciseClockService(time);
            ClockHost? host = null;

            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseTestServer();
            builder.Services.AddSingleton<TimeProvider>(time);
            builder.Services.AddSingleton<IExerciseClock>(clock);
            builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = host!.Scope });

            var app = builder.Build();
            app.MapScenarioClockEndpoints();
            await app.StartAsync();

            host = new ClockHost(app, time, clock);
            return host;
        }

        public async Task<JsonDocument> GetJsonAsync()
        {
            using var response = await Client.GetAsync(ClockUri);
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.DisposeAsync();
        }
    }

    /// <summary>Boots the real <c>Program</c> host with a never-connecting connection string (it merely builds).</summary>
    private sealed class NeverConnectingHostFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        public NeverConnectingHostFactory()
        {
            Environment.SetEnvironmentVariable(
                ConnectionStringEnvVar, "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;");
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}

/// <summary>
/// <c>GET /api/clock</c> through the REAL <c>Program</c> pipeline with a live (faked) participant session — the
/// default-deny gate, exercise resolution and the participant lifecycle gate all run — against real SQL.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ScenarioClockHostTests
{
    private static readonly Uri ClockUri = new("/api/clock", UriKind.Relative);
    private readonly MsSqlContainerFixture _fixture;

    public ScenarioClockHostTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task AParticipantSession_ReadsItsOwnExercisesFrozenClock()
    {
        var exerciseId = Guid.NewGuid();
        await using var factory = new SocialApiWebApplicationFactory(_fixture.ConnectionString!, exerciseId);
        using var client = factory.CreateClient();
        var clock = factory.Services.GetRequiredService<IExerciseClock>();
        var start = new DateTimeOffset(2033, 6, 14, 8, 0, 0, TimeSpan.Zero);
        clock.Start(exerciseId, start, TimeZoneInfo.Utc);
        clock.Jump(exerciseId, 15);
        clock.Freeze(exerciseId);

        using var response = await client.GetAsync(ClockUri);

        response.StatusCode.Should().Be(HttpStatusCode.OK, "any live session bound to the exercise may read its clock");
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        document.RootElement.GetProperty("started").GetBoolean().Should().BeTrue();
        document.RootElement.GetProperty("frozen").GetBoolean().Should().BeTrue();
        DateTimeOffset.Parse(document.RootElement.GetProperty("scenarioTime").GetString()!, CultureInfo.InvariantCulture)
            .Should().BeCloseTo(start.AddMinutes(15), TimeSpan.FromSeconds(5));
    }

    [RequiresDockerFact]
    public async Task AnotherExercisesStartedClock_IsNeverReadThroughThisExercisesSession()
    {
        var mine = Guid.NewGuid();
        var other = Guid.NewGuid();
        await using var factory = new SocialApiWebApplicationFactory(_fixture.ConnectionString!, mine);
        using var client = factory.CreateClient();
        factory.Services.GetRequiredService<IExerciseClock>().Start(other, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);

        using var response = await client.GetAsync(ClockUri);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        document.RootElement.GetProperty("started").GetBoolean().Should().BeFalse(
            "the read is scoped to the session's exercise; another exercise's started clock never leaks (COR-001)");
        document.RootElement.GetProperty("scenarioTime").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [RequiresDockerFact]
    public async Task NoSession_FailsClosedWith401()
    {
        await using var factory = new SocialApiWebApplicationFactory(_fixture.ConnectionString!, exerciseId: null);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(ClockUri);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
