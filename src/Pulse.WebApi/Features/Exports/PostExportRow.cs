namespace Pulse.WebApi.Features.Exports;

using System.Collections.Generic;

/// <summary>
/// One row of the post activity export (demo-feedback story 02, DF-8): every value the <c>Posts</c> sheet writes for
/// one post or reply, already resolved and formatted. Staff world only (XC-002): it carries provenance (origin, the
/// acting human, the inject) and the seeded baselines, which never reach a participant surface.
/// </summary>
/// <remarks>
/// The property order is the frozen column order in <c>implementation.md</c> → "Export columns (02, sheet Posts)";
/// <see cref="PostExportWorkbook.Headers"/> is the matching header list.
/// </remarks>
public sealed record PostExportRow
{
    /// <summary><c>Scenario time</c>: the post's scenario instant in the exercise's time zone, <c>yyyy-MM-dd HH:mm</c>.</summary>
    public required string ScenarioTime { get; init; }

    /// <summary><c>Wall clock (UTC)</c>: the real ingest instant, written as an Excel date-time cell.</summary>
    public required DateTime WallClockUtc { get; init; }

    /// <summary><c>Author handle</c>: <c>@handle</c> of the authoring persona, blank when it does not resolve in the exercise.</summary>
    public required string AuthorHandle { get; init; }

    /// <summary><c>Author name</c>: the authoring persona's display name, blank when it does not resolve.</summary>
    public required string AuthorName { get; init; }

    /// <summary><c>Author type</c>: the readable label for the post's origin (<see cref="PostExportLabels.AuthorType"/>).</summary>
    public required string AuthorType { get; init; }

    /// <summary><c>Posted by</c>: the acting human's display name; blank for engine and white noise, or when unresolved.</summary>
    public required string PostedBy { get; init; }

    /// <summary>
    /// <c>Inject #</c>: the inject item's external reference, else its title; a non-GUID inject id raw; blank for posts
    /// without an inject or whose item is not in the exercise.
    /// </summary>
    public required string InjectRef { get; init; }

    /// <summary><c>Post id</c>.</summary>
    public required string PostId { get; init; }

    /// <summary>
    /// <c>Reply to</c>: <c>@handle</c> and post id of the parent; blank for a top-level post and for a parent that does
    /// not resolve inside the exercise.
    /// </summary>
    public required string ReplyTo { get; init; }

    /// <summary><c>Text</c>: the post body, written as a literal text value (never a formula).</summary>
    public required string Text { get; init; }

    /// <summary><c>Media</c>: e.g. <c>2 images</c>, <c>1 video</c>; blank when the post has none.</summary>
    public required string Media { get; init; }

    /// <summary><c>Likes</c>: real active like reactions.</summary>
    public required int Likes { get; init; }

    /// <summary><c>Reposts</c>: real active repost reactions.</summary>
    public required int Reposts { get; init; }

    /// <summary><c>Replies</c>: real non-deleted direct replies.</summary>
    public required int Replies { get; init; }

    /// <summary><c>Shown likes</c>: seeded baseline plus real, as participants saw it.</summary>
    public required int ShownLikes { get; init; }

    /// <summary><c>Shown reposts</c>: seeded baseline plus real.</summary>
    public required int ShownReposts { get; init; }

    /// <summary><c>Shown replies</c>: seeded baseline plus real.</summary>
    public required int ShownReplies { get; init; }

    /// <summary><c>Pinned for all</c>: <c>Yes</c> when a controller pinned the post for everyone, else blank.</summary>
    public required string PinnedForAll { get; init; }

    /// <summary><c>Status</c>: <c>Live</c> or <c>Taken down</c>.</summary>
    public required string Status { get; init; }

    /// <summary><c>Taken down at</c>: the takedown's scenario instant, <c>yyyy-MM-dd HH:mm</c>; blank for a live post.</summary>
    public required string TakenDownAt { get; init; }

    /// <summary><c>Edits</c>: how many times the author edited the post (demo-feedback DF-31, story 19); 0 when never.</summary>
    public int Edits { get; init; }

    /// <summary><c>Last edited (scenario)</c>: the last edit's scenario instant, <c>yyyy-MM-dd HH:mm</c>; blank when never edited.</summary>
    public string LastEditedAt { get; init; } = string.Empty;

