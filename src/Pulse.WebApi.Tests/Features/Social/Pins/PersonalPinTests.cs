namespace Pulse.WebApi.Tests.Features.Social.Pins;

using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// The PERSONAL pin (demo-feedback story 04, AC "Personal pin (DF-6)", XC-004): <c>PUT</c> / <c>DELETE
/// /api/posts/{postId}/reactions/pin</c> on the existing reaction route, through the REAL <c>Program</c> pipeline and
/// real SQL. A pin is idempotent, participant-only, never moves a count and is visible to nobody else.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PersonalPinTests
{
    private readonly PinsSeeder _seed;

    public PersonalPinTests(MsSqlContainerFixture fixture) => _seed = new PinsSeeder(fixture);

    [RequiresDockerFact]
    public async Task PinThenUnpin_Participant_FlipsViewerPinned_CountsNeverMove_OneEventPerChange()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var viewer = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        var other = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        var postId = await _seed.SeedPostAsync(exercise.Id, other, baselineLike: 3);
        await _seed.SeedReactionAsync(exercise.Id, postId, other, ReactionKinds.Like, PinsSeeder.PostCreatedAt);
        var token = await _seed.SeedParticipantAsync(exercise.Id, viewer);

        using var factory = _seed.CreateHost();
        using var client = factory.CreateClientFor(exercise.Host, token);

        var pinned = await client.PutAsync(PinsSeeder.PersonalPinUri(postId), content: null);
        var repeat = await client.PutAsync(PinsSeeder.PersonalPinUri(postId), content: null);

        pinned.StatusCode.Should().Be(HttpStatusCode.OK);
        repeat.StatusCode.Should().Be(HttpStatusCode.OK, "pinning a pinned post is an idempotent success");
        (await repeat.Content.ReadAsStringAsync()).Should().Be(await pinned.Content.ReadAsStringAsync());

        var state = await PinsSeeder.ReadJsonAsync(pinned);
        state.GetProperty("kind").GetString().Should().Be("pin");
        state.GetProperty("active").GetBoolean().Should().BeTrue();
        state.GetProperty("viewer").GetProperty("pinned").GetBoolean().Should().BeTrue();
        state.GetProperty("viewer").GetProperty("liked").GetBoolean().Should().BeFalse();
        AssertCounts(state, like: 4, "a pin is never counted: baseline 3 + the other persona's one real like");

        var rows = await _seed.ReadReactionsAsync(postId);
        rows.Where(r => r.Kind == ReactionKinds.Pin).Should().ContainSingle("a repeat writes no second row")
            .Which.PersonaId.Should().Be(viewer);

        var unpinned = await client.DeleteAsync(PinsSeeder.PersonalPinUri(postId));
        unpinned.StatusCode.Should().Be(HttpStatusCode.OK);
        var after = await PinsSeeder.ReadJsonAsync(unpinned);
        after.GetProperty("active").GetBoolean().Should().BeFalse();
        after.GetProperty("viewer").GetProperty("pinned").GetBoolean().Should().BeFalse();
        AssertCounts(after, like: 4, "un-pinning never moves a count either");
        (await _seed.ReadReactionsAsync(postId)).Single(r => r.Kind == ReactionKinds.Pin).DeletedAt.Should().NotBeNull(
            "un-pinning is a soft delete (DP-15)");

        var events = await _seed.ReadEventsAsync(exercise.Id, "post.pinned", "post.unpinned", "reaction", "repost");
        events.Select(e => e.EventType).Should().Equal(
            new[] { "post.pinned", "post.unpinned" }, "one event per real change, and never a like/repost event");
        events.Should().OnlyContain(e => e.Payload == "{\"scope\":\"personal\"}");
        events.Should().OnlyContain(e => e.Actor.Kind == "persona" && e.Actor.PersonaId == viewer.ToString());
        events.Should().OnlyContain(e => e.Target!.EntityId == postId.ToString());
    }

    [RequiresDockerFact]
    public async Task APin_IsInvisibleToEveryOtherViewer_AndNeverChangesTheirCounts()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var pinner = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        var onlooker = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        var postId = await _seed.SeedPostAsync(exercise.Id, onlooker, baselineLike: 2);
        var pinnerToken = await _seed.SeedParticipantAsync(exercise.Id, pinner);
        var onlookerToken = await _seed.SeedParticipantAsync(exercise.Id, onlooker);

        using var factory = _seed.CreateHost();
        using var pinnerClient = factory.CreateClientFor(exercise.Host, pinnerToken);
        using var onlookerClient = factory.CreateClientFor(exercise.Host, onlookerToken);

        (await pinnerClient.PutAsync(PinsSeeder.PersonalPinUri(postId), content: null)).StatusCode.Should().Be(HttpStatusCode.OK);

        var mine = FeedItem(await PinsSeeder.ReadJsonAsync(await pinnerClient.GetAsync(new Uri("/api/feed", UriKind.Relative))), postId);
        var theirs = FeedItem(await PinsSeeder.ReadJsonAsync(await onlookerClient.GetAsync(new Uri("/api/feed", UriKind.Relative))), postId);

        mine.GetProperty("viewer").GetProperty("pinned").GetBoolean().Should().BeTrue();
        theirs.GetProperty("viewer").GetProperty("pinned").GetBoolean().Should().BeFalse("nobody else can see a personal pin");
        mine.GetProperty("counts").GetProperty("like").GetInt32().Should().Be(2);
        theirs.GetProperty("counts").GetProperty("like").GetInt32().Should().Be(2);
        theirs.TryGetProperty("pinnedForAll", out _).Should().BeFalse("a personal pin is never an exercise pin");

        var onlookerPinned = PinsSeeder.Items(await PinsSeeder.ReadJsonAsync(await onlookerClient.GetAsync(PinsSeeder.PinnedFeedUri)));
        onlookerPinned.Should().BeEmpty("another participant's pin never reaches my Pinned tab");
    }

    [RequiresDockerFact]
    public async Task StaffAndReadOnlySessions_AreRefused_AndWriteNothing()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var persona = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        var postId = await _seed.SeedPostAsync(exercise.Id, persona);
        var staffWithPersona = await _seed.SeedSessionAsync(exercise.Id, persona, kind: "staff");
        var readOnly = await _seed.SeedSessionAsync(exercise.Id, persona, kind: "readonly", isReadOnly: true);

        using var factory = _seed.CreateHost();
        foreach (var token in new[] { staffWithPersona, readOnly })
        {
            using var client = factory.CreateClientFor(exercise.Host, token);
            (await client.PutAsync(PinsSeeder.PersonalPinUri(postId), content: null)).StatusCode.Should().Be(
                HttpStatusCode.Forbidden, "a personal pin is participant-only (DF-6), and read-only never writes (COR-015)");
        }

        (await _seed.ReadReactionsAsync(postId)).Should().BeEmpty();
        (await _seed.ReadEventsAsync(exercise.Id, "post.pinned")).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task TakenDownOrUnknownPost_Returns404()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var persona = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        var takenDown = await _seed.SeedPostAsync(exercise.Id, persona, deletedAt: PinsSeeder.PostCreatedAt.AddMinutes(1));
        var token = await _seed.SeedParticipantAsync(exercise.Id, persona);

        using var factory = _seed.CreateHost();
        using var client = factory.CreateClientFor(exercise.Host, token);

        (await client.PutAsync(PinsSeeder.PersonalPinUri(takenDown), content: null)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await client.PutAsync(PinsSeeder.PersonalPinUri(Guid.NewGuid()), content: null)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await _seed.ReadReactionsAsync(takenDown)).Should().BeEmpty();
    }

    private static void AssertCounts(JsonElement state, int like, string because) =>
        state.GetProperty("counts").GetProperty("like").GetInt32().Should().Be(like, because);

    private static JsonElement FeedItem(JsonElement feed, Guid postId) =>
        feed.EnumerateArray().Single(item => item.GetProperty("id").GetString() == postId.ToString());
}
