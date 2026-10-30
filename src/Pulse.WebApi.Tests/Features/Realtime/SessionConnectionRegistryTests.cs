namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Moq;
using Pulse.WebApi.Features.Realtime;
using Xunit;

/// <summary>
/// #602 adversarial-review W2 (L-2): <see cref="SessionConnectionRegistry"/> may never lose a registration to a
/// concurrent <see cref="SessionConnectionRegistry.Unregister"/> of ANOTHER connection of the same session. Before the
/// fix, A's unregister could see the session's inner set empty while B's register had already fetched that same set. A
/// then dropped the set, B wrote into the orphan, and a later revoke's take missed B, which kept its staff group.
/// </summary>
public sealed class SessionConnectionRegistryTests
{
    private const int Iterations = 200_000;

    [Fact]
    public void ConcurrentUnregisterOfOneConnection_NeverLosesAConcurrentRegisterOfAnother()
    {
        var registry = new SessionConnectionRegistry();
        var a = Context("connection-a");
        var b = Context("connection-b");
        var exerciseId = Guid.NewGuid();
        var sessions = new Guid[Iterations];
        for (var i = 0; i < Iterations; i++)
        {
            sessions[i] = Guid.NewGuid();
            registry.Register(sessions[i], exerciseId, a);
        }

        // Both threads walk the same sessions in lockstep (a barrier per iteration), so every session sees A's unregister
        // and B's register race each other.
        using var barrier = new Barrier(2);
        var unregister = Task.Factory.StartNew(
            () =>
            {
                for (var i = 0; i < Iterations; i++)
                {
                    barrier.SignalAndWait();
                    registry.Unregister(sessions[i], "connection-a");
                }
            },
            TaskCreationOptions.LongRunning);
        var register = Task.Factory.StartNew(
            () =>
            {
                for (var i = 0; i < Iterations; i++)
                {
                    barrier.SignalAndWait();
                    registry.Register(sessions[i], exerciseId, b);
                }
            },
            TaskCreationOptions.LongRunning);
        Task.WaitAll(unregister, register);

        var lost = 0;
        foreach (var session in sessions)
        {
            var taken = registry.Take(session);
            if (taken.Count != 1 || taken[0].ConnectionId != "connection-b")
            {
                lost++;
            }
        }

        lost.Should().Be(0, "B's registration must survive A's concurrent unregister, or a revoke would miss B");
    }

    [Fact]
    public void Take_RemovesEveryConnectionOfTheSession_AndUnregisterOfTheLastForgetsTheSession()
    {
        var registry = new SessionConnectionRegistry();
        var session = Guid.NewGuid();
        var exerciseId = Guid.NewGuid();
        registry.Register(session, exerciseId, Context("x"));
        registry.Register(session, exerciseId, Context("y"));

        registry.Unregister(session, "x");
        registry.Take(session).Should().ContainSingle().Which.ConnectionId.Should().Be("y");
        registry.Take(session).Should().BeEmpty("a take removes the session");

        registry.Register(session, exerciseId, Context("z"));
        registry.Unregister(session, "z");
        registry.Take(session).Should().BeEmpty();
    }

