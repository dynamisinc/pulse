namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Xunit;

/// <summary>
/// Pins the engine XC-004 event-type TAXONOMY OF RECORD (<c>engine-telemetry-tuning/01</c>, #173; E8
/// architecture §11) — the vocabulary itself, as distinct from the per-stage emission tests
/// (<c>ReactionLoopHostTests</c>, <c>MeasureStageTests</c>, <c>EnginePublishServiceTests</c>,
/// <c>EngineReviewServiceTests</c>/<c>EngineReviewSafetyInvariantTests</c>, <c>EngineSettingsServiceTests</c>,
/// <c>EngineContentSeedServiceTests</c>) which prove each event actually FIRES.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a taxonomy suite exists at all.</b> Three of this story's guarantees are otherwise only comments:
/// the v1.1 <c>rumor.*</c> family is "reserved", the six <c>engine.reviewed</c> actions are "frozen", and the
/// whole set is "additive to the locked v0 envelope". A comment cannot fail. These tests read the constants by
/// REFLECTION and assert the EXACT set, so adding, renaming, or quietly dropping an engine event type — or
/// re-declaring one as a private literal in some other slice instead — breaks the gate and forces the change
/// to be a deliberate one.
/// </para>
/// <para>Model-only: no DB, no host, so <c>[Fact]</c> (not <c>[RequiresDockerFact]</c>).</para>
/// </remarks>
public class EngineEventTaxonomyTests
{
    /// <summary>
    /// The ratified engine event-type set (E8 §11 + the additive runtime/ops/client additions #173 ratifies).
    /// Deliberately hand-written rather than derived from the constants: a pin that read its expectation off
    /// the thing it is pinning would pass for any vocabulary at all.
    /// </summary>
    private static readonly string[] RatifiedEventTypes =
    [
        "engine.observed",
        "engine.decided",
        "engine.generated",
        "engine.reviewed",
        "engine.published",
        "engine.measured",
        "storyline.state_changed",
        "engine.autonomy_default_changed",
        "engine.tier_policy_changed",
        "engine.provider_changed",
        "engine.content_seeded",
        "engine.autonomy_changed",
    ];

    /// <summary>The v1.1 rumor-lineage family reserved by AC5 — reserved now, emitted by nothing in v1.</summary>
    private static readonly string[] ReservedRumorEventTypes =
    [
        "rumor.seeded",
        "rumor.mutated",
        "rumor.spread",
        "rumor.countered",
        "rumor.killed",
    ];

    /// <summary>The six frozen <c>engine.reviewed</c> action wire literals (AC4), including the timer-driven pair.</summary>
    private static readonly string[] FrozenReviewActionLiterals =
    [
        "approve",
        "edit",
        "veto",
        "re-roll",
        "hold-on-expiry",
        "auto-send",
    ];

    // ==== AC1 / AC3 — the vocabulary of record =========================================================

    [Fact]
    public void Taxonomy_DeclaresExactlyTheRatifiedEngineEventTypes()
    {
        var declared = StringConstantsOf(typeof(EngineEventTypes));

        declared.Should().BeEquivalentTo(
            RatifiedEventTypes,
            "EngineEventTypes is the taxonomy of record (#173): an engine event type that is not named here "
            + "is invisible to E10 metrics and E9's INT-031 stream, and one named here that nothing ratified "
            + "is a vocabulary nobody agreed to");
    }

    [Fact]
    public void Taxonomy_EveryEventTypeName_IsANamespacedLowerSnakeLiteral()
    {
        var all = StringConstantsOf(typeof(EngineEventTypes))
            .Concat(StringConstantsOf(typeof(EngineEventTypes.Rumor)))
            .ToList();

        all.Should().OnlyContain(
            name => name.StartsWith("engine.", StringComparison.Ordinal)
                || name.StartsWith("storyline.", StringComparison.Ordinal)
                || name.StartsWith("rumor.", StringComparison.Ordinal),
            "every engine event type is prefixed by the thing it happened to, so a consumer can filter the "
            + "engine's events out of the shared v0 log with a prefix match");

        all.Should().OnlyContain(
            name => name == name.ToLowerInvariant() && !name.Contains(' ', StringComparison.Ordinal),
            "the wire vocabulary is lower_snake within its prefix — a casing drift is a silently-missed filter");
    }

    [Fact]
    public void Taxonomy_IsAdditiveToTheLockedV0Envelope_NoEventTypeTripsAConditionalRule()
    {
        // AC3: engine events EXTEND the v0 taxonomy rather than forking it. Two things make that true, and
        // both are asserted here: eventType has no allowlist (TelemetryEnvelopeRules never inspects the name
        // except for the two view kinds), and the engine actor carries no conditionally-required id. So a new
        // engine event type — including a v1.1 rumor one — needs no envelope change and no EF migration.
        foreach (var eventType in RatifiedEventTypes.Concat(ReservedRumorEventTypes))
        {
            var errors = TelemetryEnvelopeRules.Validate(new TelemetryAttributionFacts(
                ActorPresent: true,
                ActorKind: "engine",
                ParticipantId: null,
                PersonaId: null,
                ActingHumanId: "human-controller-1",
                SessionId: null,
                EventType: eventType,
                Origin: "engine",
                InjectId: null));

            errors.Should().BeEmpty(
                "{0} must ride the UNCHANGED v0 envelope — a rejection here would mean the engine taxonomy "
                + "forked the schema, which is a cross-phase migration (adversarial review D2)",
                eventType);
        }
    }

