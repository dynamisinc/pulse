namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.SignalR;
using Moq;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Realtime;
// The feature key HubCallerContext.GetHttpContext() looks up is SignalR's connection-layer
// IHttpContextFeature (Microsoft.AspNetCore.Http.Connections.Features), NOT the plain HTTP one — aliased to
// keep it unambiguous alongside Microsoft.AspNetCore.Http.Features (FeatureCollection).
using SignalRHttpContextFeature = Microsoft.AspNetCore.Http.Connections.Features.IHttpContextFeature;

/// <summary>
/// Fast, Docker-free unit tests of <see cref="ExerciseRealtimeHub"/>'s group-membership logic — story
/// <c>social-api/03</c> (#272)'s <b>[Tier-2 — always-Critical isolation class]</b> AC, and part of the
/// standing cross-exercise isolation suite (<c>exercise-isolation/07</c>, COR-007; cross-references
/// <c>Data/QueryFilterIsolationTests.cs</c>, the same guarantee's read-side proof).
/// </summary>
/// <remarks>
/// The hub resolves its exercise from the connection's host-resolved <c>HttpContext</c>
/// (<c>Context.GetHttpContext()?.GetHostResolvedExerciseId()</c>), NOT an injected scoped
/// <see cref="IExerciseContext"/> — because SignalR dispatches <c>OnConnectedAsync</c> in its own DI scope
/// where that injected context would always be unset. These tests therefore mock the base <see cref="Hub"/>'s
/// <c>Context</c> (a <see cref="HubCallerContext"/>) and expose a <see cref="DefaultHttpContext"/> through its
/// <c>Features</c> (the <see cref="IHttpContextFeature"/> that backs <c>Context.GetHttpContext()</c>), stamping
/// the host-resolved exercise id on it exactly as <c>ExerciseResolutionMiddleware</c> does — no TestServer, no
/// network, no SignalR client, no container. Combined with <see cref="SignalRFeedBroadcasterTests"/> (the
/// broadcaster targets EXACTLY <c>exercise:{exerciseId}</c> and no other group) and
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
        var context = BuildHubContext(hostResolvedExerciseId: exerciseId);
        var groups = new Mock<IGroupManager>();

        var hub = new ExerciseRealtimeHub
        {
            Context = context.Object,
            Groups = groups.Object,
        };

        await hub.OnConnectedAsync();

        groups.Verify(
            g => g.AddToGroupAsync(ConnectionId, $"exercise:{exerciseId}", It.IsAny<CancellationToken>()),
            Times.Once,
            "the connection must join exactly the group derived from its host-resolved exercise scope");
        context.Verify(c => c.Abort(), Times.Never, "a resolved scope must never abort the connection");
    }

    [Fact]
    public async Task OnConnectedAsync_NoHostResolved_Aborts_NeverJoinsAnyGroup()
    {
        // The host did not resolve to an exercise: the middleware stamped nothing on HttpContext.Items, so
        // GetHostResolvedExerciseId() returns null — the shipped fail-closed default.
        var context = BuildHubContext(hostResolvedExerciseId: null);
        var groups = new Mock<IGroupManager>();

        var hub = new ExerciseRealtimeHub
        {
            Context = context.Object,
            Groups = groups.Object,
        };

        await hub.OnConnectedAsync();

        context.Verify(c => c.Abort(), Times.Once, "an unresolved (null) host scope must abort the connection — fail closed");
        groups.Verify(
            g => g.AddToGroupAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never,
            "an aborted connection must never be added to any group, ambient or otherwise");
    }

    [Fact]
    public async Task OnConnectedAsync_NoHttpContext_Aborts_NeverJoinsAnyGroup()
    {
        // Context.GetHttpContext() itself yields null (no IHttpContextFeature) — the null-conditional read
        // must still fail closed, never join an ambient group.
        var context = new Mock<HubCallerContext>();
        context.SetupGet(c => c.ConnectionId).Returns(ConnectionId);
        context.SetupGet(c => c.Features).Returns(new FeatureCollection());
        var groups = new Mock<IGroupManager>();

        var hub = new ExerciseRealtimeHub
        {
            Context = context.Object,
            Groups = groups.Object,
        };

        await hub.OnConnectedAsync();

        context.Verify(c => c.Abort(), Times.Once, "a connection with no HttpContext must abort — fail closed");
        groups.Verify(
            g => g.AddToGroupAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task OnConnectedAsync_ExplicitGuidEmptyScope_Aborts_NeverJoinsAnyGroup()
    {
        // A distinct fail-closed shape from "no host resolved" (mirrors QueryFilterIsolationTests' own
        // coverage of this same distinction on the read-side filter) — guards against a future refactor of
        // the hub's null-check silently admitting Guid.Empty as if it were a valid scope.
        var context = BuildHubContext(hostResolvedExerciseId: Guid.Empty);
        var groups = new Mock<IGroupManager>();

        var hub = new ExerciseRealtimeHub
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

        async Task<string?> JoinAndCaptureGroupAsync(Guid exerciseId)
        {
            var context = BuildHubContext(hostResolvedExerciseId: exerciseId);

            string? capturedGroup = null;
            var groups = new Mock<IGroupManager>();
            groups
                .Setup(g => g.AddToGroupAsync(ConnectionId, It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .Callback<string, string, CancellationToken>((_, groupName, _) => capturedGroup = groupName)
                .Returns(Task.CompletedTask);

            var hub = new ExerciseRealtimeHub { Context = context.Object, Groups = groups.Object };
            await hub.OnConnectedAsync();
            return capturedGroup;
        }

        var groupJoinedByA = await JoinAndCaptureGroupAsync(exerciseA);
        var groupJoinedByB = await JoinAndCaptureGroupAsync(exerciseB);

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
            "exercise's group — group membership is derived from the server-side host-resolved HttpContext only");
    }

    /// <summary>
    /// Builds a mocked <see cref="HubCallerContext"/> that exposes a <see cref="DefaultHttpContext"/> through
    /// its <c>Features</c> (an <see cref="IHttpContextFeature"/>), so <c>Context.GetHttpContext()</c> returns
    /// it. When <paramref name="hostResolvedExerciseId"/> is supplied it is stamped on the HttpContext exactly
    /// as <c>ExerciseResolutionMiddleware</c> does; when <c>null</c>, nothing is stamped (an unresolved host).
    /// </summary>
    private static Mock<HubCallerContext> BuildHubContext(Guid? hostResolvedExerciseId)
    {
        var httpContext = new DefaultHttpContext();
        if (hostResolvedExerciseId is { } exerciseId)
        {
            httpContext.SetHostResolvedExerciseId(exerciseId);
        }

        // Back Context.GetHttpContext() (which reads Features.Get<IHttpContextFeature>()?.HttpContext) with a
        // feature exposing our DefaultHttpContext — exactly what the SignalR connection layer does live.
        var httpContextFeature = new Mock<SignalRHttpContextFeature>();
        httpContextFeature.SetupGet(f => f.HttpContext).Returns(httpContext);

        var features = new FeatureCollection();
        features.Set<SignalRHttpContextFeature>(httpContextFeature.Object);

        var context = new Mock<HubCallerContext>();
        context.SetupGet(c => c.ConnectionId).Returns(ConnectionId);
        context.SetupGet(c => c.Features).Returns(features);
        return context;
    }
}
