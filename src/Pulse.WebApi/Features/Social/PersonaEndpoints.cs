namespace Pulse.WebApi.Features.Social;

using System.Text.Json.Serialization;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Registers and maps the persona read API (XC-005, COR-003, story <c>social-api/04</c>) — the production
/// author source <c>resolvePersonas()</c>/<c>usePersonas()</c> (<c>features/personas/personaService.ts</c>)
/// resolve against once the mock→live flip (orchestrator-owned) lands, replacing the
/// <c>SEEDED_PERSONAS</c> mock fixture.
/// </summary>
public static class PersonaEndpoints
{
    /// <summary>Registers <see cref="PersonaReadService"/> for DI. Called once from the composition root.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns><paramref name="services"/>, for chaining.</returns>
    public static IServiceCollection AddSocialPersonaRead(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.AddScoped<PersonaReadService>();
        return services;
    }

    /// <summary>
    /// Maps <c>GET /api/personas</c> — the exercise-scoped persona-instance read. Scope comes ONLY from the
    /// injected <see cref="IExerciseContext"/> (COR-001); a client can never supply/override the exerciseId.
    /// FAILS CLOSED with <c>401</c> when no exercise scope has been resolved for the request (per-request
    /// scope population is Phase B2) — never a default/empty-200/unscoped result. Both known consumers (the
    /// participant feed's author resolution and the controller console's persona picker) receive the
    /// identical unconditional shape: the shipped <c>Persona</c> type carries no provenance to branch on
    /// (unlike <c>01</c>/<c>02</c>'s participant-vs-staff split).
    /// </summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns><paramref name="endpoints"/>, for chaining.</returns>
    public static IEndpointRouteBuilder MapSocialPersonaEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/personas", async (
            IExerciseContext exerciseContext,
            PersonaReadService personaReadService,
            CancellationToken cancellationToken) =>
        {
            // Fail-closed scoping (COR-001): an unresolved exercise scope refuses the request outright
            // rather than falling through to PulseDbContext's own fail-closed-to-empty-set query filter —
            // the caller must see a clear 401, not a silent empty 200 that looks like "this exercise has no
            // personas".
            if (exerciseContext.CurrentExerciseId is null)
            {
                return Results.Unauthorized();
            }

            var personas = await personaReadService.GetPersonasAsync(cancellationToken);
            return Results.Ok(personas);
        });

        return endpoints;
    }
}

/// <summary>
/// The complete, renderable participant-facing <c>Persona</c> shape (frozen frontend contract,
/// <c>features/personas/types.ts:84-101</c>) — satisfies the frontend's <c>isValidPersona</c> guard
/// (<c>id</c>, <c>displayName</c>, <c>handle</c>, <c>kind ∈ {human,org}</c>, <c>verified: boolean</c>) and
/// carries every other field <c>usePersonas()</c> consumers (the feed's author resolution, the controller's
/// persona picker) render against. XC-002: this is the ONLY persona shape ever served here — it structurally
/// cannot carry an operator/session/attribution field (CTL-004 presence is a separate staff surface, not
/// built by this story).
/// </summary>
/// <remarks>
/// <b>B1 read-only stand-in defaults.</b> The B0 <see cref="Persona"/> entity persists only
/// <c>Id</c>/<c>ExerciseId</c>/<c>DisplayName</c>/<c>Handle</c>/<c>PersonaTemplateId</c>/<c>Kind</c>/
/// <c>Verified</c> this phase — <c>personaType</c>, <c>avatarColor</c>, <c>initials</c>,
/// <c>audienceBand</c>, <c>followerCount</c>, and <c>joinedAt</c> are presentation-only fields the schema
/// does not store yet. This story is read-only (no persona authoring/seeding write path), so these five are
/// DOCUMENTED, DETERMINISTIC B1 defaults — not authored data — until <c>persona-management</c>'s authoring/
/// seeding write path (COR-020/021) populates real values on the entity in a later phase:
/// <list type="bullet">
///   <item><description><c>personaType</c> defaults to <c>citizen</c> (the least presumptive archetype).</description></item>
///   <item><description><c>avatarColor</c> is derived deterministically from <c>handle</c> (stable across
///   reads/reloads) via <see cref="AvatarColorForHandle"/>.</description></item>
///   <item><description><c>initials</c> is derived from <c>displayName</c> via <see cref="InitialsForDisplayName"/>.</description></item>
///   <item><description><c>audienceBand</c> defaults to <c>micro</c>.</description></item>
///   <item><description><c>followerCount</c> defaults to <c>0</c> (no seeded audience-band derivation this phase).</description></item>
///   <item><description><c>joinedAt</c> defaults to a fixed pre-exercise scenario ISO instant
///   (<see cref="DefaultJoinedAt"/>), never wall-clock (COR-053).</description></item>
/// </list>
/// <c>bio</c> is optional in the frozen contract and omitted entirely (not authored this phase).
/// </remarks>
public sealed class PersonaResponseDto
{
    /// <summary>
    /// The fixed pre-exercise scenario ISO instant used as the B1 stand-in <c>joinedAt</c> for every
    /// persona instance, until seeding (COR-021) derives a real per-persona value.
    /// </summary>
    private const string DefaultJoinedAt = "2026-01-01T00:00:00Z";

