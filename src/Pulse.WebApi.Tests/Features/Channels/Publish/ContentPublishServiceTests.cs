namespace Pulse.WebApi.Tests.Features.Channels.Publish;

using System;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;
using Xunit;

/// <summary>
/// channels-foundation story 04 (#700): the publish funnel's acceptance criteria, over the EF in-memory provider wired
/// through <c>AddChannels()</c> (Docker-free). Isolation has its own file (<see cref="ContentPublishIsolationTests"/>).
/// </summary>
public sealed class ContentPublishServiceTests
{
    // ---- Status machine (FC-1) ------------------------------------------------------------------------------------

    [Fact]
    public async Task AnIllegalTransition_IsAConflictCarryingTheCurrentState()
    {
        using var harness = FunnelHarness.Create();
        var draft = await harness.CreateAsync();

        using var scope = harness.InA();
        var result = await scope.Funnel.RetractAsync(Guid.Parse(draft.Id), FunnelHarness.Controller);

        result.Outcome.Should().Be(ContentPublishOutcome.Conflict);
        result.Item!.Status.Should().Be("draft", "the 409 carries the item as it is");
        result.Errors.Should().ContainSingle().Which.Should().Contain("retract").And.Contain("draft");
        (await harness.EventsAsync()).Should().BeEmpty();
    }

    [Fact]
    public async Task TheAllowedTransitions_Succeed_AndEachBumpsTheVersion()
    {
        using var harness = FunnelHarness.Create();
        var draft = await harness.CreateAsync();
        var id = Guid.Parse(draft.Id);
        draft.Version.Should().Be(1);

        using var scope = harness.InA();
        var funnel = scope.Funnel;
        var steps = new Func<Task<ContentPublishResult>>[]
        {
            () => funnel.ScheduleAsync(id, "2033-09-04T09:00:00Z", null, FunnelHarness.Controller),
            () => funnel.UnscheduleAsync(id, FunnelHarness.Controller),
            () => funnel.ScheduleAsync(id, "2033-09-04T09:00:00Z", null, FunnelHarness.Controller),
            () => funnel.PublishAsync(id, null, FunnelHarness.Controller),
            () => funnel.RetractAsync(id, FunnelHarness.Controller),
            () => funnel.RestoreAsync(id, FunnelHarness.Controller),
        };
        var expected = new[] { "scheduled", "draft", "scheduled", "published", "retracted", "published" };

        var version = 1;
        for (var i = 0; i < steps.Length; i++)
        {
            var result = await steps[i]();
            result.Outcome.Should().Be(ContentPublishOutcome.Ok, "step {0}: {1}", i, string.Join(";", result.Errors));
            result.Item!.Status.Should().Be(expected[i]);
            result.Item.Version.Should().Be(++version, "every state change bumps Version");
        }
    }

    [Fact]
    public async Task AStaleVersion_IsAConflict()
    {
        using var harness = FunnelHarness.Create();
        var draft = await harness.CreateAsync();

        using var scope = harness.InA();
        var result = await scope.Funnel.UpdateDraftAsync(
            Guid.Parse(draft.Id), harness.Request("New headline") with { Version = 0 }, FunnelHarness.Controller);

        result.Outcome.Should().Be(ContentPublishOutcome.Conflict);
        result.Errors.Should().Contain(ContentPublishService.StaleVersionMessage);
        (await harness.ItemAsync(draft.Id)).Headline.Should().Be(draft.Headline);
    }

    [Fact]
    public async Task TwoSimultaneousPublishes_YieldExactlyOneContentPublished()
    {
        using var harness = FunnelHarness.Create();
        var draft = await harness.CreateAsync();
        var id = Guid.Parse(draft.Id);

        // The first publish loads the draft and parks inside the gate (after the read, before its save) while a second,
        // independent publish goes all the way through. The first then resumes with a stale concurrency token.
        var parked = new TestGate(ContentPublishGateDecision.Allow()) { Entered = new(), Release = new() };
        harness.Gates.Add(parked);
        using var first = harness.InA();
        var racing = first.Funnel.PublishAsync(id, null, FunnelHarness.Controller);
        await parked.Entered.Task;

        harness.Gates.Clear();
        using (var second = harness.InA())
        {
            (await second.Funnel.PublishAsync(id, null, FunnelHarness.Controller)).Outcome.Should().Be(ContentPublishOutcome.Ok);
        }

        parked.Release.SetResult();
        var lost = await racing;

        lost.Outcome.Should().Be(ContentPublishOutcome.Conflict, "the loser is refused by the concurrency token");
        lost.Item!.Status.Should().Be("published");
        harness.Broadcaster.Published.Should().ContainSingle("exactly one ContentPublished");
        harness.Observer.Calls.Should().ContainSingle();

        // The in-memory provider has no transactions, so the loser's telemetry row is not rolled back here; on SQL Server
        // it is (one SaveChanges, one transaction) — ContentPublishSqlTests pins "exactly one content_published" there.
    }

