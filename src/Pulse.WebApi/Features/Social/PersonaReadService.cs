namespace Pulse.WebApi.Features.Social;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

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

    /// <summary>Creates the service with the injected persistence context.</summary>
    /// <param name="dbContext">The scoped EF Core context (already bound to the request's exercise scope).</param>
    public PersonaReadService(PulseDbContext dbContext)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        _dbContext = dbContext;
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
        return personas.ConvertAll(PersonaResponseDto.FromPersona);
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
        return personas.ConvertAll(StaffPersonaResponseDto.FromPersona);
    }

    /// <summary>The one scoped entity read both projections share (central query filter only, COR-001).</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The in-scope persona entities.</returns>
    private Task<List<Persona>> ReadScopedAsync(CancellationToken cancellationToken) =>
        _dbContext.Personas
            .AsNoTracking()
            .ToListAsync(cancellationToken);
}
