namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
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

    private static HubCallerContext Context(string connectionId)
    {
        var context = new Mock<HubCallerContext>();
        context.SetupGet(c => c.ConnectionId).Returns(connectionId);
        return context.Object;
    }
}
