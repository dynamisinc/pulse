namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// The ingest funnel's own attribution validation, exercised directly against real SQL —
/// <c>identity-auth-roles/12</c>'s <b>in-process</b> half. <see cref="PostIngestService"/> deliberately does NOT
/// require a session (the engine's publish funnel and Phase 4's inject fire have no HTTP request at all), so
/// these checks are the defense in depth that keeps a TRUSTED in-process caller from writing an unattributed or
/// off-union row. They are unreachable from HTTP, where <see cref="PostAttributionResolver"/> has already refused
/// anything worse — which is exactly why they need coverage here rather than through the endpoint.
/// </summary>
/// <remarks>
/// The "actingHumanId is required when origin is controller-as-persona" rule used to be asserted through
/// <c>POST /api/posts</c> (a caller that omitted the body field got a 400). The field is no longer client-supplied
/// at all, so that route to the rule is gone and the rule is asserted at its remaining caller: here.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class PostIngestServiceAttributionTests
{
    private readonly MsSqlContainerFixture _fixture;

    public PostIngestServiceAttributionTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task ControllerAsPersonaAttribution_WithNoActingHuman_IsInvalid_AndPersistsNothing()
    {
        var exerciseId = Guid.NewGuid();
        var personaId = Guid.NewGuid();

        var broadcaster = new FakeFeedBroadcaster();
        await using var context = _fixture.CreateContext(ScopeFor(exerciseId));
        var service = new PostIngestService(context, ScopeFor(exerciseId), broadcaster);

        var result = await service.IngestAsync(
            ValidRequest(),
            new PostAttribution
            {
                AuthorPersonaId = personaId,
                Origin = "controller-as-persona",
                ActingHumanId = string.Empty,
            });

        result.Outcome.Should().Be(
            PostIngestOutcome.Invalid,
            "COR-018: a human-bearing origin must name the human — an in-process caller that states "
            + "'controller-as-persona' without one is refused, not silently stored with a blank attribution");
        result.ValidationError.Should().Contain("actingHumanId");
        await AssertNothingWrittenAsync(exerciseId);
        broadcaster.Calls.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task OffUnionOrigin_IsInvalid_AndPersistsNothing()
    {
        var exerciseId = Guid.NewGuid();

        var broadcaster = new FakeFeedBroadcaster();
        await using var context = _fixture.CreateContext(ScopeFor(exerciseId));
        var service = new PostIngestService(context, ScopeFor(exerciseId), broadcaster);

        var result = await service.IngestAsync(
            ValidRequest(),
            new PostAttribution
            {
                AuthorPersonaId = Guid.NewGuid(),
                Origin = "controller",   // plausible-looking, and NOT a PostOrigin union value
                ActingHumanId = "human-1",
            });

        result.Outcome.Should().Be(
            PostIngestOutcome.Invalid, "the PostOrigin union is still enforced against the stated attribution");
        await AssertNothingWrittenAsync(exerciseId);
        broadcaster.Calls.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task EmptyAuthorPersona_IsInvalid_AndPersistsNothing()
    {
        var exerciseId = Guid.NewGuid();

        var broadcaster = new FakeFeedBroadcaster();
        await using var context = _fixture.CreateContext(ScopeFor(exerciseId));
        var service = new PostIngestService(context, ScopeFor(exerciseId), broadcaster);

        var result = await service.IngestAsync(
            ValidRequest(),
            new PostAttribution
            {
                AuthorPersonaId = Guid.Empty,
                Origin = "engine",
                ActingHumanId = string.Empty,
            });

        result.Outcome.Should().Be(
            PostIngestOutcome.Invalid, "a post with no author is not a post — the empty GUID is refused");
        await AssertNothingWrittenAsync(exerciseId);
    }

    [RequiresDockerFact]
    public async Task InjectOrigin_WithoutAnInjectId_IsInvalid_AndPersistsNothing()
    {
        var exerciseId = Guid.NewGuid();

        var broadcaster = new FakeFeedBroadcaster();
        await using var context = _fixture.CreateContext(ScopeFor(exerciseId));
        var service = new PostIngestService(context, ScopeFor(exerciseId), broadcaster);

        var result = await service.IngestAsync(
            ValidRequest(),
            new PostAttribution
            {
                AuthorPersonaId = Guid.NewGuid(),
                Origin = "inject",
                ActingHumanId = string.Empty,
            });

        result.Outcome.Should().Be(
            PostIngestOutcome.Invalid, "an inject-origin post must name the MSEL inject it fired from");
        await AssertNothingWrittenAsync(exerciseId);
    }

    [RequiresDockerFact]
    public async Task NonHumanOrigin_WithNoActingHuman_IsAccepted_AndNullOmitsItOnTheTelemetryActor()
    {
        // The locked v0 envelope types actor.actingHumanId as z.string().min(1).optional(), so an EMPTY string is
        // off-envelope and must be null-omitted rather than persisted as "". An engine post is the caller that
        // legitimately has no human behind it, which is what keeps this rule reachable now that every HTTP origin
        // carries a real one.
        var exerciseId = Guid.NewGuid();
        var personaId = Guid.NewGuid();

        var broadcaster = new FakeFeedBroadcaster();
        await using var context = _fixture.CreateContext(ScopeFor(exerciseId));
        var service = new PostIngestService(context, ScopeFor(exerciseId), broadcaster);

        var result = await service.IngestAsync(
            ValidRequest(),
            new PostAttribution
            {
                AuthorPersonaId = personaId,
                Origin = "engine",
                ActingHumanId = string.Empty,
            });

        result.Outcome.Should().Be(PostIngestOutcome.Created);
        var post = result.Post!;
        post.Origin.Should().Be("engine");
        post.AuthorPersonaId.Should().Be(personaId);
        post.ActingHumanId.Should().BeEmpty("the Post column is NOT NULL, so the row stores the empty string");

        await using var readContext = _fixture.CreateContext();
        var telemetryEvent = await readContext.TelemetryEvents.IgnoreQueryFilters()
            .SingleAsync(e => e.Target != null && e.Target.EntityId == post.Id.ToString());

        telemetryEvent.Actor.ActingHumanId.Should().BeNull(
            "an empty acting human is null-OMITTED on the event, never emitted as \"\" (off the v0 envelope)");
        telemetryEvent.Actor.PersonaId.Should().Be(
            personaId.ToString(), "even an engine post is attributed to the persona it was posted AS");
    }

    private static IExerciseContext ScopeFor(Guid exerciseId) =>
        new ExerciseContext { CurrentExerciseId = exerciseId };

    private static CreatePostRequest ValidRequest() => new()
    {
        // The three attribution fields are deliberately populated with values that must NOT be used, proving the
        // funnel reads none of them: they are inert on this path.
        AuthorPersonaId = Guid.NewGuid().ToString(),
        Origin = "participant",
        ActingHumanId = "body-supplied-and-ignored",

        Text = "in-process ingest",
        ScenarioTime = "2033-06-14T09:00:00-05:00",
        TimeZone = "America/Chicago",
    };

    private async Task AssertNothingWrittenAsync(Guid exerciseId)
    {
        await using var context = _fixture.CreateContext();
        (await context.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == exerciseId)).Should().Be(
            0, "a refused ingest writes no post");
        (await context.TelemetryEvents.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == exerciseId)).Should().Be(
            0, "and no telemetry event — the event is written in the SAME unit of work as the post");
    }
}
