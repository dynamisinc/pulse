namespace Pulse.WebApi.Data;

using Microsoft.Data.SqlClient;

/// <summary>
/// Recognizes SQL Server's deadlock-victim error (1205) however EF surfaces it: raw from an <c>ExecuteUpdate</c>, or
/// wrapped by <c>SaveChanges</c> / a transaction call. SQL Server rolls the victim's whole transaction back, so a caller
/// that catches it has changed nothing and may retry from the top.
/// </summary>
public static class SqlDeadlock
{
    /// <summary>SQL Server's "transaction was deadlocked … chosen as the deadlock victim" error number.</summary>
    public const int DeadlockVictimErrorNumber = 1205;

    /// <summary>Whether <paramref name="exception"/> (or any exception it wraps) is the deadlock-victim error.</summary>
    /// <param name="exception">The caught exception.</param>
    /// <returns><c>true</c> for a deadlock victim.</returns>
    public static bool IsDeadlock(Exception? exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current is SqlException { Number: DeadlockVictimErrorNumber })
            {
                return true;
            }
        }

        return false;
    }
}
