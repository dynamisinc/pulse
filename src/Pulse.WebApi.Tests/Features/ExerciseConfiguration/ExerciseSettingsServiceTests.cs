namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Xunit;

/// <summary>
/// Service-level tests for <see cref="ExerciseSettingsService"/> against real SQL Server — the outcomes and
/// invariants that are awkward or unreachable over HTTP: the fail-closed scope check, the
/// resolved-scope-with-no-exercise-row 404 branch, the IDOR case, and XC-004's "the telemetry event shares
/// the mutation's ONE unit of work".
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseSettingsServiceTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ExerciseSettingsServiceTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task GetAsync_UnresolvedScope_FailsClosed_WithoutTouchingTheDatabase()
    {
        var exerciseId = Guid.NewGuid();
        await SeedAsync(exerciseId, e => e.Name = "Should Not Be Visible");

        await using var context = _fixture.CreateContext();
        var service = CreateService(context, currentExerciseId: null);

        var result = await service.GetAsync();

        result.Outcome.Should().Be(
            ExerciseSettingsOutcome.ScopeUnresolved, "no resolved scope is a closed door, never 'all exercises'");
        result.Settings.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task GetAsync_EmptyGuidScope_FailsClosed()
    {
        await using var context = _fixture.CreateContext();
        var service = CreateService(context, Guid.Empty);

        var result = await service.GetAsync();

        result.Outcome.Should().Be(ExerciseSettingsOutcome.ScopeUnresolved);
    }

    [RequiresDockerFact]
    public async Task GetAsync_ResolvedScopeWithNoExerciseRow_ReturnsNotFound_NotAnotherExercisesRow()
    {
        // The IDOR shape: a scope pointing at an exercise that does not exist must produce nothing, not the
        // first row in an unfiltered table (Exercise is NOT IExerciseScoped — the central filter is a no-op here).
        await SeedAsync(Guid.NewGuid(), e => e.Name = "A Different Exercise");

        await using var context = _fixture.CreateContext();
        var service = CreateService(context, Guid.NewGuid());

        var result = await service.GetAsync();

        result.Outcome.Should().Be(ExerciseSettingsOutcome.NotFound);
        result.Settings.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task GetAsync_ResolvedScope_ReturnsOnlyThatExercisesSettings()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await SeedAsync(exerciseA, e =>
        {
            e.Name = "A";
            e.WorldName = "A World";
        });
        await SeedAsync(exerciseB, e =>
        {
            e.Name = "B";
            e.WorldName = "B World";
        });

        await using var context = _fixture.CreateContext();
        var service = CreateService(context, exerciseA);

        var result = await service.GetAsync();

        result.Outcome.Should().Be(ExerciseSettingsOutcome.Ok);
        result.Settings!.Name.Should().Be("A");
        result.Settings.WorldName.Should().Be("A World", "the read is keyed on the resolved scope and nothing else");
    }

    [RequiresDockerFact]
    public async Task UpdateAsync_UnresolvedScope_FailsClosed_AndWritesNothing()
    {
        var exerciseId = Guid.NewGuid();
        await SeedAsync(exerciseId, e => e.Name = "Untouched");

        await using var context = _fixture.CreateContext();
        var service = CreateService(context, currentExerciseId: null);

        var result = await service.UpdateAsync(new UpdateExerciseSettingsRequest { Name = "Renamed", TimeZone = "UTC" });

        result.Outcome.Should().Be(ExerciseSettingsOutcome.ScopeUnresolved);
        (await LoadAsync(exerciseId)).Name.Should().Be("Untouched");
    }

    [RequiresDockerFact]
    public async Task UpdateAsync_ResolvedScopeWithNoExerciseRow_ReturnsNotFound_AndCreatesNothing()
    {
        var missingScope = Guid.NewGuid();

        await using var context = _fixture.CreateContext();
        var service = CreateService(context, missingScope);

        var result = await service.UpdateAsync(new UpdateExerciseSettingsRequest { Name = "Ghost", TimeZone = "UTC" });

        result.Outcome.Should().Be(ExerciseSettingsOutcome.NotFound, "a settings write never creates an exercise");

        await using var verify = _fixture.CreateContext();
        (await verify.Exercises.AnyAsync(e => e.Id == missingScope)).Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task UpdateAsync_InExerciseA_LeavesExerciseBByteForByteUnchanged()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await SeedAsync(exerciseA, e => e.Name = "A");
        await SeedAsync(exerciseB, e =>
        {
            e.Name = "B";
            e.WorldName = "B World";
            e.BrandName = "B Brand";
            e.EnabledChannels = "social,news";
        });

        await using var context = _fixture.CreateContext();
        var service = CreateService(context, exerciseA);

        await service.UpdateAsync(new UpdateExerciseSettingsRequest
        {
            Name = "A Renamed",
            TimeZone = "America/New_York",
            WorldName = "A World",
            BrandName = "A Brand",
            EnabledChannels = ["weather"],
        });

        var b = await LoadAsync(exerciseB);
        b.Name.Should().Be("B");
        b.WorldName.Should().Be("B World");
        b.BrandName.Should().Be("B Brand");
        b.EnabledChannels.Should().Be("social,news");
        b.TimeZone.Should().Be("UTC");
    }

    [RequiresDockerFact]
    public async Task UpdateAsync_PersistsTheMutationAndItsTelemetryEventInExactlyOneSaveChanges()
    {
        // XC-004: the settings mutation and its audit event must reach the database in ONE transaction —
        // never two round trips where one could persist without the other.
        var exerciseId = Guid.NewGuid();
        await SeedAsync(exerciseId);

        var interceptor = new CountingSaveChangesInterceptor();
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString!)
            .AddInterceptors(interceptor)
            .Options;

        await using (var context = new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = exerciseId }))
        {
            var service = CreateService(context, exerciseId);
            var result = await service.UpdateAsync(new UpdateExerciseSettingsRequest
            {
                Name = "One Unit Of Work",
                TimeZone = "UTC",
                WorldName = "Atomic World",
            });

            result.Outcome.Should().Be(ExerciseSettingsOutcome.Ok);
        }

        interceptor.SaveChangesCallCount.Should().Be(
            1, "the entity mutation and its TelemetryEvent share one SaveChangesAsync (one transaction)");

        await using var verify = _fixture.CreateContext();
        var events = await verify.TelemetryEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(e => e.ExerciseId == exerciseId)
            .ToListAsync();

        events.Should().ContainSingle().Which.EventType.Should().Be("exercise.settings.updated");
        (await LoadAsync(exerciseId)).WorldName.Should().Be("Atomic World");
    }

    [RequiresDockerFact]
    public async Task UpdateAsync_StampsTheTelemetryEventFromTheServerClockAndTheExercisesTimeZone()
    {
        var exerciseId = Guid.NewGuid();
        await SeedAsync(exerciseId);
        var before = DateTimeOffset.UtcNow.AddSeconds(-5);

        await using var context = _fixture.CreateContext();
        var service = CreateService(context, exerciseId);
        await service.UpdateAsync(new UpdateExerciseSettingsRequest { Name = "Clocked", TimeZone = "America/Chicago" });

        await using var verify = _fixture.CreateContext();
        var telemetry = await verify.TelemetryEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleAsync(e => e.ExerciseId == exerciseId);

        telemetry.WallClockTime.Should().BeOnOrAfter(before, "wall-clock is the SERVER clock, never client input");
        telemetry.EmittedAt.Should().Be(telemetry.WallClockTime, "one clock read is shared across the event");
        telemetry.TimeZone.Should().Be("America/Chicago", "the event carries the exercise's IANA zone (XC-008)");
    }

    [RequiresDockerFact]
    public async Task UpdateAsync_InvalidRequest_RejectsBeforeAnythingIsApplied_AndEmitsNoTelemetry()
    {
        var exerciseId = Guid.NewGuid();
        await SeedAsync(exerciseId, e =>
        {
            e.Name = "Original";
            e.WorldName = "Original World";
        });

        await using var context = _fixture.CreateContext();
        var service = CreateService(context, exerciseId);

        var result = await service.UpdateAsync(new UpdateExerciseSettingsRequest
        {
            Name = "Renamed",
            TimeZone = "Not/AZone",
            WorldName = "New World",
        });

        result.Outcome.Should().Be(ExerciseSettingsOutcome.Invalid);
        result.ValidationError.Should().NotBeNullOrWhiteSpace();

        var stored = await LoadAsync(exerciseId);
        stored.Name.Should().Be("Original");
        stored.WorldName.Should().Be("Original World");

        await using var verify = _fixture.CreateContext();
        (await verify.TelemetryEvents.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == exerciseId))
            .Should().Be(0);
    }

    private static ExerciseSettingsService CreateService(PulseDbContext context, Guid? currentExerciseId) =>
        new(
            context,
            new ExerciseContext { CurrentExerciseId = currentExerciseId },
            new StubCurrentStaffSessionAccessor(new CurrentStaffSession
            {
                SessionId = Guid.NewGuid(),
                StaffUserId = Guid.NewGuid(),
            }));

    private async Task SeedAsync(Guid exerciseId, Action<Exercise>? configure = null)
    {
        var exercise = ExerciseConfigurationTestData.UnconfiguredExercise(exerciseId);
        configure?.Invoke(exercise);

        await using var context = _fixture.CreateContext();
        context.Exercises.Add(exercise);
        await context.SaveChangesAsync();
    }

    private async Task<Exercise> LoadAsync(Guid exerciseId)
    {
        await using var context = _fixture.CreateContext();
        return await context.Exercises.AsNoTracking().SingleAsync(e => e.Id == exerciseId);
    }
}
