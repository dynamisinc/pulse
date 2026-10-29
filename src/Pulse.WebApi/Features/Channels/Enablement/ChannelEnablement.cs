namespace Pulse.WebApi.Features.Channels.Enablement;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseConfiguration;

/// <summary>
/// The <see cref="IChannelEnablement"/> implementation: reads the resolved exercise's
/// <c>Exercise.EnabledChannels</c> through <see cref="ChannelCatalog.ParseStored"/> and
/// <see cref="ChannelCatalog.ResolveEnabled"/>, exactly as <c>ParticipantShellConfigService</c> builds the nav config.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical, XC-001).</b> <c>Exercise</c> is the scope, not an <c>IExerciseScoped</c> entity, so
/// the central query filter does not narrow this read. The id therefore comes ONLY from
/// <see cref="IExerciseContext"/>; no method accepts an exercise id.
/// </para>
/// <para>
/// <b>Missing row.</b> A resolved scope whose row is absent gets the default set, matching the nav config (which
/// serves the un-configured read model in that case), so the two still agree.
/// </para>
/// <para>
/// Scoped. The enabled set is memoized for the request only, so several checks in one request read the row once
/// and a toggle applies on the next request.
/// </para>
/// </remarks>
public sealed class ChannelEnablement : IChannelEnablement
{
    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private IReadOnlySet<string>? _enabled;

    /// <summary>Creates the service over persistence and the resolved scope.</summary>
    /// <param name="dbContext">The request-scoped persistence context.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope — the ONLY source of "which exercise".</param>
    public ChannelEnablement(PulseDbContext dbContext, IExerciseContext exerciseContext)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
    }

    /// <inheritdoc />
    public async Task<bool> IsEnabledAsync(string channelId, CancellationToken cancellationToken = default)
    {
        if (!ChannelCatalog.IsCatalogued(channelId))
        {
            return false;
        }

        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return false;
        }

        if (_enabled is null)
        {
            var stored = await _dbContext.Exercises
                .AsNoTracking()
                .Where(e => e.Id == scope.Value)
                .Select(e => e.EnabledChannels)
                .FirstOrDefaultAsync(cancellationToken);

            _enabled = ChannelCatalog.ResolveEnabled(ChannelCatalog.ParseStored(stored));
        }

        return _enabled.Contains(channelId);
    }
}
