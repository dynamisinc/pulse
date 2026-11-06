namespace Pulse.WebApi.Features.EngineRuntime.Review;

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Default EF-backed <see cref="IEngineReviewStore"/>. Straightforward persistence over
/// <see cref="PulseDbContext"/> — the central exercise query filter + write guard supply the COR-001
/// guarantee, so this class never re-implements scoping. Scoped lifetime, matching the context's unit of
/// work.
/// </summary>
public sealed class EngineReviewStore : IEngineReviewStore
{
    private readonly PulseDbContext _dbContext;
    private readonly EngineReviewTickSignal _tickSignal;

    /// <summary>Creates the store over the persistence context.</summary>
    /// <param name="dbContext">The persistence context whose filter/guard confine every operation to scope.</param>
    /// <param name="tickSignal">Wakes the sleeping auto-HOLD tick when a write starts a countdown.</param>
    public EngineReviewStore(PulseDbContext dbContext, EngineReviewTickSignal tickSignal)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(tickSignal);
        _dbContext = dbContext;
        _tickSignal = tickSignal;
    }

    /// <inheritdoc />
    public async Task EnqueueAsync(EngineReviewItemEntity item, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(item);

        _dbContext.EngineReviewItems.Add(item);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // After the commit, so the tick's sweep sees the row: it may be sleeping with nothing to count down.
        if (item.Disposition == DraftDisposition.CountingDown)
        {
            _tickSignal.Wake();
        }
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<EngineReviewItemEntity>> GetQueueAsync(CancellationToken cancellationToken = default)
    {
        return await _dbContext.EngineReviewItems
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task<EngineReviewItemEntity?> FindAsync(Guid draftId, CancellationToken cancellationToken = default)
    {
        return await _dbContext.EngineReviewItems
            .SingleOrDefaultAsync(item => item.DraftId == draftId, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<bool> UpdateDispositionAsync(
        Guid draftId,
        DraftDisposition disposition,
        ControllerDecision? decision = null,
        CancellationToken cancellationToken = default)
    {
        var item = await _dbContext.EngineReviewItems
            .SingleOrDefaultAsync(candidate => candidate.DraftId == draftId, cancellationToken);

        if (item is null)
        {
            return false;
        }

        item.Disposition = disposition;
        if (decision is not null)
        {
            item.CountdownDecision = decision;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        if (disposition == DraftDisposition.CountingDown)
        {
            _tickSignal.Wake();
        }

        return true;
    }
}
