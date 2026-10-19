namespace Pulse.WebApi.Features.Ops.Build;

using System.Reflection;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// Serves <c>GET /api/build</c> (#617): the git commit the RUNNING process was published from, as
/// <c>{"commit":"&lt;sha&gt;"}</c> and nothing else. It exists for one caller: Deploy Backend's post-deploy smoke,
/// which polls it until the answer equals the commit it just shipped.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why /health is not enough.</b> After "Deploy to App Service" returns, the OLD process keeps answering for
/// minutes, and it answers <c>/health</c> 200 like any live process. A smoke that only reads <c>/health</c>
/// therefore cannot tell the new build from the old one, and a deploy whose new instance never came up was
/// reported green while the previous build kept serving. Comparing this endpoint's commit to the workflow's
/// <c>github.sha</c> is the check that tells the two apart.
/// </para>
/// <para>
/// <b>Where the commit comes from.</b> <c>deploy-backend.yml</c> publishes with
/// <c>-p:SourceRevisionId=${{ github.sha }}</c>. The SDK's default <c>IncludeSourceRevisionInInformationalVersion</c>
/// appends it to <see cref="AssemblyInformationalVersionAttribute"/> as <c>&lt;version&gt;+&lt;sha&gt;</c>, and
/// <see cref="CommitFrom"/> returns the part after the first <c>+</c>. A build without a revision (or any failure
/// reading the attribute) answers <c>"unknown"</c>, which never equals a real sha, so the smoke fails closed.
/// </para>
/// <para>
/// <b>Why it is pre-auth, and why that is safe.</b> The smoke presents no credential, exactly like the health
/// probes, so the route is on <see cref="PreAuthAllowlist"/> and marked
/// <see cref="SessionAuthorizationExtensions.AllowAnonymousPreAuth{TBuilder}"/>. It discloses only a commit id of
/// a repository whose deploys are already public in the Actions log: no version string, environment name,
/// configuration, exercise data or scope. The handler reads nothing from the request and queries nothing itself,
/// though the pipeline's session and exercise-resolution middleware still run on the route as on any API path.
/// </para>
/// <para>
/// <b>No caching.</b> The response carries <c>Cache-Control: no-store</c> so no proxy or front end can hand the
/// smoke a stale commit, the same false-green this endpoint exists to prevent.
/// </para>
/// <para>
/// No rate limiter: the handler returns a value captured once at startup, so its own cost is negligible; a flood
/// still pays for the shared session and exercise-resolution middleware, as any anonymous API request does. Every
/// existing limiter policy is a login or ops policy whose budget this route should not share.
/// </para>
/// </remarks>
public static class BuildInfoEndpoints
{
    /// <summary>The route the deploy smoke polls.</summary>
    public const string Route = "/api/build";

    /// <summary>The value returned when the running assembly carries no source revision.</summary>
    public const string UnknownCommit = "unknown";

    /// <summary>Maps <c>GET /api/build</c>.</summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapBuildInfoEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // Captured EAGERLY at startup, not lazily on the first request: the deploy overwrites the DLLs in place on a
        // single instance, so a lazy read in a process that started on the OLD image could pick up the NEW image's
        // attribute and report a false green (#617 review W1).
        var runningCommit = ReadRunningCommit();

        // PRE-AUTH (PreAuthAllowlist, #617): the deploy smoke presents no credential, like the health probes.
        endpoints.MapGet(Route, (HttpContext httpContext) => GetBuildInfo(httpContext, runningCommit))
            .AllowAnonymousPreAuth();

        return endpoints;
    }

    /// <summary>
    /// Extracts the commit from an informational version of the form <c>&lt;version&gt;+&lt;sha&gt;</c>. Never throws.
    /// </summary>
    /// <param name="informationalVersion">The <see cref="AssemblyInformationalVersionAttribute"/> value, if any.</param>
    /// <returns>The text after the first <c>+</c>, trimmed; or <see cref="UnknownCommit"/> when there is none.</returns>
    public static string CommitFrom(string? informationalVersion)
    {
        if (string.IsNullOrWhiteSpace(informationalVersion))
        {
            return UnknownCommit;
        }

        var plus = informationalVersion.IndexOf('+', StringComparison.Ordinal);
        if (plus < 0)
        {
            return UnknownCommit;
        }

        var commit = informationalVersion[(plus + 1)..].Trim();
        return commit.Length == 0 ? UnknownCommit : commit;
    }

    /// <summary>Writes the running commit with <c>Cache-Control: no-store</c>.</summary>
    private static IResult GetBuildInfo(HttpContext httpContext, string runningCommit)
    {
        httpContext.Response.Headers.CacheControl = "no-store";
        return Results.Ok(new BuildInfoDto { Commit = runningCommit });
    }

    /// <summary>Reads this assembly's informational version; any failure is <see cref="UnknownCommit"/>.</summary>
    [System.Diagnostics.CodeAnalysis.SuppressMessage(
        "Design",
        "CA1031:Do not catch general exception types",
        Justification = "The endpoint must never throw; a commit that cannot be read is reported as unknown.")]
    private static string ReadRunningCommit()
    {
        try
        {
            return CommitFrom(typeof(BuildInfoEndpoints).Assembly
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion);
        }
        catch (Exception)
        {
            return UnknownCommit;
        }
    }
}

/// <summary>The <c>GET /api/build</c> response: the running commit and nothing else.</summary>
public sealed class BuildInfoDto
{
    /// <summary>The git commit the running build was published from, or <c>"unknown"</c>.</summary>
    [JsonPropertyName("commit")]
    public required string Commit { get; init; }
}
