namespace Pulse.WebApi.Tests.Features.Social.Threads;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// End-to-end reply flow (demo-polish B2 Technical Notes; AC-4, AC-5): <c>POST /api/posts</c> with a
/// <c>parentPostId</c> → <c>GET /api/threads/{id}</c> lists it → <c>GET /api/feed</c> excludes it. These tests need
/// BP's ingest and B3's engagement reader on the same host, so they only run on the integrated Wave 1b umbrella
/// (Gate-2 integration, B2 M-3): plain <see cref="RequiresDockerFactAttribute"/> tests from then on.
/// </summary>
/// <remarks>
/// Drives the GENUINE pipeline with real sessions and real tokens (host → exercise resolution, session
/// authentication, the default-deny gate), as <c>PostWriteEndpointTests</c> does. Only the broadcaster is replaced,
/// with a no-op, because the SignalR fan-out is not what this suite asserts.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class ReplyFlowTests
{
    private static readonly Uri PostsUri = new("/api/posts", UriKind.Relative);
    private static readonly Uri FeedUri = new("/api/feed", UriKind.Relative);

    private readonly MsSqlContainerFixture _fixture;

    public ReplyFlowTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task PostedReply_IsInTheThread_HasItsParentAsAncestor_AndTheDefaultFeedExcludesIt()
    {
        var world = await SeedWorldAsync();
        var parent = ThreadSeed.NewPost(world.Exercise, "the parent", ThreadSeed.Anchor, authorPersonaId: world.OtherPersona);
        await SeedAsync(parent);

        await using var factory = new ReplyFlowWebApplicationFactory(ConnectionString);
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var created = await client.PostAsync(PostsUri, Json(ReplyBody(world.ParticipantPersona, "my reply", parent.Id.ToString())));
        created.StatusCode.Should().Be(HttpStatusCode.Created, "BP's ingest accepts a reply to an in-scope parent");
        var replyId = Guid.Parse(JsonNode.Parse(await created.Content.ReadAsStringAsync())!["id"]!.GetValue<string>());

        await using (var read = _fixture.CreateContext())
        {
            (await read.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == replyId)).ParentPostId.Should().Be(parent.Id);
        }

        var thread = JsonNode.Parse(await client.GetStringAsync(ThreadUri(parent.Id)))!;
        ThreadReplyDtoShapeTests.IsValidThreadResponse(thread).Should().BeTrue();
        var reply = thread["replies"]!.AsArray().Should().ContainSingle().Subject!;
        reply["id"]!.GetValue<string>().Should().Be(replyId.ToString());
        reply["status"]!.GetValue<string>().Should().Be("visible");
        reply["replyToPersonaId"]!.GetValue<string>().Should().Be(world.OtherPersona.ToString());
        reply["inReplyTo"]!["postId"]!.GetValue<string>().Should().Be(parent.Id.ToString());
        reply["inReplyTo"]!["authorHandle"]!.GetValue<string>().Should().Be(world.OtherHandle);

        var replyThread = JsonNode.Parse(await client.GetStringAsync(ThreadUri(replyId)))!;
        replyThread["ancestors"]!.AsArray().Select(a => a!["id"]!.GetValue<string>()).Should().Equal(parent.Id.ToString());
        replyThread["focused"]!["id"]!.GetValue<string>().Should().Be(replyId.ToString());

        var feedIds = JsonNode.Parse(await client.GetStringAsync(FeedUri))!.AsArray().Select(p => p!["id"]!.GetValue<string>()).ToList();
        feedIds.Should().Contain(parent.Id.ToString());
        feedIds.Should().NotContain(replyId.ToString(), "the default feed is top-level only");
    }

    [RequiresDockerFact]
    public async Task ReplyToAnotherExercisesPost_Is400_IdenticalToAnUnknownParent_AndWritesNothing()
    {
        // DP-16 end to end: exercise B's REAL post id, sent as a parent under scope A.
        var worldA = await SeedWorldAsync();
        var worldB = await SeedWorldAsync();
        var postInB = ThreadSeed.NewPost(worldB.Exercise, "SECRET-B-PARENT", ThreadSeed.Anchor, authorPersonaId: worldB.OtherPersona);
        var deletedInA = ThreadSeed.NewPost(worldA.Exercise, "deleted parent", ThreadSeed.Anchor, authorPersonaId: worldA.OtherPersona, deletedAt: ThreadSeed.Anchor.AddMinutes(1));
        await SeedAsync(postInB, deletedInA);

        await using var factory = new ReplyFlowWebApplicationFactory(ConnectionString);
        using var client = factory.CreateClientFor(worldA.Host, worldA.ParticipantToken);

        // Snapshot AFTER the host has booted: on the first real-host boot of a fresh test database, the
        // Development-only OrgAdminSeed hosted service grants orgAdmin for every exercise in the organization and
        // writes one staff.org_admin_seeded event per exercise. Only the three rejected replies are under test.
        var before = await CountRowsAsync(worldA.Exercise, worldB.Exercise);

        var crossExercise = await client.PostAsync(PostsUri, Json(ReplyBody(worldA.ParticipantPersona, "x", postInB.Id.ToString())));
        var unknown = await client.PostAsync(PostsUri, Json(ReplyBody(worldA.ParticipantPersona, "x", Guid.NewGuid().ToString())));
        var deleted = await client.PostAsync(PostsUri, Json(ReplyBody(worldA.ParticipantPersona, "x", deletedInA.Id.ToString())));

        var unknownBody = await unknown.Content.ReadAsStringAsync();
        unknown.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        crossExercise.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        deleted.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await crossExercise.Content.ReadAsStringAsync()).Should().Be(unknownBody, "B's real id must be indistinguishable from an unknown id");
        (await deleted.Content.ReadAsStringAsync()).Should().Be(unknownBody, "a deleted parent is rejected the same way");

        (await CountRowsAsync(worldA.Exercise, worldB.Exercise)).Should().Be(before, "a rejected reply writes no post and no telemetry in either exercise");
    }

    [RequiresDockerFact]
    public async Task ReplyCount_EqualsTheVisibleReplies_AndATakedownDecrementsIt()
    {
        var world = await SeedWorldAsync();
        var parent = ThreadSeed.NewPost(world.Exercise, "count me", ThreadSeed.Anchor, authorPersonaId: world.OtherPersona);
        await SeedAsync(parent);

        await using var factory = new ReplyFlowWebApplicationFactory(ConnectionString);
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var replyIds = new List<Guid>();
        for (var i = 0; i < 2; i++)
        {
            var created = await client.PostAsync(PostsUri, Json(ReplyBody(world.ParticipantPersona, $"reply {i}", parent.Id.ToString())));
            created.StatusCode.Should().Be(HttpStatusCode.Created);
            replyIds.Add(Guid.Parse(JsonNode.Parse(await created.Content.ReadAsStringAsync())!["id"]!.GetValue<string>()));
        }

        var before = JsonNode.Parse(await client.GetStringAsync(ThreadUri(parent.Id)))!;
        before["focused"]!["counts"]!["reply"]!.GetValue<int>().Should().Be(2, "baseline 0 + two real replies");
        before["replies"]!.AsArray().Count(r => r!["status"]!.GetValue<string>() == "visible").Should().Be(2);
        FeedReplyCount(JsonNode.Parse(await client.GetStringAsync(FeedUri))!, parent.Id).Should().Be(2, "the feed reads the same count");

        await using (var takedown = _fixture.CreateContext())
        {
            var target = await takedown.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == replyIds[0]);
            target.DeletedAt = ThreadSeed.Anchor.AddMinutes(30);
            await takedown.SaveChangesAsync();
        }

        var after = JsonNode.Parse(await client.GetStringAsync(ThreadUri(parent.Id)))!;
        after["focused"]!["counts"]!["reply"]!.GetValue<int>().Should().Be(1, "a takedown decrements the reply count");
        after["replies"]!.AsArray().Select(r => r!["status"]!.GetValue<string>()).Should().BeEquivalentTo(new[] { "taken-down", "visible" });
    }

    private static int FeedReplyCount(JsonNode feed, Guid postId)
        => feed.AsArray().Single(p => p!["id"]!.GetValue<string>() == postId.ToString())!["counts"]!["reply"]!.GetValue<int>();

    private static Uri ThreadUri(Guid postId) => new($"/api/threads/{postId}", UriKind.Relative);

    private static StringContent Json(object body) => new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private static Dictionary<string, object?> ReplyBody(Guid authorPersonaId, string text, string parentPostId) => new()
    {
        ["authorPersonaId"] = authorPersonaId.ToString(),
        ["text"] = text,
        ["scenarioTime"] = "2033-09-04T14:30:00-05:00",
        ["timeZone"] = "America/Chicago",
        ["origin"] = "participant",
        ["parentPostId"] = parentPostId,
    };

    private string ConnectionString
    {
        get
        {
            _fixture.ConnectionString.Should().NotBeNull("the SQL fixture must be provisioned");
            return _fixture.ConnectionString!;
        }
    }

    private async Task<(int PostsA, int PostsB, int EventsA, int EventsB)> CountRowsAsync(Guid exerciseA, Guid exerciseB)
    {
        await using var context = _fixture.CreateContext();
        var posts = context.Posts.IgnoreQueryFilters();
        var events = context.TelemetryEvents.IgnoreQueryFilters();
        return (
            await posts.CountAsync(p => p.ExerciseId == exerciseA),
            await posts.CountAsync(p => p.ExerciseId == exerciseB),
            await events.CountAsync(e => e.ExerciseId == exerciseA),
            await events.CountAsync(e => e.ExerciseId == exerciseB));
    }

    private async Task SeedAsync(params Post[] posts)
    {
        await using var seed = _fixture.CreateContext();
        seed.Posts.AddRange(posts);
        await seed.SaveChangesAsync();
    }

    /// <summary>One exercise with a provisioned host, two personas and a live participant session bound to the first.</summary>
    private async Task<ReplyWorld> SeedWorldAsync()
    {
        var exerciseId = Guid.NewGuid();
        var participantPersona = Guid.NewGuid();
        var otherPersona = Guid.NewGuid();
        var token = $"participant-{Guid.NewGuid():N}";

        var world = new ReplyWorld(
            exerciseId,
            $"replyflow-{exerciseId:N}.example.com",
            participantPersona,
            otherPersona,
            $"p_{otherPersona:N}",
            token);

        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = $"Exercise {exerciseId:N}",
            Hostname = world.Host,
            TimeZone = "America/Chicago",
            Status = "active",
        });
        seed.Personas.Add(NewPersona(participantPersona, exerciseId, $"p_{participantPersona:N}"));
        seed.Personas.Add(NewPersona(otherPersona, exerciseId, world.OtherHandle));
        seed.Sessions.Add(TestSessions.NewSession(token, exerciseId, participantPersona));
        await seed.SaveChangesAsync();

        return world;
    }

    private static Persona NewPersona(Guid id, Guid exerciseId, string handle) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        DisplayName = $"Persona {id:N}",
        Handle = handle,
        Kind = "human",
        Verified = false,
    };

    private sealed record ReplyWorld(Guid Exercise, string Host, Guid ParticipantPersona, Guid OtherPersona, string OtherHandle, string ParticipantToken);

    /// <summary>Discards broadcasts; the SignalR fan-out is not under test here.</summary>
    private sealed class NoOpFeedBroadcaster : IFeedBroadcaster
    {
        public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }

    /// <summary>The real host with no identity fakes: every request travels the genuine pipeline.</summary>
    private sealed class ReplyFlowWebApplicationFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        public ReplyFlowWebApplicationFactory(string connectionString)
            => Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);

        public HttpClient CreateClientFor(string host, string bearerToken)
        {
            var client = CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri($"http://{host}") });
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
            return client;
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);

            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IFeedBroadcaster>();
                services.AddSingleton<IFeedBroadcaster>(new NoOpFeedBroadcaster());
            });
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
