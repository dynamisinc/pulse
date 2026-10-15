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
/// <c>viewer.pinned</c> and <c>pinnedForAll</c> on every participant post projection (demo-feedback story 04, ACs
/// "Viewer state" and "Exercise pin"; XC-002): the All feed, the Following feed, the thread and the Pinned tab, through
/// the REAL <c>Program</c> pipeline and real SQL. Who pinned a post for everyone never reaches the wire.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PinProjectionTests
{
    private static readonly DateTimeOffset T = PinsSeeder.PostCreatedAt;

    private readonly PinsSeeder _seed;

    public PinProjectionTests(MsSqlContainerFixture fixture) => _seed = new PinsSeeder(fixture);

    [RequiresDockerFact]
    public async Task EveryParticipantProjection_CarriesViewerPinned_AndPinnedForAll_NeverWhoPinnedIt()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var viewer = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        var author = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        await _seed.Sessions.SeedFollowAsync(exercise.Id, viewer, author);

        var secretPinner = $"staff-secret-{Guid.NewGuid():N}";
        var pinnedForAll = await _seed.SeedPostAsync(
            exercise.Id, author, createdAt: T.AddMinutes(2), pinnedForAllAt: T.AddMinutes(3), pinnedBy: secretPinner);
        var personallyPinned = await _seed.SeedPostAsync(exercise.Id, author, createdAt: T.AddMinutes(1));
        var plain = await _seed.SeedPostAsync(exercise.Id, author, createdAt: T);
        await _seed.SeedReactionAsync(exercise.Id, personallyPinned, viewer, ReactionKinds.Pin, T.AddMinutes(4));
        var token = await _seed.SeedParticipantAsync(exercise.Id, viewer);

        using var factory = _seed.CreateHost();
        using var client = factory.CreateClientFor(exercise.Host, token);

        foreach (var feedUri in new[] { "/api/feed", "/api/feed?scope=following" })
        {
            var raw = await GetRawAsync(client, feedUri);
            raw.Should().NotContain(secretPinner, $"{feedUri} must never carry who pinned a post (XC-002)");
            using var feed = JsonDocument.Parse(raw);

            var exercisePinned = Find(feed.RootElement, pinnedForAll);
            exercisePinned.GetProperty("pinnedForAll").GetBoolean().Should().BeTrue($"{feedUri}: pinned for everyone");
            exercisePinned.GetProperty("viewer").GetProperty("pinned").GetBoolean().Should().BeFalse(
                "an exercise pin is not a personal pin");

            var mine = Find(feed.RootElement, personallyPinned);
            mine.GetProperty("viewer").GetProperty("pinned").GetBoolean().Should().BeTrue($"{feedUri}: my own pin");
            mine.TryGetProperty("pinnedForAll", out _).Should().BeFalse("omitted, never false or null, when not pinned for everyone");

            var other = Find(feed.RootElement, plain);
            other.GetProperty("viewer").GetProperty("pinned").GetBoolean().Should().BeFalse();
            other.TryGetProperty("pinnedForAll", out _).Should().BeFalse();
        }

        var threadRaw = await GetRawAsync(client, $"/api/threads/{pinnedForAll}");
        threadRaw.Should().NotContain(secretPinner);
        using (var thread = JsonDocument.Parse(threadRaw))
        {
            var focused = thread.RootElement.GetProperty("focused");
            focused.GetProperty("pinnedForAll").GetBoolean().Should().BeTrue("the thread projection carries it too");
            focused.GetProperty("viewer").GetProperty("pinned").GetBoolean().Should().BeFalse();
        }

        using (var thread = JsonDocument.Parse(await GetRawAsync(client, $"/api/threads/{personallyPinned}")))
        {
            thread.RootElement.GetProperty("focused").GetProperty("viewer").GetProperty("pinned").GetBoolean().Should().BeTrue();
        }

        var pinnedRaw = await GetRawAsync(client, PinsSeeder.PinnedFeedUri.ToString());
        pinnedRaw.Should().NotContain(secretPinner);
        using var pinnedTab = JsonDocument.Parse(pinnedRaw);
        var posts = pinnedTab.RootElement.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("post")).ToArray();
        posts.Should().HaveCount(2);
        posts[0].GetProperty("pinnedForAll").GetBoolean().Should().BeTrue();
        posts[1].GetProperty("viewer").GetProperty("pinned").GetBoolean().Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task AStaffFeedRead_CarriesPinnedForAll_WithoutViewerOrWhoPinnedIt()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var author = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        var secretPinner = $"staff-secret-{Guid.NewGuid():N}";
        var postId = await _seed.SeedPostAsync(exercise.Id, author, pinnedForAllAt: T, pinnedBy: secretPinner);
        var controller = await _seed.Sessions.SeedControllerSessionAsync(exercise.Id);

        using var factory = _seed.CreateHost();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var raw = await GetRawAsync(client, "/api/feed");
        raw.Should().NotContain(secretPinner);
        using var feed = JsonDocument.Parse(raw);
        var item = Find(feed.RootElement, postId);
        item.GetProperty("pinnedForAll").GetBoolean().Should().BeTrue("the console reads the same projection (story 08)");
        item.TryGetProperty("viewer", out _).Should().BeFalse();
    }

    private static async Task<string> GetRawAsync(System.Net.Http.HttpClient client, string uri)
    {
        var response = await client.GetAsync(new Uri(uri, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK, uri);
        return await response.Content.ReadAsStringAsync();
    }

    private static JsonElement Find(JsonElement feed, Guid postId) =>
        feed.EnumerateArray().Single(item => item.GetProperty("id").GetString() == postId.ToString());
}
