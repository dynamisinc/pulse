namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// Story 01 AC "Publish reuses B1 (SOC-003)" + "Isolation — the BackgroundService scope resolution
/// (COR-001, Tier-2)": the single <see cref="IEnginePublishService"/> funnel routes each post through B1's
/// <see cref="PostIngestService"/> with <c>origin:'engine'</c>, establishing its OWN per-exercise scope for
/// the non-request-bound loop — a burst for exercise A only ever writes into exercise A, and a burst with an
/// unresolved scope fails closed and writes nothing. Extends the standing cross-exercise isolation suite
/// against a REAL SQL Server (Testcontainers); every test is <see cref="RequiresDockerFactAttribute"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class EnginePublishServiceTests
{
    private readonly MsSqlContainerFixture _fixture;

    public EnginePublishServiceTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    private static IExerciseContext ScopeFor(Guid exerciseId) =>
        new ExerciseContext { CurrentExerciseId = exerciseId };

    private ServiceProvider BuildHost()
    {
        var services = new ServiceCollection();
        services.AddSingleton(TimeProvider.System);
        services.AddScoped<IExerciseContext, ExerciseContext>();
        services.AddDbContext<PulseDbContext>(options => options.UseSqlServer(_fixture.ConnectionString));
        services.AddScoped<PostIngestService>();
        services.AddSingleton<IFeedBroadcaster, RecordingFeedBroadcaster>();
        services.AddSingleton<IEngineTelemetryEmitter, EngineTelemetryEmitter>();
        services.AddSingleton<IEnginePublishService, EnginePublishService>();
        return services.BuildServiceProvider();
    }

    private static EngineBurst BurstFor(Guid exerciseId, Guid personaId, string text) => new()
    {
        ExerciseId = exerciseId,
        StorylineId = Guid.NewGuid(),
        DraftId = Guid.NewGuid(),
        TimeZone = "America/Chicago",
        Posts = new List<EngineBurstPost>
        {
            new()
            {
                PersonaId = personaId,
                PersonaHandle = "@mvega_fh",
                Text = text,
                Sentiment = -0.4,
                Hashtags = new List<string> { "#WaterIssues" },
                ScenarioTime = new DateTimeOffset(2033, 6, 1, 9, 0, 0, TimeSpan.Zero).ToString("O"),
            },
        },
    };

    [RequiresDockerFact]
    public async Task PublishBurst_IngestsThroughB1_WithEngineOrigin_ScopedToTheBurstExercise()
    {
        var exerciseId = Guid.NewGuid();
        var personaId = Guid.NewGuid();

        await using var host = BuildHost();
        var publisher = host.GetRequiredService<IEnginePublishService>();

        var result = await publisher.PublishBurstAsync(BurstFor(exerciseId, personaId, "east side water pressure is dropping fast"));

        var published = result.Posts.Should().ContainSingle().Subject;
        published.Outcome.Should().Be(EnginePublishOutcome.Published);
        published.PostId.Should().NotBeNull();

        // The post landed in the burst's exercise, authored as an ordinary post with origin 'engine' (SOC-003).
        await using var readContext = _fixture.CreateContext(ScopeFor(exerciseId));
        var post = await readContext.Posts.SingleAsync(p => p.Id == published.PostId!.Value);
        post.ExerciseId.Should().Be(exerciseId, "the funnel stamps the burst's server-authoritative scope (COR-001)");
        post.Origin.Should().Be("engine");
        post.AuthorPersonaId.Should().Be(personaId);

        // Exactly one engine.published telemetry event for the post, in scope.
        var published_events = await readContext.TelemetryEvents
            .Where(e => e.EventType == EngineEventTypes.Published && e.Target!.EntityId == published.PostId!.Value.ToString())
            .ToListAsync();
        published_events.Should().ContainSingle().Which.Origin.Should().Be("engine");
    }

    [RequiresDockerFact]
    public async Task PublishBurst_ForExerciseA_IsNeverVisibleInExerciseB()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var personaId = Guid.NewGuid();

        await using var host = BuildHost();
        var publisher = host.GetRequiredService<IEnginePublishService>();

        var result = await publisher.PublishBurstAsync(BurstFor(exerciseA, personaId, "boil-water notice rumors are spreading downtown"));
        var postId = result.Posts.Single().PostId!.Value;

        // A read scoped to exercise B sees nothing — the cross-exercise door is closed (fail closed).
        await using var readB = _fixture.CreateContext(ScopeFor(exerciseB));
        (await readB.Posts.CountAsync(p => p.Id == postId)).Should().Be(
            0, "a burst published for exercise A must never be visible in exercise B (COR-001)");

        // Prove the row exists (in A), so the zero above is the filter closing the door, not a missing write.
        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == postId)).ExerciseId
            .Should().Be(exerciseA);
    }

    [RequiresDockerFact]
    public async Task PublishBurst_WithUnresolvedScope_FailsClosed_AndWritesNothing()
    {
        var personaId = Guid.NewGuid();
        const string text = "this draft must never be written under an empty scope";

        await using var host = BuildHost();
        var publisher = host.GetRequiredService<IEnginePublishService>();

        // A burst carrying an empty exercise scope collapses to the fail-closed door in PostIngestService.
        var result = await publisher.PublishBurstAsync(BurstFor(Guid.Empty, personaId, text));

        result.Posts.Should().ContainSingle().Which.Outcome.Should().Be(EnginePublishOutcome.ScopeUnresolved);

        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.Posts.IgnoreQueryFilters().CountAsync(p => p.AuthorPersonaId == personaId)).Should().Be(
            0, "an unresolved-scope burst must write no post (fail closed, COR-001)");
    }
}
