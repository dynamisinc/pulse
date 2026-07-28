namespace Pulse.WebApi.Features.Social;

using System.Globalization;
using System.Text.Json.Serialization;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Social.Follows;
using Pulse.WebApi.Features.Social.Suggestions;

/// <summary>
/// Registers and maps the persona read API (XC-005, COR-003, story <c>social-api/04</c>) — the production
/// author source <c>resolvePersonas()</c>/<c>usePersonas()</c> (<c>features/personas/personaService.ts</c>)
/// resolve against once the mock→live flip (orchestrator-owned) lands, replacing the
/// <c>SEEDED_PERSONAS</c> mock fixture.
/// </summary>
public static class PersonaEndpoints
{
    /// <summary>
    /// Registers <see cref="PersonaReadService"/> for DI, together with the follow-graph services
    /// (<see cref="FollowEndpoints.AddSocialFollowGraph"/>) the persona read composes its counts from and the
    /// follow routes depend on. Called once from the composition root.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns><paramref name="services"/>, for chaining.</returns>
    public static IServiceCollection AddSocialPersonaRead(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.AddScoped<PersonaReadService>();

        // profiles-social-graph/07: the follow graph is composed into the persona surface (its routes hang off
        // /api/personas/{id}) rather than asking for a separate Program.cs line the orchestrator owns.
        services.AddSocialFollowGraph();

        // profiles-social-graph/08: the "Who to follow" suggestion read, composed the same way (its route is
        // /api/personas/suggestions). TryAdd-based, so it may safely re-register the follow-graph services.
        services.AddSocialSuggestions();

        return services;
    }

    /// <summary>
    /// Maps <c>GET /api/personas</c> — the exercise-scoped persona-instance read. Scope comes ONLY from the
    /// injected <see cref="IExerciseContext"/> (COR-001); a client can never supply/override the exerciseId.
    /// FAILS CLOSED with <c>401</c> when no exercise scope has been resolved for the request — never a
    /// default/empty-200/unscoped result.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Per-world projection (SOC-052 / D1-008, <c>profiles-social-graph/06</c>).</b> The response shape
    /// depends on the CALLER's world, exactly as <c>ParticipantPostDto</c>/<c>StaffPostDto</c> already split
    /// post provenance (XC-002):
    /// </para>
    /// <list type="bullet">
    ///   <item><description><b>Participant</b> (and anonymous / read-only / any non-staff caller) →
    ///   <see cref="PersonaResponseDto"/>, which structurally OMITS <c>personaType</c>. The archetype is a
    ///   machine-readable tell: it labels exactly one seeded account <c>bad-actor</c>, so shipping it to the
    ///   participant feed would hand the client a way to flag the SOC-052 lookalike WITHOUT the verified
    ///   seal — precisely what D1-008 forbids ("the platform never flags a lookalike"). The absent seal must
    ///   remain the only difference a participant can observe.</description></item>
    ///   <item><description><b>Staff</b> (a live <c>staff</c>-kind session, resolved through the standing
    ///   <see cref="ICurrentStaffSessionAccessor"/> seam) → <see cref="StaffPersonaResponseDto"/>, which adds
    ///   <c>personaType</c> for the controller console's persona picker / "POSTING AS" chip. A staff caller
    ///   is reading its own world's authoring data, the same justification <c>StaffPostDto</c> uses.</description></item>
    /// </list>
    /// <para>
    /// The branch FAILS CLOSED to the participant shape: no token, an expired/revoked token, a participant or
    /// shared read-only session all yield <c>null</c> from the accessor and therefore the narrow projection.
    /// Widening requires a live staff session bound to a <c>StaffUser</c>.
    /// </para>
    /// </remarks>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns><paramref name="endpoints"/>, for chaining.</returns>
    public static IEndpointRouteBuilder MapSocialPersonaEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/personas", async (
            IExerciseContext exerciseContext,
            ICurrentStaffSessionAccessor currentStaffSession,
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

