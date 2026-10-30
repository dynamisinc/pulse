namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// Channels-foundation story 09 (#705): the four FC-5 frames on <see cref="SignalRFeedBroadcaster"/>. Docker-free, over a
/// mocked hub context like <see cref="SignalRFeedBroadcasterTests"/> (which also runs the four frames through its #375
/// lifecycle theories). Covers the exact payloads, exercise isolation (XC-001), XC-002 on the wire, and the
/// disabled-channel gate.
/// </summary>
public class SignalRFeedBroadcasterChannelTests
{
    private const string News = ChannelVocabulary.News;
    private const string Weather = ChannelVocabulary.Weather;

    /// <summary>The three channel-gated content frames.</summary>
    public static readonly TheoryData<string> ContentFrames = new()
    {
        ChannelRealtimeEvents.ContentPublished,
        ChannelRealtimeEvents.ContentRevised,
        ChannelRealtimeEvents.ContentRetracted,
    };

    /// <summary>All four FC-5 frames.</summary>
    public static readonly TheoryData<string> AllChannelFrames = new(ChannelRealtimeEvents.All);

    // ---- Events: exactly the FC-5 payloads --------------------------------------------------------------

    [Fact]
    public void EventNames_AreTheFrozenFc5Names()
    {
        // The client (useChannelStream / CHANNEL_REALTIME_EVENTS) subscribes to these literals.
        new[]
        {
            SignalRFeedBroadcaster.ContentPublishedEvent,
            SignalRFeedBroadcaster.ContentRevisedEvent,
            SignalRFeedBroadcaster.ContentRetractedEvent,
            SignalRFeedBroadcaster.AlertsChangedEvent,
        }.Should().Equal("ContentPublished", "ContentRevised", "ContentRetracted", "AlertsChanged");
    }

    [Fact]
    public async Task EachFrame_SendsItsEvent_WithTheGivenPayloadInstance_ToTheExerciseGroup()
    {
        var exerciseId = Guid.NewGuid();
        var hub = new StrictHub(exerciseId);
        var broadcaster = TestFeedBroadcasters.Create(hub.Context);

        var published = ChannelFrames.Published();
        var revised = ChannelFrames.Revised();
        var retracted = ChannelFrames.Retracted();
        var alerts = ChannelFrames.Alerts();

        await broadcaster.BroadcastContentPublishedAsync(exerciseId, published);
        await broadcaster.BroadcastContentRevisedAsync(exerciseId, revised);
        await broadcaster.BroadcastContentRetractedAsync(exerciseId, retracted);
        await broadcaster.BroadcastAlertsChangedAsync(exerciseId, alerts);

        // Reference equality: the broadcaster forwards the funnel's DTO verbatim, never a re-derived copy.
        hub.Participants.VerifySentOnce("ContentPublished", published);
        hub.Participants.VerifySentOnce("ContentRevised", revised);
        hub.Participants.VerifySentOnce("ContentRetracted", retracted);
        hub.Participants.VerifySentOnce("AlertsChanged", alerts);
        hub.Staff.VerifyNothingSent("staff connections are in the exercise-wide group, so they get each frame once");
    }

