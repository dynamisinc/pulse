namespace Pulse.Core.Features.Ambient.Services;

using System.Text;

/// <summary>
/// The setting-only brief an ambient-chatter prompt carries instead of the exercise brief (ambient-chatter story 01,
/// orchestrator review W-3). The exercise brief narrates the incident ("a suspected water-main contamination event…");
/// handing that to an "everyday life" prompt invites the model to drift back into it. The ambient prompt therefore
/// gets ONLY the name of the fictional place, never any incident text.
/// </summary>
public static class AmbientSettingBrief
{
    /// <summary>The longest place name carried into the prompt.</summary>
    public const int MaxPlaceNameLength = 60;

    /// <summary>The brief used when no place name is known.</summary>
    public const string Generic = "An ordinary town on an ordinary day.";

    /// <summary>
    /// Builds the setting-only brief from a place name (e.g. the exercise's world name). The name is reduced to
    /// letters, digits, spaces and <c>' . -</c>, collapsed, and capped at <see cref="MaxPlaceNameLength"/>, so no
    /// newline or markup can open a new prompt section. Blank → <see cref="Generic"/>.
    /// </summary>
    /// <param name="placeName">The fictional place name, or <c>null</c>.</param>
    /// <returns>The brief.</returns>
    public static string Build(string? placeName)
    {
        var name = Clean(placeName);
        return name.Length == 0
            ? Generic
            : $"The fictional community of {name}, on an ordinary day.";
    }

    /// <summary>
    /// Reduces a staff-authored name (a place name, or a persona display name on the ambient path) to letters, digits,
    /// spaces and <c>' . -</c>, whitespace collapsed, capped at <see cref="MaxPlaceNameLength"/> — so no newline,
    /// <c>#</c> or markup can open a new prompt section. May return empty.
    /// </summary>
    /// <param name="name">The name, or <c>null</c>.</param>
    /// <returns>The cleaned name (empty when nothing survives).</returns>
    public static string CleanName(string? name) => Clean(name);

    private static string Clean(string? placeName)
    {
        if (string.IsNullOrWhiteSpace(placeName))
        {
            return string.Empty;
        }

        var sb = new StringBuilder();
        var lastWasSpace = true;
        foreach (var ch in placeName)
        {
            if (char.IsLetterOrDigit(ch) || ch is '\'' or '.' or '-')
            {
                sb.Append(ch);
                lastWasSpace = false;
            }
            else if (!lastWasSpace)
            {
                sb.Append(' ');
                lastWasSpace = true;
            }

            if (sb.Length >= MaxPlaceNameLength)
            {
                break;
            }
        }

        return sb.ToString().Trim();
    }
}
