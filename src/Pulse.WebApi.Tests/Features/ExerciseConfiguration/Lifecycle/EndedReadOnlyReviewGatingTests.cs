namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using FluentAssertions.Execution;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Social;
using Pulse.WebApi.Tests.Helpers;
using Xunit;

/// <summary>
/// <b>The ended, read-only review (Tom, 2026-10-19), end to end through the REAL <c>Program</c> host.</b> In
/// <c>completed</c> every gated participant GET is served (feed, pinned, threads, personas and the follow graph,
/// suggestions, post edit history, and the six shell GETs) while every participant write (post, edit, reaction,
/// follow, media) is refused by the lifecycle gate with <c>403</c> and persists nothing. <c>build</c> and
/// <c>archived</c> stay fully closed: every GET is <c>403</c>. A COR-015 shared read-only session behaves the same.
/// </summary>
/// <remarks>
/// The real composition root is used (rather than the slice host) because only it maps EVERY participant route —
/// pins, follows, suggestions, reactions, edits and media live in other slices. Sessions are real seeded rows and
/// real bearer tokens; the exercise is resolved from its provisioned host by the real resolution middleware.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class EndedReadOnlyReviewGatingTests
{
    private readonly MsSqlContainerFixture _fixture;

    public EndedReadOnlyReviewGatingTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>The two session kinds a participant-world caller holds.</summary>
    public static TheoryData<string> CallerKinds => new() { "participant", "readonly" };

    [RequiresDockerTheory]
    [MemberData(nameof(CallerKinds))]
    public async Task InCompleted_EveryGatedParticipantGet_IsServed(string kind)
    {
        var world = await EndedReviewWorld.SeedAsync(_fixture, "completed");
        await using var host = new PauseTestHost(ConnectionString);
        using var client = host.CreateClientFor(world.Host, world.TokenFor(kind));

        using (new AssertionScope())
        {
            foreach (var route in world.GatedGetRoutes)
            {
                using var response = await client.GetAsync(new Uri(route, UriKind.Relative));
                response.StatusCode.Should().Be(
                    HttpStatusCode.OK,
                    "GET {0} is a participant READ, and a completed exercise is the ended, read-only review ({1} session); body: {2}",
                    route,
                    kind,
                    await response.Content.ReadAsStringAsync());
            }
        }

        using var feed = await client.GetAsync(new Uri("/api/feed", UriKind.Relative));
        (await feed.Content.ReadAsStringAsync()).Should().Contain(
            EndedReviewWorld.TargetPostBody, "the review serves the run's real content");
    }

    [RequiresDockerTheory]
    [MemberData(nameof(CallerKinds))]
    public async Task InCompleted_EveryParticipantWrite_Is403FromTheGate_AndPersistsNothing(string kind)
    {
        var world = await EndedReviewWorld.SeedAsync(_fixture, "completed");
        await using var host = new PauseTestHost(ConnectionString);
        using var client = host.CreateClientFor(world.Host, world.TokenFor(kind));

        using (new AssertionScope())
        {
            foreach (var write in world.ParticipantWrites())
            {
                using var request = write.Build();
                using var response = await client.SendAsync(request);
                response.StatusCode.Should().Be(
                    HttpStatusCode.Forbidden,
                    "{0} is a write, and every write is refused once the exercise has ended ({1} session)",
                    write.Name,
                    kind);
            }
        }

        await AssertNothingWrittenAsync(world);
        host.Broadcaster.Posts.Should().BeEmpty();
        host.Broadcaster.Engagement.Should().BeEmpty();
    }

    /// <summary>
    /// The control that makes the 403s above the LIFECYCLE gate's: the identical participant writes in a <c>live</c>
    /// world are not refused with 403 (each reaches its handler and answers on its own terms).
    /// </summary>
    [RequiresDockerFact]
    public async Task InLive_TheSameParticipantWrites_AreNot403()
    {
        var world = await EndedReviewWorld.SeedAsync(_fixture, "live");
        await using var host = new PauseTestHost(ConnectionString);
        using var client = host.CreateClientFor(world.Host, world.ParticipantToken);

        using (new AssertionScope())
        {
            foreach (var write in world.ParticipantWrites())
            {
                using var request = write.Build();
                using var response = await client.SendAsync(request);
                response.StatusCode.Should().NotBe(
                    HttpStatusCode.Forbidden,
                    "{0} is a legitimate participant write in a live exercise; body: {1}",
                    write.Name,
                    await response.Content.ReadAsStringAsync());
            }
        }
    }

    /// <summary>The states that stay fully closed (verb-blind), crossed with the two caller kinds.</summary>
    public static TheoryData<string, string> ClosedStatesByCallerKind => new()
    {
        { "build", "participant" },
        { "build", "readonly" },
        { "archived", "participant" },
        { "archived", "readonly" },
    };

    [RequiresDockerTheory]
    [MemberData(nameof(ClosedStatesByCallerKind))]
    public async Task InBuildOrArchived_EveryGatedParticipantGet_IsStill403(string state, string kind)
    {
        var world = await EndedReviewWorld.SeedAsync(_fixture, state);
        await using var host = new PauseTestHost(ConnectionString);
        using var client = host.CreateClientFor(world.Host, world.TokenFor(kind));

        using (new AssertionScope())
        {
            foreach (var route in world.GatedGetRoutes)
            {
                using var response = await client.GetAsync(new Uri(route, UriKind.Relative));
                response.StatusCode.Should().Be(
                    HttpStatusCode.Forbidden, "'{0}' serves no participant reads: GET {1} ({2} session)", state, route, kind);
                (await response.Content.ReadAsStringAsync()).Should().NotContain(EndedReviewWorld.TargetPostBody);
            }
        }
    }

    private string ConnectionString => _fixture.ConnectionString
        ?? throw new InvalidOperationException("The MsSql fixture has no connection string.");

    private async Task AssertNothingWrittenAsync(EndedReviewWorld world)
    {
        await using var db = _fixture.CreateContext();
        (await db.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == world.Exercise))
            .Should().Be(2, "only the two seeded posts exist: every refused write persisted nothing");
        (await db.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == world.ParticipantPost)).EditCount
            .Should().Be(0, "the refused edit changed nothing");
        (await db.PostReactions.IgnoreQueryFilters().CountAsync(r => r.ExerciseId == world.Exercise)).Should().Be(0);
        (await db.Follows.IgnoreQueryFilters().CountAsync(f => f.ExerciseId == world.Exercise)).Should().Be(0);
    }
}

