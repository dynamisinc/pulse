namespace Pulse.WebApi.Features.Channels.Alerts;

using System.Text.Json.Serialization;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// <c>GET /api/alerts</c> body: the active set, highest severity first then newest. Same shape as the shell's
/// <c>AlertsResponseBody</c> (<c>{ alerts }</c>); each entry is the FC-3 <see cref="AlertDto"/> superset of the shell's
/// <c>Alert</c>, whose extra keys the shell guard tolerates.
/// </summary>
public sealed record ActiveAlertsResponse
{
    /// <summary>The active alerts; empty means a zero-height bar (D7).</summary>
    [JsonPropertyName("alerts")]
    public IReadOnlyList<AlertDto> Alerts { get; init; } = [];
}

/// <summary>
/// <c>GET /api/alerts/history</c> body (PRT-012): every alert of the exercise, cleared and expired included, newest
/// first, one page at a time.
/// </summary>
public sealed record AlertHistoryResponse
{
    /// <summary>This page, newest first.</summary>
    [JsonPropertyName("alerts")]
    public IReadOnlyList<AlertDto> Alerts { get; init; } = [];

    /// <summary>The opaque cursor for the next (older) page, or null on the last page.</summary>
    [JsonPropertyName("nextCursor")]
    public string? NextCursor { get; init; }
}

/// <summary>
/// <c>POST /api/alerts</c> body: a controller raising an alert from the console (CTL-021). The source is always
/// <see cref="ChannelVocabulary.AlertSourceSystem"/>; channel-sourced alerts (weather, news flash) come through
/// <see cref="IAlertRaiser"/> in-process, never this route.
/// </summary>
/// <remarks>
/// There is deliberately NO register / real-world / out-of-fiction field (SHELL-CONTRACT §2): an alert is always
/// in-fiction, and a real-world message is only ever the break-fiction overlay.
/// </remarks>
public sealed record StaffAlertRaiseRequest
{
    /// <summary>The severity: <c>info</c> / <c>advisory</c> / <c>emergency</c>.</summary>
    [JsonPropertyName("severity")]
    public string? Severity { get; init; }

    /// <summary>The headline, 1..200 characters of plain text (any markup is stripped).</summary>
    [JsonPropertyName("headline")]
    public string? Headline { get; init; }

    /// <summary>The host-relative "Details" target, or null.</summary>
    [JsonPropertyName("href")]
    public string? Href { get; init; }

    /// <summary>The scenario-time expiry as an ISO string with an offset, or null for "until cleared".</summary>
    [JsonPropertyName("expiresScenarioTime")]
    public string? ExpiresScenarioTime { get; init; }
}
