namespace Pulse.WebApi.Tests.Features.Social.Moderation;

using System;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// Read-path regression for controller takedown (demo-polish B6, story 09 AC "Reads honour it"). After a real
/// takedown through the endpoint, a participant's All Posts feed, Following feed and focused thread all omit the
/// post, and no participant payload carries its id or text. Each test first proves the post WAS visible to the
/// same participant, so the omission is the takedown and not an empty feed. The profile and hashtag views are
/// client-side filters over the feed, so the feed assertions cover them. Real <c>Program</c> pipeline, real SQL.
/// </summary>
/// <remarks>
/// The thread reply tombstone (B2), reply counts (B3) and <c>includeReplies</c> (BP) are not in this branch, so
/// they are checked at Gate 2 once those stories merge.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class TakedownReadPathTests
{
    private readonly ModerationSeeder _seed;

    public TakedownReadPathTests(MsSqlContainerFixture fixture) => _seed = new ModerationSeeder(fixture);

    [RequiresDockerFact]
    public async Task AfterTakedown_TheFeedTheFollowingFeedAndTheThread_OmitThePost_AndCarryNoneOfItsContent()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var author = await _seed.SeedPersonaAsync(exercise.Id);
        var reader = await _seed.SeedPersonaAsync(exercise.Id);
        await _seed.SeedFollowAsync(exercise.Id, reader, author);

        var takenDown = await _seed.SeedPostAsync(exercise.Id, author, withMedia: true);
        var stillLive = await _seed.SeedPostAsync(exercise.Id, author);

        var participant = await _seed.SeedParticipantSessionAsync(exercise.Id, reader);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        using var participantClient = factory.CreateClientFor(exercise.Host, participant);
        using var controllerClient = factory.CreateClientFor(exercise.Host, controller);

        // Before: the participant sees it everywhere (non-vacuity).
        (await GetFeedIdsAsync(participantClient, "/api/feed")).Should().Contain(takenDown.ToString());
        (await GetFeedIdsAsync(participantClient, "/api/feed?scope=following")).Should().Contain(takenDown.ToString());
        (await GetFocusedIdAsync(participantClient, takenDown)).Should().Be(takenDown.ToString());

        var takedown = await controllerClient.DeleteAsync(new Uri($"/api/staff/posts/{takenDown}", UriKind.Relative));
        takedown.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // After: gone from every participant source, while the other post stays.
        var feed = await GetRawAsync(participantClient, "/api/feed");
        var following = await GetRawAsync(participantClient, "/api/feed?scope=following");
        var thread = await GetRawAsync(participantClient, $"/api/threads/{takenDown}");

        IdsOf(feed).Should().NotContain(takenDown.ToString(), "the All Posts feed omits a taken-down post")
            .And.Contain(stillLive.ToString(), "the takedown removes only that post");
        IdsOf(following).Should().NotContain(takenDown.ToString(), "the Following feed omits it too")
            .And.Contain(stillLive.ToString());

        using (var threadDoc = JsonDocument.Parse(thread))
        {
            threadDoc.RootElement.GetProperty("focused").ValueKind.Should().Be(
                JsonValueKind.Null, "a taken-down focused post yields the not-found thread shape");
        }

        foreach (var payload in new[] { feed, following, thread })
        {
            payload.Should().NotContain(takenDown.ToString(), "no participant payload names the taken-down post")
                .And.NotContain(ModerationSeeder.BodyOf(takenDown), "no participant payload carries its text");
        }
    }

    private static async Task<string> GetRawAsync(HttpClient client, string path)
    {
        var response = await client.GetAsync(new Uri(path, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK, $"{path} is a participant read");
        return await response.Content.ReadAsStringAsync();
    }

    private static async Task<string[]> GetFeedIdsAsync(HttpClient client, string path) =>
        IdsOf(await GetRawAsync(client, path));

    private static async Task<string?> GetFocusedIdAsync(HttpClient client, Guid postId)
    {
        using var doc = JsonDocument.Parse(await GetRawAsync(client, $"/api/threads/{postId}"));
        var focused = doc.RootElement.GetProperty("focused");
        return focused.ValueKind == JsonValueKind.Null ? null : focused.GetProperty("id").GetString();
    }

    private static string[] IdsOf(string feedJson)
    {
        using var doc = JsonDocument.Parse(feedJson);
        var ids = new string[doc.RootElement.GetArrayLength()];
        var i = 0;
        foreach (var item in doc.RootElement.EnumerateArray())
        {
            ids[i++] = item.GetProperty("id").GetString()!;
        }

        return ids;
    }
}
