namespace Pulse.WebApi.Features.TrustedProxy;

using System.Globalization;
using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

/// <summary>
/// Composition-root seams for forwarded-headers handling (identity-auth-roles/18, #480). Behind the App Service
/// front end every request's TCP peer is the platform proxy, so without this every per-IP rate limiter
/// (staff login, join, day word, ...) collapses into one global bucket. The orchestrator wires
/// <see cref="AddPulseForwardedHeaders"/> (DI) and <see cref="UsePulseForwardedHeaders"/> (pipeline) into
/// <c>Program.cs</c>; this slice never edits it.
/// </summary>
/// <remarks>
/// <para>
/// <b>What is honored.</b> Only <c>X-Forwarded-For</c> (the client IP) and <c>X-Forwarded-Proto</c> (the
/// original scheme). <c>X-Forwarded-Host</c> is deliberately NOT honored: <c>UseExerciseResolution()</c> maps the
/// request Host to an exercise, so a forwarded host would be a client-controlled scope input (COR-001).
/// </para>
/// <para>
/// <b>Who is trusted.</b> Only the peers configured in <see cref="PulseForwardedHeadersOptions"/>. The framework's
/// default loopback trust is cleared, so an unconfigured host trusts no one and a forwarded header from an
/// arbitrary client is ignored (no spoofing the limiter's partition key). Because the framework middleware reads an
/// EMPTY trust list as "trust everyone", an unconfigured host does not add the middleware at all.
/// </para>
/// <para>
/// The middleware is handed its own options instance rather than reading
/// <c>IOptions&lt;ForwardedHeadersOptions&gt;</c>, so nothing else that configures those shared options can widen
/// the trust list this slice set.
/// </para>
/// </remarks>
public static class PulseForwardedHeadersExtensions
{
    /// <summary>
    /// Reads and validates the <c>ForwardedHeaders</c> configuration section and registers the resulting
    /// trusted-proxy settings. Fails fast (at startup) on an unparseable proxy address, CIDR network or a
    /// <c>ForwardLimit</c> below <c>1</c> — a silently dropped entry would leave the limiter collapsed.
    /// </summary>
    /// <param name="services">The service collection to register into.</param>
    /// <param name="configuration">The application configuration.</param>
    /// <returns>The same collection, for chaining.</returns>
    /// <remarks>
    /// <b>The framework switch.</b> When <c>ASPNETCORE_FORWARDEDHEADERS_ENABLED</c> (read as <c>ForwardedHeaders_Enabled</c>)
    /// is true, the web host registers its own <c>ForwardedHeadersStartupFilter</c>, which runs a forwarded-headers
    /// middleware ahead of the whole pipeline that trusts EVERY peer. Azure App Service on Linux can set that switch on
    /// the platform side, so the host must start with it on. This method therefore REMOVES that framework startup
    /// filter: only the trust list configured here is ever honored, and <see cref="UsePulseForwardedHeaders"/> logs a
    /// critical warning naming the key. (2026-10-17 UAT outage: an earlier version threw on the switch and the worker
    /// crash-looped with a 503.)
    /// </remarks>
    /// <exception cref="InvalidOperationException">The configuration section is invalid.</exception>
    public static IServiceCollection AddPulseForwardedHeaders(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        var frameworkSwitchOn = IsTrue(configuration["ForwardedHeaders_Enabled"])
            || IsTrue(configuration["ASPNETCORE_FORWARDEDHEADERS_ENABLED"]);
        var removed = RemoveFrameworkForwardedHeadersStartupFilter(services);

        var settings = new PulseForwardedHeadersOptions();
        configuration.GetSection(PulseForwardedHeadersOptions.SectionName).Bind(settings);

        services.AddSingleton(new PulseForwardedHeadersRegistration(BuildOptions(settings))
        {
            FrameworkSwitchNeutralised = frameworkSwitchOn || removed > 0,
        });

        return services;
    }

    /// <summary>
    /// Removes the web host's own forwarded-headers startup filter, which the host registers when the
    /// <c>ForwardedHeaders_Enabled</c> switch is on and which trusts every peer. Matched by type name because the type
    /// is internal to ASP.NET Core. A no-op when the switch is off (nothing is registered).
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>How many registrations were removed.</returns>
    internal static int RemoveFrameworkForwardedHeadersStartupFilter(IServiceCollection services)
    {
        var frameworkFilters = services
            .Where(d => d.ServiceType == typeof(IStartupFilter)
                && string.Equals(d.ImplementationType?.Name, "ForwardedHeadersStartupFilter", StringComparison.Ordinal))
            .ToList();

        foreach (var descriptor in frameworkFilters)
        {
            services.Remove(descriptor);
        }

        return frameworkFilters.Count;
    }

