namespace Pulse.WebApi.Features.BackgroundWork;

using System.Linq;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>Registers a sleeping background service's <see cref="WakeSignal"/> the one way every feature does.</summary>
public static class BackgroundWorkServiceCollectionExtensions
{
    /// <summary>
    /// Registers <typeparamref name="TSignal"/> as a singleton (idempotent: a second call is a no-op), adds it to the
    /// set <see cref="BackgroundWorkSafetySweep"/> wakes, registers the sweep itself (once), and — when
    /// <paramref name="wakeOnClockChange"/> — a <see cref="WakeOnClockChange"/> so any exercise clock change wakes it.
    /// </summary>
    /// <typeparam name="TSignal">The service's signal type.</typeparam>
    /// <param name="services">The service collection.</param>
    /// <param name="wakeOnClockChange">Whether the service treats "no clock running" as idle and so must hear clock changes.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddWakeSignal<TSignal>(this IServiceCollection services, bool wakeOnClockChange)
        where TSignal : WakeSignal
    {
        ArgumentNullException.ThrowIfNull(services);

        if (services.Any(descriptor => descriptor.ServiceType == typeof(TSignal)))
        {
            return services;
        }

        services.AddSingleton<TSignal>();
        services.AddSingleton<WakeSignal>(provider => provider.GetRequiredService<TSignal>());
        if (wakeOnClockChange)
        {
            services.AddSingleton<IExerciseClockChangeListener>(
                provider => new WakeOnClockChange(provider.GetRequiredService<TSignal>()));
        }

        services.TryAddSingleton(TimeProvider.System);
        services.AddHostedService<BackgroundWorkSafetySweep>();

        return services;
    }
}