            // Per-world projection, failing closed to the narrow participant shape (see the remarks above).
            var staffSession = await currentStaffSession.GetCurrentStaffSessionAsync(cancellationToken);
            if (staffSession is null)
            {
                return Results.Ok(await personaReadService.GetParticipantPersonasAsync(cancellationToken));
            }

            return Results.Ok(await personaReadService.GetStaffPersonasAsync(cancellationToken));
        });

        // profiles-social-graph/07: POST/DELETE /api/personas/{id}/follow and the two directed reads. Mapped
        // from here because they are routes ON the persona resource and this Map* is already reached from the
        // orchestrator-owned Program.cs — a slice whose wiring is never executed is dead at 404 (#310→#317).
        endpoints.MapSocialFollowEndpoints();

        // profiles-social-graph/08: GET /api/personas/suggestions, mapped from here for the same reason — a
        // literal segment on the persona resource, reached through wiring Program.cs already executes.
        endpoints.MapSocialSuggestionEndpoints();

        return endpoints;
    }
}

/// <summary>
/// The renderable PARTICIPANT-facing <c>Persona</c> shape — satisfies the frontend's <c>isValidPersona</c>
/// guard (<c>id</c>, <c>displayName</c>, <c>handle</c>, <c>kind ∈ {human,org}</c>, <c>verified: boolean</c>)
/// and carries every field a participant surface renders. XC-002: it structurally cannot carry an
/// operator/session/attribution field — and, since <c>profiles-social-graph/06</c>, it structurally cannot
/// carry <c>personaType</c> either (see the remarks).
/// </summary>
/// <remarks>
/// <para>
/// <b>Persisted, not stand-in (profiles-social-graph/06).</b> <c>bio</c>, <c>audienceBand</c>,
/// <c>followerCount</c>, and <c>joinedAt</c> are projected from the REAL <see cref="Persona"/> columns
/// (COR-020/COR-021/SOC-054) — the B1 stand-in constants (<c>"citizen"</c>, <c>"micro"</c>, <c>0</c>, a fixed
/// <c>2026-01-01</c> instant) and the blanket <c>bio</c> omission are gone. Two fields remain genuinely
/// DERIVED rather than persisted, by design of the frozen contract:
/// </para>
/// <list type="bullet">
///   <item><description><c>avatarColor</c> — derived deterministically from <c>handle</c> (stable across
///   reads/reloads) via <see cref="PersonaDerivedPresentation.AvatarColorForHandle"/>; no column stores it.</description></item>
///   <item><description><c>initials</c> — derived from <c>displayName</c> via
///   <see cref="PersonaDerivedPresentation.InitialsForDisplayName"/>; no column stores it.</description></item>
/// </list>
/// <para>
/// <b>No <c>personaType</c> — SOC-052 / D1-008.</b> The archetype labels exactly one seeded account
/// <c>bad-actor</c>. Emitting it here would give a participant client a machine-readable way to flag the
/// impersonation lookalike WITHOUT the verified seal, which is exactly what "the platform never flags a
/// lookalike" forbids. The omission is structural (there is no property to populate), not a runtime
/// filter, so a future edit cannot reintroduce the tell by accident. Staff callers read
/// <see cref="StaffPersonaResponseDto"/> instead. <see cref="Persona.Castable"/> is likewise never projected,
/// for the same reason.
/// </para>
/// <para>
/// <c>bio</c> is optional in the frozen contract, so a persona with no authored bio OMITS the key entirely
/// rather than emitting <c>null</c>. <c>joinedAt</c> is the persisted SCENARIO instant (COR-053) — never
/// re-derived from the server clock — emitted in the frontend mock's own
/// <c>toISOString()</c> format so the mock→live flip changes no rendered dateline. <c>followerCount</c> is
/// the persisted SOC-054 magnitude alone; <c>profiles-social-graph/05</c>'s <c>magnitude + real follow
/// edges</c> composition is a later read-time change, not something this projection anticipates.
/// </para>
/// </remarks>
public sealed class PersonaResponseDto
{
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

    /// <inheritdoc cref="Data.Entities.Persona.Verified" />
    [JsonPropertyName("verified")]
    public required bool Verified { get; init; }

