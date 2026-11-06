namespace Pulse.WebApi.Data;

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

/// <summary>
/// A SQL Server application lock (<c>sp_getapplock</c>) owned by the CURRENT transaction: it serializes a
/// read-then-write (a count cap, a whole-set reorder) across requests and instances, and is released at commit or
/// rollback. It touches no table, so it needs no exercise filter; the caller scopes the resource name.
/// </summary>
public static class SqlApplicationLock
{
    /// <summary>Takes an exclusive, transaction-owned lock on <paramref name="resource"/>.</summary>
    /// <param name="database">The context's database facade, with a transaction already begun.</param>
    /// <param name="resource">The lock name (at most 255 characters); include the scope, e.g. the exercise id.</param>
    /// <param name="timeoutMilliseconds">How long to wait for it.</param>
    /// <param name="cancellationToken">Cancels the wait.</param>
    /// <returns><c>true</c> when granted; <c>false</c> on timeout, cancel or deadlock (the caller answers a retryable error).</returns>
    /// <exception cref="InvalidOperationException">No transaction is open (the lock would be released at once), or the call itself failed.</exception>
    public static async Task<bool> TryAcquireExclusiveAsync(
        this DatabaseFacade database, string resource, int timeoutMilliseconds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(database);
        ArgumentException.ThrowIfNullOrEmpty(resource);

        if (database.CurrentTransaction is null)
        {
            throw new InvalidOperationException("A transaction-owned application lock needs an open transaction.");
        }

        var result = await database
            .SqlQuery<int>(
                $"""
                DECLARE @result int;
                EXEC @result = sp_getapplock @Resource = {resource}, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = {timeoutMilliseconds};
                SELECT @result AS [Value];
                """)
            .ToListAsync(cancellationToken);
        var status = result.Count == 1 ? result[0] : -999;

        // 0/1 granted; -1 timeout, -2 cancelled, -3 deadlock victim: retryable. Anything else (-999) is a call error.
        return status switch
        {
            >= 0 => true,
            -1 or -2 or -3 => false,
            _ => throw new InvalidOperationException($"sp_getapplock failed for '{resource}' (status {status})."),
        };
    }
}
