namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

/// <summary>
/// fix/noise-new-posts-clock §3: ONE clock, the server's. <see cref="PostIngestService"/> stamps
/// <c>CreatedScenarioTime</c>, the telemetry event's <c>ScenarioTime</c> and the broadcast/response from
/// <see cref="IExerciseClock.CurrentScenarioTime"/> whenever the exercise's clock is started (running or frozen), for
/// every origin — except a staff <c>controller-as-persona</c> write carrying <c>backdate: true</c>, which keeps the
/// client value. A clock that is not started keeps the client value for everyone.
/// </summary>
/// <remarks>
/// The stamping rule is provider-agnostic, so these are Docker-free <see cref="FactAttribute"/>s over the EF in-memory
/// provider (the same pattern <c>RequestAbortAndRefreezeTests</c> uses); <see cref="PostIngestServerClockSqlTests"/>
/// repeats the headline case against real SQL.
/// </remarks>
public sealed class PostIngestServerClockTests
{
    /// <summary>The scenario instant the clock reads as minute 0.</summary>
    internal static readonly DateTimeOffset ScenarioStart = new(2033, 6, 14, 8, 0, 0, TimeSpan.Zero);

    /// <summary>The server wall clock at the clock's start (deliberately far from scenario time).</summary>
    internal static readonly DateTimeOffset WallStart = new(2026, 10, 21, 14, 0, 0, TimeSpan.Zero);

    /// <summary>
    /// The CLIENT's value: its own wall clock, which is what the frontend's <c>scenarioNow()</c> sent before this fix.
    /// </summary>
    internal const string ClientScenarioTime = "2026-10-21T15:30:00.000Z";

    [Fact]
    public async Task AfterAFreeze_ParticipantControllerAndNoisePosts_AtTheSameMoment_AllCarryTheServerClocksTime()
    {
        var world = World.Create();
        world.Clock.Start(world.ExerciseId, ScenarioStart, TimeZoneInfo.Utc);
        world.Time.Advance(TimeSpan.FromMinutes(30));
        world.Clock.Freeze(world.ExerciseId);
        world.Time.Advance(TimeSpan.FromMinutes(20)); // the wall clock moves on; the frozen scenario clock does not
        var expected = ScenarioStart.AddMinutes(30);

        var posts = await world.IngestAllOriginsAsync(backdate: null);

        world.AssertAllStampedWith(posts, expected, "a frozen clock holds scenario time, and every origin reads it");
    }

    [Fact]
    public async Task AfterAJump_ParticipantControllerAndNoisePosts_AtTheSameMoment_AllCarryTheServerClocksTime()
    {
        var world = World.Create();
        world.Clock.Start(world.ExerciseId, ScenarioStart, TimeZoneInfo.Utc);
        world.Time.Advance(TimeSpan.FromMinutes(10));
        world.Clock.Freeze(world.ExerciseId);
        world.Clock.Jump(world.ExerciseId, 45);
        var expected = ScenarioStart.AddMinutes(55);

        var posts = await world.IngestAllOriginsAsync(backdate: null);

        world.AssertAllStampedWith(posts, expected, "a jump moves the one clock every origin reads");
    }

    [Fact]
    public async Task WhileRunning_AfterUnfreeze_EveryOriginCarriesTheServerClocksTime()
    {
        var world = World.Create();
        world.Clock.Start(world.ExerciseId, ScenarioStart, TimeZoneInfo.Utc);
        world.Time.Advance(TimeSpan.FromMinutes(5));
        world.Clock.Freeze(world.ExerciseId);
        world.Time.Advance(TimeSpan.FromMinutes(40));
        world.Clock.Unfreeze(world.ExerciseId);
        world.Time.Advance(TimeSpan.FromMinutes(2));
        var expected = ScenarioStart.AddMinutes(7);

        var posts = await world.IngestAllOriginsAsync(backdate: null);

        world.AssertAllStampedWith(posts, expected, "a running clock is the server's minute, not the client's wall clock");
    }

