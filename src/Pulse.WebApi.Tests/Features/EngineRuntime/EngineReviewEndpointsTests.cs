namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.Core.Core.Extensions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Helpers;
using Xunit;

/// <summary>
/// HTTP integration tests for the review-cockpit endpoints (story 02) over a bespoke minimal host wired
/// EXACTLY as the orchestrator will wire it into <c>Program.cs</c> after Gate-2 (<c>AddEngineReview()</c> +
/// <c>MapEngineReview()</c>), against the shared migrated Testcontainers SQL Server. Proves the route
/// mapping, the fail-closed scope handling (401 on an unresolved scope — extending the standing isolation
/// suite), the IDOR 404 (COR-001), and the publish/telemetry wiring end to end over real HTTP. Story 01's
/// <see cref="IEnginePublishService"/> is a capturing fake (contract-first seam; 01 owns the impl). Every
/// test is <see cref="RequiresDockerFactAttribute"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed partial class EngineReviewEndpointsTests
{
    private readonly MsSqlContainerFixture _fixture;

    public EngineReviewEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Routes_AreMappedExactlyOnce()
    {
        await using var host = await StartHostAsync(Guid.NewGuid());
        var dataSource = host.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "GET", "/api/engine/review-queue").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/review/{draftId:guid}/approve").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/review/{draftId:guid}/edit").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/review/{draftId:guid}/veto").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/review/{draftId:guid}/re-roll").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/review/batch-approve").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/autonomy/swamped-mode").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/autonomy/kill-switch").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/engine/autonomy/restore").Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task GetQueue_ReturnsScopedQueue_ExcludingResolved_InTheFrozenShape()
    {
        var exerciseId = Guid.NewGuid();
        var queued = Guid.NewGuid();
        var counting = Guid.NewGuid();
        var published = Guid.NewGuid();
        await SeedAsync(
            Item(queued, exerciseId, AutonomyLevel.Suggest, DraftDisposition.Queued, countdown: false),
            Item(counting, exerciseId, AutonomyLevel.DelayedAuto, DraftDisposition.CountingDown, countdown: true),
            Item(published, exerciseId, AutonomyLevel.Suggest, DraftDisposition.Published, countdown: false));

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.GetAsync(new Uri("/api/engine/review-queue", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        var items = doc.RootElement.EnumerateArray().ToList();

        items.Select(i => i.GetProperty("draftId").GetString())
            .Should().BeEquivalentTo(new[] { queued.ToString(), counting.ToString() },
                "the queue serves queued + counting-down + held, never resolved items");

        // The wire shape deserializes into the frozen reviewContracts.ts EngineReviewItem field-for-field.
        var sample = items.Single(i => i.GetProperty("draftId").GetString() == counting.ToString());
        foreach (var key in new[] { "exerciseId", "storylineId", "routedAtLevel", "disposition", "countdown", "posts", "storylineTag" })
        {
            sample.TryGetProperty(key, out _).Should().BeTrue($"the frozen contract requires a '{key}' key");
        }

        sample.GetProperty("disposition").GetString().Should().Be("counting-down");
    }

    [RequiresDockerFact]
    public async Task GetQueue_UnresolvedScope_Returns401_FailClosed()
    {
        var exerciseId = Guid.NewGuid();
        await SeedAsync(Item(Guid.NewGuid(), exerciseId, AutonomyLevel.Suggest, DraftDisposition.Queued, countdown: false));

        await using var host = await StartHostAsync(currentExerciseId: null);
        var response = await host.Client.GetAsync(new Uri("/api/engine/review-queue", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "an unresolved scope fails closed, never a default/empty-200");
    }

    [RequiresDockerFact]
    public async Task GetQueue_InExerciseA_NeverSurfacesExerciseBsItems()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var draftA = Guid.NewGuid();
        var draftB = Guid.NewGuid();
        await SeedAsync(
            Item(draftA, exerciseA, AutonomyLevel.Suggest, DraftDisposition.Queued, countdown: false),
            Item(draftB, exerciseB, AutonomyLevel.Suggest, DraftDisposition.Queued, countdown: false));

        await using var host = await StartHostAsync(exerciseA);
        var response = await host.Client.GetAsync(new Uri("/api/engine/review-queue", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateArray().Select(i => i.GetProperty("draftId").GetString())
            .Should().ContainSingle().Which.Should().Be(draftA.ToString(), "COR-001: a queue read in A never surfaces B's item");
    }

    [RequiresDockerFact]
    public async Task Approve_HappyPath_Returns200_Publishes_AndMarksPublished()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(Item(draftId, exerciseId, AutonomyLevel.DelayedAuto, DraftDisposition.CountingDown, countdown: true));

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/engine/review/{draftId}/approve", UriKind.Relative),
            new { actingHumanId = "controller-7", timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        host.Publisher.Published.Should().ContainSingle().Which.DraftId.Should().Be(draftId);

        await using var verify = _fixture.CreateContext();
        var reloaded = await verify.EngineReviewItems.IgnoreQueryFilters().SingleAsync(i => i.DraftId == draftId);
        reloaded.Disposition.Should().Be(DraftDisposition.Published);
    }

    [RequiresDockerFact]
    public async Task Approve_ForeignDraftId_FromExerciseAScope_Returns404_AndNeverPublishes()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var draftB = Guid.NewGuid();
        await SeedAsync(Item(draftB, exerciseB, AutonomyLevel.DelayedAuto, DraftDisposition.CountingDown, countdown: true));

        await using var host = await StartHostAsync(exerciseA);
        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/engine/review/{draftB}/approve", UriKind.Relative),
            new { actingHumanId = "controller-7", timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound, "an IDOR by exercise B's draft id from A's scope must fail closed (COR-001)");
        host.Publisher.Published.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Approve_MissingActingHumanId_Returns400()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(Item(draftId, exerciseId, AutonomyLevel.DelayedAuto, DraftDisposition.CountingDown, countdown: true));

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/engine/review/{draftId}/approve", UriKind.Relative),
            new { timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "COR-018 requires actingHumanId for a review decision");
        host.Publisher.Published.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Approve_UnresolvedScope_Returns401()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(Item(draftId, exerciseId, AutonomyLevel.DelayedAuto, DraftDisposition.CountingDown, countdown: true));

        await using var host = await StartHostAsync(currentExerciseId: null);
        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/engine/review/{draftId}/approve", UriKind.Relative),
            new { actingHumanId = "controller-7", timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        host.Publisher.Published.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Edit_OverTheTextCeiling_Returns400_WithTheIngestLengthMessage_AndNeverPublishes()
    {
        // Wave 3 Gate-2 M-1: a staff edit the ingest funnel would refuse is refused here first, with its message —
        // never cut, and never sent as a burst whose lead post fails while the rest go out.
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(Item(draftId, exerciseId, AutonomyLevel.DelayedAuto, DraftDisposition.CountingDown, countdown: true));

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/engine/review/{draftId}/edit", UriKind.Relative),
            new { text = new string('w', Pulse.WebApi.Features.Social.PostIngestService.TextLengthCeiling + 1), actingHumanId = "controller-9", timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain(Pulse.WebApi.Features.Social.PostIngestService.TextTooLongMessage);
        host.Publisher.Published.Should().BeEmpty("nothing publishes for a refused edit");

        await using var verify = _fixture.CreateContext();
        var reloaded = await verify.EngineReviewItems.IgnoreQueryFilters().SingleAsync(i => i.DraftId == draftId);
        reloaded.Disposition.Should().Be(DraftDisposition.CountingDown, "the item stays actionable");
    }

    [RequiresDockerFact]
    public async Task Veto_HappyPath_Returns200_MarksVetoed_AndNeverPublishes()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(Item(draftId, exerciseId, AutonomyLevel.DelayedAuto, DraftDisposition.CountingDown, countdown: true));

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/engine/review/{draftId}/veto", UriKind.Relative),
            new { actingHumanId = "controller-3", timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        host.Publisher.Published.Should().BeEmpty("a veto never publishes");

        await using var verify = _fixture.CreateContext();
        var reloaded = await verify.EngineReviewItems.IgnoreQueryFilters().SingleAsync(i => i.DraftId == draftId);
        reloaded.Disposition.Should().Be(DraftDisposition.Vetoed);
    }

    [RequiresDockerFact]
    public async Task SwampedMode_Enable_Returns200_WithSwampedModeOn()
    {
        var exerciseId = Guid.NewGuid();

        await using var host = await StartHostAsync(exerciseId, timeoutAutoSendAuthorized: true);
        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/swamped-mode", UriKind.Relative),
            new { actingHumanId = "lead-1", enabled = true });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.GetProperty("swampedMode").GetBoolean().Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task SwampedMode_Enable_WhileTimeoutAutoSendNotAuthorized_Returns400_WithTheGovernanceMessage()
    {
        var exerciseId = Guid.NewGuid();

        await using var host = await StartHostAsync(exerciseId, timeoutAutoSendAuthorized: false);
        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/swamped-mode", UriKind.Relative),
            new { actingHumanId = "lead-1", enabled = true });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "timeout auto-send is not authorised in Phase 1");
        var body = await response.Content.ReadAsStringAsync();
        JsonSerializer.Deserialize<string>(body).Should().Be(EngineReviewService.TimeoutAutoSendNotAuthorizedMessage);
        host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId).SwampedModeEnabled
            .Should().BeFalse("a refused request changes nothing");
    }

    [RequiresDockerFact]
    public async Task SwampedMode_Disable_WhileTimeoutAutoSendNotAuthorized_Returns200()
    {
        var exerciseId = Guid.NewGuid();

        await using var host = await StartHostAsync(exerciseId, timeoutAutoSendAuthorized: false);
        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/swamped-mode", UriKind.Relative),
            new { actingHumanId = "lead-1", enabled = false });

        response.StatusCode.Should().Be(HttpStatusCode.OK, "lowering is never refused");
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        doc.RootElement.GetProperty("swampedMode").GetBoolean().Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task KillSwitch_InvalidMode_Returns400()
    {
        var exerciseId = Guid.NewGuid();

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/kill-switch", UriKind.Relative),
            new { actingHumanId = "lead-1", mode = "nope" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [RequiresDockerFact]
    public async Task Restore_AfterKillSwitch_Returns200_WithClampLifted()
    {
        var exerciseId = Guid.NewGuid();

        await using var host = await StartHostAsync(exerciseId);

        // Clamp first (full stop) so there is a live clamp to lift, then restore over the SAME singleton state.
        var kill = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/kill-switch", UriKind.Relative),
            new { actingHumanId = "lead-1", mode = "full-stop" });
        kill.StatusCode.Should().Be(HttpStatusCode.OK);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/restore", UriKind.Relative),
            new { actingHumanId = "lead-1", timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.GetProperty("safetyClampActive").GetBoolean().Should().BeFalse("restore lifts the kill-switch clamp");
        doc.RootElement.GetProperty("generationStopped").GetBoolean().Should().BeFalse("restore resumes generation");
    }

    [RequiresDockerFact]
    public async Task Restore_MissingBody_Returns400()
    {
        var exerciseId = Guid.NewGuid();

        await using var host = await StartHostAsync(exerciseId);

        // An explicit JSON 'null' body binds the nullable request to null → the handler's own 400 guard fires.
        var content = new StringContent("null", System.Text.Encoding.UTF8, "application/json");
        var response = await host.Client.PostAsync(new Uri("/api/engine/autonomy/restore", UriKind.Relative), content);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a missing restore body is rejected before the service");
    }

    [RequiresDockerFact]
    public async Task Restore_UnresolvedScope_Returns401()
    {
        await using var host = await StartHostAsync(currentExerciseId: null);
        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/restore", UriKind.Relative),
            new { actingHumanId = "lead-1", timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "an unresolved scope fails closed, never a default/empty-200");
    }

    // ---- COR-005 staff-authorization gate (#286) ------------------------------------------------

    [RequiresDockerFact]
    public async Task GetQueue_NoStaffSession_ParticipantOrAnonymous_Returns401_FailClosed()
    {
        // A non-staff session (participant / anonymous) yields no CurrentStaffSession, so the cockpit is
        // unreachable even though B2 resolved a valid exercise scope. Fail closed with 401.
        var exerciseId = Guid.NewGuid();
        await SeedAsync(Item(Guid.NewGuid(), exerciseId, AutonomyLevel.Suggest, DraftDisposition.Queued, countdown: false));

        await using var host = await StartHostAsync(exerciseId, authenticatedStaff: false);
        var response = await host.Client.GetAsync(new Uri("/api/engine/review-queue", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "the staff-only cockpit must reject a non-staff session with 401 even when the exercise scope is resolved (COR-005)");
    }

    [RequiresDockerFact]
    public async Task Approve_NoStaffSession_ParticipantOrAnonymous_Returns401_AndNeverPublishes()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(Item(draftId, exerciseId, AutonomyLevel.DelayedAuto, DraftDisposition.CountingDown, countdown: true));

        await using var host = await StartHostAsync(exerciseId, authenticatedStaff: false);
        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/engine/review/{draftId}/approve", UriKind.Relative),
            new { actingHumanId = "controller-7", timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "a safety-critical mutation from a non-staff session must fail closed at the gate, before the handler");
        host.Publisher.Published.Should().BeEmpty("the gate rejects before the publish funnel is ever reached");
    }

    [RequiresDockerFact]
    public async Task GetQueue_SharedReadOnlySession_IsDenied_FailClosed()
    {
        // A shared read-only session is NOT a staff session (the real ICurrentStaffSessionAccessor yields null
        // for it), so it is denied exactly like a participant — the staff cockpit is staff-only by construction.
        var exerciseId = Guid.NewGuid();
        await SeedAsync(Item(Guid.NewGuid(), exerciseId, AutonomyLevel.Suggest, DraftDisposition.Queued, countdown: false));

        await using var host = await StartHostAsync(exerciseId, authenticatedStaff: false);
        var response = await host.Client.GetAsync(new Uri("/api/engine/review-queue", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "a shared read-only session is not a staff session and must not reach the staff cockpit");
    }

    [RequiresDockerFact]
    public async Task GetQueue_StaffAssignedToExerciseA_IsAllowed_ForAsQueue()
    {
        // The positive case: an authenticated staff user assigned to the resolved exercise passes the gate and
        // gets A's queue back (the default host wires exactly this — asserted explicitly here).
        var exerciseA = Guid.NewGuid();
        var draftA = Guid.NewGuid();
        await SeedAsync(Item(draftA, exerciseA, AutonomyLevel.Suggest, DraftDisposition.Queued, countdown: false));

        await using var host = await StartHostAsync(exerciseA, authenticatedStaff: true, assignedExerciseId: exerciseA);
        var response = await host.Client.GetAsync(new Uri("/api/engine/review-queue", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK, "a staff user assigned to the resolved exercise is authorized (COR-005)");
        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateArray().Select(i => i.GetProperty("draftId").GetString())
            .Should().ContainSingle().Which.Should().Be(draftA.ToString());
    }

    [RequiresDockerFact]
    public async Task GetQueue_StaffNotAssignedToResolvedExercise_Returns403_FailClosed()
    {
        // The staff user is assigned to a DIFFERENT exercise than the one resolved for the request — the gate
        // must reject with 403 (COR-005), defense-in-depth over B2's session→active-exercise scope.
        var resolvedExercise = Guid.NewGuid();
        var assignedElsewhere = Guid.NewGuid();
        await SeedAsync(Item(Guid.NewGuid(), resolvedExercise, AutonomyLevel.Suggest, DraftDisposition.Queued, countdown: false));

        await using var host = await StartHostAsync(resolvedExercise, authenticatedStaff: true, assignedExerciseId: assignedElsewhere);
        var response = await host.Client.GetAsync(new Uri("/api/engine/review-queue", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden,
            "a staff user not assigned to the resolved exercise must be rejected with 403 (COR-005)");
    }

    [RequiresDockerFact]
    public async Task Approve_StaffNotAssignedToResolvedExercise_Returns403_AndNeverPublishes()
    {
        var resolvedExercise = Guid.NewGuid();
        var assignedElsewhere = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(Item(draftId, resolvedExercise, AutonomyLevel.DelayedAuto, DraftDisposition.CountingDown, countdown: true));

        await using var host = await StartHostAsync(resolvedExercise, authenticatedStaff: true, assignedExerciseId: assignedElsewhere);
        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/engine/review/{draftId}/approve", UriKind.Relative),
            new { actingHumanId = "controller-7", timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden,
            "a safety-critical mutation by a staff user not assigned to the resolved exercise must fail closed with 403");
        host.Publisher.Published.Should().BeEmpty("the gate rejects before the publish funnel is ever reached");
    }

    // ---- host + helpers -------------------------------------------------------------------------

    private async Task<EngineReviewTestHost> StartHostAsync(
        Guid? currentExerciseId,
        bool authenticatedStaff = true,
        Guid? assignedExerciseId = null,
        bool timeoutAutoSendAuthorized = false,
        Action<IServiceCollection>? configureServices = null)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return await EngineReviewTestHost.StartAsync(
            _fixture.ConnectionString!, currentExerciseId, authenticatedStaff, assignedExerciseId, timeoutAutoSendAuthorized, configureServices);
    }

    // ---- WR-2: attribution is the SESSION person, never the body's actingHumanId ---------------------

    private const string SpoofedActingHumanId = "the-exercise-lead";

    [RequiresDockerFact]
    public async Task Approve_ASpoofedBodyActingHumanId_IsNotRecorded_TheSessionPersonIs()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(Item(draftId, exerciseId, AutonomyLevel.Suggest, DraftDisposition.Queued, countdown: false));
        await using var host = await StartHostAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/engine/review/{draftId}/approve", UriKind.Relative),
            new { actingHumanId = SpoofedActingHumanId, timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var reviewed = await EventsAsync(exerciseId, Pulse.WebApi.Features.EngineRuntime.Telemetry.EngineEventTypes.Reviewed);
        reviewed.Should().ContainSingle().Which.Actor.ActingHumanId.Should().Be(
            host.StaffUserId.ToString(), "the decision is attributed to the verified session's person (WR-2), not the body");
    }

    [RequiresDockerFact]
    public async Task Veto_ASpoofedBodyActingHumanId_IsNotRecorded_TheSessionPersonIs()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(Item(draftId, exerciseId, AutonomyLevel.Suggest, DraftDisposition.Queued, countdown: false));
        await using var host = await StartHostAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri($"/api/engine/review/{draftId}/veto", UriKind.Relative),
            new { actingHumanId = SpoofedActingHumanId, timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var reviewed = await EventsAsync(exerciseId, Pulse.WebApi.Features.EngineRuntime.Telemetry.EngineEventTypes.Reviewed);
        reviewed.Should().ContainSingle().Which.Actor.ActingHumanId.Should().Be(host.StaffUserId.ToString())
            .And.NotBe(SpoofedActingHumanId);
    }

    [RequiresDockerFact]
    public async Task KillSwitch_ASpoofedBodyActingHumanId_IsNotRecordedOnTheAmbientDemotion_TheSessionPersonIs()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        host.Services.GetRequiredService<EngineAmbientPolicyRegistry>().Set(exerciseId, new Pulse.Core.Features.Ambient.Models.AmbientTierPolicy
        {
            Mode = Pulse.Core.Features.Ambient.Models.AmbientPolicyMode.Autonomous,
            MaxPerMinute = 1,
            MaxPerHour = 1,
            TopicAllowList = [],
            PersonaAllowList = [],
            SetBy = "arrange",
        });

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/kill-switch", UriKind.Relative),
            new { actingHumanId = SpoofedActingHumanId, mode = "full-stop" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var demotion = await EventsAsync(exerciseId, Pulse.WebApi.Features.EngineRuntime.Telemetry.EngineEventTypes.TierPolicyChanged);
        demotion.Should().ContainSingle("the kill switch lowered autonomous ambient (AC6)")
            .Which.Actor.ActingHumanId.Should().Be(host.StaffUserId.ToString(), "the lever-puller is the session person (WR-2)");
    }

    [RequiresDockerFact]
    public async Task AutonomyDefault_ASpoofedBodyActingHumanId_IsNotRecorded_TheSessionPersonIs()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/settings/autonomy-default", UriKind.Relative),
            new { actingHumanId = SpoofedActingHumanId, level = "delayed-auto", timeZone = "UTC" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var changed = await EventsAsync(exerciseId, Pulse.WebApi.Features.EngineRuntime.Telemetry.EngineEventTypes.AutonomyDefaultChanged);
        changed.Should().ContainSingle().Which.Actor.ActingHumanId.Should().Be(host.StaffUserId.ToString())
            .And.NotBe(SpoofedActingHumanId);
    }

    /// <summary>
    /// Gate-1 WR-006: every one of the twelve request-bound steering routes, posted with a SPOOFED body
    /// <c>actingHumanId</c>, records the SESSION person in the route's XC-004 event — and nothing anywhere carries the
    /// spoofed value. #618: the three autonomy levers (<c>swamped-mode</c>, <c>kill-switch</c>, <c>autonomy/restore</c>)
    /// now record their own staff-change event + org audit, so for those rows the POSITIVE half is asserted too: the
    /// lever's event names the session person (and its session), and its org-audit row names the session person as actor.
    /// </summary>
    [RequiresDockerTheory]
    [InlineData("approve")]
    [InlineData("edit")]
    [InlineData("veto")]
    [InlineData("re-roll")]
    [InlineData("batch-approve")]
    [InlineData("swamped-mode")]
    [InlineData("kill-switch")]
    [InlineData("restore")]
    [InlineData("autonomy-default")]
    [InlineData("tier-policy")]
    [InlineData("cut-to-fake")]
    [InlineData("provider-restore")]
    public async Task EveryRoute_ASpoofedBodyActingHumanId_IsNotRecorded_TheSessionPersonIs(string route)
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(Item(draftId, exerciseId, AutonomyLevel.Suggest, DraftDisposition.Queued, countdown: false));
        await using var host = await StartHostAsync(exerciseId, timeoutAutoSendAuthorized: true); // swamped ON must pass the Phase-1 flag to reach attribution

        var autonomy = host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId);
        var (path, body, recordedEventType) = route switch
        {
            "approve" => ($"/api/engine/review/{draftId}/approve", (object)new { actingHumanId = SpoofedActingHumanId, timeZone = "America/Chicago" }, EngineEventTypes.Reviewed),
            "edit" => ($"/api/engine/review/{draftId}/edit", new { actingHumanId = SpoofedActingHumanId, timeZone = "America/Chicago", text = "Edited by the controller." }, EngineEventTypes.Reviewed),
            "veto" => ($"/api/engine/review/{draftId}/veto", new { actingHumanId = SpoofedActingHumanId, timeZone = "America/Chicago" }, EngineEventTypes.Reviewed),
            "re-roll" => ($"/api/engine/review/{draftId}/re-roll", new { actingHumanId = SpoofedActingHumanId, timeZone = "America/Chicago" }, EngineEventTypes.Reviewed),
            "batch-approve" => ("/api/engine/review/batch-approve", new { actingHumanId = SpoofedActingHumanId, timeZone = "America/Chicago", draftIds = new[] { draftId.ToString() } }, EngineEventTypes.Reviewed),
            "swamped-mode" => ("/api/engine/autonomy/swamped-mode", new { actingHumanId = SpoofedActingHumanId, enabled = true }, null),
            "kill-switch" => ArrangeAutonomousAmbient(host, exerciseId, "/api/engine/autonomy/kill-switch", new { actingHumanId = SpoofedActingHumanId, mode = "full-stop" }),
            "restore" => ArrangeKillSwitch(autonomy, "/api/engine/autonomy/restore", new { actingHumanId = SpoofedActingHumanId }),
            "autonomy-default" => ("/api/engine/settings/autonomy-default", new { actingHumanId = SpoofedActingHumanId, level = "delayed-auto" }, EngineEventTypes.AutonomyDefaultChanged),
            "tier-policy" => ("/api/engine/settings/tier-policy", new { actingHumanId = SpoofedActingHumanId, mode = "ambient" }, EngineEventTypes.TierPolicyChanged),

            // The configured provider is Fake here, so the cut itself records nothing; the lever's ambient demotion is the
            // route's record (AC6: the cut lowers autonomous ambient whether or not the provider was already Fake).
            "cut-to-fake" => ArrangeAutonomousAmbient(host, exerciseId, "/api/engine/generation-provider/cut-to-fake", new { actingHumanId = SpoofedActingHumanId }),
            "provider-restore" => ArrangeCut(host, exerciseId),
            _ => throw new ArgumentOutOfRangeException(nameof(route)),
        };

        using var response = await host.Client.PostAsJsonAsync(new Uri(path, UriKind.Relative), body);

        response.StatusCode.Should().Be(HttpStatusCode.OK, "{0} must succeed for the attribution proof to mean anything", route);
        await using var verify = _fixture.CreateContext();
        var events = await verify.TelemetryEvents.IgnoreQueryFilters().Where(e => e.ExerciseId == exerciseId).ToListAsync();
        events.Should().NotContain(
            e => e.Actor.ActingHumanId == SpoofedActingHumanId || (e.Payload != null && e.Payload.Contains(SpoofedActingHumanId)),
            "{0}: a spoofed body actingHumanId is never recorded (WR-2)", route);
        (await verify.OrgAuditEvents.IgnoreQueryFilters()
            .AnyAsync(a => a.ExerciseId == exerciseId && a.Payload.Contains(SpoofedActingHumanId)))
            .Should().BeFalse("{0}: nor in any audit record", route);

        if (recordedEventType is not null)
        {
            events.Where(e => e.EventType == recordedEventType).Should().NotBeEmpty("{0} records {1}", route, recordedEventType)
                .And.OnlyContain(
                    e => e.Actor.ActingHumanId == host.StaffUserId.ToString(),
                    "{0}: the decision is attributed to the verified session's person (WR-2)", route);
        }

        // #618: the autonomy levers' own record — positively the session person, on the event AND the org audit.
        var leverRecord = route switch
        {
            "swamped-mode" => (EngineSteeringLeverRecords.SwampedModeOnEventType, EngineSteeringLeverRecords.SwampedModeOnAuditKind),
            "kill-switch" => (EngineSteeringLeverRecords.KillSwitchEngagedEventType, EngineSteeringLeverRecords.KillSwitchEngagedAuditKind),
            "restore" => (EngineSteeringLeverRecords.AutonomyRestoredEventType, EngineSteeringLeverRecords.AutonomyRestoredAuditKind),
            _ => ((string EventType, string AuditKind)?)null,
        };
        if (leverRecord is { } lever)
        {
            var leverEvent = events.Where(e => e.EventType == lever.EventType).Should()
                .ContainSingle("{0} records exactly one {1}", route, lever.EventType).Subject;
            leverEvent.Actor.ActingHumanId.Should().Be(
                host.StaffUserId.ToString(), "{0}: the lever is attributed to the verified session's person (WR-2)", route);
            leverEvent.Actor.SessionId.Should().Be(host.SessionId.ToString(), "{0}: through the session it was pulled on", route);

            var audit = await verify.OrgAuditEvents.IgnoreQueryFilters()
                .Where(a => a.ExerciseId == exerciseId && a.Kind == lever.AuditKind)
                .ToListAsync();
            audit.Should().ContainSingle("{0} is mirrored to the org audit once", route)
                .Which.ActorPersonId.Should().Be(host.StaffUserId, "{0}: the audit names the session person", route);
        }
    }

    private static (string Path, object Body, string? EventType) ArrangeAutonomousAmbient(
        EngineReviewTestHost host, Guid exerciseId, string path, object body)
    {
        host.Services.GetRequiredService<EngineAmbientPolicyRegistry>().Set(exerciseId, new Pulse.Core.Features.Ambient.Models.AmbientTierPolicy
        {
            Mode = Pulse.Core.Features.Ambient.Models.AmbientPolicyMode.Autonomous,
            MaxPerMinute = 1,
            MaxPerHour = 1,
            TopicAllowList = [],
            PersonaAllowList = [],
            SetBy = "arrange",
        });
        return (path, body, EngineEventTypes.TierPolicyChanged);
    }

    private static (string Path, object Body, string? EventType) ArrangeKillSwitch(
        Pulse.Core.Features.Autonomy.Services.EngineAutonomyState autonomy, string path, object body)
    {
        autonomy.EngageKillSwitch(KillSwitchMode.DropToSuggest, "arrange", 0);
        return (path, body, null);
    }

    private static (string Path, object Body, string? EventType) ArrangeCut(EngineReviewTestHost host, Guid exerciseId)
    {
        host.Services.GetRequiredService<Pulse.Core.Features.Generation.Services.IGenerationProviderCutRegistry>().Cut(exerciseId);
        return ("/api/engine/generation-provider/restore", new { actingHumanId = SpoofedActingHumanId }, EngineEventTypes.ProviderChanged);
    }

    private async Task<List<TelemetryEvent>> EventsAsync(Guid exerciseId, string eventType)
    {
        await using var verify = _fixture.CreateContext();
        return await verify.TelemetryEvents
            .IgnoreQueryFilters()
            .Where(e => e.ExerciseId == exerciseId && e.EventType == eventType)
            .ToListAsync();
    }

    private async Task SeedAsync(params EngineReviewItemEntity[] items)
    {
        await using var seed = _fixture.CreateContext();
        seed.EngineReviewItems.AddRange(items);
        await seed.SaveChangesAsync();
    }

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<Microsoft.AspNetCore.Routing.HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    private static EngineReviewItemEntity Item(
        Guid draftId,
        Guid exerciseId,
        AutonomyLevel level,
        DraftDisposition disposition,
        bool countdown) => new()
    {
        DraftId = draftId,
        ExerciseId = exerciseId,
        StorylineId = Guid.NewGuid(),
        RoutedAtLevel = level,
        Disposition = disposition,
        CountdownStartedScenarioMinute = countdown ? 0 : null,
        CountdownMinutes = countdown ? 5 : null,
        CountdownDecision = countdown ? ControllerDecision.None : null,
        StorylineTag = "#WaterIssues",
        StorylineBrief = "Rising frustration about the water outage.",
        ActionLabel = "reply → @mvega_fh",
        Posts = new List<EngineReviewDraftPost>
        {
            new() { PersonaHandle = "@mvega_fh", Text = "Water pressure is dropping.", Sentiment = -0.3, Hashtags = new List<string> { "#WaterIssues" } },
        },
    };

    /// <summary>A capturing <see cref="IEnginePublishService"/> stand-in for story 01's funnel (contract-first seam).</summary>
    private sealed class CapturingEnginePublishService : IEnginePublishService
    {
        public List<EngineBurst> Published { get; } = new();

        public Task<EngineBurstPublishResult> PublishBurstAsync(EngineBurst burst, CancellationToken cancellationToken = default)
        {
            Published.Add(burst);
            return Task.FromResult(new EngineBurstPublishResult
            {
                Posts = burst.Posts
                    .Select(p => new EnginePublishedPost
                    {
                        PersonaHandle = p.PersonaHandle,
                        PostId = Guid.NewGuid(),
                        Outcome = EnginePublishOutcome.Published,
                    })
                    .ToList(),
            });
        }
    }

    /// <summary>
    /// A minimal host wired exactly as the orchestrator's future <c>Program.cs</c> edit will wire story 02
    /// (AddEngineReview + MapEngineReview), against the shared Testcontainers database. The non-request-bound
    /// tick host is removed so the HTTP tests are deterministic (the scenario clock is unstarted here, so no
    /// countdown would expire anyway); the auto-HOLD tick is exercised directly in the service suite.
    /// </summary>
    private sealed class EngineReviewTestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;

        private EngineReviewTestHost(WebApplication app, CapturingEnginePublishService publisher, Guid staffUserId, Guid sessionId)
        {
            _app = app;
            Publisher = publisher;
            StaffUserId = staffUserId;
            SessionId = sessionId;
            Client = app.GetTestClient();
        }

        /// <summary>The session's staff person — the identity every steering action is attributed to (WR-2).</summary>
        public Guid StaffUserId { get; }

        /// <summary>The live session the steering actions are made through (recorded on the #618 lever events).</summary>
        public Guid SessionId { get; }

        public HttpClient Client { get; }

        public CapturingEnginePublishService Publisher { get; }

        public IServiceProvider Services => _app.Services;

        public static async Task<EngineReviewTestHost> StartAsync(
            string connectionString,
            Guid? currentExerciseId,
            bool authenticatedStaff = true,
            Guid? assignedExerciseId = null,
            bool timeoutAutoSendAuthorized = false,
            Action<IServiceCollection>? configureServices = null)
        {
            var publisher = new CapturingEnginePublishService();

            // The staff caller the cockpit authorization filter (COR-005) gates on. A default host is an
            // authenticated staff user ASSIGNED to the resolved exercise (so the pre-existing route/scope/
            // publish tests pass through the new gate unchanged); the denial-case tests flip these knobs.
            var staffUserId = Guid.NewGuid();
            var sessionId = Guid.NewGuid();
            var accessor = authenticatedStaff
                ? new StubCurrentStaffSessionAccessor(new CurrentStaffSession { SessionId = sessionId, StaffUserId = staffUserId })
                : new StubCurrentStaffSessionAccessor(null);

            // Seed the assignment the filter checks against. Defaults to the resolved exercise (authorized);
            // a denial test can point it at a DIFFERENT exercise to prove the not-assigned 403. GetAssignments
            // inner-joins Exercise, so the Exercise row must exist for the assignment to surface.
            if (authenticatedStaff && (assignedExerciseId ?? currentExerciseId) is { } assignExercise)
            {
                await SeedStaffAssignmentAsync(connectionString, staffUserId, assignExercise);
            }

            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseTestServer();
            builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;

            // The governed timeout-auto-send flag (PROVIDER-GOVERNANCE §8, Phase 1), set explicitly per test.
            builder.Configuration["Generation:Governance:TimeoutAutoSendAuthorized"] = timeoutAutoSendAuthorized ? "true" : "false";

            // Wire exactly the production prerequisites the review endpoints depend on, then the feature.
            builder.Services.AddPulsePersistence(builder.Configuration);
            builder.Services.AddExerciseScoping();
            builder.Services.AddSignalR();
            builder.Services.AddEngineRuntimeSeams();
            builder.Services.AddExerciseClock();

            // The generation core (Fake by config default): AddEngineReview's service now also reads the active
            // IGenerationProvider.Name + IOptions<GenerationOptions> for GET /api/engine/settings, so the same
            // AddEngineGeneration-before-AddEngineReview order Program.cs uses is required here too.
            builder.Services.AddEngineGeneration(builder.Configuration);
            builder.Services.AddEngineReview();

            // B2's staff-identity dependency the cockpit authorization filter reuses (the orchestrator wires
            // AddStaffIdentity before the engine-review feature in production). Register just the assignment
            // service + the (stubbed) current-staff-session accessor the filter resolves per request.
            builder.Services.AddScoped<StaffAssignmentService>();
            builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
            builder.Services.AddScoped<ICurrentStaffSessionAccessor>(_ => accessor);

            // The auto-HOLD tick host stays registered (production-faithful) but is inert in these HTTP tests:
            // the scenario clock is never started here, so every exercise reads scenario minute 0 and no
            // countdown reaches its deadline — no auto-HOLD fires. EvaluateAutoHold is exercised directly in the
            // service suite. (Do NOT RemoveAll<IHostedService> — that would also drop the web host service.)

            // Story 01's publish funnel (contract-first seam) — capturing fake here.
            builder.Services.AddSingleton<IEnginePublishService>(publisher);

            // The server-authoritative request scope (fixed per host; null = the fail-closed case).
            builder.Services.RemoveAll<IExerciseContext>();
            builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = currentExerciseId });

            // A test's own substitutions (e.g. #618's failing steering-lever recorder), applied last.
            configureServices?.Invoke(builder.Services);

            var app = builder.Build();
            app.MapEngineReview();
            await app.StartAsync();

            return new EngineReviewTestHost(app, publisher, staffUserId, sessionId);
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.DisposeAsync();
        }

        /// <summary>
        /// Seeds the <see cref="Exercise"/> + <see cref="StaffAssignment"/> rows the cockpit authorization
        /// filter reads (via <see cref="StaffAssignmentService.GetAssignmentsAsync"/>) so the seeded staff user
        /// is assigned to <paramref name="exerciseId"/>. Both are unscoped entities, so the write-guard needs
        /// no resolved exercise scope here.
        /// </summary>
        private static async Task SeedStaffAssignmentAsync(string connectionString, Guid staffUserId, Guid exerciseId)
        {
            var options = new DbContextOptionsBuilder<PulseDbContext>()
                .UseSqlServer(connectionString)
                .Options;

            await using var context = new PulseDbContext(options);
            context.Exercises.Add(new Exercise
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = exerciseId,
                Name = "Cockpit Auth Test Exercise",
                TimeZone = "UTC",
                Status = "active",
            });
            // exercise-isolation/11: the staff human the session names must EXIST and share the exercise's
            // customer tenant, or the org bound fails closed and every staff endpoint 403s.
            context.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId));
            context.Enrollments.Add(new Enrollment
            {
                Id = Guid.NewGuid(),
                PersonId = staffUserId,
                ExerciseId = exerciseId,
                Role = "controller",

                // identity-auth-roles/17: the suite's controller is the exercise's LEAD — the raise routes need it.
                IsLead = true,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await context.SaveChangesAsync();
        }
    }
}
