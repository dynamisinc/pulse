namespace Pulse.WebApi.Features.Social;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>
/// The read seam for exercise-scoped <see cref="Persona"/> instances (XC-005, COR-003) — the server-side
/// counterpart to the frontend's <c>resolvePersonas()</c>/<c>usePersonas()</c> (<c>personaService.ts</c>),
/// replacing <c>SEEDED_PERSONAS</c> as the production author source. Scope is inherited entirely from
/// <see cref="PulseDbContext"/>'s central read-side global query filter (COR-001) — this service never
/// applies or accepts its own <c>exerciseId</c> filter.
/// </summary>
/// <remarks>
/// <b>Profile images (demo-polish BP).</b> Each persona's avatar and banner (<see cref="Persona.AvatarMediaId"/>
/// / <see cref="Persona.BannerMediaId"/>) are signed into <c>avatarUrl</c> / <c>bannerUrl</c>: ONE scoped asset
/// lookup and ONE signer call per read, both skipped when no persona has an image. An image id that does not
/// resolve in scope yields no URL (DP-16: another exercise's asset is never signed).
/// </remarks>
public sealed class PersonaReadService
{
    private readonly PulseDbContext _dbContext;
    private readonly FollowService _followService;
    private readonly IMediaUrlSigner _mediaUrlSigner;

    /// <summary>Creates the service with the injected persistence context, follow-graph read and URL signer.</summary>
    /// <param name="dbContext">The scoped EF Core context (already bound to the request's exercise scope).</param>
    /// <param name="followService">
    /// The follow graph (<c>profiles-social-graph/07</c>) the displayed counts compose from. Reading it at
    /// persona-read time is the RECORDED response seam for the composed counts: <c>GET /api/personas</c> is
    /// already the one unconditional persona read every consumer resolves against, and
    /// <c>05-audience-magnitude</c>'s formula needs both figures wherever a profile renders — so composing
    /// here avoids the second, client-sequenced round trip a dedicated follow-summary endpoint would force.
    /// </param>
    /// <param name="mediaUrlSigner">Signs the avatar/banner read URLs (BM, or the unconfigured fallback).</param>
    public PersonaReadService(PulseDbContext dbContext, FollowService followService, IMediaUrlSigner mediaUrlSigner)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(followService);
        ArgumentNullException.ThrowIfNull(mediaUrlSigner);

        _dbContext = dbContext;
        _followService = followService;
        _mediaUrlSigner = mediaUrlSigner;
    }

    /// <summary>
    /// Reads every persona instance in the caller's resolved exercise scope, projected to the PARTICIPANT-safe
    /// <see cref="PersonaResponseDto"/> shape (no <c>personaType</c> — SOC-052/D1-008; see
    /// <see cref="PersonaEndpoints"/>). Relies entirely on <see cref="PulseDbContext"/>'s central query filter
    /// for isolation (COR-001) — an unresolved scope (<c>Guid.Empty</c>, per the context's fail-closed
    /// contract) yields an empty set here, but the endpoint itself refuses to even reach this call in that
    /// case.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Every persona instance in scope, in no particular guaranteed order.</returns>
    public async Task<IReadOnlyList<PersonaResponseDto>> GetParticipantPersonasAsync(CancellationToken cancellationToken)
    {
        var personas = await ReadScopedAsync(cancellationToken);
        var edges = await _followService.GetEdgeCountsAsync(cancellationToken);
        var urls = await SignProfileImagesAsync(personas, cancellationToken);

        return personas.ConvertAll(persona => PersonaResponseDto.FromPersona(
            persona,
            edges.InboundFor(persona.Id),
            edges.OutboundFor(persona.Id),
            UrlFor(persona.AvatarMediaId, urls),
            UrlFor(persona.BannerMediaId, urls)));
    }

    /// <summary>
    /// The same exercise-scoped read projected to the STAFF <see cref="StaffPersonaResponseDto"/> shape, which
    /// additionally carries the COR-020 archetype. The endpoint calls this ONLY for a caller with a live
    /// staff-kind session; isolation is identical (the central filter, COR-001) — the staff widening is about
    /// WHICH FIELDS are projected, never which exercise's rows are visible.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Every persona instance in scope, in no particular guaranteed order.</returns>
    public async Task<IReadOnlyList<StaffPersonaResponseDto>> GetStaffPersonasAsync(CancellationToken cancellationToken)
    {
        var personas = await ReadScopedAsync(cancellationToken);
        var edges = await _followService.GetEdgeCountsAsync(cancellationToken);
        var urls = await SignProfileImagesAsync(personas, cancellationToken);

        return personas.ConvertAll(persona => ToStaffDto(persona, edges, urls));
    }

    /// <summary>
    /// Reads ONE persona in the caller's resolved exercise scope, projected to the STAFF shape (with signed
    /// avatar/banner URLs) — the read-back the persona edit endpoint answers with. The lookup runs through the
    /// central query filter, so another exercise's persona is indistinguishable from an unknown id.
    /// </summary>
    /// <param name="personaId">The persona instance id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The staff projection, or <c>null</c> when no such persona is in scope.</returns>
    public async Task<StaffPersonaResponseDto?> GetStaffPersonaAsync(Guid personaId, CancellationToken cancellationToken)
    {
        var persona = await _dbContext.Personas
            .AsNoTracking()
            .FirstOrDefaultAsync(candidate => candidate.Id == personaId, cancellationToken);

        if (persona is null)
        {
            return null;
        }

        var edges = await _followService.GetEdgeCountsAsync(cancellationToken);
        var urls = await SignProfileImagesAsync([persona], cancellationToken);

        return ToStaffDto(persona, edges, urls);
    }

    private static StaffPersonaResponseDto ToStaffDto(
        Persona persona, FollowEdgeCounts edges, IReadOnlyDictionary<Guid, string> urls) =>
        StaffPersonaResponseDto.FromPersona(
            persona,
            edges.InboundFor(persona.Id),
            edges.OutboundFor(persona.Id),
            UrlFor(persona.AvatarMediaId, urls),
            UrlFor(persona.BannerMediaId, urls));

    private static string? UrlFor(Guid? mediaId, IReadOnlyDictionary<Guid, string> urls) =>
        mediaId is { } id ? urls.GetValueOrDefault(id) : null;

    /// <summary>
    /// Signs every avatar and banner on the page: one scoped asset query and one signer call, both skipped when
    /// no persona has an image (so a host with no media storage never reaches the signer).
    /// </summary>
    private async Task<IReadOnlyDictionary<Guid, string>> SignProfileImagesAsync(
        IReadOnlyCollection<Persona> personas, CancellationToken cancellationToken)
    {
        var mediaIds = personas
            .SelectMany(persona => new[] { persona.AvatarMediaId, persona.BannerMediaId })
            .OfType<Guid>()
            .Distinct()
            .ToArray();

        if (mediaIds.Length == 0)
        {
            return new Dictionary<Guid, string>();
        }

        var assets = await _dbContext.MediaAssets
            .AsNoTracking()
            .Where(asset => mediaIds.Contains(asset.Id))
            .ToListAsync(cancellationToken);

        if (assets.Count == 0)
        {
            return new Dictionary<Guid, string>();
        }

        return await _mediaUrlSigner.GetReadUrlsAsync(assets, cancellationToken);
    }

    /// <summary>The one scoped entity read both projections share (central query filter only, COR-001).</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The in-scope persona entities.</returns>
    private Task<List<Persona>> ReadScopedAsync(CancellationToken cancellationToken) =>
        _dbContext.Personas
            .AsNoTracking()
            .ToListAsync(cancellationToken);
}
