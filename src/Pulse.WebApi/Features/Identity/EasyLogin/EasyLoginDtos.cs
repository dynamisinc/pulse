namespace Pulse.WebApi.Features.Identity.EasyLogin;

using System.Text.Json.Serialization;

// =====================================================================================================================
// THE FROZEN WIRE CONTRACT (docs/features/easy-login/implementation.md, "Frozen wire contract"), one C# type per
// TypeScript type, field for field. The frontend builds its mocks against that TypeScript; a change here is a contract
// change and is made in implementation.md FIRST (an orchestrator decision), never here alone.
//
// Rules every type below follows, pinned by EasyLoginDtoContractTests:
//   * every property carries an explicit camelCase [JsonPropertyName], so the wire shape does not depend on the host's
//     serializer configuration;
//   * an optional member is OMITTED when null ([JsonIgnore(WhenWritingNull)]), never written as null;
//   * instants are ISO-8601 round-trip strings ("O"), dates are "yyyy-MM-dd" strings, ids are strings;
//   * no request carries an exerciseId: the server scopes everything (COR-001);
//   * request bodies use nullable members, so a missing field is a validation 400, never a deserialization failure.
//
// LoginEnvelope (the POST /api/auth/join and /api/auth/word success body) is NOT redeclared here: it is exactly what
// POST /api/auth/login answers today, Accounts.ParticipantLoginResponseDto (built with ParticipantLoginResponseDto.From),
// and is reused rather than forked (reuse map).
// =====================================================================================================================

/// <summary>The <c>RosterLinkStatus</c> union: <c>'active' | 'revoked' | 'none'</c>.</summary>
public static class RosterLinkStatuses
{
    /// <summary>The account has a link that signs in.</summary>
    public const string Active = "active";

    /// <summary>The account's link was revoked.</summary>
    public const string Revoked = "revoked";

    /// <summary>The account has never had a link.</summary>
    public const string None = "none";
}

/// <summary>The <c>access</c> union on a roster entry: <c>'enabled' | 'disabled'</c>.</summary>
public static class RosterAccessStates
{
    /// <summary>The participant may sign in.</summary>
    public const string Enabled = "enabled";

    /// <summary>Staff disabled the participant (<c>Account.DisabledAt</c> set): every sign-in path refuses them.</summary>
    public const string Disabled = "disabled";
}

/// <summary>The <c>RosterRowStatus</c> union: <c>'created' | 'updated' | 'unchanged' | 'failed'</c>.</summary>
public static class RosterRowStatuses
{
    /// <summary>The row created a participant.</summary>
    public const string Created = "created";

    /// <summary>The row matched a participant and changed them.</summary>
    public const string Updated = "updated";

    /// <summary>The row matched a participant and changed nothing.</summary>
    public const string Unchanged = "unchanged";

    /// <summary>The row was refused and wrote nothing.</summary>
    public const string Failed = "failed";
}

/// <summary>The <c>RosterCardSkipReason</c> union: <c>'notFound' | 'noActiveLink' | 'disabled' | 'tokenUnrecoverable'</c>.</summary>
public static class RosterCardSkipReasons
{
    /// <summary>Unknown id, or an id from another exercise (indistinguishable by design).</summary>
    public const string NotFound = "notFound";

    /// <summary>The participant has no active link.</summary>
    public const string NoActiveLink = "noActiveLink";

    /// <summary>The participant is disabled.</summary>
    public const string Disabled = "disabled";

    /// <summary>The link's protected copy no longer decrypts (reissue it).</summary>
    public const string TokenUnrecoverable = "tokenUnrecoverable";
}

/// <summary>The per-participant <c>status</c> union on an email result: <c>'sent' | 'skipped' | 'failed'</c>.</summary>
public static class RosterEmailStatuses
{
    /// <summary>The email was accepted for delivery.</summary>
    public const string Sent = "sent";

    /// <summary>The participant was not emailed (see <c>reason</c>).</summary>
    public const string Skipped = "skipped";

    /// <summary>The send failed.</summary>
    public const string Failed = "failed";
}

// ---------------------------------------------------------------- roster (staff)

/// <summary>A participant's persona on the roster (<c>RosterPersonaDto</c>).</summary>
public sealed class RosterPersonaDto
{
    /// <summary>The persona id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The persona handle, stored without <c>@</c>.</summary>
    [JsonPropertyName("handle")]
    public required string Handle { get; init; }

