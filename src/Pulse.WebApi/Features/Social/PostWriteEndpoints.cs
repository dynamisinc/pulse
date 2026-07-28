namespace Pulse.WebApi.Features.Social;

using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>
/// The <c>POST /api/posts</c> ingest endpoint — the HTTP face of <see cref="PostIngestService"/>'s blessed
/// ingest path (SOC-003). Exposes composition-root extension methods (<see cref="AddSocialPostWrite"/> /
/// <see cref="MapSocialPostEndpoints"/>) that the orchestrator wires into <c>Program.cs</c>; this feature does
/// not edit <c>Program.cs</c> itself.
/// </summary>
public static class PostWriteEndpoints
{
    /// <summary>
    /// Registers the post-write funnel (<see cref="PostIngestService"/>) and the server-side attribution
    /// resolver (<see cref="PostAttributionResolver"/>) with a Scoped lifetime, matching the
    /// <c>PulseDbContext</c> unit of work they run through. <see cref="PostSanitizer"/> is a pure static helper
    /// and needs no registration.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The resolver's participant arm needs <c>ICurrentSessionPersonaAccessor</c>, which
    /// <c>FollowEndpoints.AddSocialFollowGraph()</c> also contributes. It is <c>TryAdd</c>ed here so this slice
    /// stands on its own rather than silently depending on the persona/follow slice having been registered
    /// first — a dependency that would hold in <c>Program.cs</c> (which wires both) and fail at REQUEST time in
    /// any host that wires only this one. <c>TryAdd</c> makes the two registrations idempotent in either order.
    /// The staff arm's <c>ICurrentStaffSessionAccessor</c> is deliberately NOT registered here: the identity
    /// slice owns it (<c>AddStaffIdentity</c>'s fail-closed default, <c>Replace</c>d by <c>AddSessions</c> with
    /// the real one), and a Social slice contributing its own would be a second opinion about who is staff.
    /// </para>
    /// </remarks>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddSocialPostWrite(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Both accessors read the CURRENT request's bearer token, exactly as CurrentStaffSessionAccessor does.
        services.AddHttpContextAccessor();
        services.TryAddScoped<ICurrentSessionPersonaAccessor, CurrentSessionPersonaAccessor>();

        services.AddScoped<PostAttributionResolver>();
        services.AddScoped<PostIngestService>();

