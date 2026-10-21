namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Pulse.Core.Features.Ambient.Models;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Helpers;
using Xunit;

/// <summary>
/// Orchestrator Tier-2 M-1: the lead flag the raise gate judges on is read BEFORE the write, so a planner's demotion can
/// commit in between and the raise would land with no lead. Every raise path therefore re-reads the SESSION person's lead
/// enrollment live AFTER its write and, when the lead was lost, reverts the raise and answers 403.
/// </summary>
/// <remarks>
/// Each race is deterministic: a hook fires between the gate / snapshot and the write (the first scenario-minute read for
/// the clock-stamped paths, the first cut read for ambient, the restore call for the provider cut) and COMMITS the
/// demotion (clears <c>IsLead</c>) through its own context. Each race has a no-demotion control proving the same request
/// is 200 with the raise applied. Real SQL, so every test is <see cref="RequiresDockerFactAttribute"/>.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class LeadControllerPostWriteRecheckTests
{
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 14, 9, 0, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;

    public LeadControllerPostWriteRecheckTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- swamped mode ON -----------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task SwampedOn_LeadDemotedAfterTheGate_AndItsOffRunsFirst_EndsOff_Returns403()
    {
        var harness = Build();
        await using var _ = harness;
        var state = harness.Autonomy.GetOrCreate(harness.ExerciseId);

        // The demotion commits, then (as EnrollmentService does) turns swamped OFF — all before this ON is written.
        harness.ArmClock(() =>
        {
            harness.DemoteLead();
            state.SetSwampedMode(false, "system:no-lead", 0);
        });

        var result = await harness.Service.SetSwampedModeAsync(true, Input(harness.Lead), harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Forbidden, "the lead was lost before the ON landed");
        state.SwampedModeEnabled.Should().BeFalse("swamped mode must never end ON with no lead");
    }

    [RequiresDockerFact]
    public async Task SwampedOn_NoDemotion_Returns200_AndIsOn()
    {
        var harness = Build();
        await using var _ = harness;
        harness.ArmClock(() => { });

        var result = await harness.Service.SetSwampedModeAsync(true, Input(harness.Lead), harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        harness.Autonomy.GetOrCreate(harness.ExerciseId).SwampedModeEnabled.Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task SwampedOn_ForAPersonWhoIsNotTheLead_FailsClosed_Returns403_AndStaysOff()
    {
        var harness = Build();
        await using var _ = harness;

        var result = await harness.Service.SetSwampedModeAsync(true, Input(harness.Lead), Guid.NewGuid());

        result.Outcome.Should().Be(EngineReviewOutcome.Forbidden, "the re-check is keyed on the SESSION person");
        harness.Autonomy.GetOrCreate(harness.ExerciseId).SwampedModeEnabled.Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task SwampedOff_NeedsNoLead_AndIsNeverReverted()
    {
        var harness = Build();
        await using var _ = harness;
        var state = harness.Autonomy.GetOrCreate(harness.ExerciseId);
        state.SetSwampedMode(true, "lead", 0);
        harness.DemoteLead();

        var result = await harness.Service.SetSwampedModeAsync(false, Input(harness.Lead), harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Ok, "OFF is a lower — open to any controller, no re-check");
        state.SwampedModeEnabled.Should().BeFalse();
    }

    // ---- #618: the M-1 reverts and the steering-lever record ---------------------------------------

    [RequiresDockerFact]
    public async Task SwampedOn_RevertedByM1_FromOff_RecordsNothing()
    {
        var harness = Build();
        await using var _ = harness;
        harness.ArmClock(harness.DemoteLead);

        var result = await harness.Service.SetSwampedModeAsync(true, Input(harness.Lead), harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Forbidden);
        harness.Autonomy.GetOrCreate(harness.ExerciseId).SwampedModeEnabled.Should().BeFalse();
        harness.Records.Should().BeEmpty("the revert restored OFF exactly — nothing net changed, so nothing is recorded");
    }

    [RequiresDockerFact]
    public async Task SwampedOn_RevertedByM1_WhenItWasAlreadyOn_RecordsALeadLostRevertOff_AsASystemAction()
    {
        var harness = Build();
        await using var _ = harness;
        var state = harness.Autonomy.GetOrCreate(harness.ExerciseId);
        state.SetSwampedMode(true, "lead", 0);
        harness.ArmClock(harness.DemoteLead);

        var result = await harness.Service.SetSwampedModeAsync(true, Input(harness.Lead), harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Forbidden);
        state.SwampedModeEnabled.Should().BeFalse("swamped mode must never end ON with no lead");
        harness.SwampedAtRecordTime.Should().Equal([false], "the revert record is written AFTER the revert");
        var record = harness.Records.Should().ContainSingle("ON -> OFF is a real change, even on a refused request").Subject;
        record.EventType.Should().Be(EngineSteeringLeverRecords.SwampedModeOffEventType);
        record.AuditKind.Should().Be(EngineSteeringLeverRecords.SwampedModeOffAuditKind);
        record.Actor.Should().BeNull("the revert is the lost lead's consequence, a system action — not the caller's choice");
        using var payload = System.Text.Json.JsonDocument.Parse(record.Payload);
        payload.RootElement.GetProperty("reason").GetString().Should().Be("lead-lost-revert");
        payload.RootElement.GetProperty("wasOn").GetBoolean().Should().BeTrue();
        payload.RootElement.GetProperty("isOn").GetBoolean().Should().BeFalse();
        payload.RootElement.GetProperty("scenarioMinute").GetInt32().Should().Be(0, "the harness clock is started at minute 0");
    }

    [RequiresDockerFact]
    public async Task SwampedOn_RevertedByM1_WhenAConcurrentTurnOffAlreadyRan_NeitherRevertsNorRecordsAgain()
    {
        // #618 W-C: swamped was on; the lead is lost, and a concurrent TurnOff (the lead release / no-lead heal, which
        // records its own OFF) lands between this ON's write and its re-check. The re-check must find it already off.
        var hook = new FirstReaderHook();
        var harness = Build(hook);
        await using var _ = harness;
        var state = harness.Autonomy.GetOrCreate(harness.ExerciseId);
        state.SetSwampedMode(true, "lead", 0);
        harness.ArmClock(harness.DemoteLead);
        hook.OnFirstReader = () => state.SetSwampedMode(false, "system:no-lead", 0);

        var result = await harness.Service.SetSwampedModeAsync(true, Input(harness.Lead), harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Forbidden);
        hook.Fired.Should().BeTrue("the concurrent OFF ran between the write and the re-check");
        state.SwampedModeEnabled.Should().BeFalse();
        harness.Records.Should().BeEmpty("the concurrent OFF is the recorded change; a lead-lost-revert too would double it");
    }

    [RequiresDockerFact]
    public async Task KillSwitch_WhenTheRequestIsAbortedDuringTheAmbientDemotionCommit_StillRecordsTheAppliedLever()
    {
        // #618 W-A: the demotion is applied in memory, then its event commit rethrows the client abort — the kill switch
        // (already applied) must still be recorded.
        var harness = Build();
        await using var _ = harness;
        harness.Ambient.Set(harness.ExerciseId, new AmbientTierPolicy
        {
            Mode = AmbientPolicyMode.Autonomous,
            MaxPerMinute = 1,
            MaxPerHour = 1,
            TopicAllowList = [],
            PersonaAllowList = [],
            SetBy = "arrange",
        });
        using var aborted = new CancellationTokenSource();
        await aborted.CancelAsync();

        var act = () => harness.Service.EngageKillSwitchAsync(KillSwitchMode.FullStop, Input(harness.Lead), aborted.Token);

        await act.Should().ThrowAsync<OperationCanceledException>("the abort still surfaces");
        harness.Autonomy.GetOrCreate(harness.ExerciseId).IsGenerationStopped.Should().BeTrue("the lever applied");
        harness.Ambient.Get(harness.ExerciseId).Mode.Should().Be(AmbientPolicyMode.Off, "the demotion applied in memory");
        harness.Records.Should().ContainSingle("the applied kill switch is recorded despite the abort")
            .Which.EventType.Should().Be(EngineSteeringLeverRecords.KillSwitchEngagedEventType);
    }

    [RequiresDockerFact]
    public async Task SwampedOn_NoDemotion_RecordsOneTurnedOn()
    {
        var harness = Build();
        await using var _ = harness;
        harness.ArmClock(() => { });

        var result = await harness.Service.SetSwampedModeAsync(true, Input(harness.Lead), harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        harness.Records.Should().ContainSingle().Which.EventType.Should().Be(EngineSteeringLeverRecords.SwampedModeOnEventType);
    }

    [RequiresDockerFact]
    public async Task Restore_RevertedByM1_RecordsNothing()
    {
        var harness = Build();
        await using var _ = harness;
        harness.Autonomy.GetOrCreate(harness.ExerciseId).EngageKillSwitch(KillSwitchMode.FullStop, "lead", 0);
        harness.ArmClock(harness.DemoteLead);

        var result = await harness.Service.RestoreFromSafetyAsync(Input(harness.Lead), harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Forbidden);
        harness.Records.Should().BeEmpty("the clamp was put back exactly — nothing net changed");
    }

    [RequiresDockerFact]
    public async Task Restore_NoDemotion_RecordsOneRestored()
    {
        var harness = Build();
        await using var _ = harness;
        harness.Autonomy.GetOrCreate(harness.ExerciseId).EngageKillSwitch(KillSwitchMode.FullStop, "lead", 0);
        harness.ArmClock(() => { });

        var result = await harness.Service.RestoreFromSafetyAsync(Input(harness.Lead), harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        harness.Records.Should().ContainSingle().Which.EventType.Should().Be(EngineSteeringLeverRecords.AutonomyRestoredEventType);
    }

    // ---- autonomy/restore ----------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Restore_LeadDemotedAfterTheGate_ReimposesTheFullStop_Returns403()
    {
        var harness = Build();
        await using var _ = harness;
        var state = harness.Autonomy.GetOrCreate(harness.ExerciseId);
        state.EngageKillSwitch(KillSwitchMode.FullStop, "lead", 0);
        harness.ArmClock(harness.DemoteLead);

        var result = await harness.Service.RestoreFromSafetyAsync(Input(harness.Lead), harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Forbidden);
        state.SafetyClampActive.Should().BeTrue("the lifted clamp is put back");
        state.IsGenerationStopped.Should().BeTrue("in the mode it was in — the full stop");
        state.DegradedReason.Should().BeNull("no degraded alert was invented");
    }

    [RequiresDockerFact]
    public async Task Restore_LeadDemotedAfterTheGate_ReimposesTheDegradedClampWithItsReason_Returns403()
    {
        var harness = Build();
        await using var _ = harness;
        var state = harness.Autonomy.GetOrCreate(harness.ExerciseId);
        state.SetExerciseDefault(AutonomyLevel.DelayedAuto, "lead", 0);
        state.DegradeToSuggest("provider down", 0);
        harness.ArmClock(harness.DemoteLead);

        var result = await harness.Service.RestoreFromSafetyAsync(Input(harness.Lead), harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Forbidden);
        state.SafetyClampActive.Should().BeTrue();
        state.IsGenerationStopped.Should().BeFalse("it was a clamp, not a full stop");
        state.DegradedReason.Should().Be("provider down", "the degraded alert comes back with the clamp");
        state.ResolveEffective(Guid.NewGuid()).Level.Should().Be(AutonomyLevel.Suggest);
    }

    [RequiresDockerFact]
    public async Task Restore_NoDemotion_Returns200_AndTheClampIsLifted()
    {
        var harness = Build();
        await using var _ = harness;
        var state = harness.Autonomy.GetOrCreate(harness.ExerciseId);
        state.EngageKillSwitch(KillSwitchMode.FullStop, "lead", 0);
        harness.ArmClock(() => { });

        var result = await harness.Service.RestoreFromSafetyAsync(Input(harness.Lead), harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        state.SafetyClampActive.Should().BeFalse();
        state.IsGenerationStopped.Should().BeFalse();
    }

    // ---- settings/autonomy-default -------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task AutonomyDefaultRaise_LeadDemotedBetweenTheSnapshotAndTheWrite_IsSwappedBack_Returns403_NoEvent()
    {
        var harness = Build();
        await using var _ = harness;
        harness.ArmClock(harness.DemoteLead);

        var result = await harness.Service.SetExerciseAutonomyDefaultAsync(
            "delayed-auto", Input(harness.Lead), callerIsLead: true, harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Forbidden);
        harness.Autonomy.GetOrCreate(harness.ExerciseId).ExerciseDefault.Should().Be(AutonomyLevel.Suggest);
        (await harness.CountEventsAsync(EngineEventTypes.AutonomyDefaultChanged)).Should().Be(0, "nothing net changed");
    }

    [RequiresDockerFact]
    public async Task AutonomyDefaultRaise_NoDemotion_Returns200_AndIsApplied_WithOneEvent()
    {
        var harness = Build();
        await using var _ = harness;
        harness.ArmClock(() => { });

        var result = await harness.Service.SetExerciseAutonomyDefaultAsync(
            "delayed-auto", Input(harness.Lead), callerIsLead: true, harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        harness.Autonomy.GetOrCreate(harness.ExerciseId).ExerciseDefault.Should().Be(AutonomyLevel.DelayedAuto);
        (await harness.CountEventsAsync(EngineEventTypes.AutonomyDefaultChanged)).Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task AutonomyDefaultLower_AfterADemotion_StillSucceeds()
    {
        var harness = Build();
        await using var _ = harness;
        harness.Autonomy.GetOrCreate(harness.ExerciseId).SetExerciseDefault(AutonomyLevel.DelayedAuto, "lead", 0);
        harness.ArmClock(harness.DemoteLead);

        var result = await harness.Service.SetExerciseAutonomyDefaultAsync(
            "suggest", Input(harness.Lead), callerIsLead: true, harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Ok, "a lower needs no lead, so it is never re-checked");
        harness.Autonomy.GetOrCreate(harness.ExerciseId).ExerciseDefault.Should().Be(AutonomyLevel.Suggest);
    }

    // ---- settings/tier-policy ------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task TierPolicyRaise_LeadDemotedBetweenTheSnapshotAndTheWrite_IsSwappedBack_Returns403_NoEvent()
    {
        var harness = Build();
        await using var _ = harness;
        harness.TierPolicy.TrySetMode(harness.ExerciseId, TierPolicyMode.Auto, TierPolicyMode.Ambient).Should().BeTrue();
        harness.ArmClock(harness.DemoteLead);

        var result = await harness.Service.SetTierPolicyModeAsync(
            "auto", Input(harness.Lead), callerIsLead: true, harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Forbidden);
        harness.TierPolicy.GetMode(harness.ExerciseId).Should().Be(TierPolicyMode.Ambient);
        (await harness.CountEventsAsync(EngineEventTypes.TierPolicyChanged)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task TierPolicyRaise_NoDemotion_Returns200_AndIsApplied_WithOneEvent()
    {
        var harness = Build();
        await using var _ = harness;
        harness.TierPolicy.TrySetMode(harness.ExerciseId, TierPolicyMode.Auto, TierPolicyMode.Ambient).Should().BeTrue();
        harness.ArmClock(() => { });

        var result = await harness.Service.SetTierPolicyModeAsync(
            "auto", Input(harness.Lead), callerIsLead: true, harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        harness.TierPolicy.GetMode(harness.ExerciseId).Should().Be(TierPolicyMode.Auto);
        (await harness.CountEventsAsync(EngineEventTypes.TierPolicyChanged)).Should().Be(1);
    }

    // ---- settings/ambient-policy ---------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task AmbientRaise_LeadDemotedBetweenTheSnapshotAndTheWrite_IsSwappedBack_Returns403_NoEvent()
    {
        var harness = Build();
        await using var _ = harness;
        harness.Cut.OnFirstIsCutRead = harness.DemoteLead;

        var result = await harness.Service.SetAmbientPolicyAsync(AutonomousRequest(), harness.Lead, callerIsLead: true);

        result.Outcome.Should().Be(EngineReviewOutcome.Forbidden);
        harness.Ambient.Get(harness.ExerciseId).Mode.Should().Be(AmbientPolicyMode.Off);
        (await harness.CountEventsAsync(EngineEventTypes.TierPolicyChanged)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task AmbientRaise_NoDemotion_Returns200_AndIsAutonomous_WithOneEvent()
    {
        var harness = Build();
        await using var _ = harness;
        harness.Cut.OnFirstIsCutRead = () => { };

        var result = await harness.Service.SetAmbientPolicyAsync(AutonomousRequest(), harness.Lead, callerIsLead: true);

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        harness.Ambient.Get(harness.ExerciseId).Mode.Should().Be(AmbientPolicyMode.Autonomous);
        (await harness.CountEventsAsync(EngineEventTypes.TierPolicyChanged)).Should().Be(1);
    }

    // ---- generation-provider/restore -----------------------------------------------------------------

    [RequiresDockerFact]
    public async Task ProviderRestore_LeadDemotedAfterTheGate_ReCuts_Returns403_NoEvent()
    {
        var harness = Build();
        await using var _ = harness;
        harness.Cut.Cut(harness.ExerciseId);
        harness.Cut.OnRestore = harness.DemoteLead;

        var result = await harness.Service.RestoreGenerationProviderAsync(Input(harness.Lead), harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Forbidden);
        harness.Cut.IsCutToFake(harness.ExerciseId).Should().BeTrue("the cut is put back");
        (await harness.CountEventsAsync(EngineEventTypes.ProviderChanged)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task ProviderRestore_NoDemotion_Returns200_AndTheCutIsLifted()
    {
        var harness = Build();
        await using var _ = harness;
        harness.Cut.Cut(harness.ExerciseId);
        harness.Cut.OnRestore = () => { };

        var result = await harness.Service.RestoreGenerationProviderAsync(Input(harness.Lead), harness.Lead);

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        harness.Cut.IsCutToFake(harness.ExerciseId).Should().BeFalse();
        (await harness.CountEventsAsync(EngineEventTypes.ProviderChanged)).Should().Be(1);
    }

    // ---- helpers ---------------------------------------------------------------------------------------

    private static EngineReviewActionInput Input(Guid sessionPerson) => new(sessionPerson.ToString(), "UTC");

    private static EngineAmbientPolicyRequest AutonomousRequest() => new()
    {
        ActingHumanId = "lead",
        Mode = "autonomous",
        MaxPerMinute = 4,
        MaxPerHour = 40,
        TopicAllowList = ["food", "sports"],
        TimeZone = "UTC",
    };

    private Harness Build(Microsoft.EntityFrameworkCore.Diagnostics.IInterceptor? interceptor = null)
    {
        var exerciseId = Guid.NewGuid();
        Guid lead;
        using (var seed = _fixture.CreateContext())
        {
            lead = LeadControllerSeed.Seed(seed, exerciseId);
        }

        var context = new ExerciseContext { CurrentExerciseId = exerciseId };
        var db = interceptor is null
            ? _fixture.CreateContext(context)
            : new PulseDbContext(
                new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(_fixture.ConnectionString!).AddInterceptors(interceptor).Options,
                context);
        var native = new ExerciseClockService(new ManualTimeProvider(ScenarioStart));
        native.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        var clock = new HookableClock(native);
        var tiers = new EngineTierPolicyRegistry();
        var cut = new HookableCutRegistry(new GenerationProviderCutRegistry());
        var ambient = new EngineAmbientPolicyRegistry(
            Options.Create(new EngineAmbientGovernanceOptions { AmbientAutonomyAuthorized = true }),
            null);

        var autonomy = new EngineAutonomyRegistry();
        var recorder = new CapturingSteeringLeverRecorder(() => autonomy.GetOrCreate(exerciseId).SwampedModeEnabled);
        var service = new EngineReviewService(
            new EngineReviewStore(db, new EngineReviewTickSignal()),
            db,
            context,
            clock,
            new EngineTelemetryEmitter(),
            Mock.Of<IEnginePublishService>(),
            Mock.Of<IEngineReviewBroadcaster>(),
            autonomy,
            tiers,
            new FakeGenerationProvider(),
            Options.Create(new GenerationOptions()),
            cut,
            NullLogger<EngineReviewService>.Instance,
            ambient,
            governance: Options.Create(new EngineAmbientGovernanceOptions { TimeoutAutoSendAuthorized = true }),
            steeringLeverRecorder: recorder);

        return new Harness(_fixture, exerciseId, lead, service, db, clock, autonomy, tiers, cut, ambient, recorder);
    }

    private sealed class Harness(
        MsSqlContainerFixture fixture,
        Guid exerciseId,
        Guid lead,
        EngineReviewService service,
        PulseDbContext db,
        HookableClock clock,
        EngineAutonomyRegistry autonomy,
        EngineTierPolicyRegistry tierPolicy,
        HookableCutRegistry cut,
        EngineAmbientPolicyRegistry ambient,
        CapturingSteeringLeverRecorder recorder) : IAsyncDisposable
    {
        /// <summary>The steering-lever records the service handed to its recorder (#618).</summary>
        public System.Collections.Generic.IReadOnlyList<EngineSteeringLeverRecord> Records => recorder.Records;

        /// <summary>Swamped mode as each record was handed over — pins that the service records after its state change.</summary>
        public System.Collections.Generic.IReadOnlyList<bool> SwampedAtRecordTime => recorder.SwampedAtRecordTime;

        public Guid ExerciseId => exerciseId;

        /// <summary>The seeded lead controller — the session person every raise is made as.</summary>
        public Guid Lead => lead;

        public EngineReviewService Service => service;

        public EngineAutonomyRegistry Autonomy => autonomy;

        public EngineTierPolicyRegistry TierPolicy => tierPolicy;

        public HookableCutRegistry Cut => cut;

        public EngineAmbientPolicyRegistry Ambient => ambient;

        /// <summary>Runs <paramref name="hook"/> once, on the service's first scenario-minute read (just before its write).</summary>
        public void ArmClock(Action hook) => clock.OnFirstRead = hook;

        /// <summary>The concurrent planner demotion: clears the lead's <c>IsLead</c> and COMMITS it, in its own context.</summary>
        public void DemoteLead()
        {
            using var demote = fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
            LeadControllerSeed.Demote(demote, exerciseId, lead);
        }

        public async Task<int> CountEventsAsync(string eventType)
        {
            await using var verify = fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
            return await verify.TelemetryEvents.CountAsync(e => e.ExerciseId == exerciseId && e.EventType == eventType);
        }

        public async ValueTask DisposeAsync() => await db.DisposeAsync();
    }

    /// <summary>Runs <see cref="OnFirstReader"/> once, as the service's context issues its first query after arming.</summary>
    private sealed class FirstReaderHook : Microsoft.EntityFrameworkCore.Diagnostics.DbCommandInterceptor
    {
        public Action? OnFirstReader { get; set; }

        public bool Fired { get; private set; }

        public override ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<System.Data.Common.DbDataReader>> ReaderExecutingAsync(
            System.Data.Common.DbCommand command,
            Microsoft.EntityFrameworkCore.Diagnostics.CommandEventData eventData,
            Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<System.Data.Common.DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            if (!Fired && OnFirstReader is { } hook)
            {
                Fired = true;
                hook();
            }

            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

    /// <summary>Captures every steering-lever record instead of writing it (#618).</summary>
    private sealed class CapturingSteeringLeverRecorder(Func<bool> swampedNow) : IEngineSteeringLeverRecorder
    {
        private readonly System.Collections.Generic.List<EngineSteeringLeverRecord> _records = [];
        private readonly System.Collections.Generic.List<bool> _swampedAtRecordTime = [];

        public System.Collections.Generic.IReadOnlyList<EngineSteeringLeverRecord> Records => _records;

        public System.Collections.Generic.IReadOnlyList<bool> SwampedAtRecordTime => _swampedAtRecordTime;

        public Task RecordAsync(EngineSteeringLeverRecord record)
        {
            _records.Add(record);
            _swampedAtRecordTime.Add(swampedNow());
            return Task.CompletedTask;
        }
    }

    /// <summary>Delegates to the native clock, running <see cref="OnFirstRead"/> once on the first scenario-minute read.</summary>
    private sealed class HookableClock(IExerciseClock inner) : IExerciseClock
    {
        private int _reads;

        public Action? OnFirstRead { get; set; }

        public void Start(Guid exerciseId, DateTimeOffset scenarioStart, TimeZoneInfo timeZone) =>
            inner.Start(exerciseId, scenarioStart, timeZone);

        public void Freeze(Guid exerciseId) => inner.Freeze(exerciseId);

        public void Unfreeze(Guid exerciseId) => inner.Unfreeze(exerciseId);

        public void Jump(Guid exerciseId, int scenarioMinutes) => inner.Jump(exerciseId, scenarioMinutes);

        public int CurrentScenarioMinute(Guid exerciseId)
        {
            if (OnFirstRead is { } hook && Interlocked.Increment(ref _reads) == 1)
            {
                hook();
            }

            return inner.CurrentScenarioMinute(exerciseId);
        }

        public DateTimeOffset? CurrentScenarioTime(Guid exerciseId) => inner.CurrentScenarioTime(exerciseId);

        public bool IsFrozen(Guid exerciseId) => inner.IsFrozen(exerciseId);

        public bool IsRunning(Guid exerciseId) => inner.IsRunning(exerciseId);
    }

    /// <summary>
    /// The real cut registry, with hooks: <see cref="OnFirstIsCutRead"/> runs once on the first <see cref="IsCutToFake"/>
    /// (ambient's in-loop safety check — after the snapshot and the raise check, before <c>TrySet</c>), and
    /// <see cref="OnRestore"/> runs before a restore is applied (after the lead gate, before the post-write re-check).
    /// </summary>
    private sealed class HookableCutRegistry(IGenerationProviderCutRegistry inner) : IGenerationProviderCutRegistry
    {
        private int _reads;

        public Action? OnFirstIsCutRead { get; set; }

        public Action? OnRestore { get; set; }

        public bool IsCutToFake(Guid exerciseId)
        {
            if (OnFirstIsCutRead is { } hook && Interlocked.Increment(ref _reads) == 1)
            {
                hook();
            }

            return inner.IsCutToFake(exerciseId);
        }

        public bool Cut(Guid exerciseId) => inner.Cut(exerciseId);

        public bool Restore(Guid exerciseId)
        {
            OnRestore?.Invoke();
            return inner.Restore(exerciseId);
        }
    }
}