/// <summary>
/// One seeded exercise for the ended-review suites: a participant bound to a persona, a second persona, a post by
/// each, a participant session and a shared read-only session, all on a provisioned host so the REAL resolution and
/// session middleware decide the scope.
/// </summary>
public sealed class EndedReviewWorld
{
    /// <summary>The seeded target post's body (asserted present on a served read, absent on a refused one).</summary>
    public const string TargetPostBody = "THE ENDED RUN'S CONTENT";

    private static readonly DateTimeOffset StoredScenarioTime = new(2033, 9, 4, 9, 30, 0, TimeSpan.Zero);

    /// <summary>The exercise.</summary>
    public required Guid Exercise { get; init; }

    /// <summary>The provisioned hostname that resolves to <see cref="Exercise"/>.</summary>
    public required string Host { get; init; }

    /// <summary>The participant's own persona.</summary>
    public required Guid ParticipantPersona { get; init; }

    /// <summary>A second persona (follow target, author of the target post).</summary>
    public required Guid OtherPersona { get; init; }

    /// <summary>A post by <see cref="OtherPersona"/> (thread / reaction target).</summary>
    public required Guid TargetPost { get; init; }

    /// <summary>A post by the participant's persona, freshly created (edit target, inside the edit window).</summary>
    public required Guid ParticipantPost { get; init; }

    /// <summary>The participant session's raw bearer token.</summary>
    public required string ParticipantToken { get; init; }

    /// <summary>The shared read-only (<c>readonly</c>-kind) session's raw bearer token.</summary>
    public required string ReadOnlyToken { get; init; }

    /// <summary>
    /// Every gated participant GET (implementation-wide): the social reads and all six shell GETs.
    /// </summary>
    public IReadOnlyList<string> GatedGetRoutes =>
    [
        "/api/feed",
        "/api/feed/pinned",
        $"/api/threads/{TargetPost}",
        "/api/personas",
        $"/api/personas/{OtherPersona}/followers",
        $"/api/personas/{OtherPersona}/following",
        "/api/personas/suggestions",
        $"/api/posts/{TargetPost}/edits",
        "/api/shell-state",
        "/api/chrome-config",
        "/api/brand-tokens",
        "/api/channel-nav-config",
        "/api/alerts",
        "/api/overlay-state",
    ];

    /// <summary>The token for a caller kind (<c>participant</c> or <c>readonly</c>).</summary>
    /// <param name="kind">The session kind.</param>
    /// <returns>The raw bearer token.</returns>
    public string TokenFor(string kind) => kind == "readonly" ? ReadOnlyToken : ParticipantToken;