    // ---- Server-stamped scenario time (COR-053) -------------------------------------------------------------------

    [Fact]
    public async Task Publish_StampsTheExerciseClock_NeverAClientValue_AndKeepsTheWallClockForStaff()
    {
        using var harness = FunnelHarness.Create();
        harness.Clock.Start(harness.ExerciseId, FunnelHarness.ScenarioStart, TimeZoneInfo.Utc);
        harness.Time.Advance(TimeSpan.FromMinutes(42));
        var draft = await harness.CreateAsync(request: harness.Request() with { ScheduledScenarioTime = "1999-01-01T00:00:00Z" });

        using var scope = harness.InA();
        var result = await scope.Funnel.PublishAsync(Guid.Parse(draft.Id), null, FunnelHarness.Controller);

        var item = await harness.ItemAsync(draft.Id);
        item.PublishedScenarioTime.Should().Be(FunnelHarness.ScenarioStart.AddMinutes(42));
        item.PublishedWallClock.Should().Be(FunnelHarness.WallStart.AddMinutes(42));
        item.ScheduledScenarioTime.Should().BeNull("a write request's scheduledScenarioTime is never a stamp");
        harness.Broadcaster.Published.Single().PublishedScenarioTime.Should().Be(result.Item!.PublishedScenarioTime);
        var published = (await harness.EventsAsync()).Single();
        published.ScenarioTime.Should().Be(item.PublishedScenarioTime!.Value);
        published.WallClockTime.Should().Be(item.PublishedWallClock!.Value);
        published.TimeZone.Should().Be("America/New_York");
    }

    [Fact]
    public async Task WithNoStartedClock_TheExerciseRowsScenarioTime_IsTheFallback_ThenNow()
    {
        using var harness = FunnelHarness.Create();
        var draft = await harness.CreateAsync();
        var stored = new DateTimeOffset(2033, 9, 4, 6, 30, 0, TimeSpan.Zero);
        using (var seed = harness.InA())
        {
            (await seed.Db.Exercises.SingleAsync(e => e.Id == harness.ExerciseId)).CurrentScenarioTime = stored;
            await seed.Db.SaveChangesAsync();
        }

        using (var scope = harness.InA())
        {
            await scope.Funnel.PublishAsync(Guid.Parse(draft.Id), null, FunnelHarness.Controller);
        }

        (await harness.ItemAsync(draft.Id)).PublishedScenarioTime.Should().Be(stored);
        draft.PublishedScenarioTime.Should().BeNull();
        (await harness.ItemAsync(draft.Id)).CreatedScenarioTime.Should().Be(FunnelHarness.WallStart, "no clock, no row value: now");
    }

    [Fact]
    public async Task AScheduledItem_KeepsItsScheduledScenarioTime_UntilPublished()
    {
        using var harness = FunnelHarness.Create();
        harness.Clock.Start(harness.ExerciseId, FunnelHarness.ScenarioStart, TimeZoneInfo.Utc);
        var draft = await harness.CreateAsync();
        var id = Guid.Parse(draft.Id);

        using var scope = harness.InA();
        var scheduled = await scope.Funnel.ScheduleAsync(id, "2033-09-04T10:00:00Z", null, FunnelHarness.Controller);

        scheduled.Item!.ScheduledScenarioTime.Should().StartWith("2033-09-04T10:00:00");
        scheduled.Item.PublishedScenarioTime.Should().BeNull();
        harness.Broadcaster.Published.Should().BeEmpty("a scheduled item is not visible to participants");

        harness.Time.Advance(TimeSpan.FromMinutes(5));
        var published = await scope.Funnel.PublishAsync(id, null, FunnelHarness.Controller);
        (await harness.ItemAsync(draft.Id)).PublishedScenarioTime.Should().Be(
            FunnelHarness.ScenarioStart.AddMinutes(5), "the runner's publish is stamped by the clock, not the schedule");
        published.Outcome.Should().Be(ContentPublishOutcome.Ok);
    }

    [Fact]
    public async Task AnUnparseableScheduleTime_IsAReadable400()
    {
        using var harness = FunnelHarness.Create();
        var draft = await harness.CreateAsync();

        using var scope = harness.InA();
        var result = await scope.Funnel.ScheduleAsync(Guid.Parse(draft.Id), "soon", null, FunnelHarness.Controller);

        result.Outcome.Should().Be(ContentPublishOutcome.Invalid);
        result.Errors.Single().Should().Contain("ISO-8601");
    }

    // ---- Sanitization and validation (NFR-004) --------------------------------------------------------------------

