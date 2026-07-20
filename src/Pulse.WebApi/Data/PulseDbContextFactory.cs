namespace Pulse.WebApi.Data;

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

/// <summary>
/// Design-time factory so <c>dotnet ef migrations add</c> / <c>dotnet ef database update</c> can build a
/// <see cref="PulseDbContext"/> independently of the runtime host's <c>AddPulsePersistence</c> registration
/// (the EF CLI resolves this factory directly rather than booting <c>Program.cs</c>). The placeholder
/// connection string is used ONLY to fix the SQL Server provider for scaffolding — it is never opened
/// during migration generation.
/// </summary>
public sealed class PulseDbContextFactory : IDesignTimeDbContextFactory<PulseDbContext>
{
    /// <inheritdoc />
    public PulseDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer("Server=localhost;Database=pulse_design;Trusted_Connection=True;TrustServerCertificate=True")
            .Options;

        return new PulseDbContext(options);
    }
}
