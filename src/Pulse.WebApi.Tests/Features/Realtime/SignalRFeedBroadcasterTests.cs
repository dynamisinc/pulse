namespace Pulse.WebApi.Tests.Features.Realtime;

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
using Pulse.WebApi.Features.Social.Moderation;

/// <summary>
/// Unit tests for <see cref="SignalRFeedBroadcaster"/> (story <c>social-api/03</c>, #272; SOC-083,
/// XC-002). Docker-free, plain <see cref="FactAttribute"/>s — the broadcaster's only collaborator is
/// <see cref="IHubContext{THub}"/>, which is trivially mocked with Moq, so no host/DB is needed to prove
/// the fan-out shape: the event name, the target group (server-derived, mirroring
/// <see cref="ExerciseRealtimeHub.GroupNameFor"/>), and the exact participant-safe payload sent.
/// </summary>
public class SignalRFeedBroadcasterTests
{
    [Fact]
    public async Task BroadcastPostAsync_SendsPostReceived_ToTheExercisesGroup_WithTheGivenPayload()
    {
        var exerciseId = Guid.NewGuid();
        var post = SamplePost();

        var groupProxy = new Mock<IClientProxy>();
        var clients = new Mock<IHubClients>();
        clients.Setup(c => c.Group($"exercise:{exerciseId}")).Returns(groupProxy.Object);

        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hubContext.SetupGet(h => h.Clients).Returns(clients.Object);

        var broadcaster = new SignalRFeedBroadcaster(hubContext.Object);

        await broadcaster.BroadcastPostAsync(exerciseId, post);

        // SendAsync(method, arg1, cancellationToken) is a thin extension over SendCoreAsync(method,
        // object?[] args, cancellationToken) — asserting at that level pins both the event name
        // ("PostReceived", the exact string `realtimeFeed.ts` subscribes to) and that the payload
        // forwarded is this exact ParticipantPostDto instance, never a re-shaped/re-derived copy.
        groupProxy.Verify(
            p => p.SendCoreAsync(
                "PostReceived",
                It.Is<object?[]>(args => args.Length == 1 && ReferenceEquals(args[0], post)),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task BroadcastPostAsync_TargetsOnlyTheOwningExercisesGroup_NeverAnotherExercises()
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

        var broadcaster = new SignalRFeedBroadcaster(hubContext.Object);

        await broadcaster.BroadcastPostAsync(exerciseA, SamplePost());

        groupProxyA.Verify(
            p => p.SendCoreAsync("PostReceived", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Once);
        groupProxyB.Verify(
            p => p.SendCoreAsync(It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Never,
            "a broadcast scoped to exercise A must never reach exercise B's group, even indirectly");
    }

    [Fact]
    public async Task BroadcastPostAsync_NullPost_Throws()
    {
        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        var broadcaster = new SignalRFeedBroadcaster(hubContext.Object);

        var act = async () => await broadcaster.BroadcastPostAsync(Guid.NewGuid(), null!);

        await act.Should().ThrowAsync<ArgumentNullException>();
    }

    // ---- demo-polish B6: PostRemoved -------------------------------------------------------------------

    [Fact]
    public async Task BroadcastPostRemovedAsync_SendsPostRemoved_ToTheExerciseWideGroup_WithOnlyThePostId()
    {
        var exerciseId = Guid.NewGuid();
        var postId = Guid.NewGuid();

        // STRICT: the only member the broadcaster may touch is Group("exercise:{id}"). Any other target (the staff
        // group, another exercise, All, Groups, Users...) would throw rather than pass silently.
        var groupProxy = new Mock<IClientProxy>();
        var clients = new Mock<IHubClients>(MockBehavior.Strict);
        clients.Setup(c => c.Group($"exercise:{exerciseId}")).Returns(groupProxy.Object);

        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hubContext.SetupGet(h => h.Clients).Returns(clients.Object);

        await new SignalRFeedBroadcaster(hubContext.Object).BroadcastPostRemovedAsync(exerciseId, postId);

        clients.Verify(c => c.Group($"exercise:{exerciseId}"), Times.Once);
        clients.Verify(
            c => c.Group(It.Is<string>(name => name != $"exercise:{exerciseId}")),
            Times.Never,
            "PostRemoved reaches the exercise-wide group only: never the staff-only group, never another exercise");
        groupProxy.Verify(
            p => p.SendCoreAsync(
                "PostRemoved",
                It.Is<object?[]>(args =>
                    args.Length == 1
                    && args[0] is PostRemovedDto
                    && ((PostRemovedDto)args[0]!).PostId == postId.ToString()),
                It.IsAny<CancellationToken>()),
            Times.Once);
        groupProxy.Verify(
            p => p.SendCoreAsync(It.Is<string>(m => m != "PostRemoved"), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task BroadcastPostRemovedAsync_NeverReachesAnotherExercisesGroup_OrTheStaffGroup()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        var groupA = new Mock<IClientProxy>();
        var staffA = new Mock<IClientProxy>();
        var groupB = new Mock<IClientProxy>();
        var clients = new Mock<IHubClients>();
        clients.Setup(c => c.Group($"exercise:{exerciseA}")).Returns(groupA.Object);
        clients.Setup(c => c.Group($"exercise:{exerciseA}:staff")).Returns(staffA.Object);
        clients.Setup(c => c.Group($"exercise:{exerciseB}")).Returns(groupB.Object);

        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hubContext.SetupGet(h => h.Clients).Returns(clients.Object);

        await new SignalRFeedBroadcaster(hubContext.Object).BroadcastPostRemovedAsync(exerciseA, Guid.NewGuid());

        groupA.Verify(p => p.SendCoreAsync("PostRemoved", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()), Times.Once);
        staffA.Verify(
            p => p.SendCoreAsync(It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Never,
            "the staff group gets nothing extra; staff connections already receive it once via the exercise-wide group");
        groupB.Verify(
            p => p.SendCoreAsync(It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Never,
            "a takedown in exercise A must never reach exercise B's group");
    }

    [Fact]
    public void PostRemovedPayload_SerializesToExactlyThePostId()
    {
        // XC-002 on the wire: the frozen shape is { postId: string } and nothing else. Default serializer options,
        // so the name comes from the explicit [JsonPropertyName], not from a host naming policy.
        var postId = Guid.NewGuid();

        var json = JsonSerializer.Serialize(PostRemovedDto.For(postId));

        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name).Should().Equal(
            new[] { "postId" }, "PostRemoved carries the post id only: no text, author, category or provenance");
        doc.RootElement.GetProperty("postId").GetString().Should().Be(postId.ToString());
    }

    [Fact]
    public async Task IFeedBroadcaster_DefaultBroadcastPostRemoved_IsANoOp_SoPreTakedownDoublesStillWork()
    {
        // The default interface method keeps every pre-B6 IFeedBroadcaster double compiling and harmless.
        IFeedBroadcaster legacyDouble = new PostOnlyBroadcaster();

        var task = legacyDouble.BroadcastPostRemovedAsync(Guid.NewGuid(), Guid.NewGuid());

        task.IsCompletedSuccessfully.Should().BeTrue("the default implementation is a completed no-op");
        await task;
    }

    /// <summary>A double written before takedown existed: it implements only <c>BroadcastPostAsync</c>.</summary>
    private sealed class PostOnlyBroadcaster : IFeedBroadcaster
    {
        public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }

    private static ParticipantPostDto SamplePost() => new()
    {
        Id = Guid.NewGuid().ToString(),
        AuthorPersonaId = Guid.NewGuid().ToString(),
        Text = "Boil-water advisory extended through Thursday.",
        ScenarioTime = new DateTimeOffset(2033, 9, 4, 13, 15, 0, TimeSpan.Zero).ToString("O"),
        Counts = new ParticipantPostCounts(0, 0, 0),
    };
}
