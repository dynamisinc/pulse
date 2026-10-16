namespace Pulse.WebApi.Tests.Features.Social.Editing;

using System;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.SignalR;
using Moq;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Editing;
using Xunit;

/// <summary>
/// demo-feedback story 19 — Docker-free contract tests: the edit rules (window, limit, countdown), the read DTOs'
/// <c>edited</c> / <c>viewer.editableForSeconds</c> wire shape (never the wall-clock <c>LastEditedAt</c>), the
/// <c>PostEdited</c> SignalR frame (event name, exercise group only, exact keys) and the no-op default interface method.
/// </summary>
public class PostEditContractTests
{
    private static readonly DateTimeOffset Created = new(2026, 10, 16, 14, 0, 0, TimeSpan.Zero);

    private static Post SamplePost(int editCount = 0, string origin = "participant", Guid? author = null) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = Guid.NewGuid(),
        AuthorPersonaId = author ?? Guid.NewGuid(),
        Body = "Current text",
        CreatedScenarioTime = new DateTimeOffset(2033, 9, 4, 13, 0, 0, TimeSpan.FromHours(-4)),
        CreatedWallClock = Created,
        Origin = origin,
        ActingHumanId = "human-1",
        EditCount = editCount,
        LastEditedAt = editCount > 0 ? Created.AddMinutes(3) : null,
        LastEditedScenarioTime = editCount > 0 ? new DateTimeOffset(2033, 9, 4, 13, 5, 0, TimeSpan.FromHours(-4)) : null,
    };

    private static JsonObject Serialize<T>(T value) =>
        JsonNode.Parse(JsonSerializer.Serialize(value, new JsonSerializerOptions()))!.AsObject();

    // ---- Rules (AC-3, AC-6) --------------------------------------------------------------------------------------

    [Fact]
    public void Window_ClosesStrictlyAfterFifteenMinutes()
    {
        var post = SamplePost();

        PostEditRules.IsWindowClosed(post, Created.AddMinutes(15)).Should().BeFalse("exactly 15:00 is still inside");
        PostEditRules.IsWindowClosed(post, Created.AddMinutes(15).AddSeconds(1)).Should().BeTrue();
        PostEditRules.IsWindowClosed(post, Created.AddMinutes(15).AddMinutes(1)).Should().BeTrue("15:01 is closed");
    }

    [Fact]
    public void EditableForSeconds_CountsDown_AndIsZeroWhenClosedOrAtTheLimit()
    {
        PostEditRules.EditableForSeconds(SamplePost(), Created).Should().Be(900);
        PostEditRules.EditableForSeconds(SamplePost(), Created.AddSeconds(59.5)).Should().Be(840, "rounded down");
        PostEditRules.EditableForSeconds(SamplePost(), Created.AddMinutes(16)).Should().Be(0);
        PostEditRules.EditableForSeconds(SamplePost(editCount: 5), Created).Should().Be(0, "five edits is the limit");
        PostEditRules.IsAtLimit(SamplePost(editCount: 4)).Should().BeFalse();
        PostEditRules.MaxEdits.Should().Be(5);
    }

    [Fact]
    public void OnlyTheViewersOwnParticipantPost_IsEditableForThem()
    {
        var viewer = Guid.NewGuid();

        PostEditRules.IsViewersOwnEditablePost(SamplePost(author: viewer), viewer).Should().BeTrue();
        PostEditRules.IsViewersOwnEditablePost(SamplePost(), viewer).Should().BeFalse("someone else's post");
        PostEditRules.IsViewersOwnEditablePost(SamplePost(author: viewer), null).Should().BeFalse("no viewer");
        foreach (var origin in new[] { "engine", "noise", "inject", "controller-as-persona" })
        {
            PostEditRules.IsViewersOwnEditablePost(SamplePost(origin: origin, author: viewer), viewer).Should().BeFalse(origin);
        }
    }

    // ---- DTOs (AC-6) ---------------------------------------------------------------------------------------------

    [Fact]
    public void ParticipantPostDto_FromPost_CarriesEditedNullWhenNeverEdited_AndTheScenarioSummaryOnceEdited()
    {
        var never = Serialize(ParticipantPostDto.FromPost(SamplePost()));
        never.ContainsKey("edited").Should().BeTrue("the frozen type is `edited: {...} | null`, always present");
        never["edited"].Should().BeNull();

        var post = SamplePost(editCount: 2);
        var edited = Serialize(ParticipantPostDto.FromPost(post));
        edited["edited"]!.AsObject().Select(p => p.Key).Should().Equal("count", "scenarioTime");
        edited["edited"]!["count"]!.GetValue<int>().Should().Be(2);
        edited["edited"]!["scenarioTime"]!.GetValue<string>().Should().Be(post.LastEditedScenarioTime!.Value.ToString("O"));

        var raw = JsonSerializer.Serialize(ParticipantPostDto.FromPost(post));
        raw.Should().NotContain(post.LastEditedAt!.Value.ToString("O"), "the wall-clock edit time never reaches a participant");
        raw.Should().NotContain("lastEditedAt").And.NotContain("editedAt");
    }

    [Fact]
    public void StaffPostDto_CarriesEdited_TheSameWay()
    {
        var never = Serialize(StaffPostDto.FromPost(SamplePost(origin: "controller-as-persona")));
        never.ContainsKey("edited").Should().BeTrue();
        never["edited"].Should().BeNull();

        var edited = Serialize(StaffPostDto.FromPost(SamplePost(editCount: 1)));
        edited["edited"]!["count"]!.GetValue<int>().Should().Be(1);
    }

    [Fact]
    public void ViewerState_OmitsEditableForSeconds_UnlessSet()
    {
        Serialize(new PostViewerStateDto(true, false, false)).Select(p => p.Key)
            .Should().Equal("liked", "reposted", "pinned");
        var withCountdown = Serialize(new PostViewerStateDto(false, false, false, EditableForSeconds: 0));
        withCountdown.Select(p => p.Key).Should().Equal("liked", "reposted", "pinned", "editableForSeconds");
        withCountdown["editableForSeconds"]!.GetValue<int>().Should().Be(0);
    }

    [Fact]
    public void RefusalBody_IsReasonOnly()
    {
        Serialize(new PostEditRefusalDto { Reason = PostEditRefusalReasons.WindowClosed }).Select(p => p.Key).Should().Equal("reason");
        new[] { PostEditRefusalReasons.WindowClosed, PostEditRefusalReasons.EditLimit, PostEditRefusalReasons.Frozen }
            .Should().Equal("window-closed", "edit-limit", "frozen");
    }

    // ---- PostEdited push (AC-6) ----------------------------------------------------------------------------------

    [Fact]
    public async Task SignalRBroadcaster_SendsPostEdited_ToTheExerciseGroupOnly_WithTheFrozenShape()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var proxyA = new Mock<IClientProxy>();
        var proxyB = new Mock<IClientProxy>();
        var clients = new Mock<IHubClients>();
        clients.Setup(c => c.Group($"exercise:{exerciseA}")).Returns(proxyA.Object);
        clients.Setup(c => c.Group($"exercise:{exerciseB}")).Returns(proxyB.Object);
        var hub = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hub.SetupGet(h => h.Clients).Returns(clients.Object);
        object? sent = null;
        proxyA.Setup(p => p.SendCoreAsync("PostEdited", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()))
            .Callback<string, object?[], CancellationToken>((_, args, _) => sent = args.Single())
            .Returns(Task.CompletedTask);

        var frame = new PostEditedDto
        {
            PostId = "p-1",
            Text = "fixed",
            Edited = new PostEditedSummaryDto { Count = 2, ScenarioTime = "2033-09-04T13:05:00.0000000-04:00" },
            Version = 2,
        };

        await new SignalRFeedBroadcaster(hub.Object).BroadcastPostEditedAsync(exerciseA, frame);

        proxyA.Verify(p => p.SendCoreAsync("PostEdited", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()), Times.Once);
        proxyB.Verify(p => p.SendCoreAsync(It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()), Times.Never);
        clients.Verify(c => c.Group(It.Is<string>(g => g != $"exercise:{exerciseA}")), Times.Never, "the exercise-wide group only");
        clients.Verify(c => c.All, Times.Never);

        var json = Serialize(sent);
        json.Select(p => p.Key).Should().Equal("postId", "text", "edited", "version");
        json["edited"]!.AsObject().Select(p => p.Key).Should().Equal("count", "scenarioTime");
        json["version"]!.GetValue<int>().Should().Be(2);
    }

    [Fact]
    public async Task DefaultInterfaceMethod_IsANoOp_ForOlderBroadcasterDoubles()
    {
        IFeedBroadcaster legacy = new LegacyBroadcaster();

        await legacy.Invoking(b => b.BroadcastPostEditedAsync(Guid.NewGuid(), new PostEditedDto
        {
            PostId = "p",
            Text = "t",
            Edited = new PostEditedSummaryDto { Count = 1, ScenarioTime = "s" },
            Version = 1,
        })).Should().NotThrowAsync();
    }

    // ---- Composition (S-5 seam) ----------------------------------------------------------------------------------

    [Fact]
    public void Routes_AreTheFrozenOnes()
    {
        PostEditEndpoints.EditRoute.Should().Be("/api/posts/{postId:guid}");
        PostEditEndpoints.HistoryRoute.Should().Be("/api/posts/{postId:guid}/edits");
        typeof(PostEditEndpoints).GetMethod(nameof(PostEditEndpoints.MapPostEditing))!.ReturnType
            .Should().Be(typeof(IEndpointRouteBuilder));
    }

    private sealed class LegacyBroadcaster : IFeedBroadcaster
    {
        public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }
}