    /// <summary>Every participant write route, as request factories (a request message can be sent only once).</summary>
    /// <returns>The writes.</returns>
    public IReadOnlyList<WriteProbe> ParticipantWrites() =>
    [
        new("POST /api/posts", () => JsonRequest(HttpMethod.Post, "/api/posts", new Dictionary<string, object?>
        {
            ["authorPersonaId"] = ParticipantPersona.ToString(),
            ["text"] = "Posted after EndEx",
            ["scenarioTime"] = "2033-09-04T09:30:00Z",
            ["timeZone"] = "UTC",
            ["origin"] = "participant",
        })),
        new("PATCH /api/posts/{id}", () => JsonRequest(
            HttpMethod.Patch, $"/api/posts/{ParticipantPost}", new Dictionary<string, object?> { ["text"] = "Edited after EndEx" })),
        new("PUT /api/posts/{id}/reactions/like", () => new HttpRequestMessage(
            HttpMethod.Put, new Uri($"/api/posts/{TargetPost}/reactions/like", UriKind.Relative))),
        new("DELETE /api/posts/{id}/reactions/like", () => new HttpRequestMessage(
            HttpMethod.Delete, new Uri($"/api/posts/{TargetPost}/reactions/like", UriKind.Relative))),
        new("POST /api/personas/{id}/follow", () => new HttpRequestMessage(
            HttpMethod.Post, new Uri($"/api/personas/{OtherPersona}/follow", UriKind.Relative))),
        new("DELETE /api/personas/{id}/follow", () => new HttpRequestMessage(
            HttpMethod.Delete, new Uri($"/api/personas/{OtherPersona}/follow", UriKind.Relative))),
        new("POST /api/media", MediaUpload),
    ];

    /// <summary>Seeds a fresh world in <paramref name="status"/>.</summary>
    /// <param name="fixture">The shared database.</param>
    /// <param name="status">The exercise lifecycle literal.</param>
    /// <returns>The seeded world.</returns>
    public static async Task<EndedReviewWorld> SeedAsync(MsSqlContainerFixture fixture, string status)
    {
        ArgumentNullException.ThrowIfNull(fixture);

        var exerciseId = Guid.NewGuid();
        var world = new EndedReviewWorld
        {
            Exercise = exerciseId,
            Host = $"ended-{exerciseId:N}.example.com",
            ParticipantPersona = Guid.NewGuid(),
            OtherPersona = Guid.NewGuid(),
            TargetPost = Guid.NewGuid(),
            ParticipantPost = Guid.NewGuid(),
            ParticipantToken = $"participant-{Guid.NewGuid():N}",
            ReadOnlyToken = $"readonly-{Guid.NewGuid():N}",
        };

        await using var seed = fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = $"Exercise {exerciseId:N}",
            Hostname = world.Host,
            TimeZone = "UTC",
            Status = status,
            CurrentScenarioTime = StoredScenarioTime,
        });
        seed.Personas.Add(NewPersona(world.ParticipantPersona, exerciseId));
        seed.Personas.Add(NewPersona(world.OtherPersona, exerciseId));
        seed.Posts.Add(NewPost(world.TargetPost, exerciseId, world.OtherPersona, TargetPostBody, "controller-as-persona"));
        seed.Posts.Add(NewPost(world.ParticipantPost, exerciseId, world.ParticipantPersona, "My own post", "participant"));
        seed.Sessions.Add(TestSessions.NewSession(world.ParticipantToken, exerciseId, world.ParticipantPersona));
        seed.Sessions.Add(TestSessions.NewSession(
            world.ReadOnlyToken, exerciseId, personaId: null, kind: "readonly", isReadOnly: true));
        await seed.SaveChangesAsync();

        return world;
    }

    private static HttpRequestMessage JsonRequest(HttpMethod method, string route, object body) =>
        new(method, new Uri(route, UriKind.Relative))
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };

    private static HttpRequestMessage MediaUpload()
    {
        var form = new MultipartFormDataContent();
        var file = new ByteArrayContent([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");
        form.Add(file, "file", "after-endex.png");
        return new HttpRequestMessage(HttpMethod.Post, new Uri("/api/media", UriKind.Relative)) { Content = form };
    }

    private static Persona NewPersona(Guid id, Guid exerciseId) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        DisplayName = $"Persona {id:N}",
        Handle = $"p_{id:N}",
        Kind = "human",
    };

    private static Post NewPost(Guid id, Guid exerciseId, Guid author, string body, string origin) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        AuthorPersonaId = author,
        Body = body,
        CreatedScenarioTime = StoredScenarioTime,
        CreatedWallClock = DateTimeOffset.UtcNow,
        Origin = origin,
        ActingHumanId = "seed",
    };
}

/// <summary>One named participant write, built fresh per send.</summary>
/// <param name="Name">The route, for assertion messages.</param>
/// <param name="Build">Builds the request.</param>
public sealed record WriteProbe(string Name, Func<HttpRequestMessage> Build);