    /// <summary>The persona display name.</summary>
    [JsonPropertyName("displayName")]
    public required string DisplayName { get; init; }

    /// <summary><c>'human' | 'org'</c>.</summary>
    [JsonPropertyName("kind")]
    public required string Kind { get; init; }

    /// <summary>True when this is the citizen persona the roster auto-created for the person.</summary>
    [JsonPropertyName("autoCreated")]
    public required bool AutoCreated { get; init; }
}

/// <summary>
/// A participant's personal-link state (<c>RosterLinkDto</c>). Build it with <see cref="RosterLinkDtoFactory"/>.
/// <see cref="JoinUrl"/> is a SECRET (a bearer credential): staff-only, never logged.
/// </summary>
public sealed class RosterLinkDto
{
    /// <summary>A <see cref="RosterLinkStatuses"/> value.</summary>
    [JsonPropertyName("status")]
    public required string Status { get; init; }

    /// <summary>When the current token was issued (ISO-8601); omitted when there is no link.</summary>
    [JsonPropertyName("issuedAt")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? IssuedAt { get; init; }

    /// <summary>When the link was revoked (ISO-8601); omitted unless revoked.</summary>
    [JsonPropertyName("revokedAt")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? RevokedAt { get; init; }

    /// <summary>When the link last signed someone in (ISO-8601); omitted if never.</summary>
    [JsonPropertyName("lastUsedAt")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? LastUsedAt { get; init; }

    /// <summary>How many sign-ins the link has served.</summary>
    [JsonPropertyName("useCount")]
    public required int UseCount { get; init; }

    /// <summary>SECRET. The join URL; only when the link is active and its token is recoverable.</summary>
    [JsonPropertyName("joinUrl")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? JoinUrl { get; init; }

    /// <summary><c>true</c> when the link is active but its stored token can no longer be decrypted; otherwise omitted.</summary>
    [JsonPropertyName("needsReissue")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? NeedsReissue { get; init; }
}

/// <summary>One participant on the roster (<c>RosterEntryDto</c>). Staff-only: it carries the email (XC-002).</summary>
public sealed class RosterEntryDto
{
    /// <summary>The account id (the <c>{id}</c> of every per-participant staff route).</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary><c>Account.DisplayName</c>.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>The agency; omitted when none.</summary>
    [JsonPropertyName("agency")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Agency { get; init; }

    /// <summary>The free-text job label (NOT an <c>ExerciseRole</c>); omitted when none.</summary>
    [JsonPropertyName("role")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Role { get; init; }

    /// <summary>Staff-only email; omitted when none. Never on any participant projection.</summary>
    [JsonPropertyName("email")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Email { get; init; }

    /// <summary><c>Account.Username</c>, the sign-in name.</summary>
    [JsonPropertyName("signInName")]
    public required string SignInName { get; init; }

    /// <summary><c>'participant' | 'pio'</c>.</summary>
    [JsonPropertyName("exerciseRole")]
    public required string ExerciseRole { get; init; }

    /// <summary>The persona; omitted when the account has none.</summary>
    [JsonPropertyName("persona")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public RosterPersonaDto? Persona { get; init; }

    /// <summary>The personal-link state.</summary>
    [JsonPropertyName("link")]
    public required RosterLinkDto Link { get; init; }

    /// <summary>A <see cref="RosterAccessStates"/> value.</summary>
    [JsonPropertyName("access")]
    public required string Access { get; init; }

    /// <summary>Sessions not revoked and still usable (access or refresh window open).</summary>
    [JsonPropertyName("liveSessions")]
    public required int LiveSessions { get; init; }

    /// <summary><c>Account.LastLoginAt</c> (ISO-8601); omitted if never.</summary>
    [JsonPropertyName("lastSignInAt")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? LastSignInAt { get; init; }

    /// <summary><c>Account.CreatedAt</c> (ISO-8601).</summary>
    [JsonPropertyName("createdAt")]
    public required string CreatedAt { get; init; }
}

/// <summary>The roster's feature switches (<c>RosterListDto.capabilities</c>).</summary>
public sealed class RosterCapabilitiesDto
{
    /// <summary>Whether emailing links is configured (story 13); <c>false</c> until it is.</summary>
    [JsonPropertyName("emailLinks")]
    public required bool EmailLinks { get; init; }
}

/// <summary>The <c>GET /api/staff/roster</c> body (<c>RosterListDto</c>).</summary>
public sealed class RosterListDto
{
    /// <summary>Every participant in the exercise, ordered by name.</summary>
    [JsonPropertyName("participants")]
    public required IReadOnlyList<RosterEntryDto> Participants { get; init; }

    /// <summary><c>false</c> when <c>Authentication:FrontendBaseUrl</c> is unset (no join URLs can be built).</summary>
    [JsonPropertyName("joinLinksAvailable")]
    public required bool JoinLinksAvailable { get; init; }

    /// <summary>Feature switches.</summary>
    [JsonPropertyName("capabilities")]
    public required RosterCapabilitiesDto Capabilities { get; init; }
}

/// <summary>
/// The <c>POST /api/staff/roster</c> body (<c>RosterRowWrite</c>), and the shape of one CSV row. Every member is
/// nullable so a missing field is a 400. No <c>exerciseId</c>.
/// </summary>
public sealed class RosterRowWrite
{
    /// <summary>Required, 1 to 256 characters, sanitized.</summary>
    [JsonPropertyName("name")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Name { get; init; }

    /// <summary>At most 128 characters.</summary>
    [JsonPropertyName("agency")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Agency { get; init; }

    /// <summary>Free-text job label, at most 128 characters.</summary>
    [JsonPropertyName("role")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Role { get; init; }

    /// <summary>At most 254 characters, simple address check.</summary>
    [JsonPropertyName("email")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Email { get; init; }

    /// <summary>An ORG persona handle in this exercise; a leading <c>@</c> is tolerated.</summary>
    [JsonPropertyName("personaHandle")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? PersonaHandle { get; init; }

    /// <summary><c>^[a-z0-9][a-z0-9._-]{2,31}$</c> after trim and lower-case.</summary>
    [JsonPropertyName("signInName")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SignInName { get; init; }
}

/// <summary>One row of an import report (<c>RosterImportRowDto</c>).</summary>
public sealed class RosterImportRowDto
{
    /// <summary>1-based data row (the header is not counted).</summary>
    [JsonPropertyName("rowNumber")]
    public required int RowNumber { get; init; }

    /// <summary>The row's name.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>The sign-in name the row resolved to, when known.</summary>
    [JsonPropertyName("signInName")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SignInName { get; init; }

    /// <summary>A <see cref="RosterRowStatuses"/> value.</summary>
    [JsonPropertyName("status")]
    public required string Status { get; init; }

    /// <summary>The persona the row ended up bound to; omitted when none.</summary>
    [JsonPropertyName("personaHandle")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? PersonaHandle { get; init; }

    /// <summary>Whether an auto citizen persona was created for this row.</summary>
    [JsonPropertyName("personaCreated")]
    public required bool PersonaCreated { get; init; }

    /// <summary>The reason when failed; what changed when updated.</summary>
    [JsonPropertyName("message")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Message { get; init; }
}

/// <summary>The <c>POST /api/staff/roster/import</c> body (<c>RosterImportResultDto</c>).</summary>
public sealed class RosterImportResultDto
{
    /// <summary>Whether this was a no-write preview.</summary>
    [JsonPropertyName("dryRun")]
    public required bool DryRun { get; init; }

    /// <summary>Data rows read.</summary>
    [JsonPropertyName("totalRows")]
    public required int TotalRows { get; init; }

    /// <summary>Rows that created a participant.</summary>
    [JsonPropertyName("createdCount")]
    public required int CreatedCount { get; init; }

    /// <summary>Rows that updated a participant.</summary>
    [JsonPropertyName("updatedCount")]
    public required int UpdatedCount { get; init; }

    /// <summary>Rows that changed nothing.</summary>
    [JsonPropertyName("unchangedCount")]
    public required int UnchangedCount { get; init; }

    /// <summary>Rows refused.</summary>
    [JsonPropertyName("failedCount")]
    public required int FailedCount { get; init; }

    /// <summary>One result per data row.</summary>
    [JsonPropertyName("rows")]
    public required IReadOnlyList<RosterImportRowDto> Rows { get; init; }
}

/// <summary>The body of the per-participant staff actions: reissue, revoke, disable, enable (<c>RosterActionResultDto</c>).</summary>
public sealed class RosterActionResultDto
{
    /// <summary>The account id.</summary>
    [JsonPropertyName("participantId")]
    public required string ParticipantId { get; init; }

    /// <summary>The link state after the action.</summary>
    [JsonPropertyName("link")]
    public required RosterLinkDto Link { get; init; }

    /// <summary>A <see cref="RosterAccessStates"/> value after the action.</summary>
    [JsonPropertyName("access")]
    public required string Access { get; init; }

    /// <summary>How many live sessions the action ended.</summary>
    [JsonPropertyName("sessionsEnded")]
    public required int SessionsEnded { get; init; }
}

// ---------------------------------------------------------------- cards (staff)

/// <summary>One printable card (<c>RosterCardDto</c>). <see cref="JoinUrl"/> is a SECRET.</summary>
public sealed class RosterCardDto
{
    /// <summary>The account id.</summary>
    [JsonPropertyName("participantId")]
    public required string ParticipantId { get; init; }

    /// <summary>The participant's name.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>The agency; omitted when none.</summary>
    [JsonPropertyName("agency")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Agency { get; init; }

    /// <summary>The job label; omitted when none.</summary>
    [JsonPropertyName("role")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Role { get; init; }

    /// <summary>The sign-in name.</summary>
    [JsonPropertyName("signInName")]
    public required string SignInName { get; init; }

    /// <summary>SECRET. The join URL.</summary>
    [JsonPropertyName("joinUrl")]
    public required string JoinUrl { get; init; }

    /// <summary><c>data:image/svg+xml;base64,…</c> encoding exactly <see cref="JoinUrl"/>.</summary>
    [JsonPropertyName("qrSvgDataUri")]
    public required string QrSvgDataUri { get; init; }
}

/// <summary>One participant who got no card (<c>RosterCardsDto.skipped[]</c>).</summary>
public sealed class RosterCardSkipDto
{
    /// <summary>The requested account id.</summary>
    [JsonPropertyName("participantId")]
    public required string ParticipantId { get; init; }

    /// <summary>A <see cref="RosterCardSkipReasons"/> value.</summary>
    [JsonPropertyName("reason")]
    public required string Reason { get; init; }
}

/// <summary>The <c>POST /api/staff/roster/cards</c> response body (<c>RosterCardsDto</c>; request shape EL-20).</summary>
public sealed class RosterCardsDto
{
    /// <summary>
    /// The participant-facing exercise name for the sheet header (exercise-build-golive/09, §8.4), or <c>null</c> when
    /// unset (the sheet then omits the line). Never the internal name. Unlike the file's other optional members this one
    /// is WRITTEN as <c>null</c>, never omitted: the frozen TypeScript is <c>exerciseName: string | null</c> (key always
    /// present), and the client's guard rejects a body without it.
    /// </summary>
    [JsonPropertyName("exerciseName")]
    [JsonIgnore(Condition = JsonIgnoreCondition.Never)]
    public required string? ExerciseName { get; init; }

    /// <summary>The cards, ordered by name.</summary>
    [JsonPropertyName("cards")]
    public required IReadOnlyList<RosterCardDto> Cards { get; init; }

    /// <summary>Requested or eligible participants who got no card, with the reason.</summary>
    [JsonPropertyName("skipped")]
    public required IReadOnlyList<RosterCardSkipDto> Skipped { get; init; }
}

// ---------------------------------------------------------------- day word (staff)

/// <summary>A word pre-set for a later date (<c>DayWordStatusDto.upcoming[]</c>); never the word itself.</summary>
public sealed class DayWordUpcomingDto
{
    /// <summary>The date (<c>yyyy-MM-dd</c>).</summary>
    [JsonPropertyName("date")]
    public required string Date { get; init; }

    /// <summary>When the word was set (ISO-8601).</summary>
    [JsonPropertyName("setAt")]
    public required string SetAt { get; init; }
}

/// <summary>The <c>GET /api/staff/day-word</c> body (<c>DayWordStatusDto</c>). Never carries a word.</summary>
public sealed class DayWordStatusDto
{
    /// <summary>The exercise time zone (IANA).</summary>
    [JsonPropertyName("timeZone")]
    public required string TimeZone { get; init; }

    /// <summary>Today in that zone (<c>yyyy-MM-dd</c>).</summary>
    [JsonPropertyName("today")]
    public required string Today { get; init; }

    /// <summary>The next local rollover, as an instant (ISO-8601).</summary>
    [JsonPropertyName("todayEndsAt")]
    public required string TodayEndsAt { get; init; }

    /// <summary>Whether today's word is set.</summary>
    [JsonPropertyName("todaySet")]
    public required bool TodaySet { get; init; }

    /// <summary>When today's word was set (ISO-8601); omitted when not set.</summary>
    [JsonPropertyName("setAt")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SetAt { get; init; }

    /// <summary>Who set today's word (staff display name); omitted when not set or unknown.</summary>
    [JsonPropertyName("setByName")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SetByName { get; init; }

    /// <summary>Times today's word was replaced after it was first set.</summary>
    [JsonPropertyName("replacedCount")]
    public required int ReplacedCount { get; init; }

    /// <summary>Dates with words pre-set (never the words).</summary>
    [JsonPropertyName("upcoming")]
    public required IReadOnlyList<DayWordUpcomingDto> Upcoming { get; init; }
}

/// <summary>The <c>PUT /api/staff/day-word</c> body (<c>DayWordPutBody</c>). Both members optional.</summary>
public sealed class DayWordPutBody
{
    /// <summary>The word; omit to have the server generate one.</summary>
    [JsonPropertyName("word")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Word { get; init; }

    /// <summary>The date (<c>yyyy-MM-dd</c>): today (default) up to 14 days ahead, never the past.</summary>
    [JsonPropertyName("date")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Date { get; init; }
}

/// <summary>The <c>PUT /api/staff/day-word</c> response (<c>DayWordSetResultDto</c>). <see cref="Word"/> is a SECRET, returned once.</summary>
public sealed class DayWordSetResultDto
{
    /// <summary>The date the word is for (<c>yyyy-MM-dd</c>).</summary>
    [JsonPropertyName("date")]
    public required string Date { get; init; }

    /// <summary>SECRET. The plaintext word, returned this once and never stored or re-readable.</summary>
    [JsonPropertyName("word")]
    public required string Word { get; init; }

    /// <summary>Whether the server generated the word.</summary>
    [JsonPropertyName("generated")]
    public required bool Generated { get; init; }

    /// <summary>Whether this replaced a word already set for that date (a rotation).</summary>
    [JsonPropertyName("replaced")]
    public required bool Replaced { get; init; }

    /// <summary>When the word was set (ISO-8601).</summary>
    [JsonPropertyName("setAt")]
    public required string SetAt { get; init; }

    /// <summary>The rollover instant that ends that date (ISO-8601).</summary>
    [JsonPropertyName("validUntil")]
    public required string ValidUntil { get; init; }
}

// ---------------------------------------------------------------- email (staff, story 13 only)

/// <summary>The <c>POST /api/staff/roster/email-links</c> body: <c>{ participantIds?: string[] }</c> (none = all eligible, at most 100).</summary>
public sealed class RosterEmailLinksBody
{
    /// <summary>The account ids to email; omitted means every eligible participant.</summary>
    [JsonPropertyName("participantIds")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<string>? ParticipantIds { get; init; }
}

/// <summary>One participant's email outcome (<c>RosterEmailResultDto.results[]</c>).</summary>
public sealed class RosterEmailResultItemDto
{
    /// <summary>The account id.</summary>
    [JsonPropertyName("participantId")]
    public required string ParticipantId { get; init; }

    /// <summary>A <see cref="RosterEmailStatuses"/> value.</summary>
    [JsonPropertyName("status")]
    public required string Status { get; init; }

    /// <summary>Why it was skipped or failed; omitted when sent. Never an address or a URL.</summary>
    [JsonPropertyName("reason")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Reason { get; init; }
}

/// <summary>The <c>POST /api/staff/roster/email-links</c> response (<c>RosterEmailResultDto</c>).</summary>
public sealed class RosterEmailResultDto
{
    /// <summary>One outcome per participant considered.</summary>
    [JsonPropertyName("results")]
    public required IReadOnlyList<RosterEmailResultItemDto> Results { get; init; }
}

// ---------------------------------------------------------------- participant sign-in (anonymous)

/// <summary>The <c>POST /api/auth/join</c> body: <c>{ token }</c>. The token travels in the body, never in an API URL (EL-7).</summary>
public sealed class JoinRequestBody
{
    /// <summary>The raw link token from the SPA's <c>/join/:token</c> route. Never logged.</summary>
    [JsonPropertyName("token")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Token { get; init; }
}

/// <summary>The <c>POST /api/auth/word</c> body: <c>{ signInName, word }</c>.</summary>
public sealed class WordSignInRequestBody
{
    /// <summary>The participant's sign-in name (<c>Account.Username</c>).</summary>
    [JsonPropertyName("signInName")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SignInName { get; init; }

    /// <summary>The day word as typed. Never logged, never in telemetry.</summary>
    [JsonPropertyName("word")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Word { get; init; }
}
