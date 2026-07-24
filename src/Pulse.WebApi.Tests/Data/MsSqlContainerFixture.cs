namespace Pulse.WebApi.Tests.Data;

using System;
using System.Threading.Tasks;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Testcontainers.MsSql;

/// <summary>
/// Shared, once-per-collection real SQL Server target for the persistence tests (AC4: "applies cleanly
/// against an Azure-SQL-compatible target"). Real SQL Server — not the provider-agnostic EF in-memory/
/// SQLite stand-ins — is the point: only it proves the migration and the collation/column types actually
/// apply.
/// </summary>
/// <remarks>
/// <para>
/// <b>Two ways to get that real SQL Server, chosen at <see cref="InitializeAsync"/>:</b>
/// </para>
/// <list type="number">
/// <item>
/// <b>Local SQL Server (Docker-free)</b> — when <see cref="LocalSqlConnectionEnvVar"/>
/// (<c>PULSE_TEST_SQL_CONNECTION</c>) is set (e.g. to a LocalDB instance:
/// <c>Server=(localdb)\MSSQLLocalDB;Integrated Security=true;TrustServerCertificate=true</c>), the fixture
/// creates a fresh, uniquely-named ephemeral database on THAT server, migrates it, and drops it on dispose —
/// so a developer with SQL Server / LocalDB but no Docker can run the full suite locally. The env var must be
/// set before <c>dotnet test</c> (it is read at test discovery by <see cref="RequiresDockerFactAttribute"/>
/// as well, so the tests <i>run</i> rather than skip).
/// </item>
/// <item>
/// <b>Testcontainers (default, CI)</b> — when the env var is unset, the fixture starts an ephemeral
/// <c>mcr.microsoft.com/mssql/server:2022-latest</c> container. Ubuntu-hosted CI has no SQL Server LocalDB,
/// so a container is the only Linux-compatible way to reach a real SQL Server. Unchanged from before.
/// </item>
/// </list>
/// <para>
/// Either way the database is applied ONCE (<see cref="InitializeAsync"/>); every test builds its own
/// short-lived <see cref="PulseDbContext"/> against the same connection string via <see cref="CreateContext"/>
/// so tests don't share a tracked-entity change tracker. Tests use fresh <see cref="Guid.NewGuid"/> ids per
/// test rather than truncating tables between tests, so they remain independent without a per-test reset.
/// </para>
/// <para>
/// Gate-1 W-001: this fixture does NOT catch/swallow a container start or migration failure. Tests that need
/// it are gated by <see cref="RequiresDockerFactAttribute"/>, which skips them (a real <c>Skipped</c> xUnit
/// outcome, decided at discovery time) only when NEITHER a local SQL connection string NOR a reachable Docker
/// daemon is present. So by the time <see cref="InitializeAsync"/> runs, a real SQL target was already
/// observed; a container/DB start or migration failure here is a genuine infrastructure or product
/// regression and must FAIL the collection's tests loudly, not get masked as a quiet skip or pass.
/// </para>
/// </remarks>
public sealed class MsSqlContainerFixture : IAsyncLifetime
{
    /// <summary>
    /// Env var holding a SQL Server connection string for the Docker-free local path. When set, the fixture
    /// targets that server (creating an ephemeral per-run database) instead of starting a container; when
    /// unset, the fixture falls back to Testcontainers (CI's path). Also consulted by
    /// <see cref="RequiresDockerFactAttribute"/> so the gated tests run rather than skip.
    /// </summary>
    public const string LocalSqlConnectionEnvVar = "PULSE_TEST_SQL_CONNECTION";

    static MsSqlContainerFixture()
    {
        // Ryuk (Testcontainers' resource-reaper sidecar) is a container LIFECYCLE convenience — it garbage
        // collects orphaned containers if a test run crashes uncleanly — not part of what these tests
        // exercise. Some sandboxed/offline-registry environments can reach the MSSQL image (already local)
        // but not `testcontainers/ryuk` on Docker Hub; disabling it is Testcontainers' own documented
        // escape hatch (equivalent to the `TESTCONTAINERS_RYUK_DISABLED` env var) for exactly that case,
        // not a weakening of any test assertion. `DisposeAsync` below still explicitly disposes the
        // container per run either way. (Harmless no-op on the local-SQL path, which starts no container.)
        DotNet.Testcontainers.Configurations.TestcontainersSettings.ResourceReaperEnabled = false;
    }