    /// <summary>
    /// <c>Original text</c>: the text before the first edit (edit 1's <c>PreviousBody</c>), written as a literal text value;
    /// blank when never edited.
    /// </summary>
    public string OriginalText { get; init; } = string.Empty;
}

/// <summary>
/// One row of the export's second sheet, <c>Edit history</c> (demo-feedback DF-39, story 19): one version of an edited
/// post or reply. Staff world only (it carries the wall clock). Never-edited posts have no rows.
/// </summary>
/// <remarks>
/// Version 0 is the original (the post's <c>CreatedScenarioTime</c> / <c>CreatedWallClock</c>); version n is the text
/// after edit n (<c>PostEdit</c> n's <c>EditedScenarioTime</c> / <c>EditedAt</c>), whose text is <c>PostEdit</c> n+1's
/// <c>PreviousBody</c>, or the current body for the last version. The property order is the column order;
/// <see cref="PostExportWorkbook.EditHistoryHeaders"/> is the matching header list.
/// </remarks>
public sealed record PostEditHistoryExportRow
{
    /// <summary><c>Post id</c>.</summary>
    public required string PostId { get; init; }

    /// <summary><c>Edit number</c>: 0 for the original, n for the text after edit n.</summary>
    public required int EditNumber { get; init; }

    /// <summary><c>Scenario time</c>: the version's scenario instant, <c>yyyy-MM-dd HH:mm</c>.</summary>
    public required string ScenarioTime { get; init; }

    /// <summary><c>Wall clock (UTC)</c>: the version's real instant, written as an Excel date-time cell.</summary>
    public required DateTime WallClockUtc { get; init; }

    /// <summary><c>Text</c>: the version's text, written as a literal text value (never a formula).</summary>
    public required string Text { get; init; }

    /// <summary><c>Current</c>: <c>yes</c> on the post's current (last) version, else <c>no</c>.</summary>
    public required string Current { get; init; }
}

/// <summary>The readable labels and formats the export writes. Pure functions, so every mapping is unit-testable.</summary>
public static class PostExportLabels
{
    /// <summary>The scenario-time format of the <c>Scenario time</c> and <c>Taken down at</c> columns.</summary>
    public const string ScenarioTimeFormat = "yyyy-MM-dd HH:mm";

    /// <summary>The <c>Status</c> of a post that is not taken down.</summary>
    public const string Live = "Live";

    /// <summary>The <c>Status</c> of a taken-down (soft-deleted) post.</summary>
    public const string TakenDown = "Taken down";

    /// <summary>The <c>Pinned for all</c> value of a post a controller pinned for everyone.</summary>
    public const string Yes = "Yes";

    /// <summary>The <c>Current</c> value of a post's current version on <c>Edit history</c> (DF-39).</summary>
    public const string CurrentYes = "yes";

    /// <summary>The <c>Current</c> value of an earlier version on <c>Edit history</c> (DF-39).</summary>
    public const string CurrentNo = "no";

    /// <summary>The origin of an engine post.</summary>
    public const string EngineOrigin = "engine";

    /// <summary>The origin of a white-noise post (DF-12).</summary>
    public const string NoiseOrigin = "noise";

    private static readonly Dictionary<string, string> AuthorTypes = new(StringComparer.Ordinal)
    {
        ["participant"] = "Participant",
        ["controller-as-persona"] = "Controller as persona",
        ["inject"] = "Scripted inject",
        [EngineOrigin] = "Engine",
        [NoiseOrigin] = "White noise",
    };

    /// <summary>
    /// Maps a stored <c>Post.Origin</c> to its <c>Author type</c> label. An unknown origin writes the raw value and
    /// never throws, so a future origin still exports.
    /// </summary>
    /// <param name="origin">The stored origin.</param>
    /// <returns>The label.</returns>
    public static string AuthorType(string? origin) =>
        origin is not null && AuthorTypes.TryGetValue(origin, out var label) ? label : origin ?? string.Empty;

    /// <summary>Whether a post of this origin has no human behind it, so <c>Posted by</c> stays blank.</summary>
    /// <param name="origin">The stored origin.</param>
    /// <returns><c>true</c> for engine and white noise.</returns>
    public static bool HasNoActingHuman(string? origin) =>
        string.Equals(origin, EngineOrigin, StringComparison.Ordinal)
        || string.Equals(origin, NoiseOrigin, StringComparison.Ordinal);