    [Fact]
    public async Task Backdate_IsHonouredForControllerAsPersona_AndIgnoredForParticipantAndNoise()
    {
        var world = World.Create();
        world.Clock.Start(world.ExerciseId, ScenarioStart, TimeZoneInfo.Utc);
        world.Time.Advance(TimeSpan.FromMinutes(30));
        world.Clock.Freeze(world.ExerciseId);
        var clockTime = ScenarioStart.AddMinutes(30);

        var posts = await world.IngestAllOriginsAsync(backdate: true);

        posts["controller-as-persona"].CreatedScenarioTime.Should().Be(
            DateTimeOffset.Parse(ClientScenarioTime, System.Globalization.CultureInfo.InvariantCulture),
            "a staff controller-as-persona write with backdate: true keeps its client value (the seed's opening feed)");
        posts["participant"].CreatedScenarioTime.Should().Be(
            clockTime, "backdate is never honoured for a participant: the origin is server-derived, never claimable");
        posts["noise"].CreatedScenarioTime.Should().Be(clockTime, "backdate is honoured for controller-as-persona only");

        var events = await world.TelemetryByPostAsync();
        events[posts["controller-as-persona"].Id].Should().Be(posts["controller-as-persona"].CreatedScenarioTime);
        events[posts["participant"].Id].Should().Be(clockTime, "the telemetry event agrees with the post");
    }

    [Fact]
    public async Task Backdate_IntoTheFuture_IsClampedToTheServerClock()
    {
        // Review W-003: backdate keeps an EARLIER client instant only. A controller-as-persona value later than the
        // started clock would sit above posts the clock has not reached yet, so it is clamped to the clock.
        var world = World.Create();
        var clockStart = DateTimeOffset.Parse(ClientScenarioTime, System.Globalization.CultureInfo.InvariantCulture)
            .AddHours(-2);
        world.Clock.Start(world.ExerciseId, clockStart, TimeZoneInfo.Utc);
        world.Time.Advance(TimeSpan.FromMinutes(15));
        world.Clock.Freeze(world.ExerciseId);

        var post = await world.IngestAsync("controller-as-persona", backdate: true);

        post.CreatedScenarioTime.Should().Be(
            clockStart.AddMinutes(15), "a backdate later than the server clock is clamped to it, never future-dated");
        (await world.TelemetryByPostAsync())[post.Id].Should().Be(clockStart.AddMinutes(15));
        DateTimeOffset.Parse(world.Broadcaster.Calls.Single().Post.ScenarioTime, System.Globalization.CultureInfo.InvariantCulture)
            .Should().Be(clockStart.AddMinutes(15));
    }

    [Fact]
    public async Task Backdate_EqualToTheServerClock_IsKept()
    {
        var world = World.Create();
        var client = DateTimeOffset.Parse(ClientScenarioTime, System.Globalization.CultureInfo.InvariantCulture);
        world.Clock.Start(world.ExerciseId, client, TimeZoneInfo.Utc);
        world.Clock.Freeze(world.ExerciseId);

        var post = await world.IngestAsync("controller-as-persona", backdate: true);

        post.CreatedScenarioTime.Should().Be(client, "an instant that is not in the future is honoured");
    }

    [Fact]
    public async Task BackdateFalse_OnControllerAsPersona_StillTakesTheServerClock()
    {
        var world = World.Create();
        world.Clock.Start(world.ExerciseId, ScenarioStart, TimeZoneInfo.Utc);
        world.Clock.Freeze(world.ExerciseId);

        var post = await world.IngestAsync("controller-as-persona", backdate: false);

        post.CreatedScenarioTime.Should().Be(ScenarioStart, "only an explicit backdate: true keeps the client value");
    }

    [Fact]
    public async Task AClockThatIsNotStarted_FallsBackToTheClientValue_ForEveryOrigin()
    {
        var world = World.Create();
        var client = DateTimeOffset.Parse(ClientScenarioTime, System.Globalization.CultureInfo.InvariantCulture);

        var posts = await world.IngestAllOriginsAsync(backdate: null);

        world.AssertAllStampedWith(posts, client, "with no started clock the client value stands, as before the fix");
    }

