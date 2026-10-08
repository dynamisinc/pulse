namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// The <c>/api/injects*</c> contract over HTTP (story 06): the staff/controller gate, authoring with version
/// conflicts, the read model, the state machine, fire through the funnel, exactly-once on a double fire, the pause
/// tiers, and visible failure — each with its one <c>inject_action</c> event (or none, for a refusal). Real SQL.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class InjectEndpointsTests
{
    private readonly MsSqlContainerFixture _fixture;

    public InjectEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- staff only (AC "Staff only, exercise-scoped") ---------------------------------------------

    [RequiresDockerFact]
    public async Task NoStaffSession_Is401_OnReadsAndWrites()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, staffUserId: null);

        (await host.Client.GetAsync(new Uri("/api/injects", UriKind.Relative))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await host.CreateAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await host.ActionAsync(Guid.NewGuid(), "fire")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [RequiresDockerFact]
    public async Task UnresolvedScope_Is401_FailClosed()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(exerciseId: null, seeded.StaffUserId);

        (await host.Client.GetAsync(new Uri("/api/injects", UriKind.Relative))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [RequiresDockerFact]
    public async Task StaffNotAssignedToTheExercise_Is403()
    {
        await using var host = await StartAsync();
        var mine = await host.SeedExerciseAsync();
        var other = await host.SeedExerciseAsync();
        host.ActAs(other.ExerciseId, mine.StaffUserId);

        (await host.Client.GetAsync(new Uri("/api/injects", UriKind.Relative))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await host.CreateAsync(InjectTestHost.PostItem(other.PersonaIds[0]))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [RequiresDockerFact]
    public async Task AnEvaluator_MayWatchTheQueue_ButNotChangeIt()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        var evaluator = await host.AddStaffAsync(seeded.ExerciseId, "evaluator", "Eve Evaluator");
        host.ActAs(seeded.ExerciseId, evaluator);

        (await host.Client.GetAsync(new Uri("/api/injects", UriKind.Relative))).StatusCode.Should().Be(HttpStatusCode.OK);
        (await host.Client.GetAsync(new Uri("/api/injects/assignees", UriKind.Relative))).StatusCode.Should().Be(HttpStatusCode.OK);
        (await host.CreateAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        foreach (var action in new[] { "fire", "hold", "release", "skip", "unskip", "retry" })
        {
            (await host.ActionAsync(item.Guid, action)).StatusCode.Should().Be(HttpStatusCode.Forbidden, action);
        }

        (await host.DeleteAsync(item.Id, 1))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await host.PutAsync(item.Id, new { kind = "post", title = "evaluator edit", version = 1, posts = new[] { Post(seeded.PersonaIds[0]) } }))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden, "an evaluator may not edit the script");
        (await host.Client.PostAsJsonAsync(new Uri("/api/injects/reorder", UriKind.Relative), new { ids = new[] { item.Id } }))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(0);
    }

    // ---- authoring (AC "Author and edit") -----------------------------------------------------------

    [RequiresDockerFact]
    public async Task Create_ReturnsThePendingItem_AtVersion1_AndEmitsOneCreateEvent()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);

        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        item.Kind.Should().Be("post");
        item.Title.Should().Be("Beat 3 photo");
        item.PlannedMinute.Should().Be(12);
        item.Status.Should().Be("pending");
        item.Order.Should().Be(1);
        item.Version.Should().Be(1);
        item.Total.Should().Be(1);
        item.FiredCount.Should().Be(0);
        item.CreatedByHumanId.Should().Be(seeded.StaffUserId.ToString(), "the author is the server-side staff session (COR-018)");
        item.Posts.Should().ContainSingle().Which.Should().Match<WirePost>(post =>
            post.Status == "pending" && post.Sequence == 1 && post.PersonaId == seeded.PersonaIds[0].ToString());

        var events = await ActionEventsAsync(host, seeded.ExerciseId, item.Guid);
        events.Should().ContainSingle();
        Payload(events[0]).Should().Be(("create", "post", "pending"));
        events[0].Actor.ActingHumanId.Should().Be(seeded.StaffUserId.ToString());
        events[0].TimeZone.Should().Be("America/Chicago", "the exercise's own zone (XC-008)");
    }

    [RequiresDockerFact]
    public async Task Create_TheWireOmitsNullMembers_AndUsesCamelCase()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);

        var response = await host.CreateAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = json.RootElement;

        root.TryGetProperty("notes", out _).Should().BeFalse("null members are omitted, matching the optional TS fields");
        root.TryGetProperty("assigneeId", out _).Should().BeFalse();
        root.TryGetProperty("burstWindowSeconds", out _).Should().BeFalse();
        root.TryGetProperty("firedByHumanId", out _).Should().BeFalse();
        root.GetProperty("posts")[0].TryGetProperty("media", out _).Should().BeFalse();
        root.GetProperty("posts")[0].TryGetProperty("firedPostId", out _).Should().BeFalse();
        root.TryGetProperty("createdByHumanId", out _).Should().BeTrue();
        root.TryGetProperty("updatedAt", out _).Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task Create_StoresMediaReplyAndBaseline_AndReturnsThem()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var existingPost = Guid.NewGuid();

        var response = await host.CreateAsync(new
        {
            kind = "post",
            title = "Beat 3 photo",
            posts = new[]
            {
                new
                {
                    personaId = seeded.PersonaIds[0].ToString(),
                    text = "Look at this",
                    media = new[] { new { mediaId = "beat3-photo", alt = "Brown tap water in a glass" } },
                    replyTo = new { postId = existingPost.ToString() },
                    engagementBaseline = new { like = 120, repost = 14 },
                },
            },
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var post = json.RootElement.GetProperty("posts")[0];

        post.GetProperty("media")[0].GetProperty("mediaId").GetString().Should().Be("beat3-photo");
        post.GetProperty("media")[0].GetProperty("alt").GetString().Should().Be("Brown tap water in a glass");
        post.GetProperty("replyTo").GetProperty("postId").GetString().Should().Be(existingPost.ToString());
        post.GetProperty("replyTo").TryGetProperty("injectPostId", out _).Should().BeFalse();
        post.GetProperty("engagementBaseline").GetProperty("like").GetInt32().Should().Be(120);
        post.GetProperty("engagementBaseline").TryGetProperty("reply", out _).Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Create_Invalid_IsA400WithAReadableDetail_AndWritesNothing()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);

        var response = await host.CreateAsync(new { kind = "post", title = "", posts = new[] { new { personaId = seeded.PersonaIds[0].ToString(), text = "x" } } });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await InjectTestHost.ReadProblemAsync(response)).Detail.Should().Contain("title must be between 1 and 120");
        (await host.GetQueueAsync()).Items.Should().BeEmpty();
        (await AllActionEventsAsync(host, seeded.ExerciseId)).Should().BeEmpty("a refused write is not an action");
    }

    [RequiresDockerFact]
    public async Task Create_AnAssigneeOnTheRoster_IsNamed_AndOneOffTheRosterIsRefused()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var colleague = await host.AddStaffAsync(seeded.ExerciseId, "controller", "Pat Partner");
        var outsider = (await host.SeedExerciseAsync()).StaffUserId;

        var assigned = await host.CreateOkAsync(new
        {
            kind = "burst",
            title = "Pile-on",
            assigneeId = colleague.ToString(),
            posts = new[] { Post(seeded.PersonaIds[0]), Post(seeded.PersonaIds[1]) },
        });
        assigned.AssigneeId.Should().Be(colleague.ToString());
        assigned.AssigneeName.Should().Be("Pat Partner");
        assigned.BurstWindowSeconds.Should().Be(90, "the default window");

        var refused = await host.CreateAsync(new
        {
            kind = "post",
            title = "x",
            assigneeId = outsider.ToString(),
            posts = new[] { Post(seeded.PersonaIds[0]) },
        });
        refused.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a staff user assigned elsewhere is not on this roster");
    }

    [RequiresDockerFact]
    public async Task Assignees_ListsTheExerciseRoster_AndTheCallersOwnId()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var colleague = await host.AddStaffAsync(seeded.ExerciseId, "evaluator", "Alex Analyst");
        await host.SeedExerciseAsync(); // another exercise's staff must not appear

        var response = await host.Client.GetAsync(new Uri("/api/injects/assignees", UriKind.Relative));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        json.RootElement.GetProperty("me").GetString().Should().Be(seeded.StaffUserId.ToString());
        var assignees = json.RootElement.GetProperty("assignees").EnumerateArray()
            .Select(a => (a.GetProperty("id").GetString(), a.GetProperty("displayName").GetString(), a.GetProperty("role").GetString()))
            .ToList();
        assignees.Should().BeEquivalentTo(
            [
                (colleague.ToString(), "Alex Analyst", "evaluator"),
                (seeded.StaffUserId.ToString(), "Casey Controller", "controller"),
            ]);
    }

    [RequiresDockerFact]
    public async Task Edit_WithTheCurrentVersion_ReplacesContent_KeepsChildIds_AndEmitsOneEditEvent()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.BurstItem(seeded.PersonaIds, count: 2));

        var response = await host.PutAsync(item.Id, new
        {
            kind = "burst",
            title = "Pile-on (revised)",
            notes = "after the PIO post",
            version = item.Version,
            posts = new object[]
            {
                new
                {
                    id = item.Posts[0].Id,
                    personaId = seeded.PersonaIds[1].ToString(),
                    text = "first, revised",
                    media = new[] { new { mediaId = "beat3-photo", alt = "Brown tap water" } },
                },
                new { id = item.Posts[1].Id, personaId = seeded.PersonaIds[2].ToString(), text = "replying to the first", replyTo = new { injectPostId = item.Posts[0].Id } },
                Post(seeded.PersonaIds[0], "a new third"),
            },
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        var edited = (await InjectTestHost.ReadItemAsync(response))!;
        edited.Version.Should().Be(item.Version + 1);
        edited.Title.Should().Be("Pile-on (revised)");
        edited.Posts.Select(p => p.Text).Should().Equal("first, revised", "replying to the first", "a new third");
        edited.Posts[0].Id.Should().Be(item.Posts[0].Id, "a child that echoes its id keeps its identity");
        edited.Posts[1].Id.Should().Be(item.Posts[1].Id);
        edited.Posts[2].Id.Should().NotBe(item.Posts[0].Id).And.NotBe(item.Posts[1].Id, "a child without an id is new");
        await using (var db = host.Db(seeded.ExerciseId))
        {
            var first = await db.InjectItemPosts.SingleAsync(p => p.Id == Guid.Parse(item.Posts[0].Id));
            first.Media.Should().ContainSingle().Which.MediaId.Should().Be("beat3-photo", "the media column is rewritten on edit");
            (await db.InjectItemPosts.SingleAsync(p => p.Id == Guid.Parse(item.Posts[1].Id))).ReplyToInjectPostId
                .Should().Be(Guid.Parse(item.Posts[0].Id));
        }

        (await ActionEventsAsync(host, seeded.ExerciseId, item.Guid)).Select(Payload).Should().Equal(
            ("create", "burst", "pending"), ("edit", "burst", "pending"));
    }

    [RequiresDockerFact]
    public async Task Edit_ThatRemovesAPosition_SoftDeletesIt()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.BurstItem(seeded.PersonaIds, count: 3));

        var response = await host.PutAsync(item.Id, new
        {
            kind = "post",
            title = "Just one",
            version = item.Version,
            posts = new[] { new { id = item.Posts[1].Id, personaId = seeded.PersonaIds[0].ToString(), text = "the survivor" } },
        });

        var edited = (await InjectTestHost.ReadItemAsync(response))!;
        edited.Kind.Should().Be("post");
        edited.Total.Should().Be(1);
        edited.Posts.Single().Id.Should().Be(item.Posts[1].Id, "the echoed child survives; the others are removed");
        edited.Posts.Single().Sequence.Should().Be(1, "sequence is array position");
        await using var db = host.Db(seeded.ExerciseId);
        (await db.InjectItemPosts.CountAsync(p => p.InjectItemId == item.Guid && p.DeletedAt != null))
            .Should().Be(2, "removed positions are soft-deleted (XC-010), not erased");
    }

    [RequiresDockerFact]
    public async Task Create_ASequenceReply_IsStoredAndReturnedAsTheSiblingsInjectPostId()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);

        var created = await host.CreateOkAsync(new
        {
            kind = "burst",
            title = "Beat 3 pile-on",
            posts = new object[]
            {
                Post(seeded.PersonaIds[0], "the photo"),
                new { personaId = seeded.PersonaIds[1].ToString(), text = "omg", replyTo = new { sequence = 1 } },
            },
        });

        var response = await host.Client.GetAsync(new Uri("/api/injects", UriKind.Relative));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var replyTo = json.RootElement.GetProperty("items")[0].GetProperty("posts")[1].GetProperty("replyTo");
        replyTo.GetProperty("injectPostId").GetString().Should().Be(
            created.Posts[0].Id, "{sequence} is normalised on write to the sibling's id, the one stored and returned form");
        replyTo.TryGetProperty("sequence", out _).Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Edit_AChildIdOfAnotherItem_OrOfNothing_Is400()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        var other = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[1]));

        foreach (var foreignId in new[] { other.Posts[0].Id, Guid.NewGuid().ToString() })
        {
            var response = await host.PutAsync(item.Id, new
            {
                kind = "post",
                title = "x",
                version = item.Version,
                posts = new[] { new { id = foreignId, personaId = seeded.PersonaIds[0].ToString(), text = "x" } },
            });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await InjectTestHost.ReadProblemAsync(response)).Detail.Should().Be("Post 1: id does not name a post of this item.");
        }
    }

    [RequiresDockerFact]
    public async Task Edit_AFailedBurst_KeepsItsPublishedPost_FixesTheFailedOne_AndRetryPublishesIt()
    {
        var toggle = new PublisherToggle();
        await using var host = await StartAsync(publisher: sp => new ToggleablePublisher(toggle, sp.GetRequiredService<PostIngestService>()));
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.BurstItem(seeded.PersonaIds, count: 2));
        var fired = await host.ActionOkAsync(item.Guid, "fire");
        toggle.Refuse = true;
        host.Time.Advance(TimeSpan.FromSeconds(10));
        await host.Runner.RunTickAsync();
        var failed = (await host.GetQueueAsync()).Items.Single();
        failed.Status.Should().Be("failed");
        var published = failed.Posts[0];

        object Keep(string? text = null) => new { id = published.Id, personaId = published.PersonaId, text = text ?? published.Text };
        object Fix() => new { id = failed.Posts[1].Id, personaId = failed.Posts[1].PersonaId, text = "fixed copy #WaterIssues" };
        object Body(params object[] posts) => new { kind = "burst", title = "Pile-on", burstWindowSeconds = 90, version = failed.Version, posts };

        var dropped = await host.PutAsync(item.Id, Body(Fix(), Post(seeded.PersonaIds[2])));
        dropped.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await InjectTestHost.ReadProblemAsync(dropped)).Detail.Should().Be("Post 1 was already published and cannot be removed.");

        var rewritten = await host.PutAsync(item.Id, Body(Keep("rewriting history"), Fix()));
        rewritten.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await InjectTestHost.ReadProblemAsync(rewritten)).Detail.Should().Be("Post 1 was already published and cannot be changed.");

        var edited = await host.PutAsync(item.Id, Body(Keep(), Fix()));
        edited.StatusCode.Should().Be(HttpStatusCode.OK, await edited.Content.ReadAsStringAsync());
        var after = (await InjectTestHost.ReadItemAsync(edited))!;
        after.Status.Should().Be("failed", "an edit changes content, never status — retry re-fires");
        after.Posts[0].Status.Should().Be("fired");
        after.Posts[0].FiredPostId.Should().Be(fired.Posts[0].FiredPostId, "the published post keeps its identity and record");
        after.Posts[1].Text.Should().Be("fixed copy #WaterIssues");

        toggle.Refuse = false;
        (await host.ActionOkAsync(item.Guid, "retry")).Status.Should().Be("firing");
        await host.Runner.RunTickAsync();
        var settled = (await host.GetQueueAsync()).Items.Single();
        settled.Status.Should().Be("fired");
        await using var db = host.Db(seeded.ExerciseId);
        (await db.Posts.Where(p => p.InjectId == item.Id).Select(p => p.Body).ToListAsync())
            .Should().BeEquivalentTo([published.Text, "fixed copy #WaterIssues"], "the fixed copy is what went out");
    }

    [RequiresDockerFact]
    public async Task Edit_WithAStaleVersion_Is409_CarryingTheCurrentItem_AndChangesNothing()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        await host.ActionOkAsync(item.Guid, "hold"); // another controller moved it on: version 2

        var response = await host.PutAsync(item.Id, new
        {
            kind = "post",
            title = "Overwrite attempt",
            version = item.Version,
            posts = new[] { Post(seeded.PersonaIds[0]) },
        });

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var problem = await InjectTestHost.ReadProblemAsync(response);
        problem.Detail.Should().Contain("Changed by someone else");
        problem.Item!.Version.Should().Be(2, "the 409 carries the current item so the console can refresh the row");
        problem.Item.Title.Should().Be("Beat 3 photo", "two controllers editing at once never silently overwrite");
    }

    [RequiresDockerFact]
    public async Task Edit_WithoutAVersion_Is400()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        var response = await host.PutAsync(item.Id, InjectTestHost.PostItem(seeded.PersonaIds[0]));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await InjectTestHost.ReadProblemAsync(response)).Detail.Should().Be("version is required.");
    }

    [RequiresDockerFact]
    public async Task Edit_AFiredItem_Is409ReadOnly()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        var fired = await host.ActionOkAsync(item.Guid, "fire");

        var response = await host.PutAsync(item.Id, new
        {
            kind = "post",
            title = "too late",
            version = fired.Version,
            posts = new[] { Post(seeded.PersonaIds[0]) },
        });

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await InjectTestHost.ReadProblemAsync(response)).Detail.Should().Contain("read-only");
    }

    [RequiresDockerFact]
    public async Task Delete_SoftDeletes_HidesTheItem_AndEmitsOneDeleteEvent()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        var response = await host.DeleteAsync(item.Id, item.Version);

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await host.GetQueueAsync()).Items.Should().BeEmpty();
        await using var db = host.Db(seeded.ExerciseId);
        (await db.InjectItems.SingleAsync(i => i.Id == item.Guid)).DeletedAt.Should().NotBeNull("soft delete (XC-010)");
        (await ActionEventsAsync(host, seeded.ExerciseId, item.Guid)).Select(Payload).Last().Should().Be(("delete", "post", "pending"));
        (await host.ActionAsync(item.Guid, "fire")).StatusCode.Should().Be(HttpStatusCode.NotFound, "a deleted item is gone");
    }

    [RequiresDockerFact]
    public async Task Delete_WhileAPostIsBeingPublished_Is409()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.BurstItem(seeded.PersonaIds, count: 2));
        await host.ActionOkAsync(item.Guid, "fire");
        await host.ActionOkAsync(item.Guid, "hold");

        // Post 2 is mid-publish: claimed, outcome not yet recorded.
        await using (var db = host.Db(seeded.ExerciseId))
        {
            var child = await db.InjectItemPosts.SingleAsync(p => p.InjectItemId == item.Guid && p.Sequence == 2);
            child.ClaimedAt = host.Time.GetUtcNow();
            (await db.InjectItems.SingleAsync(i => i.Id == item.Guid)).Version++;
            await db.SaveChangesAsync();
        }

        var current = (await host.GetQueueAsync()).Items.Single();
        var response = await host.DeleteAsync(item.Id, current.Version);

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await InjectTestHost.ReadProblemAsync(response)).Detail.Should().Be(InjectTransitions.InFlightMessage);
        (await host.GetQueueAsync()).Items.Should().ContainSingle("the item survives so the in-flight post can be recorded");
    }

    [RequiresDockerFact]
    public async Task Delete_RefusesAStaleVersion_AFiredItem_AndAMissingVersion()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        (await host.DeleteAsync(item.Id, null)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await host.DeleteAsync(item.Id, 99)).StatusCode.Should().Be(HttpStatusCode.Conflict);

        var fired = await host.ActionOkAsync(item.Guid, "fire");
        var response = await host.DeleteAsync(item.Id, fired.Version);
        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await InjectTestHost.ReadProblemAsync(response)).Detail.Should().Contain("fired");
    }

    [RequiresDockerFact]
    public async Task Reorder_SetsTheOrder_AndEmitsOneQueueEvent()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var a = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        var b = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[1]));
        var c = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[2]));

        var response = await host.Client.PostAsJsonAsync(new Uri("/api/injects/reorder", UriKind.Relative), new { ids = new[] { c.Id, a.Id, b.Id } });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var queue = (await response.Content.ReadFromJsonAsync<WireQueue>())!;
        queue.Items.Select(i => (i.Id, i.Order)).Should().Equal((c.Id, 1), (a.Id, 2), (b.Id, 3));
        queue.Items.Should().OnlyContain(i => i.Version == 1, "order is presentation; an editor's version stays valid");
        (await host.GetQueueAsync()).Items.Select(i => i.Id).Should().Equal(c.Id, a.Id, b.Id);

        var reorders = (await AllActionEventsAsync(host, seeded.ExerciseId)).Where(e => e.Payload!.Contains("reorder")).ToList();
        reorders.Should().ContainSingle().Which.Target!.EntityType.Should().Be("inject-queue");
    }

    [RequiresDockerFact]
    public async Task Reorder_ThatIsNotTheFullLiveSet_Is400()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var a = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        var b = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[1]));

        foreach (var ids in new[] { new[] { a.Id }, new[] { a.Id, a.Id }, new[] { a.Id, b.Id, Guid.NewGuid().ToString() }, new[] { a.Id, "nope" } })
        {
            (await host.Client.PostAsJsonAsync(new Uri("/api/injects/reorder", UriKind.Relative), new { ids }))
                .StatusCode.Should().Be(HttpStatusCode.BadRequest, string.Join(",", ids));
        }
    }

    // ---- the read model (AC "Read") -------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task TheQueue_ListsItemsInOrder_WithEveryChildsStatus_AndThePauseTier()
    {
        await using var host = await StartAsync(new FixedJitterSource(30));
        var seeded = await ActAsControllerAsync(host);
        var post = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        var burst = await host.CreateOkAsync(InjectTestHost.BurstItem(seeded.PersonaIds, count: 2));
        await host.ActionOkAsync(burst.Guid, "fire");
        await host.PauseTiers.SetTierAsync(seeded.ExerciseId, PauseTier.Injects, "controller-1");

        var queue = await host.GetQueueAsync();

        queue.PauseTier.Should().Be("injects");
        queue.Items.Select(i => i.Id).Should().Equal(post.Id, burst.Id);
        var firing = queue.Items[1];
        firing.Status.Should().Be("firing");
        firing.FiredCount.Should().Be(1);
        firing.Total.Should().Be(2);
        firing.Posts.Select(p => p.Status).Should().Equal("fired", "pending");
        firing.Posts.Select(p => p.DueOffsetSeconds).Should().Equal(0, 3 + 30);
    }

    // ---- the state machine (AC "Hold / release / skip / unskip / retry") ------------------------------

    [RequiresDockerFact]
    public async Task HoldReleaseSkipUnskip_EachEmitExactlyOneEvent_WithTheResultingStatus()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        (await host.ActionOkAsync(item.Guid, "hold")).Status.Should().Be("held");
        (await host.ActionOkAsync(item.Guid, "release")).Status.Should().Be("pending");
        (await host.ActionOkAsync(item.Guid, "skip")).Status.Should().Be("skipped");
        var unskipped = await host.ActionOkAsync(item.Guid, "unskip");
        unskipped.Status.Should().Be("pending");
        unskipped.Version.Should().Be(5, "every state change bumps the version");

        (await ActionEventsAsync(host, seeded.ExerciseId, item.Guid)).Select(Payload).Should().Equal(
            ("create", "post", "pending"),
            ("hold", "post", "held"),
            ("release", "post", "pending"),
            ("skip", "post", "skipped"),
            ("unskip", "post", "pending"));
    }

    [RequiresDockerFact]
    public async Task ARefusedTransition_Is409WithTheCurrentItem_AndEmitsNothing()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        foreach (var action in new[] { "release", "unskip", "retry" })
        {
            var response = await host.ActionAsync(item.Guid, action);
            response.StatusCode.Should().Be(HttpStatusCode.Conflict, action);
            (await InjectTestHost.ReadProblemAsync(response)).Item!.Status.Should().Be("pending");
        }

        await host.ActionOkAsync(item.Guid, "fire");
        foreach (var action in new[] { "hold", "skip", "release", "unskip", "retry", "fire" })
        {
            (await host.ActionAsync(item.Guid, action)).StatusCode.Should().Be(HttpStatusCode.Conflict, "fired is terminal: " + action);
        }

        (await ActionEventsAsync(host, seeded.ExerciseId, item.Guid)).Select(e => Payload(e).Action).Should().Equal("create", "fire");
    }

    [RequiresDockerFact]
    public async Task AnUnknownId_Is404()
    {
        await using var host = await StartAsync();
        await ActAsControllerAsync(host);

        var response = await host.ActionAsync(Guid.NewGuid(), "fire");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await InjectTestHost.ReadProblemAsync(response)).Detail.Should().Be("No such item in this exercise.");
    }

    // ---- fire (AC "Fire publishes through the one funnel", "Exactly once", "Failure is visible") -------

    [RequiresDockerFact]
    public async Task Fire_APost_PublishesThroughTheFunnel_AndIsFired()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        var fired = await host.ActionOkAsync(item.Guid, "fire");

        fired.Status.Should().Be("fired");
        fired.FiredCount.Should().Be(1);
        fired.FiredByHumanId.Should().Be(seeded.StaffUserId.ToString());
        fired.FiredScenarioTime.Should().NotBeNull();
        var child = fired.Posts.Single();
        child.Status.Should().Be("fired");
        child.FiredByHumanId.Should().Be(seeded.StaffUserId.ToString());
        child.FiredWallClock.Should().NotBeNull();
        child.FiredScenarioTime.Should().NotBeNull();

        await using var db = host.Db(seeded.ExerciseId);
        var post = await db.Posts.SingleAsync(p => p.Id == Guid.Parse(child.FiredPostId!));
        post.Origin.Should().Be("inject");
        post.InjectId.Should().Be(item.Id);
        post.ActingHumanId.Should().Be(seeded.StaffUserId.ToString());
        post.AuthorPersonaId.Should().Be(seeded.PersonaIds[0]);
        (await ActionEventsAsync(host, seeded.ExerciseId, item.Guid)).Select(Payload).Last().Should().Be(("fire", "post", "fired"));
    }

    [RequiresDockerFact]
    public async Task Fire_Twice_PublishesExactlyOnce_AndTheSecondIs409WithTheCurrentState()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        var colleague = await host.AddStaffAsync(seeded.ExerciseId, "controller", "Second Controller");

        await host.ActionOkAsync(item.Guid, "fire");
        host.ActAs(seeded.ExerciseId, colleague);
        var second = await host.ActionAsync(item.Guid, "fire");

        second.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var problem = await InjectTestHost.ReadProblemAsync(second);
        problem.Detail.Should().Contain("already been fired");
        problem.Item!.FiredByHumanId.Should().Be(seeded.StaffUserId.ToString(), "the console can say who fired it");
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task Fire_InParallel_PublishesExactlyOnce()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        host.StepPerRequest = TimeSpan.Zero;

        var responses = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => host.ActionAsync(item.Guid, "fire")));

        responses.Count(r => r.StatusCode == HttpStatusCode.OK).Should().Be(1);
        responses.Count(r => r.StatusCode == HttpStatusCode.Conflict).Should().Be(5);
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(1, "exactly one post, however the requests interleave");
    }

    [RequiresDockerFact]
    public async Task Fire_UnderFreeze_Is409_AndPublishesNothing_AsIsRetry()
    {
        await using var host = await StartAsync(publisher: _ => new RefusingPublisher());
        var seeded = await ActAsControllerAsync(host);
        var failedItem = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[1]));
        await host.ActionOkAsync(failedItem.Guid, "fire"); // refused by the publisher → failed
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        await FreezeAsync(host, seeded.ExerciseId);

        var fire = await host.ActionAsync(item.Guid, "fire");
        var retry = await host.ActionAsync(failedItem.Guid, "retry");

        fire.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await InjectTestHost.ReadProblemAsync(fire)).Detail.Should().StartWith("The world is frozen");
        retry.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await InjectTestHost.ReadProblemAsync(retry)).Detail.Should().StartWith("The world is frozen");
        (await host.GetQueueAsync()).Items.Select(i => i.Status).Should().Equal("failed", "pending");
    }

    [RequiresDockerFact]
    public async Task Fire_UnderPauseInjects_StillWorks_AsDoesEnginePaused()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var first = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        var second = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[1]));

        await host.PauseTiers.SetTierAsync(seeded.ExerciseId, PauseTier.Injects, "controller-1");
        (await host.ActionOkAsync(first.Guid, "fire")).Status.Should().Be("fired", "PAUSE INJECTS suspends bursts, not manual fire");

        await host.PauseTiers.SetTierAsync(seeded.ExerciseId, PauseTier.Engine, "controller-1");
        (await host.ActionOkAsync(second.Guid, "fire")).Status.Should().Be("fired", "ENGINE PAUSED has no effect on the queue");
    }

    [RequiresDockerFact]
    public async Task Fire_AHeldItem_IsAllowed()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        await host.ActionOkAsync(item.Guid, "hold");

        (await host.ActionOkAsync(item.Guid, "fire")).Status.Should().Be("fired");
    }

    [RequiresDockerFact]
    public async Task Fire_WhenTheFunnelRefuses_IsFailedWithItsMessage_ThenRetryPublishes()
    {
        var toggle = new PublisherToggle { Refuse = true };
        await using var host = await StartAsync(publisher: sp => new ToggleablePublisher(toggle, sp.GetRequiredService<PostIngestService>()));
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        var failed = await host.ActionOkAsync(item.Guid, "fire");

        failed.Status.Should().Be("failed", "nothing is marked fired that the funnel did not create");
        failed.Error.Should().Be(RefusingPublisher.Reason, "the response says why");
        failed.Posts.Single().Status.Should().Be("failed");
        failed.Posts.Single().Error.Should().Be(RefusingPublisher.Reason);
        failed.Posts.Single().FiredPostId.Should().BeNull();
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(0);

        toggle.Refuse = false;
        var retried = await host.ActionOkAsync(item.Guid, "retry");

        retried.Status.Should().Be("fired");
        retried.Error.Should().BeNull();
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(1);
        (await ActionEventsAsync(host, seeded.ExerciseId, item.Guid)).Select(Payload).Should().Equal(
            ("create", "post", "pending"), ("fire", "post", "failed"), ("retry", "post", "fired"));
    }

    [RequiresDockerFact]
    public async Task Fire_WhenTheFunnelThrowsBeforeWriting_IsFailed_NeverAFalseFired()
    {
        await using var host = await StartAsync(publisher: _ => new ThrowingPublisher());
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        var failed = await host.ActionOkAsync(item.Guid, "fire");

        failed.Status.Should().Be("failed");
        failed.Error.Should().Contain("Retry");
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Fire_WhenTheBroadcastThrowsAfterTheCommit_IsRecordedFired_SoARetryCannotDuplicate()
    {
        await using var host = await StartAsync(broadcaster: new ThrowingBroadcaster());
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        var fired = await host.ActionOkAsync(item.Guid, "fire");

        fired.Status.Should().Be("fired", "the funnel DID create the post; it is reconciled from the posts table");
        await using var db = host.Db(seeded.ExerciseId);
        var post = await db.Posts.SingleAsync(p => p.InjectId == item.Id);
        fired.Posts.Single().FiredPostId.Should().Be(post.Id.ToString());
    }

    [RequiresDockerFact]
    public async Task Fire_ASingleReplyWhoseScriptedParentHasNotFired_Is409FireTheParentFirst()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var parent = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        var reply = await host.CreateOkAsync(InjectTestHost.PostItem(
            seeded.PersonaIds[1], "replying", new { injectPostId = parent.Posts[0].Id }));

        var refused = await host.ActionAsync(reply.Guid, "fire");

        refused.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var problem = await InjectTestHost.ReadProblemAsync(refused);
        problem.Detail.Should().StartWith("Fire the parent first");
        problem.Item!.Status.Should().Be("pending", "a refused fire changes nothing");
        problem.Item.Version.Should().Be(reply.Version);

        await host.ActionOkAsync(parent.Guid, "fire");
        (await host.ActionOkAsync(reply.Guid, "fire")).Status.Should().Be("fired", "once the parent is out, the reply can go");
    }

    [RequiresDockerFact]
    public async Task Fire_ABurst_PublishesTheFirstPostNow_AndLaysOutTheRest()
    {
        await using var host = await StartAsync(new FixedJitterSource(60, 10));
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.BurstItem(seeded.PersonaIds, count: 3, window: 90));

        var firing = await host.ActionOkAsync(item.Guid, "fire");

        firing.Status.Should().Be("firing");
        firing.FiredCount.Should().Be(1, "one click gives an immediate post");
        firing.Posts.Select(p => p.DueOffsetSeconds).Should().Equal(0, 3 + 10, 6 + 60);
        firing.Posts.Select(p => p.Status).Should().Equal("fired", "pending", "pending");
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(1);
        (await ActionEventsAsync(host, seeded.ExerciseId, item.Guid)).Select(Payload).Last().Should().Be(("fire", "burst", "firing"));
    }

    // ---- helpers --------------------------------------------------------------------------------------

    private async Task<InjectTestHost> StartAsync(
        IBurstJitterSource? jitter = null,
        Func<IServiceProvider, IInjectPostPublisher>? publisher = null,
        Pulse.WebApi.Features.Realtime.IFeedBroadcaster? broadcaster = null)
    {
        _fixture.ConnectionString.Should().NotBeNull();
        return await InjectTestHost.StartAsync(_fixture.ConnectionString!, jitter, publisher, broadcaster);
    }

    private static async Task<SeededExercise> ActAsControllerAsync(InjectTestHost host)
    {
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        return seeded;
    }

    private static async Task FreezeAsync(InjectTestHost host, Guid exerciseId)
    {
        var result = await host.PauseTiers.SetTierAsync(
            exerciseId, PauseTier.Freeze, "controller-1", new PauseClockStart(DateTimeOffset.UtcNow, TimeZoneInfo.Utc));
        result.Outcome.Should().Be(PauseTierOutcome.Applied);
    }

    private static object Post(Guid personaId, string text = "post #WaterIssues") => new { personaId = personaId.ToString(), text };

    private static async Task<int> CountPostsAsync(InjectTestHost host, Guid exerciseId)
    {
        await using var db = host.Db(exerciseId);
        return await db.Posts.CountAsync();
    }

    private static async Task<System.Collections.Generic.List<TelemetryEvent>> ActionEventsAsync(InjectTestHost host, Guid exerciseId, Guid itemId)
    {
        await using var db = host.Db(exerciseId);
        var injectId = itemId.ToString();
        return await db.TelemetryEvents
            .Where(e => e.EventType == "inject_action" && e.InjectId == injectId)
            .OrderBy(e => e.EmittedAt)
            .ToListAsync();
    }

    private static async Task<System.Collections.Generic.List<TelemetryEvent>> AllActionEventsAsync(InjectTestHost host, Guid exerciseId)
    {
        await using var db = host.Db(exerciseId);
        return await db.TelemetryEvents.Where(e => e.EventType == "inject_action").ToListAsync();
    }

    private static (string Action, string? Kind, string? Status) Payload(TelemetryEvent evt)
    {
        using var json = JsonDocument.Parse(evt.Payload!);
        var root = json.RootElement;
        return (
            root.GetProperty("action").GetString()!,
            root.TryGetProperty("kind", out var kind) ? kind.GetString() : null,
            root.TryGetProperty("status", out var status) ? status.GetString() : null);
    }
}
