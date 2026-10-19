namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Editing;
using Pulse.WebApi.Features.Social.Engagement;
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

        var broadcaster = TestFeedBroadcasters.Create(hubContext.Object);

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

        var broadcaster = TestFeedBroadcasters.Create(hubContext.Object);

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
        var broadcaster = TestFeedBroadcasters.Create(hubContext.Object);

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

        await TestFeedBroadcasters.Create(hubContext.Object).BroadcastPostRemovedAsync(exerciseId, postId);

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

        await TestFeedBroadcasters.Create(hubContext.Object).BroadcastPostRemovedAsync(exerciseA, Guid.NewGuid());

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

    // ---- #375: the EndEx send gate ---------------------------------------------------------------------

    /// <summary>The five participant frames the broadcaster sends, by client event name.</summary>
    public static readonly TheoryData<string> AllFrames = new()
    {
        "PostReceived",
        "PostRemoved",
        "PostPinChanged",
        "PostEdited",
        "PostEngagementChanged",
    };

    /// <summary>Every (frame, closed status) pair: build, completed, archived, an unknown literal, and a missing row.</summary>
    public static TheoryData<string, string?> FramesInClosedStates()
    {
        var data = new TheoryData<string, string?>();
        foreach (var frame in AllFrames)
        {
            foreach (var status in new[] { "build", "completed", "archived", "not-a-state", null })
            {
                data.Add(frame, status);
            }
        }

        return data;
    }

    /// <summary>Every (frame, open status) pair: staged, live, paused, and the legacy <c>active</c> literal.</summary>
    public static TheoryData<string, string> FramesInOpenStates()
    {
        var data = new TheoryData<string, string>();
        foreach (var frame in AllFrames)
        {
            foreach (var status in new[] { "staged", "live", "paused", "active" })
            {
                data.Add(frame, status);
            }
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(FramesInClosedStates))]
    public async Task Broadcast_WhenTheExerciseIsNotParticipantAccessible_NeverReachesTheParticipantGroup_OnlyTheStaffGroup(
        string frame, string? status)
    {
        // #375: after EndEx (or in build/archived, or on an unreadable status) a participant tab still connected to
        // /hubs/exercise must receive NOTHING. Staff consoles keep their live view through the staff group.
        var exerciseId = Guid.NewGuid();
        var participantGroup = new Mock<IClientProxy>();
        var staffGroup = new Mock<IClientProxy>();
        var clients = new Mock<IHubClients>(MockBehavior.Strict);
        clients.Setup(c => c.Group($"exercise:{exerciseId}")).Returns(participantGroup.Object);
        clients.Setup(c => c.Group($"exercise:{exerciseId}:staff")).Returns(staffGroup.Object);
        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hubContext.SetupGet(h => h.Clients).Returns(clients.Object);

        await SendAsync(TestFeedBroadcasters.Create(hubContext.Object, status), frame, exerciseId);

        clients.Verify(
            c => c.Group($"exercise:{exerciseId}"),
            Times.Never,
            $"a {frame} frame in lifecycle state '{status ?? "(no exercise row)"}' must fail closed: the participant group is never even addressed");
        participantGroup.Verify(
            p => p.SendCoreAsync(It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Never);
        staffGroup.Verify(
            p => p.SendCoreAsync(frame, It.Is<object?[]>(args => args.Length == 1), It.IsAny<CancellationToken>()),
            Times.Once,
            "staff consoles keep their live view of a closed exercise through the staff-only group");
    }

    [Theory]
    [MemberData(nameof(FramesInOpenStates))]
    public async Task Broadcast_WhenTheExerciseIsParticipantAccessible_ReachesTheExerciseWideGroup_AndNotTheStaffGroup(
        string frame, string status)
    {
        var exerciseId = Guid.NewGuid();
        var participantGroup = new Mock<IClientProxy>();
        var staffGroup = new Mock<IClientProxy>();
        var clients = new Mock<IHubClients>(MockBehavior.Strict);
        clients.Setup(c => c.Group($"exercise:{exerciseId}")).Returns(participantGroup.Object);
        clients.Setup(c => c.Group($"exercise:{exerciseId}:staff")).Returns(staffGroup.Object);
        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hubContext.SetupGet(h => h.Clients).Returns(clients.Object);

        await SendAsync(TestFeedBroadcasters.Create(hubContext.Object, status), frame, exerciseId);

        participantGroup.Verify(
            p => p.SendCoreAsync(frame, It.Is<object?[]>(args => args.Length == 1), It.IsAny<CancellationToken>()),
            Times.Once,
            $"in '{status}' participants are admitted, so the frame goes to the exercise-wide group as before");
        clients.Verify(
            c => c.Group($"exercise:{exerciseId}:staff"),
            Times.Never,
            "staff connections are in the exercise-wide group too, so they get the frame exactly once");
    }

    [Theory]
    [InlineData("build")]
    [InlineData("staged")]
    [InlineData("live")]
    [InlineData("paused")]
    [InlineData("completed")]
    [InlineData("archived")]
    [InlineData("active")]
    [InlineData("scheduled")]
    [InlineData("complete")]
    [InlineData("not-a-state")]
    [InlineData(null)]
    public void TheSendGatePredicate_IsTheRestGatesPredicate_AndTheLifecycleBehaviourHook(string? status)
    {
        // #375: the hub send gate must agree with ExerciseLifecycleGatingMiddleware (which calls
        // IsParticipantAccessible) and with the AC7 behaviour hook, for every literal including legacy and unknown.
        Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle.ExerciseLifecycleStates.IsParticipantAccessible(status)
            .Should().Be(
                Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle.ExerciseLifecycleStates.BehaviourOf(status).ParticipantAccessOpen,
                "the REST gate and the behaviour hook must never disagree about who is admitted");
    }

    [Fact]
    public void AddSocialRealtimeHub_Alone_RegistersTheLifecycleReader_SoTheBroadcasterResolves_WithoutReplacingAHostsOwn()
    {
        // #375: the broadcaster now needs ExerciseLifecycleStatusReader. AddSocialRealtimeHub must supply it itself
        // (not rely on AddPauseParticipantOverlay being wired), and only by TryAdd, so a host's own reader wins.
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSocialRealtimeHub();

        using (var provider = services.BuildServiceProvider())
        using (var scope = provider.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<IFeedBroadcaster>().Should().BeOfType<SignalRFeedBroadcaster>();
        }

        var hostsOwn = TestFeedBroadcasters.FixedStatus("live");
        var overridden = new ServiceCollection();
        overridden.AddSingleton(hostsOwn);
        overridden.AddSocialRealtimeHub();

        overridden.Where(d => d.ServiceType == typeof(ExerciseLifecycleStatusReader)).Should().ContainSingle()
            .Which.ImplementationInstance.Should().BeSameAs(hostsOwn, "the registration is TryAdd");
    }

    /// <summary>Sends <paramref name="frame"/> through the matching broadcaster method with a minimal payload.</summary>
    private static Task SendAsync(SignalRFeedBroadcaster broadcaster, string frame, Guid exerciseId) => frame switch
    {
        "PostReceived" => broadcaster.BroadcastPostAsync(exerciseId, SamplePost()),
        "PostRemoved" => broadcaster.BroadcastPostRemovedAsync(exerciseId, Guid.NewGuid()),
        "PostPinChanged" => broadcaster.BroadcastPostPinChangedAsync(exerciseId, Guid.NewGuid(), pinnedForAll: true),
        "PostEdited" => broadcaster.BroadcastPostEditedAsync(exerciseId, new PostEditedDto
        {
            PostId = Guid.NewGuid().ToString(),
            Text = "corrected",
            Edited = new PostEditedSummaryDto { Count = 1, ScenarioTime = "2033-09-04T13:05:00.0000000-04:00" },
            Version = 1,
        }),
        "PostEngagementChanged" => broadcaster.BroadcastPostEngagementChangedAsync(
            exerciseId, PostEngagementChangedDto.For(Guid.NewGuid(), new ParticipantPostCounts(1, 0, 0), 1)),
        _ => throw new ArgumentOutOfRangeException(nameof(frame), frame, "not a broadcaster frame"),
    };

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
