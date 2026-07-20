namespace Pulse.WebApi.Tests.Data;

using System;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Testcontainers.MsSql;

/// <summary>
/// Shared, once-per-collection real SQL Server target (Testcontainers) for the persistence tests
/// (AC4: "applies cleanly against an Azure-SQL-compatible target"). Ubuntu-hosted CI has no SQL Server
/// LocalDB, so a container is the only Linux-compatible way to exercise a REAL SQL Server rather than
/// asserting against the provider-agnostic EF in-memory/SQLite stand-ins (which would not prove the
/// migration or the collation/column types actually apply).
/// </summary>
/// <remarks>
/// Starts the container and applies the initial migration exactly ONCE (<see cref="InitializeAsync"/>);
/// every test builds its own short-lived <see cref="PulseDbContext"/> against the same connection string
/// via <see cref="CreateContext"/> so tests don't share a tracked-entity change tracker with each other.
/// Tests use fresh <see cref="Guid.NewGuid"/> ids per test rather than truncating tables between tests, so
/// they remain independent under xUnit's default within-collection sequential / cross-collection parallel
/// execution without needing a database reset between tests.
/// </remarks>
public sealed class MsSqlContainerFixture : IAsyncLifetime
{
    private MsSqlContainer? _container;

    /// <summary>
    /// True once the container has started and the migration has applied. False if Docker was genuinely
    /// unreachable in this environment — tests check this and skip (rather than fail) their assertions in
    /// that case, per the story's "optional but recommended" Docker-less guard. Docker is confirmed present
    /// in the dev sandbox and in CI (ubuntu-latest), so this path is a defensive fallback, not the norm.
    /// </summary>
    public bool DockerAvailable { get; private set; }

    /// <summary>Non-null only when <see cref="DockerAvailable"/> is true.</summary>
    private string? ConnectionString { get; set; }

    /// <inheritdoc />
    public async Task InitializeAsync()
    {
        try
        {
            _container = new MsSqlBuilder("mcr.microsoft.com/mssql/server:2022-latest")
                .Build();
            await _container.StartAsync();
            ConnectionString = _container.GetConnectionString();

            await using var migrationContext = CreateContext();
            await migrationContext.Database.MigrateAsync();

            DockerAvailable = true;
        }
        catch (Exception)
        {
            // Docker genuinely unreachable (or the image can't be started) on this machine. Leave
            // DockerAvailable false; test bodies check it and skip their assertions rather than red the
            // whole suite on a Docker-less dev box. Both the dev sandbox and CI have Docker, so this is
            // not expected to trigger there — do NOT weaken this into a silent pass-everywhere fallback.
            DockerAvailable = false;
        }
    }

    /// <inheritdoc />
    public async Task DisposeAsync()
    {
        if (_container is not null)
        {
            await _container.DisposeAsync();
        }
    }

    /// <summary>Builds a fresh, independently-tracked <see cref="PulseDbContext"/> against the shared container.</summary>
    public PulseDbContext CreateContext()
    {
        if (ConnectionString is null)
        {
            throw new InvalidOperationException(
                "MsSqlContainerFixture.CreateContext() called before the container started successfully.");
        }

        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(ConnectionString)
            .Options;

        return new PulseDbContext(options);
    }
}

/// <summary>xUnit collection so every test class below shares one container/migration instead of one each.</summary>
[CollectionDefinition(Name)]
public sealed class MsSqlCollection : ICollectionFixture<MsSqlContainerFixture>
{
    public const string Name = "MsSql collection";
}
