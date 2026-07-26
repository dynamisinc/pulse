namespace Pulse.WebApi.Data;

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

/// <summary>
/// Design-time factory so <c>dotnet ef migrations add</c> / <c>dotnet ef database update</c> can build a
/// <see cref="PulseDbContext"/> independently of the runtime host's <c>AddPulsePersistence</c> registration
/// (the EF CLI resolves this factory directly rather than booting <c>Program.cs</c>).
/// </summary>
/// <remarks>
/// <b>The connection string this factory returns IS opened by <c>database update</c>.</b> It is only inert for
/// <c>migrations add</c>/<c>script</c>, which need the string solely to fix the SQL Server provider for
/// scaffolding. That distinction used to be documented the other way round, and the factory hardcoded a
/// <c>pulse_design</c> connection — so <c>dotnet ef database update</c> silently applied migrations to the
/// scaffolding database while ignoring the <c>ConnectionStrings__DefaultConnection</c> the operator had set
/// for the host. It reported "Done." either way, which is the worst version of that failure.
/// <para>
/// Resolution order, highest first:
/// <list type="number">
///   <item><description><c>dotnet ef --connection "&lt;conn&gt;"</c> — the EF CLI overrides this factory
///   entirely, so it still wins and remains the explicit way to target one database for one command.</description></item>
///   <item><description><c>ConnectionStrings:DefaultConnection</c> from environment variables, user secrets,
///   or <c>appsettings[.{Environment}].json</c> — i.e. <b>the same key and the same sources the running host
///   uses</b> (<c>PersistenceServiceCollectionExtensions</c>), so configuring the app once configures
///   migrations too.</description></item>
///   <item><description><see cref="ScaffoldingFallbackConnection"/> — a last-resort placeholder that keeps
///   <c>migrations add</c> working on a machine with no configuration at all. It names a database that is
///   deliberately NOT any real environment, so an accidental <c>database update</c> against it cannot
///   corrupt a developer's working database.</description></item>
/// </list>
/// </para>
/// </remarks>
public sealed class PulseDbContextFactory : IDesignTimeDbContextFactory<PulseDbContext>
{
    /// <summary>
    /// Placeholder used only when nothing is configured. Sufficient to fix the provider for scaffolding;
    /// the <c>pulse_design</c> name signals that it is a scaffolding target, not a real environment.
    /// </summary>
    private const string ScaffoldingFallbackConnection =
        "Server=localhost;Database=pulse_design;Trusted_Connection=True;TrustServerCertificate=True";

    /// <inheritdoc />
    public PulseDbContext CreateDbContext(string[] args)
    {
        // Mirrors the host's own configuration sources so one setting serves both. `optional: true`
        // throughout: the EF CLI may run from a directory with no appsettings present, and scaffolding
        // must still work there.
        var environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Development";

        var configuration = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appsettings.json", optional: true)
            .AddJsonFile($"appsettings.{environment}.json", optional: true)
            .AddUserSecrets<PulseDbContextFactory>(optional: true)
            .AddEnvironmentVariables()
            .Build();

        var connectionString = configuration.GetConnectionString("DefaultConnection");

        if (string.IsNullOrWhiteSpace(connectionString))
        {
            connectionString = ScaffoldingFallbackConnection;
        }

        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(connectionString)
            .Options;

        return new PulseDbContext(options);
    }
}
