namespace Pulse.Core.Tests.Features.Generation;

using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Core.Extensions;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;

/// <summary>
/// autonomy-safety story 07 (ADP-042) — the runtime egress lever's seam: the per-exercise
/// <see cref="GenerationProviderSelector"/> and its <see cref="IGenerationProviderCutRegistry"/> state.
/// Proves a cut routes a burst through <see cref="FakeGenerationProvider"/> and a restore routes it back
/// through the startup-configured provider (AC1/AC2), that neither can ever land on a third provider (AC4),
/// that the cut is per-exercise (AC6 / COR-001), and that <see cref="IGenerationProvider.Name"/> /
/// <see cref="IGenerationProvider.Governance"/> deliberately keep describing the CONFIGURED deployment.
/// </summary>
public sealed class GenerationProviderSelectorTests
{
    private static readonly (string Key, string? Value)[] GovernedAzureConfig =
    [
        ("Generation:Provider", "AzureOpenAI"),
        ("Generation:Endpoint", "https://aif-pulse-uat.cognitiveservices.azure.com/"),
        ("Generation:Governance:TenantBounded", "true"),
        ("Generation:Governance:NoTrainingAttested", "true"),
        ("Generation:Governance:Residency", "centralus"),
        ("Generation:Governance:Retention", "Retained"),
        ("Generation:Tiers:Standard:Deployment", "standard"),
        ("Generation:Tiers:Standard:Model", "gpt-5.4"),
    ];

    // ---- AC1 / AC2: cut → Fake, restore → the startup-configured provider ------------------------

    [Fact]
    public async Task WithNoCut_DelegatesToTheConfiguredProvider()
    {
        var configured = new RecordingProvider("AzureOpenAI");
        var fake = new RecordingProvider(FakeGenerationProvider.ProviderName);
        var selector = new GenerationProviderSelector(configured, fake, new GenerationProviderCutRegistry());
        var exerciseId = Guid.NewGuid();

        var result = await selector.GenerateAsync(Request(exerciseId));

        configured.Calls.Should().ContainSingle().Which.Should().Be(
            exerciseId, "with no cut active the burst must reach the startup-configured provider");
        fake.Calls.Should().BeEmpty();
        result.ProviderName.Should().Be("AzureOpenAI", "the burst reports the provider that actually served it");
    }

    [Fact]
    public async Task AfterCut_DelegatesToTheFakeProvider_AndTheConfiguredProviderIsNeverCalled()
    {
        var configured = new RecordingProvider("AzureOpenAI");
        var fake = new RecordingProvider(FakeGenerationProvider.ProviderName);
        var cuts = new GenerationProviderCutRegistry();
        var selector = new GenerationProviderSelector(configured, fake, cuts);
        var exerciseId = Guid.NewGuid();

        cuts.Cut(exerciseId).Should().BeTrue("the first cut changes the state");
        var result = await selector.GenerateAsync(Request(exerciseId));

        fake.Calls.Should().ContainSingle().Which.Should().Be(exerciseId);
        configured.Calls.Should().BeEmpty(
            "a cut exercise must not reach the egressing provider AT ALL — that is the whole point of the lever");
        result.ProviderName.Should().Be(FakeGenerationProvider.ProviderName);
    }

    [Fact]
    public async Task AfterRestore_DelegatesToTheConfiguredProviderAgain_AndNeverAThirdProvider()
    {
        var configured = new RecordingProvider("ClaudeFoundry");
        var fake = new RecordingProvider(FakeGenerationProvider.ProviderName);
        var cuts = new GenerationProviderCutRegistry();
        var selector = new GenerationProviderSelector(configured, fake, cuts);
        var exerciseId = Guid.NewGuid();

        cuts.Cut(exerciseId);
        await selector.GenerateAsync(Request(exerciseId));
        cuts.Restore(exerciseId).Should().BeTrue("the restore changes the state back");
        await selector.GenerateAsync(Request(exerciseId));

        fake.Calls.Should().HaveCount(1, "only the cut burst went to Fake");
        configured.Calls.Should().HaveCount(1, "the restored burst went back to the STARTUP-CONFIGURED provider");
        selector.ConfiguredProvider.Should().BeSameAs(
            configured,
            "restore is capped at the pre-existing baseline: the selector holds exactly the two instances startup "
            + "created, so there is no third provider it could ever land on (§8.2)");
        selector.FakeProvider.Should().BeSameAs(fake);
    }

