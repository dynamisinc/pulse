namespace Pulse.WebApi.Tests.Features.Weather.Zones;

using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Weather.Zones;
using Xunit;

/// <summary>
/// Weather story 02 (#753) service rules against the REAL <see cref="WeatherZone"/> entity and <c>PulseDbContext</c>
/// (in-memory store; no Docker): the one-default rule, soft delete (XC-010), version conflicts, slug reservation, the
/// participant projection (XC-002), cross-exercise ids (XC-001) and the <c>weather_zone_changed</c> event (XC-004).
/// </summary>
public sealed class WeatherZoneServiceTests : IDisposable
{
    private readonly WeatherZoneHarness _harness = new();

    public void Dispose() => _harness.Dispose();

    [Fact]
    public async Task ANewExercise_HasNoZones_AndTheStaffListReportsNoZones()
    {
        var (exercise, staff) = _harness.NewExercise();

        var list = (await _harness.Service(exercise, staff).ListStaffAsync()).Value!;

        list.Zones.Should().BeEmpty("no zone is auto-created on exercise setup (Q6)");
        list.CanAuthor.Should().BeFalse();
        list.AuthoringBlockedReason.Should().Be("no_zones");
        (await _harness.Service(exercise, null).ListAsync()).Value.Should().BeEmpty();
    }

    [Fact]
    public async Task TheFirstZone_IsTheDefault_EvenWhenTheBodySaysOtherwise_AndLaterZonesAreNot()
    {
        var (exercise, staff) = _harness.NewExercise();

        var first = await _harness.Service(exercise, staff).CreateAsync(WeatherZoneHarness.Body(isDefault: false));
        var second = await _harness.Service(exercise, staff).CreateAsync(
            WeatherZoneHarness.Body(slug: "harbor-point", name: "Harbor Point", kind: "city"));

        first.Outcome.Should().Be(WeatherZoneOutcome.Created);
        first.Value!.IsDefault.Should().BeTrue();
        first.Value.SortOrder.Should().Be(1);
        first.Value.Version.Should().Be(1);
        second.Value!.IsDefault.Should().BeFalse();
        second.Value.SortOrder.Should().Be(2);

        var list = (await _harness.Service(exercise, staff).ListStaffAsync()).Value!;
        list.CanAuthor.Should().BeTrue();
        list.AuthoringBlockedReason.Should().BeNull();
        list.Zones.Select(z => (z.Slug, z.IsDefault)).Should().Equal(("kestrel-county-north", true), ("harbor-point", false));
    }

    [Fact]
    public async Task CreatingWithIsDefault_MovesTheDefault_AndBumpsTheOldDefaultsVersion()
    {
        var (exercise, staff) = _harness.NewExercise();
        var first = (await _harness.Service(exercise, staff).CreateAsync(WeatherZoneHarness.Body())).Value!;

        var second = (await _harness.Service(exercise, staff).CreateAsync(
            WeatherZoneHarness.Body(slug: "harbor-point", name: "Harbor Point", isDefault: true))).Value!;

        second.IsDefault.Should().BeTrue();
        var rows = await _harness.AllZonesAsync(exercise);
        rows.Single(z => z.Slug == first.Slug).Should().Match<WeatherZone>(z => !z.IsDefault && z.Version == 2);
        rows.Count(z => z.IsDefault).Should().Be(1);
    }

    [Fact]
    public async Task Edit_ReplacesFields_BumpsVersion_AndCanMoveTheDefault()
    {
        var (exercise, staff) = _harness.NewExercise();
        var north = (await _harness.Service(exercise, staff).CreateAsync(WeatherZoneHarness.Body())).Value!;
        var harbor = (await _harness.Service(exercise, staff).CreateAsync(
            WeatherZoneHarness.Body(slug: "harbor-point", name: "Harbor Point"))).Value!;

        var edited = await _harness.Service(exercise, staff).UpdateAsync(
            Guid.Parse(harbor.Id),
            WeatherZoneHarness.Body(
                slug: "harbor-point", name: "  Harbor Point Marina ", kind: "city", description: "Waterfront.",
                sortOrder: 0, isDefault: true, version: 1));

        edited.Outcome.Should().Be(WeatherZoneOutcome.Ok);
        edited.Value.Should().BeEquivalentTo(new
        {
            Slug = "harbor-point", Name = "Harbor Point Marina", Kind = "city", Description = "Waterfront.",
            SortOrder = 0, IsDefault = true, Version = 2,
        });
        var list = (await _harness.Service(exercise, null).ListAsync()).Value!;
        list.Select(z => (z.Slug, z.IsDefault)).Should().Equal(("harbor-point", true), (north.Slug, false));
    }

