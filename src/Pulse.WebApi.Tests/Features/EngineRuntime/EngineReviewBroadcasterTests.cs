namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Moq;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Features.Realtime;
using Xunit;

/// <summary>
/// Unit tests for <see cref="EngineReviewBroadcaster"/> (story 02 SignalR push; COR-001, XC-002). Docker-free,
/// plain <see cref="FactAttribute"/>s — the broadcaster's only collaborator is <see cref="IHubContext{THub}"/>,
/// trivially mocked. Proves the pushed event name, the SERVER-DERIVED exercise group (mirroring
/// <see cref="ExerciseRealtimeHub.GroupNameFor"/>, never client-supplied), and that a push targets ONLY the
/// owning exercise's group.
/// </summary>
public sealed class EngineReviewBroadcasterTests
{
    [Fact]
    public async Task BroadcastReviewItemChangedAsync_SendsReviewItemChanged_ToTheExercisesGroup_WithThePayload()
    {
        var exerciseId = Guid.NewGuid();
        var item = SampleItem(exerciseId);

        var groupProxy = new Mock<IClientProxy>();
        var clients = new Mock<IHubClients>();
        clients.Setup(c => c.Group($"exercise:{exerciseId}")).Returns(groupProxy.Object);

        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hubContext.SetupGet(h => h.Clients).Returns(clients.Object);

        var broadcaster = new EngineReviewBroadcaster(hubContext.Object);

        await broadcaster.BroadcastReviewItemChangedAsync(exerciseId, item);

        groupProxy.Verify(
            p => p.SendCoreAsync(
                "ReviewItemChanged",
                It.Is<object?[]>(args => args.Length == 1 && ReferenceEquals(args[0], item)),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task BroadcastReviewItemChangedAsync_TargetsOnlyTheOwningExercisesGroup_NeverAnothers()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        var groupProxyA = new Mock<IClientProxy>();
        var groupProxyB = new Mock<IClientProxy>();
        var clients = new Mock<IHubClients>();
        clients.Setup(c => c.Group($"exercise:{exerciseA}")).Returns(groupProxyA.Object);
        clients.Setup(c => c.Group($"exercise:{exerciseB}")).Returns(groupProxyB.Object);

        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hubContext.SetupGet(h => h.Clients).Returns(clients.Object);

        var broadcaster = new EngineReviewBroadcaster(hubContext.Object);

        await broadcaster.BroadcastReviewItemChangedAsync(exerciseA, SampleItem(exerciseA));

        groupProxyA.Verify(
            p => p.SendCoreAsync("ReviewItemChanged", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Once);
        groupProxyB.Verify(
            p => p.SendCoreAsync(It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Never,
            "a push scoped to exercise A must never reach exercise B's controllers (COR-001)");
    }

    [Fact]
    public async Task BroadcastReviewItemChangedAsync_NullItem_Throws()
    {
        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        var broadcaster = new EngineReviewBroadcaster(hubContext.Object);

        var act = async () => await broadcaster.BroadcastReviewItemChangedAsync(Guid.NewGuid(), null!);

        await act.Should().ThrowAsync<ArgumentNullException>();
    }

    private static EngineReviewItemDto SampleItem(Guid exerciseId) => new()
    {
        ExerciseId = exerciseId.ToString(),
        StorylineId = Guid.NewGuid().ToString(),
        DraftId = Guid.NewGuid().ToString(),
        RoutedAtLevel = AutonomyLevel.Suggest,
        Disposition = DraftDisposition.Held,
        Posts = Array.Empty<GeneratedPostDto>(),
        StorylineTag = "#WaterIssues",
        StorylineBrief = "brief",
        ActionLabel = "reply → @mvega_fh",
    };
}
