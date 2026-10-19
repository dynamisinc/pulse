namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.ParticipantShell;

/// <summary>
/// A database-free stand-in for the production <see cref="ComposedOverlayStateReader"/>: the REAL composed projection
/// chain (<see cref="SteeringPauseOverlayProjection"/> over <see cref="LifecycleOverlayStateProjection"/> over the
/// no-op steering source) reading the given store, with the exercise's lifecycle status supplied by the test instead
/// of an <c>Exercise</c> row. So unit suites push exactly what the GET would serve without needing SQL.
/// </summary>
internal sealed class ComposedOverlayTestSupport : IDisposable
{
    private readonly ServiceProvider _provider;

    /// <summary>Builds the projection chain over <paramref name="store"/>.</summary>
    /// <param name="store">The overlay store the projection reads (shared with the publisher under test).</param>
    public ComposedOverlayTestSupport(OverlayStateService store)
    {
        var services = new ServiceCollection();
        services.AddSingleton(store);
        services.AddSingleton<ISteeringOverlaySource, NoSteeringOverlaySource>();
        services.AddScoped<LifecycleOverlayStateProjection>();
        services.AddScoped<IOverlayStateProjection, SteeringPauseOverlayProjection>();
        _provider = services.BuildServiceProvider(validateScopes: true);
    }

    /// <summary>The scope factory the <see cref="LifecycleOverlayPublisher"/> resolves its projection through.</summary>
    public IServiceScopeFactory ScopeFactory => _provider.GetRequiredService<IServiceScopeFactory>();

    /// <summary>A composed reader whose exercise is in whatever lifecycle state <paramref name="status"/> returns.</summary>
    /// <param name="status">The exercise's lifecycle status at read time.</param>
    /// <returns>The reader.</returns>
    public ComposedOverlayStateReader Reader(Func<string?> status) =>
        (exerciseId, cancellationToken) => ProjectAsync(exerciseId, status());

    /// <summary>What the GET would serve for an exercise in <paramref name="status"/>.</summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <param name="status">Its lifecycle status; <c>null</c> = no exercise row (the unconfigured source).</param>
    /// <returns>The composed overlay.</returns>
    public async Task<OverlayStateResponse> ProjectAsync(Guid exerciseId, string? status)
    {
        await using var scope = _provider.CreateAsyncScope();
        // A null status stands for "no exercise row", which production serves as the unconfigured source.
        var source = status is null
            ? ExerciseShellConfigSource.Unconfigured(exerciseId)
            : new ExerciseShellConfigSource { ExerciseId = exerciseId, TimeZone = "UTC", Status = status };
        return await scope.ServiceProvider.GetRequiredService<IOverlayStateProjection>().ProjectAsync(source);
    }

    /// <inheritdoc />
    public void Dispose() => _provider.Dispose();
}
