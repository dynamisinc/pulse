namespace Pulse.WebApi.Features.Social.Follows;

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.SharedAccess;

/// <summary>
/// The follow-graph HTTP surface (SOC-051, <c>profiles-social-graph/07</c>): the follow/unfollow writes plus
/// the two directed reads the "who to follow" suggestion module and the profile follower list consume.
/// </summary>
/// <remarks>
/// <para>
/// <b>Composition root (no <c>Program.cs</c> edit).</b> These routes hang off the persona resource
/// (<c>/api/personas/{id}/...</c>), so this slice is composed INTO the already-wired persona surface:
/// <c>PersonaEndpoints.AddSocialPersonaRead()</c> calls <see cref="AddSocialFollowGraph"/> and
/// <c>PersonaEndpoints.MapSocialPersonaEndpoints()</c> calls <see cref="MapSocialFollowEndpoints"/>, both of
/// which <c>Program.cs</c> already invokes. That is deliberate: the orchestrator owns <c>Program.cs</c>, and a
/// slice whose <c>Add*</c>/<c>Map*</c> is never reached is dead at 404 (#310→#317). The
/// <c>CompositionRootWiringTests</c> assertion for these routes runs against the REAL
/// <c>WebApplicationFactory&lt;Program&gt;</c> host, so "wired" is proven, not assumed. Registration is
/// <c>TryAdd</c>-based and mapping is idempotent-by-caller, so the feed slice can depend on the same services
/// without double-registering.
/// </para>
/// <para>
/// <b>Read-only sessions are refused server-side (COR-015 / D1-011).</b> The two writes are mapped through a
/// group carrying <c>DenyReadOnlySessions()</c> — the same <c>ReadOnlySessionWriteFilter</c> gate
/// <c>POST /api/posts</c> is denied through — so a shared view-only session gets a 403 BEFORE the handler
/// runs. This slice applies the guard itself at map time (the documented seam for a new sim-write) rather
/// than asking for a Program.cs group.
/// </para>
/// <para>
/// <b>Scope and identity are server-authoritative (COR-001).</b> No route accepts an <c>exerciseId</c>, and
/// the follower on a write is always the caller's session-bound persona — never a body field. A followee id
/// naming another exercise's persona resolves to nothing under the scope's query filter and is REJECTED (404),
/// which is the always-Critical cross-exercise case.
/// </para>
/// </remarks>
public static class FollowEndpoints
{
    /// <summary>
    /// Registers the follow-graph services: <see cref="FollowService"/> and the session-persona accessor the
    /// write path resolves its follower from, both Scoped to match the request's <see cref="PulseDbContext"/>
    /// unit of work. Idempotent (<c>TryAdd</c>), so more than one slice may call it.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns><paramref name="services"/>, for chaining.</returns>
    public static IServiceCollection AddSocialFollowGraph(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // The accessor reads the CURRENT request's bearer token, exactly as CurrentStaffSessionAccessor does.
        services.AddHttpContextAccessor();
        services.TryAddScoped<ICurrentSessionPersonaAccessor, CurrentSessionPersonaAccessor>();
        services.TryAddScoped<FollowService>();

        return services;
    }

    /// <summary>
    /// Maps the follow-graph routes:
    /// <c>POST /api/personas/{personaId}/follow</c> and <c>DELETE /api/personas/{personaId}/follow</c> (the
    /// idempotent writes, read-only-denied), plus <c>GET /api/personas/{personaId}/following</c> and
    /// <c>GET /api/personas/{personaId}/followers</c> (the directed reads).
    /// </summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns><paramref name="endpoints"/>, for chaining.</returns>
    public static IEndpointRouteBuilder MapSocialFollowEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // Sim WRITES: guarded by the read-only write filter at map time (COR-015).
        var writes = endpoints.MapGroup(string.Empty).DenyReadOnlySessions();
        writes.MapPost("/api/personas/{personaId:guid}/follow", FollowAsync);
        writes.MapDelete("/api/personas/{personaId:guid}/follow", UnfollowAsync);

