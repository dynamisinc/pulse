namespace Pulse.WebApi.Tests.Features.EngineRuntime.Ambient;

using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.Core.Core.Extensions;
using Pulse.Core.Features.Ambient.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.Generation.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// ambient-chatter story 01, AC9 against REAL SQL Server with the REAL publish funnel (<see cref="EnginePublishService"/>
/// → <see cref="PostIngestService"/>): an autonomous ambient post lands as an ordinary post with
/// <c>Origin = "engine"</c> and a scenario-time stamp, its <c>engine.published</c> event carries
/// <c>trigger: ambient-floor</c> + <c>publishPath: ambient-autonomous</c> and the authorising controller, it is
/// confined to its own exercise, and the participant post shape carries no provenance at all.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class AmbientRealPublishTests
{
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 1, 9, 0, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;

    public AmbientRealPublishTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task AnAutonomousAmbientPost_LandsAsAnOrdinaryEnginePost_InScenarioTime_InItsOwnExerciseOnly()
    {
        var exerciseId = Guid.NewGuid();
        var otherExercise = Guid.NewGuid();
        var time = new ManualTimeProvider(ScenarioStart);

        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(new Exercise
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = exerciseId,
                Name = "Ambient real publish",
                TimeZone = "UTC",
                Status = "live",
            });
            await seed.SaveChangesAsync();
        }

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<TimeProvider>(time);
        services.AddScoped<IExerciseContext, ExerciseContext>();
        services.AddDbContext<PulseDbContext>(o => o.UseSqlServer(_fixture.ConnectionString));
        services.AddScoped<PostIngestService>();
        services.AddSingleton<IFeedBroadcaster, RecordingFeedBroadcaster>();
        services.AddSingleton<IEngineReviewBroadcaster>(new RecordingReviewBroadcaster());
        services.AddSingleton(new EngineAutonomyRegistry());
        services.AddSingleton(new EngineAmbientPolicyRegistry(
            Options.Create(new EngineAmbientGovernanceOptions { AmbientAutonomyAuthorized = true })));
        services.AddEngineGeneration(new ConfigurationBuilder().Build()); // Fake: no egress
        services.AddExerciseScoping();
        services.AddExerciseClock();
        services.AddEngineRuntimeSeams();
        services.AddReactionLoopHost();
        services.AddSingleton(sp => new PauseTierRegistry(
            sp.GetRequiredService<IExerciseClock>(), new NullPauseOverlayPublisher(), NullLogger<PauseTierRegistry>.Instance));
        await using var host = services.BuildServiceProvider();

        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        time.Advance(TimeSpan.FromMinutes(3));

        var cast = new[] { "@rosa", "@marcus", "@lena" }.ToDictionary(
            handle => handle,
            handle => new EnginePersona(
                Guid.NewGuid(),
                new PersonaDossier { Handle = handle, DisplayName = handle.TrimStart('@'), Type = PersonaType.Resident }),
            StringComparer.OrdinalIgnoreCase);
        var registration = new ReactionLoopRegistration
        {
            ExerciseId = exerciseId,
            ExerciseBrief = "The fictional town of Cedar Falls on an ordinary weekday.",
            TimeZone = "UTC",
            ScenarioStart = ScenarioStart,
            TimeZoneInfo = TimeZoneInfo.Utc,
            Storylines = [],
            PersonasByHandle = cast,
            Autonomy = host.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId),
            ControllerDeskId = Guid.NewGuid(),
        };
        host.GetRequiredService<EngineAmbientPolicyRegistry>().Set(exerciseId, new AmbientTierPolicy
        {
            Mode = AmbientPolicyMode.Autonomous,
            MaxPerMinute = 10,
            MaxPerHour = 100,
            TopicAllowList = [AmbientTopics.Food],
            PersonaAllowList = cast.Values.Select(p => p.InstanceId).ToList(),
            SetBy = "controller-7",
        });

        ReactionTickResult result;
        await using (var scope = host.CreateAsyncScope())
        {
            ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = exerciseId;
            result = await host.GetRequiredService<ReactionLoopDriver>().RunTickAsync(registration, scope.ServiceProvider);
        }

        result.AmbientPostsPublished.Should().BeGreaterThan(0, "the Fake burst is clean, so it publishes autonomously");

        await using var read = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        var posts = await read.Posts.ToListAsync();
        posts.Should().HaveCount(result.AmbientPostsPublished);
        posts.Should().OnlyContain(p => p.Origin == "engine", "engine-sourced everywhere (AC9)");
        posts.Should().OnlyContain(
            p => p.CreatedScenarioTime == ScenarioStart.AddMinutes(3), "scenario time, never the server wall clock (COR-053)");

        var published = await read.TelemetryEvents.Where(e => e.EventType == EngineEventTypes.Published).ToListAsync();
        published.Should().HaveCount(posts.Count);
        foreach (var evt in published)
        {
            using var payload = JsonDocument.Parse(evt.Payload!);
            payload.RootElement.GetProperty("trigger").GetString().Should().Be("ambient-floor");
            payload.RootElement.GetProperty("publishPath").GetString().Should().Be("ambient-autonomous");
            payload.RootElement.GetProperty("origin").GetString().Should().Be("engine");
            evt.Actor.ActingHumanId.Should().Be("controller-7", "the controller who set the policy is on the record");
        }

        await using var other = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = otherExercise });
        (await other.Posts.CountAsync()).Should().Be(0, "another exercise sees none of it (COR-001)");

        typeof(ParticipantPostDto).GetProperty("Origin").Should().BeNull(
            "the participant shape structurally omits provenance; ambient posts reach participants only as ordinary posts (XC-002)");
    }
}
