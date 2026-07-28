namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Pulse.Core.Features.Autonomy.Models;
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
/// The engine-settings service suite (autonomy-safety story 05) against a REAL SQL Server (Testcontainers):
/// the runtime autonomy-default control that makes <see cref="AutonomyLevel.DelayedAuto"/> reachable at all
/// (AC1), the §8.2 "a default change never lifts a clamp" invariant (AC2), the per-exercise tier-policy
/// override (AC3), the read model (AC4), the fail-closed scope + COR-018 attribution (AC5), and the two
/// additive XC-004 events (AC7). Every test is <see cref="RequiresDockerFactAttribute"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class EngineSettingsServiceTests
{
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 14, 9, 0, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;

    public EngineSettingsServiceTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- AC1: the autonomy default is settable at runtime, on the SHARED registry instance ---------

    [RequiresDockerFact]
    public async Task SetAutonomyDefault_DelayedAuto_MutatesTheSameSharedStateTheLoopReads()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);

        // The instance the reaction-loop registration + the auto-HOLD tick hold is the registry's, so taking it
        // BEFORE the call and re-asserting on it after is exactly the "does the loop see it" question.
        var loopState = harness.Registry.GetOrCreate(exerciseId);
        loopState.ExerciseDefault.Should().Be(AutonomyLevel.Suggest, "every exercise is seeded at the safe floor");

        var result = await harness.Service.SetExerciseAutonomyDefaultAsync("delayed-auto", Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        loopState.ExerciseDefault.Should().Be(
            AutonomyLevel.DelayedAuto,
            "the endpoint must call SetExerciseDefault on the SAME EngineAutonomyRegistry instance the loop reads — never a fresh Create");
        result.Settings!.Autonomy.ExerciseDefaultLevel.Should().Be(AutonomyLevel.DelayedAuto);
        ReferenceEquals(harness.Registry.GetOrCreate(exerciseId), loopState).Should().BeTrue(
            "GetOrCreate is idempotent per exercise — one shared state, no second instance");
    }

    [RequiresDockerFact]
    public async Task SetAutonomyDefault_BackToSuggest_LowersItAgain()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);

        await harness.Service.SetExerciseAutonomyDefaultAsync("delayed-auto", Input("controller-7"));
        var result = await harness.Service.SetExerciseAutonomyDefaultAsync("suggest", Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        result.Settings!.Autonomy.ExerciseDefaultLevel.Should().Be(
            AutonomyLevel.Suggest, "a controller may move the posture in both directions");
    }

    [RequiresDockerFact]
    public async Task SetAutonomyDefault_Auto_IsRejected400_AndMutatesNothing()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);

        var result = await harness.Service.SetExerciseAutonomyDefaultAsync("auto", Input("controller-7"));

        result.Outcome.Should().Be(
            EngineReviewOutcome.Invalid,
            "AutonomyLevel.Auto is v1.1: AutonomyLevels.EnsureSelectable rejects it — never a silent clamp to Suggest");
        result.ValidationError.Should().Contain("v1.1");
        harness.Registry.GetOrCreate(exerciseId).ExerciseDefault.Should().Be(
            AutonomyLevel.Suggest, "a rejected level leaves the shared state untouched");
        (await CountTelemetryAsync(exerciseId)).Should().Be(0, "a rejected change is not an audited change");
    }

    [RequiresDockerFact]
    public async Task SetAutonomyDefault_UnknownLiteral_IsRejected400_AndMutatesNothing()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);

        var result = await harness.Service.SetExerciseAutonomyDefaultAsync("full-auto-please", Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.Invalid, "an unknown level literal fails loud, never a silent default");
        harness.Registry.GetOrCreate(exerciseId).ExerciseDefault.Should().Be(AutonomyLevel.Suggest);
    }

    // ---- AC2: a default change never lifts an active safety clamp (§8.2) --------------------------

    [RequiresDockerFact]
    public async Task SetAutonomyDefault_WhileKillSwitchClamped_SetsTheBaseUnderneath_ButNeverLiftsTheClamp()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);

        var state = harness.Registry.GetOrCreate(exerciseId);
        state.EngageKillSwitch(KillSwitchMode.FullStop, "lead-1", 0);

        var result = await harness.Service.SetExerciseAutonomyDefaultAsync("delayed-auto", Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        state.ExerciseDefault.Should().Be(AutonomyLevel.DelayedAuto, "the base level is set UNDERNEATH the clamp");
        state.SafetyClampActive.Should().BeTrue(
            "a routine default change can never silently release a kill switch — only RestoreFromSafety lifts it (§8.2)");
        state.IsGenerationStopped.Should().BeTrue("the full stop still holds");
        state.ResolveEffective(Guid.NewGuid()).GenerationStopped.Should().BeTrue(
            "the effective disposition the loop routes on is still STOPPED, not the freshly raised default");
        result.Settings!.Autonomy.SafetyClampActive.Should().BeTrue("the response reports the clamp honestly");
        result.Settings!.Autonomy.ExerciseDefaultLevel.Should().Be(AutonomyLevel.DelayedAuto);
    }

    [RequiresDockerFact]
    public async Task SetAutonomyDefault_WhileClamped_ReportsAnEffectiveLevelBelowTheBase_SoNoConsumerReDerivesIt()
    {
        // WR-003: the wire must carry BOTH levels. A consumer that has to infer "clamp active ⇒ effectively
        // Suggest" is the mislabelled-posture bug class this feature exists to fix.
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);

        var clean = await harness.Service.SetExerciseAutonomyDefaultAsync("delayed-auto", Input("controller-7"));
        clean.Settings!.Autonomy.EffectiveLevel.Should().Be(
            AutonomyLevel.DelayedAuto, "with no clamp the effective level IS the base default");

        harness.Registry.GetOrCreate(exerciseId).EngageKillSwitch(KillSwitchMode.DropToSuggest, "lead-1", 0);
        var clamped = await harness.Service.GetSettingsAsync();

        clamped.Settings!.Autonomy.ExerciseDefaultLevel.Should().Be(
            AutonomyLevel.DelayedAuto, "the base default the controller set is preserved underneath");
        clamped.Settings!.Autonomy.EffectiveLevel.Should().Be(
            AutonomyLevel.Suggest, "the clamp lowers what the loop actually routes on — reported, not left to be re-derived");
        clamped.Settings!.Autonomy.EffectiveLevel.Should().NotBe(clamped.Settings!.Autonomy.ExerciseDefaultLevel);
    }

    [RequiresDockerFact]
    public async Task GetSettings_WhenGenerationIsFullyStopped_ReportsNoEffectiveLevel()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);

        await harness.Service.SetExerciseAutonomyDefaultAsync("delayed-auto", Input("controller-7"));
        harness.Registry.GetOrCreate(exerciseId).EngageKillSwitch(KillSwitchMode.FullStop, "lead-1", 0);

        var result = await harness.Service.GetSettingsAsync();

        result.Settings!.Autonomy.EffectiveLevel.Should().BeNull(
            "a full stop routes at NO level — null is the honest projection, not a misleading 'suggest'");
        result.Settings!.Autonomy.GenerationStopped.Should().BeTrue();
        result.Settings!.Autonomy.ExerciseDefaultLevel.Should().Be(AutonomyLevel.DelayedAuto);
    }

    [RequiresDockerFact]
    public async Task GetSettings_AfterRestore_ReportsTheEffectiveLevelBackAtTheBase()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);

        await harness.Service.SetExerciseAutonomyDefaultAsync("delayed-auto", Input("controller-7"));
        await harness.Service.EngageKillSwitchAsync(KillSwitchMode.FullStop, Input("lead-1"));
        await harness.Service.RestoreFromSafetyAsync(Input("lead-1"));

        var result = await harness.Service.GetSettingsAsync();

        result.Settings!.Autonomy.EffectiveLevel.Should().Be(
            AutonomyLevel.DelayedAuto, "an explicit restore returns the effective level to the preserved base (§8.2)");
        result.Settings!.Autonomy.SafetyClampActive.Should().BeFalse();
    }

    // ---- WR-002: a forced tier must be one this deployment actually bound -------------------------

    [RequiresDockerFact]
    public async Task SetTierPolicy_ForATierWithNoConfiguredDeployment_IsRejected400_NamingTheMissingKey()
    {
        // A governed deployment that bound only Standard: forcing Ambient would return 200 and then throw
        // GenerationConfigurationException on every later tick inside the loop's catch — the engine would stop
        // producing with nothing but a log line. Rejected up front instead.
        var exerciseId = Guid.NewGuid();
        var options = new GenerationOptions();
        options.Tiers["Standard"] = new TierModelOptions { Model = "claude-sonnet-5", Deployment = "standard" };
        await using var harness = Build(exerciseId, options);

        var result = await harness.Service.SetTierPolicyModeAsync("ambient", Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.Invalid);
        result.ValidationError.Should().Contain(
            "Generation:Tiers:Ambient:Deployment", "the 400 must name the exact config key an operator has to set");
        harness.TierPolicy.GetMode(exerciseId).Should().Be(
            TierPolicyMode.Auto, "an unservable tier is never recorded — the engine keeps generating");
    }

    [RequiresDockerFact]
    public async Task SetTierPolicy_WithNoTiersConfigured_IsRejected_ForAREALProvider_ButAllowed_ForFake()
    {
        // Copilot review, PR #385. The skip must require BOTH "no tier bindings" AND "the offline provider".
        // Keyed on empty Tiers alone, a REAL provider with no bindings accepts the override, then throws on
        // every subsequent tick inside the loop's catch — generation stalls with only a log line, which is the
        // failure this validation exists to prevent. Keyed on provider-alone it would be disabled in CI (where
        // Fake is the default) and the rule would go unexercised.
        var liveExercise = Guid.NewGuid();
        await using var live = Build(
            liveExercise,
            new GenerationOptions(),                       // nothing bound
            generationProvider: new StubLiveGenerationProvider());

        var rejected = await live.Service.SetTierPolicyModeAsync("ambient", Input("controller-7"));

        rejected.Outcome.Should().Be(
            EngineReviewOutcome.Invalid,
            "a real provider with no tier bindings is the misconfiguration this check is for");
        live.TierPolicy.GetMode(liveExercise).Should().Be(
            TierPolicyMode.Auto, "an unservable tier must never be recorded");

        // Same empty config, offline provider: nothing to validate against, so it stays permitted.
        var fakeExercise = Guid.NewGuid();
        await using var offline = Build(fakeExercise, new GenerationOptions());

        var allowed = await offline.Service.SetTierPolicyModeAsync("ambient", Input("controller-7"));

        allowed.Outcome.Should().Be(
            EngineReviewOutcome.Ok,
            "FakeGenerationProvider ignores tiers, so CI/local must keep working with no bindings configured");
        offline.TierPolicy.GetMode(fakeExercise).Should().Be(TierPolicyMode.Ambient);
    }

    /// <summary>A non-Fake <see cref="IGenerationProvider"/>: only its Name matters to the tier-binding rule.</summary>
    private sealed class StubLiveGenerationProvider : IGenerationProvider
    {
        public string Name => "AzureOpenAI";

        public GenerationGovernance Governance => GenerationGovernance.InProcess;

        public Task<GenerationResult> GenerateAsync(
            GenerationRequest request,
            CancellationToken cancellationToken = default)
            => throw new NotSupportedException("never invoked — this stub exists only to report a non-Fake Name");
    }

    [RequiresDockerFact]
    public async Task SetTierPolicy_ForATierBoundWithAnEmptyDeployment_IsAlsoRejected400()
    {
        var exerciseId = Guid.NewGuid();
        var options = new GenerationOptions();
        options.Tiers["Standard"] = new TierModelOptions { Model = "claude-sonnet-5", Deployment = "standard" };
        options.Tiers["Ambient"] = new TierModelOptions { Model = "claude-haiku-5", Deployment = "   " };
        await using var harness = Build(exerciseId, options);

        var result = await harness.Service.SetTierPolicyModeAsync("ambient", Input("controller-7"));

        result.Outcome.Should().Be(
            EngineReviewOutcome.Invalid,
            "the same empty-Deployment rule the generation providers apply — an accepted mode is one generation can serve");
    }

    [RequiresDockerFact]
    public async Task SetTierPolicy_ForABoundTier_IsAccepted()
    {
        var exerciseId = Guid.NewGuid();
        var options = new GenerationOptions();
        options.Tiers["Standard"] = new TierModelOptions { Model = "claude-sonnet-5", Deployment = "standard" };
        options.Tiers["Ambient"] = new TierModelOptions { Model = "claude-haiku-5", Deployment = "ambient" };
        await using var harness = Build(exerciseId, options);

        var standard = await harness.Service.SetTierPolicyModeAsync("standard", Input("controller-7"));
        var ambient = await harness.Service.SetTierPolicyModeAsync("ambient", Input("controller-7"));

        standard.Outcome.Should().Be(EngineReviewOutcome.Ok);
        ambient.Outcome.Should().Be(EngineReviewOutcome.Ok);
        harness.TierPolicy.GetMode(exerciseId).Should().Be(TierPolicyMode.Ambient);
    }

    [RequiresDockerFact]
    public async Task SetTierPolicy_Auto_IsAlwaysAccepted_EvenWithNoTierBound()
    {
        var exerciseId = Guid.NewGuid();
        var options = new GenerationOptions();
        options.Tiers["Standard"] = new TierModelOptions { Model = "claude-sonnet-5", Deployment = "standard" };
        await using var harness = Build(exerciseId, options);

        var result = await harness.Service.SetTierPolicyModeAsync("auto", Input("controller-7"));

        result.Outcome.Should().Be(
            EngineReviewOutcome.Ok, "'auto' forces no tier, so there is no binding to check — clearing is always allowed");
    }

    [RequiresDockerFact]
    public async Task SetTierPolicy_WithNoTiersConfiguredAtAll_IsAccepted_SoTheOfflineProviderIsUnaffected()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId); // no Generation:Tiers at all — the Fake provider's normal state

        var result = await harness.Service.SetTierPolicyModeAsync("ambient", Input("controller-7"));

        result.Outcome.Should().Be(
            EngineReviewOutcome.Ok, "the offline Fake provider ignores the tier, so an unconfigured Tiers map is not an error");
        harness.TierPolicy.GetMode(exerciseId).Should().Be(TierPolicyMode.Ambient);
    }

    // ---- AC5: fail-closed scope + COR-018 attribution --------------------------------------------

    [RequiresDockerFact]
    public async Task SetAutonomyDefault_UnresolvedScope_FailsClosed_AndMutatesNothing()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(currentExerciseId: null);

        var result = await harness.Service.SetExerciseAutonomyDefaultAsync("delayed-auto", Input("controller-7"));

        result.Outcome.Should().Be(
            EngineReviewOutcome.ScopeUnresolved,
            "scope comes ONLY from IExerciseContext and fails closed (COR-001) — never a default/unscoped exercise");
        result.Settings.Should().BeNull("a fail-closed result carries no snapshot");
        harness.Registry.GetOrCreate(exerciseId).ExerciseDefault.Should().Be(AutonomyLevel.Suggest);
    }

    [RequiresDockerFact]
    public async Task SetAutonomyDefault_MissingActingHumanId_ReturnsInvalid()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);

        var result = await harness.Service.SetExerciseAutonomyDefaultAsync(
            "delayed-auto", new EngineReviewActionInput(ActingHumanId: null, TimeZone: "UTC"));

        result.Outcome.Should().Be(EngineReviewOutcome.Invalid, "COR-018 requires the human behind the shared account");
        harness.Registry.GetOrCreate(exerciseId).ExerciseDefault.Should().Be(AutonomyLevel.Suggest);
    }

    [RequiresDockerFact]
    public async Task SetAutonomyDefault_InExerciseA_NeverMovesExerciseB()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await using var harness = Build(exerciseA);

        await harness.Service.SetExerciseAutonomyDefaultAsync("delayed-auto", Input("controller-7"));

        harness.Registry.GetOrCreate(exerciseA).ExerciseDefault.Should().Be(AutonomyLevel.DelayedAuto);
        harness.Registry.GetOrCreate(exerciseB).ExerciseDefault.Should().Be(
            AutonomyLevel.Suggest, "COR-001: a control on exercise A can never move exercise B's posture");
        harness.TierPolicy.GetMode(exerciseB).Should().Be(TierPolicyMode.Auto);
    }

    // ---- AC3: the per-exercise tier-policy override -----------------------------------------------

    [RequiresDockerFact]
    public async Task SetTierPolicy_RecordsThePerExerciseOverride_AndAppliesItToAComposedTier()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);

        var result = await harness.Service.SetTierPolicyModeAsync("ambient", Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        result.Settings!.TierPolicyMode.Should().Be(TierPolicyMode.Ambient);
        harness.TierPolicy.GetMode(exerciseId).Should().Be(TierPolicyMode.Ambient);
        harness.TierPolicy.ResolveTier(exerciseId, GenerationTier.Standard).Should().Be(
            GenerationTier.Ambient,
            "the override wins over the intent's purpose-based tier at the loop's IntentComposer call site");
    }

    [RequiresDockerFact]
    public async Task SetTierPolicy_Auto_ClearsTheOverride_RestoringThePurposeBasedMap()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);

        await harness.Service.SetTierPolicyModeAsync("standard", Input("controller-7"));
        harness.TierPolicy.ResolveTier(exerciseId, GenerationTier.Ambient).Should().Be(GenerationTier.Standard);

        var result = await harness.Service.SetTierPolicyModeAsync("auto", Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        result.Settings!.TierPolicyMode.Should().Be(TierPolicyMode.Auto);
        harness.TierPolicy.ResolveTier(exerciseId, GenerationTier.Ambient).Should().Be(
            GenerationTier.Ambient, "'auto' clears the override so IntentComposer.TierFor's static map decides again");
        harness.TierPolicy.ResolveTier(exerciseId, GenerationTier.Standard).Should().Be(GenerationTier.Standard);
    }

    [RequiresDockerFact]
    public async Task SetTierPolicy_UnknownMode_IsRejected400_AndMutatesNothing()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);

        await harness.Service.SetTierPolicyModeAsync("standard", Input("controller-7"));
        var result = await harness.Service.SetTierPolicyModeAsync("gpt-5-turbo-max", Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.Invalid, "only the three tier ROLE literals are accepted");
        harness.TierPolicy.GetMode(exerciseId).Should().Be(
            TierPolicyMode.Standard, "a rejected mode leaves the recorded override untouched");
    }

    [RequiresDockerFact]
    public async Task SetTierPolicy_UnresolvedScope_FailsClosed_AndMutatesNothing()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(currentExerciseId: null);

        var result = await harness.Service.SetTierPolicyModeAsync("standard", Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.ScopeUnresolved);
        harness.TierPolicy.GetMode(exerciseId).Should().Be(TierPolicyMode.Auto);
    }

    [RequiresDockerFact]
    public async Task SetTierPolicy_MissingActingHumanId_ReturnsInvalid()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);

        var result = await harness.Service.SetTierPolicyModeAsync(
            "ambient", new EngineReviewActionInput(ActingHumanId: null, TimeZone: "UTC"));

        result.Outcome.Should().Be(EngineReviewOutcome.Invalid, "COR-018 applies to every steering mutation");
        harness.TierPolicy.GetMode(exerciseId).Should().Be(TierPolicyMode.Auto);
    }

    // ---- AC4: the read model ----------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task GetSettings_ReportsProvider_GovernedTiers_AutonomyDefault_TierPolicyMode_AndClamp()
    {
        var exerciseId = Guid.NewGuid();
        var options = new GenerationOptions();
        options.Tiers["Standard"] = new TierModelOptions { Model = "claude-sonnet-5", Deployment = "standard", ZdrCapable = true };
        options.Tiers["Ambient"] = new TierModelOptions { Model = "claude-haiku-5", Deployment = "ambient", ZdrCapable = false };

        await using var harness = Build(exerciseId, options);

        // Move every reported dimension away from its default so a stale/hardcoded read cannot pass.
        await harness.Service.SetExerciseAutonomyDefaultAsync("delayed-auto", Input("controller-7"));
        await harness.Service.SetTierPolicyModeAsync("standard", Input("controller-7"));
        harness.Registry.GetOrCreate(exerciseId).DegradeToSuggest("provider circuit opened", 0);

        var result = await harness.Service.GetSettingsAsync();

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        var settings = result.Settings!;
        settings.Provider.Should().Be("Fake", "the active IGenerationProvider.Name, not the config discriminator");
        settings.Tiers.Select(t => t.Tier).Should().Equal(["Ambient", "Standard"], "tiers are reported in a stable key order");
        settings.Tiers.Single(t => t.Tier == "Standard").Model.Should().Be("claude-sonnet-5");
        settings.Tiers.Single(t => t.Tier == "Standard").Deployment.Should().Be("standard");
        settings.Tiers.Single(t => t.Tier == "Ambient").ZdrCapable.Should().BeFalse();
        settings.Autonomy.ExerciseDefaultLevel.Should().Be(AutonomyLevel.DelayedAuto);
        settings.TierPolicyMode.Should().Be(TierPolicyMode.Standard);
        settings.Autonomy.SafetyClampActive.Should().BeTrue("the degraded clamp is reported");
        settings.Autonomy.DegradedReason.Should().Be("provider circuit opened");
        settings.InMemoryState.Should().BeTrue("the state's reset-on-restart nature is reported honestly, not hidden");
        settings.InMemoryStateNote.Should().Be(EngineSettingsDto.InMemoryNote);
    }

    [RequiresDockerFact]
    public async Task GetSettings_WithNoTiersConfigured_ReportsAnEmptyMapping_NotAFailure()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);

        var result = await harness.Service.GetSettingsAsync();

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        result.Settings!.Tiers.Should().BeEmpty();
        result.Settings!.Autonomy.ExerciseDefaultLevel.Should().Be(AutonomyLevel.Suggest);
        result.Settings!.TierPolicyMode.Should().Be(TierPolicyMode.Auto);
    }

    [RequiresDockerFact]
    public async Task GetSettings_UnresolvedScope_FailsClosed_WithNoSnapshot()
    {
        await using var harness = Build(currentExerciseId: null);

        var result = await harness.Service.GetSettingsAsync();

        result.Outcome.Should().Be(
            EngineReviewOutcome.ScopeUnresolved,
            "even a READ fails closed on an unresolved scope — never a default/unscoped settings snapshot (COR-001)");
        result.Settings.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task GetSettings_InExerciseA_ReportsAsPosture_NotBs()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        // B is set to Delayed-auto + ambient through its OWN scope; A must still read its own (default) posture.
        await using var harnessB = Build(exerciseB);
        await harnessB.Service.SetExerciseAutonomyDefaultAsync("delayed-auto", Input("controller-b"));
        await harnessB.Service.SetTierPolicyModeAsync("ambient", Input("controller-b"));

        await using var harnessA = Build(exerciseA, autonomy: harnessB.Registry, tierPolicy: harnessB.TierPolicy);
        var result = await harnessA.Service.GetSettingsAsync();

        result.Settings!.Autonomy.ExerciseDefaultLevel.Should().Be(
            AutonomyLevel.Suggest, "COR-001: A's settings read never reports B's posture, even sharing the registries");
        result.Settings!.TierPolicyMode.Should().Be(TierPolicyMode.Auto);
    }

    // ---- AC7: the two additive XC-004 events ------------------------------------------------------

    [RequiresDockerFact]
    public async Task SetAutonomyDefault_EmitsExactlyOneAutonomyDefaultChangedEvent_WithTheFromToAndActor()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);
        harness.Registry.GetOrCreate(exerciseId).EngageKillSwitch(KillSwitchMode.DropToSuggest, "lead-1", 0);

        await harness.Service.SetExerciseAutonomyDefaultAsync("delayed-auto", Input("controller-7"));

        var events = await ReadEventsAsync(exerciseId, EngineEventTypes.AutonomyDefaultChanged);
        var telemetryEvent = events.Should().ContainSingle(
            "exactly one XC-004 event per meaningful action (the durable record the in-memory state cannot be)").Subject;
        telemetryEvent.SchemaVersion.Should().Be("v0", "the additive event type rides the UNCHANGED v0 envelope");
        telemetryEvent.ExerciseId.Should().Be(exerciseId);
        telemetryEvent.Actor.ActingHumanId.Should().Be("controller-7", "COR-018 attribution is on the envelope");

        using var payload = JsonDocument.Parse(telemetryEvent.Payload!);
        payload.RootElement.GetProperty("fromLevel").GetString().Should().Be("suggest");
        payload.RootElement.GetProperty("toLevel").GetString().Should().Be("delayed-auto");
        payload.RootElement.GetProperty("safetyClampActive").GetBoolean().Should().BeTrue(
            "the audit shows the raise was recorded while a clamp still held it down (§8.2)");
        payload.RootElement.GetProperty("scenarioMinute").GetInt32().Should().Be(0, "scenario time, not wall clock (COR-053)");
    }

    [RequiresDockerFact]
    public async Task SetTierPolicy_EmitsExactlyOneTierPolicyChangedEvent_WithTheFromToModes()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);

        await harness.Service.SetTierPolicyModeAsync("ambient", Input("controller-7"));
        await harness.Service.SetTierPolicyModeAsync("auto", Input("controller-7"));

        var events = await ReadEventsAsync(exerciseId, EngineEventTypes.TierPolicyChanged);
        events.Should().HaveCount(2, "one event per change — never a batched or missing audit record");

        var cleared = events
            .Select(e => JsonDocument.Parse(e.Payload!))
            .Single(d => d.RootElement.GetProperty("toMode").GetString() == "auto");
        using (cleared)
        {
            cleared.RootElement.GetProperty("fromMode").GetString().Should().Be(
                "ambient", "the audit records what the override was before it was cleared");
        }
    }

    [RequiresDockerFact]
    public async Task SetAutonomyDefault_EmitsNoOtherEngineEvent()
    {
        var exerciseId = Guid.NewGuid();
        await using var harness = Build(exerciseId);

        await harness.Service.SetExerciseAutonomyDefaultAsync("delayed-auto", Input("controller-7"));

        (await CountTelemetryAsync(exerciseId)).Should().Be(
            1, "a settings change emits exactly ONE event, never a spurious engine.reviewed alongside it");
    }

    // ---- helpers ---------------------------------------------------------------------------------

    private static EngineReviewActionInput Input(string actingHumanId) => new(actingHumanId, "America/Chicago");

    private Harness Build(
        Guid? currentExerciseId,
        GenerationOptions? generationOptions = null,
        EngineAutonomyRegistry? autonomy = null,
        EngineTierPolicyRegistry? tierPolicy = null,
        IGenerationProvider? generationProvider = null)
    {
        var context = new ExerciseContext { CurrentExerciseId = currentExerciseId };
        var db = _fixture.CreateContext(context);
        var time = new ManualTimeProvider(ScenarioStart);
        var clock = new ExerciseClockService(time);
        if (currentExerciseId is { } id && id != Guid.Empty)
        {
            clock.Start(id, ScenarioStart, TimeZoneInfo.Utc);
        }

        var registry = autonomy ?? new EngineAutonomyRegistry();
        var tiers = tierPolicy ?? new EngineTierPolicyRegistry();
        var service = new EngineReviewService(
            new EngineReviewStore(db),
            db,
            context,
            clock,
            new EngineTelemetryEmitter(),
            Mock.Of<IEnginePublishService>(),
            Mock.Of<IEngineReviewBroadcaster>(),
            registry,
            tiers,
            generationProvider ?? new FakeGenerationProvider(),
            Options.Create(generationOptions ?? new GenerationOptions()),
            NullLogger<EngineReviewService>.Instance);

        return new Harness(service, db, registry, tiers);
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

    private sealed class Harness : IAsyncDisposable
    {
        private readonly PulseDbContext _db;

        public Harness(
            EngineReviewService service,
            PulseDbContext db,
            EngineAutonomyRegistry registry,
            EngineTierPolicyRegistry tierPolicy)
        {
            Service = service;
            _db = db;
            Registry = registry;
            TierPolicy = tierPolicy;
        }

        public EngineReviewService Service { get; }

        public EngineAutonomyRegistry Registry { get; }

        public EngineTierPolicyRegistry TierPolicy { get; }

        public async ValueTask DisposeAsync() => await _db.DisposeAsync();
    }
}
