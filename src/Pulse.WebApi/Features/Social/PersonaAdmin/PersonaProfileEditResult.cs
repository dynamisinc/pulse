namespace Pulse.WebApi.Features.Social.PersonaAdmin;

/// <summary>What a persona profile edit did. <see cref="PersonaAdminEndpoints"/> maps each value to an HTTP status.</summary>
public enum PersonaProfileEditOutcome
{
    /// <summary>The patch was applied (or was empty) and the persona was read back. 200.</summary>
    Updated,

    /// <summary>
    /// A media id does not name an image in the caller's exercise. Nothing was written. 400, with the same text
    /// for an unknown id, another exercise's id and a non-image (DP-16).
    /// </summary>
    Invalid,

    /// <summary>
    /// No persona with that id exists in the caller's exercise. The answer is the same whether the id is unknown
    /// or belongs to another exercise (COR-001). Nothing was written. 404.
    /// </summary>
    NotFound,

    /// <summary>The request's exercise scope is unresolved. Fails closed; nothing was read or written. 401.</summary>
    ScopeUnresolved,
}

/// <summary>The result of <see cref="PersonaProfileEditService.EditAsync"/>.</summary>
/// <param name="Outcome">What the call did.</param>
/// <param name="Persona">The updated staff projection (signed avatar/banner URLs). Set only for <see cref="PersonaProfileEditOutcome.Updated"/>.</param>
/// <param name="Error">The 400 message. Set only for <see cref="PersonaProfileEditOutcome.Invalid"/>.</param>
public sealed record PersonaProfileEditResult(
    PersonaProfileEditOutcome Outcome,
    StaffPersonaResponseDto? Persona = null,
    string? Error = null)
{
    /// <summary>The patch was applied; <paramref name="persona"/> is the read-back.</summary>
    /// <param name="persona">The updated staff projection.</param>
    /// <returns>An <see cref="PersonaProfileEditOutcome.Updated"/> result.</returns>
    public static PersonaProfileEditResult Updated(StaffPersonaResponseDto persona) =>
        new(PersonaProfileEditOutcome.Updated, Persona: persona);

    /// <summary>A media id did not resolve to an in-scope image.</summary>
    /// <param name="error">The 400 message.</param>
    /// <returns>An <see cref="PersonaProfileEditOutcome.Invalid"/> result.</returns>
    public static PersonaProfileEditResult Invalid(string error) =>
        new(PersonaProfileEditOutcome.Invalid, Error: error);

    /// <summary>The persona id did not resolve in the caller's exercise.</summary>
    /// <returns>A <see cref="PersonaProfileEditOutcome.NotFound"/> result.</returns>
    public static PersonaProfileEditResult NotFound() => new(PersonaProfileEditOutcome.NotFound);

    /// <summary>The request has no resolved exercise scope.</summary>
    /// <returns>A <see cref="PersonaProfileEditOutcome.ScopeUnresolved"/> result.</returns>
    public static PersonaProfileEditResult ScopeUnresolved() => new(PersonaProfileEditOutcome.ScopeUnresolved);
}
