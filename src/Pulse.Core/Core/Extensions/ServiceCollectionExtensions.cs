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
    /// <remarks>
    /// <para>
    /// <b>Both the configured provider AND Fake are registered (autonomy-safety story 07).</b> The
    /// discriminator still decides the CONFIGURED provider exactly as before — and the NFR-005 governance gate
    /// still runs first, before any adapter or HttpClient is constructed, failing closed on ungoverned config.
    /// What changed is that <see cref="IGenerationProvider"/> now resolves to a
    /// <see cref="GenerationProviderSelector"/> over the configured provider and
    /// <see cref="FakeGenerationProvider"/>, so a controller can CUT one exercise's generation to Fake at
    /// runtime (ADP-042) with no restart. The selector can only ever pick between those two
    /// already-registered instances: this adds no reachable endpoint, and restoring returns to exactly the
    /// signed startup configuration (§8.2).
    /// </para>
    /// <para>
    /// The <c>Fake</c>-configured case (the committed default, and every CI run) wraps Fake on BOTH sides
    /// rather than skipping the selector — the shape stays uniform so the cut path is exercised in CI instead
    /// of only in an environment with a live provider.
    /// </para>
    /// </remarks>
    public static IServiceCollection AddEngineGeneration(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        var section = configuration.GetSection(GenerationOptions.SectionName);
        services.Configure<GenerationOptions>(section);
        var options = section.Get<GenerationOptions>() ?? new GenerationOptions();

        services.AddSingleton<IPromptAssembler, PromptAssembler>();
        services.AddSingleton<ITierPolicy, TierPolicy>();

        // The runtime egress lever's per-exercise state (story 07). Registered in exactly ONE place, so the
        // reaction loop's selector and the settings endpoints that flip it cannot end up on two dictionaries —
        // a second registry would mean a controller's cut never reached the loop.
        services.TryAddSingleton<IGenerationProviderCutRegistry, GenerationProviderCutRegistry>();
        services.TryAddSingleton<FakeGenerationProvider>();

        switch (options.Provider.Trim())
        {
            case "" or "Fake":
                AddSelector<FakeGenerationProvider>(services);
                break;

            case "AzureOpenAI":
                AddHttpProvider<AzureOpenAIGenerationProvider>(services, options);
                AddSelector<AzureOpenAIGenerationProvider>(services);
                break;

            case "ClaudeFoundry":
                // Claude on Azure AI Foundry (serverless MaaS) — the quality-preferred alternative
                // (architecture §3.1), same governance gate + keyless Entra + resilience as Azure OpenAI;
                // only the wire format (native Anthropic Messages API) differs, inside the adapter.
                AddHttpProvider<ClaudeFoundryGenerationProvider>(services, options);
                AddSelector<ClaudeFoundryGenerationProvider>(services);
                break;

            default:
                throw new GenerationConfigurationException(
                    $"Unknown generation provider '{options.Provider}'. Valid values: Fake, AzureOpenAI, ClaudeFoundry.");
        }

        return services;
    }

    /// <summary>
    /// Registers the ONE <see cref="IGenerationProvider"/> the rest of the system resolves: the story-07
    /// selector over <typeparamref name="TConfigured"/> (the startup-configured provider) and
    /// <see cref="FakeGenerationProvider"/>. Deliberately TRANSIENT, matching the lifetime a typed-client
    /// adapter already had before the selector existed, so handler rotation is unchanged; the cut STATE it
    /// reads is the singleton registry, so the decision is shared host-wide while the wrapper is not.
    /// </summary>
    private static void AddSelector<TConfigured>(IServiceCollection services)
        where TConfigured : class, IGenerationProvider =>
        services.AddTransient<IGenerationProvider>(serviceProvider => new GenerationProviderSelector(
            serviceProvider.GetRequiredService<TConfigured>(),
            serviceProvider.GetRequiredService<FakeGenerationProvider>(),
            serviceProvider.GetRequiredService<IGenerationProviderCutRegistry>()));

    /// <summary>
    /// Registers an egressing (real) generation provider as its OWN typed client — the shared setup for every
    /// provider that reaches a tenant-bounded endpoint (Azure OpenAI today, Claude-on-Foundry too). The
    /// concrete type (not <see cref="IGenerationProvider"/>) is the typed client so story 07's
    /// <see cref="GenerationProviderSelector"/> can be the resolved <see cref="IGenerationProvider"/> while
    /// this adapter keeps its own resilient <see cref="HttpClient"/>. The NFR-005 governance gate runs
    /// <b>first</b>, before any adapter or
    /// HttpClient is constructed, so a misconfigured or ungoverned deployment fails fast at startup rather
    /// than reaching a live endpoint. Auth is keyless (managed identity in prod, az-cli login in dev); the
    /// retry + circuit-breaker + per-attempt-timeout pipeline (story 05) is identical across providers so
    /// degraded-mode behaviour (NFR-003 / ADP-042) does not change when the provider is swapped.
    /// </summary>
    private static void AddHttpProvider<TProvider>(IServiceCollection services, GenerationOptions options)
        where TProvider : class, IGenerationProvider
    {
        var governance = GenerationGovernance.Validate(options);

        if (string.IsNullOrWhiteSpace(options.Endpoint))
        {
            throw new GenerationConfigurationException($"Generation:Endpoint is required for provider '{options.Provider}'.");
        }

        var endpoint = new Uri(options.Endpoint, UriKind.Absolute);
        var resilience = options.Resilience;

        services.AddSingleton(governance);
        services.TryAddSingleton<TokenCredential>(_ => new DefaultAzureCredential());
        services.TryAddSingleton<IProviderHealthListener, NoOpProviderHealthListener>();

        services
            .AddHttpClient<TProvider>(client =>
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