    [Fact]
    public async Task TheBody_IsSanitizedOnceAtWrite_ByTheKindsNamedProfile()
    {
        using var harness = FunnelHarness.Create();
        var request = harness.Request() with
        {
            Headline = "<b>Flood</b> warning<script>x()</script>",
            BodyHtml = "<p onclick=\"steal()\">Stay <a href=\"javascript:alert(1)\">home</a></p><script>alert(1)</script>"
                + "<table><tr><td>t</td></tr></table>",
        };

        var article = await harness.CreateAsync(request: request);
        var release = await harness.CreateAsync(request: request with { Kind = "release", OutletId = harness.PressOutletId.ToString() });

        article.BodyHtml.Should().Be("<p>Stay <a rel=\"noopener noreferrer nofollow\">home</a></p>t", "article is rich-basic");
        release.BodyHtml.Should().Be(
            "<p>Stay <a rel=\"noopener noreferrer nofollow\">home</a></p><table><tr><td>t</td></tr></table>", "release is rich-tables");
        article.Headline.Should().Be("Flood warning", "text fields are stripped like a post");
        article.Slug.Should().Be("flood-warning");
    }

    [Fact]
    public async Task AnInvalidPayload_IsAReadable400_ValidatedWithAnExerciseScopedContext()
    {
        using var harness = FunnelHarness.Create();

        using var scope = harness.InA();
        var result = await scope.Funnel.CreateDraftAsync(
            harness.Request() with { Payload = new JsonObject { ["invalid"] = true } }, FunnelHarness.Controller);

        result.Outcome.Should().Be(ContentPublishOutcome.Invalid);
        result.Errors.Should().ContainSingle("payload.invalid must not be set.");
        harness.Article.LastContext!.ExerciseId.Should().Be(harness.ExerciseId);
        harness.Article.LastContext.TargetStatus.Should().Be("draft");
        harness.Article.LastContext.ContentItemId.Should().BeNull();
        (await scope.Db.ContentItems.CountAsync()).Should().Be(0, "a refused write writes nothing");
    }

    [Fact]
    public async Task AnUnregisteredKind_OrAMissingHeadline_IsA400()
    {
        using var harness = FunnelHarness.Create();
        using var scope = harness.InA();

        (await scope.Funnel.CreateDraftAsync(harness.Request() with { Kind = "podcast" }, FunnelHarness.Controller))
            .Errors.Single().Should().Contain("podcast");
        (await scope.Funnel.CreateDraftAsync(harness.Request() with { Headline = "<b></b>  " }, FunnelHarness.Controller))
            .Errors.Should().Contain("headline is required.");
        (await scope.Funnel.CreateDraftAsync(
                harness.Request() with { OutletId = harness.PressOutletId.ToString() }, FunnelHarness.Controller))
            .Errors.Single().Should().Contain("news outlet", "an article cannot be filed under a press outlet");
    }

    [Fact]
    public async Task Media_MustBeInScopeAssetsOfAnAllowedKind_WithAltText()
    {
        using var harness = FunnelHarness.Create();
        Guid image;
        Guid document;
        using (var seed = harness.InA())
        {
            var asset = Pulse.WebApi.Tests.Data.ChannelRows.MediaAsset(harness.ExerciseId);
            var pdf = Pulse.WebApi.Tests.Data.ChannelRows.MediaAsset(harness.ExerciseId);
            pdf.Kind = MediaKinds.Document;
            seed.Db.MediaAssets.AddRange(asset, pdf);
            await seed.Db.SaveChangesAsync();
            (image, document) = (asset.Id, pdf.Id);
        }

        using var scope = harness.InA();
        var ok = await scope.Funnel.CreateDraftAsync(
            harness.Request() with
            {
                HeroMediaId = image.ToString(),
                Media = [new ContentMediaWriteRequest { MediaId = image.ToString(), Role = "hero", Alt = "<i>A</i> flooded bridge" }],
            },
            FunnelHarness.Controller);
        var pdfRefused = await scope.Funnel.CreateDraftAsync(
            harness.Request() with { Media = [new ContentMediaWriteRequest { MediaId = document.ToString(), Alt = "Order" }] },
            FunnelHarness.Controller);
        var noAlt = await scope.Funnel.CreateDraftAsync(
            harness.Request() with { Media = [new ContentMediaWriteRequest { MediaId = image.ToString() }] },
            FunnelHarness.Controller);

        ok.Outcome.Should().Be(ContentPublishOutcome.Ok);
        ok.Item!.Hero!.Alt.Should().Be("A flooded bridge");
        ok.Item.Media.Should().ContainSingle().Which.Role.Should().Be("hero");
        pdfRefused.Errors.Single().Should().Contain("cannot attach document");
        noAlt.Errors.Single().Should().Contain("alt text is required");
    }

    // ---- Revisions and the Updated stamp --------------------------------------------------------------------------

