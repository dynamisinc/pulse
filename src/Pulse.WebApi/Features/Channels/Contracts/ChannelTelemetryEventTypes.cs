namespace Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// FC-6 / FC-6b, the channels' telemetry <c>eventType</c> vocabulary on the server, registered ONCE by
/// channels-foundation story 02 for every channel (news FU-7, weather FU-7, portal FU-2, press PC-5). The
/// client mirror is the additive block in <c>KNOWN_TELEMETRY_EVENT_TYPES</c>
/// (<c>src/frontend/src/core/telemetry/schema.ts</c>); <c>ChannelContractParityTests</c> pins both to
/// <c>contract/wireContract.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// Names only: each channel's payload and target shapes stay in its own <c>implementation.md</c>. The v0
/// envelope does not change, and <c>eventType</c> stays an open string, so the sink still accepts an
/// unregistered type: ordering between stories can never drop data. No channel story edits this list; a
/// new name goes through the orchestrator as an additive contract change.
/// </para>
/// <para>
/// <c>article_view</c> and <c>press_release</c> predate this list (Phase-1 vocabulary) and are reused, not
/// re-registered: <c>article_view</c> covers every content kind, and a participant release publishes
/// <c>press_release</c> instead of <c>content_published</c> (never both).
/// </para>
/// </remarks>
public static class ChannelTelemetryEventTypes
{
    /// <summary>Client, best-effort dwell on a content item (<c>payload.seconds</c>).</summary>
    public const string ContentDwell = "content_dwell";

    /// <summary>Server, every publish (<c>origin</c> + <c>injectId</c> carried).</summary>
    public const string ContentPublished = "content_published";

    /// <summary>Server, a revise (<c>payload.revisionKind</c>).</summary>
    public const string ContentRevised = "content_revised";

    /// <summary>Server, a retract.</summary>
    public const string ContentRetracted = "content_retracted";

    /// <summary>Server, a share-out of a content item to Social.</summary>
    public const string ContentShare = "content_share";

    /// <summary>Server, an alert raised.</summary>
    public const string AlertIssued = "alert_issued";

    /// <summary>Server, an alert cleared.</summary>
    public const string AlertCleared = "alert_cleared";

    /// <summary>Server, a staff outlet mutation.</summary>
    public const string OutletAction = "outlet_action";

    /// <summary>Server, a scheduled publish the funnel refused.</summary>
    public const string ContentScheduleFailed = "content_schedule_failed";

    /// <summary>E4 news, client: an inline video started.</summary>
    public const string ContentVideoPlay = "content_video_play";

    /// <summary>E4 news, client: inline video progress.</summary>
    public const string ContentVideoProgress = "content_video_progress";

    /// <summary>E4 news, client: an embed opened.</summary>
    public const string ContentEmbedOpen = "content_embed_open";

    /// <summary>E5 press, server.</summary>
    public const string PressDraftCreated = "press_draft_created";

    /// <summary>E5 press, server.</summary>
    public const string PressEmbargoSet = "press_embargo_set";

    /// <summary>E5 press, server.</summary>
    public const string PressEmbargoCancelled = "press_embargo_cancelled";

    /// <summary>E5 press, server.</summary>
    public const string PressApprovalRequested = "press_approval_requested";

    /// <summary>E5 press, server.</summary>
    public const string PressApprovalApproved = "press_approval_approved";

    /// <summary>E5 press, server.</summary>
    public const string PressApprovalReturned = "press_approval_returned";

    /// <summary>E6 weather, server.</summary>
    public const string WeatherZoneChanged = "weather_zone_changed";

    /// <summary>E3 portal, client.</summary>
    public const string PortalView = "portal_view";

    /// <summary>E3 portal, client.</summary>
    public const string PortalModuleClick = "portal_module_click";

    /// <summary>E3 portal, client.</summary>
    public const string ResourceView = "resource_view";

    /// <summary>E3 portal, server.</summary>
    public const string PortalConfigChanged = "portal_config_changed";

    /// <summary>E3 portal, server. Registered but unused in December (its emitters are Deferred).</summary>
    public const string DisplayCommand = "display_command";

    /// <summary>E3 portal, server. Registered but unused in December (its emitters are Deferred).</summary>
    public const string DisplaySessionStarted = "display_session_started";

    /// <summary>Every FC-6b entry, in the FC-6b table's order (foundation, news, press, weather, portal).</summary>
    public static IReadOnlyList<string> All { get; } =
    [
        ContentDwell,
        ContentPublished,
        ContentRevised,
        ContentRetracted,
        ContentShare,
        AlertIssued,
        AlertCleared,
        OutletAction,
        ContentScheduleFailed,
        ContentVideoPlay,
        ContentVideoProgress,
        ContentEmbedOpen,
        PressDraftCreated,
        PressEmbargoSet,
        PressEmbargoCancelled,
        PressApprovalRequested,
        PressApprovalApproved,
        PressApprovalReturned,
        WeatherZoneChanged,
        PortalView,
        PortalModuleClick,
        ResourceView,
        PortalConfigChanged,
        DisplayCommand,
        DisplaySessionStarted,
    ];
}
