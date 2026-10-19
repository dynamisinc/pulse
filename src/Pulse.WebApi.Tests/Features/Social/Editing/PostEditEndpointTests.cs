namespace Pulse.WebApi.Tests.Features.Social.Editing;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Editing;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// demo-feedback story 19 — <c>PATCH /api/posts/{postId}</c> end to end over real SQL: who may edit (own post and own
/// reply only, participant origin only, never staff or read-only), isolation (another exercise is 404), the window and
/// limit (DF-30, on a hand-advanced wall clock standing in for <c>FakeTimeProvider</c>), the Freeze /
/// paused-or-ended refusal (a frozen clock alone no longer refuses, #379), the identical-text no-op, the sanitizer,
/// the one-transaction write, the <c>PostEdited</c>
/// push and the <c>post.edited</c> telemetry.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PostEditEndpointTests
{
    private readonly MsSqlContainerFixture _fixture;

    public PostEditEndpointTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private string ConnectionString => _fixture.ConnectionString
        ?? throw new InvalidOperationException("The MsSql fixture has no connection string.");

    private static async Task<JsonObject> JsonOf(HttpResponseMessage response) =>
        JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();

    private static async Task<(PostEditTestHost Host, Guid ExerciseId, Guid PersonaId)> StartWithParticipantAsync(
        PostEditTestHost host)
    {
        var exerciseId = await host.SeedExerciseAsync();
        var personaId = await host.SeedPersonaAsync(exerciseId);
        host.ActAsParticipant(exerciseId, personaId);
        return (host, exerciseId, personaId);
    }

    // ---- Who may edit (AC-1) -------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task OwnPost_Edit_Returns200_WritesOneEditRow_AndUpdatesThePostInOneTransaction()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId, body: "Flood on Mian St", withMedia: true);
        var before = await host.ReadPostAsync(postId);
        host.Time.Advance(TimeSpan.FromMinutes(2));

        using var response = await host.EditAsync(postId, "Flood on Main St");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await JsonOf(response);
        json["id"]!.GetValue<string>().Should().Be(postId.ToString());
        json["text"]!.GetValue<string>().Should().Be("Flood on Main St");
        json["edited"]!["count"]!.GetValue<int>().Should().Be(1);
        json["edited"]!["scenarioTime"]!.GetValue<string>().Should().Be(PostEditTestHost.StoredScenarioTime.ToString("O"),
            "with no running clock the edit's scenario time falls back to the exercise's stored scenario time");
        json["viewer"]!["editableForSeconds"]!.GetValue<int>().Should().Be(13 * 60,
            "13 minutes are left of the 15-minute window after 2 minutes");
        json.ContainsKey("lastEditedAt").Should().BeFalse("the wall-clock edit time is never on a participant DTO (XC-002)");
        json["media"]!.AsArray().Should().ContainSingle("media is untouched by an edit");

        var after = await host.ReadPostAsync(postId);
        after.Body.Should().Be("Flood on Main St");
        after.EditCount.Should().Be(1);
        after.LastEditedAt.Should().Be(host.Time.GetUtcNow());
        after.LastEditedScenarioTime.Should().Be(PostEditTestHost.StoredScenarioTime);
        after.AuthorPersonaId.Should().Be(before.AuthorPersonaId);
        after.Origin.Should().Be(before.Origin);
        after.ParentPostId.Should().Be(before.ParentPostId);
        after.CreatedScenarioTime.Should().Be(before.CreatedScenarioTime);
        after.BaselineLikeCount.Should().Be(before.BaselineLikeCount, "counts are untouched by an edit");

        var edit = (await host.ReadEditsAsync(postId)).Should().ContainSingle().Subject;
        edit.EditNumber.Should().Be(1);
        edit.PreviousBody.Should().Be("Flood on Mian St");
        edit.EditedAt.Should().Be(host.Time.GetUtcNow());
        edit.EditedScenarioTime.Should().Be(PostEditTestHost.StoredScenarioTime);
        edit.ExerciseId.Should().Be(exerciseId);
        edit.ActingHumanId.Should().Be($"human-{personaId:N}");
    }

    [RequiresDockerFact]
    public async Task OwnReply_EditsTheSameWay_AndKeepsItsParent()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var otherPersona = await host.SeedPersonaAsync(exerciseId);
        var parentId = await host.SeedPostAsync(exerciseId, otherPersona, origin: "controller-as-persona");
        var replyId = await host.SeedPostAsync(exerciseId, personaId, parentPostId: parentId, body: "Stay saf");

        using var response = await host.EditAsync(replyId, "Stay safe");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await JsonOf(response);
        json["inReplyTo"]!["postId"]!.GetValue<string>().Should().Be(parentId.ToString());
        (await host.ReadPostAsync(replyId)).ParentPostId.Should().Be(parentId, "the reply target never changes (DF-29)");
        (await host.ReadPostAsync(replyId)).Body.Should().Be("Stay safe");
    }

    [RequiresDockerFact]
    public async Task AnotherParticipantsPost_Returns403_AndWritesNothing()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, _) = await StartWithParticipantAsync(host);
        var otherPersona = await host.SeedPersonaAsync(exerciseId);
        var postId = await host.SeedPostAsync(exerciseId, otherPersona);

        using var response = await host.EditAsync(postId, "Not mine");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await host.ReadPostAsync(postId)).EditCount.Should().Be(0);
        (await host.ReadEditsAsync(postId)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task StaffSession_Returns403_EvenWhenBoundToTheAuthorPersona()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId);
        host.ActAsStaff(exerciseId, personaId);

        using var response = await host.EditAsync(postId, "Controller edit");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "controllers do not edit persona posts (DF-32)");
        (await host.ReadPostAsync(postId)).EditCount.Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task ReadOnlySession_IsRefused_LikeEveryParticipantWrite()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId);
        host.ActAsReadOnly(exerciseId, personaId);

        using var response = await host.EditAsync(postId, "Observer edit");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "a read-only session never writes (COR-015)");
        (await host.ReadPostAsync(postId)).EditCount.Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task NonParticipantOrigins_Return403()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);

        foreach (var origin in new[] { "engine", "noise", "controller-as-persona", "inject" })
        {
            var postId = await host.SeedPostAsync(exerciseId, personaId, origin: origin);

            using var response = await host.EditAsync(postId, "Edited " + origin);

            response.StatusCode.Should().Be(HttpStatusCode.Forbidden, $"a {origin}-origin post is not editable (DF-29)");
            (await host.ReadPostAsync(postId)).EditCount.Should().Be(0);
        }
    }

    [RequiresDockerFact]
    public async Task TakenDownPost_Returns404()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId, deletedAt: PostEditTestHost.PostScenarioTime);

        using var response = await host.EditAsync(postId, "Back from the dead");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await host.ReadPostAsync(postId)).EditCount.Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task AnotherExercisesPost_Returns404_AndIsNeverWritten_EvenForTheSamePersonaId()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var exerciseA = await host.SeedExerciseAsync();
        var exerciseB = await host.SeedExerciseAsync();
        var personaB = await host.SeedPersonaAsync(exerciseB);
        var postInB = await host.SeedPostAsync(exerciseB, personaB, body: "B's own words");

        // The caller is in A, presenting B's persona id: scope still comes only from IExerciseContext (COR-001).
        host.ActAsParticipant(exerciseA, personaB);

        using var edit = await host.EditAsync(postInB, "Leaked edit");
        using var history = await host.HistoryAsync(postInB);

        edit.StatusCode.Should().Be(HttpStatusCode.NotFound, "another exercise's post is indistinguishable from none");
        history.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var row = await host.ReadPostAsync(postInB);
        row.Body.Should().Be("B's own words", "the row exists (IgnoreQueryFilters) and was never touched");
        (await host.ReadEditsAsync(postInB)).Should().BeEmpty();
        host.Broadcaster.Edited.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task UnresolvedScope_Returns401()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId);
        host.ActUnscoped();

        using var edit = await host.EditAsync(postId, "x");
        using var history = await host.HistoryAsync(postId);

        edit.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "an unresolved scope fails closed");
        history.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ---- Text rules (AC-2) ---------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Sanitizer_IsApplied_AScriptEditIsStoredInert()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId);
        const string raw = "Fixed <script>alert('x')</script><b>now</b>";

        using var response = await host.EditAsync(postId, raw);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var stored = (await host.ReadPostAsync(postId)).Body;
        stored.Should().Be(PostSanitizer.Sanitize(raw), "the edit goes through the same sanitizer as create (NFR-004)");
        stored.Should().NotContain("<script").And.NotContain("<b>");
    }

    [RequiresDockerFact]
    public async Task EmptyMissingOrTooLongText_Returns400_AndWritesNothing()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId);

        using var missing = await host.EditAsync(postId, null);
        using var empty = await host.EditAsync(postId, "   ");
        using var markupOnly = await host.EditAsync(postId, "<script>x</script>");
        using var tooLong = await host.EditAsync(postId, new string('a', PostIngestService.TextLengthCeiling + 1));

        missing.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        empty.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        markupOnly.StatusCode.Should().Be(HttpStatusCode.BadRequest, "sanitized to nothing, so it is empty");
        tooLong.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await host.ReadPostAsync(postId)).EditCount.Should().Be(0);
    }

    // ---- Window and limit (AC-3) ---------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Window_IsOpenAt14m59_AndClosedAt15m01()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId);

        host.Time.Advance(TimeSpan.FromMinutes(14) + TimeSpan.FromSeconds(59));
        using var open = await host.EditAsync(postId, "Inside the window");
        open.StatusCode.Should().Be(HttpStatusCode.OK);

        host.Time.Advance(TimeSpan.FromSeconds(2));
        using var closed = await host.EditAsync(postId, "Outside the window");

        closed.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await JsonOf(closed))["reason"]!.GetValue<string>().Should().Be("window-closed");
        (await host.ReadPostAsync(postId)).Body.Should().Be("Inside the window");
    }

    [RequiresDockerFact]
    public async Task SixthEdit_IsRefused_WithEditLimit()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId);

        for (var n = 1; n <= 5; n++)
        {
            using var ok = await host.EditAsync(postId, $"Version {n}");
            ok.StatusCode.Should().Be(HttpStatusCode.OK, $"edit {n} of 5 is allowed");
        }

        using var sixth = await host.EditAsync(postId, "Version 6");

        sixth.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await JsonOf(sixth))["reason"]!.GetValue<string>().Should().Be("edit-limit");
        var edits = await host.ReadEditsAsync(postId);
        edits.Select(e => e.EditNumber).Should().Equal(1, 2, 3, 4, 5);
        (await host.ReadPostAsync(postId)).EditCount.Should().Be(5);
    }

    // ---- Posting refused (AC-3, amended) -------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task FreezeTier_RefusesTheEdit_WithFrozen()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId);
        await host.PauseTiers.SetTierAsync(
            exerciseId, PauseTier.Freeze, "controller-1", new PauseClockStart(PostEditTestHost.StoredScenarioTime, TimeZoneInfo.Utc));

        using var response = await host.EditAsync(postId, "During freeze");

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await JsonOf(response))["reason"]!.GetValue<string>().Should().Be("frozen");
        (await host.ReadPostAsync(postId)).EditCount.Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task FreezeTier_WithTheClockRunning_StillRefusesTheEdit_WithFrozen()
    {
        // #379 (Tom's condition for dropping the frozen-clock check): the Freeze TIER refuses, whatever the clock
        // reads.
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId);
        await host.PauseTiers.SetTierAsync(
            exerciseId,
            PauseTier.Freeze,
            "controller-1",
            new PauseClockStart(PostEditTestHost.StoredScenarioTime, TimeZoneInfo.Utc));
        host.Clock.Unfreeze(exerciseId);
        host.Clock.IsFrozen(exerciseId).Should().BeFalse("this test needs the Freeze tier with a RUNNING clock");

        using var response = await host.EditAsync(postId, "During freeze, clock running");

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await JsonOf(response))["reason"]!.GetValue<string>().Should().Be("frozen");
        (await host.ReadPostAsync(postId)).EditCount.Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task FrozenClock_WithNoFreezeTierAndALiveLifecycle_DoesNotRefuseTheEdit()
    {
        // #379: the separate frozen-clock condition is gone. Only the Freeze tier or a lifecycle refusing participant
        // writes refuses; a clock frozen on its own (e.g. to pin scenario time) leaves the edit allowed.
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId);
        host.Clock.Start(exerciseId, PostEditTestHost.StoredScenarioTime, TimeZoneInfo.Utc);
        host.Clock.Freeze(exerciseId);
        host.PauseTiers.GetTier(exerciseId).Should().Be(PauseTier.Running);

        using var response = await host.EditAsync(postId, "Clock frozen");

        response.StatusCode.Should().Be(
            HttpStatusCode.OK, "a frozen clock without a Freeze tier or a paused lifecycle is not a refusal");
        (await host.ReadPostAsync(postId)).EditCount.Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task PausedLifecycle_IsRefused409Frozen_AndAnEndedOneIs403FromTheLifecycleGate()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId);

        await host.SetStatusAsync(exerciseId, "paused");
        using (var paused = await host.EditAsync(postId, "While paused"))
        {
            paused.StatusCode.Should().Be(HttpStatusCode.Conflict, "paused is served (holding page) but posting is refused");
            (await JsonOf(paused))["reason"]!.GetValue<string>().Should().Be("frozen");
        }

        await host.SetStatusAsync(exerciseId, "completed");
        using (var completed = await host.EditAsync(postId, "After EndEx"))
        {
            completed.StatusCode.Should().Be(HttpStatusCode.Forbidden,
                "ExerciseLifecycleGatingMiddleware refuses /api/posts in completed before the handler runs (COR-032)");
        }

        (await host.ReadPostAsync(postId)).EditCount.Should().Be(0);
        host.Broadcaster.Edited.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task TheWindowKeepsRunningThroughAPause_AndStillClosesAt15m01()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId);

        host.Time.Advance(TimeSpan.FromMinutes(1));
        await host.SetStatusAsync(exerciseId, "paused");
        host.Time.Advance(TimeSpan.FromMinutes(14));
        await host.SetStatusAsync(exerciseId, "live");
        host.Time.Advance(TimeSpan.FromSeconds(1));

        using var response = await host.EditAsync(postId, "After resume");

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await JsonOf(response))["reason"]!.GetValue<string>().Should().Be("window-closed",
            "the 15-minute window is wall clock and kept running while edits were blocked (DF-30)");
    }

    // ---- No-op, push, telemetry (AC-4, AC-6, AC-11) --------------------------------------------------------------

    [RequiresDockerFact]
    public async Task IdenticalSanitizedText_Is200_WithNothingWrittenAndNothingPushed()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId, body: "Same words");

        using var response = await host.EditAsync(postId, "Same words<script>x</script>");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await JsonOf(response);
        json["text"]!.GetValue<string>().Should().Be("Same words");
        json["edited"].Should().BeNull("nothing was edited");
        (await host.ReadPostAsync(postId)).EditCount.Should().Be(0);
        (await host.ReadEditsAsync(postId)).Should().BeEmpty();
        (await host.ReadTelemetryAsync(exerciseId)).Should().BeEmpty();
        host.Broadcaster.Edited.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task ARealEdit_PushesOnePostEdited_ToItsExerciseOnly_AndNeverAPostReceived()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId);

        using var first = await host.EditAsync(postId, "First fix");
        using var second = await host.EditAsync(postId, "Second fix");

        host.Broadcaster.Received.Should().BeEmpty("an edit is not a new post (DF-33)");
        host.Broadcaster.Edited.Should().HaveCount(2);
        host.Broadcaster.Edited.Select(e => e.ExerciseId).Should().AllBeEquivalentTo(exerciseId);
        var frame = host.Broadcaster.Edited[1].Frame;
        frame.PostId.Should().Be(postId.ToString());
        frame.Text.Should().Be("Second fix");
        frame.Edited.Count.Should().Be(2);
        frame.Version.Should().Be(2, "version = EditCount, monotonic per post");
        frame.Edited.ScenarioTime.Should().Be(PostEditTestHost.StoredScenarioTime.ToString("O"));
    }

    [RequiresDockerFact]
    public async Task AFailingBroadcaster_DoesNotFailTheEdit()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString, new ThrowingEditBroadcaster());
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId);

        using var response = await host.EditAsync(postId, "Committed anyway");

        response.StatusCode.Should().Be(HttpStatusCode.OK, "a push failure after commit is logged and swallowed");
        (await host.ReadPostAsync(postId)).Body.Should().Be("Committed anyway");
    }

    [RequiresDockerFact]
    public async Task Telemetry_IsOnePostEditedEvent_WithIdsAndTimes_AndNoText()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId, body: "secret-old-words");

        using var response = await host.EditAsync(postId, "secret-new-words");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var evt = (await host.ReadTelemetryAsync(exerciseId)).Should().ContainSingle().Subject;
        evt.EventType.Should().Be("post.edited");
        evt.Target!.EntityId.Should().Be(postId.ToString());
        evt.WallClockTime.Should().Be(host.Time.GetUtcNow());
        evt.ScenarioTime.Should().Be(PostEditTestHost.StoredScenarioTime);
        evt.Actor.PersonaId.Should().Be(personaId.ToString());
        var payload = JsonNode.Parse(evt.Payload!)!.AsObject();
        payload.Select(p => p.Key).Should().BeEquivalentTo("postId", "editNumber", "sessionKind");
        payload["editNumber"]!.GetValue<int>().Should().Be(1);
        payload["sessionKind"]!.GetValue<string>().Should().Be("participant");
        evt.Payload.Should().NotContain("secret", "telemetry never carries the text (old or new)");
    }

    [RequiresDockerFact]
    public async Task EveryEditRow_CarriesItsPostsExercise()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var exerciseA = await host.SeedExerciseAsync();
        var exerciseB = await host.SeedExerciseAsync();
        var personaA = await host.SeedPersonaAsync(exerciseA);
        var personaB = await host.SeedPersonaAsync(exerciseB);
        var postA = await host.SeedPostAsync(exerciseA, personaA);
        var postB = await host.SeedPostAsync(exerciseB, personaB);

        host.ActAsParticipant(exerciseA, personaA);
        (await host.EditAsync(postA, "A edit")).StatusCode.Should().Be(HttpStatusCode.OK);
        host.ActAsParticipant(exerciseB, personaB);
        (await host.EditAsync(postB, "B edit")).StatusCode.Should().Be(HttpStatusCode.OK);

        (await host.ReadEditsAsync(postA)).Should().OnlyContain(e => e.ExerciseId == exerciseA,
            "PostEdit.ExerciseId is copied from the loaded post, never the request (17 Gate-1 L-1)");
        (await host.ReadEditsAsync(postB)).Should().OnlyContain(e => e.ExerciseId == exerciseB);

        // And the scoped read of A never sees B's edit rows.
        await using var dbA = host.Db(exerciseA);
        dbA.PostEdits.Where(e => e.PostId == postB).Should().BeEmpty("the central filter closes B's rows to A");
    }

    // ---- History (AC-7) ------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task History_AcrossThreeEdits_IsNewestFirst_WithEveryVersionsTextAndScenarioTime()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId, body: "v0");
        host.Clock.Start(exerciseId, PostEditTestHost.StoredScenarioTime, TimeZoneInfo.Utc);

        for (var n = 1; n <= 3; n++)
        {
            host.Time.Advance(TimeSpan.FromMinutes(1));
            (await host.EditAsync(postId, $"v{n}")).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        // Any session in the exercise reads it: a staff console here.
        host.ActAsStaff(exerciseId);
        using var response = await host.HistoryAsync(postId);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await JsonOf(response);
        json["postId"]!.GetValue<string>().Should().Be(postId.ToString());
        var versions = json["versions"]!.AsArray().Select(v => v!.AsObject()).ToList();
        versions.Select(v => v["editNumber"]!.GetValue<int>()).Should().Equal(3, 2, 1, 0);
        versions.Select(v => v["text"]!.GetValue<string>()).Should().Equal("v3", "v2", "v1", "v0");

        var edits = await host.ReadEditsAsync(postId);
        versions[0]["scenarioTime"]!.GetValue<string>().Should().Be(edits[2].EditedScenarioTime.ToString("O"));
        versions[2]["scenarioTime"]!.GetValue<string>().Should().Be(edits[0].EditedScenarioTime.ToString("O"));
        versions[3]["scenarioTime"]!.GetValue<string>().Should().Be(PostEditTestHost.PostScenarioTime.ToString("O"));
        edits.Select(e => e.EditedScenarioTime).Should().BeInAscendingOrder("the running clock advanced between edits");
        versions.Should().OnlyContain(v => v.Count == 3, "versions carry editNumber, text and scenarioTime only");
    }

    [RequiresDockerFact]
    public async Task History_OfANeverEditedPost_IsTheOriginalAlone_AndATakenDownPostIs404()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var postId = await host.SeedPostAsync(exerciseId, personaId, body: "only version");
        var downId = await host.SeedPostAsync(exerciseId, personaId, deletedAt: PostEditTestHost.PostScenarioTime);
        host.ActAsReadOnly(exerciseId);

        using var history = await host.HistoryAsync(postId);
        using var down = await host.HistoryAsync(downId);

        history.StatusCode.Should().Be(HttpStatusCode.OK, "a read-only observer may read history");
        var versions = (await JsonOf(history))["versions"]!.AsArray();
        versions.Should().ContainSingle();
        versions[0]!["editNumber"]!.GetValue<int>().Should().Be(0);
        versions[0]!["text"]!.GetValue<string>().Should().Be("only version");
        down.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ---- Read contract (AC-6) ------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task FeedAndThread_CarryEdited_AndEditableForSecondsOnlyOnTheViewersOwnParticipantPosts()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var (_, exerciseId, personaId) = await StartWithParticipantAsync(host);
        var otherPersona = await host.SeedPersonaAsync(exerciseId);
        var mine = await host.SeedPostAsync(exerciseId, personaId);
        var theirs = await host.SeedPostAsync(exerciseId, otherPersona);
        var myEngineAuthored = await host.SeedPostAsync(exerciseId, personaId, origin: "engine");
        host.Time.Advance(TimeSpan.FromMinutes(5));
        (await host.EditAsync(mine, "Mine, fixed")).StatusCode.Should().Be(HttpStatusCode.OK);

        using var feed = await host.Client.GetAsync("/api/feed");
        feed.StatusCode.Should().Be(HttpStatusCode.OK);
        var raw = await feed.Content.ReadAsStringAsync();
        var posts = JsonNode.Parse(raw)!.AsArray().Select(p => p!.AsObject()).ToDictionary(p => p["id"]!.GetValue<string>());

        posts[mine.ToString()]["edited"]!["count"]!.GetValue<int>().Should().Be(1);
        posts[mine.ToString()]["viewer"]!["editableForSeconds"]!.GetValue<int>().Should().Be(10 * 60);
        posts[theirs.ToString()].ContainsKey("edited").Should().BeTrue("edited is always on the wire");
        posts[theirs.ToString()]["edited"].Should().BeNull("never edited");
        posts[theirs.ToString()]["viewer"]!.AsObject().ContainsKey("editableForSeconds").Should().BeFalse(
            "only the viewer's own posts carry the countdown");
        posts[myEngineAuthored.ToString()]["viewer"]!.AsObject().ContainsKey("editableForSeconds").Should().BeFalse(
            "a non-participant-origin post is never editable");
        raw.Should().NotContain("lastEditedAt").And.NotContain("editedAt\"");

        host.Time.Advance(TimeSpan.FromMinutes(11));
        using var thread = await host.Client.GetAsync($"/api/threads/{mine}");
        thread.StatusCode.Should().Be(HttpStatusCode.OK);
        var threadJson = await thread.Content.ReadAsStringAsync();
        threadJson.Should().Contain("\"edited\":{\"count\":1");
        threadJson.Should().Contain("\"editableForSeconds\":0", "the window has closed: 0, not absent, on the viewer's own post");

        // A staff reader (Live world) gets edited but never a viewer countdown.
        host.ActAsStaff(exerciseId);
        using var staffFeed = await host.Client.GetAsync("/api/feed");
        var staffRaw = await staffFeed.Content.ReadAsStringAsync();
        staffRaw.Should().Contain("\"edited\":{\"count\":1").And.NotContain("editableForSeconds");
    }
}
