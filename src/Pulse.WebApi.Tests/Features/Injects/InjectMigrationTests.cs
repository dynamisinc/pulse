namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// Story 06 AC "Model": the inject-queue migration applies on a real SQL Server (Up, Down, and Up again from the
/// migration before it), creates both tables with the concurrency column, and round-trips an item whose child carries
/// a JSON media column. Located by NAME, so it keeps working when the migration is regenerated on top of another
/// story's. (The deploy's idempotent-script shape is covered for every migration by
/// <see cref="IdempotentMigrationScriptTests"/>.)
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class InjectMigrationTests
{
    private const string MigrationSuffix = "_InjectQueueItems";

    private readonly MsSqlContainerFixture _fixture;

    public InjectMigrationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task TheMigration_IsAppliedToTheSharedDatabase_WithBothTables()
    {
        await using var context = _fixture.CreateContext();

        (await context.Database.GetAppliedMigrationsAsync()).Should().Contain(id => id.EndsWith(MigrationSuffix, StringComparison.Ordinal));
        (await ColumnsAsync(context, "InjectItems")).Should().Contain(["Id", "ExerciseId", "Status", "Version", "ShiftSeconds", "DeletedAt"]);
        (await ColumnsAsync(context, "InjectItemPosts")).Should().Contain(["Id", "ExerciseId", "InjectItemId", "Media", "ClaimedAt", "FiredPostId", "DeletedAt"]);
    }

    [RequiresDockerFact]
    public async Task TheMigration_GoesUpDownAndUpAgain_FromTheMigrationBeforeIt()
    {
        _fixture.ConnectionString.Should().NotBeNull();
        var connectionString = new SqlConnectionStringBuilder(_fixture.ConnectionString!)
        {
            InitialCatalog = $"PulseInjectMigration_{Guid.NewGuid():N}",
        }.ConnectionString;

        var options = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(connectionString).Options;
        await using var context = new PulseDbContext(options);
        try
        {
            var all = context.Database.GetMigrations().ToList();
            var index = all.FindIndex(id => id.EndsWith(MigrationSuffix, StringComparison.Ordinal));
            index.Should().BePositive("the inject-queue migration must exist and follow at least one earlier migration");
            var previous = all[index - 1];
            var migrator = context.Database.GetService<IMigrator>();

            await migrator.MigrateAsync(previous);
            (await TableExistsAsync(context, "InjectItems")).Should().BeFalse();

            await migrator.MigrateAsync(all[index]);
            (await TableExistsAsync(context, "InjectItems")).Should().BeTrue("Up applies");
            (await TableExistsAsync(context, "InjectItemPosts")).Should().BeTrue();

            await migrator.MigrateAsync(previous);
            (await TableExistsAsync(context, "InjectItems")).Should().BeFalse("Down reverts cleanly");
            (await TableExistsAsync(context, "InjectItemPosts")).Should().BeFalse();

            await migrator.MigrateAsync();
            (await TableExistsAsync(context, "InjectItems")).Should().BeTrue("and Up re-applies");
        }
        finally
        {
            await context.Database.EnsureDeletedAsync();
        }
    }

    [RequiresDockerFact]
    public async Task AnItem_RoundTrips_WithItsChildAndJsonMedia()
    {
        var exerciseId = Guid.NewGuid();
        var itemId = Guid.NewGuid();
        var scope = new ExerciseContext { CurrentExerciseId = exerciseId };

        await using (var write = _fixture.CreateContext(scope))
        {
            var item = new InjectItem
            {
                Id = itemId,
                ExerciseId = exerciseId,
                Kind = "burst",
                Title = "Round trip \U0001F6B0",
                Status = "firing",
                Order = 3,
                Version = 7,
                CreatedByHumanId = Guid.NewGuid(),
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
                BurstWindowSeconds = 120,
                ShiftSeconds = 12.5,
                ReleasedAt = DateTimeOffset.UtcNow,
            };
            item.Posts.Add(new InjectItemPost
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                InjectItemId = itemId,
                Sequence = 1,
                PersonaId = Guid.NewGuid(),
                Text = "with media",
                Status = "pending",
                DueOffsetSeconds = 0,
                Media = [new InjectMediaRef { MediaId = "beat3-photo", Alt = "Brown tap water" }],
                BaselineLike = 42,
            });
            write.InjectItems.Add(item);
            await write.SaveChangesAsync();
        }

        await using var read = _fixture.CreateContext(scope);
        var loaded = await read.InjectItems.Include(i => i.Posts).SingleAsync(i => i.Id == itemId);
        loaded.Title.Should().Be("Round trip \U0001F6B0");
        loaded.Version.Should().Be(7);
        loaded.ShiftSeconds.Should().Be(12.5);
        var child = loaded.Posts.Should().ContainSingle().Subject;
        child.Media.Should().ContainSingle().Which.Alt.Should().Be("Brown tap water");
        child.BaselineLike.Should().Be(42);
    }

    private static async Task<bool> TableExistsAsync(PulseDbContext context, string table) =>
        (await ColumnsAsync(context, table)).Count > 0;

    private static async Task<System.Collections.Generic.List<string>> ColumnsAsync(PulseDbContext context, string table) =>
        await context.Database
            .SqlQuery<string>($"SELECT COLUMN_NAME AS [Value] FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = {table}")
            .ToListAsync();
}
