namespace Pulse.WebApi.Tests.Features.Channels;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;

/// <summary>
/// Channels-foundation story 02 (#698), AC "Seams declared": <see cref="IFeedBroadcaster"/> gains the four FC-5
/// methods as NO-OP default interface methods, so a double that implements only the original member still compiles
/// and the funnel (04) and alert source (10) can call them before story 09 implements the fan-out.
/// </summary>
public class FeedBroadcasterChannelDefaultsTests
{
    /// <summary>A double written against the pre-channels interface: it implements the one abstract member only.</summary>
    private sealed class LegacyDouble : IFeedBroadcaster
    {
        public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, System.Threading.CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }

    [Fact]
    public async Task ChannelMethods_AreCompletedNoOpsByDefault()
    {
        IFeedBroadcaster broadcaster = new LegacyDouble();
        var exerciseId = Guid.NewGuid();
        var outlet = new OutletRefDto { Id = "o", ChannelId = "news", Slug = "o", Name = "O", SkinKey = "o" };

        await broadcaster.BroadcastContentPublishedAsync(exerciseId, new ChannelContentSummaryDto
        {
            Id = "c", ChannelId = "news", Kind = "article", Outlet = outlet, Slug = "a", Permalink = "/news/o/a",
            Headline = "H", PublishedScenarioTime = "2026-12-02T14:05:00Z",
        });
        await broadcaster.BroadcastContentRevisedAsync(exerciseId, new ContentRevisedDto
        {
            Id = "c", ChannelId = "news", Permalink = "/news/o/a", Headline = "H",
        });
        await broadcaster.BroadcastContentRetractedAsync(exerciseId, new ContentRetractedDto
        {
            Id = "c", ChannelId = "news", Permalink = "/news/o/a", RetractedScenarioTime = "2026-12-02T14:40:00Z",
        });
        var alerts = broadcaster.BroadcastAlertsChangedAsync(exerciseId, new AlertsChangedDto());

        alerts.IsCompletedSuccessfully.Should().BeTrue();
        await alerts;
    }

    [Theory]
    [InlineData(nameof(IFeedBroadcaster.BroadcastContentPublishedAsync))]
    [InlineData(nameof(IFeedBroadcaster.BroadcastContentRevisedAsync))]
    [InlineData(nameof(IFeedBroadcaster.BroadcastContentRetractedAsync))]
    [InlineData(nameof(IFeedBroadcaster.BroadcastAlertsChangedAsync))]
    public void ChannelMethod_IsADefaultInterfaceMethod(string name)
    {
        var method = typeof(IFeedBroadcaster).GetMethod(name);

        method.Should().NotBeNull();
        method!.IsAbstract.Should().BeFalse("FC-5 methods ship as default no-ops so existing doubles keep compiling");
    }
}
