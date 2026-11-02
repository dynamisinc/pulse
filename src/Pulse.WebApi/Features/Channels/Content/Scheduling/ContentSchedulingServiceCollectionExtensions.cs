namespace Pulse.WebApi.Features.Channels.Content.Scheduling;

using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>
/// DI for the scheduled-publish runner (channels-foundation story 05), called from the <c>AddChannels()</c> seam, so the
/// hosted service reaches the host with no <c>Program.cs</c> edit. Idempotent (every registration is a <c>TryAdd</c>).
/// </summary>
/// <remarks>
/// Needs what the host already wires: the publish funnel (<c>AddContentPublishFunnel</c>, registered just before this),
/// persistence and exercise scoping, the exercise clock and the pause tiers (<c>PauseTierRegistry</c>).
/// </remarks>
public static class ContentSchedulingServiceCollectionExtensions
{
    /// <summary>Registers the scheduled-publish runner, its wake-up line and the funnel's scheduler entry points.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddContentScheduling(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton(new ContentScheduleRunnerOptions());
        services.TryAddSingleton<ContentScheduleSignal>();
        services.TryAddScoped<ScheduledByReader>();
        services.TryAddScoped<IScheduledContentPublisher, ContentPublishService>();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IExerciseClockChangeObserver, ContentScheduleClockObserver>());
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IHostedService, ContentScheduleRunner>());
        return services;
    }
}
