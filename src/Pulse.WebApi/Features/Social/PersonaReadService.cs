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
    /// Reads every persona instance in the caller's resolved exercise scope, projected to the frozen
    /// participant-safe <see cref="PersonaResponseDto"/> shape. Relies entirely on <see cref="PulseDbContext"/>'s
    /// central query filter for isolation (COR-001) — an unresolved scope (<c>Guid.Empty</c>, per the
    /// context's fail-closed contract) yields an empty set here, but the endpoint itself refuses to even
    /// reach this call in that case (see <see cref="PersonaEndpoints"/>).
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Every persona instance in scope, in no particular guaranteed order.</returns>
    public async Task<IReadOnlyList<PersonaResponseDto>> GetPersonasAsync(CancellationToken cancellationToken)
    {
        var personas = await _dbContext.Personas
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        return personas.ConvertAll(PersonaResponseDto.FromPersona);
    }
}