    [Theory]
    [InlineData("update")]
    [InlineData("correction")]
    public async Task UpdateAndCorrection_SnapshotAddAVisibleMarker_AndMoveTheStamp(string kind)
    {
        using var harness = FunnelHarness.Create();
        harness.Clock.Start(harness.ExerciseId, FunnelHarness.ScenarioStart, TimeZoneInfo.Utc);
        var published = await harness.CreatePublishedAsync();
        harness.Time.Advance(TimeSpan.FromMinutes(30));

        using var scope = harness.InA();
        var result = await scope.Funnel.ReviseAsync(
            Guid.Parse(published.Id),
            new ReviseOptions
            {
                Kind = kind,
                Note = "Corrects the <b>closure</b> time.",
                Fields = harness.Request("Bridge reopens after overnight flooding") with { Version = published.Version },
            },
            FunnelHarness.Controller);

        result.Outcome.Should().Be(ContentPublishOutcome.Ok);
        result.Item!.Status.Should().Be("published", "a revise keeps the item published");
        result.Item.Slug.Should().Be(published.Slug, "the permalink is immutable once published");
        result.Item.RevisionCount.Should().Be(1);
        result.Item.UpdatedScenarioTime.Should().Be(ContentProjector.Iso(FunnelHarness.ScenarioStart.AddMinutes(30)));
        result.Item.Revisions.Should().ContainSingle().Which.Should().BeEquivalentTo(
            new ContentRevisionDto { Number = 1, Kind = kind, ScenarioTime = result.Item.UpdatedScenarioTime!, Note = "Corrects the closure time." });

        var revision = (await harness.RevisionsAsync(published.Id)).Single();
        revision.Visible.Should().BeTrue();
        JsonDocument.Parse(revision.SnapshotJson).RootElement.GetProperty("headline").GetString()
            .Should().Be("Bridge closed after overnight flooding", "the snapshot holds the fields as they were");
        harness.Broadcaster.Revised.Single().Revisions.Should().ContainSingle();
        harness.Observer.Calls.Select(c => c.Event).Should().Equal("published", "revised");
        (await harness.EventsAsync()).Last().EventType.Should().Be("content_revised");
    }

    [Fact]
    public async Task SilentRewrite_SwapsTheContent_WithNoNoteAndNoParticipantEntry_ButMovesTheStamp()
    {
        using var harness = FunnelHarness.Create();
        harness.Clock.Start(harness.ExerciseId, FunnelHarness.ScenarioStart, TimeZoneInfo.Utc);
        var published = await harness.CreatePublishedAsync();
        harness.Time.Advance(TimeSpan.FromMinutes(5));

        using var scope = harness.InA();
        var result = await scope.Funnel.ReviseAsync(
            Guid.Parse(published.Id),
            new ReviseOptions
            {
                Kind = "silent_rewrite",
                Note = "should be dropped",
                Fields = harness.Request("Quietly rewritten") with { Version = published.Version },
            },
            FunnelHarness.Controller);

        result.Item!.Headline.Should().Be("Quietly rewritten");
        result.Item.Revisions.Should().BeEmpty("silent_rewrite never reaches the participant revisions[]");
        result.Item.RevisionLog.Should().ContainSingle().Which.Should().Match<ContentRevisionDto>(r => r.Kind == "silent_rewrite" && r.Note == null);
        result.Item.UpdatedScenarioTime.Should().NotBeNull("all three revise kinds move the Updated stamp (FC-1)");
        harness.Broadcaster.Revised.Single().Revisions.Should().BeEmpty();
    }

    [Fact]
    public async Task TouchUpdatedStampFalse_MovesNothingParticipantVisible()
    {
        using var harness = FunnelHarness.Create();
        var published = await harness.CreatePublishedAsync();

        using var scope = harness.InA();
        var result = await scope.Funnel.ReviseAsync(
            Guid.Parse(published.Id),
            new ReviseOptions
            {
                Kind = "update",
                Note = "banner",
                TouchUpdatedStamp = false,
                Fields = harness.Request() with { Version = published.Version, Payload = new JsonObject { ["breaking"] = true } },
            },
            FunnelHarness.Controller);

        result.Item!.UpdatedScenarioTime.Should().BeNull();
        result.Item.Revisions.Should().BeEmpty();
        result.Item.RevisionLog.Should().ContainSingle("the staff log still records the change");
        result.Item.Payload["breaking"]!.GetValue<bool>().Should().BeTrue();
    }

    [Fact]
    public async Task DraftEdits_AreEditRevisions_ThatNeverMoveTheStamp_AndEditIsRefusedOnAPublishedItem()
    {
        using var harness = FunnelHarness.Create();
        var draft = await harness.CreateAsync();

        using var scope = harness.InA();
        var edited = await scope.Funnel.UpdateDraftAsync(
            Guid.Parse(draft.Id), harness.Request("Second draft headline") with { Version = 1 }, FunnelHarness.Controller);

        edited.Item!.RevisionLog.Should().ContainSingle().Which.Kind.Should().Be("edit");
        edited.Item.Revisions.Should().BeEmpty();
        edited.Item.UpdatedScenarioTime.Should().BeNull();
        edited.Item.Slug.Should().Be("second-draft-headline", "an unpublished draft's slug follows its headline");
        (await harness.EventsAsync()).Should().BeEmpty("drafting emits no telemetry");

        var published = await scope.Funnel.PublishAsync(Guid.Parse(draft.Id), null, FunnelHarness.Controller);
        var refused = await scope.Funnel.ReviseAsync(
            Guid.Parse(draft.Id),
            new ReviseOptions { Kind = "edit", Fields = harness.Request() with { Version = published.Item!.Version } },
            FunnelHarness.Controller);
        refused.Outcome.Should().Be(ContentPublishOutcome.Invalid);
        (await scope.Funnel.UpdateDraftAsync(Guid.Parse(draft.Id), harness.Request() with { Version = published.Item.Version }, FunnelHarness.Controller))
            .Outcome.Should().Be(ContentPublishOutcome.Conflict, "a published item is revised, not edited");
    }

