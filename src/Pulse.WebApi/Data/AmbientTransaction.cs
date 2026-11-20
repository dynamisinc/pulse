namespace Pulse.WebApi.Data;

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

/// <summary>
/// Opens a transaction for a unit of work — unless the context is ALREADY inside one, which the unit of work then joins
/// (#858 CI: a caller, such as a seed-then-sign-in flow, may already hold an open transaction, and SQL Server cannot nest
/// one). When joined, the locks the unit of work takes are held to the OWNER's commit, and committing is the owner's job.
/// </summary>
public static class AmbientTransaction
{
    /// <summary>
    /// Begins a transaction when none is open, and returns it (the caller commits it); returns <c>null</c> when an ambient
    /// transaction is open and is being joined. <c>await using</c> a <c>null</c> result is a no-op.
    /// </summary>
    /// <param name="dbContext">The unit of work.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The owned transaction, or <c>null</c> when joining an ambient one.</returns>
    public static async Task<IDbContextTransaction?> BeginUnlessAmbientAsync(
        PulseDbContext dbContext,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        return dbContext.Database.CurrentTransaction is null
            ? await dbContext.Database.BeginTransactionAsync(cancellationToken)
            : null;
    }

    /// <summary>Commits <paramref name="owned"/> when this unit of work owns it; a no-op when it joined an ambient one.</summary>
    /// <param name="owned">The result of <see cref="BeginUnlessAmbientAsync"/>.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task.</returns>
    public static Task CommitIfOwnedAsync(this IDbContextTransaction? owned, CancellationToken cancellationToken = default) =>
        owned?.CommitAsync(cancellationToken) ?? Task.CompletedTask;

    /// <summary>
    /// Rolls <paramref name="owned"/> back when this unit of work owns it; a no-op when it joined an ambient one (whose
    /// owner decides). Callers only roll back after writing nothing but no-op locks, so a joined refusal leaves nothing
    /// behind either way.
    /// </summary>
    /// <param name="owned">The result of <see cref="BeginUnlessAmbientAsync"/>.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task.</returns>
    public static Task RollbackIfOwnedAsync(this IDbContextTransaction? owned, CancellationToken cancellationToken = default) =>
        owned?.RollbackAsync(cancellationToken) ?? Task.CompletedTask;
}
