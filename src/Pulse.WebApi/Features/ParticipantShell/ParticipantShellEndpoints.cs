namespace Pulse.WebApi.Features.ParticipantShell;

using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseConfiguration;

/// <summary>
/// The six participant-shell CONFIG read endpoints the frozen frontend shell seams call
/// (<c>shellState.ts</c>, <c>chromeConfig.ts</c>, <c>brandTokens.ts</c>, <c>channelNavConfig.ts</c>,
/// <c>AlertBar/useAlerts.ts</c>, <c>OverlayLayer/overlayState.ts</c>). Each response is the frozen wire shape
/// in <c>ParticipantShellDtos.cs</c> — the frontend's runtime type-guards already expect these exact shapes.
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
/// <b>Per-exercise config, not constants (exercise-configuration story 01b).</b> These handlers used to
/// return <c>static readonly</c> Phase-1 constants. They now delegate to
/// <see cref="ParticipantShellConfigService"/>, which projects the resolved exercise's COR-030 settings onto
/// the SAME wire shapes: brand tokens and the channel catalog come from the <c>Exercise</c> row, while
/// chrome, shell variant and overlay state go through the three per-concern projections whose
/// constant-preserving defaults 01b ships and stories 02/03 replace. No DTO was reshaped and no frontend
/// consumer or runtime type-guard changed — an unconfigured exercise still serves byte-for-byte what it
/// served before.
/// </para>
/// <para>
/// <b>Fail closed, unchanged.</b> Scope comes ONLY from the server-resolved
/// <see cref="IExerciseContext"/> (COR-001), never a client parameter, and an unresolved scope still returns
/// <c>401</c> rather than serving config to a caller with no exercise — never a default/empty-but-200
/// result. The service signals that by returning <c>null</c>; these handlers map it to
/// <see cref="Results.Unauthorized"/>.
/// </para>
/// <para>
/// <b>Composition.</b> The orchestrator wires the single <see cref="MapParticipantShellEndpoints"/> call into
/// <c>Program.cs</c>, as before. It now additionally REQUIRES
/// <c>builder.Services.AddExerciseConfiguration()</c> (story 01b's registration) for the handlers'
/// <see cref="ParticipantShellConfigService"/> dependency to resolve — there is still no
/// <c>AddParticipantShell</c> of its own.
/// </para>
/// <para>
/// These are GET reads a read-only / observer session must still receive, so they are NOT placed behind the
/// <c>DenyReadOnlySessions()</c> group.
/// </para>
/// </remarks>
public static class ParticipantShellEndpoints
{
    /// <summary>
    /// Maps the six participant-shell config GET endpoints. Each handler FAILS CLOSED on an unresolved
    /// scope (<see cref="IExerciseContext.CurrentExerciseId"/> is <c>null</c>/empty → <c>401 Unauthorized</c>),
    /// never a default/empty-but-200 result; scope comes ONLY from <see cref="IExerciseContext"/> (COR-001),
    /// never a client parameter. On a resolved scope each returns that exercise's configuration.
    /// </summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    /// <remarks>
    /// The <see cref="ParticipantShellConfigService"/> parameter is marked <c>[FromServices]</c> EXPLICITLY
    /// rather than left to minimal-API inference. Inference asks the container whether the type is a
    /// registered service at route-BUILD time; if <c>AddExerciseConfiguration()</c> is missing from the
    /// composition root it would instead be inferred as a request BODY, and a GET cannot have one — the host
    /// would fail to start with a confusing binding error rather than a clear missing-registration one.
    /// </remarks>
    public static IEndpointRouteBuilder MapParticipantShellEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/shell-state", async (
            [FromServices] ParticipantShellConfigService config,
            CancellationToken cancellationToken) =>
            Serve(await config.GetShellStateAsync(cancellationToken)));

        endpoints.MapGet("/api/chrome-config", async (
            [FromServices] ParticipantShellConfigService config,
            CancellationToken cancellationToken) =>
            Serve(await config.GetChromeConfigAsync(cancellationToken)));

        endpoints.MapGet("/api/brand-tokens", async (
            [FromServices] ParticipantShellConfigService config,
            CancellationToken cancellationToken) =>
            Serve(await config.GetBrandTokensAsync(cancellationToken)));

        endpoints.MapGet("/api/channel-nav-config", async (
            [FromServices] ParticipantShellConfigService config,
            CancellationToken cancellationToken) =>
            Serve(await config.GetChannelNavConfigAsync(cancellationToken)));

        endpoints.MapGet("/api/alerts", async (
            [FromServices] ParticipantShellConfigService config,
            CancellationToken cancellationToken) =>
            Serve(await config.GetAlertsAsync(cancellationToken)));

        endpoints.MapGet("/api/overlay-state", async (
            [FromServices] ParticipantShellConfigService config,
            CancellationToken cancellationToken) =>
            Serve(await config.GetOverlayStateAsync(cancellationToken)));

        return endpoints;
    }

    /// <summary>
    /// The single fail-closed mapping shared by all six handlers: a <c>null</c> config means the exercise
    /// scope was not resolved, which is a <c>401</c> — never an empty-but-200 body.
    /// </summary>
    /// <typeparam name="TConfig">The frozen response type.</typeparam>
    /// <param name="config">The projected config, or <c>null</c> when the scope is unresolved.</param>
    /// <returns>The 200 config result, or 401.</returns>
    private static IResult Serve<TConfig>(TConfig? config)
        where TConfig : class =>
        config is null ? Results.Unauthorized() : Results.Ok(config);
}
