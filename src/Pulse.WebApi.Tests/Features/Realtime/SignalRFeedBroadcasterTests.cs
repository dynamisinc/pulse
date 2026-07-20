namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Moq;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;

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

    private static ParticipantPostDto SamplePost() => new()
    {
        Id = Guid.NewGuid().ToString(),
        AuthorPersonaId = Guid.NewGuid().ToString(),
        Text = "Boil-water advisory extended through Thursday.",
        ScenarioTime = new DateTimeOffset(2033, 9, 4, 13, 15, 0, TimeSpan.Zero).ToString("O"),
        Counts = new ParticipantPostCounts(0, 0, 0),
    };
}
