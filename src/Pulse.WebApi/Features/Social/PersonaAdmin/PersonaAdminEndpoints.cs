namespace Pulse.WebApi.Features.Social.PersonaAdmin;

using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.SharedAccess;

/// <summary>
/// The staff persona profile edit endpoint (demo-polish PE-BE, story 21; implementation.md §1.5.6):
/// <c>PATCH /api/staff/personas/{personaId:guid}</c>, a JSON merge-patch (RFC 7396) of a persona's display name,
/// bio, location, verified mark, avatar and banner. STAFF world. The orchestrator wires
/// <see cref="AddPersonaAdmin"/> and <see cref="MapPersonaAdminEndpoints"/> into <c>Program.cs</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Who may call it.</b> Only a live staff session assigned to the resolved exercise as <c>controller</c>,
/// enforced by the same filters as the steering and takedown routes, in this order:
/// <see cref="EngineCockpitStaffAuthorizationFilter"/> (no staff session or no resolved scope → 401; staff not
/// assigned to the resolved exercise → 403), <see cref="EngineCockpitControllerRoleFilter"/> (an assigned
/// evaluator or planner → 403), then <see cref="ReadOnlyWriteDenialExtensions.DenyReadOnlySessions{TBuilder}"/>
/// (a read-only session → 403, COR-015). Anonymous, participant and shared read-only sessions are not staff
/// sessions, so they get 401 from the first gate. The body is read only inside the handler, after every gate,
/// so a refused caller learns nothing about the body rules (a malformed body from a participant is still 401).
/// </para>
/// <para>
/// <b>Responses.</b> 200 with the updated <see cref="StaffPersonaResponseDto"/> (signed <c>avatarUrl</c> /
/// <c>bannerUrl</c>). 400 (plain JSON string) for an invalid body, see <see cref="PersonaAdminMessages"/>;
/// that includes a body whose text is not valid UTF-8 / UTF-16 (a half emoji). 404 when the persona id is unknown
/// or belongs to another exercise; the response is identical in both cases (COR-001, DP-16). 415 (plain JSON
/// string) unless the <c>Content-Type</c> is <c>application/json</c> or <c>application/merge-patch+json</c>.
/// </para>
/// <para>
/// <b>Lifecycle.</b> <c>/api/staff/**</c> is not in <c>ExerciseLifecycleGatedRoutes</c>, so a controller can edit
/// a persona in any lifecycle state, including before StartEx (the seed script S1 depends on this).
/// </para>
/// <para>
/// <b>No telemetry (DP-9).</b> The console emits the <c>steering_action</c> (<c>persona_edit</c>) event.
/// </para>
/// </remarks>
public static class PersonaAdminEndpoints
{
    /// <summary>The persona edit route template.</summary>
    public const string PersonaRoute = "/api/staff/personas/{personaId:guid}";

    /// <summary>
    /// The largest body the endpoint reads. A legitimate patch is well under 4 KiB (512 + 100 + 100 characters
    /// and two ids); the cap bounds the sanitizer's work on an oversized body.
    /// </summary>
    public const int MaxBodyBytes = 16 * 1024;

    /// <summary>The plain JSON media type (accepted).</summary>
    public const string JsonContentType = "application/json";

    /// <summary>The RFC 7396 merge-patch media type (accepted).</summary>
    public const string MergePatchContentType = "application/merge-patch+json";

    /// <summary>
    /// Registers <see cref="PersonaProfileEditService"/> (Scoped, matching the request's <c>PulseDbContext</c>).
    /// </summary>
    /// <remarks>
    /// The service also needs registrations that other slices own: <see cref="PersonaReadService"/> and its
    /// follow-graph and URL-signer dependencies (<c>AddSocialPersonaRead</c>, with BM's <c>AddMedia</c> supplying
    /// the real signer), persistence and scoping. The route filters need <c>StaffAssignmentService</c>
    /// (<c>AddStaffIdentity</c>) and <c>IReadOnlySessionProbe</c> (the shared-access registrations). Program.cs
    /// registers all of these, so call order does not matter.
    /// </remarks>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddPersonaAdmin(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddScoped<PersonaProfileEditService>();

