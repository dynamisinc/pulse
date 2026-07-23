namespace Pulse.WebApi.Features.Ops.Bootstrap;

using System.Text.Json.Serialization;

/// <summary>
/// The <c>POST /api/ops/bootstrap-exercise</c> request body (camelCase JSON, story login/05). Every scalar is
/// nullable so a missing required field is a validation concern (a 400), never a deserialization failure. The
/// three optional sub-requests (<see cref="Staff"/>, <see cref="SharedCredential"/>, <see cref="ParticipantAccount"/>)
/// are each skipped when absent. No <c>exerciseId</c> is accepted anywhere — this endpoint CREATES an exercise
/// (identified by <see cref="Hostname"/>) and stamps every child row with that exercise's OWN id (COR-001); it
/// never attaches data to an arbitrary existing exercise by a client-supplied id.
/// </summary>
public sealed class BootstrapExerciseRequest
{
    /// <summary>
    /// The per-exercise host (COR-008, e.g. <c>pulse-uat.cobrasoftware.com</c>) the exercise is bound to, so
    /// <c>ExerciseResolutionMiddleware</c> can later resolve it. Required; format-validated + lower-cased by the
    /// same host normalizer the resolution path uses. The idempotency key: a hostname that already resolves to an
    /// exercise reuses it rather than creating a duplicate.
    /// </summary>
    [JsonPropertyName("hostname")]
    public string? Hostname { get; init; }

    /// <summary>
    /// The staff-facing exercise name. Required only when the exercise does not yet exist (an idempotent re-run
    /// against an already-bootstrapped hostname ignores it and never clobbers the stored name). Sanitized on
    /// ingest by the same account-import path (NFR-004).
    /// </summary>
    [JsonPropertyName("exerciseName")]
    public string? ExerciseName { get; init; }

    /// <summary>The exercise's IANA time zone (XC-008). Optional; defaults to <c>UTC</c> when absent/blank.</summary>
    [JsonPropertyName("timeZone")]
    public string? TimeZone { get; init; }

    /// <summary>Optional: an allowlisted staff identity + role to assign to the bootstrapped exercise.</summary>
    [JsonPropertyName("staff")]
    public BootstrapStaffRequest? Staff { get; init; }

    /// <summary>Optional: whether to provision the exercise's first shared view-only credential.</summary>
    [JsonPropertyName("sharedCredential")]
    public BootstrapSharedCredentialRequest? SharedCredential { get; init; }

    /// <summary>Optional: one participant account to provision so a fresh environment has a working login.</summary>
    [JsonPropertyName("participantAccount")]
    public BootstrapParticipantAccountRequest? ParticipantAccount { get; init; }
}

/// <summary>
/// The optional staff sub-request. The <see cref="Username"/> is matched (case-insensitively) against the
/// configured <c>DynamisIdentityProviderOptions</c> allowlist to resolve the external subject a <c>StaffUser</c>
/// is provisioned from; the <see cref="Role"/> is the per-exercise <c>StaffAssignment</c> role.
/// </summary>
public sealed class BootstrapStaffRequest
{
    /// <summary>The allowlisted staff login handle to provision + assign.</summary>
    [JsonPropertyName("username")]
    public string? Username { get; init; }

    /// <summary>The staff role for the assignment (<c>controller</c> / <c>evaluator</c> / <c>planner</c>).</summary>
    [JsonPropertyName("role")]
    public string? Role { get; init; }
}

/// <summary>The optional shared-credential sub-request — presence (with <see cref="Enabled"/> not explicitly false) requests provisioning.</summary>
public sealed class BootstrapSharedCredentialRequest
{
    /// <summary>
    /// Whether to enable the shared credential. Treated as <c>true</c> when omitted (the object's presence is the
    /// request); an explicit <c>false</c> skips provisioning.
    /// </summary>
    [JsonPropertyName("enabled")]
    public bool? Enabled { get; init; }
}

/// <summary>
/// The optional participant-account sub-request. All free text goes through the SAME account-import
/// sanitization/validation (NFR-004); the <see cref="Password"/> is optional and never logged (NFR-009).
/// </summary>
public sealed class BootstrapParticipantAccountRequest
{
    /// <summary>The login handle (unique within the exercise).</summary>
    [JsonPropertyName("username")]
    public string? Username { get; init; }

    /// <summary>The display name (sanitized on ingest).</summary>
    [JsonPropertyName("displayName")]
    public string? DisplayName { get; init; }

    /// <summary>The participant-world role (<c>participant</c> or <c>pio</c>).</summary>
    [JsonPropertyName("role")]
    public string? Role { get; init; }

    /// <summary>The optional initial password; slow-KDF hashed when present, never persisted in the clear.</summary>
    [JsonPropertyName("password")]
    public string? Password { get; init; }
}

