namespace Pulse.WebApi.Tests.Features.Social.Reactions;

using System;
using System.Data.Common;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Social.Engagement;
using Pulse.WebApi.Features.Social.Follows;
using Pulse.WebApi.Features.Social.Reactions;
using Pulse.WebApi.Tests.Data;
using static Pulse.WebApi.Tests.Features.Social.Reactions.ReactionTestSeed;

/// <summary>
/// The concurrent double-submit fold for reactions (demo-polish B3, "Race-safe" AC), in BOTH directions. A racing
/// request is simulated DETERMINISTICALLY: an interceptor changes the row on a SEPARATE connection in the instant
/// between the service's existence check and its write, which is exactly the window the fold exists for.
/// </summary>
/// <remarks>
/// <para>
/// Activate: the loser's insert hits the filtered unique index <c>IX_PostReactions_PostId_PersonaId_Kind</c>
/// (<c>DeletedAt IS NULL</c>) and must fold to a 200-equivalent "unchanged" with its telemetry event discarded.
/// </para>
/// <para>
/// Deactivate: a soft delete is an UPDATE, which a racing request cannot make fail on its own. The service's
/// conditional update (<c>… AND DeletedAt IS NULL</c>) must affect zero rows for the loser, which then emits nothing.
/// </para>
/// <para>
/// The counterweights: a failure that is NOT the race must still surface, and on the deactivate path the soft delete
/// must roll back with its event (one unit of work).
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class ReactionConcurrencyTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ReactionConcurrencyTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task ConcurrentDoubleLike_FoldsToUnchanged_OneActiveRow_LoserEmitsNothing()
    {
        var world = await SeedWorldAsync(_fixture);

        // The racing request inserts the same ACTIVE reaction first, so this one hits the filtered unique index.
        var racingInsert =
            "INSERT INTO [PostReactions] ([Id],[ExerciseId],[PostId],[PersonaId],[Kind],[CreatedScenarioTime]) "
            + $"VALUES ('{Guid.NewGuid()}','{world.Exercise}','{world.Post}','{world.Persona}','like',SYSDATETIMEOFFSET());";

        await using var context = CreateScopedContext(_fixture, world.Exercise, new RacingSaveInterceptor(racingInsert));
        var service = CreateService(context, world);

        var act = async () => await service.ReactAsync(world.Post, "like");

        var result = await act.Should().NotThrowAsync(
            "the unique index caught a concurrent double-submit; the caller's intent holds either way (not a 500)");

        result.Subject.Outcome.Should().Be(ReactionOutcome.Unchanged);
        result.Subject.State!.Active.Should().BeTrue();
        result.Subject.State.Counts.Like.Should().Be(1, "exactly one active like exists");

        var rows = await ReadReactionsAsync(_fixture, world.Post);
        rows.Should().ContainSingle("the race leaves exactly ONE row, never a duplicate active row")
            .Which.DeletedAt.Should().BeNull();
        (await ReadEventsAsync(_fixture, world.Exercise, "reaction")).Should().BeEmpty(
            "the loser's event is discarded (the racing raw insert stands in for the winner, which emits its own)");
    }

    [RequiresDockerFact]
    public async Task ConcurrentDoubleUnlike_FoldsToUnchanged_LoserEmitsNothing_AndDoesNotRestampTheRow()
    {
        var world = await SeedWorldAsync(_fixture);
        var reaction = NewReaction(world.Exercise, world.Post, world.Persona, ReactionKinds.Like);

        await using (var seed = _fixture.CreateContext())
        {
            seed.PostReactions.Add(reaction);
            await seed.SaveChangesAsync();
        }

        // The racing request soft-deletes the very row this one is about to soft-delete, after it was read.
        var winnersStamp = new DateTimeOffset(2033, 9, 4, 8, 0, 0, TimeSpan.Zero);
        var racingUpdate =
            $"UPDATE [PostReactions] SET [DeletedAt] = '{winnersStamp:O}' WHERE [Id] = '{reaction.Id}';";

        await using var context = CreateScopedContext(
            _fixture, world.Exercise, new RacingReactionUpdateInterceptor(racingUpdate));
        var service = CreateService(context, world);

        var act = async () => await service.UnreactAsync(world.Post, "like");

        var result = await act.Should().NotThrowAsync("a double-tapped un-like must never surface as a 500");

        result.Subject.Outcome.Should().Be(
            ReactionOutcome.Unchanged, "the world already holds what the caller asked for: nothing is liked");
        result.Subject.State!.Active.Should().BeFalse();

        var row = (await ReadReactionsAsync(_fixture, world.Post)).Should().ContainSingle().Subject;
        row.DeletedAt.Should().Be(winnersStamp, "the loser's conditional update matched nothing and wrote nothing");
        (await ReadEventsAsync(_fixture, world.Exercise, "reaction")).Should().BeEmpty(
            "the loser emits no second 'liked:false' event for the one state change");
    }

    [RequiresDockerFact]
    public async Task AGenuineWriteFailureOnLike_StillSurfaces_TheFoldNeverHidesItBehindA200()
    {
        var world = await SeedWorldAsync(_fixture);

        // NOT the race: the racing statement steals the pending telemetry event's primary key, so SaveChanges fails
        // for a reason that has nothing to do with the reaction, and the whole unit of work rolls back.
        await using var context = CreateScopedContext(
            _fixture, world.Exercise, new TelemetryKeyThiefInterceptor(world.Exercise));
        var service = CreateService(context, world);

        var act = async () => await service.ReactAsync(world.Post, "like");

        await act.Should().ThrowAsync<DbUpdateException>(
            "a persistence failure that is not the idempotent race must SURFACE, never fold into a 200");
        (await ReadReactionsAsync(_fixture, world.Post)).Should().BeEmpty("the failed unit of work wrote no reaction");
    }

    [RequiresDockerFact]
    public async Task AFailedUnlikeEvent_RollsBackTheSoftDelete_TheRowAndItsEventAreOneUnitOfWork()
    {
        var world = await SeedWorldAsync(_fixture);

        await using (var seed = _fixture.CreateContext())
        {
            seed.PostReactions.Add(NewReaction(world.Exercise, world.Post, world.Persona, ReactionKinds.Like));
            await seed.SaveChangesAsync();
        }

        await using var context = CreateScopedContext(
            _fixture, world.Exercise, new TelemetryKeyThiefInterceptor(world.Exercise));
        var service = CreateService(context, world);

        var act = async () => await service.UnreactAsync(world.Post, "like");

        await act.Should().ThrowAsync<DbUpdateException>("the event could not be saved, so the call must fail");
        (await ReadReactionsAsync(_fixture, world.Post)).Should().ContainSingle()
            .Which.DeletedAt.Should().BeNull(
                "the soft delete rolled back with its event: a state change never lands without its one event");
    }

    // ---------------------------------------------------------------------------------------------
    // Harness
    // ---------------------------------------------------------------------------------------------

    private static ReactionService CreateService(PulseDbContext context, ReactionWorld world)
    {
        var exerciseContext = new ExerciseContext { CurrentExerciseId = world.Exercise };
        return new ReactionService(
            context,
            exerciseContext,
            new StubSessionPersonaAccessor(new CurrentSessionPersona
            {
                SessionId = world.SessionId,
                PersonaId = world.Persona,
                Kind = "participant",
                ExerciseId = world.Exercise,
                ActingHumanId = world.ActingHumanId,
            }),
            new ExerciseClockService(TimeProvider.System),
            new PostEngagementReader(context, exerciseContext));
    }

    /// <summary>Returns a fixed session persona, standing in for the request's authenticated session.</summary>
    private sealed class StubSessionPersonaAccessor : ICurrentSessionPersonaAccessor
    {
        private readonly CurrentSessionPersona _sessionPersona;

        public StubSessionPersonaAccessor(CurrentSessionPersona sessionPersona) => _sessionPersona = sessionPersona;

        public Task<CurrentSessionPersona?> GetCurrentSessionPersonaAsync(CancellationToken cancellationToken = default)
            => Task.FromResult<CurrentSessionPersona?>(_sessionPersona);
    }

    /// <summary>Runs one raw statement on a separate connection the moment the service calls SaveChanges. Fires once.</summary>
    private sealed class RacingSaveInterceptor : SaveChangesInterceptor
    {
        private readonly string _sql;
        private bool _fired;

        public RacingSaveInterceptor(string sql) => _sql = sql;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
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
    }

    /// <summary>
    /// Runs one raw statement on a separate connection the moment the service issues its conditional soft-delete
    /// UPDATE against <c>PostReactions</c> (the racing un-like). Fires once.
    /// </summary>
    private sealed class RacingReactionUpdateInterceptor : DbCommandInterceptor
    {
        private readonly string _sql;
        private bool _fired;

        public RacingReactionUpdateInterceptor(string sql) => _sql = sql;

        public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (!_fired
                && eventData.Context is not null
                && command.CommandText.Contains("UPDATE", StringComparison.Ordinal)
                && command.CommandText.Contains("PostReactions", StringComparison.Ordinal))
            {
                _fired = true;
                await ExecuteOnASeparateConnectionAsync(eventData.Context, _sql, cancellationToken);
            }

            return result;
        }
    }

    /// <summary>
    /// Steals the PENDING telemetry event's primary key on a separate connection, so the service's SaveChanges fails
    /// with a key violation that is NOT the reaction race: the genuine failure the fold must rethrow.
    /// </summary>
    private sealed class TelemetryKeyThiefInterceptor : SaveChangesInterceptor
    {
        private readonly Guid _exerciseId;
        private bool _fired;

        public TelemetryKeyThiefInterceptor(Guid exerciseId) => _exerciseId = exerciseId;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
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
                "INSERT INTO [TelemetryEvents] ([EventId],[SchemaVersion],[ExerciseId],[EventType],[Channel],"
                + "[Actor_Kind],[WallClockTime],[ScenarioTime],[TimeZone],[EmittedAt]) VALUES "
                + $"('{pending.EventId}','v0','{_exerciseId}','thief','social','persona',"
                + "SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET(),'UTC',SYSDATETIMEOFFSET());";

            await ExecuteOnASeparateConnectionAsync(eventData.Context, sql, cancellationToken);
            return result;
        }
    }
}