    private MsSqlContainer? _container;

    // Set only on the local-SQL path — the ephemeral database created for this run, and a master-scoped
    // connection string used to CREATE/DROP it.
    private string? _localDatabaseName;
    private string? _localMasterConnectionString;

    /// <summary>
    /// The migrated database's connection string. Exposed (widened from private) so a
    /// <c>WebApplicationFactory</c>-based integration test can point the booted host's
    /// <see cref="PulseDbContext"/> at the same database this fixture migrated — see
    /// <c>Telemetry/TelemetryIngestTests</c>. Null until <see cref="InitializeAsync"/> has run.
    /// </summary>
    public string? ConnectionString { get; private set; }

    /// <inheritdoc />
    public async Task InitializeAsync()
    {
        var localConnection = Environment.GetEnvironmentVariable(LocalSqlConnectionEnvVar);
        if (!string.IsNullOrWhiteSpace(localConnection))
        {
            // Docker-free path: create an ephemeral, uniquely-named database on the provided SQL Server so
            // each run is isolated and self-cleaning, exactly like a fresh container would be. The database
            // name is a GUID-derived identifier (no injection surface); it is bracket-quoted regardless.
            _localDatabaseName = $"PulseTest_{Guid.NewGuid():N}";
            _localMasterConnectionString =
                new SqlConnectionStringBuilder(localConnection) { InitialCatalog = "master" }.ConnectionString;

            await ExecuteNonQueryAsync(_localMasterConnectionString, $"CREATE DATABASE [{_localDatabaseName}];");

            ConnectionString =
                new SqlConnectionStringBuilder(localConnection) { InitialCatalog = _localDatabaseName }.ConnectionString;
        }
        else
        {
            _container = new MsSqlBuilder("mcr.microsoft.com/mssql/server:2022-latest")
                .Build();
            await _container.StartAsync();
            ConnectionString = _container.GetConnectionString();
        }

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
        else if (_localDatabaseName is not null && _localMasterConnectionString is not null)
        {
            // Release pooled connections to the ephemeral DB, then force-drop it (SINGLE_USER WITH ROLLBACK
            // IMMEDIATE evicts any lingering session so the DROP can proceed even if a pooled connection
            // survived). Best-effort: a failure to drop must not fail the run — the DB name is unique per run.
            try
            {
                SqlConnection.ClearAllPools();
                await ExecuteNonQueryAsync(
                    _localMasterConnectionString,
                    $"IF DB_ID('{_localDatabaseName}') IS NOT NULL " +
                    $"BEGIN ALTER DATABASE [{_localDatabaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; " +
                    $"DROP DATABASE [{_localDatabaseName}]; END");
            }
            catch (SqlException)
            {
                // Leaving an orphaned, uniquely-named PulseTest_* database behind is preferable to failing
                // the test run on teardown; it can be dropped manually if it ever matters.
            }
        }
    }

    /// <summary>
    /// Builds a fresh, independently-tracked <see cref="PulseDbContext"/> against the shared database with
    /// NO exercise scope resolved — the fail-closed default. Used by the persistence/write-guard tests,
    /// which read back through <c>IgnoreQueryFilters()</c> to assert physical persistence independently of
    /// the read-side filter.
    /// </summary>
    public PulseDbContext CreateContext() => CreateContext(exerciseContext: null);

    /// <summary>
    /// Builds a fresh, independently-tracked <see cref="PulseDbContext"/> against the shared database whose
    /// read-side global query filter is bound to <paramref name="exerciseContext"/>. Pass <c>null</c> for
    /// the fail-closed "no scope resolved" case.
    /// </summary>
    public PulseDbContext CreateContext(IExerciseContext? exerciseContext)
    {
        if (ConnectionString is null)
        {
            throw new InvalidOperationException(
                "MsSqlContainerFixture.CreateContext() called before the database was provisioned successfully.");
        }

        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(ConnectionString)
            .Options;

        return new PulseDbContext(options, exerciseContext);
    }

    /// <summary>Opens a connection and runs a single non-query statement (DDL for the ephemeral test DB).</summary>
    private static async Task ExecuteNonQueryAsync(string connectionString, string sql)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }
}

/// <summary>xUnit collection so every test class below shares one database/migration instead of one each.</summary>
[CollectionDefinition(Name)]
public sealed class MsSqlCollection : ICollectionFixture<MsSqlContainerFixture>
{
    public const string Name = "MsSql collection";
}