/// <summary>
/// The <c>POST /api/ops/bootstrap-exercise</c> success response (story login/05). An OPS/staff-world response
/// (there is no participant surface here), so it may carry ids and per-section created/reused flags. Every
/// property has an explicit camelCase <see cref="JsonPropertyNameAttribute"/>. The one-time shared-credential
/// plaintext (<see cref="BootstrapSharedCredentialResponseDto.Password"/>) is present ONLY when the credential was
/// created on this call — the same "hand it back once, only the hash persists" contract the rotate endpoint uses.
/// </summary>
public sealed class BootstrapExerciseResponseDto
{
    /// <summary>The bootstrapped (created or pre-existing) exercise id.</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>The host the exercise is bound to (normalized/lower-cased).</summary>
    [JsonPropertyName("hostname")]
    public required string Hostname { get; init; }

    /// <summary><c>true</c> when this call created the exercise; <c>false</c> on an idempotent re-run.</summary>
    [JsonPropertyName("exerciseCreated")]
    public required bool ExerciseCreated { get; init; }

    /// <summary>The staff assignment result, present only when a staff sub-request was included.</summary>
    [JsonPropertyName("staffAssignment")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public BootstrapStaffAssignmentResponseDto? StaffAssignment { get; init; }

    /// <summary>The shared-credential result, present only when a shared-credential sub-request was included.</summary>
    [JsonPropertyName("sharedCredential")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public BootstrapSharedCredentialResponseDto? SharedCredential { get; init; }

    /// <summary>The participant-account result, present only when a participant-account sub-request was included.</summary>
    [JsonPropertyName("participantAccount")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public BootstrapParticipantAccountResponseDto? ParticipantAccount { get; init; }

    /// <summary>Builds the response from the service result (must be a provisioned outcome).</summary>
    /// <param name="result">The bootstrap result.</param>
    /// <returns>The response DTO.</returns>
    public static BootstrapExerciseResponseDto From(BootstrapResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return new BootstrapExerciseResponseDto
        {
            ExerciseId = (result.ExerciseId ?? throw new InvalidOperationException(
                "A provisioned bootstrap result must carry an exercise id.")).ToString(),
            Hostname = result.Hostname ?? throw new InvalidOperationException(
                "A provisioned bootstrap result must carry a hostname."),
            ExerciseCreated = result.ExerciseCreated,
            StaffAssignment = result.Staff is { } staff
                ? new BootstrapStaffAssignmentResponseDto
                {
                    StaffUserId = staff.StaffUserId.ToString(),
                    Role = staff.Role,
                    Created = staff.Created,
                }
                : null,
            SharedCredential = result.SharedCredential is { } shared
                ? new BootstrapSharedCredentialResponseDto
                {
                    Created = shared.Created,
                    Password = shared.Password,
                }
                : null,
            ParticipantAccount = result.ParticipantAccount is { } account
                ? new BootstrapParticipantAccountResponseDto
                {
                    AccountId = account.AccountId.ToString(),
                    Username = account.Username,
                    Created = account.Created,
                }
                : null,
        };
    }
}

/// <summary>The staff-assignment section of the bootstrap response.</summary>
public sealed class BootstrapStaffAssignmentResponseDto
{
    /// <summary>The (created or reused) <c>StaffUser</c> id — unblocks staff login for the allowlisted identity.</summary>
    [JsonPropertyName("staffUserId")]
    public required string StaffUserId { get; init; }

    /// <summary>The assigned per-exercise role.</summary>
    [JsonPropertyName("role")]
    public required string Role { get; init; }

    /// <summary><c>true</c> when this call created the assignment; <c>false</c> when it already existed.</summary>
    [JsonPropertyName("created")]
    public required bool Created { get; init; }
}

/// <summary>The shared-credential section of the bootstrap response.</summary>
public sealed class BootstrapSharedCredentialResponseDto
{
    /// <summary><c>true</c> when this call created the credential; <c>false</c> when one already existed (never clobbered).</summary>
    [JsonPropertyName("created")]
    public required bool Created { get; init; }

    /// <summary>
    /// The fresh plaintext shared password — present ONLY when the credential was created on this call (shown
    /// exactly once, never persisted in the clear, NFR-009). Omitted on an idempotent re-run.
    /// </summary>
    [JsonPropertyName("password")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Password { get; init; }
}

/// <summary>The participant-account section of the bootstrap response.</summary>
public sealed class BootstrapParticipantAccountResponseDto
{
    /// <summary>The (created or reused) account id.</summary>
    [JsonPropertyName("accountId")]
    public required string AccountId { get; init; }

    /// <summary>The account login handle.</summary>
    [JsonPropertyName("username")]
    public required string Username { get; init; }

    /// <summary><c>true</c> when this call created the account; <c>false</c> when it already existed.</summary>
    [JsonPropertyName("created")]
    public required bool Created { get; init; }
}
