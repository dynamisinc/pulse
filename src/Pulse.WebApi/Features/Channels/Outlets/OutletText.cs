namespace Pulse.WebApi.Features.Channels.Outlets;

using System.Globalization;

/// <summary>
/// The one "invisible or control character" rule for outlet text (names, taglines, categories, skin-override strings).
/// </summary>
internal static class OutletText
{
    /// <summary>
    /// Whether <paramref name="value"/> carries a control character (Cc) or an invisible formatting character: Unicode
    /// Format (Cf, e.g. U+202E RIGHT-TO-LEFT OVERRIDE, zero-width joiners), Line Separator (Zl) or Paragraph Separator
    /// (Zp). These can reorder or hide text and are refused wherever control characters are.
    /// </summary>
    /// <param name="value">The candidate text.</param>
    /// <returns><c>true</c> when any such character is present.</returns>
    public static bool HasControlOrInvisible(string value) =>
        value.Any(c => char.GetUnicodeCategory(c) is UnicodeCategory.Control
            or UnicodeCategory.Format
            or UnicodeCategory.LineSeparator
            or UnicodeCategory.ParagraphSeparator);
}
