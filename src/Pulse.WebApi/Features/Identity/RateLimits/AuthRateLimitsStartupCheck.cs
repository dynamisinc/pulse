using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Pulse.WebApi.Features.Identity.RateLimits;

/// <summary>
/// Logs a warning once at startup for each <c>Authentication:RateLimits</c> key whose value is refused (so the
/// default is used), mirroring <c>EasyLoginOptionsStartupCheck</c>: a typo is visible, never silent. Logs the key,
/// never the value.
/// </summary>
public sealed partial class AuthRateLimitsStartupCheck : IHostedService
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<AuthRateLimitsStartupCheck> _logger;

    /// <summary>Creates the startup check.</summary>
    /// <param name="configuration">The application configuration.</param>
    /// <param name="logger">The logger the refused keys are reported to.</param>
    public AuthRateLimitsStartupCheck(IConfiguration configuration, ILogger<AuthRateLimitsStartupCheck> logger)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(logger);
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// Registers the check once, however many slices call it (the four auth slices each do, since there is no
    /// shared registration point outside the orchestrator-owned Program.cs).
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection Register(IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IHostedService, AuthRateLimitsStartupCheck>());
        return services;
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        foreach (var key in AuthRateLimits.FindRejectedKeys(_configuration))
        {
            LogValueRefused(key);
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Configuration key '{Key}' has a value that is not a positive whole number; the rate-limit default is used instead.")]
    private partial void LogValueRefused(string key);
}