    [Fact]
    public async Task SlugsCollideToSuffixes_WithinTheOutlet()
    {
        using var harness = FunnelHarness.Create();

        var first = await harness.CreateAsync();
        var second = await harness.CreateAsync();

        first.Slug.Should().Be("bridge-closed-after-overnight-flooding");
        second.Slug.Should().Be("bridge-closed-after-overnight-flooding-2");
        second.Permalink.Should().Be("/news/newsline-7/bridge-closed-after-overnight-flooding-2");
        ContentPublishService.BaseSlug("Évacuation   ordonnée — zone 3!").Should().Be("evacuation-ordonnee-zone-3");
        ContentPublishService.BaseSlug("¡¿!").Should().Be("item");
    }

    // ---- Soft delete and retract (XC-010) -------------------------------------------------------------------------

    [Fact]
    public async Task Retract_StampsAndKeepsTheRow_AndSoftDeleteKeepsRevisions()
    {
        using var harness = FunnelHarness.Create();
        harness.Clock.Start(harness.ExerciseId, FunnelHarness.ScenarioStart, TimeZoneInfo.Utc);
        var published = await harness.CreatePublishedAsync();
        var id = Guid.Parse(published.Id);

        using var scope = harness.InA();
        await scope.Funnel.ReviseAsync(
            id, new ReviseOptions { Kind = "update", Fields = harness.Request() with { Version = published.Version } }, FunnelHarness.Controller);
        var retracted = await scope.Funnel.RetractAsync(id, FunnelHarness.Controller);

        retracted.Item!.Status.Should().Be("retracted");
        (await harness.ItemAsync(published.Id)).RetractedScenarioTime.Should().Be(FunnelHarness.ScenarioStart);
        harness.Broadcaster.Retracted.Single().Permalink.Should().Be(published.Permalink);

        var deleted = await scope.Funnel.SoftDeleteAsync(id, FunnelHarness.Controller);
        deleted.Outcome.Should().Be(ContentPublishOutcome.Ok);
        (await harness.ItemAsync(published.Id)).DeletedAt.Should().Be(FunnelHarness.WallStart);
        (await harness.RevisionsAsync(published.Id)).Should().ContainSingle().Which.DeletedAt.Should().BeNull("revisions are never removed");
        (await scope.Funnel.RestoreAsync(id, FunnelHarness.Controller)).Outcome.Should().Be(ContentPublishOutcome.NotFound);
        harness.Broadcaster.Retracted.Should().HaveCount(1, "deleting an already-retracted item pushes nothing new");
    }

    [Fact]
    public async Task SoftDeletingAPublishedItem_BroadcastsContentRetracted()
    {
        using var harness = FunnelHarness.Create();
        var published = await harness.CreatePublishedAsync();

        using var scope = harness.InA();
        await scope.Funnel.SoftDeleteAsync(Guid.Parse(published.Id), FunnelHarness.Controller);

        harness.Broadcaster.Retracted.Should().ContainSingle();
        harness.Observer.Calls.Last().Event.Should().Be("retracted");
        (await harness.EventsAsync()).Last().Should().Match<TelemetryEvent>(e => e.EventType == "content_retracted" && e.Payload!.Contains("\"action\":\"delete\""));
    }

    // ---- Callers, the gate, engine drafts -------------------------------------------------------------------------

    [Fact]
    public async Task AParticipantCaller_IsAccepted_AndCannotSetStaffOnlyFields()
    {
        using var harness = FunnelHarness.Create();

        var created = await harness.CreateAsync(
            FunnelHarness.Participant,
            harness.Request() with { Background = true, FeaturedRank = 1, ExternalSource = "cadence", ExternalRef = "x" });

        created.Origin.Should().Be("participant");
        created.ActingHumanId.Should().Be("human-ptc");
        created.Background.Should().BeFalse();
        created.FeaturedRank.Should().BeNull();
        created.ExternalRef.Should().BeNull();
    }

