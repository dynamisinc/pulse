namespace Pulse.WebApi.Features.ParticipantShell;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Data;

/// <summary>
/// The six participant-shell CONFIG read endpoints the frozen frontend shell seams call
/// (<c>shellState.ts</c>, <c>chromeConfig.ts</c>, <c>brandTokens.ts</c>, <c>channelNavConfig.ts</c>,
/// <c>AlertBar/useAlerts.ts</c>, <c>OverlayLayer/overlayState.ts</c>). Each is a faithful server-side port
/// of that seam's mock response — the frontend's runtime type-guards already expect these exact shapes.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this slice exists (UAT fix).</b> With mock data OFF, the frontend calls these six endpoints; they
/// did not exist server-side and 404'd. The consequential one is <c>GET /api/shell-state</c>: its 404 made
/// the shell fall back to its fail-closed <c>readOnly</c> variant, which disables the realtime feed stream
/// and hides the "new posts" pill — so the participant feed never updated live. Serving a real
/// <c>shell-state</c> of <c>full</c> (the realtime path — <c>PostIngestService</c> → <c>IFeedBroadcaster</c>
/// → <c>/hubs/exercise</c> — is already wired) restores live updates; the other five stop the 404 console
/// spam.
/// </para>
/// <para>
/// <b>Phase-1 static config.</b> These are fixed config constants — no DB, no EF entity, no storage. They
/// still FAIL CLOSED on an unresolved scope: scope comes ONLY from the injected <see cref="IExerciseContext"/>
/// (COR-001), never a client parameter, and an unresolved scope returns <c>401</c> rather than serving
/// config to a caller with no exercise. Mirrors <c>Social/FeedEndpoints.cs</c>'s <c>Map*</c> convention; the
/// orchestrator wires the single <see cref="MapParticipantShellEndpoints"/> call into <c>Program.cs</c>. No
/// DI registration is needed (the only dependency, <see cref="IExerciseContext"/>, is already registered by
/// <c>AddExerciseScoping</c>), so there is no <c>AddParticipantShell</c> — matching the FeedEndpoints
/// convention of not shipping an empty registration.
/// </para>
/// <para>
/// These are GET reads a read-only / observer session must still receive, so they are NOT placed behind the
/// <c>DenyReadOnlySessions()</c> group.
/// </para>
/// </remarks>
public static class ParticipantShellEndpoints
{
    /// <summary><c>GET /api/shell-state</c> — Phase-1 constant: interactive <c>full</c> variant.</summary>
    private static readonly ShellStateResponse ShellState = new()
    {
        Variant = "full",
    };

    /// <summary><c>GET /api/chrome-config</c> — Phase-1 constant: chrome on, the AC-canonical banners.</summary>
    private static readonly ChromeConfigResponse ChromeConfig = new()
    {
        Enabled = true,
        Top = new ChromeBannerConfig
        {
            Text = "UNCLASSIFIED // EXERCISE · EXERCISE · EXERCISE — ALL CONTENT SIMULATED",
            Fg = "#eaf5e6",
            Bg = "#2e6b2e",
        },
        Bottom = new ChromeBannerConfig
        {
            Text = "PULSE TRAINING ENVIRONMENT — SIMULATED INFORMATION SPACE — NOT REAL NEWS",
            Fg = "#eaf5e6",
            Bg = "#2e6b2e",
        },
    };

    /// <summary><c>GET /api/brand-tokens</c> — Phase-1 constant: the screened, neutral demo brand (no logo).</summary>
    private static readonly BrandTokensResponse BrandTokens = new()
    {
        Name = "Sample Exercise Network",
        Colors = new BrandColors
        {
            Primary = "#2b5f75",
            Accent = "#d97706",
            Surface = "#ffffff",
            OnSurface = "#1c1c1c",
        },
    };

    /// <summary><c>GET /api/channel-nav-config</c> — Phase-1 constant: Social enabled, the rest catalogued-but-off.</summary>
    private static readonly ChannelNavConfigResponse ChannelNavConfig = new()
    {
        Channels =
        [
            new ChannelNavChannel { Id = "social", Label = "Social", Icon = "social", Enabled = true },
            new ChannelNavChannel { Id = "portal", Label = "Portal", Icon = "portal", Enabled = false },
            new ChannelNavChannel { Id = "news", Label = "News", Icon = "news", Enabled = false },
            new ChannelNavChannel { Id = "press", Label = "Press Room", Icon = "press", Enabled = false },
            new ChannelNavChannel { Id = "weather", Label = "Weather", Icon = "weather", Enabled = false },
        ],
        CurrentChannelId = "social",
        HideWhenSingleChannel = false,
    };

    /// <summary><c>GET /api/alerts</c> — Phase-1 constant: no active alerts (empty list, property present).</summary>
    private static readonly AlertsResponse Alerts = new()
    {
        Alerts = [],
    };

    /// <summary><c>GET /api/overlay-state</c> — Phase-1 constant: no overlay active.</summary>
    private static readonly OverlayStateResponse OverlayState = new()
    {
        State = "none",
        Register = "in-fiction",
        Message = string.Empty,
    };

    /// <summary>
    /// Maps the six participant-shell config GET endpoints. Each handler FAILS CLOSED on an unresolved
    /// scope (<see cref="IExerciseContext.CurrentExerciseId"/> is <c>null</c> → <c>401 Unauthorized</c>),
    /// never a default/empty-but-200 result; scope comes ONLY from <see cref="IExerciseContext"/> (COR-001),
    /// never a client parameter. On a resolved scope each returns its fixed Phase-1 config.
    /// </summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapParticipantShellEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/shell-state", (IExerciseContext exerciseContext) =>
            exerciseContext.CurrentExerciseId is null ? Results.Unauthorized() : Results.Ok(ShellState));

        endpoints.MapGet("/api/chrome-config", (IExerciseContext exerciseContext) =>
            exerciseContext.CurrentExerciseId is null ? Results.Unauthorized() : Results.Ok(ChromeConfig));

        endpoints.MapGet("/api/brand-tokens", (IExerciseContext exerciseContext) =>
            exerciseContext.CurrentExerciseId is null ? Results.Unauthorized() : Results.Ok(BrandTokens));

        endpoints.MapGet("/api/channel-nav-config", (IExerciseContext exerciseContext) =>
            exerciseContext.CurrentExerciseId is null ? Results.Unauthorized() : Results.Ok(ChannelNavConfig));

        endpoints.MapGet("/api/alerts", (IExerciseContext exerciseContext) =>
            exerciseContext.CurrentExerciseId is null ? Results.Unauthorized() : Results.Ok(Alerts));

        endpoints.MapGet("/api/overlay-state", (IExerciseContext exerciseContext) =>
            exerciseContext.CurrentExerciseId is null ? Results.Unauthorized() : Results.Ok(OverlayState));

        return endpoints;
    }
}
