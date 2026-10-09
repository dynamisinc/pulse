namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Core.Extensions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// Wave 3 Gate-2 M-1 end to end, through the REAL publish funnel (<see cref="EnginePublishService"/> → B1's
/// <see cref="PostIngestService"/>) against a REAL SQL Server: an over-long generated post is fitted to the ingest
/// ceiling when the loop enqueues it and then publishes exactly once; a swamped auto-send that only partly reaches
/// the feed is held, and later ticks publish nothing; and approving again after a partial publish never posts the
/// same text twice. Post rows are counted in the database, not inferred from a mock. Every test is
/// <see cref="RequiresDockerFactAttribute"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class EngineDraftCeilingIntegrationTests
{
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 1, 9, 0, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;

    public EngineDraftCeilingIntegrationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task AFourThousandCharacterOnePostBurst_IsFittedWhenEnqueued_AndPublishesOnce()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        var generated = string.Join(' ', Enumerable.Range(0, 440).Select(i => $"elm{i:00000}")); // 3,959 characters
        await SeedPersonaAsync(exerciseId, "@rosa");

        await using var host = BuildHost(manualTime, new LongPostProvider(generated));
        host.GetRequiredService<IExerciseClock>().Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        manualTime.Advance(TimeSpan.FromMinutes(25)); // the 20-minute silence window blows

        var cast = Cast("@rosa");
        var storyline = SeededStoryline(exerciseId, cast.Keys.ToList());
        var tick = await RunOneTickAsync(host, Registration(exerciseId, storyline, cast));
        tick.ReviewItemsEnqueued.Should().Be(1, "precondition: the over-long burst passed the generate gate and was enqueued");

        EngineReviewItemEntity item;
        await using (var read = _fixture.CreateContext(ScopeFor(exerciseId)))
        {
            item = await read.EngineReviewItems.AsNoTracking().SingleAsync();
        }

        var draft = item.Posts.Should().ContainSingle("a one-persona cast yields a one-post burst").Subject.Text;
        generated.Length.Should().BeGreaterThan(PostIngestService.TextLengthCeiling, "precondition: the model overran the ceiling");
        draft.Length.Should().BeLessThanOrEqualTo(PostIngestService.TextLengthCeiling, "the draft is fitted when it is enqueued");
        draft.Should().EndWith(EngineDraftText.Ellipsis);
        generated.Should().StartWith(draft[..^1], "the fitted draft is the start of what the model wrote");

        (await ApproveAsync(host, exerciseId, item.DraftId)).Outcome.Should().Be(
            EngineReviewOutcome.Ok, "the fitted draft is accepted by ingest — the old draft was refused as too long, every time");
        (await ApproveAsync(host, exerciseId, item.DraftId)).Outcome.Should().Be(
            EngineReviewOutcome.AlreadyResolved, "a second approve is rejected (WR-001)");

        await using var verify = _fixture.CreateContext();
        var post = await verify.Posts.IgnoreQueryFilters().Where(p => p.ExerciseId == exerciseId).ToListAsync();
        post.Should().ContainSingle("the burst published exactly once").Which.Body.Should().Be(draft, "the stored post is the reviewed draft");
    }

    [RequiresDockerFact]
    public async Task ASwampedAutoSend_WithOneInvalidPost_PublishesTheValidPostsOnce_GoesHeld_AndLaterTicksPublishNothing()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        await SeedPersonaAsync(exerciseId, "@rosa");
        await SeedPersonaAsync(exerciseId, "@lena");

        // @ghost has no persona in this exercise, so ingest refuses that post (Invalid); the other two are valid.
        var item = Item(draftId, exerciseId, AutonomyLevel.DelayedAuto, DraftDisposition.CountingDown, "@rosa", "@ghost", "@lena");
        await SeedItemAsync(item);

        await using var host = BuildHost(manualTime);
        host.GetRequiredService<IExerciseClock>().Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        var state = host.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId);
        state.SetStorylineOverride(item.StorylineId, AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.SetSwampedMode(enabled: true, "lead-1", 0);
        manualTime.Advance(TimeSpan.FromMinutes(4)); // past the 3-minute countdown

        await TickAutoHoldAsync(host, exerciseId);

        (await CountPostsAsync(exerciseId)).Should().Be(2, "the two valid posts reached the feed");
        var held = await ReloadAsync(draftId);
        held.Disposition.Should().Be(DraftDisposition.Held, "a partly published auto-send waits for a human");
        held.Posts.Select(p => p.PersonaHandle).Should().Equal(new[] { "@ghost" }, "only the post that did not go out is left");
        held.ActionLabel.Should().Contain("publish incomplete: auto-send posted 2 of 3; 1 held for review");

        // Before the fix the item stayed counting down, so each tick re-sent @rosa's and @lena's posts.
        for (var later = 0; later < 3; later++)
        {
            manualTime.Advance(TimeSpan.FromMinutes(1));
            await TickAutoHoldAsync(host, exerciseId);
        }

        (await CountPostsAsync(exerciseId)).Should().Be(2, "later ticks publish nothing — no duplicate posts");
        (await CountReviewedAsync(exerciseId, draftId)).Should().Be(1, "one decision (hold-on-expiry), not one per tick");
        (await ReloadAsync(draftId)).Disposition.Should().Be(DraftDisposition.Held);
    }

    [RequiresDockerFact]
    public async Task ApprovingAgainAfterAPartialPublish_PostsOnlyTheRest_NeverADuplicate()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        await SeedPersonaAsync(exerciseId, "@rosa");
        await SeedPersonaAsync(exerciseId, "@lena");
        await SeedItemAsync(Item(draftId, exerciseId, AutonomyLevel.Suggest, DraftDisposition.Queued, "@rosa", "@ghost", "@lena"));

        await using var host = BuildHost(manualTime);
        host.GetRequiredService<IExerciseClock>().Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

        var first = await ApproveAsync(host, exerciseId, draftId);

        first.Outcome.Should().Be(EngineReviewOutcome.PublishFailed, "WR-002: a partial publish is never Published");
        (await CountPostsAsync(exerciseId)).Should().Be(2);
        (await ReloadAsync(draftId)).Posts.Select(p => p.PersonaHandle).Should().Equal(new[] { "@ghost" });

        // The controller fixes the cause (the missing persona) and approves again.
        await SeedPersonaAsync(exerciseId, "@ghost");
        var second = await ApproveAsync(host, exerciseId, draftId);

        second.Outcome.Should().Be(EngineReviewOutcome.Ok);
        (await CountPostsAsync(exerciseId)).Should().Be(3, "only @ghost's post is added; @rosa's and @lena's are not posted twice");
        await using var verify = _fixture.CreateContext();
        var bodies = await verify.Posts.IgnoreQueryFilters().Where(p => p.ExerciseId == exerciseId).Select(p => p.Body).ToListAsync();
        bodies.Should().OnlyHaveUniqueItems().And.HaveCount(3);
        (await ReloadAsync(draftId)).Disposition.Should().Be(DraftDisposition.Published);
    }

    // ---- host + helpers -------------------------------------------------------------------------

    private static IExerciseContext ScopeFor(Guid exerciseId) => new ExerciseContext { CurrentExerciseId = exerciseId };

    /// <summary>The loop slice plus the review cockpit and the REAL publish funnel, as in <c>EngineContentSeedServiceTests</c>.</summary>
    private ServiceProvider BuildHost(TimeProvider timeProvider, IGenerationProvider? provider = null)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSignalR(); // the review broadcaster resolves IHubContext<ExerciseRealtimeHub>
        services.AddSingleton(timeProvider);
        services.AddScoped<IExerciseContext, ExerciseContext>();
        services.AddDbContext<PulseDbContext>(o => o.UseSqlServer(_fixture.ConnectionString));
        services.AddScoped<PostIngestService>();
        services.AddSingleton<IFeedBroadcaster, RecordingFeedBroadcaster>();
        services.AddEngineGeneration(new ConfigurationBuilder().Build()); // Fake by default
        if (provider is not null)
        {
            services.AddSingleton<IGenerationProvider>(provider); // the last registration wins
        }

        services.AddExerciseScoping();
        services.AddExerciseClock();
        services.AddEngineRuntimeSeams();
        services.AddReactionLoopHost();
        services.AddEngineReview();
        return services.BuildServiceProvider();
    }

    private static async Task<ReactionTickResult> RunOneTickAsync(ServiceProvider host, ReactionLoopRegistration registration)
    {
        var driver = host.GetRequiredService<ReactionLoopDriver>();
        using var scope = host.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = registration.ExerciseId;
        return await driver.RunTickAsync(registration, scope.ServiceProvider);
    }

    private static async Task<EngineReviewActionResult> ApproveAsync(ServiceProvider host, Guid exerciseId, Guid draftId)
    {
        await using var scope = host.CreateAsyncScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = exerciseId;
        return await scope.ServiceProvider.GetRequiredService<EngineReviewService>()
            .ApproveAsync(draftId, new EngineReviewActionInput("controller-7", "UTC"));
    }

    private static async Task TickAutoHoldAsync(ServiceProvider host, Guid exerciseId)
    {
        await using var scope = host.CreateAsyncScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = exerciseId;
        await scope.ServiceProvider.GetRequiredService<EngineReviewService>().EvaluateAutoHoldAsync();
    }

    private async Task SeedPersonaAsync(Guid exerciseId, string handle)
    {
        await using var seed = _fixture.CreateContext();
        seed.Personas.Add(new Persona
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            DisplayName = handle.TrimStart('@'),
            Handle = handle,
            Kind = "human",
            Verified = false,
        });
        await seed.SaveChangesAsync();
    }

    private async Task SeedItemAsync(EngineReviewItemEntity item)
    {
        await using var seed = _fixture.CreateContext();
        seed.EngineReviewItems.Add(item);
        await seed.SaveChangesAsync();
    }

    private async Task<EngineReviewItemEntity> ReloadAsync(Guid draftId)
    {
        await using var verify = _fixture.CreateContext();
        return await verify.EngineReviewItems.IgnoreQueryFilters().AsNoTracking().SingleAsync(i => i.DraftId == draftId);
    }

    private async Task<int> CountPostsAsync(Guid exerciseId)
    {
        await using var verify = _fixture.CreateContext();
        return await verify.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == exerciseId);
    }

    private async Task<int> CountReviewedAsync(Guid exerciseId, Guid draftId)
    {
        await using var verify = _fixture.CreateContext();
        return await verify.TelemetryEvents.IgnoreQueryFilters().CountAsync(e =>
            e.ExerciseId == exerciseId && e.EventType == EngineEventTypes.Reviewed
            && e.Target != null && e.Target.EntityId == draftId.ToString());
    }

    private static EngineReviewItemEntity Item(
        Guid draftId, Guid exerciseId, AutonomyLevel level, DraftDisposition disposition, params string[] handles)
    {
        var countdown = level == AutonomyLevel.DelayedAuto;
        return new EngineReviewItemEntity
        {
            DraftId = draftId,
            ExerciseId = exerciseId,
            StorylineId = Guid.NewGuid(),
            RoutedAtLevel = level,
            Disposition = disposition,
            CountdownStartedScenarioMinute = countdown ? 0 : null,
            CountdownMinutes = countdown ? 3 : null,
            CountdownDecision = countdown ? ControllerDecision.None : null,
            StorylineTag = "#WaterIssues",
            StorylineBrief = "Rising frustration about the water outage.",
            ActionLabel = "post · #WaterIssues",
            Posts = handles
                .Select(handle => new EngineReviewDraftPost
                {
                    PersonaHandle = handle,
                    Text = $"{handle.TrimStart('@')} says the water is still off on Elm.",
                    Sentiment = -0.3,
                    Hashtags = new List<string> { "#WaterIssues" },
                })
                .ToList(),
        };
    }

    private static Dictionary<string, EnginePersona> Cast(params string[] handles) =>
        handles.ToDictionary(
            handle => handle,
            handle => new EnginePersona(
                Guid.NewGuid(),
                new PersonaDossier { Handle = handle, DisplayName = handle.TrimStart('@'), Type = PersonaType.Resident }),
            StringComparer.Ordinal);

    private static Storyline SeededStoryline(Guid exerciseId, IReadOnlyList<string> personaHandles)
    {
        var storyline = Storyline.Create(
            exerciseId,
            title: "Water main contamination fears",
            expectation: "an official statement from the county",
            responseWindowMin: 20,
            participatingPersonas: personaHandles,
            hashtags: ["#WaterIssues"]);
        storyline.Seed(0);
        return storyline;
    }

    private static ReactionLoopRegistration Registration(
        Guid exerciseId, Storyline storyline, Dictionary<string, EnginePersona> cast) => new()
        {
            ExerciseId = exerciseId,
            ExerciseBrief = "A fictional water-utility incident in the town of Cedar Falls.",
            TimeZone = "America/Chicago",
            ScenarioStart = ScenarioStart,
            TimeZoneInfo = TimeZoneInfo.Utc,
            Storylines = [storyline],
            PersonasByHandle = cast,
            Autonomy = EngineAutonomyState.Create(exerciseId, AutonomyLevel.Suggest),
            ControllerDeskId = Guid.NewGuid(),
        };

    /// <summary>
    /// A provider whose model ignores the length it was asked for: one over-long post per requested persona. Each
    /// post's words are distinct (so the burst passes the diversity gate) and its handle is a placeholder (as the
    /// Fake's is), so the loop attributes it to the intent's persona.
    /// </summary>
    private sealed class LongPostProvider(string text) : IGenerationProvider
    {
        public string Name => "long-post-test";

        public GenerationGovernance Governance => GenerationGovernance.InProcess;

        public Task<GenerationResult> GenerateAsync(GenerationRequest request, CancellationToken cancellationToken = default)
        {
            var posts = Enumerable.Range(0, Math.Max(1, request.PostCount))
                .Select(i => new GeneratedPost($"@sim_{i:00}", i == 0 ? text : text.Replace("elm", $"oak{i}", StringComparison.Ordinal), -0.4, []))
                .ToList();
            return Task.FromResult(new GenerationResult(posts, new GenerationUsage(0, 0), TimeSpan.Zero, Name, "long-post"));
        }
    }
}
