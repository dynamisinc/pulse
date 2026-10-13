namespace Pulse.WebApi.Features.Identity.PersonalLinks;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The anonymous personal-link sign-in route, <c>POST /api/auth/join { token }</c> (easy-login/03, EL-7). Mapped by
/// <see cref="PersonalLinkExtensions.MapPersonalLinkEndpoints"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Pre-auth, like <c>/api/auth/login</c>.</b> It establishes the session, so it is marked
/// <c>.AllowAnonymousPreAuth()</c>; the orchestrator adds <c>"POST /api/auth/join"</c> to <c>PreAuthAllowlist</c> in the
/// seam commit (until then the default-deny gate's equality test is the reminder). It carries the 16 KiB login body
/// limit and its own <see cref="JoinRateLimiterPolicy"/>.
/// </para>
/// <para>
/// <b>Status contract.</b> <c>200</c> with exactly the <c>/api/auth/login</c> envelope
/// (<see cref="ParticipantLoginResponseDto"/>); <c>400</c> ProblemDetails for a missing body or empty token;
/// <c>401</c> with NO body for every other outcome; <c>429</c> beyond the rate limit; <c>413</c> over the body limit.
/// The token travels in the body, never the URL, so it never reaches an access log. Nothing here logs.
/// </para>
/// </remarks>
public static class JoinEndpoints
{
    /// <summary>The join route.</summary>
    public const string JoinRoute = "/api/auth/join";

    /// <summary>Maps <c>POST /api/auth/join</c>.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The route handler builder (for tests that inspect its metadata).</returns>
    internal static RouteHandlerBuilder MapJoinEndpoint(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // PRE-AUTH (PreAuthAllowlist, seam commit): this route ESTABLISHES the session, so it cannot require one. It
        // fails closed on its own with one bodyless 401, behind its own per-IP limiter and the login body limit.
        return endpoints.MapPost(JoinRoute, JoinAsync)
            .RequireRateLimiting(JoinRateLimiterPolicy.PolicyName)
            .WithLoginBodyLimit()
            .AllowAnonymousPreAuth();
    }

    /// <summary>Exchanges the token for a session. Thin: parse, call the service, map the outcome.</summary>
    private static async Task<IResult> JoinAsync(
        [FromBody] JoinRequestBody? request,
        [FromServices] JoinLoginService joinService,
        CancellationToken cancellationToken)
    {
        var result = await joinService.JoinAsync(request, cancellationToken);

        return result.Outcome switch
        {
            JoinLoginOutcome.Authenticated when result.Issued is { } issued =>
                Results.Ok(ParticipantLoginResponseDto.From(issued)),
            JoinLoginOutcome.Invalid =>
                Results.Problem(detail: result.ValidationError, statusCode: StatusCodes.Status400BadRequest),

            // One bodyless 401 for everything else: nothing tells a caller why.
            JoinLoginOutcome.Rejected => Results.Unauthorized(),
            JoinLoginOutcome.ScopeUnresolved => Results.Unauthorized(),

            // Unreachable: Authenticated always carries a session. Fail closed.
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }
}
