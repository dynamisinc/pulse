namespace Pulse.WebApi.Tests.Features.Channels.Staff;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Content.Staff;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Features.Channels.Publish;
using Xunit;

/// <summary>
/// Channels-foundation story 07 (#703): the staff content API's logic over the REAL funnel (<see cref="FunnelHarness"/>,
/// EF in-memory, Docker-free). The staff session is switchable; the HTTP gates, the rate limit and real-SQL translation
/// are <see cref="StaffContentEndpointsTests"/>.
/// </summary>
public sealed class StaffContentServiceTests
{
    private static readonly Guid StaffUserId = Guid.Parse("5a5a5a5a-0000-4000-8000-000000000007");

    [Fact]
    public async Task Writes_AreMadeAsTheSessionsStaffUser_WithControllerOrigin()
    {
        using var t = Harness.Create();

        var created = await t.OkAsync(s => s.CreateAsync(t.F.Request()));

        created.Origin.Should().Be("controller");
        created.ActingHumanId.Should().Be(StaffUserId.ToString(), "the acting human is the session's staff user (COR-018)");
        created.Status.Should().Be("draft");
    }

    [Fact]
    public async Task NoStaffSession_OrNoScope_IsUnauthorized_AndNothingIsWritten()
    {
        using var t = Harness.Create();
        t.Session.Current = null;

        (await t.RunAsync(s => s.CreateAsync(t.F.Request()))).Outcome.Should().Be(StaffContentOutcome.Unauthorized);
        (await t.RunAsync(s => s.ListAsync(null, null, null, null, null))).Outcome.Should().Be(StaffContentOutcome.Unauthorized);

        t.Session.Current = Staff();
        using (var scope = t.F.In(exerciseId: null))
        {
            var service = scope.Services.GetRequiredService<StaffContentService>();
            (await service.CreateAsync(t.F.Request())).Outcome.Should().Be(StaffContentOutcome.Unauthorized);
        }

        using var a = t.F.InA();
        (await a.Db.ContentItems.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task List_ReturnsEveryStatus_NewestFirst_AndFilters()
    {
        using var t = Harness.Create();
        var draft = await t.CreateAsync("Draft one");
        var scheduled = await t.CreateAsync("Scheduled one");
        await t.OkAsync(s => s.ScheduleAsync(scheduled, new ContentScheduleRequest { ScenarioTime = t.Future() }));
        var published = await t.CreatePublishedAsync("Published one");
        var retracted = await t.CreatePublishedAsync("Retracted one");
        await t.OkAsync(s => s.RetractAsync(Guid.Parse(retracted.Id)));
        var release = await t.OkAsync(s => s.CreateAsync(t.F.Request("A press release", kind: "release")));
        var deleted = await t.CreateAsync("Deleted one");
        (await t.RunAsync(s => s.DeleteAsync(deleted))).Outcome.Should().Be(StaffContentOutcome.Deleted);

        var all = await t.ListAsync();
        all.Select(i => i.Headline).Should().Equal(
            "A press release", "Retracted one", "Published one", "Scheduled one", "Draft one");
        all.Select(i => i.Status).Should().Contain(new[] { "draft", "scheduled", "published", "retracted" });

        (await t.ListAsync(status: "scheduled")).Select(i => i.Id).Should().Equal(scheduled.ToString());
        (await t.ListAsync(kind: "release")).Select(i => i.Id).Should().Equal(release.Id);
        (await t.ListAsync(channel: "press")).Select(i => i.Id).Should().Equal(release.Id);
        (await t.ListAsync(outlet: t.F.OutletId.ToString())).Should().HaveCount(4);
        (await t.ListAsync(limit: 2)).Select(i => i.Headline).Should().Equal("A press release", "Retracted one");
        _ = draft;
        _ = published;

        (await t.ListAsync(channel: "", status: "", outlet: " ", kind: "")).Should().HaveCount(5, "an empty filter is no filter");
        (await t.RunAsync(s => s.ListAsync(null, "live", null, null, null))).Outcome.Should().Be(StaffContentOutcome.Invalid);
        (await t.RunAsync(s => s.ListAsync(null, null, "not-a-guid", null, null))).Outcome.Should().Be(StaffContentOutcome.Invalid);
        (await t.RunAsync(s => s.ListAsync(null, null, null, null, 0))).Outcome.Should().Be(StaffContentOutcome.Invalid);
        (await t.RunAsync(s => s.ListAsync(null, null, null, null, StaffContentService.MaxListLimit + 1)))
            .Outcome.Should().Be(StaffContentOutcome.Invalid);
    }

    [Fact]
    public async Task AnotherExercisesItem_IsIndistinguishableFromAnUnknownId_OnEveryRoute()
    {
        using var t = Harness.Create();
        var theirs = await t.CreateInOtherExerciseAsync();

        foreach (var id in new[] { theirs, Guid.NewGuid() })
        {
            (await t.RunAsync(s => s.GetAsync(id))).Should().Be(StaffContentResult.NotFound);
            (await t.RunAsync(s => s.PreviewAsync(id))).Should().Be(StaffContentResult.NotFound);
            (await t.RunAsync(s => s.PublishAsync(id, null))).Should().Be(StaffContentResult.NotFound);
            (await t.RunAsync(s => s.DeleteAsync(id))).Should().Be(StaffContentResult.NotFound);
            (await t.RunAsync(s => s.FeatureAsync(id, new ContentFeatureRequest { Rank = 1 }))).Should().Be(StaffContentResult.NotFound);
            (await t.RunAsync(s => s.ReorderFeaturedAsync(new ContentFeatureReorderRequest { Ids = [id] })))
                .Outcome.Should().Be(StaffContentOutcome.NotFound);
        }

        (await t.ListAsync()).Should().BeEmpty("another exercise's items are never listed");
    }

    [Fact]
    public async Task Edit_IsVersioned_AndOnlyForDraftOrScheduled()
    {
        using var t = Harness.Create();
        var id = await t.CreateAsync("Original");

        var edited = await t.OkAsync(s => s.UpdateAsync(id, t.F.Request("Edited") with { Version = 1 }));
        edited.Headline.Should().Be("Edited");
        edited.Version.Should().Be(2);

        var stale = await t.RunAsync(s => s.UpdateAsync(id, t.F.Request("Stale") with { Version = 1 }));
        stale.Outcome.Should().Be(StaffContentOutcome.Conflict);
        stale.Current!.Headline.Should().Be("Edited", "a 409 carries the item as it is now");

        await t.OkAsync(s => s.PublishAsync(id, null));
        var published = await t.RunAsync(s => s.UpdateAsync(id, t.F.Request("Too late") with { Version = 3 }));
        published.Outcome.Should().Be(StaffContentOutcome.Conflict, "a published item changes via revise");
        published.Current!.Status.Should().Be("published");

        (await t.RunAsync(s => s.UpdateAsync(id, null))).Outcome.Should().Be(StaffContentOutcome.Invalid);
        (await t.RunAsync(s => s.CreateAsync(t.F.Request() with { OutletId = t.F.PressOutletId.ToString() })))
            .Outcome.Should().Be(StaffContentOutcome.Invalid, "an article's outlet must be a news outlet in scope");
        (await t.RunAsync(s => s.CreateAsync(t.F.Request() with { OutletId = t.F.OtherOutletId.ToString() })))
            .Outcome.Should().Be(StaffContentOutcome.Invalid, "another exercise's outlet is not in scope");
    }

    [Fact]
    public async Task Publish_ReturnsTheItemAndItsSideEffectWarnings()
    {
        using var t = Harness.Create(withAlertRaiser: false);
        var id = await t.CreateAsync();

        var result = await t.RunAsync(s => s.PublishAsync(
            id, new PublishOptions { Alert = new PublishAlertOptions { Severity = "warning", Headline = "Bridge closed" } }));

        result.Outcome.Should().Be(StaffContentOutcome.Ok);
        var response = result.Value.Should().BeOfType<ContentPublishResponse>().Subject;
        response.Item.Status.Should().Be("published");
        response.SideEffectWarnings.Should().Equal(ContentPublishService.NoAlertSourceMessage);

        var again = await t.RunAsync(s => s.PublishAsync(id, null));
        again.Outcome.Should().Be(StaffContentOutcome.Conflict, "an illegal transition is a 409");
        again.Current!.Status.Should().Be("published");
        again.Errors.Should().ContainSingle().Which.Should().Contain("published");
    }

    [Fact]
    public async Task Schedule_RefusesAPastInstant_AndPersistsTheOptionsForReplay()
    {
        using var t = Harness.Create();
        var id = await t.CreateAsync();
        var past = FunnelHarness.WallStart.AddMinutes(-1).ToString("O");

        var refused = await t.RunAsync(s => s.ScheduleAsync(id, new ContentScheduleRequest { ScenarioTime = past }));
        refused.Outcome.Should().Be(StaffContentOutcome.Invalid);
        refused.Errors.Should().Equal(StaffContentService.SchedulePastMessage);
        (await t.RunAsync(s => s.ScheduleAsync(id, new ContentScheduleRequest()))).Outcome.Should().Be(StaffContentOutcome.Invalid);
        (await t.RunAsync(s => s.ScheduleAsync(id, new ContentScheduleRequest { ScenarioTime = "tomorrow" })))
            .Outcome.Should().Be(StaffContentOutcome.Invalid);

        var scheduled = await t.OkAsync(s => s.ScheduleAsync(id, new ContentScheduleRequest
        {
            ScenarioTime = t.Future(),
            Options = new PublishOptions { PairedPost = new PairedPostOptions { Text = "Read more" } },
        }));

        scheduled.Status.Should().Be("scheduled");
        (await t.F.ItemAsync(scheduled.Id)).PublishOptionsJson.Should().Contain("Read more", "FC-7a: the runner replays them");

        var unscheduled = await t.OkAsync(s => s.UnscheduleAsync(id));
        unscheduled.Status.Should().Be("draft");
    }

    [Fact]
    public async Task Revise_MovesTheUpdatedStampByDefault_AndNotWhenTouchUpdatedStampIsFalse()
    {
        using var t = Harness.Create();
        var item = await t.CreatePublishedAsync("Bridge closed");
        var id = Guid.Parse(item.Id);

        var updated = await t.OkAsync(s => s.ReviseAsync(id, new ContentReviseRequest
        {
            Kind = "update",
            Note = "Reopened one lane",
            Fields = t.F.Request("Bridge partly reopened") with { Version = item.Version },
        }));
        updated.UpdatedScenarioTime.Should().NotBeNull();
        updated.Revisions.Should().ContainSingle(r => r.Kind == "update");

        var payloadOnly = await t.OkAsync(s => s.ReviseAsync(id, new ContentReviseRequest
        {
            Kind = "silent_rewrite",
            Fields = t.F.Request("Bridge partly reopened") with { Version = updated.Version },
            TouchUpdatedStamp = false,
        }));
        payloadOnly.UpdatedScenarioTime.Should().Be(updated.UpdatedScenarioTime);

        // The featured rank belongs to feature / reorder: a revise whose fields omit (or change) it keeps the stored one.
        var featured = await t.OkAsync(s => s.FeatureAsync(id, new ContentFeatureRequest { Rank = 3 }));
        var revisedAgain = await t.OkAsync(s => s.ReviseAsync(id, new ContentReviseRequest
        {
            Kind = "correction",
            Note = "Corrected the lane count",
            Fields = t.F.Request("Bridge reopened") with { Version = featured.Version, FeaturedRank = null },
        }));
        revisedAgain.FeaturedRank.Should().Be(3);

        (await t.RunAsync(s => s.ReviseAsync(id, new ContentReviseRequest { Kind = "update" })))
            .Outcome.Should().Be(StaffContentOutcome.Invalid, "fields are required");
        (await t.RunAsync(s => s.ReviseAsync(id, new ContentReviseRequest
        {
            Kind = "edit", Fields = t.F.Request() with { Version = payloadOnly.Version },
        }))).Outcome.Should().Be(StaffContentOutcome.Invalid);
    }

    [Fact]
    public async Task RetractRestoreDelete_GoThroughTheFunnel_AndADeletedPublishedItemFiresContentRetracted()
    {
        using var t = Harness.Create();
        var item = await t.CreatePublishedAsync();
        var id = Guid.Parse(item.Id);

        (await t.OkAsync(s => s.RetractAsync(id))).Status.Should().Be("retracted");
        (await t.OkAsync(s => s.RestoreAsync(id))).Status.Should().Be("published");
        t.F.Broadcaster.Retracted.Should().HaveCount(1);

        (await t.RunAsync(s => s.DeleteAsync(id))).Should().Be(StaffContentResult.Deleted);
        t.F.Broadcaster.Retracted.Should().HaveCount(2, "a deleted published item also fires ContentRetracted");
        (await t.RunAsync(s => s.GetAsync(id))).Should().Be(StaffContentResult.NotFound);

        var events = await t.F.EventsAsync();
        events.Should().OnlyContain(e => e.Actor.ActingHumanId == StaffUserId.ToString(), "the funnel emits, as the session's human");
    }

    [Fact]
    public async Task Preview_IsTheParticipantShape_ForADraft_AndTheTombstoneForARetractedItem()
    {
        using var t = Harness.Create();
        var draft = await t.CreateAsync("Draft headline");

        var preview = await t.RunAsync(s => s.PreviewAsync(draft));
        var dto = preview.Value.Should().BeOfType<ChannelContentDto>().Subject;
        dto.Headline.Should().Be("Draft headline");
        dto.State.Should().Be("published", "the console previews what a participant would see once it is live");
        dto.PublishedScenarioTime.Should().Be(
            ContentProjector.Iso(t.F.Time.GetUtcNow()), "an unpublished item shows 'now' in scenario time (the clock falls back to it)");
        var json = JsonSerializer.SerializeToElement<object>(dto);
        foreach (var staffOnly in new[] { "status", "origin", "actingHumanId", "version", "background", "featuredRank", "revisionLog" })
        {
            json.TryGetProperty(staffOnly, out _).Should().BeFalse("{0} is staff-only (XC-002)", staffOnly);
        }

        // The payload is the KIND's participant projection, never the raw stored payload (XC-002).
        t.F.Article.Project = payload => new JsonObject { ["public"] = payload["breaking"]?.DeepClone() };
        var projected = (ChannelContentDto)(await t.RunAsync(s => s.PreviewAsync(draft))).Value!;
        projected.Payload.Should().ContainKey("public").And.NotContainKey("breaking");
        t.F.Article.Project = null;

        var scheduled = await t.CreateAsync("Later");
        var at = t.Future();
        await t.OkAsync(s => s.ScheduleAsync(scheduled, new ContentScheduleRequest { ScenarioTime = at }));
        ((ChannelContentDto)(await t.RunAsync(s => s.PreviewAsync(scheduled))).Value!).PublishedScenarioTime
            .Should().Be(DateTimeOffset.Parse(at, System.Globalization.CultureInfo.InvariantCulture).ToString("O"));

        var retracted = await t.CreatePublishedAsync("Gone");
        await t.OkAsync(s => s.RetractAsync(Guid.Parse(retracted.Id)));
        var tombstone = (await t.RunAsync(s => s.PreviewAsync(Guid.Parse(retracted.Id)))).Value
            .Should().BeOfType<ChannelContentTombstoneDto>().Subject;
        tombstone.State.Should().Be("retracted");
        tombstone.Permalink.Should().Be(retracted.Permalink);
    }

    [Fact]
    public async Task Feature_SetsAndClearsTheRank_OnlyOnAPublishedItem_WithOneEventAndNoRevision()
    {
        using var t = Harness.Create();
        var draft = await t.CreateAsync();
        var item = await t.CreatePublishedAsync();
        var id = Guid.Parse(item.Id);

        var refused = await t.RunAsync(s => s.FeatureAsync(draft, new ContentFeatureRequest { Rank = 1 }));
        refused.Outcome.Should().Be(StaffContentOutcome.Conflict);
        refused.Current!.Status.Should().Be("draft");
        (await t.RunAsync(s => s.FeatureAsync(id, new ContentFeatureRequest { Rank = 0 }))).Outcome.Should().Be(StaffContentOutcome.Invalid);
        (await t.RunAsync(s => s.FeatureAsync(id, null))).Outcome.Should().Be(StaffContentOutcome.Invalid);

        var before = (await t.F.EventsAsync()).Count;
        var featured = await t.OkAsync(s => s.FeatureAsync(id, new ContentFeatureRequest { Rank = 1 }));
        featured.Featured.Should().BeTrue();
        featured.FeaturedRank.Should().Be(1);
        featured.Version.Should().Be(item.Version + 1);
        featured.UpdatedScenarioTime.Should().Be(item.UpdatedScenarioTime, "featuring moves no Updated stamp");
        (await t.F.RevisionsAsync(item.Id)).Should().HaveCount(item.RevisionLog.Count, "featuring writes no revision");

        var events = await t.F.EventsAsync();
        events.Should().HaveCount(before + 1);
        events[^1].EventType.Should().Be("content_revised");
        events[^1].Payload.Should().Contain("\"action\":\"feature\"");

        (await t.OkAsync(s => s.FeatureAsync(id, new ContentFeatureRequest { Rank = 1 }))).Version
            .Should().Be(featured.Version, "an unchanged rank is a no-op");
        (await t.OkAsync(s => s.FeatureAsync(id, new ContentFeatureRequest { Rank = null }))).Featured.Should().BeFalse();
    }

    [Fact]
    public async Task Reorder_SetsTheChannelsWholeFeaturedOrder_Atomically()
    {
        using var t = Harness.Create();
        var a = Guid.Parse((await t.CreatePublishedAsync("A")).Id);
        var b = Guid.Parse((await t.CreatePublishedAsync("B")).Id);
        var c = Guid.Parse((await t.CreatePublishedAsync("C")).Id);
        await t.OkAsync(s => s.FeatureAsync(c, new ContentFeatureRequest { Rank = 1 }));
        var draft = await t.CreateAsync("Not live");
        var gone = Guid.Parse((await t.CreatePublishedAsync("Gone")).Id);
        await t.OkAsync(s => s.FeatureAsync(gone, new ContentFeatureRequest { Rank = 2 }));
        await t.OkAsync(s => s.RetractAsync(gone));

        var aBefore = (await t.F.ItemAsync(a.ToString())).Version;

        var result = await t.RunAsync(s => s.ReorderFeaturedAsync(new ContentFeatureReorderRequest { Ids = [b, a] }));

        result.Outcome.Should().Be(StaffContentOutcome.Ok);
        var items = result.Value.Should().BeAssignableTo<IReadOnlyList<ChannelContentStaffDto>>().Subject;
        items.Select(i => (i.Headline, i.FeaturedRank)).Should().Equal(("B", 1), ("A", 2));
        (await t.F.ItemAsync(c.ToString())).FeaturedRank.Should().BeNull("an item left off the list leaves the featured slot");
        (await t.F.ItemAsync(gone.ToString())).FeaturedRank.Should().BeNull("a retracted item must not come back on restore at a given-away rank");
        (await t.F.ItemAsync(a.ToString())).Version.Should().Be(aBefore + 1);

        // A stale (not published) or unknown id refuses the WHOLE reorder; nothing is applied.
        var stale = await t.RunAsync(s => s.ReorderFeaturedAsync(new ContentFeatureReorderRequest { Ids = [a, draft] }));
        stale.Outcome.Should().Be(StaffContentOutcome.Conflict);
        stale.Current!.Id.Should().Be(draft.ToString());
        var unknown = await t.RunAsync(s => s.ReorderFeaturedAsync(new ContentFeatureReorderRequest { Ids = [a, Guid.NewGuid()] }));
        unknown.Outcome.Should().Be(StaffContentOutcome.NotFound);
        (await t.F.ItemAsync(a.ToString())).FeaturedRank.Should().Be(2);
        (await t.F.ItemAsync(b.ToString())).FeaturedRank.Should().Be(1);

        (await t.RunAsync(s => s.ReorderFeaturedAsync(new ContentFeatureReorderRequest { Ids = [a, a] })))
            .Outcome.Should().Be(StaffContentOutcome.Invalid);
        (await t.RunAsync(s => s.ReorderFeaturedAsync(new ContentFeatureReorderRequest { Ids = [] })))
            .Outcome.Should().Be(StaffContentOutcome.Invalid, "clearing needs the channel");
        (await t.RunAsync(s => s.ReorderFeaturedAsync(new ContentFeatureReorderRequest { Ids = [a], Channel = "press" })))
            .Outcome.Should().Be(StaffContentOutcome.Invalid, "the ids must be items of the named channel");
        (await t.RunAsync(s => s.ReorderFeaturedAsync(null))).Outcome.Should().Be(StaffContentOutcome.Invalid);

        // A listed item whose rank does not change still moves its version when anything else in the call changes, so
        // a concurrent retract of it would fail the save (the "all listed are published" check holds at commit).
        var bBefore = (await t.F.ItemAsync(b.ToString())).Version;
        (await t.RunAsync(s => s.ReorderFeaturedAsync(new ContentFeatureReorderRequest { Ids = [b] })))
            .Outcome.Should().Be(StaffContentOutcome.Ok);
        (await t.F.ItemAsync(b.ToString())).FeaturedRank.Should().Be(1);
        (await t.F.ItemAsync(b.ToString())).Version.Should().Be(bBefore + 1, "b stayed at rank 1 but a left the slot");
        (await t.F.ItemAsync(a.ToString())).FeaturedRank.Should().BeNull();

        (await t.RunAsync(s => s.ReorderFeaturedAsync(new ContentFeatureReorderRequest { Ids = [], Channel = "news" })))
            .Outcome.Should().Be(StaffContentOutcome.Ok);
        (await t.ListAsync()).Should().OnlyContain(i => i.FeaturedRank == null, "an empty list clears the channel's slot");
    }

    private static CurrentStaffSession Staff() => new() { SessionId = Guid.NewGuid(), StaffUserId = StaffUserId };

    /// <summary>A funnel harness with a switchable staff session and the staff service resolvable per scope.</summary>
    private sealed class Harness : IDisposable
    {
        private Harness(FunnelHarness funnel, SessionHolder session)
        {
            F = funnel;
            Session = session;
        }

        public FunnelHarness F { get; }

        public SessionHolder Session { get; }

        public static Harness Create(bool withAlertRaiser = true)
        {
            var session = new SessionHolder { Current = Staff() };
            var funnel = FunnelHarness.Create(
                services => services.Replace(ServiceDescriptor.Singleton<ICurrentStaffSessionAccessor>(session)),
                withAlertRaiser: withAlertRaiser);
            return new Harness(funnel, session);
        }

        public async Task<StaffContentResult> RunAsync(Func<StaffContentService, Task<StaffContentResult>> call)
        {
            F.Time.Advance(TimeSpan.FromSeconds(1)); // successive creates are ordered
            using var scope = F.InA();
            return await call(scope.Services.GetRequiredService<StaffContentService>());
        }

        public async Task<ChannelContentStaffDto> OkAsync(Func<StaffContentService, Task<StaffContentResult>> call)
        {
            var result = await RunAsync(call);
            result.Outcome.Should().BeOneOf(
                new[] { StaffContentOutcome.Ok, StaffContentOutcome.Created }, string.Join("; ", result.Errors ?? []));
            return result.Value as ChannelContentStaffDto ?? ((ContentPublishResponse)result.Value!).Item;
        }

        public async Task<Guid> CreateAsync(string headline = "Bridge closed after overnight flooding") =>
            Guid.Parse((await OkAsync(s => s.CreateAsync(F.Request(headline)))).Id);

        public async Task<ChannelContentStaffDto> CreatePublishedAsync(string headline = "Bridge closed after overnight flooding")
        {
            var id = await CreateAsync(headline);
            return await OkAsync(s => s.PublishAsync(id, null));
        }

        public async Task<Guid> CreateInOtherExerciseAsync()
        {
            using var scope = F.In(F.OtherExerciseId);
            var result = await scope.Services.GetRequiredService<StaffContentService>()
                .CreateAsync(F.Request() with { OutletId = F.OtherOutletId.ToString() });
            result.Outcome.Should().Be(StaffContentOutcome.Created);
            return Guid.Parse(((ChannelContentStaffDto)result.Value!).Id);
        }

        public async Task<IReadOnlyList<ChannelContentStaffDto>> ListAsync(
            string? channel = null, string? status = null, string? outlet = null, string? kind = null, int? limit = null)
        {
            var result = await RunAsync(s => s.ListAsync(channel, status, outlet, kind, limit));
            result.Outcome.Should().Be(StaffContentOutcome.Ok);
            return (IReadOnlyList<ChannelContentStaffDto>)result.Value!;
        }

        public string Future() => F.Time.GetUtcNow().AddHours(2).ToString("O");

        public void Dispose() => F.Dispose();
    }

    private sealed class SessionHolder : ICurrentStaffSessionAccessor
    {
        public CurrentStaffSession? Current { get; set; }

        public Task<CurrentStaffSession?> GetCurrentStaffSessionAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(Current);
    }
}
