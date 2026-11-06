namespace Pulse.WebApi.Tests.Features.Channels.Publish;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// The publish race against REAL SQL Server: the in-memory provider has no transactions, so only here does the losing
/// publish's telemetry row roll back with its refused state change, proving "exactly one <c>content_published</c>".
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ContentPublishSqlTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ContentPublishSqlTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task TwoSimultaneousPublishes_CommitOnce_WithExactlyOneEventAndOneBroadcast()
    {
        var exerciseId = Guid.NewGuid();
        var outlet = ChannelRows.Outlet(exerciseId);
        var item = ChannelRows.ContentItem(exerciseId, outlet.Id);
        item.Version = 1;
        await using (var seed = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId }))
        {
            seed.Outlets.Add(outlet);
            seed.ContentItems.Add(item);
            await seed.SaveChangesAsync();
        }

        var broadcaster = new RecordingBroadcaster();
        var parked = new TestGate(ContentPublishGateDecision.Allow()) { Entered = new(), Release = new() };
        await using var firstDb = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        await using var secondDb = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });

        var racing = Funnel(firstDb, exerciseId, broadcaster, parked).PublishAsync(item.Id, null, FunnelHarness.Controller);
        await parked.Entered.Task;
        var won = await Funnel(secondDb, exerciseId, broadcaster, gate: null).PublishAsync(item.Id, null, FunnelHarness.Controller);
        parked.Release.SetResult();
        var lost = await racing;

        won.Outcome.Should().Be(ContentPublishOutcome.Ok);
        lost.Outcome.Should().Be(ContentPublishOutcome.Conflict);
        broadcaster.Published.Should().ContainSingle();
        await using var read = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        (await read.TelemetryEvents.CountAsync(e => e.Target!.EntityId == item.Id.ToString()))
            .Should().Be(1, "the loser's event rolled back with its refused state change");
    }

    private static ContentPublishService Funnel(
        PulseDbContext db, Guid exerciseId, RecordingBroadcaster broadcaster, IContentPublishGate? gate) =>
        new(
            db,
            new ExerciseContext { CurrentExerciseId = exerciseId },
            broadcaster,
            new SanitizerProfileRegistry(),
            new ContentProjector(db),
            new ServiceCollection().BuildServiceProvider(),
            descriptors: [new TestKindDescriptor("article", "news", ISanitizerProfileRegistry.RichBasic)],
            gates: gate is null ? [] : [gate]);
}