    [Fact]
    public async Task AHold_IsA409HeldWithStateUnchanged()
    {
        using var harness = FunnelHarness.Create();
        var draft = await harness.CreateAsync();
        var hold = new TestGate(ContentPublishGateDecision.Hold("Awaiting approval"));
        harness.Gates.Add(hold);

        using var scope = harness.InA();
        var publish = await scope.Funnel.PublishAsync(Guid.Parse(draft.Id), null, FunnelHarness.Participant);
        var schedule = await scope.Funnel.ScheduleAsync(Guid.Parse(draft.Id), "2033-09-04T10:00:00Z", null, FunnelHarness.Controller);

        publish.Outcome.Should().Be(ContentPublishOutcome.Held);
        publish.Errors.Should().Equal("Awaiting approval");
        publish.Item!.Status.Should().Be("draft");
        schedule.Outcome.Should().Be(ContentPublishOutcome.Held);
        hold.Seen.Select(c => (c.Action, c.Origin, c.ActingHumanId)).Should().Equal(
            ("publish", "participant", "human-ptc"), ("schedule", "controller", "human-ctl"));
        (await harness.ItemAsync(draft.Id)).Version.Should().Be(1);
        (await harness.EventsAsync()).Should().BeEmpty();
        harness.Broadcaster.Published.Should().BeEmpty();
    }

    [Fact]
    public async Task AllowNotes_AreRecordedAsPayloadGateNote_OnTheContentPublishedEvent()
    {
        using var harness = FunnelHarness.Create();
        var draft = await harness.CreateAsync();
        harness.Gates.Add(new TestGate(ContentPublishGateDecision.Allow("controller bypass of pending approval")));
        harness.Gates.Add(new TestGate(ContentPublishGateDecision.Allow()));

        using var scope = harness.InA();
        await scope.Funnel.PublishAsync(Guid.Parse(draft.Id), null, FunnelHarness.Controller);

        var payload = JsonNode.Parse((await harness.EventsAsync()).Single().Payload!)!;
        payload["gateNote"]!.GetValue<string>().Should().Be("controller bypass of pending approval");
    }

    [Fact]
    public async Task AnEngineCaller_OnlyDrafts_AndOnlyStaffPublishesAnEngineDraft()
    {
        using var harness = FunnelHarness.Create();
        var engineDraft = await harness.CreateAsync(FunnelHarness.Engine);
        var id = Guid.Parse(engineDraft.Id);
        engineDraft.Status.Should().Be("draft");
        engineDraft.Origin.Should().Be("engine");

        using var scope = harness.InA();
        (await scope.Funnel.PublishAsync(id, null, FunnelHarness.Engine)).Errors.Should().Equal(ContentPublishService.EngineDraftOnlyMessage);
        (await scope.Funnel.PublishAsync(id, null, FunnelHarness.Participant)).Errors.Should().Equal(ContentPublishService.EngineItemNeedsStaffMessage);
        (await scope.Funnel.ScheduleAsync(id, "2033-09-04T10:00:00Z", null, FunnelHarness.Participant)).Outcome.Should().Be(ContentPublishOutcome.Invalid);
        (await scope.Funnel.UpdateDraftAsync(id, harness.Request("Engine rewrite") with { Version = 1 }, FunnelHarness.Engine))
            .Outcome.Should().Be(ContentPublishOutcome.Ok, "the engine may keep editing its draft");

        var staff = await scope.Funnel.PublishAsync(id, null, FunnelHarness.Controller);
        staff.Outcome.Should().Be(ContentPublishOutcome.Ok);
        staff.Item!.Origin.Should().Be("engine", "provenance stays the drafter's");
    }

    // ---- Telemetry (XC-004) ---------------------------------------------------------------------------------------

    [Fact]
    public async Task EachAction_EmitsExactlyOneServerEvent_CarryingTheCallersProvenance()
    {
        using var harness = FunnelHarness.Create();
        var injectId = Guid.NewGuid();
        var inject = new ContentCaller { Origin = "inject", ActingHumanId = "human-ctl", InjectId = injectId };
        var draft = await harness.CreateAsync();
        var id = Guid.Parse(draft.Id);

        using var scope = harness.InA();
        await scope.Funnel.ScheduleAsync(id, "2033-09-04T10:00:00Z", null, FunnelHarness.Controller);
        await scope.Funnel.PublishAsync(id, null, inject);
        var version = (await harness.ItemAsync(draft.Id)).Version;
        await scope.Funnel.ReviseAsync(id, new ReviseOptions { Kind = "correction", Fields = harness.Request() with { Version = version } }, FunnelHarness.Controller);
        await scope.Funnel.RetractAsync(id, FunnelHarness.Controller);
        await scope.Funnel.RestoreAsync(id, FunnelHarness.Controller);
        await scope.Funnel.SoftDeleteAsync(id, FunnelHarness.Controller);

        var events = await harness.EventsAsync();
        events.Select(e => e.EventType).Should().Equal(
            "content_scheduled", "content_published", "content_revised", "content_retracted", "content_published", "content_retracted");
        events.Should().OnlyContain(e => e.Channel == "news" && e.Target!.EntityType == "content_item" && e.Target.EntityId == draft.Id);
        events.Should().OnlyContain(e => e.Actor.ActingHumanId == "human-ctl" && e.Actor.Kind == "system");

        var publish = events[1];
        publish.Origin.Should().Be("inject");
        publish.InjectId.Should().Be(injectId.ToString());
        (await harness.ItemAsync(draft.Id)).InjectId.Should().Be(injectId, "the firing inject is recorded on the item");
        JsonNode.Parse(events[2].Payload!)!["revisionKind"]!.GetValue<string>().Should().Be("correction");
        JsonNode.Parse(events[4].Payload!)!["action"]!.GetValue<string>().Should().Be("restore");
    }