    /// <summary>
    /// DERIVED (never persisted) deterministically from <see cref="Handle"/> — see the type-level remarks.
    /// </summary>
    [JsonPropertyName("avatarColor")]
    public required string AvatarColor { get; init; }

    /// <summary>
    /// DERIVED (never persisted) deterministically from <see cref="DisplayName"/> — see the type-level remarks.
    /// </summary>
    [JsonPropertyName("initials")]
    public required string Initials { get; init; }

    /// <summary>
    /// The persisted profile bio (<see cref="Data.Entities.Persona.Bio"/>). Optional in the frozen contract:
    /// when the persona has no bio the key is OMITTED from the payload entirely, never emitted as
    /// <c>null</c>.
    /// </summary>
    [JsonPropertyName("bio")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Bio { get; init; }

    /// <inheritdoc cref="Data.Entities.Persona.AudienceBand" />
    [JsonPropertyName("audienceBand")]
    public required string AudienceBand { get; init; }

    /// <summary>
    /// The DISPLAYED follower count (SOC-054, <c>profiles-social-graph/05</c>): the persisted
    /// <see cref="Data.Entities.Persona.AudienceMagnitude"/> PLUS the real inbound <c>Follow</c> edges in this
    /// exercise. The two populations are disjoint — magnitude is the simulated crowd that exists as a number,
    /// edges are the accounts that exist as rows — so the sum is the honest figure a profile renders.
    /// <see cref="AudienceMagnitude"/> carries the magnitude term on its own for
    /// <c>audienceReach()</c>, which takes magnitude and edges separately and must never be handed this
    /// composite as its <c>magnitude</c> input.
    /// </summary>
    [JsonPropertyName("followerCount")]
    public required int FollowerCount { get; init; }

    /// <summary>
    /// The persisted SOC-054 magnitude ALONE — the band-derived reach a persona carries independent of any
    /// real follow edge. Emitted separately from <see cref="FollowerCount"/> so the shared reach formula
    /// (<c>features/social/services/audience.ts</c>, imported by E8/ADP-004 and E10/EVL-012) can take
    /// <c>magnitude</c> and <c>edges = followerCount - audienceMagnitude</c> without double-counting the
    /// edges already folded into the displayed count.
    /// </summary>
    [JsonPropertyName("audienceMagnitude")]
    public required int AudienceMagnitude { get; init; }

    /// <summary>
    /// The number of accounts this persona follows — REAL outbound <c>Follow</c> edges only. The SOC-054
    /// magnitude is a follower-side construct and NEVER inflates a following count.
    /// </summary>
    [JsonPropertyName("followingCount")]
    public required int FollowingCount { get; init; }

    /// <summary>
    /// The persisted SCENARIO join instant (<see cref="Data.Entities.Persona.JoinedAt"/>) emitted round-trip
    /// ISO-8601 — the participant-visible time is scenario time only (COR-053), never re-derived from the
    /// server's wall clock.
    /// </summary>
    [JsonPropertyName("joinedAt")]
    public required string JoinedAt { get; init; }

    /// <summary>
    /// Projects a persisted <see cref="Data.Entities.Persona"/> instance to the participant-facing shape.
    /// Maps the participant-safe persisted fields (<c>bio</c>/<c>audienceBand</c>/<c>followerCount</c>/
    /// <c>joinedAt</c>) and derives <c>avatarColor</c>/<c>initials</c>. It MUST NOT read
    /// <see cref="Data.Entities.Persona.PersonaType"/> or <see cref="Data.Entities.Persona.Castable"/> — the
    /// same structural-omission discipline <c>ParticipantPostDto.FromPost</c> applies to provenance
    /// (XC-002), here protecting the SOC-052 trust signal (D1-008).
    /// </summary>
    /// <param name="persona">The full persona entity to project.</param>
    /// <param name="inboundFollowEdges">
    /// The persona's REAL inbound follow-edge count in the caller's exercise scope (<c>profiles-social-graph/07</c>),
    /// added to the magnitude for the displayed follower count. Defaults to zero — the honest value when the
    /// caller has no follow graph to compose against.
    /// </param>
    /// <param name="outboundFollowEdges">The persona's REAL outbound follow-edge count — the following count verbatim.</param>
    /// <returns>The participant-safe projection of <paramref name="persona"/>.</returns>
    public static PersonaResponseDto FromPersona(
        Data.Entities.Persona persona,
        int inboundFollowEdges = 0,
        int outboundFollowEdges = 0)
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
            Verified = persona.Verified,
            AvatarColor = PersonaDerivedPresentation.AvatarColorForHandle(persona.Handle),
            Initials = PersonaDerivedPresentation.InitialsForDisplayName(persona.DisplayName),
            Bio = persona.Bio,
            AudienceBand = persona.AudienceBand,
            FollowerCount = persona.AudienceMagnitude + inboundFollowEdges,
            AudienceMagnitude = persona.AudienceMagnitude,
            FollowingCount = outboundFollowEdges,
            JoinedAt = PersonaDerivedPresentation.ToScenarioIsoInstant(persona.JoinedAt),
        };
    }
}

