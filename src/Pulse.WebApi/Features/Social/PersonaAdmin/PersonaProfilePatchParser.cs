namespace Pulse.WebApi.Features.Social.PersonaAdmin;

using System.Diagnostics.CodeAnalysis;
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
/// <b>Text (NFR-004).</b> <c>displayName</c>, <c>bio</c> and <c>location</c> go through
/// <see cref="PostSanitizer.Sanitize"/> (strip until stable, never encode), are trimmed, and only THEN measured
/// against their bounds. A <c>bio</c> or <c>location</c> that is empty after that is stored as <c>null</c> (the
/// same as clearing it), so the wire never carries an empty string for them.
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

    /// <summary>The longest client-supplied field name echoed back in an error message.</summary>
    private const int MaxEchoedNameLength = 64;

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
                BioField => ParseClearableText(
                    property.Value, PersonaProfilePatch.MaxBioLength, PersonaAdminMessages.BioType, PersonaAdminMessages.BioLength, out bio),
                LocationField => ParseClearableText(
                    property.Value, PersonaProfilePatch.MaxLocationLength, PersonaAdminMessages.LocationType, PersonaAdminMessages.LocationLength, out location),
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
    /// Makes a client-supplied field name safe to echo in a message: markup stripped (NFR-004) and length capped.
    /// </summary>
    /// <param name="name">The raw field name from the body.</param>
    /// <returns>The echo-safe name.</returns>
    internal static string EchoSafe(string name)
    {
        var stripped = PostSanitizer.Sanitize(name);
        return stripped.Length <= MaxEchoedNameLength ? stripped : stripped[..MaxEchoedNameLength] + "…";
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
                var text = PostSanitizer.Sanitize(value.GetString()!).Trim();
                if (text.Length == 0 || text.Length > PersonaProfilePatch.MaxDisplayNameLength)
                {
                    return PersonaAdminMessages.DisplayNameLength;
                }

                field = new PatchField<string>(true, text);
                return null;
            default:
                return PersonaAdminMessages.DisplayNameType;
        }
    }

    private static string? ParseClearableText(
        JsonElement value, int maxLength, string typeMessage, string lengthMessage, out PatchField<string?> field)
    {
        field = default;
        switch (value.ValueKind)
        {
            case JsonValueKind.Null:
                field = new PatchField<string?>(true, null);
                return null;
            case JsonValueKind.String:
                var text = PostSanitizer.Sanitize(value.GetString()!).Trim();
                if (text.Length > maxLength)
                {
                    return lengthMessage;
                }

                // Empty after sanitizing = no value: stored as NULL so the wire omits the key, never sends "".
                field = new PatchField<string?>(true, text.Length == 0 ? null : text);
                return null;
            default:
                return typeMessage;
        }
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

    /// <summary>The body exceeds <see cref="PersonaAdminEndpoints.MaxBodyBytes"/>.</summary>
    public const string BodyTooLarge = "The request body must be at most 16384 bytes.";

    /// <summary><c>displayName</c> was <c>null</c>.</summary>
    public const string DisplayNameNull = "displayName cannot be null.";

    /// <summary><c>displayName</c> was not a string.</summary>
    public const string DisplayNameType = "displayName must be a string.";

    /// <summary><c>displayName</c> is empty or too long after sanitizing.</summary>
    public const string DisplayNameLength = "displayName must be 1 to 100 characters.";

    /// <summary><c>bio</c> was neither a string nor <c>null</c>.</summary>
    public const string BioType = "bio must be a string or null.";

    /// <summary><c>bio</c> is too long after sanitizing.</summary>
    public const string BioLength = "bio must be at most 512 characters.";

    /// <summary><c>location</c> was neither a string nor <c>null</c>.</summary>
    public const string LocationType = "location must be a string or null.";

    /// <summary><c>location</c> is too long after sanitizing.</summary>
    public const string LocationLength = "location must be at most 100 characters.";

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
