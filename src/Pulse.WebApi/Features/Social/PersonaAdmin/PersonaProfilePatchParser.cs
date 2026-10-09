namespace Pulse.WebApi.Features.Social.PersonaAdmin;

using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Text;
using System.Text.Json;

/// <summary>
/// Parses and validates the body of <c>PATCH /api/staff/personas/{personaId}</c> as a JSON merge-patch
/// (RFC 7396; demo-polish PE-BE, story 21 ACs "Merge-patch endpoint" and "Immutable fields are loud"). Pure and
/// static: no database, no scope, no clock.
/// </summary>
/// <remarks>
/// <para>
/// <b>Merge-patch semantics.</b> A field the body does not name is left unchanged. A field set to <c>null</c> is
/// cleared, which is allowed ONLY for <c>bio</c>, <c>location</c>, <c>avatarMediaId</c> and
/// <c>bannerMediaId</c>; <c>displayName</c> and <c>verified</c> cannot be null. An empty object is a valid
/// patch that changes nothing.
/// </para>
/// <para>
/// <b>Loud, never silent.</b> A body naming <c>handle</c>, <c>kind</c>, <c>personaType</c> or
/// <c>exerciseId</c> (matched case-insensitively), any other field outside the six editable ones (matched
/// exactly, camelCase), or any field twice, is refused with a 400. Field names are checked before any value, so
/// such a body is refused for its field name whatever else it contains. The exercise is never read from the
/// body (COR-001): <c>exerciseId</c> is simply one of the refused names.
/// </para>
/// <para>
/// <b>Text (NFR-004).</b> For <c>displayName</c>, <c>bio</c> and <c>location</c>, in order:
/// </para>
/// <list type="number">
///   <item><description>A raw value longer than <see cref="RawLengthFactor"/> times its bound is refused with the
///   field's length message BEFORE sanitizing, so the strip-until-stable sanitizer never works on an oversized
///   value (Gate-1 S-1).</description></item>
///   <item><description><see cref="PostSanitizer.Sanitize"/> (strip until stable, never encode), then trim.</description></item>
///   <item><description>C0/C1 control characters (<see cref="char.IsControl(char)"/>: U+0000–U+001F,
///   U+007F–U+009F) and the bidirectional embeddings, overrides and isolates (U+202A–U+202E, U+2066–U+2069) are
///   refused (Gate-1 S-2). The one exception: <c>bio</c> may contain line breaks and tabs, which a multi-line
///   profile bio legitimately uses.</description></item>
///   <item><description>The value is measured against its bound.</description></item>
///   <item><description><c>displayName</c> must contain at least one visible character: a name made only of
///   whitespace, zero-width / format characters, combining marks or the blank "filler" letters is refused. Ordinary
///   letters from any script count as visible, so a lookalike name built from Latin/Cyrillic homoglyphs stays
///   allowed (SOC-052 impersonation training).</description></item>
/// </list>
/// <para>
/// A <c>bio</c> or <c>location</c> that is empty after this is stored as <c>null</c> (the same as clearing it), so
/// the wire never carries an empty string for them.
/// </para>
/// <para>
/// <b>Media ids (DP-16).</b> Every malformed media id (not a string, not a GUID, the empty GUID) gets the same
/// message the service uses for an unknown, cross-exercise or non-image id, so no response can tell them apart.
/// </para>
/// </remarks>
public static class PersonaProfilePatchParser
{
    /// <summary>Wire name of the display-name field.</summary>
    public const string DisplayNameField = "displayName";

    /// <summary>Wire name of the bio field.</summary>
    public const string BioField = "bio";

    /// <summary>Wire name of the location field.</summary>
    public const string LocationField = "location";

    /// <summary>Wire name of the verified-mark field.</summary>
    public const string VerifiedField = "verified";

    /// <summary>Wire name of the avatar media-id field.</summary>
    public const string AvatarMediaIdField = "avatarMediaId";

    /// <summary>Wire name of the banner media-id field.</summary>
    public const string BannerMediaIdField = "bannerMediaId";

    /// <summary>
    /// A raw text value (or an echoed field name) longer than this many times its bound is refused (or cut)
    /// before it reaches the sanitizer. The sanitizer is linear now (one strip-until-stable pass), so this is a
    /// cheap defence-in-depth bound on work and memory rather than the only guard against a CPU blow-up.
    /// </summary>
    public const int RawLengthFactor = 4;

    /// <summary>The longest client-supplied field name echoed back in an error message.</summary>
    private const int MaxEchoedNameLength = 64;

