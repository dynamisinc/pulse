namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Moq;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// Fast, Docker-free unit tests of <see cref="ExerciseRealtimeHub"/>'s group-membership logic — story
/// <c>social-api/03</c> (#272)'s <b>[Tier-2 — always-Critical isolation class]</b> AC, and part of the
/// standing cross-exercise isolation suite (<c>exercise-isolation/07</c>, COR-007; cross-references
/// <c>Data/QueryFilterIsolationTests.cs</c>, the same guarantee's read-side proof).
/// </summary>
/// <remarks>
/// Stubs <see cref="IExerciseContext"/> and mocks the base <see cref="Hub"/>'s <c>Context</c> (a
/// <see cref="HubCallerContext"/>) and <c>Groups</c> (an <see cref="IGroupManager"/>) directly with Moq,
/// exactly the "stub IExerciseContext + a test double" shape the story's test notes call for — no
/// TestServer, no network, no SignalR client, no container. Combined with
/// <see cref="SignalRFeedBroadcasterTests"/> (the broadcaster targets EXACTLY
/// <c>exercise:{exerciseId}</c> and no other group) and
/// <see cref="ExerciseRealtimeHubIsolationTests.Hub_ExposesNoClientInvocableMethod_ThatAcceptsAGroupOrExerciseId"/>
/// (no client-invocable method exists to request a different group), these three pieces together prove
/// the full isolation chain: a connection joins EXACTLY the group its server-resolved scope derives,
/// deterministically and injectively per exercise, a broadcast targets EXACTLY that same derivation for
/// its own exercise, and no client input can influence either side.
/// </remarks>
public class ExerciseRealtimeHubTests
{
    private const string ConnectionId = "test-connection-1";

    [Fact]
    public async Task OnConnectedAsync_ResolvedScope_JoinsExactlyTheExercisesGroup_AndDoesNotAbort()
    {
        var exerciseId = Guid.NewGuid();
        var exerciseContext = new Mock<IExerciseContext>();
        exerciseContext.SetupGet(c => c.CurrentExerciseId).Returns(exerciseId);

        var context = new Mock<HubCallerContext>();
        context.SetupGet(c => c.ConnectionId).Returns(ConnectionId);
        var groups = new Mock<IGroupManager>();

        var hub = new ExerciseRealtimeHub(exerciseContext.Object)
        {
            Context = context.Object,
            Groups = groups.Object,
        };

        await hub.OnConnectedAsync();

        groups.Verify(
            g => g.AddToGroupAsync(ConnectionId, $"exercise:{exerciseId}", It.IsAny<CancellationToken>()),
            Times.Once,
            "the connection must join exactly the group derived from its server-resolved exercise scope");
        context.Verify(c => c.Abort(), Times.Never, "a resolved scope must never abort the connection");
    }

    [Fact]
    public async Task OnConnectedAsync_NullScope_Aborts_NeverJoinsAnyGroup()
    {
        var exerciseContext = new Mock<IExerciseContext>();
        exerciseContext.SetupGet(c => c.CurrentExerciseId).Returns((Guid?)null);

        var context = new Mock<HubCallerContext>();
        context.SetupGet(c => c.ConnectionId).Returns(ConnectionId);
        var groups = new Mock<IGroupManager>();

        var hub = new ExerciseRealtimeHub(exerciseContext.Object)
        {
            Context = context.Object,
            Groups = groups.Object,
        };

        await hub.OnConnectedAsync();

        context.Verify(c => c.Abort(), Times.Once, "an unresolved (null) scope must abort the connection — fail closed");
        groups.Verify(
            g => g.AddToGroupAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never,
            "an aborted connection must never be added to any group, ambient or otherwise");
    }

    [Fact]
    public async Task OnConnectedAsync_ExplicitGuidEmptyScope_Aborts_NeverJoinsAnyGroup()
    {
        // A distinct fail-closed shape from "null" (mirrors QueryFilterIsolationTests' own coverage of
        // this same distinction on the read-side filter) — guards against a future refactor of the
        // hub's null-check silently admitting Guid.Empty as if it were a valid scope.
        var exerciseContext = new Mock<IExerciseContext>();
        exerciseContext.SetupGet(c => c.CurrentExerciseId).Returns(Guid.Empty);

        var context = new Mock<HubCallerContext>();
        context.SetupGet(c => c.ConnectionId).Returns(ConnectionId);
        var groups = new Mock<IGroupManager>();

        var hub = new ExerciseRealtimeHub(exerciseContext.Object)
        {
            Context = context.Object,
            Groups = groups.Object,
        };

        await hub.OnConnectedAsync();

        context.Verify(c => c.Abort(), Times.Once, "an explicit Guid.Empty scope must abort — fail closed, never an ambient/default group");
        groups.Verify(
            g => g.AddToGroupAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task OnConnectedAsync_DistinctExerciseScopes_JoinDistinctGroups_NeverTheSameGroup()
    {
        // The injectivity property the whole isolation chain leans on: two different exercises must
        // never collide onto the same group name.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        string? groupJoinedByA = null;
        string? groupJoinedByB = null;

        async Task<string?> JoinAndCaptureGroupAsync(Guid exerciseId)
        {
            var exerciseContext = new Mock<IExerciseContext>();
            exerciseContext.SetupGet(c => c.CurrentExerciseId).Returns(exerciseId);
            var context = new Mock<HubCallerContext>();
            context.SetupGet(c => c.ConnectionId).Returns(ConnectionId);

            string? capturedGroup = null;
            var groups = new Mock<IGroupManager>();
            groups
                .Setup(g => g.AddToGroupAsync(ConnectionId, It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .Callback<string, string, CancellationToken>((_, groupName, _) => capturedGroup = groupName)
                .Returns(Task.CompletedTask);

            var hub = new ExerciseRealtimeHub(exerciseContext.Object) { Context = context.Object, Groups = groups.Object };
            await hub.OnConnectedAsync();
            return capturedGroup;
        }

        groupJoinedByA = await JoinAndCaptureGroupAsync(exerciseA);
        groupJoinedByB = await JoinAndCaptureGroupAsync(exerciseB);

        groupJoinedByA.Should().NotBeNullOrEmpty();
        groupJoinedByB.Should().NotBeNullOrEmpty();
        groupJoinedByA.Should().NotBe(groupJoinedByB, "two different exercises must never resolve to the same group");
    }

    [Fact]
    public void Hub_ExposesNoClientInvocableMethod_ThatAcceptsAGroupOrExerciseId()
    {
        // Duplicated (deliberately) alongside ExerciseRealtimeHubIsolationTests' copy of this same
        // assertion: it is cheap, structural, and belongs next to the OnConnectedAsync behavioural proof
        // above just as much as next to the E2E suite below.
        var clientInvocableMethods = typeof(ExerciseRealtimeHub)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => !m.IsSpecialName)
            .Where(m => m.Name is not (nameof(Hub.OnConnectedAsync) or nameof(Hub.OnDisconnectedAsync)))
            .ToList();

        clientInvocableMethods.Should().BeEmpty(
            "the hub must expose NO client-invocable method a client could use to join or read another " +
            "exercise's group — group membership is derived from the server-side IExerciseContext only");
    }
}
