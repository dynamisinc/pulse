namespace Pulse.WebApi.Tests.Features.Social.Moderation;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// An <see cref="IFeedBroadcaster"/> double that records every <c>PostRemoved</c> broadcast, so a test can count
/// them (idempotency: exactly one per takedown) and check which exercise each one targeted.
/// </summary>
public sealed class RecordingModerationBroadcaster : IFeedBroadcaster
{
    private readonly ConcurrentQueue<(Guid ExerciseId, Guid PostId)> _removed = new();

    /// <summary>Every <c>BroadcastPostRemovedAsync</c> call, in order.</summary>
    public IReadOnlyList<(Guid ExerciseId, Guid PostId)> Removed => _removed.ToArray();

    /// <inheritdoc />
    public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <inheritdoc />
    public Task BroadcastPostRemovedAsync(Guid exerciseId, Guid postId, CancellationToken cancellationToken = default)
    {
        _removed.Enqueue((exerciseId, postId));
        return Task.CompletedTask;
    }
}

/// <summary>
/// An <see cref="IFeedBroadcaster"/> double whose <c>PostRemoved</c> send always fails, standing in for a SignalR
/// outage after the takedown has committed (Gate-1 L-4).
/// </summary>
public sealed class ThrowingPostRemovedBroadcaster : IFeedBroadcaster
{
    /// <inheritdoc />
    public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <inheritdoc />
    public Task BroadcastPostRemovedAsync(Guid exerciseId, Guid postId, CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException("Simulated SignalR failure while sending PostRemoved.");
}

/// <summary>One captured log entry, with its structured properties.</summary>
/// <param name="Category">The logger category.</param>
/// <param name="Level">The log level.</param>
/// <param name="EventId">The event id.</param>
/// <param name="Message">The formatted message.</param>
/// <param name="Properties">The structured state (message-template values plus <c>{OriginalFormat}</c>).</param>
/// <param name="Exception">The exception, if any.</param>
public sealed record CapturedLog(
    string Category,
    LogLevel Level,
    EventId EventId,
    string Message,
    IReadOnlyDictionary<string, object?> Properties,
    Exception? Exception);

/// <summary>Captures every log entry the host writes, keeping the structured state, for log assertions.</summary>
public sealed class CapturingLoggerProvider : ILoggerProvider
{
    private readonly ConcurrentQueue<CapturedLog> _entries = new();

    /// <summary>Everything logged so far, in order.</summary>
    public IReadOnlyList<CapturedLog> Entries => _entries.ToArray();

    /// <inheritdoc />
    public ILogger CreateLogger(string categoryName) => new CapturingLogger(categoryName, _entries);

    /// <inheritdoc />
    public void Dispose()
    {
        // Nothing to release: the queue is owned by the test.
    }

    private sealed class CapturingLogger(string category, ConcurrentQueue<CapturedLog> entries) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            ArgumentNullException.ThrowIfNull(formatter);

            var properties = state is IEnumerable<KeyValuePair<string, object?>> pairs
                ? pairs.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal)
                : new Dictionary<string, object?>(StringComparer.Ordinal);

            entries.Enqueue(new CapturedLog(category, logLevel, eventId, formatter(state, exception), properties, exception));
        }
    }
}

