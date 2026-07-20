namespace Pulse.WebApi.Tests.Data;

using System;
using System.Collections.Generic;
using System.Linq;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Story <c>backend-host/02-persistence-efcore</c> (#269) AC3: "the <c>TelemetryEvent</c> entity, when its
/// columns are compared field-by-field to the locked v0 envelope ... every field has a corresponding
/// column." This is model-only (no database round trip needed — <see cref="BuildModelOnlyContext"/> never
/// opens a connection), so it doesn't need the Testcontainers fixture.
/// </summary>
/// <remarks>
/// This enumerates the ACTUAL EF Core model metadata (<c>context.Model.FindEntityType(...)</c> +
/// <c>OwnsOne</c> navigations for <c>Actor</c>/<c>Target</c>) — not just C# property names — and diffs it
/// against the v0 envelope's field list. The only hand-authored part is
/// <see cref="SchemaFieldToEfPropertyPath"/> (the documented manual cross-reference the story explicitly
/// permits); everything else is read live from the model, so a real drift (a renamed or dropped column, or
/// a schema.ts field this test wasn't updated for) fails the test rather than silently passing.
///
/// Cross-reference — <c>telemetryEventV0Schema</c> in
/// <c>src/frontend/src/core/telemetry/schema.ts</c>, transcribed field-by-field:
/// <code>
/// schemaVersion, eventId, exerciseId, eventType, channel,
/// actor: { kind, participantId?, personaId?, actingHumanId?, sessionId?, role? },
/// origin?, injectId?, correlationId?, causationId?, sequence?, source?,
/// wallClockTime, scenarioTime, timeZone,
/// target?: { entityType?, entityId? },
/// payload?, emittedAt
/// </code>
/// = 24 leaf fields (16 top-level/own + 6 <c>actor</c> sub-fields + 2 <c>target</c> sub-fields), matching
/// this story's <c>TelemetryEvent</c>/<c>TelemetryActor</c>/<c>TelemetryTarget</c> doc-comment field map.
/// </remarks>
public class TelemetrySchemaParityTests
{
    /// <summary>
    /// The v0 envelope's leaf field names, transcribed by hand from <c>telemetryEventV0Schema</c>
    /// (schema.ts), dot-notation for the nested <c>actor</c>/<c>target</c> objects.
    /// </summary>
    private static readonly string[] TelemetryEventV0Fields =
    [
        "schemaVersion",
        "eventId",
        "exerciseId",
        "eventType",
        "channel",
        "actor.kind",
        "actor.participantId",
        "actor.personaId",
        "actor.actingHumanId",
        "actor.sessionId",
        "actor.role",
        "origin",
        "injectId",
        "correlationId",
        "causationId",
        "sequence",
        "source",
        "wallClockTime",
        "scenarioTime",
        "timeZone",
        "target.entityType",
        "target.entityId",
        "payload",
        "emittedAt",
    ];

    /// <summary>
    /// Maps each schema.ts field name (camelCase, dot-notation for nested objects) to the EF property path
    /// on <see cref="TelemetryEvent"/> / <see cref="TelemetryActor"/> / <see cref="TelemetryTarget"/>
    /// (PascalCase, per the entity file's own doc-comment field map). The ONLY hand-authored half of this
    /// cross-language diff — the tests below read the rest live from EF model metadata.
    /// </summary>
    private static readonly Dictionary<string, string> SchemaFieldToEfPropertyPath = new(StringComparer.Ordinal)
    {
        ["schemaVersion"] = "SchemaVersion",
        ["eventId"] = "EventId",
        ["exerciseId"] = "ExerciseId",
        ["eventType"] = "EventType",
        ["channel"] = "Channel",
        ["actor.kind"] = "Actor.Kind",
        ["actor.participantId"] = "Actor.ParticipantId",
        ["actor.personaId"] = "Actor.PersonaId",
        ["actor.actingHumanId"] = "Actor.ActingHumanId",
        ["actor.sessionId"] = "Actor.SessionId",
        ["actor.role"] = "Actor.Role",
        ["origin"] = "Origin",
        ["injectId"] = "InjectId",
        ["correlationId"] = "CorrelationId",
        ["causationId"] = "CausationId",
        ["sequence"] = "Sequence",
        ["source"] = "Source",
        ["wallClockTime"] = "WallClockTime",
        ["scenarioTime"] = "ScenarioTime",
        ["timeZone"] = "TimeZone",
        ["target.entityType"] = "Target.EntityType",
        ["target.entityId"] = "Target.EntityId",
        ["payload"] = "Payload",
        ["emittedAt"] = "EmittedAt",
    };

    /// <summary>
    /// Builds a <see cref="PulseDbContext"/> purely to read its built EF model — mirrors
    /// <see cref="PulseDbContextFactory"/>'s design-time placeholder connection string. The connection is
    /// never opened; building <see cref="DbContext.Model"/> does not require a live database.
    /// </summary>
    private static PulseDbContext BuildModelOnlyContext()
    {
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer("Server=localhost;Database=pulse_schema_check;Trusted_Connection=True;TrustServerCertificate=True")
            .Options;
        return new PulseDbContext(options);
    }

    [Fact]
    public void FieldMap_CoversExactlyTheTranscribedV0FieldList()
    {
        SchemaFieldToEfPropertyPath.Keys.Should().BeEquivalentTo(
            TelemetryEventV0Fields,
            "the hand-authored EF property map must cover exactly the transcribed schema.ts field list, with no drift either way");
    }

    [Fact]
    public void EveryTelemetryEventV0Field_HasACorrespondingEfModelProperty()
    {
        using var context = BuildModelOnlyContext();
        var (ownProperties, actorProperties, targetProperties) = GetMappedPropertyNames(context);

        foreach (var field in TelemetryEventV0Fields)
        {
            var efPath = SchemaFieldToEfPropertyPath[field];
            var segments = efPath.Split('.');

            if (segments.Length == 1)
            {
                ownProperties.Should().Contain(segments[0],
                    $"schema.ts field '{field}' must have a corresponding TelemetryEvent column ({segments[0]})");
            }
            else
            {
                var (owner, member) = (segments[0], segments[1]);
                var ownedSet = owner switch
                {
                    "Actor" => actorProperties,
                    "Target" => targetProperties,
                    _ => throw new InvalidOperationException($"Unknown owned-type prefix '{owner}' in field map."),
                };

                ownedSet.Should().Contain(member,
                    $"schema.ts field '{field}' must have a corresponding {owner} sub-column ({member})");
            }
        }
    }

    [Fact]
    public void TelemetryEventEfModel_HasNoUnmappedColumns_BeyondTheV0Envelope()
    {
        using var context = BuildModelOnlyContext();
        var (ownProperties, actorProperties, targetProperties) = GetMappedPropertyNames(context);

        var mappedOwn = SchemaFieldToEfPropertyPath.Values
            .Where(v => !v.Contains('.', StringComparison.Ordinal))
            .ToHashSet(StringComparer.Ordinal);
        var mappedActor = SchemaFieldToEfPropertyPath.Values
            .Where(v => v.StartsWith("Actor.", StringComparison.Ordinal))
            .Select(v => v.Split('.')[1])
            .ToHashSet(StringComparer.Ordinal);
        var mappedTarget = SchemaFieldToEfPropertyPath.Values
            .Where(v => v.StartsWith("Target.", StringComparison.Ordinal))
            .Select(v => v.Split('.')[1])
            .ToHashSet(StringComparer.Ordinal);

        // Equivalence (not just "contains") — this is what catches an EXTRA, unmapped column too, i.e. the
        // entity reinterpreting/adding to the locked v0 envelope rather than mirroring it 1:1.
        ownProperties.Should().BeEquivalentTo(mappedOwn,
            "TelemetryEvent's own EF-mapped columns must be exactly the v0 envelope's top-level fields — no gap, no extra reinterpretation");
        actorProperties.Should().BeEquivalentTo(mappedActor,
            "TelemetryActor's EF-mapped columns must be exactly the v0 envelope's actor sub-fields");
        targetProperties.Should().BeEquivalentTo(mappedTarget,
            "TelemetryTarget's EF-mapped columns must be exactly the v0 envelope's target sub-fields");
    }

    [Fact]
    public void RequiredV0Fields_AreNonNullableEfColumns()
    {
        using var context = BuildModelOnlyContext();
        var entityType = context.Model.FindEntityType(typeof(TelemetryEvent))!;

        // schema.ts marks these non-optional on telemetryEventV0Schema (z.strictObject, no `.optional()`).
        string[] requiredOwnFields =
        [
            "EventId", "ExerciseId", "EventType", "Channel",
            "WallClockTime", "ScenarioTime", "TimeZone", "EmittedAt", "SchemaVersion",
        ];
        foreach (var name in requiredOwnFields)
        {
            var property = entityType.FindProperty(name)!;
            property.IsNullable.Should().BeFalse($"schema.ts marks '{name}' as required, so its column must be NOT NULL");
        }

        var actorNavigation = entityType.FindNavigation(nameof(TelemetryEvent.Actor))!;
        actorNavigation.IsCollection.Should().BeFalse();
        var actorKind = actorNavigation.TargetEntityType.FindProperty(nameof(TelemetryActor.Kind))!;
        actorKind.IsNullable.Should().BeFalse("schema.ts marks actor.kind as required (no .optional())");

        // exerciseId doubles as the isolation scope (COR-001/XC-001) — never optional, and a real Guid, not
        // a nullable/string stand-in that could quietly carry an empty value past the write-guard.
        var exerciseId = entityType.FindProperty(nameof(TelemetryEvent.ExerciseId))!;
        exerciseId.ClrType.Should().Be(typeof(Guid));
        exerciseId.IsNullable.Should().BeFalse();
    }

    private static (HashSet<string> Own, HashSet<string> Actor, HashSet<string> Target) GetMappedPropertyNames(
        PulseDbContext context)
    {
        var entityType = context.Model.FindEntityType(typeof(TelemetryEvent))!;

        var ownProperties = entityType.GetProperties()
            .Select(p => p.Name)
            .ToHashSet(StringComparer.Ordinal);

        var actorNavigation = entityType.FindNavigation(nameof(TelemetryEvent.Actor))!;
        var actorProperties = actorNavigation.TargetEntityType.GetProperties()
            .Where(p => !p.IsShadowProperty())
            .Select(p => p.Name)
            .ToHashSet(StringComparer.Ordinal);

        var targetNavigation = entityType.FindNavigation(nameof(TelemetryEvent.Target))!;
        var targetProperties = targetNavigation.TargetEntityType.GetProperties()
            .Where(p => !p.IsShadowProperty())
            .Select(p => p.Name)
            .ToHashSet(StringComparer.Ordinal);

        return (ownProperties, actorProperties, targetProperties);
    }
}
