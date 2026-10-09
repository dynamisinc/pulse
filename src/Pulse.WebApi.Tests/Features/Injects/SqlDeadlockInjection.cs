namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Data.Common;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore.Diagnostics;

/// <summary>
/// Builds a real <see cref="SqlException"/> carrying a given server error number — the shape SQL Server raises for a
/// deadlock victim (1205) or a lock timeout (1222). <see cref="SqlException"/> has no public constructor, so this goes
/// through the client's internal factory; <see cref="Create"/> asserts the number round-trips, so a change in those
/// internals fails loudly instead of quietly producing an exception the code under test would not recognise.
/// </summary>
internal static class SqlExceptionFactory
{
    public static SqlException Create(int number, string message = "Transaction (Process ID 52) was deadlocked on lock resources with another process and has been chosen as the deadlock victim. Rerun the transaction.")
    {
        var errorCtor = typeof(SqlError)
            .GetConstructors(BindingFlags.NonPublic | BindingFlags.Instance)
            .OrderByDescending(ctor => ctor.GetParameters().Length)
            .First();
        var errorArgs = errorCtor.GetParameters()
            .Select(parameter => parameter.Name switch
            {
                "infoNumber" => number,
                "errorMessage" => message,
                "server" => "test-sql",
                _ => DefaultFor(parameter.ParameterType),
            })
            .ToArray();
        var error = (SqlError)errorCtor.Invoke(errorArgs);

        var errors = (SqlErrorCollection)Activator.CreateInstance(typeof(SqlErrorCollection), nonPublic: true)!;
        typeof(SqlErrorCollection)
            .GetMethod("Add", BindingFlags.NonPublic | BindingFlags.Instance)!
            .Invoke(errors, [error]);

        var factory = typeof(SqlException)
            .GetMethods(BindingFlags.NonPublic | BindingFlags.Static)
            .Where(method => method.Name == "CreateException"
                && method.GetParameters().Length > 0
                && method.GetParameters()[0].ParameterType == typeof(SqlErrorCollection))
            .OrderBy(method => method.GetParameters().Length)
            .First();
        var factoryArgs = factory.GetParameters()
            .Select((parameter, index) => index == 0
                ? errors
                : parameter.ParameterType == typeof(string) ? "16.00.0000" : DefaultFor(parameter.ParameterType))
            .ToArray();
        var exception = (SqlException)factory.Invoke(null, factoryArgs)!;

        if (exception.Number != number)
        {
            throw new InvalidOperationException(
                $"SqlExceptionFactory built error {exception.Number}, not {number}: the SqlClient internals it relies on changed.");
        }

        return exception;
    }

    private static object? DefaultFor(Type type) =>
        type == typeof(string) ? string.Empty : type.IsValueType ? Activator.CreateInstance(type) : null;
}

/// <summary>
/// An EF Core command interceptor that plays SQL Server choosing a command as the deadlock victim: once armed, the next
/// <c>n</c> commands whose text matches throw a real error-1205 <see cref="SqlException"/> before reaching the server,
/// exactly where the database would have raised it (a query surfaces it raw; a <c>SaveChanges</c> wraps it in a
/// <c>DbUpdateException</c>). <see cref="Thrown"/> proves the injection happened, so a pass is never vacuous.
/// </summary>
internal sealed class DeadlockInjector : DbCommandInterceptor
{
    private Func<string, bool> _matches = _ => false;
    private int _remaining;
    private int _thrown;

    /// <summary>
    /// The single-item load (<c>SELECT TOP(1) … FROM [InjectItems]</c>) every action and runner step starts with — not
    /// the runner's discovery sweep or a projection's id list, which read the table without <c>TOP(1)</c>.
    /// </summary>
    public static Func<string, bool> ItemRead { get; } =
        sql => sql.TrimStart().StartsWith("SELECT TOP(1)", StringComparison.OrdinalIgnoreCase)
            && sql.Contains("FROM [InjectItems]", StringComparison.Ordinal);

    /// <summary>A save batch that writes the item aggregate (the claim, a transition, an edit, a record).</summary>
    public static Func<string, bool> ItemSave { get; } =
        sql => sql.Contains("UPDATE [InjectItem", StringComparison.Ordinal);

    /// <summary>How many 1205s were actually raised.</summary>
    public int Thrown => Volatile.Read(ref _thrown);

    /// <summary>Makes the next <paramref name="times"/> matching commands deadlock victims.</summary>
    public void Arm(Func<string, bool> matches, int times = 1)
    {
        _matches = matches;
        Volatile.Write(ref _remaining, times);
    }

    /// <summary>Stops injecting.</summary>
    public void Disarm() => Volatile.Write(ref _remaining, 0);

    public override InterceptionResult<DbDataReader> ReaderExecuting(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<DbDataReader> result)
    {
        ThrowIfChosen(command);
        return base.ReaderExecuting(command, eventData, result);
    }

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        ThrowIfChosen(command);
        return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
    }

    private void ThrowIfChosen(DbCommand command)
    {
        if (!_matches(command.CommandText))
        {
            return;
        }

        while (true)
        {
            var remaining = Volatile.Read(ref _remaining);
            if (remaining <= 0)
            {
                return;
            }

            if (Interlocked.CompareExchange(ref _remaining, remaining - 1, remaining) == remaining)
            {
                Interlocked.Increment(ref _thrown);
                throw SqlExceptionFactory.Create(1205);
            }
        }
    }
}
