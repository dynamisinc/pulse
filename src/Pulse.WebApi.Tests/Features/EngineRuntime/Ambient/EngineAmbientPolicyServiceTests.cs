namespace Pulse.WebApi.Tests.Features.EngineRuntime.Ambient;

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
using Pulse.Core.Features.Ambient.Models;
using Pulse.Core.Features.Ambient.Services;
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
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// ambient-chatter story 01, AC0-AC3 at the service seam (Docker-free, EF in-memory with the REAL central query
/// filter): the settings POST's validation and fail-closed scope, the persona-of-THIS-exercise rule (a foreign
/// persona is rejected), the from→to audit event on the reused tier-policy event type, the additive settings field,
/// and the request-path safety levers lowering autonomous ambient.
/// </summary>
public sealed class EngineAmbientPolicyServiceTests
{
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 14, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task UnresolvedScope_FailsClosed_AndChangesNothing()
    {
        using var harness = new Harness(currentExerciseId: null);

        var result = await harness.Service.SetAmbientPolicyAsync(Request("review"));

        result.Outcome.Should().Be(EngineReviewOutcome.ScopeUnresolved, "an unresolved scope is a 401, never a default write");
    }

    [Fact]
    public async Task MissingActingHuman_Is400()
    {
        using var harness = new Harness(Guid.NewGuid());

        var result = await harness.Service.SetAmbientPolicyAsync(Request("review", actingHumanId: null));

        result.Outcome.Should().Be(EngineReviewOutcome.Invalid, "COR-018 attribution is required");
    }

    [Fact]
    public async Task Autonomous_WhenNotAuthorized_Is400_WithTheGovernanceMessage_AndChangesNothing()
    {
        var exerciseId = Guid.NewGuid();
        using var harness = new Harness(exerciseId, authorized: false);

        var result = await harness.Service.SetAmbientPolicyAsync(Request("autonomous"));

        result.Outcome.Should().Be(EngineReviewOutcome.Invalid);
        result.ValidationError.Should().Contain("not authorized by PROVIDER-GOVERNANCE §8");
        harness.Ambient.Get(exerciseId).Mode.Should().Be(AmbientPolicyMode.Off);
        (await harness.EventsAsync(exerciseId)).Should().BeEmpty("a rejected change is not an audited change");
    }

    [Fact]
    public async Task Review_IsSet_Live_AndReturnsTheFullSnapshot_WithOneAuditEvent()
    {
        var exerciseId = Guid.NewGuid();
        using var harness = new Harness(exerciseId);
        var persona = await harness.SeedPersonaAsync(exerciseId);

        var result = await harness.Service.SetAmbientPolicyAsync(Request("review", personas: [persona.ToString()]));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        var dto = result.Settings!.AmbientPolicy;
        dto.Mode.Should().Be(AmbientPolicyMode.Review);
        dto.MaxPerMinute.Should().Be(4);
        dto.MaxPerHour.Should().Be(40);
        dto.TopicAllowList.Should().Equal("food", "sports");
        dto.PersonaAllowList.Should().Equal(persona.ToString());
        dto.TopicVocabulary.Should().Equal(AmbientTopics.Vocabulary);
        result.Settings.InMemoryStateNote.Should().Contain("ambient-chatter policy").And.Contain("off");

        harness.Ambient.Get(exerciseId).Mode.Should().Be(AmbientPolicyMode.Review, "the POST writes the singleton the loop reads");

        var events = await harness.EventsAsync(exerciseId);
        var audit = events.Should().ContainSingle().Subject;
        audit.EventType.Should().Be(EngineEventTypes.TierPolicyChanged, "the #353 steering-change type is reused, not forked");
        audit.Actor.ActingHumanId.Should().Be("controller-7");
        using var payload = JsonDocument.Parse(audit.Payload!);
        payload.RootElement.GetProperty("policy").GetString().Should().Be("ambient");
        payload.RootElement.GetProperty("fromMode").GetString().Should().Be("off");
        payload.RootElement.GetProperty("toMode").GetString().Should().Be("review");
        payload.RootElement.GetProperty("reason").GetString().Should().Be("controller");
    }

    [Fact]
    public async Task APersonaFromAnotherExercise_IsRejected_AndNothingChanges()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        using var harness = new Harness(exerciseA);
        var foreign = await harness.SeedPersonaAsync(exerciseB);

        var result = await harness.Service.SetAmbientPolicyAsync(Request("review", personas: [foreign.ToString()]));

