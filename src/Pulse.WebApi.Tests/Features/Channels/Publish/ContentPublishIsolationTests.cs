namespace Pulse.WebApi.Tests.Features.Channels.Publish;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// Exercise isolation (COR-001, always Critical) for the publish funnel: another exercise's item, outlet, media or persona
/// reads exactly like an unknown id from every funnel method; no scope writes nothing; and every row the funnel writes is
/// stamped with the caller's exercise.
/// </summary>
public sealed class ContentPublishIsolationTests
{
    [Fact]
    public async Task AnotherExercisesItem_IsNotFound_FromEveryMethod_AndUntouched()
    {
        using var harness = FunnelHarness.Create();
        var foreign = await harness.CreatePublishedAsync();
        var id = Guid.Parse(foreign.Id);
        var eventsBefore = (await harness.EventsAsync()).Count;

        using var scope = harness.In(harness.OtherExerciseId);
        var funnel = scope.Funnel;
        var results = new List<ContentPublishResult>
        {
            await funnel.UpdateDraftAsync(id, harness.Request() with { Version = foreign.Version }, FunnelHarness.Controller),
            await funnel.PublishAsync(id, null, FunnelHarness.Controller),
            await funnel.ScheduleAsync(id, "2033-09-04T10:00:00Z", null, FunnelHarness.Controller),
            await funnel.UnscheduleAsync(id, FunnelHarness.Controller),
            await funnel.RetractAsync(id, FunnelHarness.Controller),
            await funnel.RestoreAsync(id, FunnelHarness.Controller),
            await funnel.ReviseAsync(id, new ReviseOptions { Kind = "update", Fields = harness.Request() with { Version = foreign.Version } }, FunnelHarness.Controller),
            await funnel.SoftDeleteAsync(id, FunnelHarness.Controller),
        };

        results.Should().OnlyContain(r => r.Outcome == ContentPublishOutcome.NotFound && r.Item == null);
        results.Select(r => r.Errors.Single()).Distinct().Should().ContainSingle("cross-exercise is identical to unknown");
        var item = await harness.ItemAsync(foreign.Id);
        item.Status.Should().Be("published");
        item.Version.Should().Be(foreign.Version);
        item.DeletedAt.Should().BeNull();
        (await harness.EventsAsync()).Should().HaveCount(eventsBefore);
    }

    [Fact]
    public async Task NoResolvedScope_FailsClosed_AndWritesNothing()
    {
        using var harness = FunnelHarness.Create();

        using var scope = harness.In(null);
        var result = await scope.Funnel.CreateDraftAsync(harness.Request(), FunnelHarness.Controller);

        result.Outcome.Should().Be(ContentPublishOutcome.NotFound);
        using var a = harness.InA();
        (await a.Db.ContentItems.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task AnotherExercisesOutletMediaOrPersona_IsRefusedLikeAnUnknownOne()
    {
        using var harness = FunnelHarness.Create();
        Guid foreignAsset;
        Guid foreignPersona;
        using (var b = harness.In(harness.OtherExerciseId))
        {
            var asset = ChannelRows.MediaAsset(harness.OtherExerciseId);
            var persona = new Persona { Id = Guid.NewGuid(), ExerciseId = harness.OtherExerciseId, Handle = "@other", DisplayName = "Other", Kind = "npc" };
            b.Db.MediaAssets.Add(asset);
            b.Db.Personas.Add(persona);
            await b.Db.SaveChangesAsync();
            (foreignAsset, foreignPersona) = (asset.Id, persona.Id);
        }

        using var scope = harness.InA();
        var outlet = await scope.Funnel.CreateDraftAsync(
            harness.Request() with { OutletId = harness.OtherOutletId.ToString() }, FunnelHarness.Controller);
        var media = await scope.Funnel.CreateDraftAsync(
            harness.Request() with { HeroMediaId = foreignAsset.ToString() }, FunnelHarness.Controller);
        var unknownMedia = await scope.Funnel.CreateDraftAsync(
            harness.Request() with { HeroMediaId = Guid.NewGuid().ToString() }, FunnelHarness.Controller);
        var persona2 = await scope.Funnel.CreateDraftAsync(
            harness.Request() with { BylinePersonaId = foreignPersona.ToString() }, FunnelHarness.Controller);

        outlet.Outcome.Should().Be(ContentPublishOutcome.Invalid);
        media.Errors.Should().Equal(ContentPublishService.MediaNotFoundMessage);
        unknownMedia.Errors.Should().Equal(media.Errors, "a foreign asset reads exactly like an unknown one");
        persona2.Errors.Single().Should().Contain("bylinePersonaId");
    }

    [Fact]
    public async Task AParticipant_MayAttachOnlyTheirOwnUploads()
    {
        using var harness = FunnelHarness.Create();
        Guid someoneElses;
        Guid theirs;
        using (var seed = harness.InA())
        {
            var other = ChannelRows.MediaAsset(harness.ExerciseId);
            var own = ChannelRows.MediaAsset(harness.ExerciseId);
            own.UploadedByHumanId = FunnelHarness.Participant.ActingHumanId;
            seed.Db.MediaAssets.AddRange(other, own);
            await seed.Db.SaveChangesAsync();
            (someoneElses, theirs) = (other.Id, own.Id);
        }

        using var scope = harness.InA();
        var refused = await scope.Funnel.CreateDraftAsync(
            harness.Request() with { HeroMediaId = someoneElses.ToString() }, FunnelHarness.Participant);
        var allowed = await scope.Funnel.CreateDraftAsync(
            harness.Request() with
            {
                HeroMediaId = theirs.ToString(),
                Media = [new ContentMediaWriteRequest { MediaId = theirs.ToString(), Role = "hero", Alt = "My photo" }],
            },
            FunnelHarness.Participant);

        refused.Errors.Should().Equal(ContentPublishService.MediaNotFoundMessage);
        allowed.Outcome.Should().Be(ContentPublishOutcome.Ok);
    }

    [Fact]
    public async Task EveryRowTheFunnelWrites_IsStampedWithTheCallersExercise()
    {
        using var harness = FunnelHarness.Create();
        var published = await harness.CreatePublishedAsync();
        using (var scope = harness.InA())
        {
            await scope.Funnel.ReviseAsync(
                Guid.Parse(published.Id),
                new ReviseOptions { Kind = "update", Fields = harness.Request() with { Version = published.Version } },
                FunnelHarness.Controller);
        }

        using var a = harness.InA();
        (await a.Db.ContentItems.IgnoreQueryFilters().Select(i => i.ExerciseId).ToListAsync()).Should().OnlyContain(id => id == harness.ExerciseId);
        (await a.Db.ContentItemRevisions.IgnoreQueryFilters().Select(r => r.ExerciseId).ToListAsync()).Should().OnlyContain(id => id == harness.ExerciseId);
        (await a.Db.TelemetryEvents.IgnoreQueryFilters().Select(e => e.ExerciseId).ToListAsync()).Should().OnlyContain(id => id == harness.ExerciseId);
        harness.Broadcaster.Exercises.Should().OnlyContain(id => id == harness.ExerciseId);

        using var b = harness.In(harness.OtherExerciseId);
        (await b.Db.ContentItems.CountAsync()).Should().Be(0, "exercise B's filter sees none of A's content");
    }
}
