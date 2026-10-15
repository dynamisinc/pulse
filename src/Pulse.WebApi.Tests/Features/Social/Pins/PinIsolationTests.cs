namespace Pulse.WebApi.Tests.Features.Social.Pins;

using System;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// Exercise isolation for pins (demo-feedback story 04, cross-cutting AC "Isolation (XC-001)"; COR-001, DP-16): a pin
/// or a Pinned read never resolves a post, persona or reaction outside the caller's exercise, and another exercise's
/// real post id gets exactly the 404 an unknown id gets. Fails closed; extends the standing isolation suite.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PinIsolationTests
{
    private static readonly DateTimeOffset T = PinsSeeder.PostCreatedAt;

    private readonly PinsSeeder _seed;

    public PinIsolationTests(MsSqlContainerFixture fixture) => _seed = new PinsSeeder(fixture);

    [RequiresDockerFact]
    public async Task ExercisePin_OnAnotherExercisesPost_Is404LikeAnUnknownId_AndTouchesNothing()
    {
        var a = await _seed.Sessions.SeedExerciseAsync();
        var b = await _seed.Sessions.SeedExerciseAsync();
        var bLive = await _seed.SeedPostAsync(b.Id, Guid.NewGuid());
        var bPinned = await _seed.SeedPostAsync(b.Id, Guid.NewGuid(), pinnedForAllAt: T, pinnedBy: "staff-b");
        var controllerA = await _seed.Sessions.SeedControllerSessionAsync(a.Id);

        using var factory = _seed.CreateHost();
        using var client = factory.CreateClientFor(a.Host, controllerA);

        var crossPin = await client.PutAsync(PinsSeeder.StaffPinUri(bLive), content: null);
        var crossUnpin = await client.DeleteAsync(PinsSeeder.StaffPinUri(bPinned));
        var unknown = await client.PutAsync(PinsSeeder.StaffPinUri(Guid.NewGuid()), content: null);

        crossPin.StatusCode.Should().Be(HttpStatusCode.NotFound);
        crossUnpin.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await crossPin.Content.ReadAsStringAsync()).Should().Be(
            await unknown.Content.ReadAsStringAsync(), "a cross-exercise id is indistinguishable from an unknown one");

        (await _seed.ReadPostAsync(bLive)).PinnedForAllAt.Should().BeNull("B's post was never pinned from A");
        var stillPinned = await _seed.ReadPostAsync(bPinned);
        stillPinned.PinnedForAllAt.Should().Be(T, "A cannot clear B's pin");
        stillPinned.PinnedForAllByHumanId.Should().Be("staff-b");
        factory.Broadcaster.PinChanges.Should().BeEmpty();
        (await _seed.ReadEventsAsync(a.Id, "post.pinned", "post.unpinned")).Should().BeEmpty();
        (await _seed.ReadEventsAsync(b.Id, "post.pinned", "post.unpinned")).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task PersonalPin_OnAnotherExercisesPost_Is404_AndWritesNoReaction()
    {
        var a = await _seed.Sessions.SeedExerciseAsync();
        var b = await _seed.Sessions.SeedExerciseAsync();
        var personaA = await _seed.Sessions.SeedPersonaAsync(a.Id);
        var bPost = await _seed.SeedPostAsync(b.Id, Guid.NewGuid());
        var token = await _seed.SeedParticipantAsync(a.Id, personaA);

        using var factory = _seed.CreateHost();
        using var client = factory.CreateClientFor(a.Host, token);

        (await client.PutAsync(PinsSeeder.PersonalPinUri(bPost), content: null)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await _seed.ReadReactionsAsync(bPost)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task PinnedFeed_InA_NeverShowsBsExercisePins_OrAnyReactionRowStampedB()
    {
        var a = await _seed.Sessions.SeedExerciseAsync();
        var b = await _seed.Sessions.SeedExerciseAsync();
        var personaA = await _seed.Sessions.SeedPersonaAsync(a.Id);

        var aPinned = await _seed.SeedPostAsync(a.Id, personaA, pinnedForAllAt: T);
        var aLiked = await _seed.SeedPostAsync(a.Id, personaA);
        await _seed.SeedReactionAsync(a.Id, aLiked, personaA, ReactionKinds.Like, T);

        // Exercise B: its own exercise pin, plus reaction rows that name A's persona id (a stray/buggy cross write).
        var bPinned = await _seed.SeedPostAsync(b.Id, Guid.NewGuid(), pinnedForAllAt: T.AddMinutes(30));
        var bPost = await _seed.SeedPostAsync(b.Id, Guid.NewGuid());
        await _seed.SeedReactionAsync(b.Id, bPost, personaA, ReactionKinds.Pin, T.AddMinutes(40));
        await _seed.SeedReactionAsync(b.Id, bPinned, personaA, ReactionKinds.Like, T.AddMinutes(41));

        var token = await _seed.SeedParticipantAsync(a.Id, personaA);
        using var factory = _seed.CreateHost();
        using var client = factory.CreateClientFor(a.Host, token);

        var response = await client.GetAsync(PinsSeeder.PinnedFeedUri);
        var raw = await response.Content.ReadAsStringAsync();

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        PinsSeeder.Items(await PinsSeeder.ReadJsonAsync(response)).Select(item => item.PostId).Should().Equal(
            new[] { aPinned, aLiked }, "only exercise A's pins and reactions contribute");
        raw.Should().NotContain(bPinned.ToString()).And.NotContain(bPost.ToString());
    }
}