    [Fact]
    public async Task Edit_RefusesASlugChange_AStaleVersion_AndUndefaultingTheDefault()
    {
        var (exercise, staff) = _harness.NewExercise();
        var north = (await _harness.Service(exercise, staff).CreateAsync(WeatherZoneHarness.Body())).Value!;
        var id = Guid.Parse(north.Id);

        var slugChange = await _harness.Service(exercise, staff).UpdateAsync(id, WeatherZoneHarness.Body(slug: "renamed", version: 1));
        slugChange.Outcome.Should().Be(WeatherZoneOutcome.Invalid);
        slugChange.Message.Should().Contain(WeatherZoneWriteValidator.SlugImmutableMessage);

        var stale = await _harness.Service(exercise, staff).UpdateAsync(id, WeatherZoneHarness.Body(name: "x", version: 7));
        stale.Outcome.Should().Be(WeatherZoneOutcome.Conflict);
        stale.Message.Should().Be(WeatherZoneService.StaleVersionMessage);
        stale.CurrentItem!.Version.Should().Be(1);

        var undefault = await _harness.Service(exercise, staff).UpdateAsync(id, WeatherZoneHarness.Body(isDefault: false, version: 1));
        undefault.Outcome.Should().Be(WeatherZoneOutcome.Invalid);
        undefault.Message.Should().Be(WeatherZoneService.DefaultRequiredMessage);

        var missingVersion = await _harness.Service(exercise, staff).UpdateAsync(id, WeatherZoneHarness.Body());
        missingVersion.Outcome.Should().Be(WeatherZoneOutcome.Invalid);

        var omittedSlug = await _harness.Service(exercise, staff).UpdateAsync(
            id, WeatherZoneHarness.Body(slug: null!, name: "Kestrel North", version: 1));
        omittedSlug.Outcome.Should().Be(WeatherZoneOutcome.Ok, "a PUT may omit the immutable slug");
        (await _harness.ZoneEventsAsync(exercise)).Should().HaveCount(2, "only the create and the one successful edit emit");
    }

    [Fact]
    public async Task DeletingTheDefault_SoftDeletes_PromotesTheFirstRemainingZone_AndKeepsTheRow()
    {
        var (exercise, staff) = _harness.NewExercise();
        var north = (await _harness.Service(exercise, staff).CreateAsync(WeatherZoneHarness.Body())).Value!;
        await _harness.Service(exercise, staff).CreateAsync(WeatherZoneHarness.Body(slug: "south", name: "South", sortOrder: 5));
        await _harness.Service(exercise, staff).CreateAsync(WeatherZoneHarness.Body(slug: "harbor", name: "Harbor", sortOrder: 3));

        var deleted = await _harness.Service(exercise, staff).DeleteAsync(Guid.Parse(north.Id), version: 1);

        deleted.Outcome.Should().Be(WeatherZoneOutcome.Deleted);
        var list = (await _harness.Service(exercise, null).ListAsync()).Value!;
        list.Select(z => (z.Slug, z.IsDefault)).Should().Equal(("harbor", true), ("south", false));

        var row = (await _harness.AllZonesAsync(exercise)).Single(z => z.Slug == north.Slug);
        row.DeletedAt.Should().NotBeNull("nothing is hard-deleted (XC-010)");
        row.Version.Should().Be(2);

        var deleteEvent = (await _harness.ZoneEventsAsync(exercise)).Last();
        var payload = WeatherZoneHarness.Payload(deleteEvent);
        payload.GetProperty("action").GetString().Should().Be("delete");
        payload.GetProperty("slug").GetString().Should().Be(north.Slug);
        payload.GetProperty("defaultSlug").GetString().Should().Be("harbor", "the promoted default is in the one event");
    }

