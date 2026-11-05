namespace Pulse.WebApi.Tests.Features.Channels.Read;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Social.Moderation;

/// <summary>
/// The REAL <c>Program</c> host over the fixture database for the story 06 read API. Only two edges are doubled: a
/// deterministic, host-relative media URL signer (so a test can assert the signed URL without blob storage) and one
/// test content kind per channel (replacing the shipped ones) whose <c>ProjectPayload</c> drops a staff-only key.
/// </summary>
internal sealed class ContentReadFactory : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

    public ContentReadFactory(string connectionString) =>
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);

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
            services.RemoveAll<IMediaUrlSigner>();
            services.AddSingleton<IMediaUrlSigner, PathMediaUrlSigner>();

            // The shipped kinds (weather's ForecastDescriptor, ...) are replaced by one test kind per channel, so the payload
            // projection under test is this file's, whatever kinds main has registered.
            services.RemoveAll<IContentKindDescriptor>();
            foreach (var channel in ChannelVocabulary.ContentChannelIds)
            {
                services.AddScoped<IContentKindDescriptor>(_ => new StaffKeyDroppingKind(ContentReadSeeder.KindFor(channel), channel));
            }
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
    }
}

/// <summary>Signs a media read URL as the host-relative <c>/media-test/{id}</c>.</summary>
internal sealed class PathMediaUrlSigner : IMediaUrlSigner
{
    public static string UrlFor(Guid assetId) => $"/media-test/{assetId:N}";

    public Task<string> GetReadUrlAsync(MediaAsset asset, CancellationToken cancellationToken) =>
        Task.FromResult(UrlFor(asset.Id));

    public Task<IReadOnlyDictionary<Guid, string>> GetReadUrlsAsync(
        IReadOnlyCollection<MediaAsset> assets, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyDictionary<Guid, string>>(assets.ToDictionary(asset => asset.Id, asset => UrlFor(asset.Id)));
}

/// <summary>A test content kind whose participant projection drops <c>staffNote</c> (XC-002).</summary>
internal sealed class StaffKeyDroppingKind(string kind, string channelId) : IContentKindDescriptor
{
    public const string StaffKey = "staffNote";

    public string Kind { get; } = kind;

    public string ChannelId { get; } = channelId;

    public string BodyPolicy => ISanitizerProfileRegistry.Plain;

    public IReadOnlySet<string> AllowedMediaKinds { get; } = new HashSet<string> { "image", "video" };

    public PublishAlertOptions? DefaultAlertMapping => null;

    public Task<PayloadValidationResult> ValidatePayloadAsync(
        JsonObject payload, PayloadValidationContext context, CancellationToken cancellationToken = default) =>
        Task.FromResult(PayloadValidationResult.Valid);

    public JsonObject ProjectPayload(JsonObject payload)
    {
        var projected = (JsonObject)payload.DeepClone();
        projected.Remove(StaffKey);
        return projected;
    }
}

/// <summary>Seeds channel rows directly (bypassing the funnel), scoped to their exercise so the write guard admits them.</summary>
internal sealed class ContentReadSeeder
{
    /// <summary>The scenario instant the newest seeded item is published at.</summary>
    public static readonly DateTimeOffset BaseTime = new(2033, 9, 4, 13, 0, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;

    public ContentReadSeeder(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        Moderation = new ModerationSeeder(fixture);
    }

    public ModerationSeeder Moderation { get; }

    public string ConnectionString => Moderation.ConnectionString;

    /// <summary>The test kind of a channel.</summary>
    public static string KindFor(string channelId) => channelId switch
    {
        ChannelVocabulary.Press => ChannelVocabulary.KindRelease,
        ChannelVocabulary.Weather => ChannelVocabulary.KindForecast,
        _ => ChannelVocabulary.KindArticle,
    };

    /// <summary>An exercise with every content channel enabled, and a participant session on it.</summary>
    public async Task<(SeededExercise Exercise, string Token)> ExerciseAsync(string enabledChannels = "social,news,press,weather,portal")
    {
        var exercise = await Moderation.SeedExerciseAsync();
        await using (var write = _fixture.CreateContext())
        {
            var row = await write.Exercises.FindAsync(exercise.Id);
            row!.EnabledChannels = enabledChannels;
            await write.SaveChangesAsync();
        }

        return (exercise, await Moderation.SeedParticipantSessionAsync(exercise.Id));
    }

    public async Task SetEnabledChannelsAsync(Guid exerciseId, string enabledChannels)
    {
        await using var write = _fixture.CreateContext();
        var row = await write.Exercises.FindAsync(exerciseId);
        row!.EnabledChannels = enabledChannels;
        await write.SaveChangesAsync();
    }

    public async Task<Outlet> OutletAsync(
        Guid exerciseId,
        string channelId,
        string slug,
        bool enabled = true,
        bool deleted = false,
        Guid? parentOutletId = null,
        string? name = null)
    {
        var outlet = new Outlet
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            ChannelId = channelId,
            Slug = slug,
            Name = name ?? $"Outlet {slug}",
            SkinKey = "newsline7",
            ParentOutletId = parentOutletId,
            Enabled = enabled,
            SortOrder = 1,
            Version = 1,
            DeletedAt = deleted ? DateTimeOffset.UtcNow : null,
        };
        await using var write = Scoped(exerciseId);
        write.Outlets.Add(outlet);
        await write.SaveChangesAsync();
        return outlet;
    }