/// <summary>
/// The STAFF-facing persona shape: every participant field plus <c>personaType</c>, the COR-020 archetype the
/// controller console's persona picker filters on and its "POSTING AS" chip labels. Served only to a caller
/// with a live <c>staff</c>-kind session (see <see cref="PersonaEndpoints.MapSocialPersonaEndpoints"/>) — the
/// same staff-reads-its-own-world justification <c>StaffPostDto</c> uses for retaining post provenance.
/// </summary>
/// <remarks>
/// Carries no operator/session/attribution field either (XC-002) and never
/// <see cref="Persona.Castable"/> — this type widens the participant shape by exactly ONE authoring field,
/// deliberately, and nothing else.
/// </remarks>
public sealed class StaffPersonaResponseDto
{
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

    /// <inheritdoc cref="Data.Entities.Persona.PersonaType" />
    [JsonPropertyName("personaType")]
    public required string PersonaType { get; init; }

    /// <inheritdoc cref="Data.Entities.Persona.Verified" />
    [JsonPropertyName("verified")]
    public required bool Verified { get; init; }

    /// <summary>DERIVED (never persisted) deterministically from <see cref="Handle"/>.</summary>
    [JsonPropertyName("avatarColor")]
    public required string AvatarColor { get; init; }

    /// <summary>DERIVED (never persisted) deterministically from <see cref="DisplayName"/>.</summary>
    [JsonPropertyName("initials")]
    public required string Initials { get; init; }

