namespace Pulse.WebApi.Tests.Features.Social.Follows;

using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Social.Follows;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// The concurrent double-submit fold (<c>profiles-social-graph/07</c>, Gate-1 WR-001) — the case a
/// double-tapping participant actually produces. A racing request is simulated DETERMINISTICALLY with an EF
/// <see cref="ISaveChangesInterceptor"/> that mutates the row on a SEPARATE connection in the instant between
/// the service's existence check and its <c>SaveChanges</c>, which is exactly the window the fold exists for.
/// </summary>
/// <remarks>
/// <para>
/// The two directions FAIL DIFFERENTLY and both must fold to the same idempotent 200: the follow side hits the
/// unique <c>(ExerciseId, Follower, Followee)</c> index; the unfollow side issues
/// <c>DELETE … WHERE Id = @p0</c>, affects ZERO rows because the racing request already removed it, and EF
/// reports <see cref="DbUpdateConcurrencyException"/> — a <see cref="DbUpdateException"/> SUBCLASS. A fold
/// guarded on the follow path only would let the likelier participant gesture (a double-tapped Unfollow)
/// surface as a 500.
/// </para>
/// <para>
/// The third test is the counterweight: a <see cref="DbUpdateException"/> that is NOT the race must still
/// surface, so the fold can never hide a genuine persistence failure behind a 200 that claims a write
/// succeeded.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class FollowConcurrencyTests
{
    private readonly MsSqlContainerFixture _fixture;

    public FollowConcurrencyTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task ConcurrentDoubleUnfollow_FoldsToIdempotentSuccess_NotA500()
    {
        var world = await SeedAsync();
        var edgeId = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Follows.Add(NewEdge(edgeId, world));
            await seed.SaveChangesAsync();
        }

        // The racing request deletes the very edge this one is about to delete, after it was read.
        await using var context = CreateContextWithInterceptor(
            world.Exercise,
            new RacingSqlInterceptor($"DELETE FROM [Follows] WHERE [Id] = '{edgeId}';"));

        var service = CreateService(context, world);

        var act = async () => await service.UnfollowAsync(world.Followee);

        var result = await act.Should().NotThrowAsync(
            "a double-tapped Unfollow must never surface as a 500 — EF's zero-rows-affected "
            + "DbUpdateConcurrencyException is the same 'one tap late' event the follow side folds");

        result.Subject.Outcome.Should().Be(
            FollowOutcome.Unchanged, "the world already holds what the caller asked for: the edge is gone");
        result.Subject.Following.Should().BeFalse();

        await using var verify = _fixture.CreateContext();
        (await verify.Follows.IgnoreQueryFilters().AnyAsync(edge => edge.Id == edgeId)).Should().BeFalse();
        (await verify.TelemetryEvents.IgnoreQueryFilters()
            .CountAsync(candidate => candidate.ExerciseId == world.Exercise && candidate.EventType == "unfollow"))
            .Should().Be(0, "the losing request emits nothing — the winner already emitted the one event");
    }

    [RequiresDockerFact]
    public async Task ConcurrentDoubleFollow_FoldsToIdempotentSuccess_NotA500()
    {
        var world = await SeedAsync();

        // The racing request inserts the same edge first, so this one hits the unique index.
        var racingInsert =
            $"INSERT INTO [Follows] ([Id],[ExerciseId],[FollowerPersonaId],[FolloweePersonaId],"
            + $"[CreatedScenarioTime],[CreatedWallClock]) VALUES ('{Guid.NewGuid()}','{world.Exercise}',"
            + $"'{world.Follower}','{world.Followee}',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());";

        await using var context = CreateContextWithInterceptor(world.Exercise, new RacingSqlInterceptor(racingInsert));

        var service = CreateService(context, world);

        var act = async () => await service.FollowAsync(world.Followee);

        var result = await act.Should().NotThrowAsync(
            "the unique index caught a concurrent double-submit — the caller's intent holds either way");

        result.Subject.Outcome.Should().Be(FollowOutcome.Unchanged);
        result.Subject.Following.Should().BeTrue();

        await using var verify = _fixture.CreateContext();
        (await verify.Follows.IgnoreQueryFilters()
            .CountAsync(edge => edge.ExerciseId == world.Exercise
                && edge.FollowerPersonaId == world.Follower
                && edge.FolloweePersonaId == world.Followee))
            .Should().Be(1, "the race leaves exactly ONE edge, never a duplicate");
    }

    [RequiresDockerFact]
    public async Task AGenuineWriteFailure_StillSurfaces_TheFoldNeverHidesItBehindA200()
    {
        var world = await SeedAsync();

        // NOT the double-submit race: the racing statement steals the pending telemetry event's primary key,
        // so SaveChanges fails for a reason that has nothing to do with the edge — and the whole unit of work
        // (edge included) rolls back, so the database does NOT agree with the caller's intent afterwards.
        await using var context = CreateContextWithInterceptor(world.Exercise, new TelemetryKeyThiefInterceptor(world.Exercise));

        var service = CreateService(context, world);

        var act = async () => await service.FollowAsync(world.Followee);

        await act.Should().ThrowAsync<DbUpdateException>(
            "a persistence failure that is not the idempotent race must SURFACE — folding it into a 200 would "
            + "tell the caller they now follow a persona when nothing was written");

        await using var verify = _fixture.CreateContext();
        (await verify.Follows.IgnoreQueryFilters()
            .AnyAsync(edge => edge.ExerciseId == world.Exercise && edge.FollowerPersonaId == world.Follower))
            .Should().BeFalse("the failed unit of work wrote no edge");
    }

    // ---------------------------------------------------------------------------------------------
    // Harness
    // ---------------------------------------------------------------------------------------------

    private PulseDbContext CreateContextWithInterceptor(Guid exerciseId, IInterceptor interceptor)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string first");

        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString!)
            .AddInterceptors(interceptor)
            .Options;

        return new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = exerciseId });
    }

    private static FollowService CreateService(PulseDbContext context, SeededPair world) => new(
        context,
        new ExerciseContext { CurrentExerciseId = world.Exercise },
        new StubSessionPersonaAccessor(new CurrentSessionPersona
        {
            SessionId = Guid.NewGuid(),
            PersonaId = world.Follower,
            Kind = "participant",
            ExerciseId = world.Exercise,
            ActingHumanId = "human-race",
        }),
        new ExerciseClockService(TimeProvider.System));

    private async Task<SeededPair> SeedAsync()
    {
        var world = new SeededPair
        {
            Exercise = Guid.NewGuid(),
            Follower = Guid.NewGuid(),
            Followee = Guid.NewGuid(),
        };

        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            Id = world.Exercise,
            Name = $"Exercise {world.Exercise:N}",
            TimeZone = "UTC",
            Status = "active",
        });
        seed.Personas.Add(NewPersona(world.Follower, world.Exercise));
        seed.Personas.Add(NewPersona(world.Followee, world.Exercise));
        await seed.SaveChangesAsync();

        return world;
    }

    private static Persona NewPersona(Guid id, Guid exerciseId) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        DisplayName = $"Persona {id:N}",
        Handle = $"p_{id:N}",
        Kind = "human",
    };

    private static Follow NewEdge(Guid id, SeededPair world) => new()
    {
        Id = id,
        ExerciseId = world.Exercise,
        FollowerPersonaId = world.Follower,
        FolloweePersonaId = world.Followee,
        CreatedScenarioTime = DateTimeOffset.UtcNow,
        CreatedWallClock = DateTimeOffset.UtcNow,
    };

    private sealed class SeededPair
    {
        public required Guid Exercise { get; init; }

        public required Guid Follower { get; init; }

        public required Guid Followee { get; init; }
    }

    /// <summary>Returns a fixed session persona, standing in for the request's authenticated session.</summary>
    private sealed class StubSessionPersonaAccessor : ICurrentSessionPersonaAccessor
    {
        private readonly CurrentSessionPersona _sessionPersona;

        public StubSessionPersonaAccessor(CurrentSessionPersona sessionPersona) => _sessionPersona = sessionPersona;

        public Task<CurrentSessionPersona?> GetCurrentSessionPersonaAsync(CancellationToken cancellationToken = default)
            => Task.FromResult<CurrentSessionPersona?>(_sessionPersona);
    }

    /// <summary>
    /// Runs one raw statement on a SEPARATE connection at the exact moment the service calls
    /// <c>SaveChanges</c> — the racing request, made deterministic. Fires once; a re-read inside the fold must
    /// see the racing request's effect, not a second application of it.
    /// </summary>
    private sealed class RacingSqlInterceptor : ISaveChangesInterceptor
    {
        private readonly string _sql;
        private bool _fired;

        public RacingSqlInterceptor(string sql) => _sql = sql;

        public async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (!_fired && eventData.Context is not null)
            {
                _fired = true;
                await ExecuteOnASeparateConnectionAsync(eventData.Context, _sql, cancellationToken);
            }

            return result;
        }

        internal static async Task ExecuteOnASeparateConnectionAsync(
            DbContext context, string sql, CancellationToken cancellationToken)
        {
            await using var connection = new SqlConnection(context.Database.GetConnectionString());
            await connection.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    /// <summary>
    /// Steals the PENDING telemetry event's primary key on a separate connection, so the service's
    /// <c>SaveChanges</c> fails with a key violation that is NOT the follow/unfollow race — the genuine
    /// failure the fold must rethrow rather than swallow.
    /// </summary>
    private sealed class TelemetryKeyThiefInterceptor : ISaveChangesInterceptor
    {
        private readonly Guid _exerciseId;
        private bool _fired;

        public TelemetryKeyThiefInterceptor(Guid exerciseId) => _exerciseId = exerciseId;

        public async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (_fired || eventData.Context is null)
            {
                return result;
            }

            var pending = eventData.Context.ChangeTracker.Entries<TelemetryEvent>()
                .Select(entry => entry.Entity)
                .FirstOrDefault();

            if (pending is null)
            {
                return result;
            }

            _fired = true;

            var sql =
                $"INSERT INTO [TelemetryEvents] ([EventId],[SchemaVersion],[ExerciseId],[EventType],[Channel],"
                + $"[Actor_Kind],[WallClockTime],[ScenarioTime],[TimeZone],[EmittedAt]) VALUES "
                + $"('{pending.EventId}','v0','{_exerciseId}','thief','social','persona',"
                + "SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET(),'UTC',SYSDATETIMEOFFSET());";

            await RacingSqlInterceptor.ExecuteOnASeparateConnectionAsync(eventData.Context, sql, cancellationToken);

            return result;
        }
    }
}
