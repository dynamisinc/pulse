namespace Pulse.WebApi.Tests.Features.Social.Engagement;

using System;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Moq;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Engagement;
using Xunit;

/// <summary>
/// Docker-free checks of the <c>PostEngagementChanged</c> push (demo-feedback story 14, DF-17): the frozen wire shape,
/// the target group (the one exercise's group, never another exercise's and never the staff group alone), and the
/// default no-op that keeps older <see cref="IFeedBroadcaster"/> doubles compiling.
/// </summary>
public sealed class PostEngagementChangedWireTests
{
    [Fact]
    public void PostEngagementChanged_SerializesToExactlyPostIdCountsAndVersion()
    {
        var postId = Guid.NewGuid();

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(
            PostEngagementChangedDto.For(postId, new ParticipantPostCounts(Reply: 2, Repost: 5, Like: 12), version: 41)));

        doc.RootElement.EnumerateObject().Select(p => p.Name).Should().Equal(
            new[] { "postId", "counts", "version" },
            "the push carries no viewer, active, actor, instant or baseline/real split (XC-002, DF-18)");
        doc.RootElement.GetProperty("postId").GetString().Should().Be(postId.ToString());
        var counts = doc.RootElement.GetProperty("counts");
        counts.EnumerateObject().Select(p => p.Name).Should().Equal("reply", "repost", "like");
        counts.GetProperty("reply").GetInt32().Should().Be(2);
        counts.GetProperty("repost").GetInt32().Should().Be(5);
        counts.GetProperty("like").GetInt32().Should().Be(12);
        doc.RootElement.GetProperty("version").GetInt64().Should().Be(41);
    }

    [Fact]
    public async Task BroadcastPostEngagementChanged_SendsToTheOwningExercisesGroupOnly()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var change = PostEngagementChangedDto.For(Guid.NewGuid(), new ParticipantPostCounts(0, 1, 3), version: 7);

        var groupA = new Mock<IClientProxy>();
        var groupB = new Mock<IClientProxy>();
        var staffA = new Mock<IClientProxy>();
        var clients = new Mock<IHubClients>();
        clients.Setup(c => c.Group($"exercise:{exerciseA}")).Returns(groupA.Object);
        clients.Setup(c => c.Group($"exercise:{exerciseB}")).Returns(groupB.Object);
        clients.Setup(c => c.Group($"exercise:{exerciseA}:staff")).Returns(staffA.Object);
        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hubContext.SetupGet(h => h.Clients).Returns(clients.Object);

        await new SignalRFeedBroadcaster(hubContext.Object).BroadcastPostEngagementChangedAsync(exerciseA, change);

        groupA.Verify(
            p => p.SendCoreAsync(
                "PostEngagementChanged",
                It.Is<object?[]>(args => args.Length == 1 && ReferenceEquals(args[0], change)),
                It.IsAny<CancellationToken>()),
            Times.Once);
        groupB.Verify(
            p => p.SendCoreAsync(It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Never,
            "a second exercise's clients get nothing (COR-001)");
        staffA.Verify(
            p => p.SendCoreAsync(It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Never,
            "the push goes to the exercise-wide group, which staff connections already belong to");
    }

    [Fact]
    public async Task IFeedBroadcaster_DefaultEngagementChanged_IsANoOp_SoOlderDoublesStillWork()
    {
        IFeedBroadcaster legacy = new PostOnlyBroadcaster();

        var task = legacy.BroadcastPostEngagementChangedAsync(
            Guid.NewGuid(), PostEngagementChangedDto.For(Guid.NewGuid(), new ParticipantPostCounts(0, 0, 0), 0));

        task.IsCompletedSuccessfully.Should().BeTrue();
        await task;
    }

    /// <summary>A double that predates live engagement: it implements only the one required member.</summary>
    private sealed class PostOnlyBroadcaster : IFeedBroadcaster
    {
        public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }
}
