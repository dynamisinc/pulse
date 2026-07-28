namespace Pulse.WebApi.Features.Social.Suggestions;

using System.Globalization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>
/// The "Who to follow" suggestion HTTP surface (SOC-053, <c>profiles-social-graph/08</c>):
/// <c>GET /api/personas/suggestions</c>, the read <c>whoToFollowService.resolveSuggestedFollowIds()</c> calls.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this exists.</b> Story 04 shipped <c>&lt;WhoToFollow&gt;</c> and the integration pass mounted it on
/// the participant feed, but the route it reads did not exist anywhere in <c>Pulse.WebApi</c> — under
/// <c>VITE_USE_MOCK_DATA=true</c> a mock adapter rendered believable rows, and against the live backend it
/// 404'd, so <c>useWhoToFollow</c> failed closed and every participant saw a permanent "Suggestions aren't
/// available right now." panel above their feed (Gate-2 finding CR-001).
/// </para>
/// <para>
/// <b>The response is a BARE JSON ARRAY of id strings</b> — <c>["&lt;guid&gt;", ...]</c> — not the
/// <c>{ personaId, personaIds, count }</c> envelope the sibling follow reads use. That is the frozen client
/// contract, not a style choice: <c>resolveSuggestedFollowIds</c> type-guards the body with
/// <c>isStringArray</c> and THROWS on anything else, so an envelope here would fail closed into the exact
/// error panel this story exists to remove. Ids only also keeps the XC-002/SOC-052 promise structurally: there
/// is no field on this wire that could carry <c>personaType</c>, <c>castable</c>, or any archetype-derived
/// value, and the caller resolves each id against <c>GET /api/personas</c>'s already per-world-split
/// projection (story 06).
/// </para>
/// <para>
/// <b>Composition root (no <c>Program.cs</c> edit).</b> The route hangs off the persona resource, so this
/// slice is composed INTO the already-wired persona surface: <c>PersonaEndpoints.AddSocialPersonaRead()</c>
/// calls <see cref="AddSocialSuggestions"/> and <c>PersonaEndpoints.MapSocialPersonaEndpoints()</c> calls
/// <see cref="MapSocialSuggestionEndpoints"/>, both of which <c>Program.cs</c> already invokes — the same
/// composition <c>FollowEndpoints</c> uses. <c>CompositionRootWiringTests</c> asserts the route AND its
/// service resolution on the REAL <c>WebApplicationFactory&lt;Program&gt;</c> host, because a slice has merged
/// fully green here with its wiring never executed and the endpoint dead at 404 (#310→#317) — which is the
/// same shape of bug as CR-001 itself.
/// </para>
/// <para>
/// <b>Read-only sessions are SERVED (D1-011).</b> The suggestion module still renders for an observer session;
/// only its Follow controls are absent, and that gate lives in <c>useFollow</c>/<c>ReadOnlySessionWriteFilter</c>
/// on the write path. This route is therefore NOT mapped through <c>DenyReadOnlySessions()</c> — an observer
/// session carries a persona binding and gets its suggestions like any other reader.
/// </para>
/// </remarks>
public static class SuggestionEndpoints
{
    /// <summary>The <c>limit</c> query-string key — the display cap the client may ask the server to apply.</summary>
    private const string LimitQueryKey = "limit";

    /// <summary>
    /// Registers <see cref="SuggestionService"/> together with the follow-graph services it composes its
    /// already-followed exclusion from. Idempotent (<c>TryAdd</c>), so more than one slice may call it.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns><paramref name="services"/>, for chaining.</returns>
    public static IServiceCollection AddSocialSuggestions(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // FollowService + ICurrentSessionPersonaAccessor (both TryAdd-based, so this is safe to call alongside
        // the persona/feed slices that already register them).
        services.AddSocialFollowGraph();
        services.TryAddScoped<SuggestionService>();

        return services;
    }

    /// <summary>
    /// Maps <c>GET /api/personas/suggestions</c> — the exercise-scoped suggestion order. A literal segment, so
    /// it can never be shadowed by (or shadow) the <c>/api/personas/{personaId:guid}/...</c> follow routes.
    /// </summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns><paramref name="endpoints"/>, for chaining.</returns>
    public static IEndpointRouteBuilder MapSocialSuggestionEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/personas/suggestions", GetSuggestionsAsync);

        return endpoints;
    }

    /// <summary>
    /// Serves the caller's suggestion order, failing closed on an unresolved scope or an unresolvable viewer
    /// rather than emitting a default/unscoped set behind a <c>200</c>.
    /// </summary>
    /// <param name="request">The current request — read ONLY for the optional <c>limit</c>; scope never comes from it.</param>
    /// <param name="suggestionService">The suggestion read service.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>
    /// 200 with the ordered id array — including for a viewer with no persona binding, who gets the
    /// un-personalized in-scope list — or 400/401/403 per the fail-closed outcomes.
    /// </returns>
    private static async Task<IResult> GetSuggestionsAsync(
        HttpRequest request,
        SuggestionService suggestionService,
        CancellationToken cancellationToken)
    {
        if (!TryReadLimit(request, out var limit))
        {
            return Results.BadRequest("limit must be a positive integer.");
        }

        var result = await suggestionService.GetSuggestionsAsync(limit, cancellationToken);

        return result.Outcome switch
        {
            // The contract shape: a bare, order-significant array of persona ids (see the type remarks).
            SuggestionOutcome.Resolved => Results.Ok(result.PersonaIds),

            // Fail closed — no exercise resolved for this request (COR-001). Never an empty 200, which the
            // module would render as "there is nobody to suggest" rather than "you are not scoped". This is the
            // ONE fail-closed boundary here; an unbound viewer is served (see SuggestionService step 4).
            SuggestionOutcome.ScopeUnresolved => Results.Unauthorized(),

            // The caller's session belongs to a DIFFERENT exercise than this request resolved to.
            SuggestionOutcome.ForeignSessionPersona => Results.StatusCode(StatusCodes.Status403Forbidden),

            SuggestionOutcome.Invalid => Results.BadRequest(result.ValidationError),

            // Unreachable; fail closed rather than emit a bare 200.
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    /// <summary>
    /// Reads the optional <c>limit</c> query parameter. Absent → <c>null</c> (the whole eligible set).
    /// A non-numeric value is REJECTED rather than ignored: silently serving the unlimited set for
    /// <c>?limit=three</c> would hand a client more rows than it asked for and hide the typo.
    /// </summary>
    /// <param name="request">The current request.</param>
    /// <param name="limit">The parsed cap, or <c>null</c> when the parameter is absent.</param>
    /// <returns><c>false</c> when the parameter was present but not a valid integer.</returns>
    private static bool TryReadLimit(HttpRequest request, out int? limit)
    {
        limit = null;

        if (!request.Query.TryGetValue(LimitQueryKey, out var values) || values.Count == 0)
        {
            return true;
        }

        var raw = values[^1];
        if (string.IsNullOrWhiteSpace(raw)
            || !int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
        {
            return false;
        }

        limit = parsed;
        return true;
    }
}
