namespace Pulse.WebApi.Features.ParticipantShell;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Steering;

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

    /// <summary>
    /// <c>GET /api/overlay-state</c> — the "no overlay active" answer. Still the response whenever the
    /// world-steering overlay write path (story 08's <c>AddPauseParticipantOverlay()</c>) is not registered;
    /// see <see cref="GetOverlayState"/>.
    /// </summary>
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

        endpoints.MapGet("/api/overlay-state", GetOverlayState);

        return endpoints;
    }

    /// <summary>
    /// <c>GET /api/overlay-state</c> — the resolved exercise's LIVE participant overlay state (world-steering
    /// story 08). Fails closed with <c>401</c> on an unresolved scope, exactly as before; on a resolved scope it
    /// reads the per-exercise <see cref="OverlayStateService"/> so a controller's Freeze is visible to a
    /// participant who joins or refreshes MID-Freeze — this was a hardcoded <c>state: "none"</c> constant, which
    /// meant a Freeze changed nothing a participant could see.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why the store is resolved optionally rather than injected.</b> <c>Program.cs</c> is orchestrator-owned:
    /// <see cref="MapParticipantShellEndpoints"/> is ALREADY wired there, while story 08's
    /// <c>AddPauseParticipantOverlay()</c> lands as a separate, serial edit. A hard handler parameter for an
    /// unregistered type is inferred as a request BODY on a <c>GET</c> and throws while the route is being built
    /// — i.e. the whole host (and every <c>WebApplicationFactory&lt;Program&gt;</c> test) would fail to start
    /// until that line existed, taking the other five shell-config endpoints down with it. Resolving it from
    /// <see cref="HttpContext.RequestServices"/> keeps this endpoint correct in both states: with the slice wired
    /// it serves the live per-exercise state; without it, the pre-story <c>none</c> constant — never an invented
    /// overlay (fail closed).
    /// </para>
    /// <para>
    /// <b>Isolation (COR-001).</b> The exercise comes ONLY from <see cref="IExerciseContext"/> and is passed
    /// straight to the store's per-exercise key, so a participant in exercise B can never read exercise A's
    /// Freeze. <b>XC-002:</b> the response is <see cref="ParticipantOverlayStateDto"/>, which structurally cannot
    /// carry the acting controller or the staff pause-tier vocabulary.
    /// </para>
    /// </remarks>
    /// <param name="httpContext">The request, used only to resolve the optional overlay store (see remarks).</param>
    /// <param name="exerciseContext">The server-resolved exercise scope (COR-001).</param>
    /// <returns><c>401</c> on an unresolved scope; otherwise <c>200</c> with the exercise's overlay state.</returns>
    private static IResult GetOverlayState(HttpContext httpContext, IExerciseContext exerciseContext)
    {
        if (exerciseContext.CurrentExerciseId is null)
        {
            return Results.Unauthorized();
        }

        var overlayState = httpContext.RequestServices.GetService<OverlayStateService>();

        return overlayState is null
            ? Results.Ok(OverlayState)
            : Results.Ok(ParticipantOverlayStateDto.FromSnapshot(
                overlayState.Get(exerciseContext.CurrentExerciseId.Value)));
    }
}
