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
/// Pins the TARGET of the staff-only <c>ReviewItemChanged</c> push (demo-polish B5, home story social-api/05;
/// XC-002, COR-001): <see cref="EngineReviewBroadcaster"/> sends to the exercise's role-scoped staff group
/// <c>exercise:{id}:staff</c> — the group <see cref="ExerciseRealtimeHub"/> admits a connection to only after
/// verifying a live, assigned staff session — and NEVER to the exercise-wide <c>exercise:{id}</c> group that
/// participant connections join. Docker-free: the broadcaster's only collaborator is
/// <see cref="IHubContext{THub}"/>, whose <see cref="IHubClients"/> is a STRICT mock here, so any group, user,
/// connection or "all clients" lookup other than the expected staff group fails the test.
/// </summary>
public sealed class EngineReviewBroadcasterScopeTests
{
    [Fact]
    public async Task BroadcastReviewItemChangedAsync_TargetsTheExercisesStaffGroup_NeverTheExerciseWideGroup()
    {
        var exerciseId = Guid.NewGuid();
        var item = SampleItem(exerciseId);
        var (broadcaster, clients, requestedGroups, staffProxy) = BuildBroadcaster(allowedGroups: [$"exercise:{exerciseId}:staff"]);

        await broadcaster.BroadcastReviewItemChangedAsync(exerciseId, item);

        requestedGroups.Should().Equal(
            new[] { $"exercise:{exerciseId}:staff" },
            "the staff-only review push goes to the role-scoped staff group ONLY — exercise:{id} is the group "
            + "every participant connection joins, so targeting it would put unpublished drafts in participant browsers");
        requestedGroups.Should().NotContain($"exercise:{exerciseId}");
        staffProxy[$"exercise:{exerciseId}:staff"].Verify(
            p => p.SendCoreAsync(
                "ReviewItemChanged",
                It.Is<object?[]>(args => args.Length == 1 && ReferenceEquals(args[0], item)),
                It.IsAny<CancellationToken>()),
            Times.Once);

        // The strict IHubClients mock has already thrown on any lookup other than the staff group (All, the
        // exercise-wide Group, User, Client...); this pins that the one allowed lookup happened exactly once.
        clients.Verify(c => c.Group($"exercise:{exerciseId}:staff"), Times.Once);
    }

    [Fact]
    public async Task BroadcastReviewItemChangedAsync_TargetsOnlyTheOwningExercisesStaffGroup_NeverAnothers()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var (broadcaster, _, requestedGroups, proxies) = BuildBroadcaster(
            allowedGroups: [$"exercise:{exerciseA}:staff", $"exercise:{exerciseB}:staff"]);

        await broadcaster.BroadcastReviewItemChangedAsync(exerciseA, SampleItem(exerciseA));

        requestedGroups.Should().Equal(new[] { $"exercise:{exerciseA}:staff" });
        proxies[$"exercise:{exerciseB}:staff"].Verify(
            p => p.SendCoreAsync(It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Never,
            "exercise A's staff push must never reach exercise B's staff connections (COR-001)");
    }

    /// <summary>
    /// A broadcaster over a strict <see cref="IHubClients"/> that only answers <c>Group(name)</c> for
    /// <paramref name="allowedGroups"/> and records every group name requested.
    /// </summary>
    private static (EngineReviewBroadcaster Broadcaster, Mock<IHubClients> Clients, List<string> RequestedGroups, Dictionary<string, Mock<IClientProxy>> Proxies)
        BuildBroadcaster(string[] allowedGroups)
    {
        var requestedGroups = new List<string>();
        var proxies = new Dictionary<string, Mock<IClientProxy>>(StringComparer.Ordinal);
        var clients = new Mock<IHubClients>(MockBehavior.Strict);

        foreach (var group in allowedGroups)
        {
            var proxy = new Mock<IClientProxy>();
            proxies[group] = proxy;
            clients
                .Setup(c => c.Group(group))
                .Callback<string>(requestedGroups.Add)
                .Returns(proxy.Object);
        }

        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hubContext.SetupGet(h => h.Clients).Returns(clients.Object);

        return (new EngineReviewBroadcaster(hubContext.Object), clients, requestedGroups, proxies);
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
