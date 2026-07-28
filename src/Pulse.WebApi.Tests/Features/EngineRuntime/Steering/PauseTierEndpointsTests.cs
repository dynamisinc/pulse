namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

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
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.ParticipantShell;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Xunit;

/// <summary>
/// HTTP integration tests for the server-authoritative pause-tier endpoints (world-steering/07) over a bespoke
/// minimal host wired EXACTLY as the orchestrator will wire it into <c>Program.cs</c> after Gate-2
/// (<c>AddPauseTierSteering()</c> + <c>MapPauseTierSteering()</c>), against the shared migrated Testcontainers
/// SQL Server. Proves the route mapping, that the REUSED
/// <see cref="Pulse.WebApi.Features.EngineRuntime.EngineCockpitStaffAuthorizationFilter"/> fails closed
/// (<c>401</c> unauthenticated/unscoped, <c>403</c> staff-but-unassigned, <c>200</c> assigned), that a Freeze
/// reaches the shipped <see cref="IExerciseClock"/>, and that the tier is recorded per exercise with no
/// client-supplied <c>exerciseId</c> ever honoured (COR-001). Every test is
/// <see cref="RequiresDockerFactAttribute"/> — the staff gate reads real assignment rows.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PauseTierEndpointsTests
{
    private readonly MsSqlContainerFixture _fixture;

    public PauseTierEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Routes_AreMappedExactlyOnce()
    {
        await using var host = await StartHostAsync(Guid.NewGuid());
        var dataSource = host.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "GET", "/api/steering/pause-tier").Should().Be(1);
        CountRoutes(dataSource, "POST", "/api/steering/pause-tier").Should().Be(1);
    }

    // ---- the reused staff gate: fail closed (COR-001/COR-005, XC-002) --------------------------

    [RequiresDockerFact]
    public async Task Post_NoStaffSession_Returns401_FailClosed()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, authenticatedStaff: false);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01", timeZone = "America/Chicago" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "an unauthenticated caller must never reach a staff steering control");
        host.Clock.IsFrozen(exerciseId).Should().BeFalse("the gate rejects before the clock is ever touched");
    }

    [RequiresDockerFact]
    public async Task Post_UnresolvedScope_Returns401_FailClosed()
    {
        await using var host = await StartHostAsync(currentExerciseId: null);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "an unresolved scope fails closed, never a default/empty-200 (COR-001)");
    }

    [RequiresDockerFact]
    public async Task Post_StaffNotAssignedToResolvedExercise_Returns403_AndNeverFreezes()
    {
        var resolvedExercise = Guid.NewGuid();
        var assignedElsewhere = Guid.NewGuid();
        await using var host = await StartHostAsync(
            resolvedExercise, authenticatedStaff: true, assignedExerciseId: assignedElsewhere);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden,
            "a staff user not assigned to the resolved exercise must be rejected with 403 (COR-005)");
        host.Clock.IsFrozen(resolvedExercise).Should().BeFalse(
            "the gate rejects before the safety action reaches the clock");
    }

    [RequiresDockerFact]
    public async Task Get_NoStaffSession_Returns401_FailClosed()
    {
        await using var host = await StartHostAsync(Guid.NewGuid(), authenticatedStaff: false);

        var response = await host.Client.GetAsync(new Uri("/api/steering/pause-tier", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [RequiresDockerFact]
    public async Task Get_AssignedStaff_Returns200WithTheRunningBaseline()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        var response = await host.Client.GetAsync(new Uri("/api/steering/pause-tier", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK,
            "a staff user assigned to the resolved exercise is authorized (COR-005)");
        var state = await ReadStateAsync(response);
        state.Tier.Should().Be("running");
        state.ClockFrozen.Should().BeFalse();
    }

    // ---- Freeze reaches the SHIPPED clock the reaction loop already checks (AC 1/2) -------------

    [RequiresDockerFact]
    public async Task Post_Freeze_OnAColdClock_StartsAndFreezesIt_ReportingTheTruth()
    {
        // CR-001: the DEFAULT state of a fresh host — no reaction loop has ticked, so nothing has ever called
        // IExerciseClock.Start for this exercise. The freeze must still be REAL, and the response must say so.
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        host.Clock.IsFrozen(exerciseId).Should().BeFalse("no clock has been started for this exercise yet");
        host.Clock.IsRunning(exerciseId).Should().BeFalse();

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var state = await ReadStateAsync(response);
        state.Tier.Should().Be("freeze");
        state.ClockFrozen.Should().BeTrue(
            "the response must never claim a freeze the clock did not take — the console verifies this field");
        host.Clock.IsFrozen(exerciseId).Should().BeTrue(
            "ReactionLoopHost.TickExerciseAsync skips a tick on exactly this flag, so the engine is genuinely halted");
    }

    [RequiresDockerFact]
    public async Task Post_Freeze_OnAColdClock_ThenTheLoopsLazyStart_LeavesItFrozen()
    {
        // ReactionLoopHost.EnsureClockStarted starts a clock only when it is neither running NOR frozen, so a
        // freeze applied before the loop's first tick survives it (rather than the loop starting a RUNNING clock
        // under a console reading WORLD FROZEN).
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });

        var loopWouldStartTheClock =
            !host.Clock.IsRunning(exerciseId) && !host.Clock.IsFrozen(exerciseId);

        loopWouldStartTheClock.Should().BeFalse("the loop must leave the already-frozen clock exactly as it is");
        host.Clock.IsFrozen(exerciseId).Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task Post_Freeze_FreezesTheResolvedExercisesClock()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        host.Clock.Start(exerciseId, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var state = await ReadStateAsync(response);
        state.Tier.Should().Be("freeze");
        state.ClockFrozen.Should().BeTrue();
        host.Clock.IsFrozen(exerciseId).Should().BeTrue(
            "ReactionLoopHost skips a tick entirely while IsFrozen — this is what makes Freeze genuinely halt the engine");
    }

    [RequiresDockerFact]
    public async Task Post_Resume_UnfreezesWithoutLosingScenarioTime()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        host.Clock.Start(exerciseId, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);

        await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });
        var frozenAtMinute = host.Clock.CurrentScenarioMinute(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "running", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadStateAsync(response)).Tier.Should().Be("running");
        host.Clock.IsFrozen(exerciseId).Should().BeFalse();
        host.Clock.CurrentScenarioMinute(exerciseId).Should().Be(frozenAtMinute,
            "COR-050: the clock resumes from exactly the scenario minute it held — no scenario time is lost");
    }

    [RequiresDockerFact]
    public async Task Post_FreezeInExerciseA_NeverFreezesExerciseB()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseA);
        host.Clock.Start(exerciseA, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);
        host.Clock.Start(exerciseB, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);

        // The body deliberately carries a foreign exerciseId — it must be IGNORED for scoping (COR-001).
        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01", exerciseId = exerciseB });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        host.Clock.IsFrozen(exerciseA).Should().BeTrue("the SERVER-resolved scope is the only scope");
        host.Clock.IsFrozen(exerciseB).Should().BeFalse(
            "COR-001: a client-supplied exerciseId is never honoured — a Freeze on A can never touch B's clock");
        host.Registry.GetTier(exerciseB).Should().Be(PauseTier.Running);
    }

    [RequiresDockerFact]
    public async Task Post_NonFreezeTier_LeavesTheClockRunning()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        host.Clock.Start(exerciseId, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "engine", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadStateAsync(response)).Tier.Should().Be("engine");
        host.Clock.IsFrozen(exerciseId).Should().BeFalse(
            "Engine-paused never stops scenario time — only Freeze does");
    }

    [RequiresDockerFact]
    public async Task Get_AfterAPost_ResyncsTheRecordedTier()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        host.Clock.Start(exerciseId, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);

        await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });

        var response = await host.Client.GetAsync(new Uri("/api/steering/pause-tier", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var state = await ReadStateAsync(response);
        state.Tier.Should().Be("freeze", "the GET is the console's resync read");
        state.ClockFrozen.Should().BeTrue();
    }

    // ---- CR-001 over HTTP: a refused freeze is a 409, not a 500 (WR-103) -----------------------

    [RequiresDockerFact]
    public async Task Post_Freeze_WhenTheClockRefuses_Returns409_AndRecordsNothing()
    {
        // The whole frontend revert hangs off this STATUS: a 409 rejects the axios promise and the console falls
        // back to RUNNING, whereas a 500 would look like an infrastructure blip on an unknown state. Forced by
        // injecting a clock whose Freeze throws — the same RemoveAll + re-add the host already does for
        // IExerciseContext.
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, clockOverride: new RefusingExerciseClock());

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.Conflict,
            "a freeze that cannot reach the clock fails closed with 409 — never a 200 claiming a pause, never a 500");
        host.Registry.GetTier(exerciseId).Should().Be(
            PauseTier.Running, "a refused freeze records NO tier, so a later GET cannot resurrect it");
    }

    [RequiresDockerFact]
    public async Task Get_AfterARefusedFreeze_StillReportsRunning()
    {
        // The console's failure path re-GETs to ask what is actually true (rather than guessing) — that read must
        // not report the freeze it just refused.
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, clockOverride: new RefusingExerciseClock());
        await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });

        var response = await host.Client.GetAsync(new Uri("/api/steering/pause-tier", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var state = await ReadStateAsync(response);
        state.Tier.Should().Be("running");
        state.ClockFrozen.Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Post_NonFreezeTier_StillSucceeds_WhenTheClockWouldRefuseAFreeze()
    {
        // Only Freeze depends on the clock — Engine-paused must not be collateral damage.
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, clockOverride: new RefusingExerciseClock());

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "engine", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadStateAsync(response)).Tier.Should().Be("engine");
    }

    // ---- validation (400s, never a silent guess) -----------------------------------------------

    [RequiresDockerFact]
    public async Task Post_UnknownTier_Returns400()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "world-frozen", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        host.Registry.GetTier(exerciseId).Should().Be(PauseTier.Running);
    }

    [RequiresDockerFact]
    public async Task Post_MissingActingHuman_Returns400()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "COR-018: attribution is required");
        host.Registry.GetTier(exerciseId).Should().Be(PauseTier.Running);
    }

    // ---- the participant overlay register, over real HTTP (story 08, AC1/AC5) -------------------

    [RequiresDockerFact]
    public async Task Post_FreezeWithInFictionSelected_MakesTheParticipantGetReportInFiction()
    {
        // The FULL live path a controller drives: POST /api/steering/pause-tier carrying the console's selected
        // overlayRegister -> registry -> the REAL overlay publisher -> GET /api/overlay-state, the participant read.
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new
            {
                tier = "freeze",
                actingHumanId = "human-controller-01",
                timeZone = "America/Chicago",
                overlayRegister = "in-fiction",
            });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var overlay = await host.ReadOverlayStateAsync();
        overlay.State.Should().Be("pause", "the Freeze is now participant-visible (D5-014/1.3)");
        overlay.Register.Should().Be(
            "in-fiction",
            "the controller chose the fiction-preserving holding page (\"We'll be right back\") and that choice "
            + "must actually reach participants");
    }

    [RequiresDockerFact]
    public async Task Post_FreezeWithOutOfFictionSelected_MakesTheParticipantGetReportOutOfFiction()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01", overlayRegister = "out-of-fiction" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var overlay = await host.ReadOverlayStateAsync();
        overlay.State.Should().Be("pause");
        overlay.Register.Should().Be("out-of-fiction", "\"EXERCISE PAUSED\" — the fiction deliberately broken");
    }

    [RequiresDockerFact]
    public async Task Post_FreezeWithAnInvalidOrMissingRegister_CoercesToOutOfFiction_AndStillFreezes()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        var bogus = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01", overlayRegister = "sideways" });

        bogus.StatusCode.Should().Be(
            HttpStatusCode.OK, "the register is presentation only — it must never fail a safety action");
        var overlay = await host.ReadOverlayStateAsync();
        overlay.Register.Should().Be(
            "out-of-fiction", "client input is validated server-side and fails closed to the conservative register");
        host.Clock.IsFrozen(exerciseId).Should().BeTrue("and the Freeze itself still took");
    }

    [RequiresDockerFact]
    public async Task Post_Resume_ClearsTheParticipantOverlay()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01", overlayRegister = "in-fiction" });

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "running", actingHumanId = "human-controller-01", overlayRegister = "in-fiction" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var overlay = await host.ReadOverlayStateAsync();
        overlay.State.Should().Be("none", "AC3: Resume clears the participant holding page");
        overlay.Register.Should().Be("in-fiction");
    }

    [RequiresDockerFact]
    public async Task Post_FreezeInExerciseA_LeavesExerciseBsParticipantOverlayCleared()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseA);
        await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01", overlayRegister = "in-fiction" });

        host.OverlayState.Get(exerciseA).State.Should().Be("pause");
        host.OverlayState.Get(exerciseB).State.Should().Be(
            "none", "COR-001: exercise B's participants must never receive exercise A's Freeze");
    }

    // ---- the OVERLAY PRECEDENCE MATRIX, end to end (Tom's ruling, 2026-07-27) -------------------
    //
    // endex > pre-start > pause > none. The lifecycle answers "is this exercise live at all"; a Freeze is a
    // control WITHIN a live exercise. Each cell drives the REAL controller POST and reads the REAL participant
    // GET, so what is asserted is what a participant's shell would actually receive.

    /// <summary>
    /// <b>ENDEX + Freeze → the whole transition is REFUSED, loudly (Tom's ruling, WR-003).</b> Nothing is
    /// recorded: no tier, no clock effect, no overlay on either participant channel — and the console is told why,
    /// rather than getting a 200 for a Freeze that did nothing.
    /// </summary>
    [RequiresDockerFact]
    public async Task Post_FreezeAfterEndEx_IsRefusedWithAReason_AndRecordsNothing()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, exerciseStatus: "completed");
        var beforeAnyFreeze = await host.ReadOverlayStateAsync();

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01", overlayRegister = "in-fiction" });

        response.StatusCode.Should().Be(
            HttpStatusCode.Conflict,
            "COR-054: ENDEX is terminal, so a Freeze does not apply — and a 200 here would be the console "
            + "asserting a state the server never applied, the exact defect this feature exists to eliminate");

        var refusal = await ReadRefusalAsync(response);
        refusal.Outcome.Should().Be("not-applicable-in-lifecycle-state");
        refusal.Reason.Should().Contain(
            "completed", "the reason must NAME the lifecycle state so the controller can act on it (NFR-001: text)");

        // Nothing recorded, on any channel.
        host.Registry.GetTier(exerciseId).Should().Be(
            PauseTier.Running, "a refused Freeze records NO tier, so a later GET cannot resurrect it");
        host.Clock.IsFrozen(exerciseId).Should().BeFalse("and the scenario clock is never touched");
        host.OverlayState.Get(exerciseId).State.Should().Be(
            "none",
            "no overlay is written — which is also the proof no SignalR push went out, since the publisher writes "
            + "the store immediately before it broadcasts");
        (await host.ReadOverlayStateAsync()).Should().BeEquivalentTo(
            beforeAnyFreeze, "and the participant read is byte-identical to before the attempt");
    }

    /// <summary>
    /// <b>Pre-start + Freeze → REFUSED (WR-003).</b> Before StartEx the scenario clock does not run (COR-032), so
    /// refusing also avoids STARTING a clock that state says must not run — which suppressing only the overlay did.
    /// </summary>
    [RequiresDockerTheory]
    [InlineData("build")]
    [InlineData("staged")]
    public async Task Post_FreezeBeforeStartEx_IsRefusedWithAReason_AndNeverStartsTheClock(string preStartState)
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, exerciseStatus: preStartState);
        var beforeAnyFreeze = await host.ReadOverlayStateAsync();

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01", overlayRegister = "out-of-fiction" });

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var refusal = await ReadRefusalAsync(response);
        refusal.Outcome.Should().Be("not-applicable-in-lifecycle-state");
        refusal.Reason.Should().Contain(preStartState, "the reason names the state the controller must move past");
        refusal.Reason.Should().Contain(
            "StartEx", "and says what to do about it — 'take the exercise Live first'");

        host.Registry.GetTier(exerciseId).Should().Be(PauseTier.Running, "no tier recorded");
        host.Clock.IsRunning(exerciseId).Should().BeFalse(
            "COR-032: the scenario clock must not run before StartEx — refusing outright is what stops the "
            + "start-then-freeze path from creating one");
        host.Clock.IsFrozen(exerciseId).Should().BeFalse();
        host.OverlayState.Get(exerciseId).State.Should().Be("none", "and no overlay is written or pushed");
        (await host.ReadOverlayStateAsync()).Should().BeEquivalentTo(beforeAnyFreeze);
    }

    /// <summary>An <c>archived</c> world is terminal too — same refusal, nothing recorded.</summary>
    [RequiresDockerFact]
    public async Task Post_FreezeInAnArchivedWorld_IsRefused_AndRecordsNothing()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, exerciseStatus: "archived");

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await ReadRefusalAsync(response)).Reason.Should().Contain("archived");
        host.Registry.GetTier(exerciseId).Should().Be(PauseTier.Running);
        host.Clock.IsFrozen(exerciseId).Should().BeFalse();
        host.OverlayState.Get(exerciseId).State.Should().Be("none");
    }

    /// <summary>
    /// <b>Only FREEZE is gated.</b> Resume and the other tiers are unaffected in any lifecycle state — the ruling
    /// is about making a participant-visible world stop, not about locking the console.
    /// </summary>
    [RequiresDockerTheory]
    [InlineData("completed")]
    [InlineData("staged")]
    [InlineData("archived")]
    public async Task Post_ANonFreezeTierInANonRunningWorld_IsStillApplied_AndRECORDED(string lifecycleState)
    {
        // 'engine' specifically, because it is a REAL transition off the 'running' default — a 'running' POST
        // would be Unchanged and return 200 without ever approaching the gate, so it could not tell an applied
        // tier from an un-refused no-op.
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, exerciseStatus: lifecycleState);

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "engine", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(
            HttpStatusCode.OK,
            "the WR-003 refusal is scoped to the Freeze transition alone — refusing everything would lock a "
            + "controller out of the console over a lifecycle state that has nothing to do with these tiers");
        (await ReadStateAsync(response)).Tier.Should().Be("engine");
        host.Registry.GetTier(exerciseId).Should().Be(
            PauseTier.Engine,
            "and it was genuinely RECORDED, not merely un-refused — the difference a 200 alone cannot show");
    }

    /// <summary>Resume is never refused either, in any lifecycle state — the clear direction is always allowed.</summary>
    [RequiresDockerTheory]
    [InlineData("completed")]
    [InlineData("staged")]
    public async Task Post_ResumeInANonRunningWorld_IsStillApplied(string lifecycleState)
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, exerciseStatus: lifecycleState);
        await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "engine", actingHumanId = "human-controller-01" });

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "running", actingHumanId = "human-controller-01" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        host.Registry.GetTier(exerciseId).Should().Be(
            PauseTier.Running,
            "a controller must always be able to stand a pause DOWN, whatever state the exercise is in");
    }

    /// <summary>
    /// <b>Running + frozen → pause, in the controller's selected register.</b> The cell story 08 exists for
    /// (D5-014/1.3: Freeze is guarded specifically BECAUSE participants notice it).
    /// </summary>
    [RequiresDockerTheory]
    [InlineData("in-fiction")]
    [InlineData("out-of-fiction")]
    public async Task Post_FreezeInARunningWorld_ShowsTheParticipantThePausePage_InTheSelectedRegister(
        string selected)
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, exerciseStatus: "live");

        var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/steering/pause-tier", UriKind.Relative),
            new { tier = "freeze", actingHumanId = "human-controller-01", overlayRegister = selected });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var overlay = await host.ReadOverlayStateAsync();
        overlay.State.Should().Be("pause", "a live world's Freeze IS participant-visible (CTL-023)");
        overlay.Register.Should().Be(selected, "AC5: the controller's selection reaches the participant's shell");
    }

    /// <summary>
    /// <b>Running + NOT frozen → none.</b> A live exercise nobody froze is byte-identical to the shipped Phase-1
    /// constant — the contribution never invents an overlay.
    /// </summary>
    [RequiresDockerFact]
    public async Task Get_InARunningWorldWithNoFreeze_ServesNone()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, exerciseStatus: "live");

        var overlay = await host.ReadOverlayStateAsync();

        overlay.State.Should().Be("none");
        overlay.Register.Should().Be("in-fiction", "the shipped cleared shape");
    }

    /// <summary>
    /// The COR-032 lifecycle holding page still reaches participants through this composed read — the pause
    /// contribution DECORATES the lifecycle projection and can never suppress its answer.
    /// </summary>
    [RequiresDockerFact]
    public async Task Get_InALifecyclePausedWorld_StillServesTheCor032HoldingPage()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, exerciseStatus: "paused");

        var overlay = await host.ReadOverlayStateAsync();

        overlay.State.Should().Be(
            "pause",
            "world-steering contributes to this read, it does not own it — a COR-032 paused exercise must keep "
            + "rendering its holding page with no controller Freeze involved at all");
    }

    // ---- composition: story 08's swap of the no-op overlay publisher default --------------------

    [RequiresDockerFact]
    public async Task AddPauseParticipantOverlay_ReplacesTheStory07NoOpOverlayPublisher()
    {
        await using var host = await StartHostAsync(Guid.NewGuid());

        host.Services.GetRequiredService<IPauseOverlayPublisher>().Should()
            .BeOfType<PauseOverlayPublisher>(
                "story 07 ships the no-op default via TryAddSingleton and story 08 replaces it with RemoveAll + "
                + "AddSingleton — a surviving NullPauseOverlayPublisher would make every Freeze invisible");
        host.Services.GetRequiredService<PauseTierRegistry>().Should().BeSameAs(
            host.Services.GetRequiredService<PauseTierRegistry>(),
            "the registry is a singleton — one in-memory tier per exercise for the whole host");
    }

    // ---- host + helpers ------------------------------------------------------------------------

    private async Task<PauseTierTestHost> StartHostAsync(
        Guid? currentExerciseId,
        bool authenticatedStaff = true,
        Guid? assignedExerciseId = null,
        IExerciseClock? clockOverride = null,
        string exerciseStatus = "active")
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return await PauseTierTestHost.StartAsync(
            _fixture.ConnectionString!,
            currentExerciseId,
            authenticatedStaff,
            assignedExerciseId,
            clockOverride,
            exerciseStatus);
    }

    /// <summary>
    /// A non-conforming clock that ACCEPTS a started exercise but refuses to freeze — the cheapest way to reach
    /// <see cref="PauseTierOutcome.ClockUnavailable"/> over real HTTP (WR-103). Everything else behaves.
    /// </summary>
    private sealed class RefusingExerciseClock : IExerciseClock
    {
        public void Start(Guid exerciseId, DateTimeOffset scenarioStart, TimeZoneInfo timeZone)
        {
        }

        public void Freeze(Guid exerciseId) =>
            throw new InvalidOperationException("This clock cannot be frozen.");

        public void Unfreeze(Guid exerciseId)
        {
        }

        public void Jump(Guid exerciseId, int scenarioMinutes)
        {
        }

        public int CurrentScenarioMinute(Guid exerciseId) => 0;

        public DateTimeOffset? CurrentScenarioTime(Guid exerciseId) => null;

        public bool IsFrozen(Guid exerciseId) => false;

        public bool IsRunning(Guid exerciseId) => true;
    }

    /// <summary>Reads the staff-only <c>409</c> refusal body (WR-003) — the machine outcome plus the reason.</summary>
    private static async Task<PauseRefusalWire> ReadRefusalAsync(HttpResponseMessage response)
    {
        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        return new PauseRefusalWire(
            doc.RootElement.GetProperty("outcome").GetString(),
            doc.RootElement.GetProperty("reason").GetString() ?? string.Empty);
    }

    /// <summary>The refused-transition wire body: a machine-readable outcome plus controller-readable prose.</summary>
    private sealed record PauseRefusalWire(string? Outcome, string Reason);

    private static async Task<PauseTierWireState> ReadStateAsync(HttpResponseMessage response)
    {
        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        return new PauseTierWireState(
            doc.RootElement.GetProperty("tier").GetString(),
            doc.RootElement.GetProperty("clockFrozen").GetBoolean());
    }

    /// <summary>The staff-only wire projection, read back field-for-field (XC-002: tier + clock state only).</summary>
    private sealed record PauseTierWireState(string? Tier, bool ClockFrozen);

    /// <summary>The PARTICIPANT overlay wire projection (story 08) — state + register, no staff field.</summary>
    private sealed record OverlayWireState(string? State, string? Register);

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<Microsoft.AspNetCore.Routing.HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    /// <summary>
    /// A minimal host wired exactly as the orchestrator's future <c>Program.cs</c> edit will wire story 07
    /// (<c>AddPauseTierSteering</c> + <c>MapPauseTierSteering</c>) on top of its prerequisites — persistence +
    /// exercise scoping, the shipped exercise clock, and B2's staff identity (the reused gate) — against the
    /// shared Testcontainers database.
    /// </summary>
    private sealed class PauseTierTestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;

        private PauseTierTestHost(WebApplication app)
        {
            _app = app;
            Client = app.GetTestClient();
        }

        public HttpClient Client { get; }

        public IServiceProvider Services => _app.Services;

        /// <summary>The one shipped clock the pause tier drives (a singleton) — asserted on directly.</summary>
        public IExerciseClock Clock => _app.Services.GetRequiredService<IExerciseClock>();

        /// <summary>The one pause-tier registry (a singleton) — asserted on directly.</summary>
        public PauseTierRegistry Registry => _app.Services.GetRequiredService<PauseTierRegistry>();

        /// <summary>
        /// The one participant-overlay store (a singleton, story 08) — asserted on directly for the
        /// cross-exercise proof.
        /// </summary>
        public OverlayStateService OverlayState => _app.Services.GetRequiredService<OverlayStateService>();

        /// <summary>
        /// Reads <c>GET /api/overlay-state</c> — the PARTICIPANT-facing read (story 08), mapped on this host so a
        /// controller's POST can be followed all the way to what a participant would receive.
        /// </summary>
        /// <returns>The participant overlay wire state.</returns>
        public async Task<OverlayWireState> ReadOverlayStateAsync()
        {
            var response = await Client.GetAsync(new Uri("/api/overlay-state", UriKind.Relative));
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var json = await response.Content.ReadAsStringAsync();
            using var document = JsonDocument.Parse(json);
            return new OverlayWireState(
                document.RootElement.GetProperty("state").GetString(),
                document.RootElement.GetProperty("register").GetString());
        }

        public static async Task<PauseTierTestHost> StartAsync(
            string connectionString,
            Guid? currentExerciseId,
            bool authenticatedStaff = true,
            Guid? assignedExerciseId = null,
            IExerciseClock? clockOverride = null,
            string exerciseStatus = "active")
        {
            // The staff caller the REUSED cockpit authorization filter gates on. A default host is an
            // authenticated staff user ASSIGNED to the resolved exercise; the denial tests flip these knobs.
            var staffUserId = Guid.NewGuid();
            var accessor = authenticatedStaff
                ? new StubCurrentStaffSessionAccessor(new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staffUserId })
                : new StubCurrentStaffSessionAccessor(null);

            if (authenticatedStaff && (assignedExerciseId ?? currentExerciseId) is { } assignExercise)
            {
                await SeedStaffAssignmentAsync(connectionString, staffUserId, assignExercise, exerciseStatus);
            }

            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseTestServer();
            builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;

            builder.Services.AddPulsePersistence(builder.Configuration);
            builder.Services.AddExerciseScoping();
            builder.Services.AddExerciseClock();
            builder.Services.AddPauseTierSteering();

            // The participant read GET /api/overlay-state resolves ParticipantShellConfigService (01b) and, behind
            // it, the IOverlayStateProjection seam AddExerciseLifecycle() contributes to. Both are REQUIRED for the
            // POST -> participant-GET chain below to run at all, and their order matters: story 08's Replace must
            // come after AddExerciseLifecycle()'s, or the pause contribution is silently evicted (see
            // AddPauseParticipantOverlay's ordering note). This mirrors Program.cs.
            builder.Services.AddExerciseConfiguration();
            builder.Services.AddExerciseLifecycle();

            // Story 08: the REAL participant-overlay publisher replaces story 07's no-op default, the shared hub's
            // IHubContext it pushes through (AddSignalR — no second hub), and the read-side pause contribution to
            // the overlay seam. Wired exactly as Program.cs is, so a Freeze POST here follows the same path to the
            // participant read as it does in production.
            builder.Services.AddSignalR();
            builder.Services.AddPauseParticipantOverlay();

            // A test may substitute a non-conforming clock to force the fail-closed 409 path (WR-103).
            if (clockOverride is not null)
            {
                builder.Services.RemoveAll<IExerciseClock>();
                builder.Services.AddSingleton(clockOverride);
            }

            // B2's staff-identity dependency the reused filter resolves per request (the orchestrator wires
            // AddStaffIdentity before the steering feature in production).
            builder.Services.AddScoped<StaffAssignmentService>();
            builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
            builder.Services.AddScoped<ICurrentStaffSessionAccessor>(_ => accessor);

            // The server-authoritative request scope (fixed per host; null = the fail-closed case).
            builder.Services.RemoveAll<IExerciseContext>();
            builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = currentExerciseId });

            var app = builder.Build();
            app.MapPauseTierSteering();

            // The participant-shell config GETs (already wired in Program.cs) — story 08's one-handler edit makes
            // /api/overlay-state serve the live per-exercise overlay this host's POSTs write.
            app.MapParticipantShellEndpoints();
            await app.StartAsync();

            return new PauseTierTestHost(app);
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.DisposeAsync();
        }

        /// <summary>
        /// Seeds the <see cref="Exercise"/> + <see cref="StaffAssignment"/> rows the reused cockpit gate reads
        /// (via <see cref="StaffAssignmentService.GetAssignmentsAsync"/>). Both are unscoped entities, so the
        /// write-guard needs no resolved exercise scope here.
        /// </summary>
        /// <remarks>
        /// The exercise's <c>Status</c> is now load-bearing for the PARTICIPANT read: the contributed
        /// <c>SteeringPauseOverlayProjection</c> only lets a Freeze reach participants in a RUNNING world (Tom's
        /// ruling: <c>endex</c> &gt; <c>pre-start</c> &gt; <c>pause</c> &gt; <c>none</c>). The default stays the
        /// legacy <c>active</c> literal this host has always seeded — it folds onto canonical <c>live</c>, so every
        /// pre-existing test is unaffected — and the precedence tests pass the other states explicitly.
        /// </remarks>
        private static async Task SeedStaffAssignmentAsync(
            string connectionString, Guid staffUserId, Guid exerciseId, string exerciseStatus)
        {
            var options = new DbContextOptionsBuilder<PulseDbContext>()
                .UseSqlServer(connectionString)
                .Options;

            await using var context = new PulseDbContext(options);
            context.Exercises.Add(new Exercise
            {
                Id = exerciseId,
                Name = "Pause Tier Test Exercise",
                TimeZone = "UTC",
                Status = exerciseStatus,
            });
            context.StaffAssignments.Add(new StaffAssignment
            {
                Id = Guid.NewGuid(),
                StaffUserId = staffUserId,
                ExerciseId = exerciseId,
                Role = "controller",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await context.SaveChangesAsync();
        }
    }
}
