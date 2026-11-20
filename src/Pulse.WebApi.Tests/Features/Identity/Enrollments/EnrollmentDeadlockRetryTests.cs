namespace Pulse.WebApi.Tests.Features.Identity.Enrollments;

using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Enrollments;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// #858 review L5 — the deadlock retry (<c>SqlDeadlock</c>, Sonnet L6), driven by REAL SQL Server deadlocks rather than a
/// faked exception. Just before the revoke's last-planner lock, a competing transaction (at <c>DEADLOCK_PRIORITY
/// HIGH</c>, so the revoke is always the victim) locks the exercise's enrollment rows and then asks for the target's
/// person row, which the revoke already holds: a cycle SQL Server breaks by rolling the revoke back. The competitor then
/// rolls itself back. One deadlock: the retry succeeds. Two: the clean 409 <c>concurrent-change</c>, nothing changed.
/// </summary>
[Collection(MsSqlRcsiCollection.Name)]
public sealed class EnrollmentDeadlockRetryTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly EnrollmentTestKit _kit;

    public EnrollmentDeadlockRetryTests(MsSqlRcsiFixture rcsi)
    {
        ArgumentNullException.ThrowIfNull(rcsi);
        _fixture = rcsi.Sql;
        _kit = new EnrollmentTestKit(_fixture);
    }

    [RequiresDockerTheory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task Revoke_ThatLosesADeadlock_IsRetriedOnce_ThenAnswersAClean409(int deadlocks)
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        await _kit.SeedStaffAsync(org, exercise, "planner");
        var (admin, _) = await _kit.SeedStaffAsync(org, exerciseId: null, orgRole: "orgAdmin");
        var (target, enrollment) = await _kit.SeedStaffAsync(org, exercise, "controller");
        var (adminSession, _) = await _kit.SeedStaffSessionAsync(admin, exerciseId: null, "orgAdmin");

        var hook = new DeadlockBeforeGuardHook(_fixture.ConnectionString!, exercise, target, deadlocks);
        EnrollmentResult result;
        var (service, context) = _kit.ServiceFor(adminSession, admin, org, exerciseScope: null, interceptor: hook);
        await using (context)
        {
            result = await service.RevokeAsync(enrollment);
        }

        await hook.CompetitorsFinishedAsync();
        hook.Fired.Should().Be(deadlocks);

        await using var read = _kit.ReadContext();
        var row = await read.Enrollments.IgnoreQueryFilters().AsNoTracking().SingleAsync(e => e.Id == enrollment);
        if (deadlocks == 1)
        {
            result.Outcome.Should().Be(EnrollmentOutcome.Ok, "the deadlock victim was rolled back whole and retried once");
            row.DeletedAt.Should().NotBeNull();
        }
        else
        {
            result.Outcome.Should().Be(EnrollmentOutcome.Conflict, "a second deadlock is a clean 409, never an unhandled 500");
            result.Error.Should().Be(EnrollmentService.ConcurrentChangeError);
            row.DeletedAt.Should().BeNull("both attempts rolled back");
        }
    }

    /// <summary>Starts a deadlocking competitor before each of the first N enrollment UPDATEs (the guard's lock).</summary>
    private sealed class DeadlockBeforeGuardHook(string connectionString, Guid exerciseId, Guid targetPersonId, int deadlocks)
        : DbCommandInterceptor
    {
        private readonly List<Task> _competitors = [];

        public int Fired { get; private set; }

        public Task CompetitorsFinishedAsync() => Task.WhenAll(_competitors);

        public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            ArgumentNullException.ThrowIfNull(command);
            if (Fired < deadlocks
                && command.CommandText.Contains("UPDATE", StringComparison.Ordinal)
                && command.CommandText.Contains("[Enrollments]", StringComparison.Ordinal))
            {
                Fired++;
                await Task.WhenAll(_competitors); // the previous competitor has released everything
                _competitors.Add(await StartCompetitorAsync());
            }

            return result;
        }

        private async Task<Task> StartCompetitorAsync()
        {
            var connection = new SqlConnection(connectionString);
            await connection.OpenAsync();
            var transaction = (SqlTransaction)await connection.BeginTransactionAsync();
            await ExecuteAsync(connection, transaction, "SET DEADLOCK_PRIORITY HIGH;");
            await ExecuteAsync(
                connection, transaction, "UPDATE [Enrollments] SET [Role] = [Role] WHERE [ExerciseId] = @id;", exerciseId);

            // Blocks on the person row the revoke holds; the revoke's guard then blocks on our enrollment rows: a cycle.
            var wantsPerson = ExecuteAsync(
                connection, transaction, "UPDATE [People] SET [PasswordHash] = [PasswordHash] WHERE [Id] = @id;", targetPersonId);

            return Task.Run(async () =>
            {
                try
                {
                    await wantsPerson;
                    await transaction.RollbackAsync();
                }
                finally
                {
                    await transaction.DisposeAsync();
                    await connection.DisposeAsync();
                }
            });
        }

        private static async Task ExecuteAsync(SqlConnection connection, SqlTransaction transaction, string sql, Guid? id = null)
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = sql;
            if (id is { } value)
            {
                command.Parameters.AddWithValue("@id", value);
            }

            await command.ExecuteNonQueryAsync();
        }
    }
}
