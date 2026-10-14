namespace Pulse.WebApi.Features.Identity.Roster;

using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Ops.EngineContentSeed;

/// <summary>
/// Builds the citizen persona the roster auto-creates for a participant who names no org persona (EL-4), so every
/// participant has a persona and therefore a composer. One place, so the row the roster writes is exactly the one the
/// decision describes.
/// </summary>
/// <remarks>
/// <para>
/// <b><see cref="Persona.Castable"/> is <c>false</c>, and that is load-bearing (EL-4).</b> A castable persona is one the
/// ENGINE may voice; an auto-created persona belongs to a real participant, so a castable one would let the engine
/// post under a real person's name (the hazard <c>scripts/uat/New-DemoParticipant.ps1</c> warns about). The column's
/// store default is <c>true</c> with <c>HasSentinel(true)</c>, so this explicit <c>false</c> is always written.
/// </para>
/// <para>
/// The rest is the least presumptive profile: <c>Kind = human</c>, <c>PersonaType = citizen</c>, not verified
/// (SOC-052: the seal is a trust signal a participant's own persona has not earned), <c>AudienceBand = nano</c> with the
/// magnitude derived from the handle exactly as the seeder derives it, no bio, no location, no images, and the default
/// pre-exercise scenario join instant (never the wall clock, COR-053). The display name is the participant's sanitized
/// name; the caller has already stripped markup from it (NFR-004).
/// </para>
/// </remarks>
public static class CitizenPersonaFactory
{
    /// <summary>The <c>PersonaKind</c> of an auto-created persona.</summary>
    public const string HumanKind = "human";

    /// <summary>The <c>PersonaKind</c> a bound persona must have (COR-018).</summary>
    public const string OrgKind = "org";

    /// <summary>The <c>PersonaType</c> of an auto-created persona.</summary>
    public const string CitizenType = "citizen";

    /// <summary>The <c>AudienceBand</c> of an auto-created persona.</summary>
    public const string NanoBand = "nano";

    /// <summary>Builds (does not persist) the auto-created citizen persona.</summary>
    /// <param name="personaId">The new persona's id (chosen by the caller so the account can reference it in the same unit of work).</param>
    /// <param name="exerciseId">The server-resolved exercise (<c>IExerciseContext</c>), never a request value.</param>
    /// <param name="displayName">The participant's sanitized name.</param>
    /// <param name="handle">The derived, collision-free handle (<see cref="PersonaHandleDeriver"/>).</param>
    /// <returns>The persona row to add.</returns>
    public static Persona Create(Guid personaId, Guid exerciseId, string displayName, string handle)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(displayName);
        ArgumentException.ThrowIfNullOrWhiteSpace(handle);

        if (personaId == Guid.Empty)
        {
            throw new ArgumentException("A persona needs a non-empty id.", nameof(personaId));
        }

        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("A persona must be stamped with a resolved exercise.", nameof(exerciseId));
        }

        return new Persona
        {
            Id = personaId,
            ExerciseId = exerciseId,
            DisplayName = displayName,
            Handle = handle,
            Kind = HumanKind,
            PersonaType = CitizenType,
            Verified = false,
            AudienceBand = NanoBand,
            AudienceMagnitude = PersonaCastSeeder.DeriveAudienceMagnitude(NanoBand, handle),
            Castable = false,
            Bio = null,
        };
    }
}