        return services;
    }

    /// <summary>Maps <c>POST /api/posts</c> onto the given endpoint builder.</summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapSocialPostEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapPost("/api/posts", CreatePostAsync);

        return endpoints;
    }

    /// <summary>
    /// Ingests one post and shapes the response by caller role.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Role is derived from <c>origin</c>, and <c>origin</c> is now server-derived
    /// (<c>identity-auth-roles/12</c>).</b> This branch used to be a documented pre-auth compromise: there was
    /// no caller-role identity, so the response shape keyed off the <c>origin</c> the CLIENT sent, and echoing a
    /// caller's own claimed provenance back to that same caller was defensible only because the whole endpoint
    /// already trusted the body. That hardening is this story. <see cref="PostAttributionResolver"/> resolves
    /// <c>origin</c> from the caller's persisted session before ingest runs — <c>participant</c> is reachable
    /// ONLY from a non-staff session and <c>controller-as-persona</c> ONLY from a live staff session — so the
    /// branch below is now sound rather than merely tolerable: a <c>participant</c>-origin post is a
    /// participant's own write and gets the unconditional XC-002 projection
    /// (<see cref="ParticipantPostDto"/> — no provenance), and every other origin is provably a STAFF write, so
    /// <see cref="StaffPostDto"/>'s provenance (<c>origin</c>/<c>actingHumanId</c>, which the console's
    /// <c>originConsoleLabel(lastPublished)</c> at <c>PersonaComposer.tsx:150-157</c> reads) goes only to the
    /// staff caller reading its OWN write. A participant can no longer reach the staff shape by claiming a staff
    /// origin, which is what made the old arrangement a compromise.
    /// </para>
    /// <para>
    /// Fail-closed identity and scoping, in that order: an unresolved exercise scope or an unestablished
    /// identity yields <see cref="StatusCodes.Status401Unauthorized"/> /
    /// <see cref="StatusCodes.Status403Forbidden"/> (never a default/empty-200/unscoped result); a validation
    /// failure yields <see cref="StatusCodes.Status400BadRequest"/>. An anonymous caller never arrives here at
    /// all — story 11's default-deny fallback policy answers it in <c>AuthorizationMiddleware</c>.
    /// </para>
    /// </remarks>
    /// <param name="request">The create-post body (any <c>exerciseId</c> in it is ignored for scoping).</param>
    /// <param name="attributionResolver">Derives who is really posting from the caller's session (COR-018).</param>
    /// <param name="ingestService">The ingest funnel.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>201 with the role-appropriate DTO, 400 on invalid input, 401/403 on an unestablished identity.</returns>
    private static async Task<IResult> CreatePostAsync(
        CreatePostRequest? request,
        PostAttributionResolver attributionResolver,
        PostIngestService ingestService,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON post body is required.");
        }

        // Identity FIRST: nothing about this request is written until the server has established who is posting.
        var attribution = await attributionResolver.ResolveAsync(request, cancellationToken);
        if (attribution.Attribution is not { } resolved)
        {
            return attribution.RejectionStatusCode switch
            {
                // A body-field failure tells the caller what to fix.
                StatusCodes.Status400BadRequest => Results.BadRequest(attribution.RejectionReason),

                // Same fail-closed 401 the funnel's own unresolved-scope door returns, written the same way so
                // the two are indistinguishable to a client.
                StatusCodes.Status401Unauthorized => Results.Unauthorized(),

                // An IDENTITY rejection carries no body: the reason names which check the caller tripped, which
                // is useful to a prober and to nobody else. Matches FollowEndpoints' bare 403.
                _ => Results.StatusCode(attribution.RejectionStatusCode),
            };
        }

        var result = await ingestService.IngestAsync(request, resolved, cancellationToken);

        switch (result.Outcome)
        {
            case PostIngestOutcome.ScopeUnresolved:
                // Fail closed — no exercise resolved for this request. Unreachable in practice now (the resolver
                // above already refuses an unresolved scope with the same 401), kept because the funnel's own
                // fail-closed door is not this endpoint's to remove.
                return Results.Unauthorized();

            case PostIngestOutcome.Invalid:
                return Results.BadRequest(result.ValidationError);

            case PostIngestOutcome.Created when result.Post is { } post:
                return string.Equals(post.Origin, "participant", StringComparison.Ordinal)
                    ? Results.Json(ParticipantPostDto.FromPost(post), statusCode: StatusCodes.Status201Created)
                    : Results.Json(StaffPostDto.FromPost(post), statusCode: StatusCodes.Status201Created);

            default:
                // Unreachable: a Created outcome always carries a post. Fail closed rather than emit a bare 200.
                return Results.StatusCode(StatusCodes.Status500InternalServerError);
        }
    }
}

/// <summary>
/// The <c>POST /api/posts</c> request body (camelCase JSON; bound case-insensitively by the web defaults).
/// Mirrors the frontend <c>CreatePostInput</c>. Every scalar is nullable so a missing field is a validation
/// concern (a 400), never a deserialization failure. Any <c>exerciseId</c> a caller includes is deliberately
/// absent here — it is NEVER trusted for scoping (COR-001); the server stamps the resolved scope.
/// </summary>
/// <remarks>
/// <b>Three fields survive on the wire but are no longer believed (<c>identity-auth-roles/12</c>).</b>
/// <see cref="AuthorPersonaId"/>, <see cref="ActingHumanId"/> and <see cref="Origin"/> are kept because the
/// frozen frontend <c>CreatePostInput</c> still sends them, but <see cref="PostAttributionResolver"/> derives all
/// three from the caller's session: only the staff console's <see cref="AuthorPersonaId"/> is still read, and
/// <see cref="Origin"/> is read only so a claim the caller cannot hold can be REFUSED. Nothing here reaches
/// <c>PostIngestService</c> as attribution.
/// </remarks>
public sealed class CreatePostRequest
{
    /// <summary>
    /// The authoring persona INSTANCE id. Honored ONLY for a staff session operating a persona (the console's
    /// persona choice — must parse to a non-empty GUID that exists in the resolved exercise); IGNORED for a
    /// participant session, whose author is its own session-bound persona.
    /// </summary>
    public string? AuthorPersonaId { get; init; }

    /// <summary>
    /// The individual human behind the account (COR-018). <b>Never trusted:</b> the server derives it from the
    /// session (the participant's own identity, or the operating staff user's id). Retained only because the
    /// frozen client still sends it.
    /// </summary>
    public string? ActingHumanId { get; init; }

