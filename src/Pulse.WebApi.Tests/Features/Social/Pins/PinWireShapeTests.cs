namespace Pulse.WebApi.Tests.Features.Social.Pins;

using System;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Moq;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Follows;
using Pulse.WebApi.Features.Social.Pins;
using Pulse.WebApi.Tests.Features.Realtime;
using Xunit;

/// <summary>
/// Docker-free checks of the frozen pin wire shapes (demo-feedback story 04, <c>implementation.md</c> Types) and the
/// <c>PostPinChanged</c> fan-out: what serializes, what is omitted, and which group receives the push.
/// </summary>
public sealed class PinWireShapeTests
{
    [Fact]
    public void PostPinChanged_SerializesToExactlyPostIdAndPinnedForAll()
    {
        var postId = Guid.NewGuid();

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(PostPinChangedDto.For(postId, pinnedForAll: true)));

        doc.RootElement.EnumerateObject().Select(p => p.Name).Should().Equal(
            new[] { "postId", "pinnedForAll" }, "PostPinChanged carries no text, author, instant or pinner (XC-002)");
        doc.RootElement.GetProperty("postId").GetString().Should().Be(postId.ToString());
        doc.RootElement.GetProperty("pinnedForAll").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public void ViewerState_SerializesLikedRepostedAndPinned()
    {
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(new PostViewerStateDto(true, false, true)));

        doc.RootElement.EnumerateObject().Select(p => p.Name).Should().Equal("liked", "reposted", "pinned");
        doc.RootElement.GetProperty("pinned").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public void FromPost_PinnedForAll_IsTrueWhenSet_AndOmittedOtherwise_NeverCarryingWhoPinnedIt()
    {
        var pinner = $"staff-secret-{Guid.NewGuid():N}";
        var pinned = NewPost(pinnedForAllAt: new DateTimeOffset(2033, 9, 4, 13, 0, 0, TimeSpan.Zero), pinnedBy: pinner);
        var unpinned = NewPost(pinnedForAllAt: null, pinnedBy: null);

        var pinnedJson = JsonSerializer.Serialize(ParticipantPostDto.FromPost(pinned));
        var unpinnedJson = JsonSerializer.Serialize(ParticipantPostDto.FromPost(unpinned));

        pinnedJson.Should().Contain("\"pinnedForAll\":true").And.NotContain(pinner);
        unpinnedJson.Should().NotContain("pinnedForAll", "the frozen type is `pinnedForAll?: true`: omitted, never false");
    }

    [Fact]
    public void PinnedFeedResponse_SerializesItemsOfReasonAndPost()
    {
        var post = ParticipantPostDto.FromPost(NewPost(null, null));
        var response = new PinnedFeedResponse([new PinnedFeedItemDto(PinnedFeedReasons.Pin, post)]);

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(response));

        doc.RootElement.EnumerateObject().Select(p => p.Name).Should().Equal("items");
        var item = doc.RootElement.GetProperty("items")[0];
        item.EnumerateObject().Select(p => p.Name).Should().Equal("reason", "post");
        item.GetProperty("reason").GetString().Should().Be("pin");
        item.GetProperty("post").GetProperty("id").GetString().Should().Be(post.Id);
    }

    [Fact]
    public async Task BroadcastPostPinChanged_SendsPostPinChanged_ToTheExerciseWideGroupOnly()
    {
        var exerciseId = Guid.NewGuid();
        var postId = Guid.NewGuid();

        var groupProxy = new Mock<IClientProxy>();
        var clients = new Mock<IHubClients>(MockBehavior.Strict);
        clients.Setup(c => c.Group($"exercise:{exerciseId}")).Returns(groupProxy.Object);
        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hubContext.SetupGet(h => h.Clients).Returns(clients.Object);

        await TestFeedBroadcasters.Create(hubContext.Object).BroadcastPostPinChangedAsync(exerciseId, postId, pinnedForAll: false);

        clients.Verify(c => c.Group($"exercise:{exerciseId}"), Times.Once);
        groupProxy.Verify(
            p => p.SendCoreAsync(
                "PostPinChanged",
                It.Is<object?[]>(args =>
                    args.Length == 1
                    && args[0] is PostPinChangedDto
                    && ((PostPinChangedDto)args[0]!).PostId == postId.ToString()
                    && !((PostPinChangedDto)args[0]!).PinnedForAll),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task IFeedBroadcaster_DefaultPinChanged_IsANoOp_SoOlderDoublesStillWork()
    {
        IFeedBroadcaster legacy = new PostOnlyBroadcaster();

        var task = legacy.BroadcastPostPinChangedAsync(Guid.NewGuid(), Guid.NewGuid(), pinnedForAll: true);

        task.IsCompletedSuccessfully.Should().BeTrue();
        await task;
    }

    [Fact]
    public async Task PinnedFeedService_WithNoScope_ReadsNothing()
    {
        // Never opened: an unresolved scope returns before the first query (COR-001, fail closed).
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer("Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;")
            .Options;
        var exerciseContext = new ExerciseContext { CurrentExerciseId = null };
        await using var dbContext = new PulseDbContext(options, exerciseContext);
        var service = new PinnedFeedService(
            dbContext, exerciseContext, Mock.Of<ICurrentSessionPersonaAccessor>(), Mock.Of<IParticipantPostProjector>());

        (await service.GetAsync()).Items.Should().BeEmpty();
    }

    private static Post NewPost(DateTimeOffset? pinnedForAllAt, string? pinnedBy) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = Guid.NewGuid(),
        AuthorPersonaId = Guid.NewGuid(),
        Body = "Shelter at Lincoln High is open.",
        CreatedScenarioTime = new DateTimeOffset(2033, 9, 4, 12, 0, 0, TimeSpan.Zero),
        Origin = "controller-as-persona",
        ActingHumanId = "human-wire",
        CreatedWallClock = DateTimeOffset.UtcNow,
        PinnedForAllAt = pinnedForAllAt,
        PinnedForAllByHumanId = pinnedBy,
    };

    private sealed class PostOnlyBroadcaster : IFeedBroadcaster
    {
        public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }
}
