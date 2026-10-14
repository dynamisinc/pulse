namespace Pulse.WebApi.Tests.Features.Social.Pins;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Pins;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Social.Moderation;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// An <see cref="IFeedBroadcaster"/> double that records every <c>PostPinChanged</c> push (and every
/// <c>PostReceived</c>), so a test can count them and check which exercise each one targeted.
/// </summary>
public sealed class RecordingPinBroadcaster : IFeedBroadcaster
{
    private readonly ConcurrentQueue<(Guid ExerciseId, Guid PostId, bool PinnedForAll)> _pinChanges = new();
    private readonly ConcurrentQueue<(Guid ExerciseId, ParticipantPostDto Post)> _received = new();

    /// <summary>Every <c>BroadcastPostPinChangedAsync</c> call, in order.</summary>
    public IReadOnlyList<(Guid ExerciseId, Guid PostId, bool PinnedForAll)> PinChanges => _pinChanges.ToArray();

    /// <summary>Every <c>BroadcastPostAsync</c> call, in order.</summary>
    public IReadOnlyList<(Guid ExerciseId, ParticipantPostDto Post)> Received => _received.ToArray();

    /// <inheritdoc />
    public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default)
    {
        _received.Enqueue((exerciseId, post));
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task BroadcastPostPinChangedAsync(
        Guid exerciseId, Guid postId, bool pinnedForAll, CancellationToken cancellationToken = default)
    {
        _pinChanges.Enqueue((exerciseId, postId, pinnedForAll));
        return Task.CompletedTask;
    }
}

/// <summary>An <see cref="IFeedBroadcaster"/> double whose <c>PostPinChanged</c> send always fails (a SignalR outage).</summary>
public sealed class ThrowingPinBroadcaster : IFeedBroadcaster
{
    /// <inheritdoc />
    public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <inheritdoc />
    public Task BroadcastPostPinChangedAsync(
        Guid exerciseId, Guid postId, bool pinnedForAll, CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException("Simulated SignalR failure while sending PostPinChanged.");
}

/// <summary>
/// The REAL <c>Program</c> host over the shared migrated database, for the pins suites. Identity is not faked: host
/// resolution, session authentication, the default-deny gate and both staff filters all run as in production, driven
/// by real persisted session tokens.
/// </summary>
/// <remarks>
/// <para>
/// <b>Seam S-2.</b> <c>Program.cs</c> is orchestrator-owned and gains <c>AddPostPins()</c> / <c>MapPostPins()</c> only
/// after this story merges. Until then this host adds both exactly as the orchestrator will: the services after
/// Program's own, and the routes onto the app's own endpoint route builder (so they run behind every Program
/// middleware). Once S-2 lands the routes are already mapped and this host does not map them again.
/// </para>
/// <para>
/// The <see cref="IFeedBroadcaster"/> is replaced with <see cref="RecordingPinBroadcaster"/> (or a caller-supplied
/// double) unless the caller asks for the real SignalR one. Every log entry is captured in <see cref="Logs"/>.
/// </para>
/// </remarks>
public sealed class PinsWebApplicationFactory : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

    private readonly IFeedBroadcaster? _broadcasterOverride;

    /// <summary>Points the host at <paramref name="connectionString"/>.</summary>
    /// <param name="connectionString">The fixture's migrated database.</param>
    /// <param name="broadcasterOverride">A double to use instead of <see cref="Broadcaster"/> (e.g. one that throws).</param>
    public PinsWebApplicationFactory(string connectionString, IFeedBroadcaster? broadcasterOverride = null)
    {
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);
        _broadcasterOverride = broadcasterOverride;
    }

    /// <summary>The recording double (unused when an override is supplied).</summary>
    public RecordingPinBroadcaster Broadcaster { get; } = new();

    /// <summary>Every log entry the host has written.</summary>
    public CapturingLoggerProvider Logs { get; } = new();

    /// <summary>A client whose base address sets the request host, presenting <paramref name="bearerToken"/> (or none).</summary>
    /// <param name="host">The request host (drives host → exercise resolution).</param>
    /// <param name="bearerToken">The raw session token, or <c>null</c> for an anonymous request.</param>
    /// <returns>The configured client.</returns>
    public HttpClient CreateClientFor(string host, string? bearerToken)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri($"http://{host}") });
        if (bearerToken is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        return client;
    }

    /// <inheritdoc />
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ConfigureLogging(logging => logging.AddProvider(Logs));
        builder.ConfigureTestServices(services =>
        {
            services.AddPostPins();
            services.AddSingleton<IStartupFilter>(new MapPostPinsStartupFilter());

            services.RemoveAll<IFeedBroadcaster>();
            services.AddSingleton<IFeedBroadcaster>(_broadcasterOverride ?? Broadcaster);
        });
    }

    /// <inheritdoc />
    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
    }

    /// <summary>
    /// Maps <see cref="PinEndpoints.MapPostPins"/> onto the app's own endpoint route builder after Program has built
    /// its pipeline, unless Program already maps them (seam S-2 landed).
    /// </summary>
    private sealed class MapPostPinsStartupFilter : IStartupFilter
    {
        private const string EndpointRouteBuilderKey = "__EndpointRouteBuilder";

        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            next(app);

            if (!app.Properties.TryGetValue(EndpointRouteBuilderKey, out var value)
                || value is not IEndpointRouteBuilder routes)
            {
                throw new InvalidOperationException("The Program host exposes no endpoint route builder to map the pin routes on.");
            }

            var alreadyMapped = routes.DataSources
                .SelectMany(source => source.Endpoints)
                .OfType<RouteEndpoint>()
                .Any(endpoint => string.Equals(endpoint.RoutePattern.RawText, PinEndpoints.PinnedFeedRoute, StringComparison.Ordinal));
            if (!alreadyMapped)
            {
                routes.MapPostPins();
            }
        };
    }
}

