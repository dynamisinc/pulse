namespace Pulse.WebApi.Features.Portal.Contracts;

using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// PC-6, the portal's telemetry target and payload shapes (exercise-portal story 02, #768). The event-type
/// STRINGS are registered once by channels-foundation story 02 (<see cref="ChannelTelemetryEventTypes"/>, FC-6b);
/// this class references them and declares, per event, who emits it and what its <c>target</c> and
/// <c>payload</c> carry. It edits neither vocabulary list. Mirrored by <c>PORTAL_TELEMETRY_SHAPES</c> in
/// <c>telemetry.ts</c>, both pinned to <c>portalWireContract.json</c>.
/// </summary>
/// <remarks>
/// The v0 envelope is unchanged; <c>channel</c> is <c>portal</c> for every event here. The two <c>display_*</c>
/// events are registered but Deferred with the display sessions (Q-35): nothing emits them in December.
/// </remarks>
public static class PortalTelemetry
{
    /// <summary>Emitted by the participant client.</summary>
    public const string EmitterClient = "client";

    /// <summary>Emitted by the server.</summary>
    public const string EmitterServer = "server";

    /// <summary>The <c>portal</c> telemetry target entity type.</summary>
    public const string EntityPortal = "portal";

    /// <summary>The <c>portal_module</c> telemetry target entity type (<c>entityId</c> = a module id).</summary>
    public const string EntityPortalModule = "portal_module";

    /// <summary>The <c>portal_resource</c> telemetry target entity type (<c>entityId</c> = a resource id).</summary>
    public const string EntityPortalResource = "portal_resource";

    /// <summary>The <c>display</c> telemetry target entity type (Deferred).</summary>
    public const string EntityDisplay = "display";

    /// <summary><c>portal_view</c>: client (17), once per mount per session; no entity id, no payload.</summary>
    public static PortalTelemetryShape PortalView { get; } =
        new(ChannelTelemetryEventTypes.PortalView, EmitterClient, EntityPortal, HasEntityId: false, PayloadKeys: [], Deferred: false);

    /// <summary><c>portal_module_click</c>: client (07 <c>trackClick</c>); <c>payload.contentId</c> optional.</summary>
    public static PortalTelemetryShape PortalModuleClick { get; } =
        new(ChannelTelemetryEventTypes.PortalModuleClick, EmitterClient, EntityPortalModule, HasEntityId: true, PayloadKeys: ["contentId"], Deferred: false);

    /// <summary><c>resource_view</c>: client (15); no payload.</summary>
    public static PortalTelemetryShape ResourceView { get; } =
        new(ChannelTelemetryEventTypes.ResourceView, EmitterClient, EntityPortalResource, HasEntityId: true, PayloadKeys: [], Deferred: false);

    /// <summary>
    /// <c>portal_config_changed</c>: server (03), actor = the staff human; <c>target.entityId</c> is the
    /// <c>PortalConfig</c> row id (the first write creates it); <c>payload.fields</c> names the changed fields,
    /// never their values.
    /// </summary>
    public static PortalTelemetryShape PortalConfigChanged { get; } =
        new(ChannelTelemetryEventTypes.PortalConfigChanged, EmitterServer, EntityPortal, HasEntityId: true, PayloadKeys: ["fields"], Deferred: false);

    /// <summary><c>display_command</c>: server (08), <c>payload.command</c>. Deferred (Q-35).</summary>
    public static PortalTelemetryShape DisplayCommand { get; } =
        new(ChannelTelemetryEventTypes.DisplayCommand, EmitterServer, EntityDisplay, HasEntityId: true, PayloadKeys: ["command"], Deferred: true);

    /// <summary>
    /// <c>display_session_started</c>: server (05); no person attribution (PRT-041). Deferred (Q-35): PC-6 wants
    /// a <c>display</c> actor kind, which the v0 envelope does not have yet, so story 05 must add one first.
    /// </summary>
    public static PortalTelemetryShape DisplaySessionStarted { get; } =
        new(ChannelTelemetryEventTypes.DisplaySessionStarted, EmitterServer, EntityDisplay, HasEntityId: true, PayloadKeys: [], Deferred: true);

    /// <summary>Every PC-6 shape, in PC-6 order.</summary>
    public static IReadOnlyList<PortalTelemetryShape> All { get; } =
        [PortalView, PortalModuleClick, ResourceView, PortalConfigChanged, DisplayCommand, DisplaySessionStarted];
}

/// <summary>One PC-6 event's declared shape.</summary>
/// <param name="EventType">The FC-6b event type (<see cref="ChannelTelemetryEventTypes"/>).</param>
/// <param name="Emitter"><see cref="PortalTelemetry.EmitterClient"/> or <see cref="PortalTelemetry.EmitterServer"/>.</param>
/// <param name="EntityType">The <c>target.entityType</c>.</param>
/// <param name="HasEntityId">Whether <c>target.entityId</c> is set.</param>
/// <param name="PayloadKeys">The keys <c>payload</c> may carry (none when empty, so <c>payload</c> is omitted).</param>
/// <param name="Deferred">Registered but not emitted in December (Q-35).</param>
public sealed record PortalTelemetryShape(
    string EventType, string Emitter, string EntityType, bool HasEntityId, IReadOnlyList<string> PayloadKeys, bool Deferred);