        return services;
    }

    /// <summary>
    /// Maps <c>PATCH /api/staff/personas/{personaId:guid}</c> behind the staff gate, the controller-role gate and
    /// the read-only-session denial.
    /// </summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapPersonaAdminEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // Same composition as ModerationEndpoints / StorylineSteeringEndpoints: the staff + assigned-exercise gate
        // on an empty-prefix group and the controller-role gate on a nested one. Outer group filters run first, so
        // a non-staff caller gets 401 before the role check, and the read-only denial (innermost) can only ever
        // see an assigned controller.
        var staff = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        var controllerOnly = staff
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitControllerRoleFilter>();

        var writable = controllerOnly
            .MapGroup(string.Empty)
            .DenyReadOnlySessions();

        writable.MapPatch(PersonaRoute, PatchPersonaAsync);

        return endpoints;
    }

    /// <summary>
    /// Reads and validates the merge-patch body, then applies it. The filters have already authorized an assigned,
    /// non-read-only controller.
    /// </summary>
    /// <param name="personaId">The persona to edit (route).</param>
    /// <param name="request">The request whose body is the merge-patch (read here, after the gates).</param>
    /// <param name="user">The server-resolved session principal (the acting staff user, for the log line only).</param>
    /// <param name="service">The edit service.</param>
    /// <param name="cancellationToken">The request-aborted token.</param>
    /// <returns>200, 400, 401, 404 or 415.</returns>
    private static async Task<IResult> PatchPersonaAsync(
        Guid personaId,
        HttpRequest request,
        ClaimsPrincipal user,
        [FromServices] PersonaProfileEditService service,
        CancellationToken cancellationToken)
    {
        // Gate-1 L-1: only a JSON body is a merge-patch. Checked after the auth gates (they run first), before
        // anything is read.
        if (!HasAcceptedContentType(request))
        {
            return Results.Json(PersonaAdminMessages.UnsupportedContentType, statusCode: StatusCodes.Status415UnsupportedMediaType);
        }

        var body = await ReadBodyAsync(request, cancellationToken);
        if (body.TooLarge)
        {
            return Results.BadRequest(PersonaAdminMessages.BodyTooLarge);
        }

        PersonaProfilePatch? patch;
        string? error;
        try
        {
            using var document = JsonDocument.Parse(body.Bytes);
            if (!PersonaProfilePatchParser.TryParse(document.RootElement, out patch, out error))
            {
                return Results.BadRequest(error);
            }
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException)
        {
            // Missing, empty or malformed JSON (JsonException), or text that is not valid UTF-8 / UTF-16 — invalid
            // bytes, or a lone-surrogate escape such as a half emoji cut by .slice() — which System.Text.Json only
            // reports when a name or string value is read (InvalidOperationException; Gate-1 M-1). Only the parse
            // and the pure parser run in this block, so nothing else can raise these here. The exception text is
            // never echoed.
            return Results.BadRequest(PersonaAdminMessages.BodyNotObject);
        }

        // The staff user id comes from the principal SessionAuthenticationMiddleware resolved server-side, never
        // from the request. The filters have already verified it is a live, assigned controller session.
        var staffUserId = SessionPrincipal.Read(user)?.StaffUserId;

        var result = await service.EditAsync(personaId, patch, staffUserId, cancellationToken);

        return result.Outcome switch
        {
            PersonaProfileEditOutcome.Updated => Results.Ok(result.Persona),
            PersonaProfileEditOutcome.Invalid => Results.BadRequest(result.Error),

            // Same response for an unknown id and another exercise's id, so it does not reveal that a
            // cross-exercise persona exists (COR-001).
            PersonaProfileEditOutcome.NotFound => Results.NotFound(),
            PersonaProfileEditOutcome.ScopeUnresolved => Results.Unauthorized(),

            // Unreachable: every outcome is handled above. Fail closed rather than fall through to a 200.
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    /// <summary>
    /// Whether the request declares <see cref="JsonContentType"/> or <see cref="MergePatchContentType"/>
    /// (parameters such as <c>charset</c> allowed; media type compared case-insensitively). A missing or
    /// unparseable <c>Content-Type</c> is not accepted.
    /// </summary>
    /// <param name="request">The request.</param>
    /// <returns><c>true</c> when the content type is one of the two accepted JSON types.</returns>
    private static bool HasAcceptedContentType(HttpRequest request)
    {
        if (!MediaTypeHeaderValue.TryParse(request.ContentType, out var contentType))
        {
            return false;
        }

        var mediaType = contentType.MediaType.Value;
        return string.Equals(mediaType, JsonContentType, StringComparison.OrdinalIgnoreCase)
            || string.Equals(mediaType, MergePatchContentType, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Reads the request body up to <see cref="MaxBodyBytes"/>. Stops reading (and reports
    /// <see cref="BodyRead.TooLarge"/>) as soon as the cap is crossed, so an oversized body is never buffered.
    /// </summary>
    /// <param name="request">The request.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The body bytes, or a too-large marker.</returns>
    private static async Task<BodyRead> ReadBodyAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        if (request.ContentLength > MaxBodyBytes)
        {
            return BodyRead.Oversized;
        }

        using var buffer = new MemoryStream();
        var chunk = new byte[4096];
        int read;
        while ((read = await request.Body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > MaxBodyBytes)
            {
                return BodyRead.Oversized;
            }

            buffer.Write(chunk, 0, read);
        }

        return new BodyRead(buffer.ToArray(), TooLarge: false);
    }

    /// <summary>The outcome of reading the body.</summary>
    /// <param name="Bytes">The body (empty when too large).</param>
    /// <param name="TooLarge"><c>true</c> when the body exceeded <see cref="MaxBodyBytes"/>.</param>
    private sealed record BodyRead(byte[] Bytes, bool TooLarge)
    {
        public static BodyRead Oversized { get; } = new([], TooLarge: true);
    }
}
