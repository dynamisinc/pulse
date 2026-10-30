namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>Minimal, valid FC-5 frame payloads for the channels-foundation 09 broadcaster tests.</summary>
internal static class ChannelFrames
{
    /// <summary>The <c>ContentPublished</c> payload for a news article.</summary>
    /// <param name="channelId">The item's channel.</param>
    /// <returns>The summary.</returns>
    public static ChannelContentSummaryDto Published(string channelId = ChannelVocabulary.News) => new()
    {
        Id = Guid.NewGuid().ToString(),
        ChannelId = channelId,
        Kind = "article",
        Outlet = new OutletRefDto { Id = Guid.NewGuid().ToString(), ChannelId = channelId, Slug = "ledger", Name = "The Ledger", SkinKey = "broadsheet" },
        Slug = "river-crest",
        Permalink = $"/{channelId}/ledger/river-crest",
        Headline = "River expected to crest Thursday",
        Dek = "Officials urge low-lying residents to prepare.",
        PublishedScenarioTime = "2033-09-04T14:05:00.0000000-04:00",
    };

    /// <summary>
    /// The <c>ContentRevised</c> payload the funnel builds for a <c>silent_rewrite</c>: the Updated stamp moved, and NO
    /// revisions entry (FC-1).
    /// </summary>
    /// <param name="channelId">The item's channel.</param>
    /// <returns>The frame.</returns>
    public static ContentRevisedDto Revised(string channelId = ChannelVocabulary.News) => new()
    {
        Id = Guid.NewGuid().ToString(),
        ChannelId = channelId,
        Permalink = $"/{channelId}/ledger/river-crest",
        UpdatedScenarioTime = "2033-09-04T15:20:00.0000000-04:00",
        Revisions = [],
        Headline = "River now expected to crest Wednesday night",
        Dek = null,
    };

    /// <summary>The <c>ContentRetracted</c> payload.</summary>
    /// <param name="channelId">The item's channel.</param>
    /// <returns>The frame.</returns>
    public static ContentRetractedDto Retracted(string channelId = ChannelVocabulary.News) => new()
    {
        Id = Guid.NewGuid().ToString(),
        ChannelId = channelId,
        Permalink = $"/{channelId}/ledger/river-crest",
        RetractedScenarioTime = "2033-09-04T16:00:00.0000000-04:00",
    };

    /// <summary>The <c>AlertsChanged</c> payload: a full active set of one alert.</summary>
    /// <returns>The frame.</returns>
    public static AlertsChangedDto Alerts() => new()
    {
        Alerts =
        [
            new AlertDto
            {
                Id = Guid.NewGuid().ToString(),
                Severity = ChannelVocabulary.SeverityAdvisory,
                Message = "Flash flood warning for Riverside County",
                ScenarioTime = "2033-09-04T14:00:00.0000000-04:00",
                Href = "/weather",
                SourceChannel = ChannelVocabulary.Weather,
            },
        ],
    };
}
