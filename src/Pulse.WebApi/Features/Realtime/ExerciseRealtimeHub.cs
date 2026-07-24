namespace Pulse.WebApi.Features.Realtime;

using Microsoft.AspNetCore.SignalR;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseResolution;

/// <summary>
/// The exercise-scoped SignalR hub that fans a newly-persisted post out to every currently-connected
/// participant session in the SAME exercise run (SOC-083) — closing the cross-session gap the in-memory
/// pub/sub could never span. A connection joins exactly one group, keyed by the exercise the connection's own
/// host resolves to (COR-001), and NEVER a group named by a client-supplied value.
/// </summary>
/// <remarks>
/// <para>
/// <b>Fail-closed group membership (the always-Critical isolation property, Tier-2).</b> The group a
/// connection joins is derived ONLY from the host-resolved exercise the
/// <see cref="ExerciseResolutionMiddleware"/> stamped on the connection's own <c>HttpContext.Items</c> — read
/// here via <c>Context.GetHttpContext()?.GetHostResolvedExerciseId()</c> — through <see cref="GroupNameFor"/>.
/// This hub deliberately exposes NO client-invocable method that accepts a group name or exercise id, so a
/// client cannot join, or receive a broadcast for, any exercise but its own. When no host resolved (the id is
/// <c>null</c> or <see cref="Guid.Empty"/>) the connection is aborted rather than joined to any group — an
/// absent scope is a closed door, never a default or an unscoped join.
/// </para>
/// <para>
/// <b>Why the host-resolved <c>HttpContext</c>, not the injected <see cref="IExerciseContext"/>.</b> SignalR
/// dispatches <see cref="OnConnectedAsync"/> in its OWN per-invocation DI scope — NOT the connection's
/// HTTP-request scope where <c>UseExerciseResolution</c> populated the scoped
/// <see cref="IExerciseContext"/>. A hub that read the injected <see cref="IExerciseContext"/> would therefore
/// always see a fresh, unset one (<see cref="Guid.Empty"/>) and abort EVERY connection — the confirmed cause
/// of the "handshake then immediate server close, no live pushes" bug. <c>Context.GetHttpContext()</c> instead
/// returns the original connection request's <c>HttpContext</c> — the very request the middleware ran on — so
/// the same server-side, host-derived exercise id the HTTP endpoints resolve is available here. This keeps the
/// scope server-authoritative (COR-001); do not reintroduce the injected-context read.
/// </para>
/// </remarks>
public sealed class ExerciseRealtimeHub : Hub
{
    /// <summary>
    /// The SignalR group name for an exercise run — the single source of truth shared with
    /// <see cref="SignalRFeedBroadcaster"/> so the join side and the broadcast side can never drift apart.
    /// Always server-derived from the host-resolved exercise id; never built from client input.
    /// </summary>
    /// <param name="exerciseId">The owning exercise run.</param>
    /// <returns>The group name, <c>exercise:{exerciseId}</c>.</returns>
    internal static string GroupNameFor(Guid exerciseId) => $"exercise:{exerciseId}";

    /// <summary>
    /// Resolves this connection's exercise scope from the connection's host-resolved <c>HttpContext</c> and
    /// joins the corresponding group. A <c>null</c> or empty scope aborts the connection (fail closed) rather
    /// than joining any group.
    /// </summary>
    public override async Task OnConnectedAsync()
    {
        // SignalR runs OnConnectedAsync in its OWN DI scope, so the scoped IExerciseContext the
        // UseExerciseResolution middleware populated on the connection REQUEST never reaches this hub
        // instance (it would read a fresh, null one and abort every connection). Read the host-resolved
        // exercise off the connection's HttpContext, where the middleware also stashed it.
        var exerciseId = Context.GetHttpContext()?.GetHostResolvedExerciseId();
        if (exerciseId is null || exerciseId.Value == Guid.Empty)
        {
            Context.Abort(); // fail closed: never join an ambient/empty exercise group
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, GroupNameFor(exerciseId.Value));
        await base.OnConnectedAsync();
    }
}