    [Fact]
    public async Task AnotherExercisesClock_NeverStampsThisExercisesPost()
    {
        // COR-001: the clock is read by the SERVER-resolved scope; a started clock elsewhere is not this exercise's.
        var world = World.Create();
        world.Clock.Start(Guid.NewGuid(), ScenarioStart, TimeZoneInfo.Utc);

        var post = await world.IngestAsync("participant", backdate: null);

        post.CreatedScenarioTime.Should().Be(
            DateTimeOffset.Parse(ClientScenarioTime, System.Globalization.CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task TheScenarioTimeIsStillRequiredAndValidated_EvenWithAStartedClock()
    {
        var world = World.Create();
        world.Clock.Start(world.ExerciseId, ScenarioStart, TimeZoneInfo.Utc);

        var result = await world.Service.IngestAsync(
            new CreatePostRequest { Text = "hello", ScenarioTime = "not-a-time", TimeZone = "UTC" },
            World.Attribution("participant"));

        result.Outcome.Should().Be(PostIngestOutcome.Invalid, "scenarioTime stays required and validated (compatibility)");
    }

    /// <summary>One exercise, an in-memory database, a hand-advanced clock and the ingest funnel over them.</summary>
    internal sealed class World
    {
        private World(Guid exerciseId, ManualTimeProvider time, ExerciseClockService clock, PulseDbContext db, FakeFeedBroadcaster broadcaster)
        {
            ExerciseId = exerciseId;
            Time = time;
            Clock = clock;
            Db = db;
            Broadcaster = broadcaster;
            Service = new PostIngestService(
                db, new ExerciseContext { CurrentExerciseId = exerciseId }, broadcaster, exerciseClock: clock);
        }

        public Guid ExerciseId { get; }

        public ManualTimeProvider Time { get; }

        public ExerciseClockService Clock { get; }

        public PulseDbContext Db { get; }

        public FakeFeedBroadcaster Broadcaster { get; }

        public PostIngestService Service { get; }

        public static World Create()
        {
            var exerciseId = Guid.NewGuid();
            var time = new ManualTimeProvider(WallStart);
            var db = new PulseDbContext(
                new DbContextOptionsBuilder<PulseDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options,
                new ExerciseContext { CurrentExerciseId = exerciseId });
            return new World(exerciseId, time, new ExerciseClockService(time), db, new FakeFeedBroadcaster());
        }

        public static PostAttribution Attribution(string origin) => new()
        {
            AuthorPersonaId = Guid.NewGuid(),
            Origin = origin,
            ActingHumanId = origin == "noise" ? string.Empty : $"human-{origin}",
        };

        public async Task<Pulse.WebApi.Data.Entities.Post> IngestAsync(string origin, bool? backdate)
        {
            var result = await Service.IngestAsync(
                new CreatePostRequest
                {
                    Text = $"a {origin} post",
                    ScenarioTime = ClientScenarioTime,
                    TimeZone = "UTC",
                    Backdate = backdate,
                },
                Attribution(origin));
            result.Outcome.Should().Be(PostIngestOutcome.Created);
            return result.Post!;
        }

        /// <summary>A participant, a controller-as-persona and a noise post, at the same (unadvanced) moment.</summary>
        public async Task<Dictionary<string, Pulse.WebApi.Data.Entities.Post>> IngestAllOriginsAsync(bool? backdate)
        {
            var posts = new Dictionary<string, Pulse.WebApi.Data.Entities.Post>(StringComparer.Ordinal);
            foreach (var origin in new[] { "participant", "controller-as-persona", "noise" })
            {
                posts[origin] = await IngestAsync(origin, backdate);
            }

            return posts;
        }

        public async Task<Dictionary<Guid, DateTimeOffset>> TelemetryByPostAsync() =>
            (await Db.TelemetryEvents.AsNoTracking().ToListAsync())
                .ToDictionary(e => Guid.Parse(e.Target!.EntityId!), e => e.ScenarioTime);

        public void AssertAllStampedWith(
            IReadOnlyDictionary<string, Pulse.WebApi.Data.Entities.Post> posts, DateTimeOffset expected, string because)
        {
            foreach (var (origin, post) in posts)
            {
                post.CreatedScenarioTime.Should().Be(expected, "{0} ({1})", because, origin);
            }

            var events = TelemetryByPostAsync().GetAwaiter().GetResult();
            foreach (var post in posts.Values)
            {
                events[post.Id].Should().Be(expected, "the telemetry event's scenarioTime is the post's (one source)");
            }

            Broadcaster.Calls.Should().HaveCount(posts.Count);
            foreach (var (_, view) in Broadcaster.Calls)
            {
                DateTimeOffset.Parse(view.ScenarioTime, System.Globalization.CultureInfo.InvariantCulture)
                    .Should().Be(expected, "the broadcast (and the 201 response built from it) carries the same time");
            }
        }
    }
}

/// <summary>
/// The headline §3 case of <see cref="PostIngestServerClockTests"/> against REAL SQL: after a Freeze, participant,
/// controller-as-persona and noise posts made at the same moment persist (and emit) the server clock's scenario time.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PostIngestServerClockSqlTests
{
    private readonly MsSqlContainerFixture _fixture;

    public PostIngestServerClockSqlTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task AfterAFreeze_EveryOrigin_PersistsTheServerClocksTime_AndBackdateIsStaffOnly()
    {
        var exerciseId = Guid.NewGuid();
        var time = new ManualTimeProvider(PostIngestServerClockTests.WallStart);
        var clock = new ExerciseClockService(time);
        clock.Start(exerciseId, PostIngestServerClockTests.ScenarioStart, TimeZoneInfo.Utc);
        time.Advance(TimeSpan.FromMinutes(30));
        clock.Freeze(exerciseId);
        time.Advance(TimeSpan.FromMinutes(20));
        var expected = PostIngestServerClockTests.ScenarioStart.AddMinutes(30);

        var ids = new Dictionary<string, Guid>(StringComparer.Ordinal);
        foreach (var (origin, backdate) in new[] { ("participant", true), ("controller-as-persona", false), ("noise", true), ("backdated", true) })
        {
            var scope = new ExerciseContext { CurrentExerciseId = exerciseId };
            await using var context = _fixture.CreateContext(scope);
            var service = new PostIngestService(context, scope, new FakeFeedBroadcaster(), exerciseClock: clock);
            var stated = origin == "backdated" ? "controller-as-persona" : origin;
            var result = await service.IngestAsync(
                new CreatePostRequest
                {
                    Text = $"a {origin} post",
                    ScenarioTime = PostIngestServerClockTests.ClientScenarioTime,
                    TimeZone = "UTC",
                    Backdate = backdate,
                },
                PostIngestServerClockTests.World.Attribution(stated));
            result.Outcome.Should().Be(PostIngestOutcome.Created);
            ids[origin] = result.Post!.Id;
        }

        await using var read = _fixture.CreateContext();
        var stored = await read.Posts.IgnoreQueryFilters().Where(p => p.ExerciseId == exerciseId)
            .ToDictionaryAsync(p => p.Id, p => p.CreatedScenarioTime);
        stored[ids["participant"]].Should().Be(expected, "a participant's backdate is ignored");
        stored[ids["controller-as-persona"]].Should().Be(expected);
        stored[ids["noise"]].Should().Be(expected);
        stored[ids["backdated"]].Should().Be(
            DateTimeOffset.Parse(PostIngestServerClockTests.ClientScenarioTime, System.Globalization.CultureInfo.InvariantCulture),
            "a staff controller-as-persona backdate keeps the client value");

        var events = await read.TelemetryEvents.IgnoreQueryFilters().AsNoTracking()
            .Where(e => e.ExerciseId == exerciseId).ToListAsync();
        events.Should().HaveCount(4);
        events.Single(e => e.Target!.EntityId == ids["noise"].ToString()).ScenarioTime.Should().Be(expected);
    }
}