    /// <summary>
    /// Adds the forwarded-headers middleware, configured by <see cref="AddPulseForwardedHeaders"/>.
    /// </summary>
    /// <remarks>
    /// <b>Required ordering (orchestrator-owned).</b> This MUST be the FIRST middleware in the pipeline — directly
    /// after <c>builder.Build()</c>, before <c>UseCors</c>, <c>UseExerciseResolution</c>,
    /// <c>UseSessionAuthentication</c> and, above all, <c>UseRateLimiter</c>. Anything that runs before it reads
    /// the proxy's address and the proxy-to-app scheme; a rate limiter ahead of it partitions every client into
    /// the proxy's single bucket.
    /// </remarks>
    /// <param name="app">The application pipeline builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    /// <exception cref="InvalidOperationException"><see cref="AddPulseForwardedHeaders"/> was not called.</exception>
    public static IApplicationBuilder UsePulseForwardedHeaders(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        var registration = app.ApplicationServices.GetService<PulseForwardedHeadersRegistration>()
            ?? throw new InvalidOperationException(
                $"{nameof(UsePulseForwardedHeaders)}() requires {nameof(AddPulseForwardedHeaders)}() in the service registrations.");

        if (registration.FrameworkSwitchNeutralised)
        {
            // Key name only, never values. The framework's trust-every-peer middleware was removed at registration.
            app.ApplicationServices.GetService<ILoggerFactory>()?
                .CreateLogger(typeof(PulseForwardedHeadersExtensions).FullName!)
                .LogCritical(
                    "ASPNETCORE_FORWARDEDHEADERS_ENABLED is true in this environment. Its trust-every-peer forwarded-headers " +
                    "middleware was removed; only ForwardedHeaders:KnownNetworks / KnownProxies are honored. Set it to false " +
                    "(docs/OPERATE.md, trusted proxy).");
        }

        // Load-bearing: ForwardedHeadersMiddleware treats EMPTY KnownProxies + KnownIPNetworks as "trust every
        // peer" (it only checks the peer when at least one entry exists). With nothing configured the middleware
        // is therefore NOT added at all, so an unconfigured host honors no forwarded header from anyone.
        if (registration.Options.KnownProxies.Count == 0 && registration.Options.KnownIPNetworks.Count == 0)
        {
            return app;
        }

        return app.UseForwardedHeaders(registration.Options);
    }

    /// <summary>
    /// Builds the middleware options from the bound settings: X-Forwarded-For + X-Forwarded-Proto only, the
    /// framework's loopback defaults cleared, and exactly the configured proxies/networks trusted.
    /// </summary>
    /// <param name="settings">The bound trusted-proxy settings.</param>
    /// <returns>The forwarded-headers middleware options.</returns>
    /// <exception cref="InvalidOperationException">A setting is invalid.</exception>
    internal static ForwardedHeadersOptions BuildOptions(PulseForwardedHeadersOptions settings)
    {
        ArgumentNullException.ThrowIfNull(settings);

        if (settings.ForwardLimit < 1)
        {
            throw new InvalidOperationException(string.Format(
                CultureInfo.InvariantCulture,
                "{0}:ForwardLimit must be at least 1 (was {1}).",
                PulseForwardedHeadersOptions.SectionName,
                settings.ForwardLimit));
        }

        var options = new ForwardedHeadersOptions
        {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
            ForwardLimit = settings.ForwardLimit,
        };

        // The framework trusts loopback by default; Pulse trusts only what is configured.
        options.KnownProxies.Clear();
        options.KnownIPNetworks.Clear();

        foreach (var proxy in settings.KnownProxies.Where(p => !string.IsNullOrWhiteSpace(p)))
        {
            if (!IPAddress.TryParse(proxy.Trim(), out var address))
            {
                throw new InvalidOperationException(
                    $"{PulseForwardedHeadersOptions.SectionName}:KnownProxies entry '{proxy}' is not an IP address.");
            }

            options.KnownProxies.Add(address);
        }

        foreach (var network in settings.KnownNetworks.Where(n => !string.IsNullOrWhiteSpace(n)))
        {
            if (!System.Net.IPNetwork.TryParse(network.Trim(), out var parsed))
            {
                throw new InvalidOperationException(
                    $"{PulseForwardedHeadersOptions.SectionName}:KnownNetworks entry '{network}' is not a CIDR network.");
            }

            options.KnownIPNetworks.Add(parsed);
        }

        return options;
    }

    /// <summary>True only for a value that parses as a boolean <c>true</c> (case-insensitive).</summary>
    /// <param name="value">The raw configuration value.</param>
    /// <returns>Whether the value is <c>true</c>.</returns>
    private static bool IsTrue(string? value) => bool.TryParse(value, out var parsed) && parsed;
}

/// <summary>
/// The validated forwarded-headers middleware options, registered by
/// <see cref="PulseForwardedHeadersExtensions.AddPulseForwardedHeaders"/> and consumed by
/// <see cref="PulseForwardedHeadersExtensions.UsePulseForwardedHeaders"/>.
/// </summary>
internal sealed class PulseForwardedHeadersRegistration
{
    /// <summary>Wraps the built options.</summary>
    /// <param name="options">The middleware options.</param>
    public PulseForwardedHeadersRegistration(ForwardedHeadersOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        Options = options;
    }

    /// <summary>Gets the middleware options.</summary>
    public ForwardedHeadersOptions Options { get; }

    /// <summary>Gets a value indicating whether the framework's trust-every-peer switch was on and was neutralised.</summary>
    public bool FrameworkSwitchNeutralised { get; init; }
}