    [Fact]
    public async Task SilentRewrite_StillSendsContentRevised_WithTheMovedStamp_AndNoRevisionEntry()
    {
        // FC-1: a silent_rewrite moves updatedScenarioTime but adds no revisions[] entry. The broadcaster must still
        // send the frame (so open pages refetch) and must not invent or drop a revision.
        var exerciseId = Guid.NewGuid();
        var hub = new StrictHub(exerciseId);
        var silent = ChannelFrames.Revised() with { Revisions = [] };

        await TestFeedBroadcasters.Create(hub.Context).BroadcastContentRevisedAsync(exerciseId, silent);

        hub.Participants.Proxy.Verify(
            p => p.SendCoreAsync(
                "ContentRevised",
                It.Is<object?[]>(args => args.Length == 1
                    && ReferenceEquals(args[0], silent)
                    && ((ContentRevisedDto)args[0]!).Revisions.Count == 0
                    && ((ContentRevisedDto)args[0]!).UpdatedScenarioTime == silent.UpdatedScenarioTime),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public void Wire_ContentRevised_HasExactlyTheFc5Keys_AndNoBody()
    {
        Keys(ChannelFrames.Revised()).Should().BeEquivalentTo(
            "id", "channelId", "permalink", "updatedScenarioTime", "revisions", "headline", "dek");
    }

    [Fact]
    public void Wire_ContentRetracted_HasExactlyTheFc5Keys()
    {
        Keys(ChannelFrames.Retracted()).Should().BeEquivalentTo("id", "channelId", "permalink", "retractedScenarioTime");
    }

    [Fact]
    public void Wire_AlertsChanged_CarriesTheFullActiveSet_Only()
    {
        Keys(ChannelFrames.Alerts()).Should().BeEquivalentTo("alerts");
    }

    [Fact]
    public void Wire_NoFrame_CarriesProvenance_ABody_OrAWallClock()
    {
        // XC-002: the frames carry no origin, acting human, inject id or wall clock; ContentPublished is a SUMMARY
        // (no body), so a list can update without a payload a hidden reader could scrape.
        var forbidden = new[] { "origin", "actingHumanId", "injectId", "createdWallClock", "wallClock", "serverTime", "body", "status" };
        object[] frames = [ChannelFrames.Published(), ChannelFrames.Revised(), ChannelFrames.Retracted(), ChannelFrames.Alerts()];

        foreach (var frame in frames)
        {
            var json = JsonSerializer.Serialize(frame, frame.GetType());
            foreach (var key in forbidden)
            {
                json.Should().NotContain($"\"{key}\"", $"{frame.GetType().Name} must not carry '{key}' (XC-002)");
            }
        }
    }

    // ---- Scoped (XC-001) ---------------------------------------------------------------------------------

    [Theory]
    [MemberData(nameof(AllChannelFrames))]
    public async Task AFrameForExerciseA_NeverAddressesExerciseBsGroups(string frame)
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var participantsA = new Mock<IClientProxy>();
        var clients = new Mock<IHubClients>(MockBehavior.Strict);
        clients.Setup(c => c.Group($"exercise:{exerciseA}")).Returns(participantsA.Object);
        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hubContext.SetupGet(h => h.Clients).Returns(clients.Object);

        await SendAsync(TestFeedBroadcasters.Create(hubContext.Object), frame, exerciseA);

        clients.Verify(
            c => c.Group(It.Is<string>(name => name.Contains(exerciseB.ToString(), StringComparison.Ordinal))),
            Times.Never,
            "a frame for exercise A must never address any group of exercise B (XC-001)");
        participantsA.Verify(p => p.SendCoreAsync(frame, It.IsAny<object?[]>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    // ---- Disabled channel is silent ---------------------------------------------------------------------

    [Theory]
    [MemberData(nameof(ContentFrames))]
    public async Task ContentFrame_ForADisabledChannel_GoesToTheStaffGroupOnly(string frame)
    {
        var exerciseId = Guid.NewGuid();
        var hub = new StrictHub(exerciseId);
        var broadcaster = TestFeedBroadcasters.Create(hub.Context, "live", TestFeedBroadcasters.EnabledChannels("social", Weather));

        await SendAsync(broadcaster, frame, exerciseId, channelId: News);

        hub.Clients.Verify(
            c => c.Group($"exercise:{exerciseId}"),
            Times.Never,
            "a disabled channel's frame must never address the participant group, so its headline never leaks");
        hub.Staff.Proxy.Verify(
            p => p.SendCoreAsync(frame, It.Is<object?[]>(args => args.Length == 1), It.IsAny<CancellationToken>()),
            Times.Once,
            "staff (who author content before enabling a channel) keep their live view");
    }

    [Theory]
    [MemberData(nameof(ContentFrames))]
    public async Task ContentFrame_ForAnEnabledChannel_GoesToTheExerciseGroup(string frame)
    {
        var exerciseId = Guid.NewGuid();
        var hub = new StrictHub(exerciseId);
        var broadcaster = TestFeedBroadcasters.Create(hub.Context, "live", TestFeedBroadcasters.EnabledChannels("social", News));

        await SendAsync(broadcaster, frame, exerciseId, channelId: News);

        hub.Participants.Proxy.Verify(
            p => p.SendCoreAsync(frame, It.Is<object?[]>(args => args.Length == 1), It.IsAny<CancellationToken>()),
            Times.Once);
        hub.Clients.Verify(c => c.Group($"exercise:{exerciseId}:staff"), Times.Never);
    }

    [Theory]
    [MemberData(nameof(ContentFrames))]
    public async Task ContentFrame_AsksTheReaderAboutItsOwnExerciseAndChannel(string frame)
    {
        var exerciseId = Guid.NewGuid();
        var hub = new StrictHub(exerciseId);
        (Guid ExerciseId, string ChannelId)? asked = null;
        ExerciseChannelEnabledReader reader = (id, channel, _) =>
        {
            asked = (id, channel);
            return Task.FromResult(true);
        };

        await SendAsync(TestFeedBroadcasters.Create(hub.Context, "live", reader), frame, exerciseId, channelId: Weather);

        asked.Should().Be((exerciseId, Weather));
    }

    [Theory]
    [MemberData(nameof(ContentFrames))]
    public async Task ContentFrame_InAClosedExercise_SkipsTheChannelRead_AndGoesToStaff(string frame)
    {
        var exerciseId = Guid.NewGuid();
        var hub = new StrictHub(exerciseId);
        var channelReads = 0;
        ExerciseChannelEnabledReader reader = (_, _, _) =>
        {
            Interlocked.Increment(ref channelReads);
            return Task.FromResult(true);
        };

        await SendAsync(TestFeedBroadcasters.Create(hub.Context, "completed", reader), frame, exerciseId);

        channelReads.Should().Be(0, "the lifecycle gate already closed the participant group");
        hub.Staff.Proxy.Verify(p => p.SendCoreAsync(frame, It.IsAny<object?[]>(), It.IsAny<CancellationToken>()), Times.Once);
        hub.Clients.Verify(c => c.Group($"exercise:{exerciseId}"), Times.Never);
    }

    [Fact]
    public async Task AlertsChanged_IsNotChannelGated()
    {
        // The alert bar is shell-wide; an alert sourced from a disabled channel is still the active set GET /api/alerts serves.
        var exerciseId = Guid.NewGuid();
        var hub = new StrictHub(exerciseId);
        ExerciseChannelEnabledReader reader = (_, _, _) => throw new InvalidOperationException("must not be read");

        await TestFeedBroadcasters.Create(hub.Context, "live", reader).BroadcastAlertsChangedAsync(exerciseId, ChannelFrames.Alerts());

        hub.Participants.Proxy.Verify(
            p => p.SendCoreAsync("AlertsChanged", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [MemberData(nameof(ContentFrames))]
    public async Task ContentFrame_WhenTheChannelReadThrows_AddressesNoGroup_AndPropagates(string frame)
    {
        var clients = new Mock<IHubClients>(MockBehavior.Strict);
        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hubContext.SetupGet(h => h.Clients).Returns(clients.Object);
        ExerciseChannelEnabledReader reader = (_, _, _) => throw new InvalidOperationException("channel read failed");
        var broadcaster = new SignalRFeedBroadcaster(
            hubContext.Object, TestFeedBroadcasters.FixedStatus("live"), reader, NullLogger<SignalRFeedBroadcaster>.Instance);

        var act = () => SendAsync(broadcaster, frame, Guid.NewGuid());

        await act.Should().ThrowAsync<InvalidOperationException>().WithMessage("channel read failed");
        clients.Verify(c => c.Group(It.IsAny<string>()), Times.Never);
    }

    [Theory]
    [InlineData(null, "social", true)]
    [InlineData(null, "news", false)]
    [InlineData("", "news", false)]
    [InlineData("social,news", "news", true)]
    [InlineData("social,news", "weather", false)]
    [InlineData("Social, NEWS", "news", true)]
    [InlineData("not-a-channel", "social", true)]
    [InlineData("not-a-channel", "news", false)]
    public void IsEnabled_ReadsTheOneRegistry_WithTheSocialOnlyDefault(string? stored, string channelId, bool expected)
    {
        ExerciseChannelEnabledReaderServiceCollectionExtensions.IsEnabled(stored, channelId).Should().Be(expected);
    }

    private static string[] Keys(object frame)
    {
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(frame, frame.GetType()));
        return doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray();
    }

    private static Task SendAsync(SignalRFeedBroadcaster broadcaster, string frame, Guid exerciseId, string channelId = News) =>
        frame switch
        {
            "ContentPublished" => broadcaster.BroadcastContentPublishedAsync(exerciseId, ChannelFrames.Published(channelId)),
            "ContentRevised" => broadcaster.BroadcastContentRevisedAsync(exerciseId, ChannelFrames.Revised(channelId)),
            "ContentRetracted" => broadcaster.BroadcastContentRetractedAsync(exerciseId, ChannelFrames.Retracted(channelId)),
            "AlertsChanged" => broadcaster.BroadcastAlertsChangedAsync(exerciseId, ChannelFrames.Alerts()),
            _ => throw new ArgumentOutOfRangeException(nameof(frame), frame, "not a broadcaster frame"),
        };

    /// <summary>A strict hub: only the exercise's participant and staff groups may be addressed.</summary>
    private sealed class StrictHub
    {
        public StrictHub(Guid exerciseId)
        {
            Clients = new Mock<IHubClients>(MockBehavior.Strict);
            Clients.Setup(c => c.Group($"exercise:{exerciseId}")).Returns(Participants.Proxy.Object);
            Clients.Setup(c => c.Group($"exercise:{exerciseId}:staff")).Returns(Staff.Proxy.Object);
            var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
            hubContext.SetupGet(h => h.Clients).Returns(Clients.Object);
            Context = hubContext.Object;
        }

        public Mock<IHubClients> Clients { get; }

        public GroupProxy Participants { get; } = new();

        public GroupProxy Staff { get; } = new();

        public IHubContext<ExerciseRealtimeHub> Context { get; }
    }

    /// <summary>A mocked group proxy with frame assertions.</summary>
    private sealed class GroupProxy
    {
        public Mock<IClientProxy> Proxy { get; } = new();

        public void VerifySentOnce(string eventName, object payload) =>
            Proxy.Verify(
                p => p.SendCoreAsync(
                    eventName,
                    It.Is<object?[]>(args => args.Length == 1 && ReferenceEquals(args[0], payload)),
                    It.IsAny<CancellationToken>()),
                Times.Once);

        public void VerifyNothingSent(string because) =>
            Proxy.Verify(
                p => p.SendCoreAsync(It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
                Times.Never,
                because);
    }
}