    /// <summary>The persisted profile bio; omitted entirely when the persona has none (contract-optional).</summary>
    [JsonPropertyName("bio")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Bio { get; init; }

    /// <inheritdoc cref="Data.Entities.Persona.AudienceBand" />
    [JsonPropertyName("audienceBand")]
    public required string AudienceBand { get; init; }

    /// <summary>
    /// The DISPLAYED follower count — <see cref="Data.Entities.Persona.AudienceMagnitude"/> plus the real
    /// inbound follow edges, identical to the participant shape's figure (the follow graph is not staff-only
    /// data; only <c>personaType</c> widens this shape).
    /// </summary>
    [JsonPropertyName("followerCount")]
    public required int FollowerCount { get; init; }

    /// <inheritdoc cref="Data.Entities.Persona.AudienceMagnitude" />
    [JsonPropertyName("audienceMagnitude")]
    public required int AudienceMagnitude { get; init; }

    /// <summary>The number of accounts this persona follows — REAL outbound follow edges only.</summary>
    [JsonPropertyName("followingCount")]
    public required int FollowingCount { get; init; }

    /// <summary>The persisted SCENARIO join instant (COR-053), emitted in the frontend mock's ISO format.</summary>
    [JsonPropertyName("joinedAt")]
    public required string JoinedAt { get; init; }

    /// <summary>
    /// Projects a persisted <see cref="Data.Entities.Persona"/> to the staff shape — the participant fields
    /// plus the authoring archetype. Never projects <see cref="Data.Entities.Persona.Castable"/>.
    /// </summary>
    /// <param name="persona">The full persona entity to project.</param>
    /// <param name="inboundFollowEdges">The persona's REAL inbound follow-edge count in the caller's exercise scope.</param>
    /// <param name="outboundFollowEdges">The persona's REAL outbound follow-edge count.</param>
    /// <returns>The staff-facing projection of <paramref name="persona"/>.</returns>
    public static StaffPersonaResponseDto FromPersona(
        Data.Entities.Persona persona,
        int inboundFollowEdges = 0,
        int outboundFollowEdges = 0)
    {
        ArgumentNullException.ThrowIfNull(persona);

        return new StaffPersonaResponseDto
        {
            Id = persona.Id.ToString(),
            ExerciseId = persona.ExerciseId.ToString(),
            TemplateId = persona.PersonaTemplateId?.ToString() ?? string.Empty,
            DisplayName = persona.DisplayName,
            Handle = persona.Handle,
            Kind = persona.Kind,
            PersonaType = persona.PersonaType,
            Verified = persona.Verified,
            AvatarColor = PersonaDerivedPresentation.AvatarColorForHandle(persona.Handle),
            Initials = PersonaDerivedPresentation.InitialsForDisplayName(persona.DisplayName),
            Bio = persona.Bio,
            AudienceBand = persona.AudienceBand,
            FollowerCount = persona.AudienceMagnitude + inboundFollowEdges,
            AudienceMagnitude = persona.AudienceMagnitude,
            FollowingCount = outboundFollowEdges,
            JoinedAt = PersonaDerivedPresentation.ToScenarioIsoInstant(persona.JoinedAt),
        };
    }
}

/// <summary>
/// The persona presentation values that are DERIVED rather than persisted, shared by the participant and
/// staff projections so both worlds render an identical avatar/monogram for the same persona. Pure and
/// deterministic — no clock, no randomness, no storage.
/// </summary>
internal static class PersonaDerivedPresentation
{
    /// <summary>
    /// The avatar-color palette <see cref="AvatarColorForHandle"/> selects from deterministically. An
    /// arbitrary but fixed, readable set of hex swatches — not a design-approved brand palette (participant
    /// surfaces are per-exercise skinned; this is a placeholder).
    /// </summary>
    private static readonly string[] AvatarColorPalette =
    [
        "#4C6EF5", "#F76707", "#0CA678", "#E64980", "#7048E8", "#1098AD", "#F59F00", "#495057",
    ];

    /// <summary>
    /// Deterministically derives a stable avatar color from <paramref name="handle"/> — the same handle
    /// always yields the same swatch, across requests and reloads, without persisting anything. Stays
    /// DERIVED (not a persisted column) by design of the frozen contract.
    /// </summary>
    /// <param name="handle">The persona's handle.</param>
    /// <returns>A hex color string from <see cref="AvatarColorPalette"/>.</returns>
    internal static string AvatarColorForHandle(string handle)
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
    internal static string InitialsForDisplayName(string displayName)
    {
        var words = displayName.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var initials = words.Take(2).Where(w => w.Length > 0).Select(w => char.ToUpperInvariant(w[0]));
        return string.Concat(initials);
    }

    /// <summary>
    /// Formats a persisted SCENARIO instant (COR-053) exactly as the frontend mock's <c>toISOString()</c>
    /// does — UTC, millisecond precision, a literal <c>Z</c> — so flipping <c>USE_MOCK_DATA</c> off changes
    /// no rendered dateline and no <c>&lt;time datetime&gt;</c> attribute. Not <c>"O"</c>, whose 7-digit
    /// fraction and <c>+00:00</c> offset are a different string for the same instant.
    /// </summary>
    /// <param name="instant">The persisted scenario instant.</param>
    /// <returns>The ISO-8601 instant string, e.g. <c>2025-07-08T12:00:00.000Z</c>.</returns>
    internal static string ToScenarioIsoInstant(DateTimeOffset instant) =>
        instant.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
}
