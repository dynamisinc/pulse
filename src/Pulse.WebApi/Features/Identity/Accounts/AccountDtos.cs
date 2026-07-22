namespace Pulse.WebApi.Features.Identity.Accounts;

using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The <c>POST /api/auth/login</c> request body (camelCase JSON). Every scalar is nullable so a missing field is
/// a validation concern (a 400), never a deserialization failure. No <c>exerciseId</c> is accepted: the scope is
/// the HOST-resolved exercise (story 08), never client-supplied. The <see cref="Password"/> is never logged (NFR-009).
/// </summary>
public sealed class ParticipantLoginRequest
{
    /// <summary>The participant's login handle.</summary>
    [JsonPropertyName("username")]
    public string? Username { get; init; }

    /// <summary>The presented password — validated, never logged or persisted.</summary>
    [JsonPropertyName("password")]
    public string? Password { get; init; }
}

/// <summary>
/// The <c>POST /api/auth/login</c> success response: the raw session token/refresh material the story-03 issuer
/// minted (handed to the client exactly once — only the hashes are persisted, NFR-009) plus the frozen
/// <see cref="SessionDto"/> projection. Mirrors <c>StaffLoginResponseDto</c> field-for-field so the participant
/// login page consumes the same shape.
/// </summary>
public sealed class ParticipantLoginResponseDto
{
    /// <summary>The raw opaque session token to present on subsequent requests (only its hash is persisted).</summary>
    [JsonPropertyName("token")]
    public required string Token { get; init; }

    /// <summary>The raw refresh token, or omitted when the issued session has no refresh material.</summary>
    [JsonPropertyName("refreshToken")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? RefreshToken { get; init; }

    /// <summary>The issued session, projected to the frozen participant-safe wire shape (XC-002: no provenance).</summary>
    [JsonPropertyName("session")]
    public required SessionDto Session { get; init; }

    /// <summary>Builds the login response from the issuer's result.</summary>
    /// <param name="result">The <see cref="ISessionIssuer"/> result carrying the persisted session + raw token(s).</param>
    /// <returns>The login response DTO.</returns>
    public static ParticipantLoginResponseDto From(SessionIssueResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return new ParticipantLoginResponseDto
        {
            Token = result.SessionToken,
            RefreshToken = result.RefreshToken,
            Session = SessionDto.FromSession(result.Session),
        };
    }
}

/// <summary>
/// The <c>POST /api/staff/accounts</c> request body (individual create, camelCase JSON). Every scalar is nullable
/// so a missing field is a 400. No <c>exerciseId</c> is accepted — the account is stamped into the staff caller's
/// active exercise (from <c>IExerciseContext</c>), never a client-supplied id. <see cref="Password"/> is optional
/// (an account may be provisioned before its credential is delivered) and is never logged (NFR-009).
/// </summary>
public sealed class CreateAccountRequest
{
    /// <summary>The login handle (unique within the exercise).</summary>
    [JsonPropertyName("username")]
    public string? Username { get; init; }

    /// <summary>The display name shown on the staff console and participant surfaces (sanitized on ingest).</summary>
    [JsonPropertyName("displayName")]
    public string? DisplayName { get; init; }

    /// <summary>The participant-world role (participant or pio).</summary>
    [JsonPropertyName("role")]
    public string? Role { get; init; }

    /// <summary>The optional initial password; when present it is slow-KDF hashed, when absent the account has no credential yet.</summary>
    [JsonPropertyName("password")]
    public string? Password { get; init; }
}

/// <summary>
/// A STAFF-world projection of a provisioned <c>Account</c> (the create response + a per-row echo). This is a
/// staff surface — the caller reads its own write — so it may carry <c>exerciseId</c>/<c>createdAt</c>; it NEVER
/// carries the credential hash (NFR-009). Every property has an explicit camelCase <see cref="JsonPropertyNameAttribute"/>.
/// </summary>
public sealed class AccountDto
{
    /// <summary>The account id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The owning exercise (staff-world context — the caller's active exercise).</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>The login handle.</summary>
    [JsonPropertyName("username")]
    public required string Username { get; init; }

    /// <summary>The sanitized display name.</summary>
    [JsonPropertyName("displayName")]
    public required string DisplayName { get; init; }

    /// <summary>The participant-world role.</summary>
    [JsonPropertyName("role")]
    public required string Role { get; init; }

    /// <summary>Whether a login credential has been set for the account.</summary>
    [JsonPropertyName("hasCredential")]
    public required bool HasCredential { get; init; }

    /// <summary>Server wall-clock provisioning instant (ISO-8601 round-trip).</summary>
    [JsonPropertyName("createdAt")]
    public required string CreatedAt { get; init; }

    /// <summary>Projects a persisted <see cref="Account"/> to the staff-world response shape (never reads the credential hash beyond a presence flag).</summary>
    /// <param name="account">The account to project.</param>
    /// <returns>The staff-world account projection.</returns>
    public static AccountDto From(Account account)
    {
        ArgumentNullException.ThrowIfNull(account);

        return new AccountDto
        {
            Id = account.Id.ToString(),
            ExerciseId = account.ExerciseId.ToString(),
            Username = account.Username,
            DisplayName = account.DisplayName,
            Role = account.Role,
            HasCredential = !string.IsNullOrEmpty(account.CredentialHash),
            CreatedAt = account.CreatedAt.ToString("O"),
        };
    }
}

/// <summary>
/// The <c>POST /api/staff/accounts/import</c> response: an aggregate count plus a PER-ROW outcome (created /
/// failed-with-reason), so the staff import panel can render exactly which rows landed and why the rest did not.
/// </summary>
public sealed class AccountImportResultDto
{
    /// <summary>Total data rows parsed (excludes the header and blank lines).</summary>
    [JsonPropertyName("totalRows")]
    public required int TotalRows { get; init; }

    /// <summary>How many rows created a new account.</summary>
    [JsonPropertyName("createdCount")]
    public required int CreatedCount { get; init; }

    /// <summary>How many rows failed (validation error or duplicate).</summary>
    [JsonPropertyName("failedCount")]
    public required int FailedCount { get; init; }

    /// <summary>The per-row outcomes, in file order.</summary>
    [JsonPropertyName("rows")]
    public required IReadOnlyList<AccountImportRowResultDto> Rows { get; init; }
}

/// <summary>One row's import outcome — the row number, the (sanitized) handle it referred to, and status/reason.</summary>
public sealed class AccountImportRowResultDto
{
    /// <summary>1-based data-row index (matches the CSV, header not counted).</summary>
    [JsonPropertyName("rowNumber")]
    public required int RowNumber { get; init; }

    /// <summary>The row's handle (sanitized), echoed so staff can locate the row; empty when the row had no username.</summary>
    [JsonPropertyName("username")]
    public required string Username { get; init; }

    /// <summary>The outcome — <c>created</c> or <c>failed</c>.</summary>
    [JsonPropertyName("status")]
    public required string Status { get; init; }

    /// <summary>The failure reason when <see cref="Status"/> is <c>failed</c>; omitted for a created row.</summary>
    [JsonPropertyName("message")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Message { get; init; }
}
