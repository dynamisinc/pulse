namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Engagement;
using Pulse.WebApi.Features.Social.Threads;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// Shared harness for the demo-polish BP suites (<c>PostMedia*Tests</c>): a real <c>Program</c> host on the shared
/// migrated SQL Server, driven with REAL sessions over a provisioned host name (so attribution, viewer state and
/// scope all resolve exactly as in production), with the four seams BP consumes swapped for test doubles.
/// </summary>
/// <remarks>
/// The doubles stand in for slices that build in parallel (BM's signer, B3's engagement reader, B2's resolver)
/// and for the SignalR fan-out. Each can be left as the registered fail-closed fallback instead, to prove the
/// branch runs alone.
/// </remarks>
public sealed class PostMediaWebApplicationFactory : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

    private readonly bool _keepFallbackSigner;
    private readonly bool _keepFallbackResolver;
    private readonly bool _throwingProjector;

    public PostMediaWebApplicationFactory(
        string connectionString, bool keepFallbackSigner = false, bool keepFallbackResolver = false, bool throwingProjector = false)
    {
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);
        _keepFallbackSigner = keepFallbackSigner;
        _keepFallbackResolver = keepFallbackResolver;
        _throwingProjector = throwingProjector;
    }

    /// <summary>Every <c>PostReceived</c> broadcast.</summary>
    public FakeFeedBroadcaster Broadcaster { get; } = new();

    /// <summary>Records every signer call.</summary>
    public SignerProbe Signer { get; } = new();

    /// <summary>The real engagement the fake reader reports.</summary>
    public FakePostEngagementReader Engagement { get; } = new();

    /// <summary>How the fake reply-parent resolver behaves.</summary>
    public ResolverProbe Resolver { get; } = new();

    /// <summary>A client addressing <paramref name="host"/> and presenting <paramref name="bearerToken"/>.</summary>
    public HttpClient CreateClientFor(string host, string? bearerToken)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri($"http://{host}") });
        if (bearerToken is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        return client;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IFeedBroadcaster>();
            services.AddSingleton<IFeedBroadcaster>(Broadcaster);

            services.RemoveAll<IPostEngagementReader>();
            services.AddSingleton<IPostEngagementReader>(Engagement);

            if (!_keepFallbackSigner)
            {
                services.RemoveAll<IMediaUrlSigner>();
                services.AddScoped<IMediaUrlSigner>(sp =>
                    new FakeMediaUrlSigner(sp.GetRequiredService<IExerciseContext>(), Signer));
            }

            if (!_keepFallbackResolver)
            {
                services.RemoveAll<IReplyParentResolver>();
                services.AddScoped<IReplyParentResolver>(sp =>
                    new FakeReplyParentResolver(sp.GetRequiredService<PulseDbContext>(), Resolver));
            }

            if (_throwingProjector)
            {
                services.RemoveAll<IParticipantPostProjector>();
                services.AddSingleton<IParticipantPostProjector>(new ThrowingProjector(new InvalidOperationException("projection exploded")));
            }
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
    }
}

/// <summary>A projector that always throws the given exception.</summary>
public sealed class ThrowingProjector : IParticipantPostProjector
{
    private readonly Exception _exception;

    public ThrowingProjector(Exception exception) => _exception = exception;

    public int Calls { get; private set; }

    public Task<IReadOnlyList<ParticipantPostDto>> ProjectAsync(
        IReadOnlyCollection<Post> posts, PostProjectionOptions options, CancellationToken cancellationToken)
    {
        Calls++;
        throw _exception;
    }
}

/// <summary>Wraps a real projector and counts how often the ingest funnel reaches it.</summary>
public sealed class CountingProjector : IParticipantPostProjector
{
    private readonly IParticipantPostProjector _inner;

    public CountingProjector(IParticipantPostProjector inner) => _inner = inner;

    public int Calls { get; private set; }

    public Task<IReadOnlyList<ParticipantPostDto>> ProjectAsync(
        IReadOnlyCollection<Post> posts, PostProjectionOptions options, CancellationToken cancellationToken)
    {
        Calls++;
        return _inner.ProjectAsync(posts, options, cancellationToken);
    }
}