    /// <summary>
    /// Letters and symbols that render as blank space although their Unicode category says otherwise — the usual
    /// way to fake an "empty" display name. Not a visible character for <c>displayName</c>.
    /// </summary>
    private static readonly HashSet<int> BlankGlyphs =
    [
        0x115F, // HANGUL CHOSEONG FILLER
        0x1160, // HANGUL JUNGSEONG FILLER
        0x3164, // HANGUL FILLER
        0xFFA0, // HALFWIDTH HANGUL FILLER
        0x2800, // BRAILLE PATTERN BLANK
    ];

    /// <summary>The <c>displayName</c> rules.</summary>
    private static readonly TextRules DisplayNameRules = new(
        PersonaProfilePatch.MaxDisplayNameLength,
        PersonaAdminMessages.DisplayNameLength,
        PersonaAdminMessages.DisplayNameForbiddenCharacter,
        AllowLineBreaks: false);

    /// <summary>The <c>bio</c> rules (line breaks and tabs allowed).</summary>
    private static readonly TextRules BioRules = new(
        PersonaProfilePatch.MaxBioLength,
        PersonaAdminMessages.BioLength,
        PersonaAdminMessages.BioForbiddenCharacter,
        AllowLineBreaks: true);

    /// <summary>The <c>location</c> rules.</summary>
    private static readonly TextRules LocationRules = new(
        PersonaProfilePatch.MaxLocationLength,
        PersonaAdminMessages.LocationLength,
        PersonaAdminMessages.LocationForbiddenCharacter,
        AllowLineBreaks: false);

    /// <summary>The six fields a patch may name, in their canonical order.</summary>
    public static IReadOnlyList<string> EditableFields { get; } =
    [
        DisplayNameField, BioField, LocationField, VerifiedField, AvatarMediaIdField, BannerMediaIdField,
    ];

    /// <summary>
    /// The persona fields that exist but can never be changed through this endpoint (story 21; plan §9: the
    /// engine matches personas on their handle). Matched case-insensitively.
    /// </summary>
    public static IReadOnlyList<string> ImmutableFields { get; } = ["handle", "kind", "personaType", "exerciseId"];

    /// <summary>
    /// Validates <paramref name="body"/> as a persona profile merge-patch.
    /// </summary>
    /// <param name="body">The parsed request body.</param>
    /// <param name="patch">The validated patch, when the body is valid.</param>
    /// <param name="error">The 400 message, when the body is invalid.</param>
    /// <returns><c>true</c> when the body is a valid patch; otherwise <c>false</c>.</returns>
    public static bool TryParse(
        JsonElement body,
        [NotNullWhen(true)] out PersonaProfilePatch? patch,
        [NotNullWhen(false)] out string? error)
    {
        patch = null;

        if (body.ValueKind != JsonValueKind.Object)
        {
            error = PersonaAdminMessages.BodyNotObject;
            return false;
        }

        // Pass 1: field NAMES only, so an immutable, unknown or repeated field is refused whatever the values say.
        error = CheckFieldNames(body);
        if (error is not null)
        {
            return false;
        }

        // Pass 2: values, in body order; the first invalid one is reported.
        var displayName = default(PatchField<string>);
        var bio = default(PatchField<string?>);
        var location = default(PatchField<string?>);
        var verified = default(PatchField<bool>);
        var avatar = default(PatchField<Guid?>);
        var banner = default(PatchField<Guid?>);

        foreach (var property in body.EnumerateObject())
        {
            error = property.Name switch
            {
                DisplayNameField => ParseDisplayName(property.Value, out displayName),
                BioField => ParseClearableText(property.Value, BioRules, PersonaAdminMessages.BioType, out bio),
                LocationField => ParseClearableText(property.Value, LocationRules, PersonaAdminMessages.LocationType, out location),
                VerifiedField => ParseVerified(property.Value, out verified),
                AvatarMediaIdField => ParseMediaId(property.Value, PersonaAdminMessages.AvatarMediaNotFound, out avatar),
                BannerMediaIdField => ParseMediaId(property.Value, PersonaAdminMessages.BannerMediaNotFound, out banner),

                // Unreachable: pass 1 admitted only the six editable names.
                _ => PersonaAdminMessages.UnknownField(property.Name),
            };

            if (error is not null)
            {
                return false;
            }
        }

        patch = new PersonaProfilePatch
        {
            DisplayName = displayName,
            Bio = bio,
            Location = location,
            Verified = verified,
            AvatarMediaId = avatar,
            BannerMediaId = banner,
        };
        return true;
    }

