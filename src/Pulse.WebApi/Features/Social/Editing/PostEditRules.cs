namespace Pulse.WebApi.Features.Social.Editing;

using Pulse.WebApi.Data.Entities;

/// <summary>
/// The edit-own-post rules (demo-feedback DF-29/DF-30), in one place so the write path
/// (<see cref="PostEditService"/>) and the read projection (<c>viewer.editableForSeconds</c>) can never disagree.
/// Pure functions over a <see cref="Post"/> and a server wall-clock instant.
/// </summary>
/// <remarks>
/// The window is measured in REAL wall-clock time from <see cref="Post.CreatedWallClock"/> (server UTC), never from
/// scenario time: a frozen or jumped scenario clock neither extends nor shortens it (DF-30, "the window keeps
/// running while edits are blocked"). The participant never sees the wall clock (COR-053): the read carries only the
/// remaining DURATION in seconds.
/// </remarks>
public static class PostEditRules
{
    /// <summary>The only origin whose posts are editable (DF-29).</summary>
    public const string ParticipantOrigin = "participant";

    /// <summary>The most edits one post may receive (DF-30, X parity). <see cref="PostEdit.EditNumber"/> stays within 1..this.</summary>
    public const int MaxEdits = 5;

    /// <summary>The edit window, measured from <see cref="Post.CreatedWallClock"/> (DF-30).</summary>
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(15);

    /// <summary>Whether the edit window of <paramref name="post"/> has closed at <paramref name="utcNow"/> (strictly past 15 minutes).</summary>
    /// <param name="post">The post.</param>
    /// <param name="utcNow">The server wall clock.</param>
    /// <returns><c>true</c> when <c>utcNow − CreatedWallClock &gt; 15 min</c>.</returns>
    public static bool IsWindowClosed(Post post, DateTimeOffset utcNow)
    {
        ArgumentNullException.ThrowIfNull(post);
        return utcNow - post.CreatedWallClock > Window;
    }

    /// <summary>Whether <paramref name="post"/> has used every edit.</summary>
    /// <param name="post">The post.</param>
    /// <returns><c>true</c> when <see cref="Post.EditCount"/> has reached <see cref="MaxEdits"/>.</returns>
    public static bool IsAtLimit(Post post)
    {
        ArgumentNullException.ThrowIfNull(post);
        return post.EditCount >= MaxEdits;
    }

    /// <summary>
    /// The <c>viewer.editableForSeconds</c> value: whole seconds left in the window (rounded down, so the client never
    /// shows time the server will not honour), <c>0</c> when the window has closed or the post is at the limit.
    /// </summary>
    /// <param name="post">The post.</param>
    /// <param name="utcNow">The server wall clock.</param>
    /// <returns>Seconds left, never negative.</returns>
    public static int EditableForSeconds(Post post, DateTimeOffset utcNow)
    {
        ArgumentNullException.ThrowIfNull(post);

        if (IsAtLimit(post))
        {
            return 0;
        }

        var left = post.CreatedWallClock + Window - utcNow;
        return left <= TimeSpan.Zero ? 0 : (int)Math.Floor(left.TotalSeconds);
    }

    /// <summary>
    /// Whether <paramref name="viewerPersonaId"/> may see <c>editableForSeconds</c> on <paramref name="post"/>: the
    /// viewer authored it and it is a participant-origin post (DF-29). The origin is read only to answer this yes/no;
    /// it is never projected (XC-002).
    /// </summary>
    /// <param name="post">The post.</param>
    /// <param name="viewerPersonaId">The viewing participant's persona, or <c>null</c>.</param>
    /// <returns><c>true</c> for the viewer's own participant-origin post.</returns>
    public static bool IsViewersOwnEditablePost(Post post, Guid? viewerPersonaId)
    {
        ArgumentNullException.ThrowIfNull(post);
        return viewerPersonaId is { } viewer
            && viewer != Guid.Empty
            && post.AuthorPersonaId == viewer
            && string.Equals(post.Origin, ParticipantOrigin, StringComparison.Ordinal);
    }

    /// <summary>
    /// The <c>edited</c> summary of <paramref name="post"/> (DF-31): <c>{ count, scenarioTime }</c> once edited, else
    /// <c>null</c>. The time is <see cref="Post.LastEditedScenarioTime"/> round-trip (COR-053) — never
    /// <see cref="Post.LastEditedAt"/>, the wall clock, which is staff/export only (XC-002).
    /// </summary>
    /// <param name="post">The post.</param>
    /// <returns>The summary, or <c>null</c> when never edited.</returns>
    public static PostEditedSummaryDto? SummaryOf(Post post)
    {
        ArgumentNullException.ThrowIfNull(post);

        if (post.EditCount <= 0 || post.LastEditedScenarioTime is not { } scenarioTime)
        {
            return null;
        }

        return new PostEditedSummaryDto { Count = post.EditCount, ScenarioTime = scenarioTime.ToString("O") };
    }
}