    [Fact]
    public async Task AParticipantRelease_EmitsPressRelease_NeverAlsoContentPublished()
    {
        using var harness = FunnelHarness.Create();
        var release = await harness.CreateAsync(FunnelHarness.Participant, harness.Request(kind: "release"));

        using var scope = harness.InA();
        await scope.Funnel.PublishAsync(Guid.Parse(release.Id), null, FunnelHarness.Participant);

        var published = (await harness.EventsAsync()).Should().ContainSingle().Subject;
        published.EventType.Should().Be("press_release");
        published.Channel.Should().Be("press");
        published.Actor.Kind.Should().Be("participant");
        published.Actor.ParticipantId.Should().Be("human-ptc");
        published.Origin.Should().Be("participant");
    }

    // ---- Broadcast, observers, side effects -----------------------------------------------------------------------

    [Fact]
    public async Task AfterCommit_TheBroadcastCarriesTheParticipantSafeSummary_AndObserversSeeTheCommittedItem()
    {
        using var harness = FunnelHarness.Create();
        var draft = await harness.CreateAsync();

        using var scope = harness.InA();
        await scope.Funnel.PublishAsync(Guid.Parse(draft.Id), null, FunnelHarness.Controller);

        harness.Broadcaster.Exercises.Should().Equal(harness.ExerciseId);
        var summary = harness.Broadcaster.Published.Single();
        summary.Permalink.Should().Be(draft.Permalink);
        summary.Outlet.Name.Should().Be("Newsline 7");
        JsonSerializer.Serialize(summary).Should().NotContain("human-ctl").And.NotContain("origin").And.NotContain("version");
        harness.Observer.Calls.Should().Equal(("published", Guid.Parse(draft.Id), "published"));
    }

    [Fact]
    public async Task AFailingObserverOrBroadcaster_NeverFailsOrRollsBackThePublish()
    {
        using var harness = FunnelHarness.Create();
        var draft = await harness.CreateAsync();
        harness.Observer.Throw = true;
        harness.Broadcaster.Throw = true;

        using var scope = harness.InA();
        var result = await scope.Funnel.PublishAsync(Guid.Parse(draft.Id), null, FunnelHarness.Controller);

        result.Outcome.Should().Be(ContentPublishOutcome.Ok);
        (await harness.ItemAsync(draft.Id)).Status.Should().Be("published");
    }

    [Fact]
    public async Task ObserverRevisedAndRetracted_AreInvokedThroughTheInterface_WhenAnObserverKeepsTheDefaults()
    {
        var defaults = new DefaultOnlyObserver();
        using var harness = FunnelHarness.Create(services =>
            Microsoft.Extensions.DependencyInjection.ServiceCollectionServiceExtensions.AddSingleton<IContentPublishedObserver>(services, defaults));
        var published = await harness.CreatePublishedAsync();

        using var scope = harness.InA();
        var revised = await scope.Funnel.ReviseAsync(
            Guid.Parse(published.Id), new ReviseOptions { Kind = "update", Fields = harness.Request() with { Version = published.Version } }, FunnelHarness.Controller);
        var retracted = await scope.Funnel.RetractAsync(Guid.Parse(published.Id), FunnelHarness.Controller);

        revised.Outcome.Should().Be(ContentPublishOutcome.Ok);
        retracted.Outcome.Should().Be(ContentPublishOutcome.Ok);
        defaults.Published.Should().Be(1);
    }

    [Fact]
    public async Task PublishOptions_RaiseTheAlertAndThePairedPost_AndRecordTheirIds()
    {
        using var harness = FunnelHarness.Create();
        var draft = await harness.CreateAsync();

        using var scope = harness.InA();
        var result = await scope.Funnel.PublishAsync(
            Guid.Parse(draft.Id),
            new PublishOptions
            {
                Alert = new PublishAlertOptions { Severity = "emergency" },
                PairedPost = new PairedPostOptions { Text = "Read more" },
            },
            FunnelHarness.Controller);

        result.SideEffectWarnings.Should().BeNull();
        var (raise, caller) = harness.AlertRaiser!.Raised.Single();
        raise.Should().BeEquivalentTo(new AlertRaise
        {
            Severity = "emergency",
            Headline = draft.Headline,
            Href = draft.Permalink,
            SourceChannel = "news",
            SourceContentId = Guid.Parse(draft.Id),
        });
        caller.Should().Be(FunnelHarness.Controller);
        harness.PairedPoster!.Posts.Single().Should().Be((Guid.Parse(draft.Id), "Read more", FunnelHarness.Controller));
        result.Item!.AlertId.Should().NotBeNull();
        result.Item.PairedPostId.Should().Be(harness.PairedPoster.Returns!.Value.ToString());
        (await harness.ItemAsync(draft.Id)).AlertId.Should().Be(Guid.Parse(result.Item.AlertId!));
    }

