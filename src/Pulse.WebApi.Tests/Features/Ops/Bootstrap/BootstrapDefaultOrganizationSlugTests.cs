namespace Pulse.WebApi.Tests.Features.Ops.Bootstrap;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Ops.Bootstrap;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// #602 L-5 — when <see cref="BootstrapService"/> has to (re-)create the DEFAULT organization, its slug takes the SAME
/// <c>-2</c>, <c>-3</c>… collision suffix the <c>AdminIdentityFoundation</c> backfill applies, so a pre-existing
/// organization already holding <c>default-organization</c> can never trip the unique slug index (which would fail the
/// whole bootstrap). Runs in a PRIVATE, fully migrated database on the shared SQL Server — the create branch needs the
/// default organization row to be absent, which the shared database must never be.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class BootstrapDefaultOrganizationSlugTests
{
    private const string Secret = "s3cr3t-bootstrap-value";

    private readonly MsSqlContainerFixture _fixture;

    public BootstrapDefaultOrganizationSlugTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [Fact]
    public void TheCollisionSuffix_MirrorsTheBackfillRule()
    {
        OrganizationSlug.WithCollisionSuffix("default-organization", 2).Should().Be("default-organization-2");
        OrganizationSlug.WithCollisionSuffix("default-organization", 10).Should().Be("default-organization-10");

        // LEFT(@base, 63 - LEN(@suffix)) + @suffix: a maximal base is cut to make room, never overflowing the column.
        var longBase = new string('a', Organization.MaxSlugLength);
        var suffixed = OrganizationSlug.WithCollisionSuffix(longBase, 12);
        suffixed.Should().HaveLength(Organization.MaxSlugLength).And.EndWith("-12");

        var act = () => OrganizationSlug.WithCollisionSuffix("x", 1);
        act.Should().Throw<ArgumentOutOfRangeException>("the backfill's first suffix is -2");
    }

    [RequiresDockerFact]
    public async Task RecreatingTheDefaultOrganization_SuffixesItsSlug_PastExistingOnes()
    {
        await using var database = await PrivateDatabase.CreateAsync(_fixture);
        var baseSlug = OrganizationSlug.FromName(Organization.DefaultOrganizationName);

        await using (var seed = database.Context())
        {
            // The create branch only runs when the default organization row is gone; others already hold its slug
            // and the first suffix.
            await seed.Organizations.Where(o => o.Id == Organization.DefaultOrganizationId).ExecuteDeleteAsync();
            seed.Organizations.Add(new Organization { Id = Guid.NewGuid(), Name = "Squatter", Slug = baseSlug, CreatedAt = DateTimeOffset.UtcNow });
            seed.Organizations.Add(new Organization { Id = Guid.NewGuid(), Name = "Squatter 2", Slug = baseSlug + "-2", CreatedAt = DateTimeOffset.UtcNow });
            await seed.SaveChangesAsync();
        }

        BootstrapResult result;
        await using (var context = database.Context())
        {
            result = await new BootstrapService(
                    context,
                    Options.Create(new BootstrapOptions { Secret = Secret }),
                    Options.Create(new DynamisIdentityProviderOptions { Accounts = new List<DynamisStaffAccount>() }),
                    new SharedCredentialHasher(),
                    new ParticipantPasswordHasher(),
                    new OpsPersonaResolver(context))
                .BootstrapAsync(
                    new BootstrapExerciseRequest { Hostname = $"uat-{Guid.NewGuid():N}.example.com", ExerciseName = "Slug collision" },
                    Secret);
        }

        result.Outcome.Should().Be(BootstrapOutcome.Provisioned, "a slug collision must never fail the bootstrap");

        await using var read = database.Context();
        var recreated = await read.Organizations.AsNoTracking().SingleAsync(o => o.Id == Organization.DefaultOrganizationId);
        recreated.Slug.Should().Be(baseSlug + "-3", "the backfill's suffix rule, past every slug already taken");
        recreated.Name.Should().Be(Organization.DefaultOrganizationName);
    }

    /// <summary>A throwaway, fully migrated database on the fixture's server, dropped on dispose.</summary>
    private sealed class PrivateDatabase : IAsyncDisposable
    {
        private readonly string _master;
        private readonly string _name;
        private readonly string _connectionString;

        private PrivateDatabase(string master, string name, string connectionString)
        {
            _master = master;
            _name = name;
            _connectionString = connectionString;
        }

        public static async Task<PrivateDatabase> CreateAsync(MsSqlContainerFixture fixture)
        {
            var connectionString = fixture.ConnectionString
                ?? throw new InvalidOperationException("The shared MSSQL fixture has no connection string — it did not initialize.");

            // GUID-derived name: no injection surface, and bracket-quoted regardless.
            var name = $"PulseBootstrapSlug_{Guid.NewGuid():N}";
            var master = new SqlConnectionStringBuilder(connectionString) { InitialCatalog = "master" }.ConnectionString;
            await ExecuteAsync(master, $"CREATE DATABASE [{name}];");

            var database = new PrivateDatabase(
                master, name, new SqlConnectionStringBuilder(connectionString) { InitialCatalog = name }.ConnectionString);
            await using (var context = database.Context())
            {
                await context.Database.MigrateAsync();
            }

            return database;
        }

        public PulseDbContext Context() =>
            new(new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(_connectionString).Options, null, null);

        public async ValueTask DisposeAsync()
        {
            SqlConnection.ClearAllPools();
            await ExecuteAsync(_master, $"ALTER DATABASE [{_name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{_name}];");
        }

        private static async Task ExecuteAsync(string connectionString, string sql)
        {
            await using var connection = new SqlConnection(connectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            command.CommandTimeout = 120;
            await command.ExecuteNonQueryAsync();
        }
    }
}
