namespace Pulse.WebApi.Features.Press.Outlets;

using System.Text.Json;
using System.Text.Json.Nodes;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Press.Contracts;
using Pulse.WebApi.Features.Press.Kind;

/// <summary>
/// An org newsroom's letterhead defaults (PRS-012, D4-005): the address and default press contact, stored on the newsroom
/// outlet's <c>SkinOverridesJson</c> under <c>ext.press</c> (F03 allowlists the namespace and caps the whole document at
/// 4 KB). F03 takes only FLAT values there, so the letterhead is the <see cref="PressVocabulary.LetterheadExtKeys"/>
/// (<c>letterheadAddress</c>, <c>letterheadContactName</c>, ...) rather than a nested object. Pure.
/// </summary>
/// <remarks>
/// An org without them gets a NEUTRAL letterhead (no address, no default contact; the logo only if the newsroom has
/// one), never a platform-branded one: nothing here falls back to The Wire Room, Pulse or any other brand.
/// </remarks>
public static class PressLetterhead
{
    /// <summary>Reads the letterhead from a newsroom outlet's stored skin overrides.</summary>
    /// <param name="skinOverridesJson">The outlet's <c>SkinOverridesJson</c>, or null.</param>
    /// <param name="logo">The newsroom's signed logo, or null.</param>
    /// <returns>The letterhead; neutral when nothing is configured or the JSON does not read.</returns>
    public static ReleaseLetterheadDto Read(string? skinOverridesJson, ContentMediaDto? logo)
    {
        var bag = ReleasePayloadReader.TryParseObject(skinOverridesJson)?["ext"]?[PressVocabulary.SkinExtNamespace] as JsonObject;
        if (bag is null)
        {
            return new ReleaseLetterheadDto { Logo = logo };
        }

        var contactName = Text(bag, PressVocabulary.LetterheadContactNameKey, PressVocabulary.ContactNameMaxLength);
        return new ReleaseLetterheadDto
        {
            Logo = logo,
            Address = Text(bag, PressVocabulary.LetterheadAddressKey, PressVocabulary.LetterheadAddressMaxLength),
            DefaultContact = contactName is null
                ? null
                : new ReleaseContactDto
                {
                    Name = contactName,
                    Title = Text(bag, PressVocabulary.LetterheadContactTitleKey, PressVocabulary.ContactTitleMaxLength),
                    Phone = Text(bag, PressVocabulary.LetterheadContactPhoneKey, PressVocabulary.ContactPhoneMaxLength),
                    Email = Text(bag, PressVocabulary.LetterheadContactEmailKey, PressVocabulary.ContactEmailMaxLength),
                },
        };
    }

    /// <summary>
    /// Writes the letterhead into a copy of <paramref name="skinOverrides"/>, keeping every other override (a null field
    /// removes its key), then runs F03's <see cref="ISkinOverridesValidator"/> over the whole result, so nothing is
    /// returned that the outlet registry would refuse to store.
    /// </summary>
    /// <remarks>
    /// F03 validates every <c>ext</c> string as a CSS-safe value today: it refuses <c>@ ; ! &lt; &gt; { } \</c> and any
    /// <c>word(</c> sequence. So a default contact EMAIL (and text such as "Office of EM (OEM)") is refused here until
    /// F03 gives the <c>ext.press.letterhead*</c> keys text rules (a foundation follow-up raised by press story 01).
    /// </remarks>
    /// <param name="validator">F03's skin-overrides validator.</param>
    /// <param name="skinKey">The newsroom outlet's skin key.</param>
    /// <param name="skinOverrides">The current overrides, or null.</param>
    /// <param name="address">The address, or null.</param>
    /// <param name="defaultContact">The default contact, or null.</param>
    /// <returns>The new overrides and no errors, or null and every problem.</returns>
    public static (JsonObject? Overrides, IReadOnlyList<string> Errors) Write(
        ISkinOverridesValidator validator,
        string skinKey,
        JsonObject? skinOverrides,
        string? address,
        ReleaseContactDto? defaultContact)
    {
        ArgumentNullException.ThrowIfNull(validator);

        var fields = new (string Key, string? Value, int Max)[]
        {
            (PressVocabulary.LetterheadAddressKey, address, PressVocabulary.LetterheadAddressMaxLength),
            (PressVocabulary.LetterheadContactNameKey, defaultContact?.Name, PressVocabulary.ContactNameMaxLength),
            (PressVocabulary.LetterheadContactTitleKey, defaultContact?.Title, PressVocabulary.ContactTitleMaxLength),
            (PressVocabulary.LetterheadContactPhoneKey, defaultContact?.Phone, PressVocabulary.ContactPhoneMaxLength),
            (PressVocabulary.LetterheadContactEmailKey, defaultContact?.Email, PressVocabulary.ContactEmailMaxLength),
        };

        var copy = skinOverrides?.DeepClone().AsObject() ?? [];
        if (copy["ext"] is not JsonObject ext)
        {
            ext = [];
            copy["ext"] = ext;
        }

        if (ext[PressVocabulary.SkinExtNamespace] is not JsonObject bag)
        {
            bag = [];
            ext[PressVocabulary.SkinExtNamespace] = bag;
        }

        foreach (var (key, value, max) in fields)
        {
            var cleaned = value is null ? null : PressPlainText.Clean(value, multiline: false);
            if (string.IsNullOrEmpty(cleaned))
            {
                bag.Remove(key);
                continue;
            }

            if (PressPlainText.CodePointLength(cleaned) > max)
            {
                return (null, [$"ext.press.{key}: must be at most {max} characters"]);
            }

            bag[key] = cleaned;
        }

        var result = validator.Validate(skinKey, copy);
        return result.IsValid ? (copy, []) : (null, result.Errors);
    }

    private static string? Text(JsonObject bag, string key, int max)
    {
        if (bag[key] is not { } node || node.GetValueKind() != JsonValueKind.String)
        {
            return null;
        }

        var cleaned = PressPlainText.Clean(node.GetValue<string>(), multiline: false);
        return cleaned.Length == 0 || PressPlainText.CodePointLength(cleaned) > max ? null : cleaned;
    }
}