    [Fact]
    public async Task DeletingTheLastZone_LeavesNoZones_AndBlocksAuthoringAgain()
    {
        var (exercise, staff) = _harness.NewExercise();
        var north = (await _harness.Service(exercise, staff).CreateAsync(WeatherZoneHarness.Body())).Value!;

        (await _harness.Service(exercise, staff).DeleteAsync(Guid.Parse(north.Id), 1)).Outcome.Should().Be(WeatherZoneOutcome.Deleted);

        var list = (await _harness.Service(exercise, staff).ListStaffAsync()).Value!;
        list.Zones.Should().BeEmpty();
        list.AuthoringBlockedReason.Should().Be("no_zones");
        var payload = WeatherZoneHarness.Payload((await _harness.ZoneEventsAsync(exercise)).Last());
        payload.GetProperty("defaultSlug").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task Delete_NeedsTheCurrentVersion_AndADeletedZoneIsTheOne404()
    {
        var (exercise, staff) = _harness.NewExercise();
        var north = (await _harness.Service(exercise, staff).CreateAsync(WeatherZoneHarness.Body())).Value!;
        var id = Guid.Parse(north.Id);

        (await _harness.Service(exercise, staff).DeleteAsync(id, null)).Outcome.Should().Be(WeatherZoneOutcome.Invalid);
        (await _harness.Service(exercise, staff).DeleteAsync(id, 9)).Outcome.Should().Be(WeatherZoneOutcome.Conflict);
        (await _harness.Service(exercise, staff).DeleteAsync(id, 1)).Outcome.Should().Be(WeatherZoneOutcome.Deleted);

        var again = await _harness.Service(exercise, staff).DeleteAsync(id, 2);
        var edit = await _harness.Service(exercise, staff).UpdateAsync(id, WeatherZoneHarness.Body(version: 2));
        again.Outcome.Should().Be(WeatherZoneOutcome.NotFound);
        edit.Outcome.Should().Be(WeatherZoneOutcome.NotFound);
        again.Message.Should().Be(WeatherZoneResult.NotFoundMessage);
    }

    [Fact]
    public async Task ASlug_IsUniquePerExercise_AndADeletedZonesSlugStaysReserved()
    {
        var (exercise, staff) = _harness.NewExercise();
        var (other, otherStaff) = _harness.NewExercise();
        _harness.AddZone(exercise, "old-zone", deleted: true);
        await _harness.Service(exercise, staff).CreateAsync(WeatherZoneHarness.Body());

        var live = await _harness.Service(exercise, staff).CreateAsync(WeatherZoneHarness.Body());
        var reserved = await _harness.Service(exercise, staff).CreateAsync(WeatherZoneHarness.Body(slug: "old-zone"));
        var elsewhere = await _harness.Service(other, otherStaff).CreateAsync(WeatherZoneHarness.Body());

        live.Outcome.Should().Be(WeatherZoneOutcome.Conflict);
        live.Message.Should().Contain("already used");
        reserved.Outcome.Should().Be(WeatherZoneOutcome.Conflict);
        reserved.Message.Should().Contain("stays reserved");
        elsewhere.Outcome.Should().Be(WeatherZoneOutcome.Created, "slugs are unique per exercise, not globally");
    }

    [Fact]
    public async Task TheParticipantList_IsLiveZonesInDisplayOrder_WithExactlyFourFields()
    {
        var (exercise, _) = _harness.NewExercise();
        _harness.AddZone(exercise, "south", "South", sortOrder: 2);
        _harness.AddZone(exercise, "gone", "Gone", sortOrder: 0, deleted: true);
        _harness.AddZone(exercise, "bravo", "Bravo", sortOrder: 1, isDefault: true);
        _harness.AddZone(exercise, "alpha", "alpha", sortOrder: 1);

        var list = (await _harness.Service(exercise, null).ListAsync()).Value!;

        list.Select(z => z.Slug).Should().Equal("alpha", "bravo", "south");
        list.Select(z => z.IsDefault).Should().Equal(false, true, false);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(list));
        json.RootElement[0].EnumerateObject().Select(p => p.Name).Should().Equal("slug", "name", "kind", "isDefault");
    }

    [Fact]
    public async Task TheReads_NameExactlyOneDefault_EvenWhenStorageHoldsTwoOrNone()
    {
        var (twoFlagged, staffA) = _harness.NewExercise();
        _harness.AddZone(twoFlagged, "first", sortOrder: 1, isDefault: true);
        _harness.AddZone(twoFlagged, "second", sortOrder: 2, isDefault: true);
        var (noneFlagged, _) = _harness.NewExercise();
        _harness.AddZone(noneFlagged, "only", sortOrder: 1);

        (await _harness.Service(twoFlagged, null).ListAsync()).Value!.Count(z => z.IsDefault).Should().Be(1);
        (await _harness.Service(twoFlagged, staffA).ListStaffAsync()).Value!.Zones.Single(z => z.IsDefault).Slug.Should().Be("first");
        (await _harness.Service(noneFlagged, null).ListAsync()).Value!.Single().IsDefault.Should().BeTrue();
    }

