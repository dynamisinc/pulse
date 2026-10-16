namespace Pulse.WebApi.Features.EngineRuntime.Persistence;

using System.Collections.Frozen;
using System.Collections.Generic;
using Microsoft.Data.SqlClient;

/// <summary>
/// Classifies the SQL failures the runtime-state persistence retries (demo-feedback story 18, Gate-1 CR-1). UAT runs
/// on serverless Azure SQL that auto-pauses, so the first connection after a pause fails with 40613 while the database
/// wakes; these errors clear on their own within seconds, so retrying them is correct. Everything else — no
/// connection string (<see cref="InvalidOperationException"/>), an unknown host, a missing table, a constraint
/// violation — is NOT transient and fails fast, so a misconfigured host (or a test host with a dummy connection
/// string) never waits on a retry budget.
/// </summary>
/// <remarks>
/// Deliberately a narrow, explicit list rather than host-wide <c>EnableRetryOnFailure</c>: only this slice's few
/// writes and one startup read retry, and nothing else in the host changes behaviour.
/// </remarks>
public static class TransientSqlErrors
{
    /// <summary>
    /// The SQL error numbers treated as transient: 40613 (database unavailable, e.g. a serverless resume), 40197 and
    /// 40501 (service busy / error processing), 49918/49919/49920 (not enough resources / too many operations),
    /// 4060 (cannot open database, seen while it resumes), 10928/10929 (resource limits), 4221 (login timeout during
    /// failover), 10053/10054/10060 (transport-level connection drops) and -2 (command or connection timeout).
    /// </summary>
    public static readonly IReadOnlySet<int> TransientNumbers = new HashSet<int>
    {
        40613, 40197, 40501, 49918, 49919, 49920, 4060, 10928, 10929, 4221, 10053, 10054, 10060, -2,
    }.ToFrozenSet();

    /// <summary>
    /// Whether <paramref name="exception"/> (or any exception in its inner chain, so an EF <c>DbUpdateException</c>
    /// wrapping a <see cref="SqlException"/> counts) is a transient SQL failure or a timeout.
    /// </summary>
    /// <param name="exception">The failure.</param>
    /// <returns><c>true</c> when retrying is expected to help.</returns>
    public static bool IsTransient(Exception? exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            switch (current)
            {
                case SqlException sql:
                    foreach (SqlError error in sql.Errors)
                    {
                        if (TransientNumbers.Contains(error.Number))
                        {
                            return true;
                        }
                    }

                    if (TransientNumbers.Contains(sql.Number))
                    {
                        return true;
                    }

                    break;
                case TimeoutException:
                    return true;
            }
        }

        return false;
    }
}

/// <summary>
/// Retry tuning for the runtime-state persistence (config section <c>EngineRuntime:Persistence</c>). The defaults
/// suit a serverless database that takes up to about a minute to resume.
/// </summary>
public sealed class ExerciseRuntimePersistenceOptions
{
    /// <summary>The configuration section the options bind from.</summary>
    public const string SectionName = "EngineRuntime:Persistence";

    /// <summary>
    /// The total wall-clock budget, in seconds, the startup rehydrator spends retrying a TRANSIENT read failure before
    /// giving up (default 90, well under App Service's 230-second start limit). 0 disables retrying.
    /// </summary>
    public int RehydrateRetryBudgetSeconds { get; set; } = 90;

    /// <summary>The rehydrator's first backoff in milliseconds; it doubles per retry, capped at 15 seconds (default 1000).</summary>
    public int RehydrateRetryInitialDelayMilliseconds { get; set; } = 1000;

    /// <summary>How many attempts a write-through or reset delete makes on TRANSIENT failures (default 3; minimum 1).</summary>
    public int WriteAttempts { get; set; } = 3;

    /// <summary>The write retries' first backoff in milliseconds; it doubles per retry (default 250).</summary>
    public int WriteRetryInitialDelayMilliseconds { get; set; } = 250;
}
