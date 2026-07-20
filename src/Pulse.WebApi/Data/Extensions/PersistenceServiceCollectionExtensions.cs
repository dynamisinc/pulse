namespace Pulse.WebApi.Data.Extensions;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

/// <summary>
/// Composition-root extension for Pulse persistence — mirrors the <c>AddEngineGeneration(...)</c> idiom
/// established in <c>Pulse.Core</c>. The orchestrator wires the single call into <c>Program.cs</c> between
/// waves; this story does NOT edit <c>Program.cs</c> itself.
/// </summary>
public static class PersistenceServiceCollectionExtensions
{
    /// <summary>
    /// Registers <see cref="PulseDbContext"/> against Azure SQL (the <c>ConnectionStrings:DefaultConnection</c>
    /// key <c>infrastructure/modules/webapp.bicep</c> provisions) plus a <c>DbContext</c> health check.
    /// </summary>
    public static IServiceCollection AddPulsePersistence(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        var connectionString = configuration.GetConnectionString("DefaultConnection");

        services.AddDbContext<PulseDbContext>(options =>
            options.UseSqlServer(connectionString));

        services.AddHealthChecks()
            .AddDbContextCheck<PulseDbContext>();

        return services;
    }
}