    /// <summary>
    /// Makes a client-supplied field name safe to echo in a message: cut to <see cref="RawLengthFactor"/> times the
    /// echo cap before sanitizing (bounded sanitizer work, Gate-1 S-1), markup stripped (NFR-004), then capped at 64
    /// UTF-16 units without ever splitting a surrogate pair (Gate-1 S-3). A cut name ends with <c>…</c>.
    /// </summary>
    /// <param name="name">The raw field name from the body.</param>
    /// <returns>The echo-safe name.</returns>
    internal static string EchoSafe(string name)
    {
        ArgumentNullException.ThrowIfNull(name);

        var preCap = MaxEchoedNameLength * RawLengthFactor;
        var cut = name.Length > preCap;
        var stripped = PostSanitizer.Sanitize(cut ? TruncateAtCharBoundary(name, preCap) : name);
        if (stripped.Length > MaxEchoedNameLength)
        {
            stripped = TruncateAtCharBoundary(stripped, MaxEchoedNameLength);
            cut = true;
        }

        return cut ? stripped + "…" : stripped;
    }

    /// <summary>
    /// The first <paramref name="maxLength"/> UTF-16 units of <paramref name="text"/>, one fewer when the cut would
    /// leave a high surrogate without its low half.
    /// </summary>
    /// <param name="text">The text.</param>
    /// <param name="maxLength">The cap (at least 1).</param>
    /// <returns>The cut text.</returns>
    internal static string TruncateAtCharBoundary(string text, int maxLength)
    {
        ArgumentNullException.ThrowIfNull(text);

        if (text.Length <= maxLength)
        {
            return text;
        }

        var end = char.IsHighSurrogate(text[maxLength - 1]) ? maxLength - 1 : maxLength;
        return text[..end];
    }