/// <summary>A signer that mints nothing for the listed assets (the rest get the fake URL).</summary>
public sealed class OmittingMediaUrlSigner : IMediaUrlSigner
{
    private readonly HashSet<Guid> _omit;

    public OmittingMediaUrlSigner(params Guid[] omit) => _omit = [.. omit];

    public Task<string> GetReadUrlAsync(MediaAsset asset, CancellationToken cancellationToken) =>
        Task.FromResult(FakeMediaUrlSigner.UrlFor(asset.Id));

    public Task<IReadOnlyDictionary<Guid, string>> GetReadUrlsAsync(
        IReadOnlyCollection<MediaAsset> assets, CancellationToken cancellationToken)
    {
        IReadOnlyDictionary<Guid, string> urls = assets
            .Where(asset => !_omit.Contains(asset.Id))
            .ToDictionary(asset => asset.Id, asset => FakeMediaUrlSigner.UrlFor(asset.Id));
        return Task.FromResult(urls);
    }
}

/// <summary>Captures log entries (level, event id, rendered message) for assertions.</summary>
public sealed class CapturingLogger<T> : ILogger<T>
{
    public ConcurrentQueue<(LogLevel Level, EventId EventId, string Message, Exception? Exception)> Entries { get; } = new();

    public IDisposable? BeginScope<TState>(TState state)
        where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(
        LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
        Entries.Enqueue((logLevel, eventId, formatter(state, exception), exception));
}

/// <summary>Counts signer calls and the assets each one received.</summary>
public sealed class SignerProbe
{
    public ConcurrentQueue<IReadOnlyList<Guid>> Calls { get; } = new();
}

/// <summary>
/// A deterministic stand-in for BM's signer that honours the frozen contract: it THROWS when asked to sign an
/// asset outside the request's exercise, and every URL minted for one asset is byte-identical (one bucket).
/// </summary>
public sealed class FakeMediaUrlSigner : IMediaUrlSigner
{
    private readonly IExerciseContext _exerciseContext;
    private readonly SignerProbe _probe;

    public FakeMediaUrlSigner(IExerciseContext exerciseContext, SignerProbe probe)
    {
        _exerciseContext = exerciseContext;
        _probe = probe;
    }

    public static string UrlFor(Guid assetId) => $"https://media.test/post-media/{assetId:N}?sig=bucket-0";

    public Task<string> GetReadUrlAsync(MediaAsset asset, CancellationToken cancellationToken)
    {
        Guard(asset);
        _probe.Calls.Enqueue([asset.Id]);
        return Task.FromResult(UrlFor(asset.Id));
    }

    public Task<IReadOnlyDictionary<Guid, string>> GetReadUrlsAsync(
        IReadOnlyCollection<MediaAsset> assets, CancellationToken cancellationToken)
    {
        foreach (var asset in assets)
        {
            Guard(asset);
        }

        _probe.Calls.Enqueue(assets.Select(asset => asset.Id).ToArray());
        IReadOnlyDictionary<Guid, string> urls = assets.ToDictionary(asset => asset.Id, asset => UrlFor(asset.Id));
        return Task.FromResult(urls);
    }

    private void Guard(MediaAsset asset)
    {
        if (asset.ExerciseId != _exerciseContext.CurrentExerciseId)
        {
            throw new ExerciseScopeViolationException("test signer: asset outside the current exercise scope");
        }
    }
}

/// <summary>Configurable REAL engagement, as B3's reader would report it; records the viewer each read asked for.</summary>
public sealed class FakePostEngagementReader : IPostEngagementReader
{
    private readonly ConcurrentDictionary<Guid, (int Like, int Repost, int Reply, Guid? LikedBy, Guid? RepostedBy)> _real = new();

    public ConcurrentQueue<Guid?> ViewerRequests { get; } = new();

    public void Set(Guid postId, int like, int repost, int reply, Guid? likedBy = null, Guid? repostedBy = null) =>
        _real[postId] = (like, repost, reply, likedBy, repostedBy);

