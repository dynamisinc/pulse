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
/// <para>
/// Starts the container and applies the initial migration exactly ONCE (<see cref="InitializeAsync"/>);
/// every test builds its own short-lived <see cref="PulseDbContext"/> against the same connection string
/// via <see cref="CreateContext"/> so tests don't share a tracked-entity change tracker with each other.
/// Tests use fresh <see cref="Guid.NewGuid"/> ids per test rather than truncating tables between tests, so
/// they remain independent under xUnit's default within-collection sequential / cross-collection parallel
/// execution without needing a database reset between tests.
/// </para>
/// <para>
/// Gate-1 W-001: this fixture does NOT catch/swallow a container start or migration failure. Tests that
/// need it are gated by <see cref="RequiresDockerFactAttribute"/>, which already skips them (a real
/// <c>Skipped</c> xUnit outcome, decided at discovery time) when the Docker daemon itself is unreachable.
/// So by the time <see cref="InitializeAsync"/> actually runs, Docker was already observed to be present —
/// if the container still fails to start or the migration still fails here, that is a genuine
/// infrastructure or product regression, and it must FAIL the collection's tests loudly (xUnit reports a
/// collection-fixture initialization failure against every test in the collection), not get masked as a
/// quiet skip or, worse, a quiet pass.
/// </para>
/// </remarks>
public sealed class MsSqlContainerFixture : IAsyncLifetime
{
    static MsSqlContainerFixture()
    {
        // Ryuk (Testcontainers' resource-reaper sidecar) is a container LIFECYCLE convenience — it garbage
        // collects orphaned containers if a test run crashes uncleanly — not part of what these tests
        // exercise. Some sandboxed/offline-registry environments can reach the MSSQL image (already local)
        // but not `testcontainers/ryuk` on Docker Hub; disabling it is Testcontainers' own documented
        // escape hatch (equivalent to the `TESTCONTAINERS_RYUK_DISABLED` env var) for exactly that case,
        // not a weakening of any test assertion. `DisposeAsync` below still explicitly disposes the
        // container per run either way.
        DotNet.Testcontainers.Configurations.TestcontainersSettings.ResourceReaperEnabled = false;
    }

    private MsSqlContainer? _container;

    /// <summary>
    /// The migrated container's connection string. Exposed (widened from private) so a
    /// <c>WebApplicationFactory</c>-based integration test can point the booted host's
    /// <see cref="PulseDbContext"/> at the same database this fixture migrated — see
    /// <c>Telemetry/TelemetryIngestTests</c>. Null until <see cref="InitializeAsync"/> has run.
    /// </summary>
    public string? ConnectionString { get; private set; }

    /// <inheritdoc />
    public async Task InitializeAsync()
    {
        _container = new MsSqlBuilder("mcr.microsoft.com/mssql/server:2022-latest")
            .Build();
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();

        await using var migrationContext = CreateContext();
        await migrationContext.Database.MigrateAsync();
    }

    /// <inheritdoc />
    public async Task DisposeAsync()
    {
        if (_container is not null)
        {
            await _container.DisposeAsync();
        }
    }

    /// <summary>
    /// Builds a fresh, independently-tracked <see cref="PulseDbContext"/> against the shared container with
    /// NO exercise scope resolved — the fail-closed default. Used by the persistence/write-guard tests,
    /// which read back through <c>IgnoreQueryFilters()</c> to assert physical persistence independently of
    /// the read-side filter.
    /// </summary>
    public PulseDbContext CreateContext() => CreateContext(exerciseContext: null);

    /// <summary>
    /// Builds a fresh, independently-tracked <see cref="PulseDbContext"/> against the shared container whose
    /// read-side global query filter is bound to <paramref name="exerciseContext"/>. Pass <c>null</c> for
    /// the fail-closed "no scope resolved" case.
    /// </summary>
    public PulseDbContext CreateContext(IExerciseContext? exerciseContext)
    {
        if (ConnectionString is null)
        {
            throw new InvalidOperationException(
                "MsSqlContainerFixture.CreateContext() called before the container started successfully.");
        }

        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(ConnectionString)
            .Options;

        return new PulseDbContext(options, exerciseContext);
    }
}

/// <summary>xUnit collection so every test class below shares one container/migration instead of one each.</summary>
[CollectionDefinition(Name)]
public sealed class MsSqlCollection : ICollectionFixture<MsSqlContainerFixture>
{
    public const string Name = "MsSql collection";
}
