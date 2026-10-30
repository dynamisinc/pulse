namespace Pulse.WebApi.Tests.Data;

using System;
using System.Threading.Tasks;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Valid rows for the channels-foundation/01 (M1) entities, shared by <see cref="ChannelsM1MigrationTests"/> and
/// <see cref="ChannelsIsolationTests"/>. Every builder takes the exercise explicitly, so a test always says which world a
/// row belongs to. Fictional values only.
/// </summary>
internal static class ChannelRows
{
    /// <summary>A fixed scenario instant (COR-053), well away from the wall clock.</summary>
    public static readonly DateTimeOffset ScenarioTime = new(2033, 9, 4, 13, 0, 0, TimeSpan.FromHours(-4));

    public static Outlet Outlet(Guid exerciseId, string slug = "newsline-7", string channelId = "news", Guid? parentOutletId = null) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        ChannelId = channelId,
        Slug = slug,
        Name = "Newsline 7",
        SkinKey = "newsline7",
        ParentOutletId = parentOutletId,
        Enabled = true,
    };

    public static ContentItem ContentItem(Guid exerciseId, Guid outletId, string slug = "emergency-call-delays") => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        ChannelId = "news",
        Kind = "article",
        OutletId = outletId,
        Slug = slug,
        Status = "draft",
        Headline = "Emergency call delays reported across Kestrel County",
        BodyHtml = "<p>Dispatchers report longer waits.</p>",
        CreatedScenarioTime = ScenarioTime,
        CreatedWallClock = DateTimeOffset.UtcNow,
        Origin = "controller",
        ActingHumanId = "human-1",
    };

    public static ContentItemRevision Revision(Guid exerciseId, Guid contentItemId, int number = 1) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        ContentItemId = contentItemId,
        Number = number,
        Kind = "update",
        ScenarioTime = ScenarioTime,
        WallClock = DateTimeOffset.UtcNow,
        ActingHumanId = "human-1",
        Visible = true,
    };

    public static ContentItemMedia Media(Guid exerciseId, Guid contentItemId, Guid mediaAssetId) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        ContentItemId = contentItemId,
        MediaAssetId = mediaAssetId,
        Role = "inline",
        Alt = "A dispatcher at a console",
    };

    public static MediaAsset MediaAsset(Guid exerciseId)
    {
        var id = Guid.NewGuid();
        return new MediaAsset
        {
            Id = id,
            ExerciseId = exerciseId,
            Kind = MediaKinds.Image,
            ContentType = "image/jpeg",
            BlobName = $"{exerciseId:N}/{id:N}.jpg",
            Bytes = 1024,
            OriginalFileName = "dispatch.jpg",
            UploadedByHumanId = "human-1",
            CreatedScenarioTime = ScenarioTime,
            CreatedWallClock = DateTimeOffset.UtcNow,
        };
    }

    public static ChannelAlert Alert(Guid exerciseId) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        Severity = "emergency",
        Headline = "Tornado warning for Kestrel County until 4:15 PM",
        SourceChannel = "weather",
        IssuedScenarioTime = ScenarioTime,
        Origin = "controller",
        ActingHumanId = "human-1",
    };

    public static PortalConfig PortalConfig(Guid exerciseId) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        PortalName = "Kestrel Today",
        LayoutKey = "anchor",
    };

    public static PortalResource PortalResource(Guid exerciseId, int sortOrder = 0) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        Title = "Open shelters",
        SortOrder = sortOrder,
        Visible = true,
    };

    public static WeatherZone Zone(Guid exerciseId, string slug = "kestrel-county") => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        Slug = slug,
        Name = "Kestrel County",
        Kind = "county",
        IsDefault = true,
    };

    public static InjectItem Inject(Guid exerciseId, Guid? contentItemId = null) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        Kind = "post",
        Title = "Dispatch delays",
        Status = "pending",
        CreatedByHumanId = Guid.NewGuid(),
        CreatedAt = DateTimeOffset.UtcNow,
        UpdatedAt = DateTimeOffset.UtcNow,
        ContentItemId = contentItemId,
    };

    /// <summary>An outlet and a draft item in it, saved through an unscoped context (seeding writes explicit scopes).</summary>
    public static async Task<(Outlet Outlet, ContentItem Item)> SeedOutletAndItemAsync(MsSqlContainerFixture fixture, Guid exerciseId)
    {
        var outlet = Outlet(exerciseId);
        var item = ContentItem(exerciseId, outlet.Id);
        await using var seed = fixture.CreateContext();
        seed.Outlets.Add(outlet);
        seed.ContentItems.Add(item);
        await seed.SaveChangesAsync();
        return (outlet, item);
    }

    /// <summary>
    /// One live row of every M1 entity in <paramref name="exerciseId"/>; returns each row's id by entity type, so a test
    /// can sweep all eight with one loop.
    /// </summary>
    public static async Task<System.Collections.Generic.Dictionary<Type, Guid>> SeedOneOfEachAsync(
        MsSqlContainerFixture fixture, Guid exerciseId)
    {
        var outlet = Outlet(exerciseId);
        var item = ContentItem(exerciseId, outlet.Id);
        var asset = MediaAsset(exerciseId);
        var revision = Revision(exerciseId, item.Id);
        var media = Media(exerciseId, item.Id, asset.Id);
        var alert = Alert(exerciseId);
        var config = PortalConfig(exerciseId);
        var resource = PortalResource(exerciseId);
        var zone = Zone(exerciseId);

        await using var seed = fixture.CreateContext();
        seed.MediaAssets.Add(asset);
        seed.Outlets.Add(outlet);
        seed.ContentItems.Add(item);
        seed.ContentItemRevisions.Add(revision);
        seed.ContentItemMedia.Add(media);
        seed.ChannelAlerts.Add(alert);
        seed.PortalConfigs.Add(config);
        seed.PortalResources.Add(resource);
        seed.WeatherZones.Add(zone);
        await seed.SaveChangesAsync();

        return new()
        {
            [typeof(Outlet)] = outlet.Id,
            [typeof(ContentItem)] = item.Id,
            [typeof(ContentItemRevision)] = revision.Id,
            [typeof(ContentItemMedia)] = media.Id,
            [typeof(ChannelAlert)] = alert.Id,
            [typeof(PortalConfig)] = config.Id,
            [typeof(PortalResource)] = resource.Id,
            [typeof(WeatherZone)] = zone.Id,
        };
    }

    /// <summary>The eight M1 entity types (the five FC-2 entities and the three folded ones).</summary>
    public static readonly Type[] M1EntityTypes =
    [
        typeof(Outlet), typeof(ContentItem), typeof(ContentItemRevision), typeof(ContentItemMedia), typeof(ChannelAlert),
        typeof(PortalConfig), typeof(PortalResource), typeof(WeatherZone),
    ];

    /// <summary>Finds a row by id through the context's filtered set for <paramref name="type"/>.</summary>
    public static async Task<object?> FindAsync(PulseDbContext context, Type type, Guid id) =>
        await context.FindAsync(type, id);
}