    // ---- AC6 / COR-001: the cut is per-exercise ---------------------------------------------------

    [Fact]
    public async Task ACutInOneExercise_NeverChangesAnotherExercisesResolution()
    {
        var configured = new RecordingProvider("AzureOpenAI");
        var fake = new RecordingProvider(FakeGenerationProvider.ProviderName);
        var cuts = new GenerationProviderCutRegistry();
        var selector = new GenerationProviderSelector(configured, fake, cuts);
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        cuts.Cut(exerciseA);

        await selector.GenerateAsync(Request(exerciseA));
        await selector.GenerateAsync(Request(exerciseB));

        fake.Calls.Should().Equal([exerciseA], "only the cut exercise routes to Fake");
        configured.Calls.Should().Equal(
            [exerciseB], "COR-001: exercise B's generation is untouched by a cut applied to exercise A");
        cuts.IsCutToFake(exerciseB).Should().BeFalse();
    }

    [Fact]
    public async Task AnUnscopedRequest_FailsClosedToFake_AndNeverEgresses()
    {
        var configured = new RecordingProvider("AzureOpenAI");
        var fake = new RecordingProvider(FakeGenerationProvider.ProviderName);
        var selector = new GenerationProviderSelector(configured, fake, new GenerationProviderCutRegistry());

        await selector.GenerateAsync(Request(Guid.Empty));

        configured.Calls.Should().BeEmpty(
            "an unscoped burst is a bug; the fail-closed answer at an egress boundary is 'do not egress' (COR-001)");
        fake.Calls.Should().ContainSingle();
    }

    // ---- Name / Governance pass through to the CONFIGURED provider, by design --------------------

    [Fact]
    public void NameAndGovernance_DescribeTheConfiguredDeployment_EvenWhileACutIsActive()
    {
        var configured = new RecordingProvider("AzureOpenAI", GenerationGovernance.InProcess with { Residency = "centralus" });
        var cuts = new GenerationProviderCutRegistry();
        var selector = new GenerationProviderSelector(configured, new FakeGenerationProvider(), cuts);
        cuts.Cut(Guid.NewGuid());

        selector.Name.Should().Be(
            "AzureOpenAI",
            "the settings snapshot's 'provider' field means the STARTUP-CONFIGURED provider — a cut must not make "
            + "existing consumers of that field start lying; the effective provider is a separate wire field");
        selector.Governance.Residency.Should().Be(
            "centralus",
            "Governance is the DEPLOYMENT's attested NFR-005/ADP-025 posture read by the NFR-006 questionnaire, "
            + "so a temporary per-exercise cut must not rewrite it");
    }

    // ---- the registry's idempotency contract (the no-spurious-telemetry basis, AC3) --------------

    [Fact]
    public void Cut_IsIdempotent_AndOnlyReportsTheRealTransition()
    {
        var cuts = new GenerationProviderCutRegistry();
        var exerciseId = Guid.NewGuid();

        cuts.Cut(exerciseId).Should().BeTrue("the first cut changes state");
        cuts.Cut(exerciseId).Should().BeFalse("a second cut is a no-op — the caller must not emit a second audit event");
        cuts.IsCutToFake(exerciseId).Should().BeTrue();

        cuts.Restore(exerciseId).Should().BeTrue("the restore changes state");
        cuts.Restore(exerciseId).Should().BeFalse("restoring an uncut exercise is an idempotent no-op, not an error");
        cuts.IsCutToFake(exerciseId).Should().BeFalse();
    }

