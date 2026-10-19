namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Data.Common;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.Enrollments;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// #618 review C2 / W1: the production <see cref="EngineSteeringLeverRecorder"/> writes the event + audit in its OWN scope
/// and NEVER throws — not when the exercise read fails, not when the save fails, not when the exercise is missing. Real
/// SQL, so <see cref="RequiresDockerFactAttribute"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class EngineSteeringLeverRecorderTests
{
    private readonly MsSqlContainerFixture _fixture;

    public EngineSteeringLeverRecorderTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Record_WritesOneEventAndOneAudit_ForTheExercise_WithTheGivenScenarioTimeAndActor()
    {
        var exerciseId = await SeedExerciseAsync();
        var person = Guid.NewGuid();
        var session = Guid.NewGuid();
        var scenario = new DateTimeOffset(2033, 6, 14, 9, 37, 0, TimeSpan.Zero);
        await using var provider = Provider();

        await new EngineSteeringLeverRecorder(provider.GetRequiredService<IServiceScopeFactory>())
            .RecordAsync(Record(exerciseId, new StaffChangeActor(person, null, session), scenario));

        await using var verify = _fixture.CreateContext();
        var recorded = await verify.TelemetryEvents.IgnoreQueryFilters().SingleAsync(e => e.ExerciseId == exerciseId);
        recorded.EventType.Should().Be(EngineSteeringLeverRecords.KillSwitchEngagedEventType);
        recorded.ScenarioTime.Should().Be(scenario);
        recorded.Actor.ActingHumanId.Should().Be(person.ToString());
        recorded.Actor.SessionId.Should().Be(session.ToString());
        recorded.Actor.Role.Should().BeNull("an unknown role is omitted, never invented (S2)");
        var audit = await verify.OrgAuditEvents.IgnoreQueryFilters().SingleAsync(a => a.ExerciseId == exerciseId);
        audit.ActorPersonId.Should().Be(person);
        audit.OrganizationId.Should().Be(Organization.DefaultOrganizationId);
    }

    [RequiresDockerFact]
    public async Task Record_WhenTheExerciseReadFails_NeverThrows_AndWritesNothing()
    {
        var exerciseId = await SeedExerciseAsync();
        await using var provider = Provider(new FailingReaderInterceptor());

        var act = () => new EngineSteeringLeverRecorder(provider.GetRequiredService<IServiceScopeFactory>())
            .RecordAsync(Record(exerciseId, actor: null, scenarioTime: null));

        await act.Should().NotThrowAsync("the lever already applied; its record is best-effort");
        await AssertNothingWrittenAsync(exerciseId);
    }

    [RequiresDockerFact]
    public async Task Record_WhenTheSaveFails_NeverThrows_AndWritesNothing()
    {
        var exerciseId = await SeedExerciseAsync();
        await using var provider = Provider(new FailingSaveInterceptor());

        var act = () => new EngineSteeringLeverRecorder(provider.GetRequiredService<IServiceScopeFactory>())
            .RecordAsync(Record(exerciseId, actor: null, scenarioTime: null));

        await act.Should().NotThrowAsync();
        await AssertNothingWrittenAsync(exerciseId);
    }

    [RequiresDockerFact]
    public async Task Record_ForAMissingExercise_NeverThrows_AndWritesNothing()
    {
        var exerciseId = Guid.NewGuid();
        await using var provider = Provider();

        var act = () => new EngineSteeringLeverRecorder(provider.GetRequiredService<IServiceScopeFactory>())
            .RecordAsync(Record(exerciseId, actor: null, scenarioTime: null));

        await act.Should().NotThrowAsync();
        await AssertNothingWrittenAsync(exerciseId);
    }

    private static EngineSteeringLeverRecord Record(Guid exerciseId, StaffChangeActor? actor, DateTimeOffset? scenarioTime) => new(
        exerciseId,
        actor,
        EngineSteeringLeverRecords.KillSwitchEngagedEventType,
        EngineSteeringLeverRecords.KillSwitchEngagedAuditKind,
        EngineSteeringLeverRecords.KillSwitchPayload(Pulse.Core.Features.Autonomy.Models.KillSwitchMode.FullStop, "running", "stopped", 37),
        scenarioTime,
        DateTimeOffset.UtcNow);

    private ServiceProvider Provider(params IInterceptor[] interceptors) => new ServiceCollection()
        .AddDbContext<PulseDbContext>(o => o.UseSqlServer(_fixture.ConnectionString!).AddInterceptors(interceptors))
        .BuildServiceProvider();

    private async Task<Guid> SeedExerciseAsync()
    {
        var exerciseId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = "Steering Lever Recorder Test Exercise",
            TimeZone = "UTC",
            Status = "active",
        });
        await seed.SaveChangesAsync();
        return exerciseId;
    }

    private async Task AssertNothingWrittenAsync(Guid exerciseId)
    {
        await using var verify = _fixture.CreateContext();
        (await verify.TelemetryEvents.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == exerciseId)).Should().Be(0);
        (await verify.OrgAuditEvents.IgnoreQueryFilters().CountAsync(a => a.ExerciseId == exerciseId)).Should().Be(0);
    }

    /// <summary>Fails every query on the context it is attached to.</summary>
    private sealed class FailingReaderInterceptor : DbCommandInterceptor
    {
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("database unreachable");
    }

    /// <summary>Fails every save on the context it is attached to.</summary>
    private sealed class FailingSaveInterceptor : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("audit store down");
    }
}