        // Directed READS: a read-only/observer session must still receive these, so they are NOT in the group.
        endpoints.MapGet("/api/personas/{personaId:guid}/following", GetFollowingAsync);
        endpoints.MapGet("/api/personas/{personaId:guid}/followers", GetFollowersAsync);

        return endpoints;
    }

    /// <summary>Creates the edge for the caller's session-bound persona; idempotent on a repeat.</summary>
    /// <param name="personaId">The persona to follow.</param>
    /// <param name="followService">The follow-graph service.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>200 with the resulting state, 400/401/403/404 per the fail-closed outcomes.</returns>
    private static async Task<IResult> FollowAsync(
        Guid personaId,
        FollowService followService,
        CancellationToken cancellationToken)
    {
        var result = await followService.FollowAsync(personaId, cancellationToken);
        return MapResult(personaId, result);
    }

    /// <summary>Removes the edge for the caller's session-bound persona; idempotent on a repeat.</summary>
    /// <param name="personaId">The persona to unfollow.</param>
    /// <param name="followService">The follow-graph service.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>200 with the resulting state, 400/401/403/404 per the fail-closed outcomes.</returns>
    private static async Task<IResult> UnfollowAsync(
        Guid personaId,
        FollowService followService,
        CancellationToken cancellationToken)
    {
        var result = await followService.UnfollowAsync(personaId, cancellationToken);
        return MapResult(personaId, result);
    }

    /// <summary>
    /// Reads the persona ids <paramref name="personaId"/> follows, inside the caller's resolved exercise scope
    /// (COR-001). Fails closed with 401 on an unresolved scope rather than returning an empty 200 that reads
    /// as "follows nobody".
    /// </summary>
    /// <param name="personaId">The persona whose outbound edges to read.</param>
    /// <param name="exerciseContext">The resolved exercise scope.</param>
    /// <param name="followService">The follow-graph service.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>200 with the followed persona ids, or 401 on an unresolved scope.</returns>
    private static async Task<IResult> GetFollowingAsync(
        Guid personaId,
        IExerciseContext exerciseContext,
        FollowService followService,
        CancellationToken cancellationToken)
    {
        if (exerciseContext.CurrentExerciseId is null)
        {
            return Results.Unauthorized();
        }

        var ids = await followService.GetFollowingAsync(personaId, cancellationToken);
        return Results.Ok(FollowListResponseDto.From(personaId, ids));
    }

    /// <summary>
    /// Reads the REAL follower persona ids of <paramref name="personaId"/> inside the caller's resolved scope —
    /// the edges a follower list renders alongside, and disjoint from, the SOC-054 magnitude.
    /// </summary>
    /// <param name="personaId">The persona whose inbound edges to read.</param>
    /// <param name="exerciseContext">The resolved exercise scope.</param>
    /// <param name="followService">The follow-graph service.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>200 with the follower persona ids, or 401 on an unresolved scope.</returns>
    private static async Task<IResult> GetFollowersAsync(
        Guid personaId,
        IExerciseContext exerciseContext,
        FollowService followService,
        CancellationToken cancellationToken)
    {
        if (exerciseContext.CurrentExerciseId is null)
        {
            return Results.Unauthorized();
        }

        var ids = await followService.GetFollowersAsync(personaId, cancellationToken);
        return Results.Ok(FollowListResponseDto.From(personaId, ids));
    }

    /// <summary>Maps a service outcome onto its HTTP status, failing closed on everything short of success.</summary>
    /// <param name="personaId">The target persona id, echoed back on success.</param>
    /// <param name="result">The service outcome.</param>
    /// <returns>The HTTP result.</returns>
    private static IResult MapResult(Guid personaId, FollowResult result) => result.Outcome switch
    {
        // Both the state-changing and the idempotent-repeat cases return the SAME 200 body: a client that
        // retries (or double-taps) cannot tell them apart, which is what makes the endpoint idempotent.
        FollowOutcome.Changed or FollowOutcome.Unchanged =>
            Results.Ok(FollowStateResponseDto.From(personaId, result)),

        // Fail closed — no exercise resolved for this request.
        FollowOutcome.ScopeUnresolved => Results.Unauthorized(),

        // Authenticated far enough to reach here, but with no persona in this exercise to act AS.
        FollowOutcome.NoSessionPersona => Results.StatusCode(StatusCodes.Status403Forbidden),

        // Unknown in THIS exercise — including another exercise's persona (COR-001). A rejection, not a no-op.
        FollowOutcome.UnknownFollowee => Results.NotFound(),

        FollowOutcome.Invalid => Results.BadRequest(result.ValidationError),

        // Unreachable; fail closed rather than emit a bare 200.
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
    };
}

