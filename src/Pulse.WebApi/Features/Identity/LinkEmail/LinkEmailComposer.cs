namespace Pulse.WebApi.Features.Identity.LinkEmail;

using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;

/// <summary>
/// Composes the personal-link email (easy-login story 13). Deliberately minimal, because the link in it is a bearer
/// credential: a greeting with the participant's name, ONE plain sentence of instruction, the join link, and the
/// sign-in name for the typed fallback. Subject: <c>Your sign-in link for {exercise name}</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Content security (NFR-004).</b> Every value is first reduced to one clean line (<see cref="ToSingleLine"/>:
/// control characters and line/paragraph separators become a space, format characters are removed, so no CR/LF, no
/// bidi override, no zero-width trick), then, in the HTML part, encoded with <see cref="HtmlEncoder.Default"/> (text AND the <c>href</c> attribute).
/// The HTML has no image, no style sheet, no script, no form and no remote content of any kind: nothing a mail client
/// would fetch, so there is nothing to track. The only link is the join URL, which only <c>JoinUrlBuilder</c> builds
/// (an absolute <c>http(s)</c> URL), so no other scheme can appear.
/// </para>
/// <para>
/// <b>Nothing user-supplied in a header.</b> The subject carries the exercise name, which comes from
/// <c>ExerciseFactsReader</c> (staff-set, server-side), never from the request, and is cleaned and bounded the same
/// way. The recipient travels as a bare address with no display name (<see cref="AcsParticipantLinkMailer"/>).
/// </para>
/// </remarks>
public static class LinkEmailComposer
{
    /// <summary>The subject's fixed text, before the exercise name.</summary>
    public const string SubjectPrefix = "Your sign-in link for ";

    /// <summary>The subject when the exercise name is blank after cleaning.</summary>
    public const string SubjectWithoutExerciseName = "Your sign-in link";

    /// <summary>The longest exercise name kept in the subject (characters, never splitting a surrogate pair).</summary>
    public const int MaxSubjectExerciseNameLength = 120;

    /// <summary>The one sentence of instruction, identical in both parts.</summary>
    public const string Instruction =
        "Open this personal link on the phone or computer you will use for the exercise to sign in, and do not share it.";

    /// <summary>The label in front of the sign-in name (the typed fallback with the day's word).</summary>
    public const string SignInNameLabel = "Your sign-in name, if you are asked for it:";

    /// <summary>Builds the message for one participant.</summary>
    /// <param name="recipientAddress">The participant's address (already checked by <see cref="LinkEmailAddresses.IsDeliverable"/>).</param>
    /// <param name="exerciseName">
    /// The PARTICIPANT-FACING exercise name from <c>ExerciseFactsReader</c> (<c>ParticipantName</c>, §8.4), or empty when
    /// unset; never the internal name.
    /// </param>
    /// <param name="participantName">The participant's display name (participant-typed: never trusted).</param>
    /// <param name="signInName">The participant's sign-in name.</param>
    /// <param name="joinUrl">The join URL from <c>JoinUrlBuilder</c> (via <c>RosterLinkDtoFactory</c>).</param>
    /// <returns>The composed message.</returns>
    public static LinkEmailMessage Compose(
        string recipientAddress,
        string exerciseName,
        string participantName,
        string signInName,
        string joinUrl)
    {
        ArgumentException.ThrowIfNullOrEmpty(recipientAddress);
        ArgumentNullException.ThrowIfNull(exerciseName);
        ArgumentNullException.ThrowIfNull(participantName);
        ArgumentException.ThrowIfNullOrEmpty(signInName);
        ArgumentException.ThrowIfNullOrEmpty(joinUrl);

        var name = ToSingleLine(participantName);
        var signIn = ToSingleLine(signInName);
        var url = ToSingleLine(joinUrl);

        return new LinkEmailMessage
        {
            RecipientAddress = recipientAddress,
            Subject = Subject(exerciseName),
            HtmlBody = Html(name, signIn, url),
            PlainTextBody = PlainText(name, signIn, url),
        };
    }

    /// <summary>The subject for <paramref name="exerciseName"/>: cleaned to one line and bounded.</summary>
    /// <param name="exerciseName">The exercise name.</param>
    /// <returns>The subject.</returns>
    public static string Subject(string exerciseName)
    {
        var cleaned = Bounded(ToSingleLine(exerciseName ?? string.Empty), MaxSubjectExerciseNameLength);
        return cleaned.Length == 0 ? SubjectWithoutExerciseName : SubjectPrefix + cleaned;
    }

    /// <summary>
    /// Reduces <paramref name="value"/> to one clean line: every control character (CR, LF, tab, NUL, …) and every
    /// white space (including the Unicode line/paragraph separators) becomes a space, every format character (bidi
    /// overrides, zero-width joiners) is removed, runs of spaces collapse to one, and the ends are trimmed.
    /// </summary>
    /// <param name="value">The raw value.</param>
    /// <returns>The single-line value (possibly empty).</returns>
    public static string ToSingleLine(string value)
    {
        ArgumentNullException.ThrowIfNull(value);

        var builder = new StringBuilder(value.Length);
        var pendingSpace = false;
        foreach (var c in value)
        {
            var category = char.GetUnicodeCategory(c);
            if (category == UnicodeCategory.Format)
            {
                continue;
            }

            // Control characters (CR, LF, tab, NUL, …) and every kind of white space, including the Unicode line and
            // paragraph separators, become ONE space.
            if (char.IsControl(c) || char.IsWhiteSpace(c))
            {
                pendingSpace = builder.Length > 0;
                continue;
            }

            if (pendingSpace)
            {
                builder.Append(' ');
                pendingSpace = false;
            }

            builder.Append(c);
        }

        return builder.ToString();
    }

    private static string Html(string name, string signInName, string joinUrl)
    {
        var encoder = HtmlEncoder.Default;
        var greeting = name.Length == 0 ? "Hello," : $"Hello {encoder.Encode(name)},";
        var encodedUrl = encoder.Encode(joinUrl);

        return string.Join(
            "\n",
            "<!DOCTYPE html>",
            "<html lang=\"en\">",
            "<head><meta charset=\"utf-8\"><title>Your sign-in link</title></head>",
            "<body>",
            $"<p>{greeting}</p>",
            $"<p>{encoder.Encode(Instruction)}</p>",
            $"<p><a href=\"{encodedUrl}\">{encodedUrl}</a></p>",
            $"<p>{encoder.Encode(SignInNameLabel)} <strong>{encoder.Encode(signInName)}</strong></p>",
            "</body>",
            "</html>");
    }

    private static string PlainText(string name, string signInName, string joinUrl)
    {
        var greeting = name.Length == 0 ? "Hello," : $"Hello {name},";
        return string.Join(
            "\n",
            greeting,
            string.Empty,
            Instruction,
            string.Empty,
            joinUrl,
            string.Empty,
            $"{SignInNameLabel} {signInName}");
    }

    /// <summary><paramref name="value"/> cut to at most <paramref name="max"/> characters, never splitting a surrogate pair.</summary>
    private static string Bounded(string value, int max)
    {
        if (value.Length <= max)
        {
            return value;
        }

        var length = char.IsHighSurrogate(value[max - 1]) ? max - 1 : max;
        return value[..length].TrimEnd();
    }
}
