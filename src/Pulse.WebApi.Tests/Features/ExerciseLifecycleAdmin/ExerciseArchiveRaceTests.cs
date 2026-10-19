namespace Pulse.WebApi.Tests.Features.ExerciseLifecycleAdmin;

using System;
using System.Data.Common;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.ExerciseConfiguration.Readiness;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// demo-feedback story 22, Gate-1 L-4: archive stages <c>exercise.archived</c> BEFORE the lifecycle service reads and
/// saves. This forces the lifecycle step to fail after that staging (another writer flips the exercise from
/// <c>completed</c> to <c>live</c> between the archive's own state check and the lifecycle's read) and proves the
/// staged event never persists: the result is <c>not-completed</c>, the status is the other writer's, and the
/// exercise has ZERO telemetry rows.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseArchiveRaceTests
{
    private readonly MsSqlContainerFixture _fixture;

    /// <summary>Creates the suite over the shared real-SQL fixture.</summary>
    /// <param name="fixture">The shared migrated database.</param>
    public ExerciseArchiveRaceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>L-4: a status flip between the check and the transition leaves no event behind.</summary>
    [RequiresDockerFact]
    public async Task Archive_WhenTheLifecycleRefusesAfterTheEventIsStaged_PersistsNoEvent()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Planner);
        Guid sessionId;
        await using (var seed = _fixture.CreateContext())
        {
            var own = await seed.Exercises.SingleAsync(e => e.Id == world.OwnExercise.Id);
            own.Status = "completed";
            await seed.SaveChangesAsync();
            sessionId = await seed.Sessions.Where(s => s.StaffUserId == world.CallerStaffUserId)
                .Select(s => s.Id).SingleAsync();
        }

        var flipper = new FlipStatusBeforeSecondReadInterceptor(_fixture.ConnectionString!, world.OwnExercise.Id);
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString)
            .AddInterceptors(flipper)
            .Options;
        var organization = new OrganizationContext { CurrentOrganizationId = world.OwnOrganizationId };
        var staff = new FixedStaffSession(sessionId, world.CallerStaffUserId);

        var scope = new ExerciseContext();
        await using (var context = new PulseDbContext(options, exerciseContext: null, organization))
        {
            var service = new ExerciseManagementService(
                context,
                new StaffCallerContext(context, staff, organization),
                new ExerciseLifecycleService(
                    context, scope, staff, new ExerciseReadinessService(context, scope)));

            var result = await service.ArchiveAsync(world.OwnExercise.Id);

            flipper.Flipped.Should().BeTrue("the race must actually have been forced, or this test proves nothing");
            result.Outcome.Should().Be(ExerciseManagementOutcome.NotCompleted);
            context.ChangeTracker.Entries().Should().BeEmpty("the staged event is dropped from the unit of work");
        }

        await using var read = _fixture.CreateContext();
        (await read.Exercises.AsNoTracking().SingleAsync(e => e.Id == world.OwnExercise.Id)).Status
            .Should().Be("live", "the other writer's state stands; archive did not overwrite it");
        (await read.TelemetryEvents.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(e => e.ExerciseId == world.OwnExercise.Id))
            .Should().Be(0, "neither exercise.archived nor a transition event may persist for a refused archive");
    }

    /// <summary>
    /// Lets the archive's own state read through, then flips the exercise to <c>live</c> from a SEPARATE connection
    /// immediately before the next read of that exercise (the lifecycle service's), i.e. after the event is staged.
    /// </summary>
    private sealed class FlipStatusBeforeSecondReadInterceptor(string connectionString, Guid exerciseId) : DbCommandInterceptor
    {
        private int _reads;

        public bool Flipped { get; private set; }

        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            if (!Flipped && IsReadOfTheExercise(command) && Interlocked.Increment(ref _reads) == 2)
            {
                await using var connection = new SqlConnection(connectionString);
                await connection.OpenAsync(cancellationToken);
                await using var update = connection.CreateCommand();
                update.CommandText = "UPDATE [Exercises] SET [Status] = N'live' WHERE [Id] = @id";
                update.Parameters.AddWithValue("@id", exerciseId);
                await update.ExecuteNonQueryAsync(cancellationToken);
                Flipped = true;
            }

            return await base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }

        private bool IsReadOfTheExercise(DbCommand command) =>
            command.CommandText.Contains("FROM [Exercises]", StringComparison.Ordinal)
            && command.Parameters.Cast<DbParameter>().Any(parameter => parameter.Value is Guid id && id == exerciseId);
    }

    /// <summary>The caller's own live staff session, fixed for a service-level test.</summary>
    private sealed class FixedStaffSession(Guid sessionId, Guid staffUserId) : ICurrentStaffSessionAccessor
    {
        public Task<CurrentStaffSession?> GetCurrentStaffSessionAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult<CurrentStaffSession?>(new CurrentStaffSession { SessionId = sessionId, StaffUserId = staffUserId });
    }
}
