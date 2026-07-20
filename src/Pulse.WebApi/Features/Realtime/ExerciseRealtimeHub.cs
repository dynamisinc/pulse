namespace Pulse.WebApi.Features.Realtime;

using Microsoft.AspNetCore.SignalR;
using Pulse.WebApi.Data;

/// <summary>
/// The exercise-scoped SignalR hub that fans a newly-persisted post out to every currently-connected
/// participant session in the SAME exercise run (SOC-083) — closing the cross-session gap the in-memory
/// pub/sub could never span. A connection joins exactly one group, keyed by the exercise the request's own
/// scope resolves to (COR-001), and NEVER a group named by a client-supplied value.
/// </summary>
/// <remarks>
/// <para>
/// <b>Fail-closed group membership (the always-Critical isolation property, Tier-2).</b> The group a
/// connection joins is derived ONLY from the injected <see cref="IExerciseContext"/> — the same server-side
/// scope the HTTP endpoints read — via <see cref="GroupNameFor"/>. This hub deliberately exposes NO
/// client-invocable method that accepts a group name or exercise id, so a client cannot join, or receive a
/// broadcast for, any exercise but its own. When the scope is unresolved
/// (<see cref="IExerciseContext.CurrentExerciseId"/> is <c>null</c> or <see cref="Guid.Empty"/>) the
/// connection is aborted rather than joined to any group — an absent scope is a closed door, never a
/// default or an unscoped join.
/// </para>
/// <para>
/// Per-request scope population (host/session-token auth) is Phase B2; until it lands the scope resolves to
/// <c>null</c> and every connection fails closed here, exactly as the HTTP endpoints do.
/// </para>
/// </remarks>
public sealed class ExerciseRealtimeHub : Hub
{
    private readonly IExerciseContext _exerciseContext;

    /// <summary>Creates the hub with the injected per-request exercise scope.</summary>
    /// <param name="exerciseContext">The resolved exercise scope for this connection (COR-001).</param>
    public ExerciseRealtimeHub(IExerciseContext exerciseContext)
    {
        ArgumentNullException.ThrowIfNull(exerciseContext);
        _exerciseContext = exerciseContext;
    }

    /// <summary>
    /// The SignalR group name for an exercise run — the single source of truth shared with
    /// <see cref="SignalRFeedBroadcaster"/> so the join side and the broadcast side can never drift apart.
    /// Always server-derived from a resolved <see cref="IExerciseContext.CurrentExerciseId"/>; never built
    /// from client input.
    /// </summary>
    /// <param name="exerciseId">The owning exercise run.</param>
    /// <returns>The group name, <c>exercise:{exerciseId}</c>.</returns>
    internal static string GroupNameFor(Guid exerciseId) => $"exercise:{exerciseId}";

    /// <summary>
    /// Resolves this connection's exercise scope and joins the corresponding group. A <c>null</c> or empty
    /// scope aborts the connection (fail closed) rather than joining any group.
    /// </summary>
    public override async Task OnConnectedAsync()
    {
        var exerciseId = _exerciseContext.CurrentExerciseId;
        if (exerciseId is null || exerciseId.Value == Guid.Empty)
        {
            // Unresolved scope: never join a group with an ambient/empty exercise — abort instead.
            Context.Abort();
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, GroupNameFor(exerciseId.Value));
        await base.OnConnectedAsync();
    }
}