    /// <summary>The raw post text; sanitized server-side (NFR-004) before persistence.</summary>
    public string? Text { get; init; }

    /// <summary>The scenario ISO-8601 instant (COR-053), client-supplied this phase.</summary>
    public string? ScenarioTime { get; init; }

    /// <summary>The exercise IANA time zone (XC-008) — part of the XC-004 envelope; required.</summary>
    public string? TimeZone { get; init; }

    /// <summary>
    /// The <c>PostOrigin</c> union value the caller CLAIMS. Not the post's provenance — the server derives that
    /// from the session kind. Read only to refuse a claim the caller cannot hold: <c>engine</c> / <c>inject</c>
    /// are in-process-only and unreachable over HTTP by anyone, and a non-staff session naming any privileged
    /// origin is refused (403) rather than quietly downgraded.
    /// </summary>
    public string? Origin { get; init; }

    /// <summary>The MSEL inject id — required when <see cref="Origin"/> is <c>inject</c>; null otherwise.</summary>
    public string? InjectId { get; init; }

    /// <summary>
    /// Media attachments — ACCEPTED but NOT stored this phase (there is no media storage in B1). Bound as an
    /// opaque element so any shape is tolerated on the wire without being persisted or re-served.
    /// </summary>
    public JsonElement? Media { get; init; }
}

/// <summary>
/// The staff/controller response shape for <c>POST /api/posts</c> — the role-conditional exception to
/// unconditional XC-002 projection. Unlike <see cref="ParticipantPostDto"/>, it DELIBERATELY carries
/// <see cref="Origin"/>/<see cref="ActingHumanId"/>/<see cref="CreatedWallClock"/>/<see cref="InjectId"/>
/// because the console's <c>originConsoleLabel(lastPublished)</c> (<c>PersonaComposer.tsx:150-157</c>) reads
/// them off the staff caller's OWN write. Every property carries an explicit
/// <see cref="JsonPropertyNameAttribute"/> so the wire shape is fixed independent of host serializer config.
/// </summary>
public sealed class StaffPostDto
{
    /// <summary>The post id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The owning exercise run (server-stamped scope, COR-001).</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>The authoring persona instance id.</summary>
    [JsonPropertyName("authorPersonaId")]
    public required string AuthorPersonaId { get; init; }

    /// <summary>The acting human behind the account (COR-018) — staff-visible.</summary>
    [JsonPropertyName("actingHumanId")]
    public required string ActingHumanId { get; init; }

    /// <summary>The sanitized post body.</summary>
    [JsonPropertyName("text")]
    public required string Text { get; init; }

    /// <summary>Engagement counts, seeded to zero for a freshly-created post (order reply · repost · like, R-002).</summary>
    [JsonPropertyName("counts")]
    public required ParticipantPostCounts Counts { get; init; }

    /// <summary>The real wall-clock ingest instant (server UTC), round-trip ISO-8601 — staff/telemetry-only.</summary>
    [JsonPropertyName("createdWallClock")]
    public required string CreatedWallClock { get; init; }

    /// <summary>The scenario instant (COR-053), round-trip ISO-8601.</summary>
    [JsonPropertyName("scenarioTime")]
    public required string ScenarioTime { get; init; }

    /// <summary>The post provenance — the <c>PostOrigin</c> union value the console's origin line reads (R-003).</summary>
    [JsonPropertyName("origin")]
    public required string Origin { get; init; }

    /// <summary>The MSEL inject id — present only for an <c>inject</c>-origin post; omitted from the JSON otherwise.</summary>
    [JsonPropertyName("injectId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? InjectId { get; init; }

    /// <summary>Projects a persisted staff-authored post to the staff response shape (provenance retained).</summary>
    /// <param name="post">The persisted post.</param>
    /// <returns>The staff-visible projection of <paramref name="post"/>.</returns>
    public static StaffPostDto FromPost(Post post)
    {
        ArgumentNullException.ThrowIfNull(post);

        return new StaffPostDto
        {
            Id = post.Id.ToString(),
            ExerciseId = post.ExerciseId.ToString(),
            AuthorPersonaId = post.AuthorPersonaId.ToString(),
            ActingHumanId = post.ActingHumanId,
            Text = post.Body,
            Counts = new ParticipantPostCounts(0, 0, 0),
            CreatedWallClock = post.CreatedWallClock.ToString("O"),
            ScenarioTime = post.CreatedScenarioTime.ToString("O"),
            Origin = post.Origin,
            InjectId = post.InjectId,
        };
    }
}