/// <summary>
/// Seeds and reads back the real rows the pins suites need (sessions via <see cref="ModerationSeeder"/>). Read-backs use
/// <c>IgnoreQueryFilters()</c>, so they see the physical rows whatever any scope would allow.
/// </summary>
public sealed class PinsSeeder
{
    /// <summary>The scenario instant seeded posts are created at by default.</summary>
    public static readonly DateTimeOffset PostCreatedAt = ModerationSeeder.PostCreatedAt;

    private readonly MsSqlContainerFixture _fixture;

    /// <summary>Creates the seeder over the shared fixture.</summary>
    /// <param name="fixture">The migrated-database fixture.</param>
    public PinsSeeder(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        Sessions = new ModerationSeeder(fixture);
    }

    /// <summary>The takedown suites' seeder: exercises, personas and every session kind.</summary>
    public ModerationSeeder Sessions { get; }

    /// <summary>The fixture's connection string.</summary>
    public string ConnectionString => Sessions.ConnectionString;

    /// <summary>Creates a host over the fixture.</summary>
    /// <param name="broadcasterOverride">An optional broadcaster double.</param>
    /// <returns>The host.</returns>
    public PinsWebApplicationFactory CreateHost(IFeedBroadcaster? broadcasterOverride = null) =>
        new(ConnectionString, broadcasterOverride);