    public Task<IReadOnlyDictionary<Guid, PostEngagement>> GetAsync(
        IReadOnlyCollection<Guid> postIds, Guid? viewerPersonaId, CancellationToken cancellationToken)
    {
        ViewerRequests.Enqueue(viewerPersonaId);

        IReadOnlyDictionary<Guid, PostEngagement> result = postIds
            .Where(_real.ContainsKey)
            .ToDictionary(
                id => id,
                id =>
                {
                    var real = _real[id];
                    return new PostEngagement(
                        real.Like,
                        real.Repost,
                        real.Reply,
                        ViewerLiked: viewerPersonaId is not null && real.LikedBy == viewerPersonaId,
                        ViewerReposted: viewerPersonaId is not null && real.RepostedBy == viewerPersonaId);
                });
        return Task.FromResult(result);
    }
}

/// <summary>Switches the fake resolver between B2's contract and a deliberately broken, scope-blind one.</summary>
public sealed class ResolverProbe
{
    /// <summary>When set, the resolver IGNORES the exercise filter — to prove BP's own defense in depth.</summary>
    public bool ScopeBlind { get; set; }
}

/// <summary>
/// A stand-in for B2's resolver: an unparseable, unknown, other-exercise or soft-deleted id is NotFound. In
/// <see cref="ResolverProbe.ScopeBlind"/> mode it resolves ANY existing post, in any exercise, deleted or not.
/// </summary>
public sealed class FakeReplyParentResolver : IReplyParentResolver
{
    private readonly PulseDbContext _dbContext;
    private readonly ResolverProbe _probe;

    public FakeReplyParentResolver(PulseDbContext dbContext, ResolverProbe probe)
    {
        _dbContext = dbContext;
        _probe = probe;
    }

    public async Task<ReplyParentResult> ResolveAsync(string? parentPostId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(parentPostId))
        {
            return new ReplyParentResult(ReplyParentOutcome.None, null);
        }

        if (!Guid.TryParse(parentPostId, out var id))
        {
            return new ReplyParentResult(ReplyParentOutcome.NotFound, null);
        }

        var parent = _probe.ScopeBlind
            ? await _dbContext.Posts.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, cancellationToken)
            : await _dbContext.Posts.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id && p.DeletedAt == null, cancellationToken);

        return parent is null
            ? new ReplyParentResult(ReplyParentOutcome.NotFound, null)
            : new ReplyParentResult(ReplyParentOutcome.Resolved, parent);
    }
}

/// <summary>One seeded exercise: host, personas, live sessions, and the humans behind them.</summary>
public sealed class MediaWorld
{
    public required Guid Exercise { get; init; }

    public required string Host { get; init; }

    public required Guid ParticipantPersona { get; init; }

    public required string ParticipantToken { get; init; }

    public required string ParticipantHuman { get; init; }

    /// <summary>A SECOND participant in the same exercise (another human, another persona).</summary>
    public required Guid OtherParticipantPersona { get; init; }

    public required string OtherParticipantToken { get; init; }

    public required string OtherParticipantHuman { get; init; }

    /// <summary>A persona only the staff console operates.</summary>
    public required Guid StaffPersona { get; init; }

    public required string StaffToken { get; init; }

    public required Guid StaffUserId { get; init; }

    /// <summary>A staff session that ALSO carries a persona binding (E7) — still staff, so never gets viewer state.</summary>
    public required string StaffWithPersonaToken { get; init; }
}

/// <summary>Seeding and HTTP helpers shared by the BP suites. Every row is written with fresh ids, never truncated.</summary>
public static class PostMediaSeed
{
    public static readonly Uri PostsUri = new("/api/posts", UriKind.Relative);

