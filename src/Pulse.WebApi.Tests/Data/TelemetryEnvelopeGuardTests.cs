namespace Pulse.WebApi.Tests.Data;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Tests for the write-time telemetry-envelope guard (#356) — the second half of
/// <c>PulseDbContext.SaveChanges</c>'s fail-closed pair, alongside <see cref="WriteGuardTests"/>'s
/// exercise-scope guard.
/// </summary>
/// <remarks>
/// <para>
/// <b>The gap this closes.</b> <c>POST /api/telemetry</c> re-enforces every v0 conditional-requiredness rule
/// server-side, but the identity/engine services add <see cref="TelemetryEvent"/> rows DIRECTLY to the
/// context, bypassing it — so an internal emitter could persist a row the public endpoint rejects with a 400.
/// That shipped: a failed participant login wrote <c>actor.kind: 'participant'</c> with no
/// <c>participantId</c>, and one such row is in the UAT database.
/// </para>
/// <para>
/// Each negative test asserts BOTH halves of fail-closed — the throw AND zero rows in real SQL Server, read
/// back through a SEPARATE context so the change tracker can't mask a write that never happened. The
/// exhaustive per-rule coverage is the Docker-free <c>Telemetry/TelemetryEnvelopeRulesTests</c>; this file
/// proves the DB-level WIRING.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class TelemetryEnvelopeGuardTests
{
    private readonly MsSqlContainerFixture _fixture;

    public TelemetryEnvelopeGuardTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    private static TelemetryEvent BuildEvent(
        string eventId,
        Guid exerciseId,
        TelemetryActor actor,
        string eventType = "login",
        string channel = "system") => new()
        {
            EventId = eventId,
            SchemaVersion = "v0",
            ExerciseId = exerciseId,
            EventType = eventType,
            Channel = channel,
            Actor = actor,
            WallClockTime = DateTimeOffset.UtcNow,
            ScenarioTime = DateTimeOffset.UtcNow,
            TimeZone = "America/Chicago",
            EmittedAt = DateTimeOffset.UtcNow,
        };

    private async Task<int> CountPersistedAsync(string eventId)
    {
        await using var verifyContext = _fixture.CreateContext();
        // IgnoreQueryFilters: assert PHYSICAL persistence, so the read-side exercise filter can never mask a
        // row and make the assertion pass for the wrong reason.
        return await verifyContext.TelemetryEvents.IgnoreQueryFilters().CountAsync(e => e.EventId == eventId);
    }

    [RequiresDockerFact]
    public async Task SaveChangesAsync_RejectsParticipantKindWithoutParticipantId_AndWritesNoRow()
    {
        var eventId = Guid.NewGuid().ToString();

        await using var writeContext = _fixture.CreateContext();
        writeContext.TelemetryEvents.Add(BuildEvent(
            eventId,
            Guid.NewGuid(),
            new TelemetryActor { Kind = "participant" }));

        var act = async () => await writeContext.SaveChangesAsync();

        (await act.Should().ThrowAsync<TelemetryEnvelopeViolationException>(
            "this is the exact #356 shape — the v0 envelope requires participantId when kind is 'participant', "
            + "and POST /api/telemetry rejects it with a 400"))
            .Which.Message.Should().Contain("actor.participantId is required");

        (await CountPersistedAsync(eventId)).Should().Be(
            0, "the rejected TelemetryEvent must never have reached the database");
    }

    [RequiresDockerFact]
    public async Task SaveChangesAsync_RejectsPersonaKindWithoutPersonaId_AndWritesNoRow()
    {
        var eventId = Guid.NewGuid().ToString();

        await using var writeContext = _fixture.CreateContext();
        writeContext.TelemetryEvents.Add(BuildEvent(
            eventId,
            Guid.NewGuid(),
            new TelemetryActor { Kind = "persona" },
            eventType: "post",
            channel: "social"));

        var act = async () => await writeContext.SaveChangesAsync();

        await act.Should().ThrowAsync<TelemetryEnvelopeViolationException>(
            "the guard covers every conditional rule, not just the participant one");

        (await CountPersistedAsync(eventId)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task SaveChangesAsync_AcceptsIdentitylessAttemptAsSystemKind()
    {
        // The fixed shape from ParticipantLoginService's failure path: no participant was resolved, so the
        // actor is the SYSTEM recording an identity-less attempt. This must still persist — the guard rejects
        // off-envelope rows, not failure telemetry.
        var eventId = Guid.NewGuid().ToString();
        var exerciseId = Guid.NewGuid();

        await using var writeContext = _fixture.CreateContext();
        writeContext.Exercises.Add(new Exercise { OrganizationId = Organization.DefaultOrganizationId, Id = exerciseId, Name = "Envelope Guard Positive Control" });
        writeContext.TelemetryEvents.Add(BuildEvent(
            eventId,
            exerciseId,
            new TelemetryActor { Kind = "system" }));

        await writeContext.SaveChangesAsync();

        (await CountPersistedAsync(eventId)).Should().Be(
            1, "a conformant identity-less failure event must persist — the guard is not rejecting everything");
    }

    [RequiresDockerFact]
    public async Task SaveChangesAsync_AcceptsParticipantKindWithParticipantId()
    {
        // The success path's shape: a resolved account, so the participant kind is correct AND attributed.
        var eventId = Guid.NewGuid().ToString();
        var exerciseId = Guid.NewGuid();

        await using var writeContext = _fixture.CreateContext();
        writeContext.Exercises.Add(new Exercise { OrganizationId = Organization.DefaultOrganizationId, Id = exerciseId, Name = "Envelope Guard Attributed Control" });
        writeContext.TelemetryEvents.Add(BuildEvent(
            eventId,
            exerciseId,
            new TelemetryActor { Kind = "participant", ParticipantId = Guid.NewGuid().ToString() }));

        await writeContext.SaveChangesAsync();

        (await CountPersistedAsync(eventId)).Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task SaveChangesAsync_RejectsWholeBatch_WhenOneTelemetryEventIsOffEnvelope()
    {
        // The guard runs before base.SaveChangesAsync, so a single bad row sinks the unit of work it shares
        // with its business mutation — telemetry and the action it records commit together or not at all.
        var conformantId = Guid.NewGuid().ToString();
        var offEnvelopeId = Guid.NewGuid().ToString();
        var exerciseId = Guid.NewGuid();

        await using var writeContext = _fixture.CreateContext();
        writeContext.Exercises.Add(new Exercise { OrganizationId = Organization.DefaultOrganizationId, Id = exerciseId, Name = "Envelope Guard Batch" });
        writeContext.TelemetryEvents.Add(BuildEvent(
            conformantId, exerciseId, new TelemetryActor { Kind = "system" }));
        writeContext.TelemetryEvents.Add(BuildEvent(
            offEnvelopeId, exerciseId, new TelemetryActor { Kind = "participant" }));

        var act = async () => await writeContext.SaveChangesAsync();

        await act.Should().ThrowAsync<TelemetryEnvelopeViolationException>();

        (await CountPersistedAsync(conformantId)).Should().Be(
            0, "the otherwise-valid event in the same batch must not be written either");
        (await CountPersistedAsync(offEnvelopeId)).Should().Be(0);
    }
}
