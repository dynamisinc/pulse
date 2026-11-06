namespace Pulse.WebApi.Tests.Features.Weather.Zones;

using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Weather.Contracts;
using Pulse.WebApi.Features.Weather.Kinds;
using Pulse.WebApi.Features.Weather.Zones;
using Pulse.WebApi.Tests.Features.Weather.Kinds;
using Xunit;

/// <summary>
/// Weather story 02 (#753): the real <see cref="IWeatherZoneCatalog"/> over F01's <see cref="WeatherZone"/> (in-memory store
/// with the real central filter). It answers for the resolved exercise only, treats soft-deleted zones as missing for new
/// authoring but still resolves their names for historic products (XC-010), and makes story 01's validators return
/// <c>no_zones</c> on an empty exercise.
/// </summary>
public sealed class WeatherZoneCatalogTests : IDisposable
{
    private readonly WeatherZoneHarness _harness = new();
    private readonly List<IDisposable> _tracked = [];

    public void Dispose()
    {
        foreach (var disposable in _tracked)
        {
            disposable.Dispose();
        }

        _harness.Dispose();
    }

    [Fact]
    public async Task ExistAsync_ReturnsTheMissingSlugs_ForTheResolvedExerciseOnly()
    {
        var (a, _) = _harness.NewExercise();
        var (b, _) = _harness.NewExercise();
        _harness.AddZone(a, "north");
        _harness.AddZone(a, "retired", deleted: true);
        _harness.AddZone(b, "harbor");

        var missing = await Catalog(a).ExistAsync(["north", "retired", "harbor", "nowhere", "North"]);

        missing.Should().BeEquivalentTo(["retired", "harbor", "nowhere", "North"],
            "a deleted zone cannot be newly authored, another exercise's zone is unknown, and slugs are ordinal");
        (await Catalog(a).ExistAsync(["north"])).Should().BeEmpty();
        (await Catalog(a).ExistAsync([])).Should().BeEmpty();
    }

    [Fact]
    public async Task ResolveAsync_IncludesDeletedZonesOnlyWhenAsked_InInputOrder()
    {
        var (a, _) = _harness.NewExercise();
        var (b, _) = _harness.NewExercise();
        _harness.AddZone(a, "north", "Kestrel North");
        _harness.AddZone(a, "retired", "Old Harbor District", deleted: true);
        _harness.AddZone(b, "foreign", "Someone Else's Zone");

        var historic = await Catalog(a).ResolveAsync(["retired", "foreign", "north", "retired"], includeDeleted: true);
        var live = await Catalog(a).ResolveAsync(["retired", "north"], includeDeleted: false);

        historic.Should().Equal(new WeatherZoneRef("retired", "Old Harbor District"), new WeatherZoneRef("north", "Kestrel North"));
        live.Should().Equal(new WeatherZoneRef("north", "Kestrel North"));
    }

    [Fact]
    public async Task HasAnyAsync_CountsLiveZonesOnly_AndAnUnsetScopeSeesNone()
    {
        var (a, _) = _harness.NewExercise();
        (await Catalog(a).HasAnyAsync()).Should().BeFalse("an exercise starts with no zone");

        _harness.AddZone(a, "retired", deleted: true);
        (await Catalog(a).HasAnyAsync()).Should().BeFalse();

        _harness.AddZone(a, "north");
        (await Catalog(a).HasAnyAsync()).Should().BeTrue();
        (await Catalog(null).HasAnyAsync()).Should().BeFalse("an unset scope fails closed");
        (await Catalog(null).ExistAsync(["north"])).Should().BeEquivalentTo(["north"]);
        (await Catalog(null).ResolveAsync(["north"], includeDeleted: true)).Should().BeEmpty();
    }

    [Fact]
    public async Task StoryOnesValidator_OverTheRealCatalog_SaysNoZonesUntilAZoneExists()
    {
        var (exercise, staff) = _harness.NewExercise();
        var descriptor = new WeatherProductDescriptor();
        var payload = WeatherPayloads.Watch();
        payload["zoneSlugs"] = new JsonArray("kestrel-county-north");

        var empty = await descriptor.ValidatePayloadAsync(payload.DeepClone().AsObject(), Context(exercise));
        empty.Errors.Should().ContainSingle().Which.Should().StartWith("payload.zoneSlugs[0]: no_zones");

        await _harness.Service(exercise, staff).CreateAsync(WeatherZoneHarness.Body(slug: "kestrel-county-north"));
        var withZone = await descriptor.ValidatePayloadAsync(payload.DeepClone().AsObject(), Context(exercise));
        withZone.Errors.Should().BeEmpty();

        var (other, _) = _harness.NewExercise();
        _harness.AddZone(other, "somewhere-else");
        var foreign = await descriptor.ValidatePayloadAsync(payload.DeepClone().AsObject(), Context(other));
        foreign.Errors.Should().ContainSingle().Which.Should().StartWith("payload.zoneSlugs[0]: unknown_zone",
            "another exercise's zone is unknown here");
    }

    private WeatherZoneCatalog Catalog(Guid? exerciseId) => new(Track(_harness.Db(exerciseId)));

    private PayloadValidationContext Context(Guid exerciseId)
    {
        var db = Track(_harness.Db(exerciseId));
        var provider = Track(new ServiceCollection()
            .AddSingleton<IWeatherZoneCatalog>(new WeatherZoneCatalog(db))
            .BuildServiceProvider());
        return new PayloadValidationContext
        {
            ExerciseId = exerciseId,
            Db = db,
            Services = provider,
            TargetStatus = ChannelVocabulary.StatusDraft,
        };
    }

    private T Track<T>(T disposable)
        where T : IDisposable
    {
        _tracked.Add(disposable);
        return disposable;
    }
}