    // ==== AC2 — every engine event carries wall + scenario time, actor, channel =========================

    [Fact]
    public void EveryEngineEventType_CarriesWallAndScenarioTimeActorAndChannel()
    {
        var emitter = new EngineTelemetryEmitter();
        var exerciseId = Guid.NewGuid();
        var wallClock = new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero);
        var scenarioTime = new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5));

        foreach (var eventType in RatifiedEventTypes.Concat(ReservedRumorEventTypes))
        {
            var telemetry = emitter.BuildEvent(
                eventType,
                new EngineTelemetryContext
                {
                    ExerciseId = exerciseId,
                    WallClockTime = wallClock,
                    ScenarioTime = scenarioTime,
                    TimeZone = "America/Chicago",
                    Channel = "social",
                    // COR-018: the individual human behind a shared org/controller account.
                    Actor = new EngineTelemetryActor { Kind = "engine", ActingHumanId = "human-controller-1" },
                });

            telemetry.EventType.Should().Be(eventType);
            telemetry.SchemaVersion.Should().Be("v0", "{0} extends the v0 envelope", eventType);
            telemetry.ExerciseId.Should().Be(exerciseId, "{0} is exercise-scoped (COR-001)", eventType);
            telemetry.WallClockTime.Should().Be(wallClock, "{0} carries wall-clock time (ADP-041)", eventType);
            telemetry.ScenarioTime.Should().Be(scenarioTime, "{0} carries scenario time (COR-053)", eventType);
            telemetry.TimeZone.Should().Be("America/Chicago", "{0} carries the exercise zone (XC-008)", eventType);
            telemetry.Channel.Should().Be("social", "{0} carries its channel (XC-004)", eventType);
            telemetry.Actor.Kind.Should().Be("engine", "{0} carries an actor", eventType);
            telemetry.Actor.ActingHumanId.Should().Be(
                "human-controller-1", "{0} carries the human behind a shared account (COR-018)", eventType);
        }
    }

    // ==== AC4 — the six review actions are representable and frozen ====================================

    [Fact]
    public void ReviewActions_AreExactlyTheSixFrozenWireLiterals()
    {
        var emitter = new EngineTelemetryEmitter();
        var actions = Enum.GetValues<EngineReviewAction>();

        actions.Should().HaveCount(
            FrozenReviewActionLiterals.Length,
            "AC4 fixes the review-action vocabulary at approve/edit/veto/re-roll/hold-on-expiry/auto-send; a "
            + "seventh action is a taxonomy change, not an implementation detail");

        var serialized = actions
            .Select(action => SerializedReviewAction(emitter, action))
            .ToList();

        serialized.Should().BeEquivalentTo(
            FrozenReviewActionLiterals,
            "the reviewed action literals are frozen — hold-on-expiry and auto-send especially, since they are "
            + "TIMER-driven (nobody clicks them) and are the audit trail for 'silence is never approval'");
        serialized.Should().OnlyHaveUniqueItems("two actions collapsing to one literal would erase a decision");
    }

    // ==== AC5 — the v1.1 rumor family + lineage slots are RESERVED =====================================

    [Fact]
    public void Taxonomy_ReservesExactlyTheFiveV11RumorLineageEventTypes()
    {
        var declared = StringConstantsOf(typeof(EngineEventTypes.Rumor));

        declared.Should().BeEquivalentTo(
            ReservedRumorEventTypes,
            "AC5: the rumor.* family is reserved NOW (architecture §10/§11 + the §14 schema-now note) so the "
            + "v1.1 rumor-model needs no envelope migration — and reserved means pinned, not commented");
    }

    [Fact]
    public void ReservedRumorEventTypes_AreEmittedByNothingInV1()
    {
        // A reservation that something already emits is not a reservation. Nothing in v1 may produce these,
        // and this test is the tripwire if a later feature starts emitting one before rumor-model lands.
        var emittedByV1 = StringConstantsOf(typeof(EngineEventTypes));

        emittedByV1.Should().NotIntersectWith(
            ReservedRumorEventTypes,
            "the rumor.* names live ONLY on the reserved nested family in v1; promoting one to the emitted set "
            + "is the v1.1 rumor-model's decision to make");
    }

    [Fact]
    public void PublishedPayload_ReservedLineageSlots_AreNullOmittedWhenUnsetInV1()
    {
        var emitter = new EngineTelemetryEmitter();
        var payload = new EngineEventPayloads.Published
        {
            PostRef = Guid.NewGuid().ToString(),
            Origin = "engine",
            Storyline = Guid.NewGuid().ToString(),
        };

        var telemetry = emitter.BuildEvent(EngineEventTypes.Published, ContextFor(Guid.NewGuid()), payload);

        using var doc = JsonDocument.Parse(telemetry.Payload!);
        doc.RootElement.TryGetProperty("rumorRef", out _).Should().BeFalse(
            "an unused reserved slot is OMITTED, not emitted as null — the v0 envelope's off-envelope-empty rule");
        doc.RootElement.TryGetProperty("mutationOf", out _).Should().BeFalse(
            "an unused reserved slot is OMITTED, not emitted as null");
    }

    [Fact]
    public void PublishedPayload_ReservedLineageSlots_CarryLineageWhenSet_NoMigrationNeeded()
    {
        var emitter = new EngineTelemetryEmitter();
        var rumorRef = Guid.NewGuid().ToString();
        var parentPost = Guid.NewGuid().ToString();

        var telemetry = emitter.BuildEvent(
            EngineEventTypes.Published,
            ContextFor(Guid.NewGuid()),
            new EngineEventPayloads.Published
            {
                PostRef = Guid.NewGuid().ToString(),
                Origin = "engine",
                Storyline = Guid.NewGuid().ToString(),
                RumorRef = rumorRef,
                MutationOf = parentPost,
            });

        using var doc = JsonDocument.Parse(telemetry.Payload!);
        doc.RootElement.GetProperty("rumorRef").GetString().Should().Be(
            rumorRef,
            "AC5: when v1.1 rumor lineage lands it writes into THIS reserved slot — the payload column is "
            + "opaque nvarchar(max), so carrying it needs no EF migration");
        doc.RootElement.GetProperty("mutationOf").GetString().Should().Be(parentPost);
    }

    // ==== Ratification of engine.provider_changed (autonomy-safety/07 AC8) =============================

    [Fact]
    public void ProviderChangedPayload_RatifiedShape_IsFromToPlusReasonDiscriminator()
    {
        var emitter = new EngineTelemetryEmitter();

        var telemetry = emitter.BuildEvent(
            EngineEventTypes.ProviderChanged,
            ContextFor(Guid.NewGuid()),
            new EngineEventPayloads.ProviderChanged
            {
                FromProvider = "AzureOpenAI",
                ToProvider = "Fake",
                Reason = EngineEventPayloads.ProviderChanged.ReasonCut,
                ScenarioMinute = 42,
            });

        telemetry.EventType.Should().Be(
            "engine.provider_changed",
            "#173 ratifies story 07's name AS BUILT — a rename would be a coordinated change to an already-"
            + "emitting slice, not a local one");

        using var doc = JsonDocument.Parse(telemetry.Payload!);
        var root = doc.RootElement;
        root.GetProperty("fromProvider").GetString().Should().Be("AzureOpenAI");
        root.GetProperty("toProvider").GetString().Should().Be("Fake");
        root.GetProperty("scenarioMinute").GetInt32().Should().Be(42);
        root.GetProperty("reason").GetString().Should().Be(
            "cut",
            "ONE event type carries both directions of the egress lever via the reason discriminator, rather "
            + "than a cut/restore PAIR — the ratified shape");
    }

    [Fact]
    public void ProviderChangedPayload_ReasonDiscriminator_IsExactlyCutOrRestore()
    {
        EngineEventPayloads.ProviderChanged.ReasonCut.Should().Be("cut");
        EngineEventPayloads.ProviderChanged.ReasonRestore.Should().Be("restore");

        StringConstantsOf(typeof(EngineEventPayloads.ProviderChanged)).Should().BeEquivalentTo(
            ["cut", "restore"],
            "a third reason means a third way the effective provider can move, which is a safety-relevant "
            + "addition (NFR-005 egress) and must be a deliberate one");
    }

    // ==== helpers ======================================================================================

    /// <summary>The public string constants declared directly on <paramref name="type"/> (not nested types).</summary>
    private static IReadOnlyList<string> StringConstantsOf(Type type) =>
        [.. type
            .GetFields(BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly)
            .Where(field => field is { IsLiteral: true, IsInitOnly: false } && field.FieldType == typeof(string))
            .Select(field => (string)field.GetRawConstantValue()!)];

    /// <summary>Serializes one review action through the real emitter and reads back its payload wire literal.</summary>
    private static string SerializedReviewAction(EngineTelemetryEmitter emitter, EngineReviewAction action)
    {
        var telemetry = emitter.BuildEvent(
            EngineEventTypes.Reviewed,
            ContextFor(Guid.NewGuid()),
            new EngineEventPayloads.Reviewed
            {
                Storyline = Guid.NewGuid().ToString(),
                DraftId = Guid.NewGuid().ToString(),
                Action = action,
            });

        using var doc = JsonDocument.Parse(telemetry.Payload!);
        return doc.RootElement.GetProperty("action").GetString()!;
    }

    /// <summary>A server-authoritative envelope context for the taxonomy pins (fixed times; no client input).</summary>
    private static EngineTelemetryContext ContextFor(Guid exerciseId) => new()
    {
        ExerciseId = exerciseId,
        WallClockTime = new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero),
        ScenarioTime = new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5)),
        TimeZone = "America/Chicago",
    };
}
