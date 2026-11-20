namespace Pulse.WebApi.Tests.Helpers;

using System;
using System.Data.Common;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore.Diagnostics;

/// <summary>
/// #839: runs ONE competing action just BEFORE a change's session sweep — the first query that reads <c>[Sessions]</c>
/// after the change has issued an <c>UPDATE</c> of <c>[People]</c> (its person-row lock). At that point the change holds
/// the person lock and has not yet read the person's sessions: exactly where a racing sign-in would interleave.
/// </summary>
public sealed class BeforeSweepHook : DbCommandInterceptor
{
    private readonly Func<Task> _competing;
    private bool _sawPersonLock;

    /// <summary>Creates the hook.</summary>
    /// <param name="competing">The action, on its own connection.</param>
    public BeforeSweepHook(Func<Task> competing) => _competing = competing;

    /// <summary>Whether the competing action ran.</summary>
    public bool Fired { get; private set; }

    /// <inheritdoc />
    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.CommandText.Contains("UPDATE", StringComparison.Ordinal)
            && command.CommandText.Contains("[People]", StringComparison.Ordinal))
        {
            _sawPersonLock = true;
        }

        return ValueTask.FromResult(result);
    }

    /// <inheritdoc />
    public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (!Fired && _sawPersonLock && command.CommandText.Contains("FROM [Sessions]", StringComparison.Ordinal))
        {
            Fired = true;
            await _competing();
        }

        return result;
    }
}

/// <summary>
/// #839: runs ONE competing action just AFTER the first <c>UPDATE</c> of <c>[People]</c> a sign-in issues — its
/// person-row lock — while its transaction (and so the lock) is still open.
/// </summary>
public sealed class AfterPersonLockHook : DbCommandInterceptor
{
    private readonly Func<Task> _competing;

    /// <summary>Creates the hook.</summary>
    /// <param name="competing">The action, on its own connection.</param>
    public AfterPersonLockHook(Func<Task> competing) => _competing = competing;

    /// <summary>Whether the competing action ran.</summary>
    public bool Fired { get; private set; }

    /// <inheritdoc />
    public override async ValueTask<int> NonQueryExecutedAsync(
        DbCommand command,
        CommandExecutedEventData eventData,
        int result,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (!Fired
            && command.CommandText.Contains("UPDATE", StringComparison.Ordinal)
            && command.CommandText.Contains("[People]", StringComparison.Ordinal))
        {
            Fired = true;
            await _competing();
        }

        return result;
    }
}