    /// <summary>Formats a scenario instant in the exercise's zone as <see cref="ScenarioTimeFormat"/>.</summary>
    /// <param name="instant">The stored scenario instant, or <c>null</c>.</param>
    /// <param name="zone">The exercise's time zone.</param>
    /// <returns>The formatted time, or blank for <c>null</c>.</returns>
    public static string ScenarioTime(DateTimeOffset? instant, TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(zone);
        return instant is { } value
            ? TimeZoneInfo.ConvertTime(value, zone).ToString(ScenarioTimeFormat, System.Globalization.CultureInfo.InvariantCulture)
            : string.Empty;
    }

    /// <summary>Formats a media summary such as <c>2 images</c>, <c>1 video</c> or <c>1 image, 1 video</c>.</summary>
    /// <param name="images">Attached images.</param>
    /// <param name="videos">Attached videos.</param>
    /// <returns>The summary, or blank when there is no media.</returns>
    public static string Media(int images, int videos)
    {
        var parts = new List<string>(2);
        if (images > 0)
        {
            parts.Add(images == 1 ? "1 image" : $"{images} images");
        }

        if (videos > 0)
        {
            parts.Add(videos == 1 ? "1 video" : $"{videos} videos");
        }

        return string.Join(", ", parts);
    }

    /// <summary>Formats a persona handle as <c>@handle</c> (an already-prefixed handle is not doubled).</summary>
    /// <param name="handle">The stored handle, or <c>null</c>.</param>
    /// <returns>The display handle, or blank.</returns>
    public static string Handle(string? handle) =>
        string.IsNullOrWhiteSpace(handle) ? string.Empty : handle.StartsWith('@') ? handle : "@" + handle;

    /// <summary>Formats the <c>Reply to</c> cell: <c>@handle</c> and the parent post id, or the id alone.</summary>
    /// <param name="parentHandle">The parent's author handle, or <c>null</c> when it does not resolve.</param>
    /// <param name="parentPostId">The parent post id when it resolved inside the exercise, else <c>null</c>.</param>
    /// <returns>The cell text, or blank.</returns>
    public static string ReplyTo(string? parentHandle, Guid? parentPostId)
    {
        if (parentPostId is not { } parentId)
        {
            return string.Empty;
        }

        var handle = Handle(parentHandle);
        return handle.Length == 0 ? parentId.ToString() : $"{handle} {parentId}";
    }

    /// <summary>
    /// Reduces an exercise name to a lower-case <c>[a-z0-9-]</c> slug for the download file name; <c>exercise</c> when
    /// nothing usable is left.
    /// </summary>
    /// <param name="name">The exercise display name.</param>
    /// <returns>The slug, at most 40 characters.</returns>
    public static string Slug(string? name)
    {
        const int maxLength = 40;
        var builder = new System.Text.StringBuilder(maxLength);
        var lastWasHyphen = false;

        foreach (var character in name ?? string.Empty)
        {
            if (builder.Length >= maxLength)
            {
                break;
            }

            if (char.IsAsciiLetterOrDigit(character))
            {
                builder.Append(char.ToLowerInvariant(character));
                lastWasHyphen = false;
            }
            else if (!lastWasHyphen && builder.Length > 0)
            {
                builder.Append('-');
                lastWasHyphen = true;
            }
        }

        while (builder.Length > 0 && builder[^1] == '-')
        {
            builder.Length--;
        }

        return builder.Length == 0 ? "exercise" : builder.ToString();
    }

    /// <summary>The download file name: <c>pulse-posts-&lt;exercise-slug&gt;-&lt;yyyyMMdd-HHmm&gt;.xlsx</c>.</summary>
    /// <param name="exerciseName">The exercise display name.</param>
    /// <param name="wallClockUtc">The server's UTC wall clock at download.</param>
    /// <returns>The file name (characters <c>[a-z0-9-.]</c> only, so it needs no escaping in the header).</returns>
    public static string FileName(string? exerciseName, DateTimeOffset wallClockUtc) =>
        $"pulse-posts-{Slug(exerciseName)}-{wallClockUtc.UtcDateTime.ToString("yyyyMMdd-HHmm", System.Globalization.CultureInfo.InvariantCulture)}.xlsx";
}
