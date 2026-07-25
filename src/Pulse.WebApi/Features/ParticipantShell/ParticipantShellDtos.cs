namespace Pulse.WebApi.Features.ParticipantShell;

// FROZEN participant-shell config DTOs — the server-side port of the frontend participant-shell mock
// seams (shellState.ts, chromeConfig.ts, brandTokens.ts, channelNavConfig.ts, AlertBar/useAlerts.ts,
// OverlayLayer/overlayState.ts). Each type mirrors that seam's WIRE shape field-for-field so its runtime
// type-guard (isShellVariant / isChromeConfig / isBrandTokens / isChannelNavConfigResponseBody /
// AlertsResponseBody / isValidResponseBody) accepts the response with no consumer change.
//
// Serialized as camelCase by ASP.NET Core's default System.Text.Json (JsonSerializerDefaults.Web) — no
// [JsonPropertyName] is needed: PascalCase properties (OnSurface, CurrentChannelId, HideWhenSingleChannel)
// map to the exact camelCase wire keys (onSurface, currentChannelId, hideWhenSingleChannel). Enum-like
// fields (variant / state / register / icon) are string-typed initialized to their exact wire literal —
// NOT C# enums — so the wire value is guaranteed to be e.g. "in-fiction"/"none"/"social" verbatim.

/// <summary>
/// <c>GET /api/shell-state</c> body — the mount-relevant slice of shell state (<c>shellState.ts</c>). The
/// Phase-1 value is <c>full</c> (the valid set is <c>full | readOnly | kiosk | preview</c>): a resolved
/// participant shell gets the interactive variant, which enables the realtime feed stream + "new posts"
/// pill. A 404 here is what makes the frontend fall back to its fail-closed <c>readOnly</c> variant.
/// </summary>
public sealed record ShellStateResponse
{
    /// <summary>The shell variant. Phase-1: <c>full</c>.</summary>
    public string Variant { get; init; } = "full";
}

/// <summary>One compliance-chrome banner (top or bottom) — text plus foreground/background colors.</summary>
public sealed record ChromeBannerConfig
{
    /// <summary>The banner copy.</summary>
    public string Text { get; init; } = string.Empty;

    /// <summary>The banner foreground (text) color, as a CSS hex string.</summary>
    public string Fg { get; init; } = string.Empty;

    /// <summary>The banner background color, as a CSS hex string.</summary>
    public string Bg { get; init; } = string.Empty;
}

/// <summary>
/// <c>GET /api/chrome-config</c> body — the compliance-chrome config (<c>chromeConfig.ts</c>): whether
/// chrome is on, plus the top/bottom classification banners (COR-031, NFR-008).
/// </summary>
public sealed record ChromeConfigResponse
{
    /// <summary>Whether compliance chrome is shown (chrome-off is a legal per-exercise state, D7-008).</summary>
    public bool Enabled { get; init; }

    /// <summary>The top classification banner.</summary>
    public ChromeBannerConfig Top { get; init; } = new();

    /// <summary>The bottom classification banner.</summary>
    public ChromeBannerConfig Bottom { get; init; } = new();
}

/// <summary>
/// The minimal, channel-useful brand color set (<c>brandTokens.ts</c>'s <c>BrandColors</c>). <c>OnSurface</c>
/// serializes to the wire key <c>onSurface</c>.
/// </summary>
public sealed record BrandColors
{
    /// <summary>The brand primary color, as a CSS hex string.</summary>
    public string Primary { get; init; } = string.Empty;

    /// <summary>The brand accent color, as a CSS hex string.</summary>
    public string Accent { get; init; } = string.Empty;

    /// <summary>The surface (background) color, as a CSS hex string.</summary>
    public string Surface { get; init; } = string.Empty;

    /// <summary>The on-surface (foreground) color, as a CSS hex string. Wire key: <c>onSurface</c>.</summary>
    public string OnSurface { get; init; } = string.Empty;
}

/// <summary>
/// <c>GET /api/brand-tokens</c> body — the per-exercise brand tokens a channel themes against
/// (<c>brandTokens.ts</c>, COR-066/030). The optional <c>logo</c> slot is deliberately ABSENT from this
/// type so the response can never carry a <c>logo</c> key (absent optional is contract-valid; a
/// <c>"logo": null</c> is not).
/// </summary>
public sealed record BrandTokensResponse
{
    /// <summary>The brand name a channel may render.</summary>
    public string Name { get; init; } = string.Empty;