/// <summary>
/// The follow/unfollow response — the caller-observable state of ONE edge after the call. Participant-safe by
/// construction (XC-002): it carries no provenance, no operator/session attribution, and nothing about the
/// target persona beyond its id.
/// </summary>
public sealed class FollowStateResponseDto
{
    /// <summary>The persona that was followed/unfollowed.</summary>
    [JsonPropertyName("personaId")]
    public required string PersonaId { get; init; }

    /// <summary>Whether the caller's persona follows <see cref="PersonaId"/> after this call.</summary>
    [JsonPropertyName("following")]
    public required bool Following { get; init; }

    /// <summary>
    /// Whether this particular call CHANGED state (<c>false</c> for an idempotent repeat). Advisory only — a
    /// client never needs it to render, but it makes the idempotency observable rather than implicit.
    /// </summary>
    [JsonPropertyName("changed")]
    public required bool Changed { get; init; }

    /// <summary>
    /// The SCENARIO instant the change happened (COR-053) — the only participant-visible time — emitted
    /// round-trip ISO-8601 and OMITTED entirely when nothing changed.
    /// </summary>
    [JsonPropertyName("scenarioTime")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ScenarioTime { get; init; }

    /// <summary>Projects a service result to the wire shape.</summary>
    /// <param name="personaId">The target persona id.</param>
    /// <param name="result">The service outcome (must be a success outcome).</param>
    /// <returns>The participant-safe response.</returns>
    public static FollowStateResponseDto From(Guid personaId, FollowResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return new FollowStateResponseDto
        {
            PersonaId = personaId.ToString(),
            Following = result.Following,
            Changed = result.StateChanged,
            ScenarioTime = result.ScenarioTime?.ToString("O"),
        };
    }
}

/// <summary>
/// A directed slice of the follow graph — the persona ids on one side of a given persona's edges. Ids only:
/// the caller already resolves personas through <c>GET /api/personas</c> (the one unconditional persona read),
/// so re-projecting persona fields here would duplicate that contract and risk drifting from its per-world
/// split.
/// </summary>
public sealed class FollowListResponseDto
{
    /// <summary>The persona whose edges these are.</summary>
    [JsonPropertyName("personaId")]
    public required string PersonaId { get; init; }

    /// <summary>The persona ids on the other end of the edges, newest edge first (scenario time).</summary>
    [JsonPropertyName("personaIds")]
    public required IReadOnlyList<string> PersonaIds { get; init; }

    /// <summary>The number of REAL edges — never inflated by the SOC-054 audience magnitude.</summary>
    [JsonPropertyName("count")]
    public required int Count { get; init; }

    /// <summary>Projects a resolved id set to the wire shape.</summary>
    /// <param name="personaId">The persona whose edges these are.</param>
    /// <param name="personaIds">The persona ids on the other end.</param>
    /// <returns>The participant-safe response.</returns>
    public static FollowListResponseDto From(Guid personaId, IReadOnlyList<Guid> personaIds)
    {
        ArgumentNullException.ThrowIfNull(personaIds);

        var ids = personaIds.Select(id => id.ToString()).ToArray();

        return new FollowListResponseDto
        {
            PersonaId = personaId.ToString(),
            PersonaIds = ids,
            Count = ids.Length,
        };
    }
}