    private static string? CheckFieldNames(JsonElement body)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in body.EnumerateObject())
        {
            var immutable = ImmutableFields.FirstOrDefault(
                candidate => string.Equals(candidate, property.Name, StringComparison.OrdinalIgnoreCase));
            if (immutable is not null)
            {
                return PersonaAdminMessages.CannotBeChanged(immutable);
            }

            if (!EditableFields.Contains(property.Name, StringComparer.Ordinal))
            {
                return PersonaAdminMessages.UnknownField(property.Name);
            }

            if (!seen.Add(property.Name))
            {
                return PersonaAdminMessages.DuplicateField(property.Name);
            }
        }

        return null;
    }

    private static string? ParseDisplayName(JsonElement value, out PatchField<string> field)
    {
        field = default;
        switch (value.ValueKind)
        {
            case JsonValueKind.Null:
                return PersonaAdminMessages.DisplayNameNull;
            case JsonValueKind.String:
                var error = CleanText(value.GetString()!, DisplayNameRules, out var text);
                if (error is not null)
                {
                    return error;
                }

                if (text.Length == 0)
                {
                    return PersonaAdminMessages.DisplayNameLength;
                }

                if (!HasVisibleCharacter(text))
                {
                    return PersonaAdminMessages.DisplayNameInvisible;
                }

                field = new PatchField<string>(true, text);
                return null;
            default:
                return PersonaAdminMessages.DisplayNameType;
        }
    }

    private static string? ParseClearableText(
        JsonElement value, TextRules rules, string typeMessage, out PatchField<string?> field)
    {
        field = default;
        switch (value.ValueKind)
        {
            case JsonValueKind.Null:
                field = new PatchField<string?>(true, null);
                return null;
            case JsonValueKind.String:
                var error = CleanText(value.GetString()!, rules, out var text);
                if (error is not null)
                {
                    return error;
                }

                // Empty after sanitizing = no value: stored as NULL so the wire omits the key, never sends "".
                field = new PatchField<string?>(true, text.Length == 0 ? null : text);
                return null;
            default:
                return typeMessage;
        }
    }

    /// <summary>
    /// The shared text pipeline: raw-length pre-check, sanitize + trim, forbidden characters, bound. See the
    /// type-level remarks.
    /// </summary>
    /// <param name="raw">The raw string value.</param>
    /// <param name="rules">The field's rules.</param>
    /// <param name="text">The cleaned value (empty when refused).</param>
    /// <returns>The 400 message, or <c>null</c> when the value is acceptable.</returns>
    private static string? CleanText(string raw, TextRules rules, out string text)
    {
        text = string.Empty;

        // Gate-1 S-1: never hand the sanitizer an oversized value (defence in depth; the sanitizer itself is linear).
        if (raw.Length > rules.MaxLength * RawLengthFactor)
        {
            return rules.LengthMessage;
        }

        var cleaned = PostSanitizer.Sanitize(raw).Trim();
        if (ContainsForbiddenCharacter(cleaned, rules.AllowLineBreaks))
        {
            return rules.ForbiddenCharacterMessage;
        }

        if (cleaned.Length > rules.MaxLength)
        {
            return rules.LengthMessage;
        }

        text = cleaned;
        return null;
    }

    /// <summary>
    /// Whether <paramref name="text"/> holds a C0/C1 control character or a bidirectional embedding / override /
    /// isolate (U+202A–U+202E, U+2066–U+2069). With <paramref name="allowLineBreaks"/>, CR, LF and TAB are allowed.
    /// </summary>
    /// <param name="text">The sanitized text.</param>
    /// <param name="allowLineBreaks">Whether CR, LF and TAB are allowed (bio only).</param>
    /// <returns><c>true</c> when a forbidden character is present.</returns>
    private static bool ContainsForbiddenCharacter(string text, bool allowLineBreaks)
    {
        foreach (var c in text)
        {
            if (char.IsControl(c))
            {
                if (allowLineBreaks && c is ('\n' or '\r' or '\t'))
                {
                    continue;
                }

                return true;
            }

            if (c is (>= '\u202A' and <= '\u202E') or (>= '\u2066' and <= '\u2069'))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Whether <paramref name="text"/> has at least one character that renders as something: not whitespace or a
    /// separator, not a control or format (zero-width) character, not a combining mark on its own, not unassigned,
    /// and not one of the <see cref="BlankGlyphs"/>. Letters of every script count, so homoglyph lookalikes pass.
    /// </summary>
    /// <param name="text">The sanitized, trimmed display name.</param>
    /// <returns><c>true</c> when a visible character is present.</returns>
    private static bool HasVisibleCharacter(string text)
    {
        foreach (var rune in text.EnumerateRunes())
        {
            if (BlankGlyphs.Contains(rune.Value))
            {
                continue;
            }

            switch (Rune.GetUnicodeCategory(rune))
            {
                case UnicodeCategory.SpaceSeparator:
                case UnicodeCategory.LineSeparator:
                case UnicodeCategory.ParagraphSeparator:
                case UnicodeCategory.Control:
                case UnicodeCategory.Format:
                case UnicodeCategory.NonSpacingMark:
                case UnicodeCategory.SpacingCombiningMark:
                case UnicodeCategory.EnclosingMark:
                case UnicodeCategory.Surrogate:
                case UnicodeCategory.OtherNotAssigned:
                    continue;
                default:
                    return true;
            }
        }

        return false;
    }

    private static string? ParseVerified(JsonElement value, out PatchField<bool> field)
    {
        field = default;
        switch (value.ValueKind)
        {
            case JsonValueKind.True:
                field = new PatchField<bool>(true, true);
                return null;
            case JsonValueKind.False:
                field = new PatchField<bool>(true, false);
                return null;
            case JsonValueKind.Null:
                return PersonaAdminMessages.VerifiedNull;
            default:
                return PersonaAdminMessages.VerifiedType;
        }
    }

    private static string? ParseMediaId(JsonElement value, string notFoundMessage, out PatchField<Guid?> field)
    {
        field = default;
        if (value.ValueKind == JsonValueKind.Null)
        {
            field = new PatchField<Guid?>(true, null);
            return null;
        }

        // Malformed = the same text as unknown / cross-exercise / not an image (DP-16).
        if (value.ValueKind != JsonValueKind.String
            || !Guid.TryParse(value.GetString(), out var id)
            || id == Guid.Empty)
        {
            return notFoundMessage;
        }

        field = new PatchField<Guid?>(true, id);
        return null;
    }
}

/// <summary>The per-field text rules <see cref="PersonaProfilePatchParser"/> applies.</summary>
/// <param name="MaxLength">The bound after sanitizing (the raw pre-check allows <see cref="PersonaProfilePatchParser.RawLengthFactor"/> times this).</param>
/// <param name="LengthMessage">The 400 message for an over-long (or, raw, far over-long) value.</param>
/// <param name="ForbiddenCharacterMessage">The 400 message for a control or bidi-override character.</param>
/// <param name="AllowLineBreaks">Whether CR, LF and TAB are allowed.</param>
internal sealed record TextRules(int MaxLength, string LengthMessage, string ForbiddenCharacterMessage, bool AllowLineBreaks);

/// <summary>
/// Every 400 message <c>PATCH /api/staff/personas/{personaId}</c> can answer with, as plain JSON strings
/// (implementation.md §1.1). Exposed so the console (PE-FE), the seed script (S1) and the tests can rely on the
/// exact text.
/// </summary>
public static class PersonaAdminMessages
{
    /// <summary>The body is missing, is not JSON, or is not a JSON object.</summary>
    public const string BodyNotObject =
        "The request body must be a JSON object naming the fields to change (JSON merge-patch).";

    /// <summary>The request's <c>Content-Type</c> is not a JSON type the endpoint accepts. 415.</summary>
    public const string UnsupportedContentType = "Content-Type must be application/json or application/merge-patch+json.";

    /// <summary>The body exceeds <see cref="PersonaAdminEndpoints.MaxBodyBytes"/>.</summary>
    public const string BodyTooLarge = "The request body must be at most 16384 bytes.";

    /// <summary><c>displayName</c> was <c>null</c>.</summary>
    public const string DisplayNameNull = "displayName cannot be null.";

    /// <summary><c>displayName</c> was not a string.</summary>
    public const string DisplayNameType = "displayName must be a string.";

    /// <summary><c>displayName</c> is empty or too long after sanitizing.</summary>
    public const string DisplayNameLength = "displayName must be 1 to 100 characters.";

    /// <summary><c>displayName</c> has no visible character (only whitespace, zero-width or blank characters).</summary>
    public const string DisplayNameInvisible = "displayName must contain at least one visible character.";

    /// <summary><c>displayName</c> contains a control or bidirectional-override character.</summary>
    public const string DisplayNameForbiddenCharacter =
        "displayName must not contain control characters or bidirectional override characters.";

    /// <summary><c>bio</c> was neither a string nor <c>null</c>.</summary>
    public const string BioType = "bio must be a string or null.";

    /// <summary><c>bio</c> is too long after sanitizing.</summary>
    public const string BioLength = "bio must be at most 512 characters.";

    /// <summary><c>bio</c> contains a control character other than a line break or tab, or a bidirectional override.</summary>
    public const string BioForbiddenCharacter =
        "bio must not contain control characters (line breaks and tabs are allowed) or bidirectional override characters.";

    /// <summary><c>location</c> was neither a string nor <c>null</c>.</summary>
    public const string LocationType = "location must be a string or null.";

    /// <summary><c>location</c> is too long after sanitizing.</summary>
    public const string LocationLength = "location must be at most 100 characters.";

    /// <summary><c>location</c> contains a control or bidirectional-override character.</summary>
    public const string LocationForbiddenCharacter =
        "location must not contain control characters or bidirectional override characters.";

    /// <summary><c>verified</c> was <c>null</c>.</summary>
    public const string VerifiedNull = "verified cannot be null.";

    /// <summary><c>verified</c> was not a boolean.</summary>
    public const string VerifiedType = "verified must be true or false.";

    /// <summary>
    /// <c>avatarMediaId</c> is malformed, unknown, in another exercise, or not an image — one text for all of
    /// them, so the response never confirms that another exercise's media exists (COR-001, DP-16).
    /// </summary>
    public const string AvatarMediaNotFound = "avatarMediaId must name an image in this exercise, or be null to clear it.";

    /// <summary>The <c>bannerMediaId</c> counterpart of <see cref="AvatarMediaNotFound"/>.</summary>
    public const string BannerMediaNotFound = "bannerMediaId must name an image in this exercise, or be null to clear it.";

    /// <summary>The body names an immutable persona field.</summary>
    /// <param name="canonicalName">The field's canonical name from <see cref="PersonaProfilePatchParser.ImmutableFields"/> (never the client's spelling).</param>
    /// <returns>The message.</returns>
    public static string CannotBeChanged(string canonicalName) => canonicalName + " cannot be changed.";

    /// <summary>The body names a field that is not one of the six editable ones.</summary>
    /// <param name="name">The raw field name (echoed sanitized and length-capped).</param>
    /// <returns>The message.</returns>
    public static string UnknownField(string name) =>
        "Unknown field '" + PersonaProfilePatchParser.EchoSafe(name) + "'. Editable fields: "
        + string.Join(", ", PersonaProfilePatchParser.EditableFields) + ".";

    /// <summary>The body names the same field twice.</summary>
    /// <param name="name">The field name (always one of the editable ones by the time this is reported).</param>
    /// <returns>The message.</returns>
    public static string DuplicateField(string name) =>
        PersonaProfilePatchParser.EchoSafe(name) + " appears more than once.";
}