    /// <summary>The brand color set.</summary>
    public BrandColors Colors { get; init; } = new();
}

/// <summary>
/// One channel-nav catalog entry (<c>channelNavConfig.ts</c>'s wire <c>ChannelNavChannelWire</c>): the full
/// catalog, enabled or not — the frontend filters to enabled-only client-side.
/// </summary>
public sealed record ChannelNavChannel
{
    /// <summary>The channel id (e.g. <c>social</c>).</summary>
    public string Id { get; init; } = string.Empty;

    /// <summary>The channel label (e.g. <c>Social</c>).</summary>
    public string Label { get; init; } = string.Empty;

    /// <summary>The closed channel-icon identifier (<c>social | portal | news | press | weather</c>).</summary>
    public string Icon { get; init; } = string.Empty;

    /// <summary>Whether the channel is enabled in this exercise.</summary>
    public bool Enabled { get; init; }
}

/// <summary>
/// <c>GET /api/channel-nav-config</c> body — the channel catalog plus the current channel and the
/// single-channel-hide flag (<c>channelNavConfig.ts</c>, COR-061/062). <c>CurrentChannelId</c> and
/// <c>HideWhenSingleChannel</c> serialize to <c>currentChannelId</c> / <c>hideWhenSingleChannel</c>.
/// </summary>
public sealed record ChannelNavConfigResponse
{
    /// <summary>The full channel catalog (enabled or not).</summary>
    public IReadOnlyList<ChannelNavChannel> Channels { get; init; } = [];

    /// <summary>The id of the channel to select on mount. Wire key: <c>currentChannelId</c>.</summary>
    public string CurrentChannelId { get; init; } = string.Empty;

    /// <summary>Whether to hide the nav strip when only one channel is enabled. Wire key: <c>hideWhenSingleChannel</c>.</summary>
    public bool HideWhenSingleChannel { get; init; }
}

/// <summary>
/// One active in-fiction alert (<c>AlertBar/alertTypes.ts</c>'s <c>Alert</c>). Defined for wire fidelity; the
/// Phase-1 <c>/api/alerts</c> response carries an EMPTY alert list (controller-driven alert publish is
/// Phase 3), so this shape is never populated yet.
/// </summary>
public sealed record AlertDto
{
    /// <summary>Stable alert identity.</summary>
    public string Id { get; init; } = string.Empty;

    /// <summary>The alert severity (<c>info | advisory | emergency</c>).</summary>
    public string Severity { get; init; } = string.Empty;

    /// <summary>The in-fiction alert message.</summary>
    public string Message { get; init; } = string.Empty;

    /// <summary>The scenario-time instant the alert became active, as an ISO string (COR-053).</summary>
    public string ScenarioTime { get; init; } = string.Empty;
}

/// <summary>
/// <c>GET /api/alerts</c> body — the active-alert list (<c>AlertBar/useAlerts.ts</c>'s
/// <c>AlertsResponseBody</c>). The <c>alerts</c> property is always present; Phase-1 it is empty.
/// </summary>
public sealed record AlertsResponse
{
    /// <summary>The active alerts. Phase-1: always empty.</summary>
    public IReadOnlyList<AlertDto> Alerts { get; init; } = [];
}

/// <summary>
/// <c>GET /api/overlay-state</c> body — the break-fiction / pause overlay state
/// (<c>OverlayLayer/overlayState.ts</c>, COR-065). Phase-1: no overlay active (<c>state: none</c>,
/// <c>register: in-fiction</c>, empty message).
/// </summary>
public sealed record OverlayStateResponse
{
    /// <summary>The overlay state kind (<c>none | pause | endex | broadcast</c>). Phase-1: <c>none</c>.</summary>
    public string State { get; init; } = "none";

    /// <summary>The overlay register (<c>in-fiction | out-of-fiction</c>). Phase-1: <c>in-fiction</c>.</summary>
    public string Register { get; init; } = "in-fiction";

    /// <summary>The overlay message. Phase-1: empty.</summary>
    public string Message { get; init; } = string.Empty;
}
