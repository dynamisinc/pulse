namespace Pulse.WebApi.Features.Social.PersonaAdmin;

using Pulse.WebApi.Data.Entities;

/// <summary>
/// One field of a JSON merge-patch (RFC 7396): whether the body NAMED the field, and the value it carries.
/// <see cref="Value"/> is meaningful only when <see cref="IsPresent"/> is <c>true</c>; for a clearable field a
/// present <c>null</c> value means "clear it".
/// </summary>
/// <typeparam name="T">The field's value type.</typeparam>
/// <param name="IsPresent"><c>true</c> when the body named the field (absent = leave unchanged).</param>
/// <param name="Value">The validated, sanitized value to apply. Ignored when <paramref name="IsPresent"/> is <c>false</c>.</param>
public readonly record struct PatchField<T>(bool IsPresent, T Value);

/// <summary>
/// A validated persona profile merge-patch (demo-polish PE-BE, story 21; implementation.md §1.5.6). Produced only
/// by <see cref="PersonaProfilePatchParser"/>, so every present text value is already sanitized with
/// <see cref="PostSanitizer"/> (NFR-004), trimmed and inside its bound. Media ids are parsed but NOT yet resolved:
/// whether they name an image in the caller's exercise is decided by <see cref="PersonaProfileEditService"/>
/// against the scoped <c>MediaAssets</c> set.
/// </summary>
/// <remarks>
/// <b>What it can express.</b> Only the six editable fields. <c>handle</c>, <c>kind</c>, <c>personaType</c> and
/// <c>exerciseId</c> have no member here at all, so a patch that would change them cannot even be represented;
/// the parser refuses such a body with a 400 instead of ignoring the field.
/// </remarks>
public sealed class PersonaProfilePatch
{
    /// <summary>The upper bound of <see cref="DisplayName"/> after sanitization (the lower bound is 1).</summary>
    public const int MaxDisplayNameLength = 100;

    /// <summary>The upper bound of <see cref="Bio"/> after sanitization — the schema bound.</summary>
    public const int MaxBioLength = Persona.MaxBioLength;

    /// <summary>The upper bound of <see cref="Location"/> after sanitization — the schema bound (DP-4).</summary>
    public const int MaxLocationLength = Persona.MaxLocationLength;

    /// <summary>The new display name (never null when present; 1..100 characters).</summary>
    public PatchField<string> DisplayName { get; init; }

    /// <summary>The new bio (at most 512 characters), or a present <c>null</c> to clear it.</summary>
    public PatchField<string?> Bio { get; init; }

    /// <summary>The new location (at most 100 characters), or a present <c>null</c> to clear it.</summary>
    public PatchField<string?> Location { get; init; }

    /// <summary>The new SOC-052 verified mark (never null when present).</summary>
    public PatchField<bool> Verified { get; init; }

    /// <summary>The new avatar image's <c>MediaAsset</c> id (not yet resolved), or a present <c>null</c> to clear it.</summary>
    public PatchField<Guid?> AvatarMediaId { get; init; }

    /// <summary>The new banner image's <c>MediaAsset</c> id (not yet resolved), or a present <c>null</c> to clear it.</summary>
    public PatchField<Guid?> BannerMediaId { get; init; }

    /// <summary>
    /// The wire names of the fields this patch sets, in a fixed order. Used for the operational log line only
    /// (names, never values).
    /// </summary>
    public IReadOnlyList<string> PresentFieldNames
    {
        get
        {
            var names = new List<string>(6);
            AddIfPresent(names, DisplayName.IsPresent, PersonaProfilePatchParser.DisplayNameField);
            AddIfPresent(names, Bio.IsPresent, PersonaProfilePatchParser.BioField);
            AddIfPresent(names, Location.IsPresent, PersonaProfilePatchParser.LocationField);
            AddIfPresent(names, Verified.IsPresent, PersonaProfilePatchParser.VerifiedField);
            AddIfPresent(names, AvatarMediaId.IsPresent, PersonaProfilePatchParser.AvatarMediaIdField);
            AddIfPresent(names, BannerMediaId.IsPresent, PersonaProfilePatchParser.BannerMediaIdField);
            return names;
        }
    }

    /// <summary>
    /// Applies every present field to <paramref name="persona"/>. Absent fields are left exactly as they are
    /// (RFC 7396). The caller must already have verified that any media id names an in-scope image.
    /// </summary>
    /// <param name="persona">The tracked, in-scope persona to update.</param>
    public void ApplyTo(Persona persona)
    {
        ArgumentNullException.ThrowIfNull(persona);

        if (DisplayName.IsPresent)
        {
            persona.DisplayName = DisplayName.Value;
        }

        if (Bio.IsPresent)
        {
            persona.Bio = Bio.Value;
        }

        if (Location.IsPresent)
        {
            persona.Location = Location.Value;
        }

        if (Verified.IsPresent)
        {
            persona.Verified = Verified.Value;
        }

        if (AvatarMediaId.IsPresent)
        {
            persona.AvatarMediaId = AvatarMediaId.Value;
        }

        if (BannerMediaId.IsPresent)
        {
            persona.BannerMediaId = BannerMediaId.Value;
        }
    }

    private static void AddIfPresent(List<string> names, bool present, string name)
    {
        if (present)
        {
            names.Add(name);
        }
    }
}
