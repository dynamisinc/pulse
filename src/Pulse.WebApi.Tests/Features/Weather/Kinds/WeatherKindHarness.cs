namespace Pulse.WebApi.Tests.Features.Weather.Kinds;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Weather.Contracts;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// Weather story 01 test harness: an in-memory <see cref="PulseDbContext"/> per exercise (the central exercise filter and
/// write guard apply, so a cross-exercise lookup misses exactly as it does on SQL Server), a fake
/// <see cref="IWeatherZoneCatalog"/> per exercise, and the <see cref="PayloadValidationContext"/> the funnel would build.
/// </summary>
internal sealed class WeatherKindHarness : IDisposable
{
    private readonly string _dbName = $"weather-kinds-{Guid.NewGuid():N}";
    private readonly Dictionary<Guid, FakeZoneCatalog> _catalogs = [];
    private readonly List<IDisposable> _disposables = [];

    /// <summary>A fresh exercise with the fixture zones and a Weather Desk outlet.</summary>
    public Guid NewExercise(params string[] zones)
    {
        var exerciseId = Guid.NewGuid();
        _catalogs[exerciseId] = new FakeZoneCatalog(zones.Length == 0 ? WeatherPayloads.Zones : zones);
        using var db = Context(exerciseId);
        db.Outlets.Add(ChannelRows.Outlet(exerciseId, "weather-desk", ChannelVocabulary.Weather));
        db.SaveChanges();
        return exerciseId;
    }

    /// <summary>The fake catalog of an exercise (to soft-delete a zone or empty it).</summary>
    public FakeZoneCatalog Catalog(Guid exerciseId) => _catalogs[exerciseId];

    /// <summary>Seeds a weather content item in <paramref name="exerciseId"/> under its Weather Desk outlet.</summary>
    public async Task<ContentItem> SeedAsync(
        Guid exerciseId, string kind, string status, JsonObject payload, string slug = "tornado-watch-1")
    {
        await using var db = Context(exerciseId);
        var outlet = await db.Outlets.SingleAsync(o => o.ChannelId == ChannelVocabulary.Weather);
        var item = ChannelRows.ContentItem(exerciseId, outlet.Id, slug);
        item.ChannelId = ChannelVocabulary.Weather;
        item.Kind = kind;
        item.Status = status;
        item.PayloadJson = payload.ToJsonString();
        if (status is ChannelVocabulary.StatusPublished or ChannelVocabulary.StatusRetracted)
        {
            item.PublishedScenarioTime = ChannelRows.ScenarioTime;
        }

        db.ContentItems.Add(item);
        await db.SaveChangesAsync();
        return item;
    }

    /// <summary>The context the funnel would pass for a write in <paramref name="exerciseId"/>.</summary>
    public PayloadValidationContext ValidationContext(
        Guid exerciseId, Guid? contentItemId = null, bool withCatalog = true)
    {
        var db = Context(exerciseId);
        var services = new ServiceCollection();
        if (withCatalog)
        {
            services.AddSingleton<IWeatherZoneCatalog>(_catalogs[exerciseId]);
        }

        var provider = services.BuildServiceProvider();
        _disposables.Add(db);
        _disposables.Add(provider);
        return new PayloadValidationContext
        {
            ExerciseId = exerciseId,
            Db = db,
            Services = provider,
            ContentItemId = contentItemId,
            TargetStatus = ChannelVocabulary.StatusDraft,
        };
    }

    public void Dispose()
    {
        foreach (var disposable in _disposables)
        {
            disposable.Dispose();
        }
    }

    private PulseDbContext Context(Guid exerciseId) =>
        new(
            new DbContextOptionsBuilder<PulseDbContext>().UseInMemoryDatabase(_dbName).Options,
            new ExerciseContext { CurrentExerciseId = exerciseId });

    /// <summary>A zone catalog over a mutable set of live slugs.</summary>
    internal sealed class FakeZoneCatalog(IEnumerable<string> zones) : IWeatherZoneCatalog
    {
        public HashSet<string> Live { get; } = new(zones, StringComparer.Ordinal);

        public Task<bool> HasAnyAsync(CancellationToken cancellationToken = default) => Task.FromResult(Live.Count > 0);

        public Task<IReadOnlySet<string>> ExistAsync(
            IReadOnlyCollection<string> slugs, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlySet<string>>(slugs.Where(s => !Live.Contains(s)).ToHashSet(StringComparer.Ordinal));

        public Task<IReadOnlyList<WeatherZoneRef>> ResolveAsync(
            IReadOnlyCollection<string> slugs, bool includeDeleted, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<WeatherZoneRef>>([.. slugs.Select(s => new WeatherZoneRef(s, s))]);
    }
}

/// <summary>Valid weather payloads (fictional places only, scenario-time instants).</summary>
internal static class WeatherPayloads
{
    public static readonly string[] Zones = ["kestrel-county-north", "kestrel-county-south", "harbor-point"];

    public static JsonObject Watch() => Parse("""
        {
          "productType": "watch",
          "hazard": "tornado",
          "action": "new",
          "zoneSlugs": ["kestrel-county-north", "kestrel-county-south"],
          "effectiveScenarioTime": "2026-12-02T13:30:00Z",
          "expiresScenarioTime": "2026-12-02T19:00:00Z",
          "actions": ["Review your shelter plan."],
          "delivery": { "raiseAlert": true, "post": { "enabled": true, "text": null } }
        }
        """);

    public static JsonObject Warning(string action = "new", Guid? supersedes = null)
    {
        var payload = Parse("""
            {
              "productType": "warning",
              "hazard": "tornado",
              "action": "new",
              "zoneSlugs": ["kestrel-county-north"],
              "effectiveScenarioTime": "2026-12-02T14:20:00Z",
              "expiresScenarioTime": "2026-12-02T15:15:00-00:00",
              "ibw": {
                "what": "Radar-indicated tornado.",
                "where": "Northern Kestrel County.",
                "when": "Until 3:15 PM.",
                "impacts": "Flying debris will be dangerous."
              },
              "actions": ["Take shelter now."],
              "delivery": { "raiseAlert": true, "post": { "enabled": true, "text": "Take shelter now." } }
            }
            """);
        payload["action"] = action;
        if (supersedes is { } id)
        {
            payload["supersedesContentId"] = id.ToString();
        }

        return payload;
    }

    public static JsonObject Forecast() => Parse("""
        {
          "zoneSlug": "kestrel-county-north",
          "current": {
            "tempF": 68, "condition": "Partly Cloudy", "conditionCode": "partly_cloudy", "windMph": 12, "windDir": "S",
            "humidityPct": 74, "observedScenarioTime": "2026-12-02T10:55:00Z"
          },
          "periods": [
            {
              "label": "This Afternoon", "tempF": 74, "condition": "Thunderstorms Likely", "conditionCode": "thunderstorms",
              "precipPct": 70, "windText": "S 15 to 20 mph", "detail": "Thunderstorms likely after 1 PM."
            },
            {
              "label": "Tonight", "hiF": 58, "loF": 41, "condition": "Rain Ending", "conditionCode": "rain",
              "precipPct": 60, "windText": "NW 10 mph", "detail": "Rain ending by 9 PM."
            }
          ],
          "discussion": "A strong cold front crosses the county this afternoon.",
          "uncertaintyNote": null
        }
        """);

    public static JsonObject Parse(string json) => JsonNode.Parse(json)!.AsObject();
}
