namespace Pulse.WebApi.Tests.Features.Ops.OrgAdminSeed;

using System;
using System.Collections.Generic;
using System.IO;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Ops.OrgAdminSeed;

/// <summary>
/// Shared doubles and builders for the <see cref="OrgAdminSeedService"/> suites — a settable
/// <see cref="IHostEnvironment"/> (the production gate is the single most important thing these tests assert),
/// a capturing logger (the refusal paths are asserted, never assumed), and the seed-row factories.
/// </summary>
internal static class OrgAdminSeedTestKit
{
    /// <summary>A non-production environment name — the seeder's enabled state.</summary>
    public const string DevelopmentEnvironment = "Development";

    /// <summary>Builds an allowlist containing exactly one entry for the seeder's fixed target username.</summary>
    /// <param name="externalSubject">The IdP subject the entry resolves to; must be the one a login would resolve.</param>
    /// <param name="secret">The configured secret. Pass an EMPTY string for the "configured but unusable" case.</param>
    /// <param name="displayName">The display name the seeded staff user should carry.</param>
    /// <returns>Bound allowlist options.</returns>
    public static IOptions<DynamisIdentityProviderOptions> AllowlistFor(
        string externalSubject,
        string secret = "a-non-empty-placeholder",
        string displayName = "Seeded Org Admin") =>
        Options.Create(new DynamisIdentityProviderOptions
        {
            Accounts = new List<DynamisStaffAccount>
            {
                new()
                {
                    Username = OrgAdminSeedService.TargetUsername,
                    Secret = secret,
                    ExternalSubject = externalSubject,
                    DisplayName = displayName,
                },
            },
        });

    /// <summary>An allowlist that does NOT contain the seeder's target username.</summary>
    /// <returns>Bound allowlist options holding one unrelated entry.</returns>
    public static IOptions<DynamisIdentityProviderOptions> AllowlistWithoutTheTarget() =>
        Options.Create(new DynamisIdentityProviderOptions
        {
            Accounts = new List<DynamisStaffAccount>
            {
                new()
                {
                    Username = $"someone-else-{Guid.NewGuid():N}@dynamis.com",
                    Secret = "a-non-empty-placeholder",
                    ExternalSubject = $"idp|{Guid.NewGuid():N}",
                    DisplayName = "Somebody Else",
                },
            },
        });

    /// <summary>
    /// Builds a provider through the REAL composition-root seam — <c>AddStaffIdentity(...)</c> then
    /// <c>AddOrgAdminSeed(...)</c>, in the order <c>Program.cs</c> wires them — so what the zero-config tests
    /// observe is the allowlist the production registration path actually produces, not one a test assembled.
    /// </summary>
    /// <remarks>
    /// No <c>DbContext</c> is registered: everything these tests resolve from here
    /// (<see cref="IIdentityProvider"/>, the bound options, <see cref="DefaultOrgAdminAccountState"/>) needs no
    /// database, and leaving it out means a mis-registration cannot hide behind a connection error.
    /// </remarks>
    /// <param name="environmentName">The host environment the production gate is evaluated against.</param>
    /// <param name="configurationValues">Raw configuration keys, or <c>null</c> for the zero-config case (NO <c>Authentication:StaffIdentity</c> at all).</param>
    /// <returns>A built provider the caller disposes.</returns>
    public static ServiceProvider BuildRegisteredProvider(
        string environmentName = DevelopmentEnvironment,
        IDictionary<string, string?>? configurationValues = null)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(configurationValues ?? new Dictionary<string, string?>())
            .Build();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddStaffIdentity(configuration);
        services.AddOrgAdminSeed(new TestHostEnvironment(environmentName), configuration);