    [Fact]
    public async Task AnAbsentOrFailingSideEffect_StillPublishes_AndReportsTheOutcome()
    {
        using var absent = FunnelHarness.Create(withAlertRaiser: false, withPairedPoster: false);
        var draft = await absent.CreateAsync();
        var options = new PublishOptions { Alert = new PublishAlertOptions(), PairedPost = new PairedPostOptions() };
        using (var scope = absent.InA())
        {
            var result = await scope.Funnel.PublishAsync(Guid.Parse(draft.Id), options, FunnelHarness.Controller);
            result.Outcome.Should().Be(ContentPublishOutcome.Ok);
            result.SideEffectWarnings.Should().Equal(ContentPublishService.NoAlertSourceMessage, ContentPublishService.NoPairedPosterMessage);
        }

        using var failing = FunnelHarness.Create();
        failing.AlertRaiser = new FakeAlertRaiser { Throw = true };
        failing.PairedPoster = new FakePairedPoster { Returns = null };
        var second = await failing.CreateAsync();
        using (var scope = failing.InA())
        {
            var result = await scope.Funnel.PublishAsync(Guid.Parse(second.Id), options, FunnelHarness.Controller);
            result.Outcome.Should().Be(ContentPublishOutcome.Ok);
            result.Item!.Status.Should().Be("published");
            result.SideEffectWarnings.Should().Equal(ContentPublishService.AlertFailedMessage, ContentPublishService.NoPairedPersonaMessage);
        }
    }

    // ---- Options resolution and persistence (FC-7a) ---------------------------------------------------------------

    [Fact]
    public async Task ScheduleAsync_PersistsTheOptions_AndAnOptionlessPublishReplaysThem()
    {
        using var harness = FunnelHarness.Create();
        var draft = await harness.CreateAsync();
        var id = Guid.Parse(draft.Id);

        using var scope = harness.InA();
        await scope.Funnel.ScheduleAsync(
            id, "2033-09-04T10:00:00Z", new PublishOptions { Alert = new PublishAlertOptions { Severity = "advisory", Headline = "Bridge" } },
            FunnelHarness.Controller);
        (await harness.ItemAsync(draft.Id)).PublishOptionsJson.Should().Contain("\"severity\":\"advisory\"");

        // The runner / inject fire: no options on the call.
        await scope.Funnel.PublishAsync(id, null, FunnelHarness.Controller);

        harness.AlertRaiser!.Raised.Single().Raise.Should().Match<AlertRaise>(a => a.Severity == "advisory" && a.Headline == "Bridge");
        harness.PairedPoster!.Posts.Should().BeEmpty("no paired post was persisted");
    }

    [Fact]
    public async Task WithNothingPersisted_TheKindsResolvePublishOptionsDecides_AndTheDefaultMappingNever()
    {
        using var harness = FunnelHarness.Create();
        var withDelivery = await harness.CreateAsync();
        var withNothing = await harness.CreateAsync();
        harness.Article.Derive = item => item.Id == Guid.Parse(withDelivery.Id)
            ? new PublishOptions { Alert = new PublishAlertOptions { Severity = "emergency" }, PairedPost = new PairedPostOptions() }
            : null;

        using var scope = harness.InA();
        await scope.Funnel.ScheduleAsync(Guid.Parse(withDelivery.Id), "2033-09-04T10:00:00Z", null, FunnelHarness.Controller);
        await scope.Funnel.PublishAsync(Guid.Parse(withDelivery.Id), null, FunnelHarness.Controller);
        await scope.Funnel.PublishAsync(Guid.Parse(withNothing.Id), null, FunnelHarness.Controller);

        harness.AlertRaiser!.Raised.Should().ContainSingle("only the item whose payload derives options raises an alert")
            .Which.Raise.Severity.Should().Be("emergency");
        harness.AlertRaiser.Raised.Should().NotContain(r => r.Raise.Headline == "DEFAULT MAPPING");
        harness.PairedPoster!.Posts.Should().ContainSingle();
    }

    [Fact]
    public async Task OptionsOnTheCall_WinOverPersistedOnes_WithNoMerging()
    {
        using var harness = FunnelHarness.Create();
        var draft = await harness.CreateAsync();
        var id = Guid.Parse(draft.Id);

        using var scope = harness.InA();
        await scope.Funnel.ScheduleAsync(
            id, "2033-09-04T10:00:00Z", new PublishOptions { Alert = new PublishAlertOptions { Severity = "advisory" } }, FunnelHarness.Controller);
        await scope.Funnel.PublishAsync(id, new PublishOptions { PairedPost = new PairedPostOptions() }, FunnelHarness.Controller);

        harness.AlertRaiser!.Raised.Should().BeEmpty("the call's options replace the persisted ones entirely");
        harness.PairedPoster!.Posts.Should().ContainSingle();
    }
}
