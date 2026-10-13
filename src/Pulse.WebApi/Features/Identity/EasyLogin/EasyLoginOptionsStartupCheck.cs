namespace Pulse.WebApi.Features.Identity.EasyLogin;

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

/// <summary>
/// Logs, once at host startup, every <c>Authentication:EasyLogin</c> key whose configured value was refused and
/// replaced by its default (review W-2: configuration must not take the API down, but a typo must not go unnoticed).
/// It also materialises <c>IOptions&lt;EasyLoginOptions&gt;</c>, so the clamped values exist before the first request.
/// Registered by <see cref="EasyLoginFoundationExtensions.AddEasyLoginFoundation"/>.
/// </summary>
/// <remarks>
/// The warning names the KEY only, never the value: a mistyped value is not a secret today, but configuration values in
/// this section sit next to credentials-adjacent settings and the rule for this feature is that logs carry no values.
/// </remarks>
public sealed partial class EasyLoginOptionsStartupCheck : IHostedService
{
    private readonly IConfiguration _configuration;
    private readonly IOptions<EasyLoginOptions> _options;
    private readonly ILogger<EasyLoginOptionsStartupCheck> _logger;

    /// <summary>Creates the startup check.</summary>
    /// <param name="configuration">The application configuration.</param>
    /// <param name="options">The clamped options (resolved here so they are built at startup).</param>
    /// <param name="logger">The logger the refused keys are reported to.</param>
    public EasyLoginOptionsStartupCheck(
        IConfiguration configuration,
        IOptions<EasyLoginOptions> options,
        ILogger<EasyLoginOptionsStartupCheck> logger)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(logger);

        _configuration = configuration;
        _options = options;
        _logger = logger;
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        _ = _options.Value;

        foreach (var key in EasyLoginOptions.FindRejectedKeys(_configuration))
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
        Message = "Configuration key '{Key}' has a value that is not a whole number in its allowed range; the easy-login default is used instead.")]
    private partial void LogValueRefused(string key);
}