    /// <summary>
    /// The B1 stand-in avatar-color palette <see cref="AvatarColorForHandle"/> selects from
    /// deterministically. An arbitrary but fixed, readable set of hex swatches — not a design-approved
    /// brand palette (participant surfaces are per-exercise skinned; this is a placeholder).
    /// </summary>
    private static readonly string[] AvatarColorPalette =
    [
        "#4C6EF5", "#F76707", "#0CA678", "#E64980", "#7048E8", "#1098AD", "#F59F00", "#495057",
    ];

    /// <inheritdoc cref="Data.Entities.Persona.Id" />
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <inheritdoc cref="Data.Entities.Persona.ExerciseId" />
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <inheritdoc cref="Data.Entities.Persona.PersonaTemplateId" />
    [JsonPropertyName("templateId")]
    public required string TemplateId { get; init; }

    /// <inheritdoc cref="Data.Entities.Persona.DisplayName" />
    [JsonPropertyName("displayName")]
    public required string DisplayName { get; init; }

    /// <inheritdoc cref="Data.Entities.Persona.Handle" />
    [JsonPropertyName("handle")]
    public required string Handle { get; init; }

    /// <inheritdoc cref="Data.Entities.Persona.Kind" />
    [JsonPropertyName("kind")]
    public required string Kind { get; init; }

    /// <summary>B1 stand-in default — see the type-level remarks. Not persisted this phase.</summary>
    [JsonPropertyName("personaType")]
    public required string PersonaType { get; init; }

    /// <inheritdoc cref="Data.Entities.Persona.Verified" />
    [JsonPropertyName("verified")]
    public required bool Verified { get; init; }

    /// <summary>B1 stand-in default, deterministically derived from <see cref="Handle"/> — see the type-level remarks.</summary>
    [JsonPropertyName("avatarColor")]
    public required string AvatarColor { get; init; }

    /// <summary>B1 stand-in default, deterministically derived from <see cref="DisplayName"/> — see the type-level remarks.</summary>
    [JsonPropertyName("initials")]
    public required string Initials { get; init; }

    /// <summary>B1 stand-in default — see the type-level remarks. Not persisted this phase.</summary>
    [JsonPropertyName("audienceBand")]
    public required string AudienceBand { get; init; }

    /// <summary>B1 stand-in default — see the type-level remarks. Not persisted/derived from a band this phase.</summary>
    [JsonPropertyName("followerCount")]
    public required int FollowerCount { get; init; }

    /// <summary>
    /// B1 stand-in default (fixed scenario instant, COR-053) — see the type-level remarks.
    /// <c>bio</c> (optional in the frozen contract) is intentionally omitted rather than emitted as
    /// <c>null</c>/empty — it is not authored data this phase.
    /// </summary>
    [JsonPropertyName("joinedAt")]
    public required string JoinedAt { get; init; }

    /// <summary>
    /// Projects a persisted <see cref="Data.Entities.Persona"/> instance to the complete, renderable
    /// participant-facing shape. Maps real entity fields verbatim; supplies the documented B1 stand-in
    /// defaults for the presentation-only fields the schema does not store this phase (see the type-level
    /// remarks). Contains no provenance/operator/session/attribution field — there is none on the entity to
    /// leak (XC-002).
    /// </summary>
    /// <param name="persona">The full persona entity to project.</param>
    /// <returns>The complete participant-facing projection of <paramref name="persona"/>.</returns>
    public static PersonaResponseDto FromPersona(Data.Entities.Persona persona)
    {
        ArgumentNullException.ThrowIfNull(persona);

        return new PersonaResponseDto
        {
            Id = persona.Id.ToString(),
            ExerciseId = persona.ExerciseId.ToString(),
            TemplateId = persona.PersonaTemplateId?.ToString() ?? string.Empty,
            DisplayName = persona.DisplayName,
            Handle = persona.Handle,
            Kind = persona.Kind,
            PersonaType = "citizen",
            Verified = persona.Verified,
            AvatarColor = AvatarColorForHandle(persona.Handle),
            Initials = InitialsForDisplayName(persona.DisplayName),
            AudienceBand = "micro",
            FollowerCount = 0,
            JoinedAt = DefaultJoinedAt,
        };
    }

    /// <summary>
    /// Deterministically derives a stable B1 stand-in avatar color from <paramref name="handle"/> — the
    /// same handle always yields the same swatch, across requests and reloads, without persisting anything.
    /// </summary>
    /// <param name="handle">The persona's handle.</param>
    /// <returns>A hex color string from <see cref="AvatarColorPalette"/>.</returns>
    private static string AvatarColorForHandle(string handle)
    {
        var hash = 0;
        foreach (var c in handle)
        {
            hash = (hash * 31 + c) & 0x7FFFFFFF;
        }

        return AvatarColorPalette[hash % AvatarColorPalette.Length];
    }

    /// <summary>
    /// Deterministically derives up to two initials from <paramref name="displayName"/>: the first letter
    /// of up to the first two whitespace-separated words, uppercased.
    /// </summary>
    /// <param name="displayName">The persona's display name.</param>
    /// <returns>One or two uppercase initial characters, or an empty string if none could be derived.</returns>
    private static string InitialsForDisplayName(string displayName)
    {
        var words = displayName.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var initials = words.Take(2).Where(w => w.Length > 0).Select(w => char.ToUpperInvariant(w[0]));
        return string.Concat(initials);
    }
}
