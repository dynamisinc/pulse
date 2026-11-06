namespace Pulse.WebApi.Features.Realtime;

using System.Linq;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseConfiguration;

/// <summary>
/// Answers whether <paramref name="channelId"/> is enabled for <paramref name="exerciseId"/>
/// (<c>Exercise.EnabledChannels</c> through <see cref="ChannelCatalog"/>, null → <see cref="ChannelCatalog.DefaultEnabledIds"/>).
/// The broadcaster's disabled-channel send gate (channels-foundation story 09): a content frame for a disabled channel
/// goes to the staff group only, so a hidden channel never leaks a headline to a participant tab.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why not story 08's <c>IChannelEnablement</c>.</b> That service answers for the REQUEST-resolved exercise. A
/// broadcast often runs outside any participant request (the scheduled runner, an inject fire, the alert sweep), so this
/// seam takes the SERVER-resolved exercise id the caller fans out for — the same shape as
/// <c>ExerciseLifecycleStatusReader</c>. Both read the one registry (<see cref="ChannelCatalog"/>), so they agree.
/// </para>
/// <para>
/// <b>Isolation (COR-001).</b> <c>Exercise</c> is the scope rather than an <c>IExerciseScoped</c> entity, so this is a
/// direct read by that id, never a client-supplied one. A missing exercise row answers <c>false</c> (fail closed).
/// </para>
/// </remarks>
/// <param name="exerciseId">The server-resolved exercise (COR-001).</param>
/// <param name="channelId">The channel the frame belongs to.</param>
/// <param name="cancellationToken">Cancellation token.</param>
/// <returns><c>true</c> when participants of the exercise may see the channel.</returns>
public delegate Task<bool> ExerciseChannelEnabledReader(Guid exerciseId, string channelId, CancellationToken cancellationToken);

/// <summary>Composition-root seam for <see cref="ExerciseChannelEnabledReader"/>.</summary>
public static class ExerciseChannelEnabledReaderServiceCollectionExtensions
{
    /// <summary>
    /// Registers the database-backed <see cref="ExerciseChannelEnabledReader"/> (TryAdd, so a host or test that
    /// registered its own reader first still wins). Called by <see cref="RealtimeExtensions.AddSocialRealtimeHub"/>.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection TryAddExerciseChannelEnabledReader(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Resolved through its OWN scope per call, like ExerciseLifecycleStatusReader: callers may be singletons and
        // PulseDbContext is scoped. Read on every send, so a planner's toggle applies to the very next frame.
        services.TryAddSingleton<ExerciseChannelEnabledReader>(provider =>
            async (exerciseId, channelId, cancellationToken) =>
            {
                await using var scope = provider.GetRequiredService<IServiceScopeFactory>().CreateAsyncScope();

                // org-scope-exempt(ResolvedScope): exerciseId is the SERVER-resolved scope the broadcast carries,
                // never a client-supplied id, so this read stays inside the caller's tenant.
                var row = await scope.ServiceProvider.GetRequiredService<PulseDbContext>().Exercises
                    .AsNoTracking()
                    .Where(exercise => exercise.Id == exerciseId)
                    .Select(exercise => new { exercise.EnabledChannels })
                    .SingleOrDefaultAsync(cancellationToken);

                return row is not null && IsEnabled(row.EnabledChannels, channelId);
            });

        return services;
    }

    /// <summary>
    /// The pure rule: <paramref name="channelId"/> is in the stored set, or in <see cref="ChannelCatalog.DefaultEnabledIds"/>
    /// when nothing usable is stored.
    /// </summary>
    /// <param name="storedEnabledChannels">The raw <c>Exercise.EnabledChannels</c> column.</param>
    /// <param name="channelId">The channel id.</param>
    /// <returns>Whether the channel is enabled.</returns>
    public static bool IsEnabled(string? storedEnabledChannels, string channelId) =>
        (ChannelCatalog.ParseStored(storedEnabledChannels) ?? ChannelCatalog.DefaultEnabledIds).Contains(channelId);
}