    /// <summary>
    /// #668 Gate-1 W-002: the post-commit cut runs with the request's token. A dropped request (token already cancelled)
    /// must still take every connection out of BOTH groups and abort it, because <see cref="SessionConnectionRegistry.Take"/>
    /// has already forgotten it and nothing could cut it later.
    /// </summary>
    [Fact]
    public async Task RevokeAsync_WithACancelledRequestToken_StillRemovesFromBothGroups_AndAborts()
    {
        var registry = new SessionConnectionRegistry();
        var session = Guid.NewGuid();
        var exerciseId = Guid.NewGuid();
        var context = new Mock<HubCallerContext>();
        context.SetupGet(c => c.ConnectionId).Returns("conn-1");
        registry.Register(session, exerciseId, context.Object);

        var groups = new Mock<IGroupManager>();
        groups
            .Setup(g => g.RemoveFromGroupAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns<string, string, CancellationToken>((_, _, token) =>
            {
                token.ThrowIfCancellationRequested();
                return Task.CompletedTask;
            });
        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hubContext.SetupGet(h => h.Groups).Returns(groups.Object);

        using var dropped = new CancellationTokenSource();
        await dropped.CancelAsync();

        await new SessionConnectionRevoker(registry, hubContext.Object).RevokeAsync([session], dropped.Token);

        groups.Verify(
            g => g.RemoveFromGroupAsync(
                "conn-1", ExerciseRealtimeHub.StaffGroupNameFor(exerciseId), It.IsAny<CancellationToken>()),
            Times.Once);
        groups.Verify(
            g => g.RemoveFromGroupAsync(
                "conn-1", ExerciseRealtimeHub.GroupNameFor(exerciseId), It.IsAny<CancellationToken>()),
            Times.Once);
        context.Verify(c => c.Abort(), Times.Once);
        registry.IsRegistered(session, "conn-1").Should().BeFalse();
    }

    /// <summary>
    /// #660 delta review: a throwing group removal must not stop the loop. Every connection after the failing one has
    /// already been taken out of the registry, so if the exception escaped, they would be orphans: unregistered, still
    /// in their groups, never aborted. Two connections on one session plus a second session; the very first removal
    /// throws. Every connection must still be asked out of BOTH groups and aborted, and nothing is rethrown (the
    /// revocation has already committed; one caller does not catch).
    /// </summary>
    [Fact]
    public async Task RevokeAsync_WhenTheFirstGroupRemovalThrows_StillCutsEveryTakenConnectionOfEverySession()
    {
        var registry = new SessionConnectionRegistry();
        var sessionA = Guid.NewGuid();
        var sessionB = Guid.NewGuid();
        var exerciseId = Guid.NewGuid();
        var contexts = new[] { ("a-1", sessionA), ("a-2", sessionA), ("b-1", sessionB) }
            .Select(pair =>
            {
                var context = new Mock<HubCallerContext>();
                context.SetupGet(c => c.ConnectionId).Returns(pair.Item1);
                registry.Register(pair.Item2, exerciseId, context.Object);
                return (Id: pair.Item1, Context: context);
            })
            .ToList();

        var calls = 0;
        var groups = new Mock<IGroupManager>();
        groups
            .Setup(g => g.RemoveFromGroupAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(() => Interlocked.Increment(ref calls) == 1
                ? Task.FromException(new InvalidOperationException("backplane hiccup"))
                : Task.CompletedTask);
        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hubContext.SetupGet(h => h.Groups).Returns(groups.Object);

        var act = () => new SessionConnectionRevoker(registry, hubContext.Object).RevokeAsync([sessionA, sessionB]);

        await act.Should().NotThrowAsync("the revocation already committed; the failure is logged, not rethrown");
        foreach (var (id, context) in contexts)
        {
            groups.Verify(
                g => g.RemoveFromGroupAsync(
                    id, ExerciseRealtimeHub.StaffGroupNameFor(exerciseId), It.IsAny<CancellationToken>()),
                Times.Once,
                $"{id} must be asked out of the staff group");
            groups.Verify(
                g => g.RemoveFromGroupAsync(
                    id, ExerciseRealtimeHub.GroupNameFor(exerciseId), It.IsAny<CancellationToken>()),
                Times.Once,
                $"{id} must be asked out of the exercise group");
            context.Verify(c => c.Abort(), Times.Once, $"{id} must be aborted");
        }

        registry.Take(sessionA).Should().BeEmpty();
        registry.Take(sessionB).Should().BeEmpty();
    }

    private static HubCallerContext Context(string connectionId)
    {
        var context = new Mock<HubCallerContext>();
        context.SetupGet(c => c.ConnectionId).Returns(connectionId);
        return context.Object;
    }
}