    /// <summary>Seeds a post.</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="authorPersonaId">The author.</param>
    /// <param name="createdAt">Its scenario instant (default <see cref="PostCreatedAt"/>).</param>
    /// <param name="parentPostId">The parent, for a reply.</param>
    /// <param name="deletedAt">A takedown instant, or <c>null</c>.</param>
    /// <param name="pinnedForAllAt">An exercise pin instant, or <c>null</c>.</param>
    /// <param name="pinnedBy">Who set the exercise pin.</param>
    /// <param name="baselineLike">The seeded like baseline.</param>
    /// <returns>The post id.</returns>
    public async Task<Guid> SeedPostAsync(
        Guid exerciseId,
        Guid authorPersonaId,
        DateTimeOffset? createdAt = null,
        Guid? parentPostId = null,
        DateTimeOffset? deletedAt = null,
        DateTimeOffset? pinnedForAllAt = null,
        string? pinnedBy = null,
        int baselineLike = 0)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Posts.Add(new Post
        {
            Id = id,
            ExerciseId = exerciseId,
            AuthorPersonaId = authorPersonaId,
            Body = $"Pins fixture body {id:N}",
            CreatedScenarioTime = createdAt ?? PostCreatedAt,
            Origin = "controller-as-persona",
            ActingHumanId = "human-pins-test",
            CreatedWallClock = new DateTimeOffset(2026, 10, 14, 9, 0, 0, TimeSpan.Zero),
            ParentPostId = parentPostId,
            DeletedAt = deletedAt,
            PinnedForAllAt = pinnedForAllAt,
            PinnedForAllByHumanId = pinnedForAllAt is null ? null : pinnedBy ?? "staff-pins-test",
            BaselineLikeCount = baselineLike,
        });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds an ACTIVE (or soft-deleted) reaction.</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="postId">The post.</param>
    /// <param name="personaId">The reacting persona.</param>
    /// <param name="kind">The kind.</param>
    /// <param name="createdAt">The reaction's scenario instant.</param>
    /// <param name="deletedAt">A soft-delete instant, or <c>null</c>.</param>
    /// <returns>A task.</returns>
    public async Task SeedReactionAsync(
        Guid exerciseId, Guid postId, Guid personaId, string kind, DateTimeOffset createdAt, DateTimeOffset? deletedAt = null)
    {
        await using var seed = _fixture.CreateContext();
        seed.PostReactions.Add(new PostReaction
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            PostId = postId,
            PersonaId = personaId,
            Kind = kind,
            CreatedScenarioTime = createdAt,
            DeletedAt = deletedAt,
        });
        await seed.SaveChangesAsync();
    }

    /// <summary>Reads the physical post row (unfiltered).</summary>
    /// <param name="postId">The post id.</param>
    /// <returns>The row.</returns>
    public async Task<Post> ReadPostAsync(Guid postId)
    {
        await using var read = _fixture.CreateContext();
        return await read.Posts.IgnoreQueryFilters().AsNoTracking().SingleAsync(p => p.Id == postId);
    }

    /// <summary>Every reaction row on <paramref name="postId"/> (unfiltered).</summary>
    /// <param name="postId">The post id.</param>
    /// <returns>The rows.</returns>
    public async Task<IReadOnlyList<PostReaction>> ReadReactionsAsync(Guid postId)
    {
        await using var read = _fixture.CreateContext();
        return await read.PostReactions.IgnoreQueryFilters().AsNoTracking().Where(r => r.PostId == postId).ToListAsync();
    }

    /// <summary>Every telemetry event of the given types in <paramref name="exerciseId"/> (unfiltered), oldest first.</summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <param name="eventTypes">The event types.</param>
    /// <returns>The events.</returns>
    public async Task<IReadOnlyList<TelemetryEvent>> ReadEventsAsync(Guid exerciseId, params string[] eventTypes)
    {
        await using var read = _fixture.CreateContext();
        return await read.TelemetryEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(e => e.ExerciseId == exerciseId && eventTypes.Contains(e.EventType))
            .OrderBy(e => e.EmittedAt)
            .ToListAsync();
    }

    /// <summary>Parses a response body.</summary>
    /// <param name="response">The response.</param>
    /// <returns>The root element.</returns>
    public static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        ArgumentNullException.ThrowIfNull(response);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    /// <summary>The <c>(reason, post id)</c> pairs of a Pinned response, in order.</summary>
    /// <param name="pinned">The <c>GET /api/feed/pinned</c> body.</param>
    /// <returns>The pairs.</returns>
    public static IReadOnlyList<(string Reason, Guid PostId)> Items(JsonElement pinned) =>
        pinned.GetProperty("items")
            .EnumerateArray()
            .Select(item => (
                item.GetProperty("reason").GetString()!,
                Guid.Parse(item.GetProperty("post").GetProperty("id").GetString()!)))
            .ToArray();

    /// <summary>The staff pin route for a post.</summary>
    /// <param name="postId">The post id.</param>
    /// <returns>The relative URI.</returns>
    public static Uri StaffPinUri(Guid postId) => new($"/api/staff/posts/{postId}/pin", UriKind.Relative);

    /// <summary>The personal pin (reaction) route for a post.</summary>
    /// <param name="postId">The post id.</param>
    /// <returns>The relative URI.</returns>
    public static Uri PersonalPinUri(Guid postId) => new($"/api/posts/{postId}/reactions/pin", UriKind.Relative);

    /// <summary>The Pinned tab route.</summary>
    public static Uri PinnedFeedUri { get; } = new(PinEndpoints.PinnedFeedRoute, UriKind.Relative);

    /// <summary>A live participant session bound to <paramref name="personaId"/>; returns its token.</summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <param name="personaId">The persona.</param>
    /// <returns>The raw token.</returns>
    public Task<string> SeedParticipantAsync(Guid exerciseId, Guid personaId) =>
        Sessions.SeedParticipantSessionAsync(exerciseId, personaId);

    /// <summary>A live staff session with one assignment in <paramref name="exerciseId"/> as <paramref name="role"/>.</summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <param name="role">The role.</param>
    /// <returns>The raw token.</returns>
    public Task<string> SeedStaffAsync(Guid exerciseId, string role) =>
        Sessions.SeedStaffSessionAsync(exerciseId, [(exerciseId, role)]);

    /// <summary>A live session of any kind (via <see cref="TestSessions"/>); returns its token.</summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <param name="personaId">The persona binding, or <c>null</c>.</param>
    /// <param name="kind">The kind.</param>
    /// <param name="isReadOnly">Whether read-only.</param>
    /// <returns>The raw token.</returns>
    public async Task<string> SeedSessionAsync(Guid exerciseId, Guid? personaId, string kind, bool isReadOnly = false)
    {
        var token = $"pins-{kind}-{Guid.NewGuid():N}";
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(TestSessions.NewSession(token, exerciseId, personaId, kind, isReadOnly));
        await seed.SaveChangesAsync();
        return token;
    }
}
