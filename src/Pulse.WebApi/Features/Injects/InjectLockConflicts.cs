namespace Pulse.WebApi.Features.Injects;

using System.Collections.Generic;
using Microsoft.Data.SqlClient;

/// <summary>
/// Recognises SQL Server lock contention — this transaction was chosen as a deadlock victim (<c>1205</c>), or a lock
/// request timed out (<c>1222</c>) — anywhere in an exception's inner chain. The queue treats both exactly like an
/// optimistic-concurrency conflict (IQ-9): the work rolled back, so nothing it attempted happened, and another writer
/// was busy with the same rows. A controller action answers the documented <c>409</c> with the item as it is now (or
/// reloads and re-applies once, where the action already does that on a lost race); a runner step skips the tick.
/// </summary>
/// <remarks>
/// EF Core surfaces the same failure in different wrappers: a query throws the <see cref="SqlException"/> itself, a
/// <c>SaveChanges</c> wraps it in a <c>DbUpdateException</c>, and an execution strategy wraps it again. Walking the whole
/// chain (and every branch of an <see cref="AggregateException"/>) keeps one definition for all of them.
/// </remarks>
public static class InjectLockConflicts
{
    /// <summary>SQL Server error 1205: the transaction was chosen as the deadlock victim and rolled back.</summary>
    public const int DeadlockVictimErrorNumber = 1205;

    /// <summary>SQL Server error 1222: a lock request exceeded the session's <c>LOCK_TIMEOUT</c>.</summary>
    public const int LockRequestTimeoutErrorNumber = 1222;

    // A cycle in a hand-built chain must not hang the caller; real chains are a few levels deep.
    private const int MaxExceptionsInspected = 32;

    /// <summary>Whether <paramref name="exception"/>, or any exception it wraps, is a SQL Server lock conflict.</summary>
    /// <param name="exception">The failure to inspect; <c>null</c> is not a conflict.</param>
    /// <returns><c>true</c> for a deadlock victim (1205) or a lock request timeout (1222).</returns>
    public static bool IsLockConflict(Exception? exception)
    {
        var pending = new Stack<Exception>();
        if (exception is not null)
        {
            pending.Push(exception);
        }

        var inspected = 0;
        while (pending.Count > 0 && inspected++ < MaxExceptionsInspected)
        {
            var current = pending.Pop();
            if (current is SqlException sql && HasLockConflictError(sql))
            {
                return true;
            }

            if (current is AggregateException aggregate)
            {
                foreach (var inner in aggregate.InnerExceptions)
                {
                    pending.Push(inner);
                }
            }
            else if (current.InnerException is { } innerException)
            {
                pending.Push(innerException);
            }
        }

        return false;
    }

    private static bool HasLockConflictError(SqlException exception)
    {
        if (exception.Number is DeadlockVictimErrorNumber or LockRequestTimeoutErrorNumber)
        {
            return true;
        }

        foreach (SqlError error in exception.Errors)
        {
            if (error.Number is DeadlockVictimErrorNumber or LockRequestTimeoutErrorNumber)
            {
                return true;
            }
        }

        return false;
    }
}
