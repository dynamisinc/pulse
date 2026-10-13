namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Globalization;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// IQ-10 (inject-queue/06): the funnel honours the seeded engagement baseline for a scripted <c>inject</c> post, as it
/// does for a <c>controller-as-persona</c> write (see <c>PostMediaWriteTests</c>' "Baseline is staff-only" block) —
/// and still ignores it for a participant. Service level: <c>inject</c> is reachable only in-process, never over HTTP.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PostIngestInjectBaselineTests
{
    private readonly MsSqlContainerFixture _fixture;

    public PostIngestInjectBaselineTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task AnInjectPost_SeedsItsBaseline()
    {
        var (exerciseId, personaId) = await SeedAsync();

        var result = await IngestAsync(exerciseId, personaId, "inject", new EngagementBaselineRequest(1450, 999, 12));

        result.Outcome.Should().Be(PostIngestOutcome.Created);
        (result.Post!.BaselineLikeCount, result.Post.BaselineRepostCount, result.Post.BaselineReplyCount)
            .Should().Be((1450, 999, 12), "a scripted post is staff-authored and may seed its engagement (IQ-10)");
    }

    [RequiresDockerFact]
    public async Task AnInjectPost_IsHeldToTheSameBaselineRange()
    {
        var (exerciseId, personaId) = await SeedAsync();

        var result = await IngestAsync(exerciseId, personaId, "inject", new EngagementBaselineRequest(-1, null, null));

        result.Outcome.Should().Be(PostIngestOutcome.Invalid);
        result.ValidationError.Should().Be("engagementBaseline values must be between 0 and 1000000.");
    }

    [RequiresDockerFact]
    public async Task AParticipantPost_StillIgnoresTheBaseline()
    {
        var (exerciseId, personaId) = await SeedAsync();

        var result = await IngestAsync(exerciseId, personaId, "participant", new EngagementBaselineRequest(5000, -7, 3));

        result.Outcome.Should().Be(PostIngestOutcome.Created, "ignored means ignored — not even validated");
        (result.Post!.BaselineLikeCount, result.Post.BaselineRepostCount, result.Post.BaselineReplyCount).Should().Be((0, 0, 0));
    }

    private async Task<PostIngestResult> IngestAsync(Guid exerciseId, Guid personaId, string origin, EngagementBaselineRequest baseline)
    {
        var scope = new ExerciseContext { CurrentExerciseId = exerciseId };
        await using var context = _fixture.CreateContext(scope);
        var service = new PostIngestService(context, scope, new FakeFeedBroadcaster());

        return await service.IngestAsync(
            new CreatePostRequest
            {
                Text = "Scripted #WaterIssues",
                ScenarioTime = DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture),
                TimeZone = "UTC",
                InjectId = origin == "inject" ? Guid.NewGuid().ToString() : null,
                EngagementBaseline = baseline,
            },
            new PostAttribution { AuthorPersonaId = personaId, Origin = origin, ActingHumanId = "staff-or-participant-human" });
    }

    private async Task<(Guid ExerciseId, Guid PersonaId)> SeedAsync()
    {
        var exerciseId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        context.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = "Baseline",
            TimeZone = "UTC",
            Status = "live",
        });
        context.Personas.Add(new Persona
        {
            Id = personaId,
            ExerciseId = exerciseId,
            DisplayName = "Resident",
            Handle = $"@r_{personaId:N}",
            Kind = "citizen",
        });
        await context.SaveChangesAsync();
        return (exerciseId, personaId);
    }
}