        result.Outcome.Should().Be(EngineReviewOutcome.Invalid, "only personas of THIS exercise may be allow-listed (AC1/AC3)");
        result.ValidationError.Should().Contain("not a persona of this exercise");
        harness.Ambient.Get(exerciseA).Mode.Should().Be(AmbientPolicyMode.Off);
        harness.Ambient.Get(exerciseB).Mode.Should().Be(AmbientPolicyMode.Off);
    }

    [Fact]
    public async Task AnUnknownPersonaId_IsRejected()
    {
        using var harness = new Harness(Guid.NewGuid());

        var result = await harness.Service.SetAmbientPolicyAsync(Request("review", personas: [Guid.NewGuid().ToString()]));

        result.Outcome.Should().Be(EngineReviewOutcome.Invalid);
    }

    [Fact]
    public async Task ACapAboveMaxEnginePostsPerMinute_Is400()
    {
        using var harness = new Harness(Guid.NewGuid());

        var result = await harness.Service.SetAmbientPolicyAsync(Request("review", perMinute: 61));

        result.Outcome.Should().Be(EngineReviewOutcome.Invalid);
        result.ValidationError.Should().Contain("MaxEnginePostsPerMinute");
    }

    [Fact]
    public async Task GetSettings_CarriesTheAmbientPolicyField_DefaultOff()
    {
        using var harness = new Harness(Guid.NewGuid());

        var result = await harness.Service.GetSettingsAsync();

        result.Settings!.AmbientPolicy.Mode.Should().Be(AmbientPolicyMode.Off);
        result.Settings.AmbientPolicy.AutonomousAuthorized.Should().BeTrue("this harness authorises it");
    }

    [Theory]
    [InlineData(KillSwitchMode.FullStop)]
    [InlineData(KillSwitchMode.DropToSuggest)]
    public async Task TheKillSwitch_LowersAutonomousAmbientToOff_AndRestoreNeverReRaisesIt(KillSwitchMode mode)
    {
        var exerciseId = Guid.NewGuid();
        using var harness = new Harness(exerciseId);
        (await harness.Service.SetAmbientPolicyAsync(Request("autonomous"))).Outcome.Should().Be(EngineReviewOutcome.Ok);

        await harness.Service.EngageKillSwitchAsync(mode, new EngineReviewActionInput("lead-1", "UTC"));
        harness.Ambient.Get(exerciseId).Mode.Should().Be(AmbientPolicyMode.Off, "the kill switch lowers ambient at once (AC6)");

        await harness.Service.RestoreFromSafetyAsync(new EngineReviewActionInput("lead-1", "UTC"));
        harness.Ambient.Get(exerciseId).Mode.Should().Be(AmbientPolicyMode.Off, "restoring the engine never re-raises ambient");

        var lowered = (await harness.EventsAsync(exerciseId)).Last();
        using var payload = JsonDocument.Parse(lowered.Payload!);
        payload.RootElement.GetProperty("reason").GetString().Should().Be("safety-clamp");
        lowered.Actor.ActingHumanId.Should().Be("lead-1", "the controller who pulled the lever is on the record");
    }

    [Fact]
    public async Task TheCutToFake_LowersAutonomousAmbientToOff()
    {
        var exerciseId = Guid.NewGuid();
        using var harness = new Harness(exerciseId);
        await harness.Service.SetAmbientPolicyAsync(Request("autonomous"));

        await harness.Service.CutGenerationToFakeAsync(new EngineReviewActionInput("lead-1", "UTC"));

        harness.Ambient.Get(exerciseId).Mode.Should().Be(AmbientPolicyMode.Off);
    }

    [Theory]
    [InlineData(KillSwitchMode.FullStop)]
    [InlineData(KillSwitchMode.DropToSuggest)]
    public async Task Autonomous_WhileTheKillSwitchIsEngaged_Is400_AndChangesNothing(KillSwitchMode mode)
    {
        // Gate-1 L-1: a stopped engine must be restored first; selecting autonomous is rejected, not silently demoted.
        var exerciseId = Guid.NewGuid();
        using var harness = new Harness(exerciseId);
        await harness.Service.EngageKillSwitchAsync(mode, new EngineReviewActionInput("lead-1", "UTC"));
        var eventsBefore = (await harness.EventsAsync(exerciseId)).Count;

        var result = await harness.Service.SetAmbientPolicyAsync(Request("autonomous"));

        result.Outcome.Should().Be(EngineReviewOutcome.Invalid);
        result.ValidationError.Should().Be("engine is stopped or cut to Fake — restore it before enabling autonomous ambient");
        harness.Ambient.Get(exerciseId).Mode.Should().Be(AmbientPolicyMode.Off);
        (await harness.EventsAsync(exerciseId)).Should().HaveCount(eventsBefore, "a rejected change is not an audited change");

        (await harness.Service.SetAmbientPolicyAsync(Request("review"))).Outcome.Should().Be(
            EngineReviewOutcome.Ok, "review drafts still wait for a human, so review mode stays selectable");
    }

    [Fact]
    public async Task Autonomous_WhileCutToFake_Is400_AndIsAcceptedAgainAfterRestore()
    {
        var exerciseId = Guid.NewGuid();
        using var harness = new Harness(exerciseId);
        await harness.Service.CutGenerationToFakeAsync(new EngineReviewActionInput("lead-1", "UTC"));

        var rejected = await harness.Service.SetAmbientPolicyAsync(Request("autonomous"));

        rejected.Outcome.Should().Be(EngineReviewOutcome.Invalid);
        rejected.ValidationError.Should().Contain("restore it before enabling autonomous ambient");
        harness.Ambient.Get(exerciseId).Mode.Should().Be(AmbientPolicyMode.Off);

        await harness.Service.RestoreGenerationProviderAsync(new EngineReviewActionInput("lead-1", "UTC"));
        (await harness.Service.SetAmbientPolicyAsync(Request("autonomous"))).Outcome.Should().Be(
            EngineReviewOutcome.Ok, "once restored, a human may select autonomous again");
    }

    [Fact]
    public async Task TheKillSwitch_LeavesReviewModeAlone()
    {
        var exerciseId = Guid.NewGuid();
        using var harness = new Harness(exerciseId);
        await harness.Service.SetAmbientPolicyAsync(Request("review"));

        await harness.Service.EngageKillSwitchAsync(KillSwitchMode.DropToSuggest, new EngineReviewActionInput("lead-1", "UTC"));

        harness.Ambient.Get(exerciseId).Mode.Should().Be(AmbientPolicyMode.Review, "review drafts already wait for a human");
    }

    private static EngineAmbientPolicyRequest Request(
        string mode,
        string? actingHumanId = "controller-7",
        int? perMinute = 4,
        IReadOnlyList<string>? personas = null) => new()
        {
            ActingHumanId = actingHumanId,
            Mode = mode,
            MaxPerMinute = perMinute,
            MaxPerHour = 40,
            TopicAllowList = ["food", "sports"],
            PersonaAllowList = personas,
            TimeZone = "UTC",
        };

    private sealed class Harness : IDisposable
    {
        private readonly string _dbName = $"ambient-svc-{Guid.NewGuid():N}";
        private readonly PulseDbContext _db;

        public Harness(Guid? currentExerciseId, bool authorized = true)
        {
            var context = new ExerciseContext { CurrentExerciseId = currentExerciseId };
            _db = new PulseDbContext(Options(), context);
            var clock = new ExerciseClockService(new ManualTimeProvider(ScenarioStart));
            if (currentExerciseId is { } id)
            {
                clock.Start(id, ScenarioStart, TimeZoneInfo.Utc);
            }

            Ambient = new EngineAmbientPolicyRegistry(
                Microsoft.Extensions.Options.Options.Create(new EngineAmbientGovernanceOptions { AmbientAutonomyAuthorized = authorized }));
            Service = new EngineReviewService(
                new EngineReviewStore(_db),
                _db,
                context,
                clock,
                new EngineTelemetryEmitter(),
                Mock.Of<IEnginePublishService>(),
                Mock.Of<IEngineReviewBroadcaster>(),
                new EngineAutonomyRegistry(),
                new EngineTierPolicyRegistry(),
                new ClaudeNamedProvider(),
                Microsoft.Extensions.Options.Options.Create(new GenerationOptions()),
                new GenerationProviderCutRegistry(),
                NullLogger<EngineReviewService>.Instance,
                Ambient);
        }

        public EngineReviewService Service { get; }

        public EngineAmbientPolicyRegistry Ambient { get; }

        public async Task<Guid> SeedPersonaAsync(Guid exerciseId)
        {
            var id = Guid.NewGuid();
            await using var seed = new PulseDbContext(Options(), new ExerciseContext { CurrentExerciseId = exerciseId });
            seed.Personas.Add(new Persona
            {
                Id = id,
                ExerciseId = exerciseId,
                DisplayName = "Rosa",
                Handle = $"@rosa{id:N}"[..12],
                Kind = "npc",
            });
            await seed.SaveChangesAsync();
            return id;
        }

        public async Task<List<TelemetryEvent>> EventsAsync(Guid exerciseId)
        {
            await using var read = new PulseDbContext(Options(), new ExerciseContext { CurrentExerciseId = exerciseId });
            return await read.TelemetryEvents.ToListAsync();
        }

        public void Dispose() => _db.Dispose();

        private DbContextOptions<PulseDbContext> Options() =>
            new DbContextOptionsBuilder<PulseDbContext>().UseInMemoryDatabase(_dbName).Options;
    }

    /// <summary>A non-Fake provider NAME, so the cut-to-Fake lever really cuts (it is a no-op when already Fake).</summary>
    private sealed class ClaudeNamedProvider : IGenerationProvider
    {
        public string Name => "ClaudeFoundry";

        public GenerationGovernance Governance => GenerationGovernance.InProcess;

        public Task<GenerationResult> GenerateAsync(GenerationRequest request, System.Threading.CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("never called by the settings path");
    }
}
