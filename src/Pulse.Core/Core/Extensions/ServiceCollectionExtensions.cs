namespace Pulse.Core.Core.Extensions;

using Azure.Core;
using Azure.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Http.Resilience;
using Polly;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;

/// <summary>Composition-root extensions for the adaptive content engine (E8).</summary>
public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Registers the prompt assembler, the tier policy, and the generation provider selected by the
    /// "Generation:Provider" discriminator, after enforcing the NFR-005 governance gate for real
    /// (egressing) providers. Mirrors Cadence's config-driven provider selection. The reaction loop
    /// depends only on <see cref="IGenerationProvider"/>, <see cref="IPromptAssembler"/>, and
    /// <see cref="ITierPolicy"/>; swapping the provider is a configuration change, not a code change.
    /// </summary>
    public static IServiceCollection AddEngineGeneration(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        var section = configuration.GetSection(GenerationOptions.SectionName);
        services.Configure<GenerationOptions>(section);
        var options = section.Get<GenerationOptions>() ?? new GenerationOptions();

        services.AddSingleton<IPromptAssembler, PromptAssembler>();
        services.AddSingleton<ITierPolicy, TierPolicy>();

        switch (options.Provider.Trim())
        {
            case "" or "Fake":
                services.AddSingleton<IGenerationProvider, FakeGenerationProvider>();
                break;

            case "AzureOpenAI":
                AddAzureOpenAI(services, options);
                break;

            case "ClaudeFoundry":
                // Governance gate runs first (NFR-005); the Claude-on-Foundry serverless adapter is a fast-follow.
                _ = GenerationGovernance.Validate(options);
                throw new GenerationConfigurationException(
                    "Generation provider 'ClaudeFoundry' passed the governance gate but its adapter is not wired yet " +
                    "(the Claude-on-Foundry serverless adapter is a fast-follow). Use Provider=\"AzureOpenAI\" or \"Fake\".");

            default:
                throw new GenerationConfigurationException(
                    $"Unknown generation provider '{options.Provider}'. Valid values: Fake, AzureOpenAI, ClaudeFoundry.");
        }

        return services;
    }

    private static void AddAzureOpenAI(IServiceCollection services, GenerationOptions options)
    {
        // The NFR-005 governance gate runs BEFORE any adapter/HttpClient is constructed: a misconfigured
        // deployment fails fast at startup rather than reaching an endpoint.
        var governance = GenerationGovernance.Validate(options);

        if (string.IsNullOrWhiteSpace(options.Endpoint))
        {
            throw new GenerationConfigurationException("Generation:Endpoint is required for provider 'AzureOpenAI'.");
        }

        var endpoint = new Uri(options.Endpoint, UriKind.Absolute);
        var resilience = options.Resilience;

        services.AddSingleton(governance);
        services.AddSingleton<TokenCredential>(_ => new DefaultAzureCredential());
        services.TryAddSingleton<IProviderHealthListener, NoOpProviderHealthListener>();

        services
            .AddHttpClient<IGenerationProvider, AzureOpenAIGenerationProvider>(client =>
            {
                client.BaseAddress = endpoint;

                // Generous overall ceiling; the per-attempt timeout + circuit breaker below are the real SLO controls (§4.3).
                client.Timeout = TimeSpan.FromSeconds(
                    Math.Max(60, (resilience.AttemptTimeoutSeconds * (resilience.MaxRetries + 1)) + 15));
            })
            .AddResilienceHandler("engine-generation", (builder, context) =>
            {
                // Retry transient failures (5xx / 408 / network). Skipped when MaxRetries == 0 — Polly
                // rejects a zero-attempt retry strategy, and "no retries" is a valid deployment choice.
                if (resilience.MaxRetries > 0)
                {
                    builder.AddRetry(new HttpRetryStrategyOptions
                    {
                        MaxRetryAttempts = resilience.MaxRetries,
                        BackoffType = DelayBackoffType.Exponential,
                        UseJitter = true,
                    });
                }

                builder.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
                {
                    FailureRatio = resilience.CircuitBreakerFailureRatio,
                    MinimumThroughput = resilience.CircuitBreakerMinimumThroughput,
                    SamplingDuration = TimeSpan.FromSeconds(resilience.CircuitBreakerSamplingSeconds),
                    BreakDuration = TimeSpan.FromSeconds(resilience.CircuitBreakerBreakSeconds),

                    // On trip, raise the degraded-mode signal (NFR-003 / ADP-042). autonomy-safety
                    // consumes this to drop to Suggest; degradation only ever lowers autonomy (§8.2).
                    OnOpened = async _ =>
                    {
                        var listener = context.ServiceProvider.GetRequiredService<IProviderHealthListener>();
                        await listener.OnDegradedAsync("generation provider circuit opened — degraded to fallback")
                            .ConfigureAwait(false);
                    },
                    OnClosed = async _ =>
                    {
                        var listener = context.ServiceProvider.GetRequiredService<IProviderHealthListener>();
                        await listener.OnRecoveredAsync().ConfigureAwait(false);
                    },
                });

                builder.AddTimeout(TimeSpan.FromSeconds(resilience.AttemptTimeoutSeconds));
            });
    }
}
