namespace Pulse.WebApi.Tests.Features.Social.Editing;

using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Editing;
using Pulse.WebApi.Features.Social.Follows;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Xunit;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

/// <summary>
/// demo-feedback story 19, Gate-1 L-2 / L-3 / L-5 — <see cref="PostEditService"/> driven directly over real SQL with
/// two contexts, so a takedown or a competing edit lands deterministically between the edit's read and its write (a
/// command interceptor fires the competitor just before the edit's conditional <c>UPDATE [Posts]</c>).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PostEditRaceTests
{
    private readonly MsSqlContainerFixture _fixture;

    public PostEditRaceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private string ConnectionString => _fixture.ConnectionString
        ?? throw new InvalidOperationException("The MsSql fixture has no connection string.");

    private static PostEditService Service(
        PulseDbContext db, Guid exerciseId, Guid personaId, TimeProvider time, RecordingEditBroadcaster broadcaster) =>
        new(
            db,
            new ExerciseContext { CurrentExerciseId = exerciseId },
            new FixedSessionPersona(new CurrentSessionPersona
            {
                SessionId = Guid.NewGuid(),
                PersonaId = personaId,
                Kind = "participant",
                ExerciseId = exerciseId,
                ActingHumanId = $"human-{personaId:N}",
            }),
            new StubCurrentStaffSessionAccessor(null),
            new ExerciseFactsReader(db),
            broadcaster,
            new NarrowProjector(),
            time,
            TestScenarioNow.Over(db));

    private PulseDbContext Context(Guid exerciseId, IInterceptor? interceptor = null)
    {
        var builder = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(ConnectionString);
        if (interceptor is not null)
        {
            builder.AddInterceptors(interceptor);
        }

        return new PulseDbContext(builder.Options, new ExerciseContext { CurrentExerciseId = exerciseId });
    }

    [RequiresDockerFact]
    public async Task ATakedownBetweenReadAndWrite_Is404_WithNothingWrittenAndNothingPushed()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var exerciseId = await host.SeedExerciseAsync();
        var personaId = await host.SeedPersonaAsync(exerciseId);
        var postId = await host.SeedPostAsync(exerciseId, personaId, body: "before");
        var broadcaster = new RecordingEditBroadcaster();

        async Task TakeDownAsync()
        {
            await using var other = Context(exerciseId);
            var post = await other.Posts.SingleAsync(p => p.Id == postId);
            post.DeletedAt = PostEditTestHost.PostScenarioTime;
            await other.SaveChangesAsync();
        }

        await using var db = Context(exerciseId, new BeforePostsUpdate(TakeDownAsync));
        var result = await Service(db, exerciseId, personaId, host.Time, broadcaster)
            .EditAsync(postId, new EditPostRequest { Text = "after" });

        result.Outcome.Should().Be(PostEditOutcome.NotFound, "the post was taken down after the read (Gate-1 L-3)");
        var row = await host.ReadPostAsync(postId);
        row.Body.Should().Be("before");
        row.EditCount.Should().Be(0);
        (await host.ReadEditsAsync(postId)).Should().BeEmpty();
        (await host.ReadTelemetryAsync(exerciseId)).Should().BeEmpty();
        broadcaster.Edited.Should().BeEmpty("no PostEdited for an edit that did not happen");
    }

    [RequiresDockerFact]
    public async Task TwoEditsCollidingOnTheSameEditNumber_OneWins_TheOtherIsABodilessConflict_NothingPartial()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var exerciseId = await host.SeedExerciseAsync();
        var personaId = await host.SeedPersonaAsync(exerciseId);
        var postId = await host.SeedPostAsync(exerciseId, personaId, body: "v0");
        var winnerBroadcaster = new RecordingEditBroadcaster();
        var loserBroadcaster = new RecordingEditBroadcaster();
        PostEditResult? winner = null;

        // The competitor reads EditCount 0 too and commits edit 1 just before the loser's write.
        async Task CompetingEditAsync()
        {
            await using var other = Context(exerciseId);
            winner = await Service(other, exerciseId, personaId, host.Time, winnerBroadcaster)
                .EditAsync(postId, new EditPostRequest { Text = "winner" });
        }

        await using var db = Context(exerciseId, new BeforePostsUpdate(CompetingEditAsync));
        var loser = await Service(db, exerciseId, personaId, host.Time, loserBroadcaster)
            .EditAsync(postId, new EditPostRequest { Text = "loser" });

        winner!.Outcome.Should().Be(PostEditOutcome.Edited);
        loser.Outcome.Should().Be(PostEditOutcome.Conflict, "edit number 1 was already taken");
        loser.View.Should().BeNull("the endpoint answers it with a bodiless 409");
        loser.RefusalReason.Should().BeNull();

        var row = await host.ReadPostAsync(postId);
        var edits = await host.ReadEditsAsync(postId);
        row.Body.Should().Be("winner");
        row.EditCount.Should().Be(1);
        edits.Should().ContainSingle().Which.PreviousBody.Should().Be("v0");
        row.EditCount.Should().Be(edits.Count, "the count and the edit rows never disagree");
        (await host.ReadTelemetryAsync(exerciseId)).Should().ContainSingle("only the winner's event landed");
        winnerBroadcaster.Edited.Should().ContainSingle();
        loserBroadcaster.Edited.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task WithNoClockAndNoStoredScenarioTime_TheEditTimeIsThePostsScenarioTime_NeverTheWallClock()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var exerciseId = await host.SeedExerciseAsync(withStoredScenarioTime: false);
        var personaId = await host.SeedPersonaAsync(exerciseId);
        var postId = await host.SeedPostAsync(exerciseId, personaId);

        await using var db = Context(exerciseId);
        var result = await Service(db, exerciseId, personaId, host.Time, new RecordingEditBroadcaster())
            .EditAsync(postId, new EditPostRequest { Text = "fixed" });

        result.Outcome.Should().Be(PostEditOutcome.Edited);
        var edit = (await host.ReadEditsAsync(postId)).Should().ContainSingle().Subject;
        edit.EditedScenarioTime.Should().Be(PostEditTestHost.PostScenarioTime, "scenario time only (COR-053, Gate-1 L-2)");
        edit.EditedScenarioTime.Should().NotBe(host.Time.GetUtcNow());
        (await host.ReadPostAsync(postId)).LastEditedScenarioTime.Should().Be(PostEditTestHost.PostScenarioTime);
    }

    [RequiresDockerFact]
    public async Task AnEndedLifecycle_IsStillRefusedByTheServiceItself_DefenceInDepthBehindTheGate()
    {
        await using var host = await PostEditTestHost.StartAsync(ConnectionString);
        var exerciseId = await host.SeedExerciseAsync(status: "completed");
        var personaId = await host.SeedPersonaAsync(exerciseId);
        var postId = await host.SeedPostAsync(exerciseId, personaId);

        await using var db = Context(exerciseId);
        var result = await Service(db, exerciseId, personaId, host.Time, new RecordingEditBroadcaster())
            .EditAsync(postId, new EditPostRequest { Text = "after EndEx" });

        result.Outcome.Should().Be(PostEditOutcome.Refused);
        result.RefusalReason.Should().Be(PostEditRefusalReasons.Frozen);
    }

    private sealed class FixedSessionPersona(CurrentSessionPersona persona) : ICurrentSessionPersonaAccessor
    {
        public Task<CurrentSessionPersona?> GetCurrentSessionPersonaAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult<CurrentSessionPersona?>(persona);
    }

    private sealed class NarrowProjector : IParticipantPostProjector
    {
        public Task<IReadOnlyList<ParticipantPostDto>> ProjectAsync(
            IReadOnlyCollection<Post> posts, PostProjectionOptions options, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<ParticipantPostDto>>(posts.Select(ParticipantPostDto.FromPost).ToArray());
    }

    /// <summary>Runs <c>race</c> once, on its own connection, just before the first <c>UPDATE [Posts]</c> command.</summary>
    private sealed class BeforePostsUpdate(Func<Task> race) : DbCommandInterceptor
    {
        private bool _raced;

        public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            await RaceAsync(command);
            return result;
        }

        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            await RaceAsync(command);
            return result;
        }

        private async Task RaceAsync(DbCommand command)
        {
            if (_raced || !command.CommandText.Contains("UPDATE [p]", StringComparison.Ordinal)
                && !command.CommandText.Contains("UPDATE [Posts]", StringComparison.Ordinal))
            {
                return;
            }

            _raced = true;
            await race();
        }
    }
}
