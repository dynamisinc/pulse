namespace Pulse.WebApi.Features.Social;

using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The <c>POST /api/posts</c> ingest endpoint — the HTTP face of <see cref="PostIngestService"/>'s blessed
/// ingest path (SOC-003). Exposes composition-root extension methods (<see cref="AddSocialPostWrite"/> /
/// <see cref="MapSocialPostEndpoints"/>) that the orchestrator wires into <c>Program.cs</c>; this feature does
/// not edit <c>Program.cs</c> itself.
/// </summary>
public static class PostWriteEndpoints
{
    /// <summary>
    /// Registers the post-write funnel (<see cref="PostIngestService"/>) with a Scoped lifetime, matching the
    /// <c>PulseDbContext</c> unit of work it writes through. <see cref="PostSanitizer"/> is a pure static helper
    /// and needs no registration.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddSocialPostWrite(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

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
    /// <b>Role is proxied by <c>origin</c> until Phase B2 auth lands.</b> There is no caller-role identity yet,
    /// so the response branch keys off the post's <c>origin</c>: a participant composer only ever sends
    /// <c>origin:'participant'</c>, so that value stands in for "participant-authenticated caller" and gets the
    /// unconditional XC-002 projection (<see cref="ParticipantPostDto"/> — no provenance). Every other origin
    /// (controller-as-persona / engine / inject) is a staff-side write and gets <see cref="StaffPostDto"/>,
    /// which carries <c>origin</c>/<c>actingHumanId</c> because the console's
    /// <c>originConsoleLabel(lastPublished)</c> (<c>PersonaComposer.tsx:150-157</c>) reads them off its OWN
    /// controller-as-persona write. Echoing a caller's own supplied provenance back to that same caller is not
    /// an XC-002 cross-actor leak — it inherits the pre-auth client-trust model today's client-side
    /// <c>createPost</c> already has; Phase B2 hardens <c>origin</c> authenticity.
    /// </para>
    /// <para>
    /// Fail-closed scoping: an unresolved exercise scope yields <see cref="StatusCodes.Status401Unauthorized"/>
    /// (never a default/empty-200/unscoped result); a validation failure yields
    /// <see cref="StatusCodes.Status400BadRequest"/>.
    /// </para>
    /// </remarks>
    /// <param name="request">The create-post body (any <c>exerciseId</c> in it is ignored for scoping).</param>
    /// <param name="ingestService">The ingest funnel.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>201 with the role-appropriate DTO, 400 on invalid input, or 401 on an unresolved scope.</returns>
    private static async Task<IResult> CreatePostAsync(
        CreatePostRequest? request,
        PostIngestService ingestService,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON post body is required.");
        }

        var result = await ingestService.IngestAsync(request, cancellationToken);

        switch (result.Outcome)
        {
            case PostIngestOutcome.ScopeUnresolved:
                // Fail closed — no exercise resolved for this request (per-request scope is Phase B2).
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
public sealed class CreatePostRequest
{
    /// <summary>The authoring persona INSTANCE id — must parse to a non-empty GUID.</summary>
    public string? AuthorPersonaId { get; init; }

    /// <summary>The individual human behind the account (COR-018) — required when <see cref="Origin"/> is <c>controller-as-persona</c>.</summary>
    public string? ActingHumanId { get; init; }

    /// <summary>The raw post text; sanitized server-side (NFR-004) before persistence.</summary>
    public string? Text { get; init; }

    /// <summary>The scenario ISO-8601 instant (COR-053), client-supplied this phase.</summary>
    public string? ScenarioTime { get; init; }

    /// <summary>The exercise IANA time zone (XC-008) — part of the XC-004 envelope; required.</summary>
    public string? TimeZone { get; init; }

    /// <summary>The <c>PostOrigin</c> union value (full union accepted).</summary>
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
