namespace Pulse.WebApi.Features.Ops.Bootstrap;

using System.Text.Json.Serialization;

/// <summary>
/// The <c>POST /api/ops/bind-participant-persona</c> request body (camelCase JSON, story identity-auth-roles/10). Every scalar
/// is nullable so a missing required field is a validation concern (a 400), never a deserialization failure. No
/// <c>exerciseId</c> is accepted — the target exercise is resolved by <see cref="Hostname"/> (never created), and
/// both the account and the persona are looked up WITHIN that exercise only (COR-001); this endpoint never
/// attaches an arbitrary exercise's persona to an account by a client-supplied id.
/// </summary>
public sealed class BindParticipantPersonaRequest
{
    /// <summary>
    /// The per-exercise host (COR-008, e.g. <c>pulse-uat.cobrasoftware.com</c>) the already-bootstrapped exercise
    /// is bound to. Required; format-validated + lower-cased by the same host normalizer the resolution path
    /// uses. A host that resolves to no exercise returns 404 without creating one.
    /// </summary>
    [JsonPropertyName("hostname")]
    public string? Hostname { get; init; }

    /// <summary>
    /// The login handle of the EXISTING participant account to bind. Required; normalized/sanitized by the same
    /// account-field rules the account was provisioned through, so the stored handle round-trips. A handle that
    /// does not exist in the resolved exercise returns 404 (this endpoint never creates an account).
    /// </summary>
    [JsonPropertyName("username")]
    public string? Username { get; init; }

    /// <summary>
    /// The handle of the persona to bind (e.g. <c>FairhavenWater</c> or <c>@mvega_fh</c> — a leading <c>@</c> is
    /// normalized away, matching is case-insensitive). The PREFERRED identifier, on ERGONOMICS: a handle is
    /// stable across re-seeds and knowable up front from <c>PersonaCastSeeder.Catalog</c>, so it can be written
    /// into a runbook, whereas a persona id is environment-specific and must be looked up per environment.
    /// (An earlier draft of this comment claimed <c>GET /api/personas</c> requires an authenticated session and
    /// that an id was therefore unobtainable. That was WRONG — it gates only on a host-resolved exercise scope
    /// and returns ids to an unauthenticated caller, which is itself the subject of issue #359. The handle
    /// preference stands on its own merits; the false premise is removed rather than left as reasoning a
    /// future reader would trust.) Either this or <see cref="PersonaId"/> is required.
    /// </summary>
    [JsonPropertyName("personaHandle")]
    public string? PersonaHandle { get; init; }

    /// <summary>
    /// The persona instance id to bind, as an alternative to <see cref="PersonaHandle"/>. When both are supplied
    /// the id wins and the handle must agree (a mismatch is a 400, never a silent ignore).
    /// </summary>
    [JsonPropertyName("personaId")]
    public string? PersonaId { get; init; }
}

/// <summary>
/// The <c>POST /api/ops/bind-participant-persona</c> success response (story identity-auth-roles/10). An OPS/staff-world
/// response (no participant surface here), so it may carry ids. Every property has an explicit camelCase
/// <see cref="JsonPropertyNameAttribute"/>. <see cref="Changed"/> distinguishes a real rebind from the idempotent
/// no-op (the account was already bound to this persona) — both are a 200.
/// </summary>
public sealed class BindParticipantPersonaResponseDto
{
    /// <summary>The resolved (never created) exercise id both the account and the persona belong to.</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>The host the exercise is bound to (normalized/lower-cased).</summary>
    [JsonPropertyName("hostname")]
    public required string Hostname { get; init; }

    /// <summary>The bound account's id.</summary>
    [JsonPropertyName("accountId")]
    public required string AccountId { get; init; }

    /// <summary>The bound account's stored login handle.</summary>
    [JsonPropertyName("username")]
    public required string Username { get; init; }

    /// <summary>The persona now bound to the account — the value that becomes <c>Session.personaId</c> on login.</summary>
    [JsonPropertyName("personaId")]
    public required string PersonaId { get; init; }

    /// <summary>The bound persona's stored handle, echoed so an operator can confirm which cast member matched.</summary>
    [JsonPropertyName("personaHandle")]
    public required string PersonaHandle { get; init; }

    /// <summary>
    /// The binding this call REPLACED, or omitted when the account had none. Present so an operator can see that
    /// a rebind moved the account off a previous persona.
    /// </summary>
    [JsonPropertyName("previousPersonaId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? PreviousPersonaId { get; init; }

    /// <summary>
    /// <c>true</c> when this call actually changed the binding; <c>false</c> on the idempotent no-op (the account
    /// was already bound to this persona) — still a 200, and still audited (XC-004).
    /// </summary>
    [JsonPropertyName("changed")]
    public required bool Changed { get; init; }

    /// <summary>Builds the response from a bound service result.</summary>
    /// <param name="result">The binding result (must be a bound outcome).</param>
    /// <returns>The response DTO.</returns>
    public static BindParticipantPersonaResponseDto From(ParticipantPersonaBindingResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return new BindParticipantPersonaResponseDto
        {
            ExerciseId = (result.ExerciseId ?? throw new InvalidOperationException(
                "A bound persona-binding result must carry an exercise id.")).ToString(),
            Hostname = result.Hostname ?? throw new InvalidOperationException(
                "A bound persona-binding result must carry a hostname."),
            AccountId = (result.AccountId ?? throw new InvalidOperationException(
                "A bound persona-binding result must carry an account id.")).ToString(),
            Username = result.Username ?? throw new InvalidOperationException(
                "A bound persona-binding result must carry a username."),
            PersonaId = (result.PersonaId ?? throw new InvalidOperationException(
                "A bound persona-binding result must carry a persona id.")).ToString(),
            PersonaHandle = result.PersonaHandle ?? throw new InvalidOperationException(
                "A bound persona-binding result must carry a persona handle."),
            PreviousPersonaId = result.PreviousPersonaId?.ToString(),
            Changed = result.Changed,
        };
    }
}
