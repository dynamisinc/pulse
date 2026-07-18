namespace Pulse.Core.Core.Extensions;

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;

/// <summary>Composition-root extensions for the adaptive content engine (E8).</summary>
public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Registers the generation provider selected by the "Generation:Provider" discriminator, after
    /// enforcing the NFR-005 governance gate for real (egressing) providers. Mirrors Cadence's
    /// config-driven provider selection (Email/Blob). The reaction loop depends only on
    /// <see cref="IGenerationProvider"/>; swapping the provider is a configuration change, not a code change.
    /// </summary>
    public static IServiceCollection AddEngineGeneration(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        var section = configuration.GetSection(GenerationOptions.SectionName);
        services.Configure<GenerationOptions>(section);
        var options = section.Get<GenerationOptions>() ?? new GenerationOptions();

        switch (options.Provider.Trim())
        {
            case "" or "Fake":
                services.AddSingleton<IGenerationProvider, FakeGenerationProvider>();
                break;

            case "AzureOpenAI" or "ClaudeFoundry":
                // The governance gate runs BEFORE any real adapter is constructed (NFR-005): a
                // misconfigured deployment fails fast at startup rather than reaching an endpoint.
                _ = GenerationGovernance.Validate(options);
                throw new GenerationConfigurationException(
                    $"Generation provider '{options.Provider}' passed the governance gate, but its tenant-bounded " +
                    "adapter is not wired yet — it arrives with the Azure OpenAI / Claude-on-Foundry adapters and the " +
                    "story 06 measured pass. Use Provider=\"Fake\" for offline/dev until then.");

            default:
                throw new GenerationConfigurationException(
                    $"Unknown generation provider '{options.Provider}'. Valid values: Fake, AzureOpenAI, ClaudeFoundry.");
        }

        return services;
    }
}
