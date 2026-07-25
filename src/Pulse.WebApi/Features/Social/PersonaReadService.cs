namespace Pulse.WebApi.Features.Social;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>
/// The read seam for exercise-scoped <see cref="Persona"/> instances (XC-005, COR-003) — the server-side
/// counterpart to the frontend's <c>resolvePersonas()</c>/<c>usePersonas()</c> (<c>personaService.ts</c>),
/// replacing <c>SEEDED_PERSONAS</c> as the production author source. Scope is inherited entirely from
/// <see cref="PulseDbContext"/>'s central read-side global query filter (COR-001) — this service never
/// applies or accepts its own <c>exerciseId</c> filter.
/// </summary>
public sealed class PersonaReadService
{
    private readonly PulseDbContext _dbContext;
    private readonly FollowService _followService;

    /// <summary>Creates the service with the injected persistence context and follow-graph read.</summary>
    /// <param name="dbContext">The scoped EF Core context (already bound to the request's exercise scope).</param>
    /// <param name="followService">
    /// The follow graph (<c>profiles-social-graph/07</c>) the displayed counts compose from. Reading it at
    /// persona-read time is the RECORDED response seam for the composed counts: <c>GET /api/personas</c> is
    /// already the one unconditional persona read every consumer resolves against, and
    /// <c>05-audience-magnitude</c>'s formula needs both figures wherever a profile renders — so composing
    /// here avoids the second, client-sequenced round trip a dedicated follow-summary endpoint would force.
    /// </param>
    public PersonaReadService(PulseDbContext dbContext, FollowService followService)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(followService);

        _dbContext = dbContext;
        _followService = followService;
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

        return personas.ConvertAll(persona => PersonaResponseDto.FromPersona(
            persona,
            edges.InboundFor(persona.Id),
            edges.OutboundFor(persona.Id)));
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

        return personas.ConvertAll(persona => StaffPersonaResponseDto.FromPersona(
            persona,
            edges.InboundFor(persona.Id),
            edges.OutboundFor(persona.Id)));
    }

    /// <summary>The one scoped entity read both projections share (central query filter only, COR-001).</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The in-scope persona entities.</returns>
    private Task<List<Persona>> ReadScopedAsync(CancellationToken cancellationToken) =>
        _dbContext.Personas
            .AsNoTracking()
            .ToListAsync(cancellationToken);
}
