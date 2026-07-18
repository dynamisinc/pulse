namespace Pulse.Core.Core.Extensions;

using Azure.Core;
using Azure.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;

/// <summary>Composition-root extensions for the adaptive content engine (E8).</summary>
public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Registers the prompt assembler and the generation provider selected by the "Generation:Provider"
    /// discriminator, after enforcing the NFR-005 governance gate for real (egressing) providers.
    /// Mirrors Cadence's config-driven provider selection (Email/Blob). The reaction loop depends only on
    /// <see cref="IGenerationProvider"/> and <see cref="IPromptAssembler"/>; swapping the provider is a
    /// configuration change, not a code change.
    /// </summary>
    public static IServiceCollection AddEngineGeneration(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        var section = configuration.GetSection(GenerationOptions.SectionName);
        services.Configure<GenerationOptions>(section);
        var options = section.Get<GenerationOptions>() ?? new GenerationOptions();

        services.AddSingleton<IPromptAssembler, PromptAssembler>();

        switch (options.Provider.Trim())
        {
            case "" or "Fake":
                services.AddSingleton<IGenerationProvider, FakeGenerationProvider>();
                break;

            case "AzureOpenAI":
                AddAzureOpenAI(services, options);
                break;

            case "ClaudeFoundry":
                // Governance gate runs first (NFR-005); the Claude-on-Foundry serverless adapter is a follow-up.
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

        services.AddSingleton(governance);
        services.AddSingleton<TokenCredential>(_ => new DefaultAzureCredential());
        services.AddHttpClient<IGenerationProvider, AzureOpenAIGenerationProvider>(client =>
        {
            client.BaseAddress = endpoint;
            client.Timeout = TimeSpan.FromSeconds(60);
        });
    }
}