        return services.BuildServiceProvider();
    }

    /// <summary>
    /// The configuration keys for one REAL allowlist entry for the default account's username — the thing that
    /// must beat the injected default.
    /// </summary>
    /// <param name="secret">The operator's own secret (never the published default).</param>
    /// <param name="externalSubject">The operator's own IdP subject.</param>
    /// <param name="displayName">The operator's own display name.</param>
    /// <returns>Configuration values for an in-memory configuration source.</returns>
    public static Dictionary<string, string?> ConfiguredEntryForTheDefaultUsername(
        string secret,
        string externalSubject,
        string displayName = "Configured Operator") => new(StringComparer.Ordinal)
    {
        ["Authentication:StaffIdentity:Accounts:0:Username"] = DefaultOrgAdminAccount.Username,
        ["Authentication:StaffIdentity:Accounts:0:Secret"] = secret,
        ["Authentication:StaffIdentity:Accounts:0:ExternalSubject"] = externalSubject,
        ["Authentication:StaffIdentity:Accounts:0:DisplayName"] = displayName,
    };

    /// <summary>
    /// Resolves the MATERIALIZED allowlist from a registered provider and re-wraps it, so the caller can keep
    /// using the exact options instance the registration produced after the provider is gone.
    /// </summary>
    /// <param name="provider">A provider built by <see cref="BuildRegisteredProvider"/>.</param>
    /// <returns>The bound allowlist, including any registration-time injection.</returns>
    public static IOptions<DynamisIdentityProviderOptions> RegisteredAllowlist(IServiceProvider provider)
    {
        ArgumentNullException.ThrowIfNull(provider);

        // Reading .Value is what runs the PostConfigure that may inject the default account.
        return Options.Create(provider.GetRequiredService<IOptions<DynamisIdentityProviderOptions>>().Value);
    }

    /// <summary>Builds the service under test.</summary>
    /// <param name="context">The real-SQL persistence context.</param>
    /// <param name="allowlist">The configured staff allowlist.</param>
    /// <param name="logger">The capturing logger.</param>
    /// <param name="environmentName">The host environment name the gate is evaluated against.</param>
    /// <returns>A seeder wired over the supplied collaborators.</returns>
    public static OrgAdminSeedService NewService(
        PulseDbContext context,
        IOptions<DynamisIdentityProviderOptions> allowlist,
        ILogger<OrgAdminSeedService>? logger = null,
        string environmentName = DevelopmentEnvironment) =>
        new(
            context,
            allowlist,
            new TestHostEnvironment(environmentName),
            logger ?? NullLogger<OrgAdminSeedService>.Instance);

    /// <summary>A fresh customer tenant with a globally-unique name (the Name column is uniquely indexed).</summary>
    /// <param name="id">The tenant id.</param>
    /// <returns>An unsaved organization row.</returns>
    public static Organization NewOrganization(Guid id) => new()
    {
        Id = id,
        Name = $"Seeder Customer {id:N}",
        CreatedAt = DateTimeOffset.UtcNow,
    };

    /// <summary>An exercise owned by <paramref name="organizationId"/>.</summary>
    /// <param name="organizationId">The owning tenant.</param>
    /// <returns>An unsaved exercise row.</returns>
    public static Exercise NewExercise(Guid organizationId) => new()
    {
        Id = Guid.NewGuid(),
        OrganizationId = organizationId,
        Name = $"Seeder Run {Guid.NewGuid():N}",
        TimeZone = "America/Chicago",
        Status = "live",
        CreatedAt = DateTimeOffset.UtcNow.AddDays(-1),
    };

    /// <summary>A staff human homed to <paramref name="organizationId"/>.</summary>
    /// <param name="organizationId">The owning tenant.</param>
    /// <param name="externalSubject">The IdP subject (uniquely indexed).</param>
    /// <returns>An unsaved staff-user row.</returns>
    public static StaffUser NewStaffUser(Guid organizationId, string externalSubject) => new()
    {
        Id = Guid.NewGuid(),
        OrganizationId = organizationId,
        ExternalSubject = externalSubject,
        DisplayName = $"Pre-seeded Human {Guid.NewGuid():N}",
        CreatedAt = DateTimeOffset.UtcNow,
    };

    /// <summary>An assignment granting <paramref name="role"/> on one exercise.</summary>
    /// <param name="staffUserId">The staff human.</param>
    /// <param name="exerciseId">The exercise.</param>
    /// <param name="role">The role literal stored verbatim.</param>
    /// <returns>An unsaved assignment row.</returns>
    public static StaffAssignment NewAssignment(Guid staffUserId, Guid exerciseId, string role) => new()
    {
        Id = Guid.NewGuid(),
        StaffUserId = staffUserId,
        ExerciseId = exerciseId,
        Role = role,
        CreatedAt = DateTimeOffset.UtcNow,
    };
}

/// <summary>
/// A settable <see cref="IHostEnvironment"/>. The production gate is the assertion this whole feature turns on,
/// so the environment has to be an INPUT the tests control, not something inherited from the test runner.
/// </summary>
/// <param name="environmentName">The environment name to report.</param>
internal sealed class TestHostEnvironment(string environmentName) : IHostEnvironment
{
    /// <inheritdoc />
    public string EnvironmentName { get; set; } = environmentName;

    /// <inheritdoc />
    public string ApplicationName { get; set; } = "Pulse.WebApi.Tests";

    /// <inheritdoc />
    public string ContentRootPath { get; set; } = AppContext.BaseDirectory;

    /// <inheritdoc />
    public IFileProvider ContentRootFileProvider { get; set; } =
        new PhysicalFileProvider(Path.GetFullPath(AppContext.BaseDirectory));
}

/// <summary>One captured log record.</summary>
/// <param name="Level">The level it was written at.</param>
/// <param name="Message">The formatted message.</param>
internal sealed record OrgAdminSeedLogEntry(LogLevel Level, string Message);

/// <summary>
/// An <see cref="ILogger{TCategoryName}"/> that records what was written, so the seeder's "refuse loudly"
/// contract is asserted rather than assumed — a silent refusal and a logged one are indistinguishable from the
/// database alone, and the silent one is the defect.
/// </summary>
internal sealed class CapturingSeedLogger : ILogger<OrgAdminSeedService>
{
    /// <summary>Everything logged, in order.</summary>
    public List<OrgAdminSeedLogEntry> Entries { get; } = [];

    /// <inheritdoc />
    public IDisposable BeginScope<TState>(TState state)
        where TState : notnull => NullLogger.Instance.BeginScope(state);

    /// <inheritdoc />
    public bool IsEnabled(LogLevel logLevel) => true;

    /// <inheritdoc />
    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        ArgumentNullException.ThrowIfNull(formatter);
        Entries.Add(new OrgAdminSeedLogEntry(logLevel, formatter(state, exception)));
    }
}