    [Fact]
    public async Task AnotherExercisesZone_AnswersExactlyLikeAnUnknownId_AndIsUntouched()
    {
        var (a, staffA) = _harness.NewExercise();
        var (b, staffB) = _harness.NewExercise();
        var aZone = (await _harness.Service(a, staffA).CreateAsync(WeatherZoneHarness.Body())).Value!;
        var unknown = Guid.NewGuid();

        var crossEdit = await _harness.Service(b, staffB).UpdateAsync(Guid.Parse(aZone.Id), WeatherZoneHarness.Body(version: 1));
        var unknownEdit = await _harness.Service(b, staffB).UpdateAsync(unknown, WeatherZoneHarness.Body(version: 1));
        var crossDelete = await _harness.Service(b, staffB).DeleteAsync(Guid.Parse(aZone.Id), 1);
        var unknownDelete = await _harness.Service(b, staffB).DeleteAsync(unknown, 1);

        (crossEdit.Outcome, crossEdit.Message).Should().Be((unknownEdit.Outcome, unknownEdit.Message));
        (crossDelete.Outcome, crossDelete.Message).Should().Be((unknownDelete.Outcome, unknownDelete.Message));
        crossEdit.Outcome.Should().Be(WeatherZoneOutcome.NotFound);
        (await _harness.Service(b, null).ListAsync()).Value.Should().BeEmpty();
        (await _harness.AllZonesAsync(a)).Single().Should().Match<WeatherZone>(z => z.Version == 1 && z.DeletedAt == null);
        (await _harness.ZoneEventsAsync(b)).Should().BeEmpty();
    }

    [Fact]
    public async Task AnUnresolvedScope_OrNoStaffSession_FailsClosed()
    {
        var (exercise, staff) = _harness.NewExercise();

        (await _harness.Service(null, staff).ListAsync()).Outcome.Should().Be(WeatherZoneOutcome.ScopeUnresolved);
        (await _harness.Service(null, staff).CreateAsync(WeatherZoneHarness.Body())).Outcome.Should().Be(WeatherZoneOutcome.ScopeUnresolved);
        (await _harness.Service(exercise, null).CreateAsync(WeatherZoneHarness.Body())).Outcome.Should().Be(WeatherZoneOutcome.ScopeUnresolved);
        (await _harness.Service(exercise, null).ListStaffAsync()).Outcome.Should().Be(WeatherZoneOutcome.ScopeUnresolved);
        (await _harness.AllZonesAsync(exercise)).Should().BeEmpty();
    }

    [Fact]
    public async Task EveryWrite_EmitsOneWeatherZoneChangedEvent_WithTheActingHuman_OnTheWeatherChannel()
    {
        var (exercise, staff) = _harness.NewExercise();
        var created = (await _harness.Service(exercise, staff).CreateAsync(WeatherZoneHarness.Body())).Value!;
        await _harness.Service(exercise, staff).UpdateAsync(Guid.Parse(created.Id), WeatherZoneHarness.Body(name: "North", version: 1));
        await _harness.Service(exercise, staff).DeleteAsync(Guid.Parse(created.Id), 2);

        var events = await _harness.ZoneEventsAsync(exercise);

        events.Select(e => WeatherZoneHarness.Payload(e).GetProperty("action").GetString()).Should().Equal("create", "edit", "delete");
        events.Should().OnlyContain(e =>
            e.Channel == "weather"
            && e.SchemaVersion == "v0"
            && e.ExerciseId == exercise
            && e.Actor.Kind == "system"
            && e.Actor.ActingHumanId == staff.ToString()
            && e.Target!.EntityType == "weather_zone"
            && e.Target.EntityId == created.Id
            && e.ScenarioTime == WeatherZoneHarness.ScenarioNow
            && e.TimeZone == "America/Chicago");
        var first = WeatherZoneHarness.Payload(events[0]);
        first.GetProperty("slug").GetString().Should().Be(created.Slug);
        first.GetProperty("isDefault").GetBoolean().Should().BeTrue();
        first.GetProperty("defaultSlug").GetString().Should().Be(created.Slug);

        var deletedAt = (await _harness.AllZonesAsync(exercise)).Single().DeletedAt;
        deletedAt.Should().Be(events[2].WallClockTime, "the soft delete and its event share one clock read");
    }

    [Fact]
    public async Task ASecondWriterOnTheSameReadVersion_GetsA409WithTheCurrentZone()
    {
        var (exercise, staff) = _harness.NewExercise();
        var created = (await _harness.Service(exercise, staff).CreateAsync(WeatherZoneHarness.Body())).Value!;
        var id = Guid.Parse(created.Id);

        // Both writers read version 1; the second one's write is refused with the first one's result attached.
        var slow = _harness.Service(exercise, staff);
        var fast = _harness.Service(exercise, staff);
        (await fast.UpdateAsync(id, WeatherZoneHarness.Body(name: "Fast", version: 1))).Outcome.Should().Be(WeatherZoneOutcome.Ok);

        await using (var db = _harness.Db(exercise))
        {
            (await db.WeatherZones.SingleAsync()).Version.Should().Be(2);
        }

        var lost = await slow.UpdateAsync(id, WeatherZoneHarness.Body(name: "Slow", version: 1));
        lost.Outcome.Should().Be(WeatherZoneOutcome.Conflict);
        lost.CurrentItem!.Name.Should().Be("Fast");
    }
}
