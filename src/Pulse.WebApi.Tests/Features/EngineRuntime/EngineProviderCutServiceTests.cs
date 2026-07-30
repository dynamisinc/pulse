namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// autonomy-safety story 07 — the service half of the runtime "cut generation to Fake" egress lever, against a
/// REAL SQL Server (Testcontainers / local SQL), because the XC-004 audit row is the assertion for AC7.
/// Covers AC1 (cut → the exercise's next burst is Fake, nothing else moves), AC2 (restore → the
/// startup-configured provider and no other), AC3 (the already-Fake / double-call no-ops: no state change, NO
/// spurious telemetry), AC5 (configured vs effective as two independently readable facts), AC6 (isolation +
/// fail-closed scope) and AC7 (exactly one server-side event per real transition, both directions).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class EngineProviderCutServiceTests
{
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 14, 9, 0, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;

    public EngineProviderCutServiceTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- AC1: cutting takes effect on the next burst, for this exercise only ---------------------

    [RequiresDockerFact]
    public async Task Cut_WithALiveConfiguredProvider_RoutesTheExercisesNextBurstThroughFake()
    {
        // The selector is the object the reaction loop resolves, sharing the SAME cut registry the service
        // writes — so "the next burst" is answered by actually generating one, not by trusting a flag.
        var exerciseId = Guid.NewGuid();
        var cuts = new GenerationProviderCutRegistry();
        var live = new RecordingLiveProvider();
        var selector = new GenerationProviderSelector(live, new FakeGenerationProvider(), cuts);
        await using var harness = Build(exerciseId, generationProvider: live, providerCut: cuts);

        var before = await selector.GenerateAsync(Request(exerciseId));
        before.ProviderName.Should().Be("AzureOpenAI", "before the cut the burst egresses as configured");

        var result = await harness.Service.CutGenerationToFakeAsync(Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        var after = await selector.GenerateAsync(Request(exerciseId));
        after.ProviderName.Should().Be(
            FakeGenerationProvider.ProviderName,
            "the very next burst is generated offline — immediately, with no restart and no config change (AC1)");
        live.Calls.Should().Be(1, "the egressing provider was not reached again after the cut");
        result.Settings!.EffectiveProvider.Should().Be(FakeGenerationProvider.ProviderName);
        result.Settings!.ProviderCutToFake.Should().BeTrue();
        result.Settings!.AlreadyFake.Should().BeFalse("the configured provider is live, so this cut really did something");
    }

    [RequiresDockerFact]
    public async Task Cut_LeavesTheConfiguredProviderFieldUnchanged_SoExistingConsumersDoNotStartLying()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId, generationProvider: new RecordingLiveProvider());

        var result = await harness.Service.CutGenerationToFakeAsync(Input("controller-7"));

        result.Settings!.Provider.Should().Be(
            "AzureOpenAI",
            "'provider' keeps meaning the STARTUP-CONFIGURED provider — the deliberate, additive contract choice; "
            + "the effective provider is its own field");
        result.Settings!.EffectiveProvider.Should().Be(
            FakeGenerationProvider.ProviderName, "and the effective fact is readable DIRECTLY, never re-derived (WR-003)");
        result.Settings!.EffectiveProvider.Should().NotBe(result.Settings!.Provider);
    }

    // ---- AC2: restore returns to the startup-configured provider and no other --------------------

    [RequiresDockerFact]
    public async Task Restore_ReturnsTheExerciseToTheStartupConfiguredProvider_AndNeverAnother()
    {
        var exerciseId = Guid.NewGuid();
        var cuts = new GenerationProviderCutRegistry();
        var live = new RecordingLiveProvider();
        var selector = new GenerationProviderSelector(live, new FakeGenerationProvider(), cuts);
        await using var harness = Build(exerciseId, generationProvider: live, providerCut: cuts);

        await harness.Service.CutGenerationToFakeAsync(Input("controller-7"));
        var result = await harness.Service.RestoreGenerationProviderAsync(Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        result.Settings!.ProviderCutToFake.Should().BeFalse();
        result.Settings!.EffectiveProvider.Should().Be(
            "AzureOpenAI", "restore lands on exactly the provider startup already authorized — a §8.2 capped raise");
        var burst = await selector.GenerateAsync(Request(exerciseId));
        burst.ProviderName.Should().Be("AzureOpenAI", "the next burst is generated by the configured provider again");
    }

    // ---- AC3: idempotent no-ops, and NO spurious telemetry ---------------------------------------

    [RequiresDockerFact]
    public async Task Cut_WhenTheConfiguredProviderIsAlreadyFake_IsAnHonestNoOp_WithNoTelemetry()
    {
        // The committed default, every CI run, and UAT today. Cutting must not claim a lockdown that never
        // happened, and must not leave an audit row saying the provider changed when it did not.
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId); // FakeGenerationProvider

        var result = await harness.Service.CutGenerationToFakeAsync(Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok, "an idempotent no-op is not an error (AC3)");
        result.Settings!.AlreadyFake.Should().BeTrue(
            "the response says 'it was already Fake' rather than a false 'I just locked something down' signal");
        result.Settings!.ProviderCutToFake.Should().BeFalse("nothing was recorded — there was no egress to stop");
        result.Settings!.EffectiveProvider.Should().Be(FakeGenerationProvider.ProviderName);
        harness.ProviderCut.IsCutToFake(exerciseId).Should().BeFalse();
        (await CountTelemetryAsync(exerciseId)).Should().Be(
            0, "no provider change happened, so there is NO XC-004 event — an audit trail must not record a non-event");
    }

    [RequiresDockerFact]
    public async Task Restore_WithNoCutActive_IsAnIdempotentNoOp_WithNoTelemetry()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId, generationProvider: new RecordingLiveProvider());

        var result = await harness.Service.RestoreGenerationProviderAsync(Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        result.Settings!.ProviderCutToFake.Should().BeFalse();
        (await CountTelemetryAsync(exerciseId)).Should().Be(0, "restoring an uncut exercise changed nothing");
    }

    [RequiresDockerFact]
    public async Task CuttingTwice_AndRestoringTwice_EmitsExactlyOneEventPerRealTransition()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId, generationProvider: new RecordingLiveProvider());

        await harness.Service.CutGenerationToFakeAsync(Input("controller-7"));
        var secondCut = await harness.Service.CutGenerationToFakeAsync(Input("controller-7"));
        await harness.Service.RestoreGenerationProviderAsync(Input("controller-7"));
        var secondRestore = await harness.Service.RestoreGenerationProviderAsync(Input("controller-7"));

        secondCut.Outcome.Should().Be(EngineReviewOutcome.Ok, "a repeated cut is idempotent, not a 409");
        secondCut.Settings!.ProviderCutToFake.Should().BeTrue();
        secondRestore.Outcome.Should().Be(EngineReviewOutcome.Ok);

        (await CountTelemetryAsync(exerciseId)).Should().Be(
            2, "two real transitions → exactly two events; the two repeats changed nothing and emitted nothing");
    }

    // ---- AC7: one server-side event per transition, carrying actor + times + from/to -------------

    [RequiresDockerFact]
    public async Task Cut_EmitsExactlyOneProviderChangedEvent_WithActorScenarioTimeAndFromTo()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId, generationProvider: new RecordingLiveProvider());

        await harness.Service.CutGenerationToFakeAsync(Input("controller-7"));

        var events = await ReadEventsAsync(exerciseId, EngineEventTypes.ProviderChanged);
        var telemetryEvent = events.Should().ContainSingle(
            "the SERVER emits the audit record for the egress lever — this story deliberately does not repeat the "
            + "kill switch's gap of relying on frontend emission alone").Subject;

        telemetryEvent.SchemaVersion.Should().Be("v0", "the additive event type rides the UNCHANGED v0 envelope");
        telemetryEvent.ExerciseId.Should().Be(exerciseId);
        telemetryEvent.Actor.ActingHumanId.Should().Be(
            "controller-7", "COR-018: the human behind the shared controller account is on the envelope");
        telemetryEvent.WallClockTime.Should().BeAfter(
            DateTimeOffset.UtcNow.AddMinutes(-5), "wall clock is the SERVER clock, never client input");
        telemetryEvent.ScenarioTime.Should().Be(ScenarioStart, "and the scenario instant is the persisted one (COR-053)");

        using var payload = JsonDocument.Parse(telemetryEvent.Payload!);
        payload.RootElement.GetProperty("fromProvider").GetString().Should().Be("AzureOpenAI");
        payload.RootElement.GetProperty("toProvider").GetString().Should().Be(FakeGenerationProvider.ProviderName);
        payload.RootElement.GetProperty("reason").GetString().Should().Be(
            EngineEventPayloads.ProviderChanged.ReasonCut, "one event type, with the direction as a discriminator");
        payload.RootElement.GetProperty("scenarioMinute").GetInt32().Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Restore_EmitsItsOwnProviderChangedEvent_WithTheReversedFromToAndTheRestoreReason()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId, generationProvider: new RecordingLiveProvider());

        await harness.Service.CutGenerationToFakeAsync(Input("controller-7"));
        await harness.Service.RestoreGenerationProviderAsync(Input("controller-9"));

        var events = await ReadEventsAsync(exerciseId, EngineEventTypes.ProviderChanged);
        events.Should().HaveCount(2, "both directions are audited server-side");

        var restore = events.Single(e => e.Actor.ActingHumanId == "controller-9");
        using var payload = JsonDocument.Parse(restore.Payload!);
        payload.RootElement.GetProperty("fromProvider").GetString().Should().Be(FakeGenerationProvider.ProviderName);
        payload.RootElement.GetProperty("toProvider").GetString().Should().Be("AzureOpenAI");
        payload.RootElement.GetProperty("reason").GetString().Should().Be(
            EngineEventPayloads.ProviderChanged.ReasonRestore);
    }

    [RequiresDockerFact]
    public async Task Cut_EmitsNoOtherEngineEvent()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId, generationProvider: new RecordingLiveProvider());

        await harness.Service.CutGenerationToFakeAsync(Input("controller-7"));

        (await CountTelemetryAsync(exerciseId)).Should().Be(
            1, "exactly ONE event per meaningful action — never a spurious engine.reviewed alongside it (XC-004)");
    }

    // ---- AC6: isolation (COR-001, always-Critical) + fail-closed scope ---------------------------

    [RequiresDockerFact]
    public async Task CutInExerciseA_NeverChangesExerciseBsEffectiveProvider()
    {
        // THE always-Critical test. Both harnesses share ONE cut registry (as the real singleton host does), so
        // a scope-blind implementation would show up here as B reporting Fake.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var cuts = new GenerationProviderCutRegistry();
        var live = new RecordingLiveProvider();
        var selector = new GenerationProviderSelector(live, new FakeGenerationProvider(), cuts);

        await using var harnessA = Build(exerciseA, generationProvider: live, providerCut: cuts);
        await using var harnessB = Build(exerciseB, generationProvider: live, providerCut: cuts);

        await harnessA.Service.CutGenerationToFakeAsync(Input("controller-a"));

        var a = await harnessA.Service.GetSettingsAsync();
        var b = await harnessB.Service.GetSettingsAsync();

        a.Settings!.EffectiveProvider.Should().Be(FakeGenerationProvider.ProviderName, "A asked to be cut");
        a.Settings!.ProviderCutToFake.Should().BeTrue();
        b.Settings!.EffectiveProvider.Should().Be(
            "AzureOpenAI",
            "COR-001: a cut applied in exercise A must never change exercise B's provider resolution — B is a "
            + "different exercise's world and keeps generating exactly as its own configuration says");
        b.Settings!.ProviderCutToFake.Should().BeFalse();

        var burstForB = await selector.GenerateAsync(Request(exerciseB));
        burstForB.ProviderName.Should().Be(
            "AzureOpenAI", "and not just on the wire: B's actual generation is unaffected");
    }

    [RequiresDockerFact]
    public async Task RestoreInExerciseA_NeverLiftsExerciseBsCut()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var cuts = new GenerationProviderCutRegistry();
        var live = new RecordingLiveProvider();

        await using var harnessA = Build(exerciseA, generationProvider: live, providerCut: cuts);
        await using var harnessB = Build(exerciseB, generationProvider: live, providerCut: cuts);

        await harnessA.Service.CutGenerationToFakeAsync(Input("controller-a"));
        await harnessB.Service.CutGenerationToFakeAsync(Input("controller-b"));
        await harnessA.Service.RestoreGenerationProviderAsync(Input("controller-a"));

        cuts.IsCutToFake(exerciseA).Should().BeFalse();
        cuts.IsCutToFake(exerciseB).Should().BeTrue(
            "COR-001 in the other direction: A's restore must not put B's exercise back on a live provider its "
            + "controller deliberately cut");
        (await harnessB.Service.GetSettingsAsync()).Settings!.EffectiveProvider.Should().Be(
            FakeGenerationProvider.ProviderName);
    }

    [RequiresDockerFact]
    public async Task CutAndRestore_WithAnUnresolvedScope_FailClosed_AndChangeNothing()
    {
        var exerciseId = Guid.NewGuid();
        var cuts = new GenerationProviderCutRegistry();
        await using var harness = Build(
            currentExerciseId: null, generationProvider: new RecordingLiveProvider(), providerCut: cuts);

        var cut = await harness.Service.CutGenerationToFakeAsync(Input("controller-7"));
        var restore = await harness.Service.RestoreGenerationProviderAsync(Input("controller-7"));

        cut.Outcome.Should().Be(
            EngineReviewOutcome.ScopeUnresolved,
            "scope comes ONLY from IExerciseContext and fails closed (COR-001) — never a default/unscoped exercise");
        cut.Settings.Should().BeNull("a fail-closed result carries NO snapshot — not even a default one");
        restore.Outcome.Should().Be(EngineReviewOutcome.ScopeUnresolved);
        restore.Settings.Should().BeNull();
        cuts.IsCutToFake(exerciseId).Should().BeFalse("nothing was recorded behind the closed door");
        (await CountTelemetryAsync(exerciseId)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task CutAndRestore_WithoutAnActingHuman_AreRejected_AndChangeNothing()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId, generationProvider: new RecordingLiveProvider());
        var noHuman = new EngineReviewActionInput(ActingHumanId: null, TimeZone: "UTC");

        var cut = await harness.Service.CutGenerationToFakeAsync(noHuman);

        cut.Outcome.Should().Be(
            EngineReviewOutcome.Invalid, "COR-018: an egress-policy change is always attributable to a human");
        harness.ProviderCut.IsCutToFake(exerciseId).Should().BeFalse("a rejected call records nothing");

        await harness.Service.CutGenerationToFakeAsync(Input("controller-7"));
        var restore = await harness.Service.RestoreGenerationProviderAsync(noHuman);

        restore.Outcome.Should().Be(EngineReviewOutcome.Invalid);
        harness.ProviderCut.IsCutToFake(exerciseId).Should().BeTrue("and the rejected restore left the cut in place");
    }

    // ---- AC5: the read model reports both facts, and the in-memory note is honest ----------------

    [RequiresDockerFact]
    public async Task GetSettings_ReportsConfiguredAndEffectiveProvider_AsTwoIndependentlyReadableFields()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId, generationProvider: new RecordingLiveProvider());

        var clean = await harness.Service.GetSettingsAsync();
        clean.Settings!.Provider.Should().Be("AzureOpenAI");
        clean.Settings!.EffectiveProvider.Should().Be(
            "AzureOpenAI", "with no cut the effective provider IS the configured one — reported, not omitted");
        clean.Settings!.ProviderCutToFake.Should().BeFalse();

        await harness.Service.CutGenerationToFakeAsync(Input("controller-7"));
        var cut = await harness.Service.GetSettingsAsync();

        cut.Settings!.Provider.Should().Be("AzureOpenAI", "the configured fact is preserved for the 'cut from …' label");
        cut.Settings!.EffectiveProvider.Should().Be(FakeGenerationProvider.ProviderName);
        cut.Settings!.ProviderCutToFake.Should().BeTrue();
        cut.Settings!.InMemoryState.Should().BeTrue();
        cut.Settings!.InMemoryStateNote.Should().Be(EngineSettingsDto.InMemoryNote);
        EngineSettingsDto.InMemoryNote.Should().Contain(
            "generation-provider cut",
            "the shared note must name THIS lever too — a restart returns generation to the startup-configured "
            + "provider, and the operator is told so rather than discovering it");
    }

    [RequiresDockerFact]
    public async Task GetSettings_WithFakeConfigured_ReportsAlreadyFake_SoTheConsoleCanSayTheLeverIsInert()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);

        var result = await harness.Service.GetSettingsAsync();

        result.Settings!.Provider.Should().Be(FakeGenerationProvider.ProviderName);
        result.Settings!.EffectiveProvider.Should().Be(FakeGenerationProvider.ProviderName);
        result.Settings!.AlreadyFake.Should().BeTrue();
        result.Settings!.ProviderCutToFake.Should().BeFalse(
            "already-Fake is NOT the same fact as cut — conflating them would make the console show a lockdown "
            + "no controller asked for");
    }

    // ---- helpers ---------------------------------------------------------------------------------

    private static EngineReviewActionInput Input(string actingHumanId) => new(actingHumanId, "America/Chicago");

    private static GenerationRequest Request(Guid exerciseId) => new()
    {
        ExerciseId = exerciseId,
        Tier = GenerationTier.Ambient,
        PostCount = 1,
        SystemPrompt = "provider cut test",
    };

    private Harness Build(
        Guid? currentExerciseId,
        IGenerationProvider? generationProvider = null,
        IGenerationProviderCutRegistry? providerCut = null)
    {
        var context = new ExerciseContext { CurrentExerciseId = currentExerciseId };
        var db = _fixture.CreateContext(context);
        var clock = new ExerciseClockService(new ManualTimeProvider(ScenarioStart));
        if (currentExerciseId is { } id && id != Guid.Empty)
        {
            clock.Start(id, ScenarioStart, TimeZoneInfo.Utc);
        }

        var cuts = providerCut ?? new GenerationProviderCutRegistry();
        var service = new EngineReviewService(
            new EngineReviewStore(db),
            db,
            context,
            clock,
            new EngineTelemetryEmitter(),
            Mock.Of<IEnginePublishService>(),
            Mock.Of<IEngineReviewBroadcaster>(),
            new EngineAutonomyRegistry(),
            new EngineTierPolicyRegistry(),
            generationProvider ?? new FakeGenerationProvider(),
            Options.Create(new GenerationOptions()),
            cuts,
            NullLogger<EngineReviewService>.Instance);

        return new Harness(service, db, cuts);
    }

    private async Task<List<TelemetryEvent>> ReadEventsAsync(Guid exerciseId, string eventType)
    {
        await using var verify = _fixture.CreateContext();
        return await verify.TelemetryEvents
            .IgnoreQueryFilters()
            .Where(e => e.ExerciseId == exerciseId && e.EventType == eventType)
            .ToListAsync();
    }

    private async Task<int> CountTelemetryAsync(Guid exerciseId)
    {
        await using var verify = _fixture.CreateContext();
        return await verify.TelemetryEvents.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == exerciseId);
    }

    /// <summary>
    /// A stand-in for an EGRESSING provider: it reports a non-Fake name (which is all the settings projection
    /// reads) and counts the bursts it is asked to serve, so "the cut stopped reaching the live provider" is an
    /// observation rather than an inference.
    /// </summary>
    private sealed class RecordingLiveProvider : IGenerationProvider
    {
        public int Calls { get; private set; }

        public string Name => "AzureOpenAI";

        public GenerationGovernance Governance => GenerationGovernance.InProcess;

        public Task<GenerationResult> GenerateAsync(
            GenerationRequest request,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(new GenerationResult(
                Posts: [],
                Usage: new GenerationUsage(0, 0),
                Latency: TimeSpan.Zero,
                ProviderName: Name,
                Model: "recording-live"));
        }
    }

    private sealed class Harness : IAsyncDisposable
    {
        private readonly PulseDbContext _db;

        public Harness(EngineReviewService service, PulseDbContext db, IGenerationProviderCutRegistry providerCut)
        {
            Service = service;
            _db = db;
            ProviderCut = providerCut;
        }

        public EngineReviewService Service { get; }

        public IGenerationProviderCutRegistry ProviderCut { get; }

        public async ValueTask DisposeAsync() => await _db.DisposeAsync();
    }
}