    /// <summary>Seeds one content item with every staff-only column set to a recognizable sentinel.</summary>
    public async Task<ContentItem> ItemAsync(
        Outlet outlet,
        string slug,
        string status = ChannelVocabulary.StatusPublished,
        DateTimeOffset? published = null,
        int? featuredRank = null,
        string? category = null,
        bool deleted = false,
        Action<ContentItem>? configure = null)
    {
        var at = published ?? BaseTime;
        var item = new ContentItem
        {
            Id = Guid.NewGuid(),
            ExerciseId = outlet.ExerciseId,
            ChannelId = outlet.ChannelId,
            Kind = KindFor(outlet.ChannelId),
            OutletId = outlet.Id,
            Slug = slug,
            Status = status,
            Headline = $"Headline {slug}",
            Dek = $"Dek {slug}",
            Category = category,
            BodyHtml = $"<p>Body {slug}</p>",
            PayloadJson = "{\"zone\":\"north\",\"staffNote\":\"SENTINEL-STAFF-NOTE\"}",
            Background = true,
            FeaturedRank = featuredRank,
            ScheduledScenarioTime = status == ChannelVocabulary.StatusScheduled ? at.AddHours(1) : null,
            PublishedScenarioTime = status is ChannelVocabulary.StatusPublished or ChannelVocabulary.StatusRetracted ? at : null,
            PublishedWallClock = status is ChannelVocabulary.StatusPublished or ChannelVocabulary.StatusRetracted
                ? new DateTimeOffset(2026, 11, 2, 9, 0, 0, TimeSpan.Zero)
                : null,
            RetractedScenarioTime = status == ChannelVocabulary.StatusRetracted ? at.AddMinutes(30) : null,
            CreatedScenarioTime = at.AddMinutes(-5),
            CreatedWallClock = new DateTimeOffset(2026, 11, 2, 8, 55, 0, TimeSpan.Zero),
            Origin = "inject",
            ActingHumanId = "SENTINEL-ACTING-HUMAN",
            InjectId = Guid.NewGuid(),
            ExternalSource = "cadence",
            ExternalRef = $"SENTINEL-EXTREF-{Guid.NewGuid():N}",
            PublishOptionsJson = "{\"pairedPost\":{\"text\":\"SENTINEL-OPTIONS\"}}",
            LastError = "SENTINEL-LAST-ERROR",
            RevisionCount = 0,
            Version = 7,
            DeletedAt = deleted ? DateTimeOffset.UtcNow : null,
        };
        configure?.Invoke(item);
        await using var write = Scoped(outlet.ExerciseId);
        write.ContentItems.Add(item);
        await write.SaveChangesAsync();
        return item;
    }

    public async Task RevisionAsync(ContentItem item, int number, string kind, bool visible, string? note = null)
    {
        await using var write = Scoped(item.ExerciseId);
        write.ContentItemRevisions.Add(new ContentItemRevision
        {
            Id = Guid.NewGuid(),
            ExerciseId = item.ExerciseId,
            ContentItemId = item.Id,
            Number = number,
            Kind = kind,
            Note = note,
            SnapshotJson = "{\"headline\":\"SENTINEL-OLD-HEADLINE\"}",
            ScenarioTime = BaseTime.AddMinutes(number),
            WallClock = DateTimeOffset.UtcNow,
            ActingHumanId = "SENTINEL-ACTING-HUMAN",
            Visible = visible,
        });
        await write.SaveChangesAsync();
    }

    public async Task<Guid> MediaAsync(ContentItem item, string role, int sortOrder, string alt, bool asHero = false)
    {
        var assetId = Guid.NewGuid();
        await using var write = Scoped(item.ExerciseId);
        write.MediaAssets.Add(new MediaAsset
        {
            Id = assetId,
            ExerciseId = item.ExerciseId,
            Kind = MediaKinds.Image,
            ContentType = "image/png",
            BlobName = $"{item.ExerciseId:N}/{assetId:N}",
            Bytes = 1024,
            Width = 400,
            Height = 300,
            OriginalFileName = "photo.png",
            UploadedByHumanId = "SENTINEL-ACTING-HUMAN",
            CreatedScenarioTime = BaseTime,
            CreatedWallClock = DateTimeOffset.UtcNow,
        });
        write.ContentItemMedia.Add(new ContentItemMedia
        {
            Id = Guid.NewGuid(),
            ExerciseId = item.ExerciseId,
            ContentItemId = item.Id,
            MediaAssetId = assetId,
            Role = role,
            SortOrder = sortOrder,
            Alt = alt,
        });
        if (asHero)
        {
            var row = await write.ContentItems.FindAsync(item.Id);
            row!.HeroMediaId = assetId;
        }

        await write.SaveChangesAsync();
        return assetId;
    }

    public async Task<int> TelemetryCountAsync(Guid exerciseId)
    {
        await using var read = Scoped(exerciseId);
        return read.TelemetryEvents.Count();
    }

    private PulseDbContext Scoped(Guid exerciseId) =>
        _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
}
