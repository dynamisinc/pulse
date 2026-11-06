namespace Pulse.WebApi.Tests.Helpers;

using System;
using System.Data.Common;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore.Diagnostics;

/// <summary>
/// Runs ONE competing write just before the first non-query command whose SQL matches — the deterministic way to land
/// another writer between a read and an <c>ExecuteUpdate</c> (which a SaveChanges interceptor never sees).
/// </summary>
public sealed class BeforeCommandHook : DbCommandInterceptor
{
    private readonly Func<string, bool> _matches;
    private readonly Func<Task> _competingWrite;

    /// <summary>Creates the hook.</summary>
    /// <param name="matches">Selects the command (by its SQL text) to run the competing write before.</param>
    /// <param name="competingWrite">The write, on its own connection.</param>
    public BeforeCommandHook(Func<string, bool> matches, Func<Task> competingWrite)
    {
        _matches = matches;
        _competingWrite = competingWrite;
    }

    /// <summary>Whether the competing write ran.</summary>
    public bool Fired { get; private set; }

    /// <inheritdoc />
    public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (!Fired && _matches(command.CommandText))
        {
            Fired = true;
            await _competingWrite();
        }

        return result;
    }
}
