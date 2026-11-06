namespace Pulse.WebApi.Tests.Features.Channels.Outlets;

using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Outlets;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// Story 03 AC "Defaults": "add default outlets" per channel creates the catalog's outlets once (idempotent), pairs them
/// with the exercise's cast personas by handle, reports unresolved handles, gives weather exactly one outlet, and emits
/// one <c>outlet_action</c> create event per created outlet, all in one save. Real SQL.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class OutletDefaultsTests
{
    private readonly MsSqlContainerFixture _fixture;

    public OutletDefaultsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task News_CreatesTheFourDefaults_PairedByHandle_AndASecondRunCreatesNothing()
    {
        await using var host = await OutletTestHost.StartAsync(_fixture.ConnectionString!);
        var seeded = await host.SeedExerciseAsync();
        var metro = await host.AddPersonaAsync(seeded.ExerciseId, "metrodesk9"); // matched case-insensitively
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        await host.CreateOkAsync(OutletTestHost.Body(slug: "existing-local", name: "Existing")); // sortOrder 1
        host.Saves.Clear();

        var first = await DefaultsAsync(host, "news");

        first.Created.Select(o => o.Slug).Should().Equal("metro-desk-9", "courier-ledger", "national-wire", "the-scoop");
        first.Created.Select(o => o.Name).Should().Equal("Metro Desk 9", "The Courier-Ledger", "The National Wire", "The Scoop");
        first.Created.Select(o => o.SkinKey).Should().Equal("newsline7", "courier-ledger", "national-wire", "the-scoop");
        first.Created.Select(o => o.SortOrder).Should().Equal([2, 3, 4, 5], "after the existing outlets");
        first.Created.Should().OnlyContain(o => o.Enabled && o.Version == 1 && o.Categories.Count > 0);
        first.Created[0].PairedPersonaId.Should().Be(metro.ToString());
        first.Created[3].PairedPersonaId.Should().BeNull();
        first.UnresolvedHandles.Should().Equal("@TheScoopHQ");
        first.Skipped.Should().BeEmpty();

        var events = (await host.OutletEventsAsync(seeded.ExerciseId)).Skip(1).ToList();
        events.Should().HaveCount(4, "one create event per created outlet");
        events.Should().OnlyContain(e =>
            OutletEndpointsTests.PayloadOf(e)["action"] == "create"
            && OutletEndpointsTests.PayloadOf(e)["source"] == "defaults"
            && e.Actor.ActingHumanId == seeded.StaffUserId.ToString());
        host.Saves.All.Should().ContainSingle("the outlets and their events are ONE unit of work")
            .Which.Count(entry => entry == (nameof(Outlet), "Added")).Should().Be(4);

        var second = await DefaultsAsync(host, "news");
        second.Created.Should().BeEmpty("idempotent");
        second.Skipped.Should().Equal("metro-desk-9", "courier-ledger", "national-wire", "the-scoop");
        (await host.OutletEventsAsync(seeded.ExerciseId)).Should().HaveCount(5, "a repeat run emits nothing");

        host.ActAs(seeded.ExerciseId, staffUserId: null);
        (await (await host.GetAsync("/api/outlets?channel=news")).Content.ReadFromJsonAsync<System.Collections.Generic.List<WireOutlet>>())!
            .Should().HaveCount(5);
    }

    [RequiresDockerFact]
    public async Task Weather_GetsExactlyOneDefault_TheWeatherDesk_PairedWithWeatherDesk()
    {
        await using var host = await OutletTestHost.StartAsync(_fixture.ConnectionString!);
        var seeded = await host.SeedExerciseAsync();
        var weatherDesk = await host.AddPersonaAsync(seeded.ExerciseId, "WeatherDesk");
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);

        var result = await DefaultsAsync(host, "weather");

        var outlet = result.Created.Should().ContainSingle("weather products resolve their outlet by channel (weather FU-8)").Subject;
        outlet.Slug.Should().Be("weather-desk");
        outlet.Name.Should().Be("The Weather Desk");
        outlet.PairedPersonaId.Should().Be(weatherDesk.ToString());
        result.UnresolvedHandles.Should().BeEmpty();
        (await DefaultsAsync(host, "weather")).Created.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Press_GetsTheWireRoom_AnAbsentPersonaIsReported_AndADeletedSlugIsSkipped()
    {
        await using var host = await OutletTestHost.StartAsync(_fixture.ConnectionString!);
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);

        (await DefaultsAsync(host, "press")).Created.Should().ContainSingle().Which.Slug.Should().Be("wire-room");

        var withoutPersona = await DefaultsAsync(host, "weather");
        withoutPersona.Created.Should().ContainSingle().Which.PairedPersonaId.Should().BeNull("creating the persona is E2's");
        withoutPersona.UnresolvedHandles.Should().Equal("@WeatherDesk");

        var weatherDesk = withoutPersona.Created[0];
        (await host.DeleteAsync(weatherDesk.Guid, weatherDesk.Version)).StatusCode.Should().Be(HttpStatusCode.NoContent);
        var afterDelete = await DefaultsAsync(host, "weather");
        afterDelete.Created.Should().BeEmpty("a deleted outlet keeps its slug reserved (F01's unfiltered index)");
        afterDelete.Skipped.Should().Equal("weather-desk");
    }

    [RequiresDockerFact]
    public async Task ANonContentChannel_Is400()
    {
        await using var host = await OutletTestHost.StartAsync(_fixture.ConnectionString!);
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);

        (await OutletTestHost.ProblemAsync(await host.PostAsync("/api/outlets/defaults", new { channelId = "portal" })))
            .Detail.Should().Be("channelId must be one of news, press, weather.");
    }

    private static async Task<WireDefaults> DefaultsAsync(OutletTestHost host, string channelId)
    {
        var response = await host.PostAsync("/api/outlets/defaults", new { channelId });
        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<WireDefaults>())!;
    }
}

/// <summary>Story 03 AC "Defaults", the catalog itself (DEMO CONFIG). Plain facts, no database.</summary>
public sealed class OutletDefaultsCatalogTests
{
    [Fact]
    public void TheCatalog_GivesWeatherExactlyOneEntry_AndEveryEntryIsWellFormed()
    {
        var catalog = new OutletDefaultsCatalog();

        catalog.ForChannel("weather").Should().ContainSingle().Which.Should().Match<OutletDefault>(d => d.Slug == "weather-desk" && d.PairedHandle == "WeatherDesk");
        catalog.ForChannel("news").Select(d => d.Name).Should().Equal("Metro Desk 9", "The Courier-Ledger", "The National Wire", "The Scoop");
        catalog.ForChannel("press").Should().ContainSingle().Which.Slug.Should().Be("wire-room");
        catalog.Entries.Should().OnlyContain(d =>
            Pulse.WebApi.Features.Channels.Contracts.ChannelVocabulary.IsSlug(d.Slug)
            && Pulse.WebApi.Features.Channels.Contracts.ChannelVocabulary.IsSlug(d.SkinKey)
            && Pulse.WebApi.Features.Channels.Contracts.ChannelVocabulary.ContentChannelIds.Contains(d.ChannelId)
            && d.Categories.Count <= OutletWriteValidator.MaxCategories);
        catalog.Entries.Select(d => d.Name + d.Tagline + string.Concat(d.Categories))
            .Should().NotContain(text => text.Contains("Newsline", System.StringComparison.Ordinal), "FIC-001 retired the old station name");
    }
}