/// <summary>
/// The REAL <c>Program</c> host over the shared migrated database, for the takedown suites. Identity is not faked:
/// host resolution, session authentication, organization resolution, the default-deny gate and both staff filters
/// all run as in production, driven by real persisted session tokens. The <see cref="IFeedBroadcaster"/> is
/// replaced with <see cref="RecordingModerationBroadcaster"/> (or a caller-supplied double) unless the caller asks
/// for the real SignalR one. Every log entry is captured in <see cref="Logs"/>.
/// </summary>
public sealed class ModerationWebApplicationFactory : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

    private readonly bool _useRealBroadcaster;
    private readonly IFeedBroadcaster? _broadcasterOverride;

    /// <summary>Points the host at <paramref name="connectionString"/>.</summary>
    /// <param name="connectionString">The fixture's migrated database.</param>
    /// <param name="useRealBroadcaster"><c>true</c> to keep Program.cs's <c>SignalRFeedBroadcaster</c> (over-the-wire tests).</param>
    /// <param name="broadcasterOverride">A double to use instead of <see cref="Broadcaster"/> (e.g. one that throws).</param>
    public ModerationWebApplicationFactory(
        string connectionString,
        bool useRealBroadcaster = false,
        IFeedBroadcaster? broadcasterOverride = null)
    {
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);
        _useRealBroadcaster = useRealBroadcaster;
        _broadcasterOverride = broadcasterOverride;
    }

    /// <summary>The recording double (unused when the real broadcaster or an override is used).</summary>
    public RecordingModerationBroadcaster Broadcaster { get; } = new();

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

        if (_useRealBroadcaster)
        {
            return;
        }

        builder.ConfigureTestServices(services =>
        {
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
}

/// <summary>A seeded exercise: its id and the provisioned host that resolves to it.</summary>
/// <param name="Id">The exercise id.</param>
/// <param name="Host">The exercise's provisioned hostname.</param>
public sealed record SeededExercise(Guid Id, string Host);

/// <summary>
/// Seeds and reads back the real rows the takedown suites need. Read-backs use <c>IgnoreQueryFilters()</c>, so
/// they see the physical row whatever any scope would allow.
/// </summary>
public sealed class ModerationSeeder
{
    /// <summary>The scenario instant every seeded post is created at.</summary>
    public static readonly DateTimeOffset PostCreatedAt = new(2033, 9, 4, 13, 0, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;

    /// <summary>Creates the seeder over the shared fixture.</summary>
    /// <param name="fixture">The migrated-database fixture.</param>
    public ModerationSeeder(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>The fixture's connection string (asserted non-null by the Docker gate).</summary>
    public string ConnectionString => _fixture.ConnectionString
        ?? throw new InvalidOperationException("The MsSql fixture has no connection string.");

    /// <summary>Seeds a live exercise with its own hostname.</summary>
    /// <param name="currentScenarioTime">The stored <c>Exercise.CurrentScenarioTime</c>, or <c>null</c>.</param>
    /// <returns>The seeded exercise.</returns>
    public async Task<SeededExercise> SeedExerciseAsync(DateTimeOffset? currentScenarioTime = null)
    {
        var id = Guid.NewGuid();
        var host = $"takedown-{id:N}.example.com";

        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = id,
            Name = $"Takedown {id:N}",
            Hostname = host,
            TimeZone = "UTC",
            Status = "live",
            CurrentScenarioTime = currentScenarioTime,
        });
        await seed.SaveChangesAsync();
        return new SeededExercise(id, host);
    }

    /// <summary>Seeds a persona in <paramref name="exerciseId"/>.</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <returns>The persona id.</returns>
    public async Task<Guid> SeedPersonaAsync(Guid exerciseId)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Personas.Add(new Persona
        {
            Id = id,
            ExerciseId = exerciseId,
            DisplayName = $"Persona {id:N}",
            Handle = $"p_{id:N}",
            Kind = "human",
            Verified = false,
        });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>
    /// Seeds a post (optionally already taken down, optionally with one attached image) and returns its id.
    /// </summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="authorPersonaId">The author, or a fresh id.</param>
    /// <param name="deletedAt">A pre-existing takedown instant, or <c>null</c> for a live post.</param>
    /// <param name="withMedia">Whether to attach one <see cref="MediaAsset"/> through a <see cref="PostMediaItem"/>.</param>
    /// <returns>The post id.</returns>
    public async Task<Guid> SeedPostAsync(
        Guid exerciseId,
        Guid? authorPersonaId = null,
        DateTimeOffset? deletedAt = null,
        bool withMedia = false)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Posts.Add(new Post
        {
            Id = id,
            ExerciseId = exerciseId,
            AuthorPersonaId = authorPersonaId ?? Guid.NewGuid(),
            Body = BodyOf(id),
            CreatedScenarioTime = PostCreatedAt,
            Origin = "controller-as-persona",
            ActingHumanId = "human-takedown-test",
            CreatedWallClock = new DateTimeOffset(2026, 10, 8, 9, 0, 0, TimeSpan.Zero),
            DeletedAt = deletedAt,
        });

        if (withMedia)
        {
            var mediaId = Guid.NewGuid();
            seed.MediaAssets.Add(new MediaAsset
            {
                Id = mediaId,
                ExerciseId = exerciseId,
                Kind = MediaKinds.Image,
                ContentType = "image/jpeg",
                BlobName = $"{exerciseId:D}/{mediaId:N}.jpg",
                Bytes = 4096,
                OriginalFileName = "street.jpg",
                UploadedByHumanId = "human-takedown-test",
                CreatedScenarioTime = PostCreatedAt,
                CreatedWallClock = new DateTimeOffset(2026, 10, 8, 9, 0, 0, TimeSpan.Zero),
            });
            seed.PostMediaItems.Add(new PostMediaItem
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                PostId = id,
                MediaAssetId = mediaId,
                Alt = "Flooded street",
                Order = 0,
            });
        }

        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds a follow edge in <paramref name="exerciseId"/>.</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="followerPersonaId">The follower.</param>
    /// <param name="followeePersonaId">The followee.</param>
    /// <returns>A task.</returns>
    public async Task SeedFollowAsync(Guid exerciseId, Guid followerPersonaId, Guid followeePersonaId)
    {
        await using var seed = _fixture.CreateContext();
        seed.Follows.Add(new Follow
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            FollowerPersonaId = followerPersonaId,
            FolloweePersonaId = followeePersonaId,
            CreatedScenarioTime = PostCreatedAt,
            CreatedWallClock = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
    }

    /// <summary>
    /// Seeds a live STAFF session active on <paramref name="activeExerciseId"/> for a fresh staff user (homed on the
    /// default organization) with the given assignments.
    /// </summary>
    /// <param name="activeExerciseId">The session's active exercise (the resolved scope for REST).</param>
    /// <param name="assignments">The staff user's (exercise, role) assignments.</param>
    /// <param name="configure">Optional tweak to the session row (e.g. expire it).</param>
    /// <returns>The raw bearer token.</returns>
    public async Task<string> SeedStaffSessionAsync(
        Guid activeExerciseId,
        IReadOnlyList<(Guid ExerciseId, string Role)> assignments,
        Action<Session>? configure = null) =>
        (await SeedStaffUserSessionAsync(activeExerciseId, assignments, configure)).Token;

    /// <summary>A live staff session assigned to <paramref name="exerciseId"/> as controller; also returns the staff user id.</summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <returns>The raw bearer token and the session's staff user id.</returns>
    public Task<(string Token, Guid StaffUserId)> SeedControllerWithIdAsync(Guid exerciseId) =>
        SeedStaffUserSessionAsync(exerciseId, [(exerciseId, "controller")], configure: null);

    private async Task<(string Token, Guid StaffUserId)> SeedStaffUserSessionAsync(
        Guid activeExerciseId,
        IReadOnlyList<(Guid ExerciseId, string Role)> assignments,
        Action<Session>? configure)
    {
        var token = $"takedown-staff-{Guid.NewGuid():N}";
        var staffUserId = Guid.NewGuid();
        var session = TestSessions.NewSession(token, activeExerciseId, kind: "staff");
        session.StaffUserId = staffUserId;
        session.PrincipalId = staffUserId.ToString();
        configure?.Invoke(session);

        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId));
        foreach (var (exerciseId, role) in assignments)
        {
            seed.StaffAssignments.Add(new StaffAssignment
            {
                Id = Guid.NewGuid(),
                StaffUserId = staffUserId,
                ExerciseId = exerciseId,
                Role = role,
                CreatedAt = DateTimeOffset.UtcNow,
            });
        }

        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
        return (token, staffUserId);
    }

    /// <summary>A live staff session assigned to <paramref name="exerciseId"/> as controller, active on it.</summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <returns>The raw bearer token.</returns>
    public Task<string> SeedControllerSessionAsync(Guid exerciseId) =>
        SeedStaffSessionAsync(exerciseId, [(exerciseId, "controller")]);

    /// <summary>Seeds a live PARTICIPANT session bound to <paramref name="exerciseId"/>.</summary>
    /// <param name="exerciseId">The exercise (the session is host-bound to it).</param>
    /// <param name="personaId">The session's persona, or <c>null</c>.</param>
    /// <returns>The raw bearer token.</returns>
    public async Task<string> SeedParticipantSessionAsync(Guid exerciseId, Guid? personaId = null)
    {
        var token = $"takedown-participant-{Guid.NewGuid():N}";
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(TestSessions.NewSession(token, exerciseId, personaId));
        await seed.SaveChangesAsync();
        return token;
    }

    /// <summary>Seeds a live SHARED READ-ONLY session bound to <paramref name="exerciseId"/>.</summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <returns>The raw bearer token.</returns>
    public async Task<string> SeedReadOnlySessionAsync(Guid exerciseId)
    {
        var token = $"takedown-readonly-{Guid.NewGuid():N}";
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(TestSessions.NewSession(token, exerciseId, kind: "readonly", isReadOnly: true));
        await seed.SaveChangesAsync();
        return token;
    }

    /// <summary>
    /// Reads the physical post row and asserts it still exists. A takedown is a soft delete and nothing is ever
    /// hard-deleted (XC-010), so a missing row is a failure in its own right.
    /// </summary>
    /// <param name="postId">The post id.</param>
    /// <returns>The row, untracked.</returns>
    public async Task<Post> ReadSurvivingPostAsync(Guid postId)
    {
        var row = await ReadPostAsync(postId);
        row.Should().NotBeNull("the post row must survive: a takedown is a SOFT delete and nothing is ever hard-deleted (XC-010)");
        return row!;
    }

    /// <summary>Reads the physical post row, ignoring every query filter, or <c>null</c> if it no longer exists.</summary>
    /// <param name="postId">The post id.</param>
    /// <returns>The row, untracked.</returns>
    public async Task<Post?> ReadPostAsync(Guid postId)
    {
        await using var read = _fixture.CreateContext();
        return await read.Posts.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(p => p.Id == postId);
    }

    /// <summary>Counts the physical media rows (items and their assets) attached to <paramref name="postId"/>.</summary>
    /// <param name="postId">The post id.</param>
    /// <returns>(PostMediaItem rows, MediaAsset rows they reference).</returns>
    public async Task<(int Items, int Assets)> CountMediaAsync(Guid postId)
    {
        await using var read = _fixture.CreateContext();
        var assetIds = await read.PostMediaItems.IgnoreQueryFilters()
            .Where(item => item.PostId == postId)
            .Select(item => item.MediaAssetId)
            .ToListAsync();
        var assets = await read.MediaAssets.IgnoreQueryFilters().CountAsync(asset => assetIds.Contains(asset.Id));
        return (assetIds.Count, assets);
    }

    /// <summary>Counts every telemetry row for <paramref name="exerciseId"/>, ignoring query filters.</summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <returns>The count.</returns>
    public async Task<int> CountTelemetryAsync(Guid exerciseId)
    {
        await using var read = _fixture.CreateContext();
        return await read.TelemetryEvents.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == exerciseId);
    }

    /// <summary>The body text a seeded post carries (unique per post, so a payload can be searched for it).</summary>
    /// <param name="postId">The post id.</param>
    /// <returns>The body.</returns>
    public static string BodyOf(Guid postId) => $"Takedown fixture body {postId:N}";
}