    public static readonly DateTimeOffset BaseScenarioTime = new(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5));

    public static async Task<MediaWorld> SeedWorldAsync(MsSqlContainerFixture fixture)
    {
        var exerciseId = Guid.NewGuid();
        var participantPersona = Guid.NewGuid();
        var otherParticipantPersona = Guid.NewGuid();
        var staffPersona = Guid.NewGuid();
        var participantToken = $"participant-{Guid.NewGuid():N}";
        var otherParticipantToken = $"participant-{Guid.NewGuid():N}";
        var staffToken = $"staff-{Guid.NewGuid():N}";
        var staffWithPersonaToken = $"staff-persona-{Guid.NewGuid():N}";
        var staffUserId = Guid.NewGuid();

        var participantSession = TestSessions.NewSession(participantToken, exerciseId, participantPersona);
        var otherParticipantSession = TestSessions.NewSession(otherParticipantToken, exerciseId, otherParticipantPersona);
        var staffSession = TestSessions.NewSession(staffToken, exerciseId, personaId: null, kind: "staff");
        staffSession.StaffUserId = staffUserId;
        var staffWithPersonaSession = TestSessions.NewSession(staffWithPersonaToken, exerciseId, staffPersona, kind: "staff");
        staffWithPersonaSession.StaffUserId = Guid.NewGuid();

        var host = $"postmedia-{exerciseId:N}.example.com";

        await using var seed = fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = $"Exercise {exerciseId:N}",
            Hostname = host,
            TimeZone = "America/Chicago",
            Status = "active",
        });
        seed.Personas.Add(NewPersona(participantPersona, exerciseId));
        seed.Personas.Add(NewPersona(otherParticipantPersona, exerciseId));
        seed.Personas.Add(NewPersona(staffPersona, exerciseId));
        seed.Sessions.AddRange(participantSession, otherParticipantSession, staffSession, staffWithPersonaSession);
        await seed.SaveChangesAsync();

        return new MediaWorld
        {
            Exercise = exerciseId,
            Host = host,
            ParticipantPersona = participantPersona,
            ParticipantToken = participantToken,
            ParticipantHuman = participantSession.ActingHumanId,
            OtherParticipantPersona = otherParticipantPersona,
            OtherParticipantToken = otherParticipantToken,
            OtherParticipantHuman = otherParticipantSession.ActingHumanId,
            StaffPersona = staffPersona,
            StaffToken = staffToken,
            StaffUserId = staffUserId,
            StaffWithPersonaToken = staffWithPersonaToken,
        };
    }

    public static Persona NewPersona(Guid id, Guid exerciseId) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        DisplayName = $"Persona {id:N}",
        Handle = $"p_{id:N}",
        Kind = "human",
        Verified = false,
    };

    /// <summary>Seeds one asset. Its storage/uploader columns carry distinctive values a payload walk can hunt for.</summary>
    public static async Task<MediaAsset> SeedAssetAsync(
        MsSqlContainerFixture fixture, Guid exerciseId, string kind, string uploadedBy, Guid? posterId = null)
    {
        var id = Guid.NewGuid();
        var asset = new MediaAsset
        {
            Id = id,
            ExerciseId = exerciseId,
            Kind = kind,
            ContentType = kind == MediaKinds.Video ? "video/mp4" : "image/jpeg",
            BlobName = $"{exerciseId:D}/{id:N}.{(kind == MediaKinds.Video ? "mp4" : "jpg")}",
            Bytes = 4242,
            Width = 1280,
            Height = 720,
            DurationSec = kind == MediaKinds.Video ? 12.5 : null,
            OriginalFileName = $"secret-original-{id:N}.bin",
            UploadedByHumanId = uploadedBy,
            CreatedScenarioTime = BaseScenarioTime,
            CreatedWallClock = DateTimeOffset.UtcNow,
            PosterMediaAssetId = posterId,
        };

        await using var seed = fixture.CreateContext();
        seed.MediaAssets.Add(asset);
        await seed.SaveChangesAsync();
        return asset;
    }

    /// <summary>Seeds one post directly (bypassing the ingest funnel).</summary>
    public static async Task<Post> SeedPostAsync(
        MsSqlContainerFixture fixture,
        Guid exerciseId,
        Guid authorPersonaId,
        DateTimeOffset scenarioTime,
        Guid? parentPostId = null,
        DateTimeOffset? deletedAt = null,
        (int Like, int Repost, int Reply) baseline = default,
        DateTimeOffset? wallClock = null,
        string body = "seeded post")
    {
        var post = new Post
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            AuthorPersonaId = authorPersonaId,
            Body = body,
            CreatedScenarioTime = scenarioTime,
            Origin = "controller-as-persona",
            ActingHumanId = "human-should-never-appear",
            CreatedWallClock = wallClock ?? DateTimeOffset.UtcNow,
            InjectId = "inject-should-never-appear",
            ParentPostId = parentPostId,
            DeletedAt = deletedAt,
            BaselineLikeCount = baseline.Like,
            BaselineRepostCount = baseline.Repost,
            BaselineReplyCount = baseline.Reply,
        };

        await using var seed = fixture.CreateContext();
        seed.Posts.Add(post);
        await seed.SaveChangesAsync();
        return post;
    }

    /// <summary>Seeds one media item directly (bypassing the funnel's checks — used to stage DP-16 hazards).</summary>
    public static async Task SeedMediaItemAsync(
        MsSqlContainerFixture fixture, Guid exerciseId, Guid postId, Guid assetId, int order, string alt = "seeded alt", Guid? posterId = null)
    {
        await using var seed = fixture.CreateContext();
        seed.PostMediaItems.Add(new PostMediaItem
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            PostId = postId,
            MediaAssetId = assetId,
            PosterMediaAssetId = posterId,
            Alt = alt,
            Order = order,
        });
        await seed.SaveChangesAsync();
    }

    /// <summary>A valid create-post body. The staff console must name its persona and claim its origin.</summary>
    public static Dictionary<string, object?> Body(
        string text = "Water over Main St",
        Guid? authorPersonaId = null,
        string? origin = null,
        object? media = null,
        string? parentPostId = null,
        object? engagementBaseline = null)
    {
        var body = new Dictionary<string, object?>
        {
            ["text"] = text,
            ["scenarioTime"] = "2033-06-14T09:00:00-05:00",
            ["timeZone"] = "America/Chicago",
        };

        if (authorPersonaId is { } author)
        {
            body["authorPersonaId"] = author.ToString();
        }

        if (origin is not null)
        {
            body["origin"] = origin;
        }

        if (media is not null)
        {
            body["media"] = media;
        }

        if (parentPostId is not null)
        {
            body["parentPostId"] = parentPostId;
        }

        if (engagementBaseline is not null)
        {
            body["engagementBaseline"] = engagementBaseline;
        }

        return body;
    }

    /// <summary>A staff <c>controller-as-persona</c> body for the world's staff persona.</summary>
    public static Dictionary<string, object?> StaffBody(
        MediaWorld world, string text = "Official update", object? media = null, string? parentPostId = null, object? engagementBaseline = null) =>
        Body(text, world.StaffPersona, "controller-as-persona", media, parentPostId, engagementBaseline);

    public static object Item(Guid mediaId, string? alt = "A flooded street", Guid? posterMediaId = null) =>
        posterMediaId is { } poster
            ? new { mediaId = mediaId.ToString(), alt, posterMediaId = poster.ToString() }
            : new { mediaId = mediaId.ToString(), alt };

    public static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    public static async Task<JsonDocument> ReadJsonAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync());

    /// <summary>
    /// Post-path rows written under an exercise (posts, media items, and the post/reply telemetry events that
    /// target a post), read past the filter so a scoped read cannot hide anything. Other events are excluded: the
    /// host's startup org-admin seed emits one against whichever exercise exists when the first host boots.
    /// </summary>
    public static async Task<(int Posts, int Items, int Events)> CountRowsAsync(MsSqlContainerFixture fixture, Guid exerciseId)
    {
        await using var read = fixture.CreateContext();
        return (
            await read.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == exerciseId),
            await read.PostMediaItems.IgnoreQueryFilters().CountAsync(i => i.ExerciseId == exerciseId),
            await read.TelemetryEvents.IgnoreQueryFilters().CountAsync(
                e => e.ExerciseId == exerciseId && e.Target != null && e.Target.EntityType == "post"));
    }

    /// <summary>Every JSON property name anywhere in <paramref name="element"/>, at any depth.</summary>
    public static IEnumerable<string> AllPropertyNames(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    yield return property.Name;
                    foreach (var nested in AllPropertyNames(property.Value))
                    {
                        yield return nested;
                    }
                }

                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    foreach (var nested in AllPropertyNames(item))
                    {
                        yield return nested;
                    }
                }

                break;
        }
    }
}