    [Fact]
    public void CutAndRestore_RejectAnEmptyExerciseId()
    {
        var cuts = new GenerationProviderCutRegistry();

        FluentActions.Invoking(() => cuts.Cut(Guid.Empty)).Should().Throw<ArgumentException>();
        FluentActions.Invoking(() => cuts.Restore(Guid.Empty)).Should().Throw<ArgumentException>();
        cuts.IsCutToFake(Guid.Empty).Should().BeFalse("the per-burst read never throws; the selector fails it closed");
    }

    // ---- AC1: the same thing, through the REAL composition root ----------------------------------

    [Fact]
    public async Task ThroughAddEngineGeneration_ACutExerciseGeneratesThroughFake_WithoutTouchingTheLiveAdapter()
    {
        // The governed live config selects the real Azure adapter. Cutting the exercise must make GenerateAsync
        // resolve Fake — proven by it RETURNING (the live adapter would attempt an Entra token + HTTPS call to a
        // real endpoint), and by the burst's own provenance saying Fake.
        var services = new ServiceCollection();
        services.AddEngineGeneration(Config(GovernedAzureConfig));
        await using var serviceProvider = services.BuildServiceProvider();

        var selector = serviceProvider.GetRequiredService<IGenerationProvider>()
            .Should().BeOfType<GenerationProviderSelector>().Subject;
        selector.ConfiguredProvider.Should().BeOfType<AzureOpenAIGenerationProvider>(
            "the discriminator still decides the configured provider, behind the governance gate");
        selector.FakeProvider.Should().BeOfType<FakeGenerationProvider>();

        var cutExercise = Guid.NewGuid();
        serviceProvider.GetRequiredService<IGenerationProviderCutRegistry>().Cut(cutExercise);

        var result = await serviceProvider.GetRequiredService<IGenerationProvider>()
            .GenerateAsync(Request(cutExercise));

        result.ProviderName.Should().Be(
            FakeGenerationProvider.ProviderName,
            "the reaction loop's very next burst for a cut exercise is served by Fake — no restart, no config change");
        selector.Resolve(Guid.NewGuid()).Should().BeOfType<AzureOpenAIGenerationProvider>(
            "and every OTHER exercise still resolves the live provider (COR-001)");
    }

    [Fact]
    public void ThroughAddEngineGeneration_TheCutRegistryIsASingleSharedInstance()
    {
        var services = new ServiceCollection();
        services.AddEngineGeneration(Config([("Generation:Provider", "Fake")]));
        using var serviceProvider = services.BuildServiceProvider();

        var first = serviceProvider.GetRequiredService<IGenerationProviderCutRegistry>();
        var second = serviceProvider.GetRequiredService<IGenerationProviderCutRegistry>();

        second.Should().BeSameAs(
            first,
            "the settings endpoint writes the cut and the reaction loop's selector reads it — two instances would "
            + "mean a controller's cut never reaches generation");
        serviceProvider.GetServices<IGenerationProvider>().Should().HaveCount(
            1, "exactly ONE IGenerationProvider is resolvable: the selector (the two inner providers are not it)");
    }

    private static IConfiguration Config((string Key, string? Value)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value)))
            .Build();

    private static GenerationRequest Request(Guid exerciseId) => new()
    {
        ExerciseId = exerciseId,
        Tier = GenerationTier.Ambient,
        PostCount = 2,
        SystemPrompt = "selector test",
    };

    /// <summary>A stand-in provider that records the exercise id of every burst it is asked to serve.</summary>
    private sealed class RecordingProvider : IGenerationProvider
    {
        private readonly GenerationGovernance _governance;

        public RecordingProvider(string name, GenerationGovernance? governance = null)
        {
            Name = name;
            _governance = governance ?? GenerationGovernance.InProcess;
        }

        public List<Guid> Calls { get; } = [];

        public string Name { get; }

        public GenerationGovernance Governance => _governance;

        public Task<GenerationResult> GenerateAsync(
            GenerationRequest request,
            CancellationToken cancellationToken = default)
        {
            Calls.Add(request.ExerciseId);
            return Task.FromResult(new GenerationResult(
                Posts: [],
                Usage: new GenerationUsage(0, 0),
                Latency: TimeSpan.Zero,
                ProviderName: Name,
                Model: "recording"));
        }
    }
}
