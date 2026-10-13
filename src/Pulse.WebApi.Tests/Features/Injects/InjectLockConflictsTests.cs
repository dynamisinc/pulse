namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Features.Injects;
using Xunit;

/// <summary>
/// The one helper that decides "this failure is SQL Server lock contention" (IQ-9 hardening, #458 CI run 37922671324):
/// a deadlock victim (1205) or a lock timeout (1222), however EF Core wrapped it — and nothing else, so a genuine
/// fault (a duplicate key, a lost connection) is never quietly turned into a 409.
/// </summary>
public sealed class InjectLockConflictsTests
{
    [Theory]
    [InlineData(InjectLockConflicts.DeadlockVictimErrorNumber)]
    [InlineData(InjectLockConflicts.LockRequestTimeoutErrorNumber)]
    public void ALockConflictIsRecognised_RawFromAQuery_WrappedByASave_OrDeeper(int number)
    {
        var raw = SqlExceptionFactory.Create(number);

        InjectLockConflicts.IsLockConflict(raw).Should().BeTrue("a query surfaces the SqlException itself");
        InjectLockConflicts.IsLockConflict(new DbUpdateException("save failed", raw))
            .Should().BeTrue("SaveChanges wraps it in a DbUpdateException");
        InjectLockConflicts.IsLockConflict(new InvalidOperationException("strategy gave up", new DbUpdateException("save failed", raw)))
            .Should().BeTrue("an execution strategy wraps the wrapper");
        InjectLockConflicts.IsLockConflict(new AggregateException(new InvalidOperationException("other"), raw))
            .Should().BeTrue("any branch of an aggregate counts");
    }

    [Fact]
    public void OtherSqlErrors_AndNonSqlFailures_AreNotLockConflicts()
    {
        InjectLockConflicts.IsLockConflict(SqlExceptionFactory.Create(2627, "Violation of PRIMARY KEY constraint."))
            .Should().BeFalse("a duplicate key is a real fault, not a lost race");
        InjectLockConflicts.IsLockConflict(new DbUpdateException("save failed", SqlExceptionFactory.Create(547, "FK conflict")))
            .Should().BeFalse("a foreign-key violation is a real fault");
        InjectLockConflicts.IsLockConflict(SqlExceptionFactory.Create(-2, "Execution Timeout Expired."))
            .Should().BeFalse("a command timeout is not lock contention the caller can treat as a lost race");
        InjectLockConflicts.IsLockConflict(new DbUpdateConcurrencyException("stale"))
            .Should().BeFalse("the concurrency token has its own handling");
        InjectLockConflicts.IsLockConflict(new InvalidOperationException("boom")).Should().BeFalse();
        InjectLockConflicts.IsLockConflict(null).Should().BeFalse();
    }

    [Fact]
    public void TheTestFactory_BuildsTheErrorNumberItWasAskedFor()
    {
        // Guards every lock-conflict test from passing vacuously on an exception the helper would never see in production.
        SqlExceptionFactory.Create(1205).Number.Should().Be(1205);
        SqlExceptionFactory.Create(1205).Errors.Count.Should().Be(1);
    }
}
